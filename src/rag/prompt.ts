import type { FaqItem } from '../data/faqSchema';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

const SYSTEM_PROMPT = [
  'You are a customer support assistant.',
  'Answer the question using ONLY the FAQ entries provided.',
  'Keep the answer short: one to three sentences.',
  'If the FAQ entries do not answer the question, say you do not know.',
].join(' ');

/**
 * FAQ text is placed in a delimited data block inside the user turn, never in the system prompt.
 * Small models follow the most recent turn best, so the question is repeated at the end.
 */
export function buildRagMessages(
  question: string,
  context: readonly Pick<FaqItem, 'question' | 'answer'>[],
): ChatMessage[] {
  const faqBlock = context
    .map((item, i) => `[${i + 1}] Q: ${item.question}\nA: ${item.answer}`)
    .join('\n\n');
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `FAQ entries:\n<faq>\n${faqBlock}\n</faq>\n\nQuestion: ${question.trim()}`,
    },
  ];
}

/** Clean up common tiny-model artifacts (leftover role tags, trailing whitespace). */
export function sanitizeAnswer(raw: string): string {
  return raw
    .replace(/<\|[^|]*\|>/g, '')
    .replace(/^\s*(assistant|answer)\s*:\s*/i, '')
    .trim();
}
