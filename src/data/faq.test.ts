import { describe, expect, it } from 'vitest';

import faqJson from './faq.json';
import { FaqDatasetSchema } from './faqSchema';

describe('bundled FAQ dataset', () => {
  const dataset = FaqDatasetSchema.parse(faqJson);

  it('contains 52 entries', () => {
    expect(dataset.items).toHaveLength(52);
  });

  it('has unique ids and unique questions', () => {
    expect(new Set(dataset.items.map((i) => i.id)).size).toBe(dataset.items.length);
    const questions = dataset.items.map((i) => i.question.toLowerCase());
    expect(new Set(questions).size).toBe(questions.length);
  });
});
