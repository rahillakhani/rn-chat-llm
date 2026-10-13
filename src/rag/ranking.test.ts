import { describe, expect, it } from 'vitest';

import { buildLexicalIndex } from './lexical';
import { DEFAULT_MATCH_SETTINGS, rankFaqs, selectMatch, type RankedFaq } from './ranking';

const lexical = buildLexicalIndex([
  { faqId: 1, lang: 'en', text: 'Where can I find my invoice?' },
  { faqId: 2, lang: 'en', text: 'How do I track my order?' },
  { faqId: 2, lang: 'es', text: '¿Cómo sigo mi pedido?' },
]);

function ranked(faqId: number, score: number): RankedFaq {
  return { faqId, score, similarity: score, keyword: 0 };
}

describe('rankFaqs', () => {
  it('keeps the best similarity per FAQ across its texts and languages', () => {
    const result = rankFaqs(
      [
        { faqId: 2, lang: 'en', similarity: 0.4 },
        { faqId: 2, lang: 'es', similarity: 0.7 },
        { faqId: 1, lang: 'en', similarity: 0.5 },
      ],
      lexical,
      'xyz',
      0,
    );
    expect(result.map((r) => [r.faqId, r.similarity])).toEqual([
      [2, 0.7],
      [1, 0.5],
    ]);
  });

  it('lets a keyword match lift an FAQ above a slightly closer vector match', () => {
    const result = rankFaqs(
      [
        { faqId: 2, lang: 'en', similarity: 0.6 },
        { faqId: 1, lang: 'en', similarity: 0.55 },
      ],
      lexical,
      'download invoice',
      0.3,
    );
    expect(result[0]?.faqId).toBe(1);
    expect(result[0]?.keyword).toBeGreaterThan(0);
  });

  it('matches keywords regardless of accents', () => {
    const result = rankFaqs([{ faqId: 2, lang: 'es', similarity: 0 }], lexical, 'PEDIDO', 1);
    expect(result[0]?.keyword).toBe(1);
  });
});

describe('selectMatch', () => {
  const { minScore, suggestMinScore, relatedMargin, maxSuggestions } = DEFAULT_MATCH_SETTINGS;

  it('returns NO_MATCH with no candidates', () => {
    expect(selectMatch([])).toEqual({ kind: 'NO_MATCH' });
  });

  it.each([
    { best: suggestMinScore - 0.001, kind: 'NO_MATCH' },
    { best: suggestMinScore, kind: 'SUGGEST' },
    { best: minScore - 0.001, kind: 'SUGGEST' },
    { best: minScore, kind: 'MATCH' },
  ])('best score $best -> $kind', ({ best, kind }) => {
    expect(selectMatch([ranked(1, best)]).kind).toBe(kind);
  });

  it('offers the top questions when not confident enough to answer', () => {
    const scores = [0.53, 0.52, 0.4, 0.3];
    const decision = selectMatch(scores.map((sc, i) => ranked(i + 1, sc)));
    expect(decision.kind === 'SUGGEST' && decision.options.map((o) => o.faqId)).toEqual(
      [1, 2, 3, 4].slice(0, maxSuggestions),
    );
  });

  it('offers close runners-up as related questions, capped at maxRelated', () => {
    const decision = selectMatch([
      ranked(1, 0.9),
      ranked(2, 0.9 - relatedMargin),
      ranked(3, 0.85),
      ranked(4, 0.9 - relatedMargin - 0.001),
    ]);
    expect(decision.kind === 'MATCH' && decision.related.map((r) => r.faqId)).toEqual([2, 3]);
  });
});
