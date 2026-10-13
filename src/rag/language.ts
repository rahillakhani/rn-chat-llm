import type { FaqSearchText } from '../data/faqSchema';
import type { Lang } from '../i18n/lang';
import { foldAccents } from './lexical';
import type { VectorHit } from './ranking';

// EN/ES detection in three steps, most reliable first. Each step can be undecided and hand over:
//   1. Spanish-only characters (¿ ¡ ñ á é í ó ú ü).
//   2. Word votes: common function words, plus words that occur in only one language's FAQ text
//      ("datos", "factura" vs "invoice", "refund"). This catches short accentless queries such as
//      "recuperar datos", which function words alone could not decide.
//   3. languageFromHits: which language's version of the best-matching FAQ the question was closer to.
// If all are undecided (e.g. "PayPal"), the caller falls back to the app's UI language.

const SPANISH_CHARS = /[¿¡ñáéíóúü]/i;

const ES_WORDS = new Set(
  'el la los las un una mi mis tu de del que como cuando donde por para puedo quiero hay es son con sin cual cuanto se me te lo al y o pero ya no si mas esta estoy tengo'.split(
    ' ',
  ),
);
const EN_WORDS = new Set(
  'the a an my your how do does i can is are what when where why to of for with without it in on and or not if you me am have has was'.split(
    ' ',
  ),
);

export type LanguageVocabulary = Record<Lang, Set<string>>;

function words(text: string): string[] {
  return foldAccents(text).match(/[a-z0-9]+/g) ?? [];
}

/** Words (3+ letters, accent-folded) that appear in one language's FAQ texts and never in the other's. */
export function buildLanguageVocabulary(texts: readonly FaqSearchText[]): LanguageVocabulary {
  const seen: LanguageVocabulary = { en: new Set(), es: new Set() };
  for (const t of texts) {
    for (const w of words(t.text)) if (w.length > 2) seen[t.lang].add(w);
  }
  const only = (a: Set<string>, b: Set<string>) => new Set([...a].filter((w) => !b.has(w)));
  return { en: only(seen.en, seen.es), es: only(seen.es, seen.en) };
}

export function detectLanguage(text: string, vocabulary?: LanguageVocabulary): Lang | undefined {
  if (SPANISH_CHARS.test(text)) return 'es';
  let es = 0;
  let en = 0;
  for (const w of words(text)) {
    if (ES_WORDS.has(w) || vocabulary?.es.has(w)) es++;
    if (EN_WORDS.has(w) || vocabulary?.en.has(w)) en++;
  }
  if (es > en) return 'es';
  if (en > es) return 'en';
  return undefined;
}

/** Minimum similarity gap between the two language versions of a FAQ to call the language. */
const HIT_LANGUAGE_MARGIN = 0.02;

/** Which language's texts of this FAQ the query matched better, if clearly better. */
export function languageFromHits(hits: readonly VectorHit[], faqId: number): Lang | undefined {
  const best: Record<Lang, number> = { en: -1, es: -1 };
  for (const h of hits) {
    if (h.faqId === faqId) best[h.lang] = Math.max(best[h.lang], h.similarity);
  }
  if (best.es - best.en >= HIT_LANGUAGE_MARGIN) return 'es';
  if (best.en - best.es >= HIT_LANGUAGE_MARGIN) return 'en';
  return undefined;
}
