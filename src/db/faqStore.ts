import { open, type DB } from '@op-engineering/op-sqlite';
import { z } from 'zod';

import type { FaqDataset, FaqItem } from '../data/faqSchema';
import type { RetrievedFaq } from '../rag/retrieval';
import { blobToFloat32, topKBySimilarity } from '../rag/vector';

// SQLite holds both the FAQ text and its embeddings.
// Vector search uses the sqlite-vec `vec0` virtual table (enabled via "op-sqlite": { "sqliteVec": true }
// in package.json). If the extension is missing, we fall back to a BLOB column + brute-force cosine in JS,
// which is fine for a few hundred rows.

const FaqRowSchema = z.object({
  id: z.number(),
  category: z.string(),
  question: z.string(),
  answer: z.string(),
});
const VecHitSchema = FaqRowSchema.extend({ distance: z.number() });
const BlobRowSchema = z.object({ faq_id: z.number(), vector: z.instanceof(ArrayBuffer) });
const MetaRowSchema = z.object({ value: z.string() });

export type IndexSignature = { datasetVersion: number; embeddingModelId: string };

export type VectorBackend = 'sqlite-vec' | 'js-cosine';

export type FaqStore = {
  backend: VectorBackend;
  count: () => Promise<number>;
  seed: (dataset: FaqDataset) => Promise<void>;
  allItems: () => Promise<FaqItem[]>;
  isIndexed: (signature: IndexSignature) => Promise<boolean>;
  replaceEmbeddings: (
    rows: readonly { id: number; vector: Float32Array }[],
    signature: IndexSignature,
  ) => Promise<void>;
  search: (query: Float32Array, k: number) => Promise<RetrievedFaq[]>;
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

async function getMeta(db: DB, key: string): Promise<string | undefined> {
  const res = await db.execute('SELECT value FROM meta WHERE key = ?', [key]);
  const row = res.rows[0];
  return row ? MetaRowSchema.parse(row).value : undefined;
}

export function openFaqStore(dimensions: number): FaqStore {
  const db = open({ name: 'faq.sqlite' });
  const backend: VectorBackend = detectSqliteVec(db) ? 'sqlite-vec' : 'js-cosine';

  db.executeSync('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  db.executeSync(
    `CREATE TABLE IF NOT EXISTS faq (
      id INTEGER PRIMARY KEY,
      category TEXT NOT NULL,
      question TEXT NOT NULL,
      answer TEXT NOT NULL
    )`,
  );
  if (backend === 'sqlite-vec') {
    db.executeSync(
      `CREATE VIRTUAL TABLE IF NOT EXISTS faq_vec USING vec0(embedding float[${dimensions}] distance_metric=cosine)`,
    );
  } else {
    db.executeSync(
      'CREATE TABLE IF NOT EXISTS faq_embedding (faq_id INTEGER PRIMARY KEY, vector BLOB NOT NULL)',
    );
  }

  const indexKey = `index_signature:${backend}`;

  return {
    backend,

    async count() {
      const res = await db.execute('SELECT COUNT(*) AS n FROM faq');
      return z.object({ n: z.number() }).parse(res.rows[0]).n;
    },

    async seed(dataset) {
      const current = await getMeta(db, 'dataset_version');
      if (current === String(dataset.version)) return;
      await db.transaction(async (tx) => {
        await tx.execute('DELETE FROM faq');
        for (const item of dataset.items) {
          await tx.execute('INSERT INTO faq (id, category, question, answer) VALUES (?, ?, ?, ?)', [
            item.id,
            item.category,
            item.question,
            item.answer,
          ]);
        }
        await tx.execute('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [
          'dataset_version',
          String(dataset.version),
        ]);
      });
    },

    async allItems() {
      const res = await db.execute('SELECT id, category, question, answer FROM faq ORDER BY id');
      return res.rows.map((r) => FaqRowSchema.parse(r));
    },

    async isIndexed(signature) {
      return (await getMeta(db, indexKey)) === JSON.stringify(signature);
    },

    async replaceEmbeddings(rows, signature) {
      await db.transaction(async (tx) => {
        if (backend === 'sqlite-vec') {
          await tx.execute('DELETE FROM faq_vec');
          for (const row of rows) {
            await tx.execute('INSERT INTO faq_vec (rowid, embedding) VALUES (?, ?)', [
              row.id,
              toBlob(row.vector),
            ]);
          }
        } else {
          await tx.execute('DELETE FROM faq_embedding');
          for (const row of rows) {
            await tx.execute('INSERT INTO faq_embedding (faq_id, vector) VALUES (?, ?)', [
              row.id,
              toBlob(row.vector),
            ]);
          }
        }
        await tx.execute('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [
          indexKey,
          JSON.stringify(signature),
        ]);
      });
    },

    async search(query, k) {
      if (backend === 'sqlite-vec') {
        // vec0 KNN query; with distance_metric=cosine, distance = 1 - cosine similarity.
        const res = await db.execute(
          `SELECT f.id, f.category, f.question, f.answer, v.distance
             FROM (SELECT rowid, distance FROM faq_vec WHERE embedding MATCH ? AND k = ?) v
             JOIN faq f ON f.id = v.rowid
            ORDER BY v.distance`,
          [toBlob(query), k],
        );
        return res.rows.map((r) => {
          const { distance, ...item } = VecHitSchema.parse(r);
          return { ...item, similarity: 1 - distance };
        });
      }

      const res = await db.execute('SELECT faq_id, vector FROM faq_embedding');
      const candidates = res.rows.map((r) => {
        const row = BlobRowSchema.parse(r);
        return { id: row.faq_id, vector: blobToFloat32(row.vector) };
      });
      const top = topKBySimilarity(query, candidates, k);
      if (top.length === 0) return [];
      const items = await db.execute(
        `SELECT id, category, question, answer FROM faq WHERE id IN (${top.map(() => '?').join(',')})`,
        top.map((t) => t.id),
      );
      const byId = new Map(
        items.rows.map((r) => {
          const item = FaqRowSchema.parse(r);
          return [item.id, item] as const;
        }),
      );
      return top.flatMap((t) => {
        const item = byId.get(t.id);
        return item ? [{ ...item, similarity: t.similarity }] : [];
      });
    },
  };
}
