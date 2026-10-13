import { describe, expect, it } from 'vitest';

import type { EmbeddingModelSpec } from '../config/models';
import { localize, searchTexts, type FaqDataset } from '../data/faqSchema';
import type { FaqStore, IndexSignature, StoredSearchText } from '../db/faqStore';
import type { Embedder, Generator } from '../llm/engine';
import { answerQuestion, prepareIndex, type BotDeps } from './faqBot';
import type { MatchSettings } from './ranking';
import { cosineSimilarity } from './vector';

// Fake embedder: one dimension per concept, matched in either language, so similarity is predictable.
const CONCEPTS = [
  ['password', 'contraseña'],
  ['refund', 'reembolso'],
];
const fakeEmbedder: Embedder = {
  embed: async (text) =>
    Float32Array.from(
      CONCEPTS.map((words) => (words.some((w) => text.toLowerCase().includes(w)) ? 1 : 0)),
    ),
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
  let dataset: FaqDataset = { version: 0, items: [] };
  let texts: StoredSearchText[] = [];
  let vectors = new Map<number, Float32Array>();
  let signature = '';
  const store = {
    backend: 'js-cosine' as const,
    embedCalls: 0,
    count: async () => dataset.items.length,
    seed: async (d: FaqDataset) => {
      dataset = d;
      texts = d.items.flatMap(searchTexts).map((t, i) => ({ ...t, id: i + 1 }));
    },
    allItems: async (lang: 'en' | 'es') => dataset.items.map((e) => localize(e, lang)),
    getItems: async (ids: readonly number[], lang: 'en' | 'es') =>
      ids.flatMap((id) => {
        const entry = dataset.items.find((e) => e.id === id);
        return entry ? [localize(entry, lang)] : [];
      }),
    searchTexts: async () => texts,
    isIndexed: async (s: IndexSignature) => signature === JSON.stringify(s),
    replaceEmbeddings: async (
      rows: readonly { textId: number; vector: Float32Array }[],
      s: IndexSignature,
    ) => {
      store.embedCalls++;
      vectors = new Map(rows.map((r) => [r.textId, r.vector]));
      signature = JSON.stringify(s);
    },
    search: async (q: Float32Array) =>
      texts.map((t) => ({
        faqId: t.faqId,
        lang: t.lang,
        similarity: cosineSimilarity(q, vectors.get(t.id) ?? new Float32Array(q.length)),
      })),
  };
  return store;
}

const dataset: FaqDataset = {
  version: 1,
  items: [
    {
      id: 1,
      category: { en: 'Account', es: 'Cuenta' },
      en: {
        question: 'How do I reset my password?',
        answer: 'Tap Forgot password.',
        alternates: ['I forgot my password'],
      },
      es: {
        question: '¿Cómo restablezco mi contraseña?',
        answer: 'Toca ¿Olvidaste tu contraseña?',
        alternates: ['Olvidé mi contraseña'],
      },
    },
    {
      id: 2,
      category: { en: 'Returns', es: 'Devoluciones' },
      en: {
        question: 'When is my refund issued?',
        answer: 'Within 5 business days.',
        alternates: ['Where is my refund?'],
      },
      es: {
        question: '¿Cuándo recibo mi reembolso?',
        answer: 'En 5 días hábiles.',
        alternates: ['¿Dónde está mi reembolso?'],
      },
    },
  ],
};

const embeddingModel: EmbeddingModelSpec = {
  id: 'fake',
  label: 'fake',
  fileName: 'f',
  url: 'u',
  sizeBytes: 1,
  dimensions: CONCEPTS.length,
};
// Keyword scoring off so the fake vectors alone decide.
const settings: MatchSettings = {
  keywordWeight: 0,
  minScore: 0.9,
  suggestMinScore: 0.5,
  maxSuggestions: 3,
  relatedMargin: 0.05,
  maxRelated: 2,
};

