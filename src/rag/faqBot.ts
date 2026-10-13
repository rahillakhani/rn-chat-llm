import type { EmbeddingModelSpec } from '../config/models';
import type { FaqDataset, FaqItem } from '../data/faqSchema';
import type { FaqStore } from '../db/faqStore';
import type { Lang } from '../i18n/lang';
import type { Embedder, Generator } from '../llm/engine';
import { detectLanguage } from './language';
import { buildLexicalIndex, type LexicalIndex } from './lexical';
import { buildRagMessages, sanitizeAnswer } from './prompt';
import { DEFAULT_MATCH_SETTINGS, rankFaqs, selectMatch, type MatchSettings } from './ranking';

export type BotDeps = {
  store: FaqStore;
  embedder: Embedder;
  generator: Generator;
  lexical: LexicalIndex;
};

/**
 * 'faq': show the matched FAQ answer exactly as written (both languages).
 * 'llm': English answers are rewritten by the small LLM; Spanish stays FAQ text (the LLM writes poor Spanish).
 */
export type AnswerMode = 'faq' | 'llm';

export type BotAnswer =
  | { kind: 'NO_MATCH'; lang: Lang }
  /** Close but not confident: the user picks from these questions. */
  | { kind: 'SUGGEST'; lang: Lang; options: FaqItem[] }
  | {
      kind: 'ANSWER';
      lang: Lang;
      text: string;
      /** true when the LLM wrote the text, false when it is the FAQ answer word for word. */
      generated: boolean;
      source: FaqItem & { similarity: number };
      /** Other FAQs that scored almost as high: offered as "Did you mean…". */
      related: FaqItem[];
    };

/** Seed the FAQ rows and (re)build vectors when the dataset or embedding model changes. */
export async function prepareIndex(
  store: FaqStore,
  embedder: Embedder,
  dataset: FaqDataset,
  embeddingModel: EmbeddingModelSpec,
  onProgress: (done: number, total: number) => void,
): Promise<LexicalIndex> {
  await store.seed(dataset);
  const texts = await store.searchTexts();
  const signature = { datasetVersion: dataset.version, embeddingModelId: embeddingModel.id };
  if (!(await store.isIndexed(signature))) {
    const rows: { textId: number; vector: Float32Array }[] = [];
    for (const t of texts) {
      rows.push({ textId: t.id, vector: await embedder.embed(t.text) });
      onProgress(rows.length, texts.length);
    }
    await store.replaceEmbeddings(rows, signature);
  }
  return buildLexicalIndex(texts);
}

/**
 * Answer from the FAQ only. The reply language follows the question (falling back to the app
 * language). In 'llm' mode English answers are rephrased by the small LLM; otherwise, and always
 * for Spanish, the FAQ answer is shown word for word.
 */
export async function answerQuestion(
  question: string,
  uiLang: Lang,
  mode: AnswerMode,
  deps: BotDeps,
  onToken: (partial: string) => void,
  settings: MatchSettings = DEFAULT_MATCH_SETTINGS,
): Promise<BotAnswer> {
  const lang = detectLanguage(question) ?? uiLang;
  const hits = await deps.store.search(await deps.embedder.embed(question));
  const decision = selectMatch(
    rankFaqs(hits, deps.lexical, question, settings.keywordWeight),
    settings,
  );
  if (decision.kind === 'NO_MATCH') return { kind: 'NO_MATCH', lang };
  if (decision.kind === 'SUGGEST') {
    const options = await deps.store.getItems(
      decision.options.map((o) => o.faqId),
      lang,
    );
    return { kind: 'SUGGEST', lang, options };
  }

  const [best, ...related] = await deps.store.getItems(
    [decision.best.faqId, ...decision.related.map((r) => r.faqId)],
    lang,
  );
  if (!best) return { kind: 'NO_MATCH', lang };
  const source = { ...best, similarity: decision.best.similarity };

  if (mode === 'faq' || lang !== 'en') {
    return { kind: 'ANSWER', lang, text: best.answer, generated: false, source, related };
  }

  let partial = '';
  const raw = await deps.generator.generate(buildRagMessages(question, [best]), (t) => {
    partial += t;
    onToken(sanitizeAnswer(partial));
  });
  const text = sanitizeAnswer(raw);
  // A tiny model can return nothing useful; fall back to the FAQ answer verbatim.
  return text.length > 0
    ? { kind: 'ANSWER', lang, text, generated: true, source, related }
    : { kind: 'ANSWER', lang, text: best.answer, generated: false, source, related };
}
