/**
 * Packing and scoring for embedding vectors.
 *
 * Vectors for one data source live as a single contiguous blob rather than a
 * row per vector. A wide schema produces tens of thousands of vectors, and
 * materializing that many Prisma rows per request costs far more than the
 * arithmetic does — one blob fetch plus an in-process cache is the whole point.
 *
 * All vectors are stored L2-normalized, so cosine similarity is a plain dot
 * product and scoring is one multiply-add per dimension.
 */

/** Bytes before the payload. 16 rather than 13 so the floats stay 4-byte aligned. */
const HEADER_BYTES = 16;
const PACK_VERSION = 1;

const DTYPE_F32 = 1;

export type VectorPackDtype = 'f32';

export type VectorPack = {
  version: number;
  dim: number;
  count: number;
  dtype: VectorPackDtype;
  /** `count * dim` floats, vector i occupying [i*dim, (i+1)*dim). */
  data: Float32Array;
};

export type ScoredIndex = {
  index: number;
  score: number;
};

/** Scales a vector to unit length in place; a zero vector is left alone. */
export function l2Normalize(vector: Float32Array): Float32Array {
  let sumSquares = 0;
  for (let i = 0; i < vector.length; i += 1) {
    sumSquares += vector[i] * vector[i];
  }

  if (sumSquares === 0) {
    return vector;
  }

  const inverse = 1 / Math.sqrt(sumSquares);
  for (let i = 0; i < vector.length; i += 1) {
    vector[i] *= inverse;
  }
  return vector;
}

export function packVectors(
  vectors: ReadonlyArray<Float32Array>,
  dim: number,
): Buffer {
  for (const vector of vectors) {
    if (vector.length !== dim) {
      throw new Error(
        `Vector length ${vector.length} does not match declared dim ${dim}`,
      );
    }
  }

  const buffer = Buffer.allocUnsafe(HEADER_BYTES + vectors.length * dim * 4);
  buffer.writeUInt32LE(PACK_VERSION, 0);
  buffer.writeUInt32LE(dim, 4);
  buffer.writeUInt32LE(vectors.length, 8);
  buffer.writeUInt8(DTYPE_F32, 12);
  buffer.writeUInt8(0, 13);
  buffer.writeUInt16LE(0, 14);

  for (let i = 0; i < vectors.length; i += 1) {
    Buffer.from(
      vectors[i].buffer,
      vectors[i].byteOffset,
      vectors[i].byteLength,
    ).copy(buffer, HEADER_BYTES + i * dim * 4);
  }

  return buffer;
}

export function unpackVectors(buffer: Buffer): VectorPack {
  if (buffer.length < HEADER_BYTES) {
    throw new Error('Vector pack is shorter than its header');
  }

  const version = buffer.readUInt32LE(0);
  if (version !== PACK_VERSION) {
    throw new Error(`Unsupported vector pack version ${version}`);
  }

  const dim = buffer.readUInt32LE(4);
  const count = buffer.readUInt32LE(8);
  const dtype = buffer.readUInt8(12);
  if (dtype !== DTYPE_F32) {
    throw new Error(`Unsupported vector pack dtype ${dtype}`);
  }

  const expectedBytes = HEADER_BYTES + count * dim * 4;
  if (buffer.length < expectedBytes) {
    throw new Error(
      `Vector pack is truncated: expected ${expectedBytes} bytes, got ${buffer.length}`,
    );
  }

  const payloadOffset = buffer.byteOffset + HEADER_BYTES;
  const floatCount = count * dim;

  // A Buffer from Node's internal pool can start at any byteOffset, so the
  // payload is not guaranteed to be 4-byte aligned. Viewing it directly would
  // throw; copy when that happens rather than gambling on the allocator.
  const data =
    payloadOffset % 4 === 0
      ? new Float32Array(buffer.buffer, payloadOffset, floatCount)
      : new Float32Array(
          buffer.buffer.slice(payloadOffset, payloadOffset + floatCount * 4),
        );

  return { version, dim, count, dtype: 'f32', data };
}

/**
 * Highest-scoring vectors against a normalized query.
 *
 * Synchronous, so it blocks for the duration. At ~30-50 ms for a very large
 * schema that is long enough to matter under concurrency — prefer
 * `cosineTopKChunked` on request paths.
 */
export function cosineTopK(
  query: Float32Array,
  pack: VectorPack,
  k: number,
  floor = 0,
): ScoredIndex[] {
  if (query.length !== pack.dim) {
    throw new Error(
      `Query dim ${query.length} does not match pack dim ${pack.dim}`,
    );
  }

  const results: ScoredIndex[] = [];
  scoreRange(query, pack, 0, pack.count, floor, results);
  return topK(results, k);
}

/**
 * Same scoring, yielding to the event loop periodically so a large scan cannot
 * stall other requests.
 */
export async function cosineTopKChunked(
  query: Float32Array,
  pack: VectorPack,
  k: number,
  floor = 0,
  chunkSize = 4096,
): Promise<ScoredIndex[]> {
  if (query.length !== pack.dim) {
    throw new Error(
      `Query dim ${query.length} does not match pack dim ${pack.dim}`,
    );
  }

  const results: ScoredIndex[] = [];

  for (let start = 0; start < pack.count; start += chunkSize) {
    const end = Math.min(start + chunkSize, pack.count);
    scoreRange(query, pack, start, end, floor, results);

    if (end < pack.count) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }

  return topK(results, k);
}

function scoreRange(
  query: Float32Array,
  pack: VectorPack,
  start: number,
  end: number,
  floor: number,
  out: ScoredIndex[],
): void {
  const { data, dim } = pack;

  for (let index = start; index < end; index += 1) {
    const base = index * dim;
    let score = 0;
    for (let d = 0; d < dim; d += 1) {
      score += query[d] * data[base + d];
    }
    if (score >= floor) {
      out.push({ index, score });
    }
  }
}

function topK(results: ScoredIndex[], k: number): ScoredIndex[] {
  results.sort((left, right) => right.score - left.score);
  return k > 0 ? results.slice(0, k) : results;
}

/** Cosine similarity between two already-normalized vectors. */
export function dot(left: Float32Array, right: Float32Array): number {
  let score = 0;
  for (let i = 0; i < left.length; i += 1) {
    score += left[i] * right[i];
  }
  return score;
}
