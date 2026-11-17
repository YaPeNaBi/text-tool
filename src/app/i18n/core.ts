/**
 * What the core says, in the interface's language (B-UI-19).
 *
 * The core is pure and English: a planner that refuses says why in a sentence,
 * the recognizer names what it found, a character set and a font each carry a
 * label. Rather than teach every planner about languages, the sentences are
 * recognised here — each one a pattern with its numbers picked out — and said
 * again in the language the editor is in. A sentence nobody taught this file is
 * shown as the core wrote it, and a test runs the real planners so that a
 * sentence changed in the core cannot quietly stop being translated.
 */

import type { Candidate } from '../../core/recognize/recognize.ts';
import type { MessageKey } from './catalogs/en.ts';
import type { Translate } from './index.ts';

const CHARSETS: Readonly<Record<string, MessageKey>> = {
  unicode: 'charset.unicode',
  rounded: 'charset.rounded',
  heavy: 'charset.heavy',
  double: 'charset.double',
  ascii: 'charset.ascii',
};

const FONTS: Readonly<Record<string, readonly [MessageKey, MessageKey]>> = {
  block: ['font.block', 'font.block.title'],
  shade: ['font.shade', 'font.shade.title'],
  wide: ['font.wide', 'font.wide.title'],
  half: ['font.half', 'font.half.title'],
  shadow: ['font.shadow', 'font.shadow.title'],
  lines: ['font.lines', 'font.lines.title'],
};

/** A character set's name, or `fallback` for one this file does not know. */
export function charsetLabel(id: string, fallback: string, t: Translate): string {
  const key = CHARSETS[id];
  return key === undefined ? fallback : t(key);
}

export function fontLabel(id: string, fallback: string, t: Translate): string {
  const keys = FONTS[id];
  return keys === undefined ? fallback : t(keys[0]);
}

export function fontTitle(id: string, fallback: string, t: Translate): string {
  const keys = FONTS[id];
  return keys === undefined ? fallback : t(keys[1]);
}

/** How the status bar names a selection: `describe` from the core, translated. */
export function describeSelection(c: Candidate, t: Translate): string {
  const size = `${String(c.bounds.w)}×${String(c.bounds.h)}`;
  switch (c.kind) {
    case 'box':
      return t('sel.box', { size });
    case 'ellipse':
      return t(c.bounds.w === c.bounds.h ? 'sel.circle' : 'sel.ellipse', { size });
    case 'arrow':
      return t('sel.arrow', { count: c.cells.size });
    case 'line':
      return t('sel.line', { count: c.cells.size });
    case 'text':
      return t('sel.text', { count: c.cells.size });
    case 'banner': {
      if (c.banner === undefined) return t('sel.bannerBare', { size });
      // One line of it, however many there are: the status bar is one line too.
      const [first = '', ...rest] = c.banner.text.split('\n');
      const text = rest.length > 0 ? `${first}…` : first;
      return t('sel.banner', { text, font: fontLabel(c.banner.styleId, c.banner.styleId, t) });
    }
    case 'cells':
      return t('sel.cells', { size });
  }
}

/** Every sentence a planner can say, with where its number is. */
const PLANNER: ReadonlyArray<{ re: RegExp; key: MessageKey; param?: string }> = [
  { re: /^Nothing to set in a font$/, key: 'plan.nothingToSet' },
  { re: /^Nothing to turn back into text$/, key: 'plan.nothingToUnset' },
  { re: /^(\d+) rows tall — check what it covers$/, key: 'plan.rowsTall', param: 'count' },
  { re: /^Cannot shrink past the contents — move or shorten them first$/, key: 'plan.cannotShrink' },
  { re: /^Only a line has ends to set$/, key: 'plan.onlyLineEnds' },
  { re: /^That end is not there any more$/, key: 'plan.endGone' },
  { re: /^Only a box can take a column$/, key: 'plan.onlyBoxColumn' },
  { re: /^Only a box can take a row$/, key: 'plan.onlyBoxRow' },
  { re: /^Column added, (\d+) wide$/, key: 'plan.columnAdded', param: 'width' },
  { re: /^Row added, (\d+) tall$/, key: 'plan.rowAdded', param: 'height' },
  { re: /^No clear route — the line goes straight there$/, key: 'plan.noRoute' },
  { re: /^(\d+) lines had no clear route — they go straight there$/, key: 'plan.noRoutes', param: 'count' },
];

/** The one suffix any note can carry: a row added pushes what was below it down. */
const PUSHED = /^(.*) · (\d+) cells pushed down$/;

/** A planner's refusal or note, in the interface's language. */
export function localizePlanText(text: string, t: Translate): string {
  const pushed = PUSHED.exec(text);
  if (pushed !== null) {
    const before = localizePlanText(pushed[1] ?? '', t);
    return `${before} · ${t('plan.pushedDown', { count: Number(pushed[2]) })}`;
  }
  for (const { re, key, param } of PLANNER) {
    const m = re.exec(text);
    if (m === null) continue;
    return param === undefined ? t(key) : t(key, { [param]: Number(m[1]) });
  }
  return text;
}
