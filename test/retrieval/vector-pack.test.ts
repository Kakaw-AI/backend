import { describe, expect, it } from 'vitest';
import {
  cosineTopK,
  cosineTopKChunked,
  dot,
  l2Normalize,
  packVectors,
  unpackVectors,
} from '../../src/retrieval/vector-pack';

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

describe('pack / unpack', () => {
  it('round-trips vectors exactly', () => {
    const vectors = [vec(1, 2, 3), vec(-4, 5.5, 6.25), vec(0, 0, 0)];
    const pack = unpackVectors(packVectors(vectors, 3));

    expect(pack.dim).toBe(3);
    expect(pack.count).toBe(3);
    expect(pack.dtype).toBe('f32');
    // float32 is exact for these values, so equality is the right assertion.
    expect([...pack.data]).toEqual([1, 2, 3, -4, 5.5, 6.25, 0, 0, 0]);
  });

  it('handles an empty pack', () => {
    const pack = unpackVectors(packVectors([], 384));
    expect(pack.count).toBe(0);
    expect(pack.data.length).toBe(0);
  });

  it('survives an unaligned buffer', () => {
    // Buffers sliced out of Node's pool can start at any byteOffset; viewing
    // the payload directly would throw unless the offset happens to be a
    // multiple of 4.
    const packed = packVectors([vec(1, 2), vec(3, 4)], 2);
    const padded = Buffer.alloc(packed.length + 1);
    packed.copy(padded, 1);
    const unaligned = padded.subarray(1);

    expect([...unpackVectors(unaligned).data]).toEqual([1, 2, 3, 4]);
  });

  it('rejects a vector whose length disagrees with the declared dim', () => {
    expect(() => packVectors([vec(1, 2, 3)], 4)).toThrow(/does not match/);
  });

  it('rejects a truncated pack rather than reading past the end', () => {
    const packed = packVectors([vec(1, 2), vec(3, 4)], 2);
    expect(() => unpackVectors(packed.subarray(0, packed.length - 4))).toThrow(
      /truncated/,
    );
  });

  it('rejects an unknown version', () => {
    const packed = packVectors([vec(1, 2)], 2);
    packed.writeUInt32LE(99, 0);
    expect(() => unpackVectors(packed)).toThrow(/version/);
  });
});

describe('cosineTopK', () => {
  const vectors = [
    l2Normalize(vec(1, 0, 0)),
    l2Normalize(vec(0.9, 0.1, 0)),
    l2Normalize(vec(0, 1, 0)),
    l2Normalize(vec(-1, 0, 0)),
  ];
  const pack = unpackVectors(packVectors(vectors, 3));
  const query = l2Normalize(vec(1, 0, 0));

  it('ranks by similarity', () => {
    const results = cosineTopK(query, pack, 2);
    expect(results.map((r) => r.index)).toEqual([0, 1]);
    expect(results[0].score).toBeCloseTo(1, 5);
  });

  it('applies the floor', () => {
    const results = cosineTopK(query, pack, 10, 0.5);
    // The orthogonal and opposite vectors score 0 and -1.
    expect(results.map((r) => r.index)).toEqual([0, 1]);
  });

  it('rejects a query of the wrong dimension', () => {
    expect(() => cosineTopK(vec(1, 0), pack, 1)).toThrow(/dim/);
  });

  it('agrees with the chunked variant, including across chunk boundaries', async () => {
    const many = Array.from({ length: 50 }, (_, i) =>
      l2Normalize(vec(1, i / 50, 0)),
    );
    const bigPack = unpackVectors(packVectors(many, 3));

    const sync = cosineTopK(query, bigPack, 5);
    const chunked = await cosineTopKChunked(query, bigPack, 5, 0, 7);

    expect(chunked).toEqual(sync);
  });
});
