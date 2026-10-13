export const LANGS = ['en', 'es'] as const;
export type Lang = (typeof LANGS)[number];

export function isLang(value: string | null | undefined): value is Lang {
  return value === 'en' || value === 'es';
}
