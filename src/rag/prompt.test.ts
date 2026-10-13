import { describe, expect, it } from 'vitest';

import { buildRagMessages, sanitizeAnswer } from './prompt';

describe('buildRagMessages', () => {
  it('puts FAQ text in a delimited block in the user turn, not the system prompt', () => {
    const messages = buildRagMessages('  how do refunds work? ', [
      { id: 1, category: 'Returns', question: 'Refund?', answer: 'In 5 days.', similarity: 0.9 },
    ]);
    expect(messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(messages[0]?.content).not.toContain('In 5 days.');
    expect(messages[1]?.content).toContain('<faq>\n[1] Q: Refund?\nA: In 5 days.\n</faq>');
    expect(messages[1]?.content).toMatch(/Question: how do refunds work\?$/);
  });
});

describe('sanitizeAnswer', () => {
  it.each([
    { raw: '  Hello there  ', expected: 'Hello there' },
    { raw: 'Assistant: You can return it.<|im_end|>', expected: 'You can return it.' },
    { raw: 'answer: yes', expected: 'yes' },
  ])('$raw -> $expected', ({ raw, expected }) => {
    expect(sanitizeAnswer(raw)).toBe(expected);
  });
});
