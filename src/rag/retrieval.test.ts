import { describe, expect, it } from 'vitest';

import { DEFAULT_THRESHOLDS, selectContext, type RetrievedFaq } from './retrieval';

function hit(id: number, similarity: number): RetrievedFaq {
  return { id, similarity, category: 'c', question: `q${id}`, answer: `a${id}` };
}

describe('selectContext', () => {
  it('returns NO_MATCH when there are no hits', () => {
    expect(selectContext([])).toEqual({ kind: 'NO_MATCH', best: undefined });
  });

  it.each([
    { best: DEFAULT_THRESHOLDS.minSimilarity - 0.01, kind: 'NO_MATCH' },
    { best: DEFAULT_THRESHOLDS.minSimilarity, kind: 'MATCH' },
    { best: 0.9, kind: 'MATCH' },
  ])('best similarity $best -> $kind', ({ best, kind }) => {
    expect(selectContext([hit(1, best)]).kind).toBe(kind);
  });

  it('keeps only hits close to the best one, sorted, capped at maxContextItems', () => {
    const decision = selectContext([
      hit(1, 0.6),
      hit(2, 0.8),
      hit(3, 0.75),
      hit(4, 0.7),
      hit(5, 0.69),
      hit(6, 0.5),
    ]);
    expect(decision.kind).toBe('MATCH');
    if (decision.kind === 'MATCH') {
      expect(decision.context.map((h) => h.id)).toEqual([2, 3, 4]);
    }
  });

  it('drops a hit exactly past the allowed gap', () => {
    const decision = selectContext([
      hit(1, 0.8),
      hit(2, 0.8 - DEFAULT_THRESHOLDS.maxGapFromBest - 0.001),
    ]);
    expect(decision.kind === 'MATCH' && decision.context.map((h) => h.id)).toEqual([1]);
  });
});
