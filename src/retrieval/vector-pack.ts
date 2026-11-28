/**
 * Vector math for embeddings. Every vector is stored L2-normalized, so cosine
 * similarity is a plain dot product.
 */

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

/** Cosine similarity between two already-normalized vectors. */
export function dot(left: Float32Array, right: Float32Array): number {
  let score = 0;
  for (let i = 0; i < left.length; i += 1) {
    score += left[i] * right[i];
  }
  return score;
}
