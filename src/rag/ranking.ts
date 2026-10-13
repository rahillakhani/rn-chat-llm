import type { Lang } from '../i18n/lang';
import { keywordOverlap, keywordStems, type LexicalIndex } from './lexical';

/** One stored text's cosine similarity to the query, from the SQLite vector search. */
export type VectorHit = { faqId: number; lang: Lang; similarity: number };

export type RankedFaq = {
  faqId: number;
  /** similarity + keywordWeight * keyword */
  score: number;
  /** Best cosine similarity among this FAQ's texts (any language). */
  similarity: number;
  /** Keyword overlap 0..1. */
  keyword: number;
};

export type MatchDecision =
  | { kind: 'NO_MATCH' }
  /** Not confident enough to answer, but close: offer the top questions to pick from. */
  | { kind: 'SUGGEST'; options: RankedFaq[] }
  | { kind: 'MATCH'; best: RankedFaq; related: RankedFaq[] };

export type MatchSettings = {
  keywordWeight: number;
  /** At or above this combined score the best FAQ is answered. */
  minScore: number;
  /** Between this and minScore, the top questions are offered instead of an answer. */
  suggestMinScore: number;
  maxSuggestions: number;
  /** Other FAQs scoring within this distance of the best are offered as "Did you mean…". */
  relatedMargin: number;
  maxRelated: number;
};

// Tuned on src/rag/__fixtures__/retrieval-eval.json (104 EN/ES questions + 16 off-topic) with
// paraphrase-multilingual-MiniLM-L12-v2 Q4_K_M: top-1 90.4%, right FAQ answered or offered 97.1%,
// 88.3% fully correct including off-topic rejection (2 of 16 off-topic questions get suggestions
// instead of "not found"). Re-run `npm run eval:retrieval` after changing any of these.
export const DEFAULT_MATCH_SETTINGS: MatchSettings = {
  keywordWeight: 0.3,
  minScore: 0.56,
  suggestMinScore: 0.5,
  maxSuggestions: 3,
  relatedMargin: 0.08,
  maxRelated: 2,
};

/** Group text-level hits by FAQ (max similarity) and add the keyword score. Best first. */
export function rankFaqs(
  hits: readonly VectorHit[],
  lexical: LexicalIndex,
  query: string,
  keywordWeight: number,
): RankedFaq[] {
  const bestSimilarity = new Map<number, number>();
  for (const h of hits) {
    bestSimilarity.set(h.faqId, Math.max(bestSimilarity.get(h.faqId) ?? -1, h.similarity));
  }
  const stems = keywordStems(query);
  return [...bestSimilarity]
    .map(([faqId, similarity]) => {
      const keyword = keywordOverlap(lexical, stems, faqId);
      return { faqId, similarity, keyword, score: similarity + keywordWeight * keyword };
    })
    .sort((a, b) => b.score - a.score);
}

export function selectMatch(
  ranked: readonly RankedFaq[],
  settings: MatchSettings = DEFAULT_MATCH_SETTINGS,
): MatchDecision {
  const [best, ...rest] = ranked;
  if (!best || best.score < settings.suggestMinScore) return { kind: 'NO_MATCH' };
  if (best.score < settings.minScore) {
    return { kind: 'SUGGEST', options: ranked.slice(0, settings.maxSuggestions) };
  }
  const related = rest
    .filter((r) => best.score - r.score <= settings.relatedMargin)
    .slice(0, settings.maxRelated);
  return { kind: 'MATCH', best, related };
}
