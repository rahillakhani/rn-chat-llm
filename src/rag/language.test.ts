import { describe, expect, it } from 'vitest';

import faqJson from '../data/faq.json';
import { FaqDatasetSchema, searchTexts } from '../data/faqSchema';
import { buildLanguageVocabulary, detectLanguage, languageFromHits } from './language';

const vocabulary = buildLanguageVocabulary(
  FaqDatasetSchema.parse(faqJson).items.flatMap(searchTexts),
);

describe('detectLanguage', () => {
  it.each([
    { text: '¿Dónde está mi pedido?', lang: 'es' },
    { text: 'como cancelo mi pedido', lang: 'es' },
    { text: 'quiero devolver una camiseta', lang: 'es' },
    { text: 'Where is my order?', lang: 'en' },
    { text: 'how do i cancel', lang: 'en' },
  ])('stop words / accents: $text -> $lang', ({ text, lang }) => {
    expect(detectLanguage(text, vocabulary)).toBe(lang);
  });

  // Short queries with no accents or stop words: decided by words that only occur in one
  // language's FAQ text. "recuperar datos" was reported answering in English.
  it.each([
    { text: 'recuperar datos', lang: 'es' },
    { text: 'envio gratis', lang: 'es' },
    { text: 'factura', lang: 'es' },
    { text: 'tarjeta regalo', lang: 'es' },
    { text: 'reembolso', lang: 'es' },
    { text: 'contrasena olvidada', lang: 'es' },
    { text: 'recover data', lang: 'en' },
    { text: 'free shipping', lang: 'en' },
    { text: 'invoice', lang: 'en' },
    { text: 'gift card balance', lang: 'en' },
    { text: 'refund', lang: 'en' },
  ])('FAQ vocabulary: $text -> $lang', ({ text, lang }) => {
    expect(detectLanguage(text, vocabulary)).toBe(lang);
  });

  it.each(['PayPal', 'acme plus', '2FA'])(
    '%s is undecided (same word in both languages)',
    (text) => {
      expect(detectLanguage(text, vocabulary)).toBeUndefined();
    },
  );
});

describe('languageFromHits', () => {
  it('picks the language whose version of the FAQ matched clearly better', () => {
    const hits = [
      { faqId: 7, lang: 'en' as const, similarity: 0.5 },
      { faqId: 7, lang: 'es' as const, similarity: 0.62 },
      { faqId: 3, lang: 'en' as const, similarity: 0.9 },
    ];
    expect(languageFromHits(hits, 7)).toBe('es');
  });

  it('is undecided when both languages matched about equally', () => {
    const hits = [
      { faqId: 7, lang: 'en' as const, similarity: 0.6 },
      { faqId: 7, lang: 'es' as const, similarity: 0.61 },
    ];
    expect(languageFromHits(hits, 7)).toBeUndefined();
  });
});
