import { beforeAll, describe, expect, it } from 'vitest';
import { EmbeddingService } from '../../src/retrieval/embedding.service';
import { dot } from '../../src/retrieval/vector-pack';

/**
 * Loads the real model. Warm (weights already in the local cache) this is
 * ~300ms, so it stays in the normal suite rather than behind a flag — the
 * numbers it pins are the basis for the retrieval thresholds and are worth
 * catching a regression on.
 */
describe('EmbeddingService', () => {
  const service = new EmbeddingService();

  beforeAll(async () => {
    await service.embedQuery('warmup');
  }, 120_000);

  it('loads and reports the expected geometry', async () => {
    expect(service.isReady()).toBe(true);

    const vector = await service.embedQuery('total revenue by region');
    expect(vector).not.toBeNull();
    expect(vector!.length).toBe(384);
    expect(service.dimension).toBe(384);
    // Scoring treats cosine as a plain dot product, which is only valid if
    // vectors are unit length.
    expect(dot(vector!, vector!)).toBeCloseTo(1, 4);
  });

  it('separates paraphrases from unrelated questions', async () => {
    const [paraphraseA, paraphraseB, otherQuestion, unrelated] =
      await service.embedMany([
        'which customers spent the most last quarter',
        'top customers by total spend in Q4',
        'how many orders are pending',
        'what is the capital of France',
      ]);

    const paraphrase = dot(paraphraseA, paraphraseB);
    const sameDomain = dot(paraphraseA, otherQuestion);
    const noRelation = dot(paraphraseA, unrelated);

    // Measured ~0.68 / ~0.22 / ~0.00. The retrieval floor of 0.60 sits between
    // the first two, which is the whole reason it is set there.
    expect(paraphrase).toBeGreaterThan(0.6);
    expect(sameDomain).toBeLessThan(0.5);
    expect(noRelation).toBeLessThan(0.3);
    expect(paraphrase).toBeGreaterThan(sameDomain);
  });

  it('scores questions differing only by a literal as near-identical', async () => {
    const [y2024, y2023] = await service.embedMany([
      'revenue in 2024',
      'revenue in 2023',
    ]);

    // ~0.89. This is why similarity must never short-circuit SQL reuse: these
    // are different questions with the same shape, and reusing one query for
    // the other returns confidently wrong data with no error. Only an exact
    // question match may skip generation.
    expect(dot(y2024, y2023)).toBeGreaterThan(0.8);
  });

  it('is deterministic', async () => {
    const first = await service.embedQuery('total revenue by region');
    const second = await service.embedQuery('total revenue by region');
    expect([...first!]).toEqual([...second!]);
  });

  it('never throws from embedQuery', async () => {
    await expect(service.embedQuery('')).resolves.toBeNull();
    await expect(service.embedQuery('   ')).resolves.toBeNull();
    await expect(
      service.embedQuery('x'.repeat(50_000)),
    ).resolves.not.toBeNull();
  });

  it('returns an empty array for no input rather than loading anything', async () => {
    await expect(service.embedMany([])).resolves.toEqual([]);
  });
});

describe('EmbeddingService when disabled', () => {
  it('degrades to null instead of failing', async () => {
    process.env.EMBEDDING_ENABLED = 'false';
    const disabled = new EmbeddingService();
    disabled.onModuleInit();

    expect(disabled.isReady()).toBe(false);
    await expect(disabled.embedQuery('anything')).resolves.toBeNull();
    // The strict path still reports the problem, so indexing jobs fail loudly.
    await expect(disabled.embedOne('anything')).rejects.toThrow(/unavailable/);

    delete process.env.EMBEDDING_ENABLED;
  });
});
