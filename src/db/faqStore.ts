import { open, type DB } from '@op-engineering/op-sqlite';
import { z } from 'zod';

import { localize, searchTexts, type FaqDataset, type FaqItem } from '../data/faqSchema';
import { LANGS, type Lang } from '../i18n/lang';
import type { VectorHit } from '../rag/ranking';
import { blobToFloat32, cosineSimilarity } from '../rag/vector';

// SQLite holds the FAQ text in both languages and one embedding per searchable text
// (question, each alternate phrasing, question+answer, per language).
// Vector search uses the sqlite-vec `vec0` virtual table (enabled via "op-sqlite": { "sqliteVec": true }
// in package.json). If the extension is missing, we fall back to a BLOB column + brute-force cosine in JS,
// which is fine for a few thousand rows.

const SCHEMA_VERSION = '2';

const LangSchema = z.enum(LANGS);
const FaqRowSchema = z.object({
  id: z.number(),
  lang: LangSchema,
  category: z.string(),
  question: z.string(),
  answer: z.string(),
});
const TextRowSchema = z.object({
  id: z.number(),
  faq_id: z.number(),
  lang: LangSchema,
  text: z.string(),
});
const VecHitSchema = z.object({ faq_id: z.number(), lang: LangSchema, distance: z.number() });
const BlobRowSchema = z.object({
  faq_id: z.number(),
  lang: LangSchema,
  vector: z.instanceof(ArrayBuffer),
});
const MetaRowSchema = z.object({ value: z.string() });
const CountSchema = z.object({ n: z.number() });

export type IndexSignature = { datasetVersion: number; embeddingModelId: string };

export type VectorBackend = 'sqlite-vec' | 'js-cosine';

/** A searchable text with its row id, which is also its vector's rowid. */
export type StoredSearchText = { id: number; faqId: number; lang: Lang; text: string };

export type FaqStore = {
  backend: VectorBackend;
  count: () => Promise<number>;
  seed: (dataset: FaqDataset) => Promise<void>;
  allItems: (lang: Lang) => Promise<FaqItem[]>;
  getItems: (ids: readonly number[], lang: Lang) => Promise<FaqItem[]>;
  searchTexts: () => Promise<StoredSearchText[]>;
  isIndexed: (signature: IndexSignature) => Promise<boolean>;
  replaceEmbeddings: (
    rows: readonly { textId: number; vector: Float32Array }[],
    signature: IndexSignature,
  ) => Promise<void>;
  /** Similarity of the query to every stored text (exact KNN over all of them). */
  search: (query: Float32Array) => Promise<VectorHit[]>;
};

function toBlob(vector: Float32Array): ArrayBuffer {
  return vector.buffer.slice(
    vector.byteOffset,
    vector.byteOffset + vector.byteLength,
  ) as ArrayBuffer;
}

function detectSqliteVec(db: DB): boolean {
  try {
    db.executeSync('SELECT vec_version() AS v');
    return true;
  } catch {
    return false;
  }
}

function getMetaSync(db: DB, key: string): string | undefined {
  const row = db.executeSync('SELECT value FROM meta WHERE key = ?', [key]).rows[0];
  return row ? MetaRowSchema.parse(row).value : undefined;
}

function createSchema(db: DB, backend: VectorBackend, dimensions: number): void {
  db.executeSync('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  if (getMetaSync(db, 'schema_version') !== SCHEMA_VERSION) {
    // POC: no migrations. Everything is derived from the bundled JSON, so rebuild from scratch.
    for (const table of ['faq', 'faq_text', 'faq_vec', 'faq_embedding']) {
      db.executeSync(`DROP TABLE IF EXISTS ${table}`);
    }
    db.executeSync('DELETE FROM meta');
  }
  db.executeSync(
    `CREATE TABLE IF NOT EXISTS faq (
      id INTEGER NOT NULL,
      lang TEXT NOT NULL,
      category TEXT NOT NULL,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      PRIMARY KEY (id, lang)
    )`,
  );
  db.executeSync(
    `CREATE TABLE IF NOT EXISTS faq_text (
      id INTEGER PRIMARY KEY,
      faq_id INTEGER NOT NULL,
      lang TEXT NOT NULL,
      text TEXT NOT NULL
    )`,
  );
  if (backend === 'sqlite-vec') {
    // rowid = faq_text.id
    db.executeSync(
      `CREATE VIRTUAL TABLE IF NOT EXISTS faq_vec USING vec0(embedding float[${dimensions}] distance_metric=cosine)`,
    );
  } else {
    db.executeSync(
      'CREATE TABLE IF NOT EXISTS faq_embedding (text_id INTEGER PRIMARY KEY, vector BLOB NOT NULL)',
    );
  }
  db.executeSync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [
    'schema_version',
    SCHEMA_VERSION,
  ]);
}

