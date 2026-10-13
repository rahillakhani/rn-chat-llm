// Pure vector helpers. Used to serialize embeddings for SQLite and as the
// brute-force fallback when the sqlite-vec extension is not available.

export function toFloat32(vector: readonly number[]): Float32Array {
  return Float32Array.from(vector);
}

/** Copy a BLOB returned by SQLite into a Float32Array (the source buffer may not be 4-byte aligned). */
export function blobToFloat32(blob: ArrayBuffer): Float32Array {
  return new Float32Array(blob.slice(0));
}

export function l2Normalize(vector: Float32Array): Float32Array {
  let sumSquares = 0;
  for (const v of vector) sumSquares += v * v;
  const norm = Math.sqrt(sumSquares);
  if (norm === 0) return vector;
  return vector.map((v) => v / norm);
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export type ScoredId = { id: number; similarity: number };

export function topKBySimilarity(
  query: Float32Array,
  candidates: readonly { id: number; vector: Float32Array }[],
  k: number,
): ScoredId[] {
  return candidates
    .map((c) => ({ id: c.id, similarity: cosineSimilarity(query, c.vector) }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, k);
}
