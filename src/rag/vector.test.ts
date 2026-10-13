import { describe, expect, it } from 'vitest';

import { blobToFloat32, cosineSimilarity } from './vector';

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

describe('blobToFloat32', () => {
  it('round-trips a Float32Array through an ArrayBuffer', () => {
    const original = Float32Array.from([0.25, -1.5, 3]);
    expect(Array.from(blobToFloat32(original.buffer))).toEqual([0.25, -1.5, 3]);
  });
});
