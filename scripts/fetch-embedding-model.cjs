/**
 * Downloads the embedding model into the local cache at image-build time.
 *
 * Without this, transformers.js fetches from huggingface.co on first use. In a
 * container that means a multi-second stall on the first question after every
 * deploy, an outbound dependency on a third party at runtime, and a write into
 * a directory the `node` user may not own.
 *
 * Run during `docker build`; the resulting cache is copied into the runtime
 * image and served via EMBEDDING_MODEL_PATH.
 */
const MODEL_ID = process.env.EMBEDDING_MODEL_ID || 'Xenova/all-MiniLM-L6-v2';

async function main() {
  const { pipeline } = require('@huggingface/transformers');

  console.log(`Fetching embedding model ${MODEL_ID}...`);
  const started = Date.now();

  const extractor = await pipeline('feature-extraction', MODEL_ID, {
    dtype: 'q8',
  });

  // Exercise it once so a broken download fails the build rather than the
  // first production request.
  const output = await extractor(['warmup'], {
    pooling: 'mean',
    normalize: true,
  });

  const dim = output.dims[output.dims.length - 1];
  if (dim !== 384) {
    throw new Error(`Expected a 384-dim model, got ${dim}`);
  }

  console.log(`Model ready (dim ${dim}) in ${Date.now() - started}ms`);
}

main().catch((error) => {
  console.error('Failed to fetch embedding model:', error);
  process.exit(1);
});
