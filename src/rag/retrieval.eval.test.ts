import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import faqJson from '../data/faq.json';
import { FaqDatasetSchema, searchTexts } from '../data/faqSchema';
import type { Lang } from '../i18n/lang';
import evalJson from './__fixtures__/retrieval-eval.json';
import { buildLanguageVocabulary, detectLanguage, languageFromHits } from './language';
import { buildLexicalIndex } from './lexical';
import { DEFAULT_MATCH_SETTINGS, rankFaqs, selectMatch, type VectorHit } from './ranking';
import { cosineSimilarity } from './vector';

// Live accuracy check of the real matching pipeline against the real embedding model.
// Skipped unless LIVE_EMBEDDINGS_URL points at a llama.cpp server running the app's embedding model:
//   llama-server -m paraphrase-multilingual-MiniLM-L12-118M-v2-Q4_K_M.gguf --embeddings --pooling mean --port 8080
//   LIVE_EMBEDDINGS_URL=http://localhost:8080 npm run eval:retrieval

const BASE_URL = process.env.LIVE_EMBEDDINGS_URL;

const EvalSchema = z.object({
  cases: z.array(
    z.object({ query: z.string(), lang: z.enum(['en', 'es']), expectedId: z.number().nullable() }),
  ),
});
const EmbeddingResponseSchema = z.union([
  z.array(z.object({ embedding: z.union([z.array(z.number()), z.array(z.array(z.number()))]) })),
  z.object({ embedding: z.array(z.number()) }),
]);

async function embed(text: string): Promise<Float32Array> {
  const res = await fetch(`${BASE_URL}/embedding`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: text }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = EmbeddingResponseSchema.parse(await res.json());
  const raw = Array.isArray(body) ? body[0]?.embedding : body.embedding;
  const vector = Array.isArray(raw?.[0]) ? raw[0] : raw;
  return Float32Array.from(z.array(z.number()).parse(vector));
}

describe.skipIf(!BASE_URL)('retrieval accuracy (live embeddings)', () => {
  it('meets the measured accuracy on the held-out EN/ES eval set', async () => {
    const dataset = FaqDatasetSchema.parse(faqJson);
    const { cases } = EvalSchema.parse(evalJson);
    const texts = dataset.items.flatMap(searchTexts);
    const vectors = await Promise.all(texts.map((t) => embed(t.text)));
    const lexical = buildLexicalIndex(texts);
    const vocabulary = buildLanguageVocabulary(texts);

    let top1 = 0;
    let answeredOrSuggested = 0;
    let overall = 0;
    let langOk = 0;
    let offTopicSuggested = 0;
    // Per language: how often each outcome happens and how many extra questions are offered.
    const outcomes: Record<
      Lang,
      { MATCH: number; SUGGEST: number; NO_MATCH: number; extraButtons: number }
    > = {
      en: { MATCH: 0, SUGGEST: 0, NO_MATCH: 0, extraButtons: 0 },
      es: { MATCH: 0, SUGGEST: 0, NO_MATCH: 0, extraButtons: 0 },
    };
    const misses: string[] = [];
    for (const c of cases) {
      const q = await embed(c.query);
      const hits: VectorHit[] = texts.map((t, i) => ({
        faqId: t.faqId,
        lang: t.lang,
        similarity: cosineSimilarity(q, vectors[i] ?? new Float32Array(q.length)),
      }));
      const ranked = rankFaqs(hits, lexical, c.query, DEFAULT_MATCH_SETTINGS.keywordWeight);
      const decision = selectMatch(ranked);
      const top = ranked[0];
      // Same order as the app; 'en' stands in for the UI language.
      const lang: Lang =
        detectLanguage(c.query, vocabulary) ??
        (top ? languageFromHits(hits, top.faqId) : undefined) ??
        'en';
      if (lang === c.lang) langOk++;
      if (c.expectedId !== null) {
        outcomes[c.lang][decision.kind]++;
        outcomes[c.lang].extraButtons +=
          decision.kind === 'MATCH'
            ? decision.related.length
            : decision.kind === 'SUGGEST'
              ? decision.options.length
              : 0;
      }

      if (c.expectedId === null) {
        if (decision.kind === 'NO_MATCH') overall++;
        else if (decision.kind === 'SUGGEST') offTopicSuggested++;
        else misses.push(`[${c.lang}] off-topic "${c.query}" matched ${decision.best.faqId}`);
        continue;
      }
      if (ranked[0]?.faqId === c.expectedId) top1++;
      if (decision.kind === 'MATCH') {
        const ok = decision.best.faqId === c.expectedId;
        if (ok) overall++;
        if (ok || decision.related.some((r) => r.faqId === c.expectedId)) answeredOrSuggested++;
        else
          misses.push(`[${c.lang}] "${c.query}" -> ${decision.best.faqId}, want ${c.expectedId}`);
      } else if (decision.kind === 'SUGGEST') {
        if (decision.options.some((o) => o.faqId === c.expectedId)) answeredOrSuggested++;
        else misses.push(`[${c.lang}] "${c.query}" -> suggestions without ${c.expectedId}`);
      } else {
        misses.push(`[${c.lang}] "${c.query}" -> no match, want ${c.expectedId}`);
      }
    }
    const inDomain = cases.filter((c) => c.expectedId !== null).length;
    const report = {
      top1: top1 / inDomain,
      answeredOrSuggested: answeredOrSuggested / inDomain,
      overall: overall / cases.length,
      language: langOk / cases.length,
      offTopicGivenSuggestions: offTopicSuggested / (cases.length - inDomain),
      outcomesByLanguage: outcomes,
    };
    console.log(JSON.stringify(report, null, 2), '\nMisses:\n  ' + misses.join('\n  '));

    // Regression floor, a little under what was measured when the settings were tuned.
    expect(report.top1).toBeGreaterThanOrEqual(0.88);
    expect(report.answeredOrSuggested).toBeGreaterThanOrEqual(0.95);
    expect(report.overall).toBeGreaterThanOrEqual(0.86);
    expect(report.language).toBeGreaterThanOrEqual(0.98);
    expect(report.offTopicGivenSuggestions).toBeLessThanOrEqual(0.25);
  }, 120_000);
});