async function setup(reply = 'LLM answer') {
  const store = memoryStore();
  const lexical = await prepareIndex(store, fakeEmbedder, dataset, embeddingModel, () => {});
  const generator = fakeGenerator(reply);
  const deps: BotDeps = { store, embedder: fakeEmbedder, generator, lexical };
  return { store, generator, deps };
}

describe('prepareIndex', () => {
  it('embeds every search text once and skips re-indexing for the same signature', async () => {
    const store = memoryStore();
    const progress: number[] = [];
    await prepareIndex(store, fakeEmbedder, dataset, embeddingModel, (done) => progress.push(done));
    await prepareIndex(store, fakeEmbedder, dataset, embeddingModel, () => {});
    // 2 FAQs x 2 languages x (question + 1 alternate + question/answer)
    expect(progress).toHaveLength(12);
    expect(store.embedCalls).toBe(1);
  });
});

describe('answerQuestion', () => {
  it('answers an English question with the LLM, grounded in the English FAQ', async () => {
    const { deps, generator } = await setup('Use Forgot password on the login screen.');

    const answer = await answerQuestion('i lost my password', 'es', deps, () => {}, settings);

    expect(answer).toMatchObject({
      kind: 'ANSWER',
      lang: 'en',
      generated: true,
      text: 'Use Forgot password on the login screen.',
      source: { id: 1, lang: 'en' },
    });
    expect(generator.prompts[0]).toContain('Tap Forgot password.');
    expect(generator.prompts[0]).not.toContain('Within 5 business days.');
  });

  it('answers a Spanish question with the Spanish FAQ text, without the LLM', async () => {
    const { deps, generator } = await setup();

    const answer = await answerQuestion(
      '¿dónde está mi reembolso?',
      'en',
      deps,
      () => {},
      settings,
    );

    expect(answer).toMatchObject({
      kind: 'ANSWER',
      lang: 'es',
      generated: false,
      text: 'En 5 días hábiles.',
      source: { id: 2, question: '¿Cuándo recibo mi reembolso?' },
    });
    expect(generator.prompts).toHaveLength(0);
  });

  it('uses the UI language when the question has no language hints', async () => {
    const { deps } = await setup();
    const answer = await answerQuestion('refund', 'es', deps, () => {}, settings);
    expect(answer).toMatchObject({ kind: 'ANSWER', lang: 'es', text: 'En 5 días hábiles.' });
  });

  it('offers close runners-up as related questions in the reply language', async () => {
    const { deps } = await setup();
    const answer = await answerQuestion('contraseña y reembolso', 'en', deps, () => {}, {
      ...settings,
      minScore: 0.7,
    });
    expect(answer.kind === 'ANSWER' && answer.related.map((r) => [r.id, r.lang])).toEqual([
      [2, 'es'],
    ]);
  });

  it('asks the user to pick when the best match is close but not confident', async () => {
    const { deps, generator } = await setup();
    const answer = await answerQuestion('contraseña y reembolso', 'en', deps, () => {}, settings);
    expect(answer.kind === 'SUGGEST' && answer.options.map((o) => [o.id, o.lang])).toEqual([
      [1, 'es'],
      [2, 'es'],
    ]);
    expect(generator.prompts).toHaveLength(0);
  });

  it('returns NO_MATCH without calling the LLM when nothing in the FAQ matches', async () => {
    const { deps, generator } = await setup();
    const answer = await answerQuestion('¿qué tiempo hace mañana?', 'en', deps, () => {}, settings);
    expect(answer).toEqual({ kind: 'NO_MATCH', lang: 'es' });
    expect(generator.prompts).toHaveLength(0);
  });

  it('falls back to the FAQ answer when the LLM returns nothing', async () => {
    const { deps } = await setup('<|im_end|>');
    const answer = await answerQuestion('where is my refund', 'en', deps, () => {}, settings);
    expect(answer).toMatchObject({ text: 'Within 5 business days.', generated: false });
  });
});
