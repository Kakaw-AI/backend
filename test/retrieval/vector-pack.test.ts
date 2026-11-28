import { describe, expect, it } from 'vitest';
import { dot, l2Normalize } from '../../src/retrieval/vector-pack';

function vec(...values: number[]): Float32Array {
  return new Float32Array(values);
}

describe('l2Normalize', () => {
  it('scales to unit length', () => {
    const normalized = l2Normalize(vec(3, 4));
    expect(normalized[0]).toBeCloseTo(0.6, 6);
    expect(normalized[1]).toBeCloseTo(0.8, 6);
    expect(dot(normalized, normalized)).toBeCloseTo(1, 6);
  });

  it('leaves a zero vector alone rather than producing NaN', () => {
    expect([...l2Normalize(vec(0, 0, 0))]).toEqual([0, 0, 0]);
  });
});
