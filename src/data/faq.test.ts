import { describe, expect, it } from 'vitest';

import faqJson from './faq.json';
import { FaqDatasetSchema, searchTexts } from './faqSchema';

describe('bundled FAQ dataset', () => {
  const dataset = FaqDatasetSchema.parse(faqJson);

  it('contains 52 entries, each in English and Spanish', () => {
    expect(dataset.items).toHaveLength(52);
  });

  it.each(['en', 'es'] as const)('has unique ids and unique %s questions', (lang) => {
    expect(new Set(dataset.items.map((i) => i.id)).size).toBe(dataset.items.length);
    const questions = dataset.items.map((i) => i[lang].question.toLowerCase());
    expect(new Set(questions).size).toBe(questions.length);
  });

  it('gives every FAQ at least two alternate phrasings per language', () => {
    for (const item of dataset.items) {
      expect(item.en.alternates.length, `FAQ ${item.id} en`).toBeGreaterThanOrEqual(2);
      expect(item.es.alternates.length, `FAQ ${item.id} es`).toBeGreaterThanOrEqual(2);
    }
  });

  it('indexes question, alternates and question+answer in both languages', () => {
    const entry = dataset.items[0];
    if (!entry) throw new Error('empty dataset');
    const texts = searchTexts(entry);
    expect(texts).toHaveLength(2 * (2 + entry.en.alternates.length));
    expect(texts).toContainEqual({ faqId: entry.id, lang: 'es', text: entry.es.question });
  });
});
