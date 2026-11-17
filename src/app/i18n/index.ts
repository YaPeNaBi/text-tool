/**
 * Translation (B-UI-19).
 *
 * Every word the interface shows is a key in `catalogs/en.ts`, and each language
 * is one more catalog with the same keys. A missing translation falls back to
 * English rather than to nothing, so a string added in English is never a hole
 * in another language — and a test holds every shipped language to the full
 * set, so the fallback is a net, not the plan.
 *
 * Pure and synchronous: it is handed the language rather than reading it, so
 * the store, the components and the terminal's key band can all call it without
 * any of them importing the others, and a frame never waits on a word.
 *
 * English ships with the page; every other language is its own file, fetched
 * the first time it is chosen (`loadLanguage`). Seventeen catalogs are more
 * text than the rest of the editor put together, and a reader reads one of
 * them. A language not loaded yet reads as English, which is why the store only
 * switches once its catalog is in.
 */

import { EN, type MessageKey } from './catalogs/en.ts';
import type { Lang } from './languages.ts';
import type { Catalog, Message, Params } from './types.ts';

export type { MessageKey } from './catalogs/en.ts';
export type { Lang } from './languages.ts';
export type { Params } from './types.ts';

/** Where each catalog but English comes from. A literal path each, so the bundler splits them. */
const LOADERS: Readonly<Record<Exclude<Lang, 'en'>, () => Promise<Catalog>>> = {
  fr: async () => (await import('./catalogs/fr.ts')).FR,
  es: async () => (await import('./catalogs/es.ts')).ES,
  de: async () => (await import('./catalogs/de.ts')).DE,
  it: async () => (await import('./catalogs/it.ts')).IT,
  sv: async () => (await import('./catalogs/sv.ts')).SV,
  sk: async () => (await import('./catalogs/sk.ts')).SK,
  el: async () => (await import('./catalogs/el.ts')).EL,
  ru: async () => (await import('./catalogs/ru.ts')).RU,
  hi: async () => (await import('./catalogs/hi.ts')).HI,
  bn: async () => (await import('./catalogs/bn.ts')).BN,
  mr: async () => (await import('./catalogs/mr.ts')).MR,
  'zh-Hans': async () => (await import('./catalogs/zh.ts')).ZH,
  'yue-Hant': async () => (await import('./catalogs/yue.ts')).YUE,
  'wuu-Hans': async () => (await import('./catalogs/wuu.ts')).WUU,
  ja: async () => (await import('./catalogs/ja.ts')).JA,
  ko: async () => (await import('./catalogs/ko.ts')).KO,
  id: async () => (await import('./catalogs/id.ts')).ID,
};

const loaded = new Map<Lang, Catalog>([['en', EN]]);

/** True when a language can be shown without waiting. */
export function isLoaded(lang: Lang): boolean {
  return loaded.has(lang);
}

/** Fetch a language's catalog, once; later calls are answered from memory. */
export async function loadLanguage(lang: Lang): Promise<Catalog> {
  const have = loaded.get(lang);
  if (have !== undefined) return have;
  const catalog = await LOADERS[lang as Exclude<Lang, 'en'>]();
  loaded.set(lang, catalog);
  return catalog;
}

/** A language's catalog, if it has been loaded. */
export function catalogOf(lang: Lang): Catalog | undefined {
  return loaded.get(lang);
}

export type Translate = (key: MessageKey, params?: Params) => string;

const plurals = new Map<string, Intl.PluralRules>();

function pluralOf(lang: string, count: number): Intl.LDMLPluralRule {
  let rules = plurals.get(lang);
  if (rules === undefined) {
    rules = new Intl.PluralRules(lang);
    plurals.set(lang, rules);
  }
  return rules.select(count);
}

function pick(msg: Message, lang: string, count: number | undefined): string {
  if (typeof msg === 'string') return msg;
  if (count === undefined) return msg.other;
  return msg[pluralOf(lang, count)] ?? msg.other;
}

/** One message in one language, its placeholders filled. */
export function translate(lang: Lang, key: MessageKey, params?: Params): string {
  const own = loaded.get(lang)?.[key];
  const msg: Message = own ?? EN[key];
  const count = params?.['count'];
  // A fallback to English counts in English, whose plural forms are the ones it has.
  const text = pick(msg, own === undefined ? 'en' : lang, typeof count === 'number' ? count : undefined);
  if (params === undefined) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name];
    return value === undefined ? whole : String(value);
  });
}

/** `translate`, with the language already chosen. */
export function translator(lang: Lang): Translate {
  return (key, params) => translate(lang, key, params);
}

/**
 * The key chips that are words. `click` is not a key at all, `Space` is a word
 * everywhere, and some keyboards print their own names on the rest — a German
 * one says `Strg` where an English one says `Ctrl`. The letters, digits and
 * arrows are the same on every keyboard and are drawn as they are.
 */
const KEY_WORDS: Readonly<Record<string, MessageKey>> = {
  click: 'key.click',
  Space: 'key.space',
  Ctrl: 'key.ctrl',
  Shift: 'key.shift',
  Alt: 'key.alt',
  Enter: 'key.enter',
  Esc: 'key.esc',
  Tab: 'key.tab',
  Delete: 'key.delete',
  Insert: 'key.insert',
};

export function keyLabel(key: string, t: Translate): string {
  const word = KEY_WORDS[key];
  return word === undefined ? key : t(word);
}
