import { describe, expect, it } from 'vitest';

import { blobToFloat32, cosineSimilarity, l2Normalize, topKBySimilarity } from './vector';

describe('cosineSimilarity', () => {
  it.each([
    { a: [1, 0], b: [1, 0], expected: 1 },
    { a: [1, 0], b: [0, 1], expected: 0 },
    { a: [1, 0], b: [-1, 0], expected: -1 },
    { a: [3, 4], b: [6, 8], expected: 1 },
    { a: [0, 0], b: [1, 1], expected: 0 },
  ])('cos($a, $b) = $expected', ({ a, b, expected }) => {
    expect(cosineSimilarity(Float32Array.from(a), Float32Array.from(b))).toBeCloseTo(expected, 6);
  });

  it('rejects vectors of different length', () => {
    expect(() => cosineSimilarity(new Float32Array(2), new Float32Array(3))).toThrow(/mismatch/);
  });
});

describe('l2Normalize', () => {
  it('produces a unit vector', () => {
    const v = l2Normalize(Float32Array.from([3, 4]));
    expect(Array.from(v)).toEqual([expect.closeTo(0.6, 6), expect.closeTo(0.8, 6)]);
  });
});

describe('blobToFloat32', () => {
  it('round-trips a Float32Array through an ArrayBuffer', () => {
    const original = Float32Array.from([0.25, -1.5, 3]);
    expect(Array.from(blobToFloat32(original.buffer))).toEqual([0.25, -1.5, 3]);
  });
});

describe('topKBySimilarity', () => {
  it('returns the k most similar ids, best first', () => {
    const q = Float32Array.from([1, 0]);
    const candidates = [
      { id: 1, vector: Float32Array.from([0, 1]) },
      { id: 2, vector: Float32Array.from([1, 0.1]) },
      { id: 3, vector: Float32Array.from([1, 1]) },
    ];
    expect(topKBySimilarity(q, candidates, 2).map((s) => s.id)).toEqual([2, 3]);
  });
});
