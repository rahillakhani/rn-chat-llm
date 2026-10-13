import type { EmbeddingModelSpec } from '../config/models';
import { faqEmbeddingText, type FaqDataset } from '../data/faqSchema';
import type { FaqStore } from '../db/faqStore';
import type { Embedder, Generator } from '../llm/engine';
import { NO_MATCH_REPLY, buildRagMessages, sanitizeAnswer } from './prompt';
import { selectContext, type RetrievedFaq } from './retrieval';

export type BotAnswer =
  | { kind: 'NO_MATCH'; text: string; best: RetrievedFaq | undefined }
  | { kind: 'ANSWER'; text: string; sources: RetrievedFaq[] };

/** Seed the FAQ rows and (re)build vectors when the dataset or embedding model changes. */
export async function prepareIndex(
  store: FaqStore,
  embedder: Embedder,
  dataset: FaqDataset,
  embeddingModel: EmbeddingModelSpec,
  onProgress: (done: number, total: number) => void,
): Promise<void> {
  await store.seed(dataset);
  const signature = { datasetVersion: dataset.version, embeddingModelId: embeddingModel.id };
  if (await store.isIndexed(signature)) return;

  const items = await store.allItems();
  const rows: { id: number; vector: Float32Array }[] = [];
  for (const item of items) {
    rows.push({ id: item.id, vector: await embedder.embed(faqEmbeddingText(item)) });
    onProgress(rows.length, items.length);
  }
  await store.replaceEmbeddings(rows, signature);
}

export async function answerQuestion(
  question: string,
  deps: { store: FaqStore; embedder: Embedder; generator: Generator },
  onToken: (partial: string) => void,
): Promise<BotAnswer> {
  const queryVector = await deps.embedder.embed(question);
  const hits = await deps.store.search(queryVector, 5);
  const decision = selectContext(hits);

  if (decision.kind === 'NO_MATCH') {
    return { kind: 'NO_MATCH', text: NO_MATCH_REPLY, best: decision.best };
  }

  let partial = '';
  const raw = await deps.generator.generate(buildRagMessages(question, decision.context), (t) => {
    partial += t;
    onToken(sanitizeAnswer(partial));
  });
  const text = sanitizeAnswer(raw);
  // A tiny model can return nothing useful; fall back to the best FAQ answer verbatim.
  const fallback = decision.context[0]?.answer ?? NO_MATCH_REPLY;
  return { kind: 'ANSWER', text: text.length > 0 ? text : fallback, sources: decision.context };
}
