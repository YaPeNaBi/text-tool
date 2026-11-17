/**
 * The languages the interface speaks (B-UI-19), and which of them a browser is
 * asking for.
 *
 * Listed by script, Latin first and then alphabetically within each, each under
 * its own name — a list of languages written in English is no help to someone
 * who does not read English, which is the whole reason the list is there.
 *
 * Three of these are China's largest languages rather than one "Chinese":
 * Mandarin, written in simplified characters as on the mainland; Cantonese,
 * written in traditional characters as in Hong Kong; and Wu, Shanghai's
 * language, in simplified characters. India's three largest by native speakers
 * are Hindi, Bengali and Marathi.
 */

export const LANGUAGES = [
  { code: 'id', name: 'Bahasa Indonesia' },
  { code: 'de', name: 'Deutsch' },
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'it', name: 'Italiano' },
  { code: 'sk', name: 'Slovenčina' },
  { code: 'sv', name: 'Svenska' },
  { code: 'el', name: 'Ελληνικά' },
  { code: 'ru', name: 'Русский' },
  { code: 'mr', name: 'मराठी' },
  { code: 'hi', name: 'हिन्दी' },
  { code: 'bn', name: 'বাংলা' },
  { code: 'zh-Hans', name: '普通话（简体）' },
  { code: 'yue-Hant', name: '粵語（繁體）' },
  { code: 'wuu-Hans', name: '吴语（简体）' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
] as const;

export type Lang = (typeof LANGUAGES)[number]['code'];

export const DEFAULT_LANG: Lang = 'en';

export function isLang(v: unknown): v is Lang {
  return LANGUAGES.some((l) => l.code === v);
}

/**
 * The first of a browser's preferred languages the interface speaks, or null.
 *
 * Matched the way a person would: `fr-CA` is French, `pt` is nothing we have.
 * Chinese is matched by where it is from rather than by its first subtag alone,
 * because there are three of it here: Hong Kong and Macau speak Cantonese, a
 * `yue` or `wuu` tag says which it is outright, and the rest of Chinese — the
 * mainland, Singapore, Taiwan — is offered Mandarin, the one all of them share.
 */
export function matchLanguage(preferred: readonly string[]): Lang | null {
  for (const tag of preferred) {
    const parts = tag.toLowerCase().split(/[-_]/);
    const primary = parts[0] ?? '';

    const exact = LANGUAGES.find((l) => l.code.toLowerCase() === parts.join('-'));
    if (exact !== undefined) return exact.code;

    if (primary === 'yue') return 'yue-Hant';
    if (primary === 'wuu') return 'wuu-Hans';
    if (primary === 'zh') return parts.includes('hk') || parts.includes('mo') ? 'yue-Hant' : 'zh-Hans';
    // Indonesian's old code, which some systems still send.
    if (primary === 'in') return 'id';

    const base = LANGUAGES.find((l) => l.code === primary);
    if (base !== undefined) return base.code;
  }
  return null;
}
