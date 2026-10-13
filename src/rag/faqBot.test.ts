import { describe, expect, it } from 'vitest';

import type { EmbeddingModelSpec } from '../config/models';
import type { FaqDataset, FaqItem } from '../data/faqSchema';
import type { FaqStore, IndexSignature } from '../db/faqStore';
import type { Embedder, Generator } from '../llm/engine';
import { answerQuestion, prepareIndex } from './faqBot';
import { NO_MATCH_REPLY } from './prompt';
import { topKBySimilarity } from './vector';

// Fake embedder: one dimension per keyword, so similarity is predictable.
const KEYWORDS = ['password', 'refund', 'shipping'];
const fakeEmbedder: Embedder = {
  embed: async (text) =>
    Float32Array.from(KEYWORDS.map((k) => (text.toLowerCase().includes(k) ? 1 : 0))),
  release: async () => {},
};

function fakeGenerator(reply: string): Generator & { prompts: string[] } {
  const prompts: string[] = [];
  return {
    prompts,
    accelerator: { kind: 'CPU', reason: 'test' },
    generate: async (messages, onToken) => {
      prompts.push(messages.map((m) => m.content).join('\n'));
      onToken(reply);
      return reply;
    },
    stop: async () => {},
    release: async () => {},
  };
}

function memoryStore(): FaqStore & { embedCalls: number } {
  let items: FaqItem[] = [];
  let vectors: { id: number; vector: Float32Array }[] = [];
  let signature = '';
  const store = {
    backend: 'js-cosine' as const,
    embedCalls: 0,
    count: async () => items.length,
    seed: async (d: FaqDataset) => {
      items = d.items;
    },
    allItems: async () => items,
    isIndexed: async (s: IndexSignature) => signature === JSON.stringify(s),
    replaceEmbeddings: async (
      rows: readonly { id: number; vector: Float32Array }[],
      s: IndexSignature,
    ) => {
      store.embedCalls++;
      vectors = [...rows];
      signature = JSON.stringify(s);
    },
    search: async (q: Float32Array, k: number) =>
      topKBySimilarity(q, vectors, k).flatMap((t) => {
        const item = items.find((i) => i.id === t.id);
        return item ? [{ ...item, similarity: t.similarity }] : [];
      }),
  };
  return store;
}

const dataset: FaqDataset = {
  version: 1,
  items: [
    {
      id: 1,
      category: 'Account',
      question: 'How do I reset my password?',
      answer: 'Tap Forgot password.',
    },
    {
      id: 2,
      category: 'Returns',
      question: 'When is my refund issued?',
      answer: 'Within 5 business days.',
    },
  ],
};
const embeddingModel: EmbeddingModelSpec = {
  id: 'fake',
  label: 'fake',
  fileName: 'f',
  url: 'u',
  sizeBytes: 1,
  dimensions: KEYWORDS.length,
};

describe('prepareIndex', () => {
  it('embeds every FAQ once and skips re-indexing for the same signature', async () => {
    const store = memoryStore();
    const progress: number[] = [];
    await prepareIndex(store, fakeEmbedder, dataset, embeddingModel, (done) => progress.push(done));
    await prepareIndex(store, fakeEmbedder, dataset, embeddingModel, () => {});
    expect(progress).toEqual([1, 2]);
    expect(store.embedCalls).toBe(1);
  });
});

describe('answerQuestion', () => {
  it('answers from the matching FAQ and returns it as a source', async () => {
    const store = memoryStore();
    await prepareIndex(store, fakeEmbedder, dataset, embeddingModel, () => {});
    const generator = fakeGenerator('Use Forgot password on the login screen.');

    const answer = await answerQuestion(
      'I forgot my password',
      { store, embedder: fakeEmbedder, generator },
      () => {},
    );

    expect(answer).toMatchObject({
      kind: 'ANSWER',
      text: 'Use Forgot password on the login screen.',
    });
    expect(answer.kind === 'ANSWER' && answer.sources.map((s) => s.id)).toEqual([1]);
    expect(generator.prompts[0]).toContain('Tap Forgot password.');
    expect(generator.prompts[0]).not.toContain('Within 5 business days.');
  });

  it('does not call the LLM when nothing in the FAQ matches', async () => {
    const store = memoryStore();
    await prepareIndex(store, fakeEmbedder, dataset, embeddingModel, () => {});
    const generator = fakeGenerator('should not be used');

    const answer = await answerQuestion(
      'What is the weather?',
      { store, embedder: fakeEmbedder, generator },
      () => {},
    );

    expect(answer).toMatchObject({ kind: 'NO_MATCH', text: NO_MATCH_REPLY });
    expect(generator.prompts).toHaveLength(0);
  });

  it('falls back to the best FAQ answer when the model returns nothing', async () => {
    const store = memoryStore();
    await prepareIndex(store, fakeEmbedder, dataset, embeddingModel, () => {});

    const answer = await answerQuestion(
      'refund timing',
      { store, embedder: fakeEmbedder, generator: fakeGenerator('<|im_end|>') },
      () => {},
    );

    expect(answer.text).toBe('Within 5 business days.');
  });
});
