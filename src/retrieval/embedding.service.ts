import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { l2Normalize } from './vector-pack';

/**
 * Local sentence embeddings.
 *
 * Runs a small model in-process rather than calling an embeddings API. KAKAW is
 * bring-your-own-LLM and Anthropic publishes no embeddings endpoint, so a
 * user's configured provider cannot be relied on to produce vectors at all.
 * Running locally also means no key to manage, no per-token cost, and no
 * customer schema or values leaving our infrastructure.
 *
 * Measured on all-MiniLM-L6-v2 (q8): ~290 ms to load a baked-in model, ~3 ms
 * for a single short question, ~20 ms for a batch of four.
 *
 * Every failure mode degrades to "no embeddings" rather than an error. A model
 * that will not load must never take chat down; retrieval is an enhancement,
 * not a dependency.
 */

export const EMBEDDING_DIMENSION = 384;

type FeatureExtractor = (
  texts: string[],
  options: { pooling: 'mean'; normalize: boolean },
) => Promise<{ data: ArrayLike<number>; dims: number[] }>;

@Injectable()
export class EmbeddingService implements OnModuleInit {
  private readonly logger = new Logger(EmbeddingService.name);

  readonly dimension = EMBEDDING_DIMENSION;
  readonly modelId = process.env.EMBEDDING_MODEL_ID ?? 'Xenova/all-MiniLM-L6-v2';

  private readonly enabled =
    (process.env.EMBEDDING_ENABLED ?? 'true').toLowerCase() !== 'false';

  private extractor: FeatureExtractor | null = null;
  private loadPromise: Promise<FeatureExtractor | null> | null = null;
  private loadFailed = false;

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.log('Embeddings disabled (EMBEDDING_ENABLED=false)');
      return;
    }

    // Warm in the background. Boot is not blocked, and by the time a real
    // question arrives the model is usually resident.
    void this.ensureLoaded();
  }

  isReady(): boolean {
    return this.extractor !== null;
  }

  /**
   * Embeds a question for retrieval. Never throws and never rejects: a
   * retrieval miss is a worse answer, an exception is a broken conversation.
   */
  async embedQuery(text: string): Promise<Float32Array | null> {
    try {
      if (!text?.trim()) {
        return null;
      }
      const [vector] = await this.embedMany([text]);
      return vector ?? null;
    } catch (error) {
      this.logger.warn(
        `Query embedding failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /**
   * Embeds one text. Throws if the model is unavailable — used by indexing
   * jobs, which should fail loudly rather than silently write nothing.
   */
  async embedOne(text: string): Promise<Float32Array> {
    const [vector] = await this.embedMany([text]);
    if (!vector) {
      throw new Error('Embedding produced no vector');
    }
    return vector;
  }

  async embedMany(
    texts: string[],
    batchSize = 64,
  ): Promise<Float32Array[]> {
    if (texts.length === 0) {
      return [];
    }

    const extractor = await this.ensureLoaded();
    if (!extractor) {
      throw new Error(`Embedding model ${this.modelId} is unavailable`);
    }

    const vectors: Float32Array[] = [];

    for (let start = 0; start < texts.length; start += batchSize) {
      const batch = texts
        .slice(start, start + batchSize)
        // The model truncates at its own max length anyway; clamping here keeps
        // a pathological input from dominating a batch.
        .map((text) => text.slice(0, 2000));

      const output = await extractor(batch, {
        pooling: 'mean',
        normalize: true,
      });

      const dim = output.dims[output.dims.length - 1];
      for (let i = 0; i < batch.length; i += 1) {
        const vector = new Float32Array(dim);
        for (let d = 0; d < dim; d += 1) {
          vector[d] = output.data[i * dim + d];
        }
        // The pipeline already normalizes; this makes the invariant that
        // scoring depends on true regardless of pipeline options.
        vectors.push(l2Normalize(vector));
      }
    }

    return vectors;
  }

  private ensureLoaded(): Promise<FeatureExtractor | null> {
    if (!this.enabled || this.loadFailed) {
      return Promise.resolve(null);
    }
    if (this.extractor) {
      return Promise.resolve(this.extractor);
    }
    if (this.loadPromise) {
      return this.loadPromise;
    }

    this.loadPromise = this.loadModel();
    return this.loadPromise;
  }

  private async loadModel(): Promise<FeatureExtractor | null> {
    const startedAt = Date.now();

    try {
      const transformers = (await import(
        '@huggingface/transformers'
      )) as unknown as {
        pipeline: (
          task: string,
          model: string,
          options?: Record<string, unknown>,
        ) => Promise<FeatureExtractor>;
        env: Record<string, unknown>;
      };

      const localPath = process.env.EMBEDDING_MODEL_PATH;
      if (localPath) {
        // Production serves the model baked into the image. Without this the
        // library would reach out to huggingface.co on first use, which is a
        // cold-start hazard and a silent egress of nothing-in-particular.
        transformers.env.localModelPath = localPath;
        transformers.env.allowRemoteModels = false;
        transformers.env.allowLocalModels = true;
      }

      const extractor = await transformers.pipeline(
        'feature-extraction',
        this.modelId,
        { dtype: 'q8' },
      );

      this.extractor = extractor;
      this.logger.log(
        `Embedding model ${this.modelId} ready in ${Date.now() - startedAt}ms (dim ${this.dimension})`,
      );
      return extractor;
    } catch (error) {
      this.loadFailed = true;
      this.loadPromise = null;
      this.logger.error(
        `Embedding model ${this.modelId} failed to load; retrieval will be lexical only. ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }
}
