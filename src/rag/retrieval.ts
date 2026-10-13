import type { FaqItem } from '../data/faqSchema';

export type RetrievedFaq = FaqItem & { similarity: number };

export type RetrievalDecision =
  { kind: 'NO_MATCH'; best: RetrievedFaq | undefined } | { kind: 'MATCH'; context: RetrievedFaq[] };

export type RetrievalThresholds = {
  /** Below this cosine similarity the best hit is treated as unrelated. */
  minSimilarity: number;
  /** Extra hits are kept only if they are within this distance of the best hit. */
  maxGapFromBest: number;
  maxContextItems: number;
};

// Tuned for all-MiniLM-L6-v2 cosine similarity on short FAQ text.
export const DEFAULT_THRESHOLDS: RetrievalThresholds = {
  minSimilarity: 0.45,
  maxGapFromBest: 0.12,
  maxContextItems: 3,
};

/**
 * Decide what (if anything) goes into the LLM prompt. A tiny model hallucinates freely,
 * so we refuse to answer when nothing in the FAQ is close enough.
 */
export function selectContext(
  hits: readonly RetrievedFaq[],
  thresholds: RetrievalThresholds = DEFAULT_THRESHOLDS,
): RetrievalDecision {
  const sorted = [...hits].sort((a, b) => b.similarity - a.similarity);
  const best = sorted[0];
  if (!best || best.similarity < thresholds.minSimilarity) {
    return { kind: 'NO_MATCH', best };
  }
  const context = sorted
    .filter(
      (h) =>
        h.similarity >= thresholds.minSimilarity &&
        best.similarity - h.similarity <= thresholds.maxGapFromBest,
    )
    .slice(0, thresholds.maxContextItems);
  return { kind: 'MATCH', context };
}
