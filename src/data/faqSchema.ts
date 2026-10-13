import { z } from 'zod';

import type { Lang } from '../i18n/lang';

const LocalizedFaqSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
  /** Other ways users phrase the same question. Each one gets its own vector. */
  alternates: z.array(z.string().min(1)),
});

export const FaqEntrySchema = z.object({
  id: z.number().int().positive(),
  category: z.object({ en: z.string().min(1), es: z.string().min(1) }),
  en: LocalizedFaqSchema,
  es: LocalizedFaqSchema,
});

export const FaqDatasetSchema = z.object({
  version: z.number().int().positive(),
  items: z.array(FaqEntrySchema).min(1),
});

export type FaqEntry = z.infer<typeof FaqEntrySchema>;
export type FaqDataset = z.infer<typeof FaqDatasetSchema>;

/** One FAQ in one language, as stored in SQLite and shown in the UI. */
export type FaqItem = {
  id: number;
  lang: Lang;
  category: string;
  question: string;
  answer: string;
};

/** A piece of text that gets its own embedding, pointing back at its FAQ. */
export type FaqSearchText = { faqId: number; lang: Lang; text: string };

export function localize(entry: FaqEntry, lang: Lang): FaqItem {
  const { question, answer } = entry[lang];
  return { id: entry.id, lang, category: entry.category[lang], question, answer };
}

/**
 * Texts indexed per FAQ and language: the question, each alternate phrasing, and question+answer.
 * Measured on the held-out eval set, this beat question-only or question+answer-only indexing.
 */
export function searchTexts(entry: FaqEntry): FaqSearchText[] {
  return (['en', 'es'] as const).flatMap((lang) => {
    const { question, answer, alternates } = entry[lang];
    return [question, ...alternates, `${question}\n${answer}`].map((text) => ({
      faqId: entry.id,
      lang,
      text,
    }));
  });
}
