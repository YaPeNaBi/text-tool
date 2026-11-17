/**
 * The shapes a translation takes (B-UI-19).
 */

import type { MessageKey } from './catalogs/en.ts';

/**
 * A message with a count in it, in the plural forms a language distinguishes.
 *
 * The categories are `Intl.PluralRules`' own: Russian and Slovak use `few` and
 * `many`, most languages only `one`, and Chinese, Japanese, Korean and
 * Indonesian none at all — so `other` is the one form every message has, and the
 * one a language without plurals writes alone.
 */
export interface Plural {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
}

export type Message = string | Plural;

/** Values for a message's `{name}` placeholders. `count` also picks the plural form. */
export type Params = Readonly<Record<string, string | number>>;

/**
 * One language's messages. Every key is optional to the type, so a string added
 * in English shows in English until it is translated rather than failing the
 * build; a test holds every shipped language to the full set.
 */
export type Catalog = { readonly [K in MessageKey]?: Message };