export function openFaqStore(dimensions: number): FaqStore {
  const db = open({ name: 'faq.sqlite' });
  const backend: VectorBackend = detectSqliteVec(db) ? 'sqlite-vec' : 'js-cosine';
  createSchema(db, backend, dimensions);

  const indexKey = `index_signature:${backend}`;
  const textCount = async () =>
    CountSchema.parse((await db.execute('SELECT COUNT(*) AS n FROM faq_text')).rows[0]).n;

  return {
    backend,

    async count() {
      const res = await db.execute('SELECT COUNT(DISTINCT id) AS n FROM faq');
      return CountSchema.parse(res.rows[0]).n;
    },

    async seed(dataset) {
      if (getMetaSync(db, 'dataset_version') === String(dataset.version)) return;
      await db.transaction(async (tx) => {
        await tx.execute('DELETE FROM faq');
        await tx.execute('DELETE FROM faq_text');
        for (const entry of dataset.items) {
          for (const lang of ['en', 'es'] as const) {
            const item = localize(entry, lang);
            await tx.execute(
              'INSERT INTO faq (id, lang, category, question, answer) VALUES (?, ?, ?, ?, ?)',
              [item.id, item.lang, item.category, item.question, item.answer],
            );
          }
          for (const t of searchTexts(entry)) {
            await tx.execute('INSERT INTO faq_text (faq_id, lang, text) VALUES (?, ?, ?)', [
              t.faqId,
              t.lang,
              t.text,
            ]);
          }
        }
        await tx.execute('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [
          'dataset_version',
          String(dataset.version),
        ]);
      });
    },

    async allItems(lang) {
      const res = await db.execute(
        'SELECT id, lang, category, question, answer FROM faq WHERE lang = ? ORDER BY id',
        [lang],
      );
      return res.rows.map((r) => FaqRowSchema.parse(r));
    },

    async getItems(ids, lang) {
      if (ids.length === 0) return [];
      const res = await db.execute(
        `SELECT id, lang, category, question, answer FROM faq
          WHERE lang = ? AND id IN (${ids.map(() => '?').join(',')})`,
        [lang, ...ids],
      );
      const byId = new Map(
        res.rows.map((r) => {
          const item = FaqRowSchema.parse(r);
          return [item.id, item] as const;
        }),
      );
      return ids.flatMap((id) => byId.get(id) ?? []);
    },

    async searchTexts() {
      const res = await db.execute('SELECT id, faq_id, lang, text FROM faq_text ORDER BY id');
      return res.rows.map((r) => {
        const row = TextRowSchema.parse(r);
        return { id: row.id, faqId: row.faq_id, lang: row.lang, text: row.text };
      });
    },

    async isIndexed(signature) {
      return getMetaSync(db, indexKey) === JSON.stringify(signature);
    },

    async replaceEmbeddings(rows, signature) {
      await db.transaction(async (tx) => {
        const table = backend === 'sqlite-vec' ? 'faq_vec' : 'faq_embedding';
        const insert =
          backend === 'sqlite-vec'
            ? 'INSERT INTO faq_vec (rowid, embedding) VALUES (?, ?)'
            : 'INSERT INTO faq_embedding (text_id, vector) VALUES (?, ?)';
        await tx.execute(`DELETE FROM ${table}`);
        for (const row of rows) {
          await tx.execute(insert, [row.textId, toBlob(row.vector)]);
        }
        await tx.execute('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [
          indexKey,
          JSON.stringify(signature),
        ]);
      });
    },

    async search(query) {
      if (backend === 'sqlite-vec') {
        // vec0 KNN over every stored text; with distance_metric=cosine, distance = 1 - cosine similarity.
        const res = await db.execute(
          `SELECT t.faq_id, t.lang, v.distance
             FROM (SELECT rowid, distance FROM faq_vec WHERE embedding MATCH ? AND k = ?) v
             JOIN faq_text t ON t.id = v.rowid`,
          [toBlob(query), await textCount()],
        );
        return res.rows.map((r) => {
          const hit = VecHitSchema.parse(r);
          return { faqId: hit.faq_id, lang: hit.lang, similarity: 1 - hit.distance };
        });
      }

      const res = await db.execute(
        `SELECT t.faq_id, t.lang, e.vector FROM faq_embedding e JOIN faq_text t ON t.id = e.text_id`,
      );
      return res.rows.map((r) => {
        const row = BlobRowSchema.parse(r);
        return {
          faqId: row.faq_id,
          lang: row.lang,
          similarity: cosineSimilarity(query, blobToFloat32(row.vector)),
        };
      });
    },
  };
}
