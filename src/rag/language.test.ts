import { describe, expect, it } from 'vitest';

import { detectLanguage } from './language';

describe('detectLanguage', () => {
  it.each([
    { text: '¿Dónde está mi pedido?', lang: 'es' },
    { text: 'como cancelo mi pedido', lang: 'es' },
    { text: 'quiero devolver una camiseta', lang: 'es' },
    { text: 'Where is my order?', lang: 'en' },
    { text: 'how do i cancel', lang: 'en' },
    { text: 'refund', lang: undefined },
    { text: 'PayPal', lang: undefined },
  ])('$text -> $lang', ({ text, lang }) => {
    expect(detectLanguage(text)).toBe(lang);
  });
});
