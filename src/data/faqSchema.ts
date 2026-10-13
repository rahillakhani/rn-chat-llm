import { z } from 'zod';

export const FaqItemSchema = z.object({
  id: z.number().int().positive(),
  category: z.string().min(1),
  question: z.string().min(1),
  answer: z.string().min(1),
});

export const FaqDatasetSchema = z.object({
  version: z.number().int().positive(),
  items: z.array(FaqItemSchema).min(1),
});

export type FaqItem = z.infer<typeof FaqItemSchema>;
export type FaqDataset = z.infer<typeof FaqDatasetSchema>;

/** Text that gets embedded for each FAQ row. Question carries most of the signal for matching. */
export function faqEmbeddingText(item: FaqItem): string {
  return `${item.question}\n${item.answer}`;
}
