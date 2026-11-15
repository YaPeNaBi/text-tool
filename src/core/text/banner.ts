/**
 * Huge letters, from one alphabet drawn several ways.
 *
 * The obvious way to ship banner fonts is the way figlet does it: one file of
 * finished artwork per font, every letter drawn by hand in that font's own
 * style. Five fonts is then five alphabets to author and five places for a
 * wonky `S` to hide.
 *
 * This does the thing the rest of the codebase keeps doing instead — one table,
 * several renderings (`tools.ts`, `ribbon-items.ts`, `palette.ts`, `steps.ts`).
 * The alphabet is a **bitmap**, five rows tall and three to five columns wide,
 * and a *style* is a function from that bitmap to characters. Fixing the shape
 * of a letter fixes it in every font at once, and a new font is a dozen lines
 * rather than a new alphabet.
 *
 * It also buys the one thing artwork cannot: the styles are free to disagree
 * about *size*. `Half` folds each pair of rows into one with `▀▄█` and comes out
 * three rows tall; `Wide` doubles every column; `Shadow` adds a row and a column.
 * Those are genuinely different fonts, not recolourings, and they all come off
 * the same twenty-six letters.
 *
 * One font is the exception, and knowingly so. `Lines` draws its letters out of
 * the editor's own strokes — `│ ─ ╭ ╮ ╰ ╯ ├ ┤ ┼ / \` — and a stroke font cannot
 * be a rendering of a solid bitmap: the bitmap's `A` has shoulders that step
 * diagonally, which solid blocks hide and lines cannot draw. So `Lines` is the
 * figlet way, one picture per character, and the reader matches those pictures
 * character for character exactly as it matches the bitmap (B-FONT-09).
 *
 * ── The bitmap ────────────────────────────────────────────────────────────
 *
 * `#` is on, `.` is off, `/` ends a row. Five rows, always; width varies per
 * glyph, which is what keeps `I` from sitting in a puddle of space. Lower case
 * is folded to upper — banner alphabets have one case, and a letter that
 * silently vanished would be worse than one that is merely capital.
 */

import type { Cell } from '../geom/cell.ts';

/** Every style renders this many rows of bitmap. */
export const ROWS = 5;

/**
 * The alphabet.
 *
 * Deliberately not exhaustive. It covers what a diagram label is made of —
 * letters, digits, and the punctuation that turns up in one — and anything else
 * renders as a hollow box (`TOFU`) rather than vanishing, so a character that
 * has no glyph *looks* like a character that has no glyph.
 */
const GLYPHS: Readonly<Record<string, string>> = {
  A: '.##./#..#/####/#..#/#..#',
  B: '###./#..#/###./#..#/###.',
  C: '.###/#.../#.../#.../.###',
  D: '###./#..#/#..#/#..#/###.',
  E: '####/#.../###./#.../####',
  F: '####/#.../###./#.../#...',
  G: '.###/#.../#.##/#..#/.###',
  H: '#..#/#..#/####/#..#/#..#',
  I: '###/.#./.#./.#./###',
  J: '..##/...#/...#/#..#/.##.',
  K: '#..#/#.#./##../#.#./#..#',
  L: '#.../#.../#.../#.../####',
  M: '#...#/##.##/#.#.#/#...#/#...#',
  N: '#...#/##..#/#.#.#/#..##/#...#',
  O: '.##./#..#/#..#/#..#/.##.',
  P: '###./#..#/###./#.../#...',
  Q: '.##./#..#/#..#/#.#./.#.#',
  R: '###./#..#/###./#.#./#..#',
  S: '.###/#.../.##./...#/###.',
  T: '#####/..#../..#../..#../..#..',
  U: '#..#/#..#/#..#/#..#/.##.',
  V: '#...#/#...#/#...#/.#.#./..#..',
  W: '#...#/#...#/#.#.#/##.##/#...#',
  X: '#...#/.#.#./..#../.#.#./#...#',
  Y: '#...#/.#.#./..#../..#../..#..',
  Z: '####/...#/..#./.#../####',

  '0': '.##./#.##/##.#/#..#/.##.',
  '1': '.#./##./.#./.#./###',
  '2': '###./...#/.##./#.../####',
  '3': '###./...#/.##./...#/###.',
  '4': '#..#/#..#/####/...#/...#',
  '5': '####/#.../###./...#/###.',
  '6': '.###/#.../###./#..#/.##.',
  '7': '####/...#/..#./.#../.#..',
  '8': '.##./#..#/.##./#..#/.##.',
  '9': '.##./#..#/.###/...#/###.',

  ' ': '../../../../..',
  '.': '../../../../#.',
  ',': '../../../.#/#.',
  ':': '../.#/../.#/..',
  ';': '../.#/../.#/#.',
  '!': '#/#/#/./#',
  '?': '###./...#/..#./..../..#.',
  '-': '..../..../####/..../....',
  '+': '.../.#./###/.#./...',
  '=': '..../####/..../####/....',
  '_': '..../..../..../..../####',
  '/': '...#/..#./.#../#.../....',
  '\\': '#.../.#../..#./...#/....',
  '(': '.#/#./#./#./.#',
  ')': '#./.#/.#/.#/#.',
  '[': '##/#./#./#./##',
  ']': '##/.#/.#/.#/##',
  '<': '..#/.#./#../.#./..#',
  '>': '#../.#./..#/.#./#..',
  '*': '.../#.#/.#./#.#/...',
  "'": '#/#/./././',
  '"': '#.#/#.#/...',
  '|': '#/#/#/#/#',
  '#': '.#.#./#####/.#.#./#####/.#.#.',
  '@': '.###./#...#/#.###/#..../.###.',
  '&': '.##../#..#./.##../#..#./.##.#',
  '%': '#...#/...#./..#../.#.../#...#',
};

/** What an unmapped character comes out as: visibly a missing glyph. */
const TOFU = '####/#..#/#..#/#..#/####';

/** The blank column between one letter and the next. */
export const TRACKING = 1;

/** The blank row between the lines of a multi-line banner, so they read apart. */
export const LEADING = 1;

/** A glyph as rows of booleans. */
function bitmapOf(ch: string): boolean[][] {
  const art = GLYPHS[ch] ?? GLYPHS[ch.toUpperCase()] ?? TOFU;
  const rows = art.split('/');
  const width = Math.max(...rows.map((r) => r.length));

  const out: boolean[][] = [];
  for (let y = 0; y < ROWS; y++) {
    const row = rows[y] ?? '';
    const cells: boolean[] = [];
    for (let x = 0; x < width; x++) cells.push(row[x] === '#');
    out.push(cells);
  }
  return out;
}

/** The whole string as one bitmap, letters laid side by side. */
function bitmapFor(text: string): boolean[][] {
  const grid: boolean[][] = Array.from({ length: ROWS }, () => []);
  const chars = [...text];

  chars.forEach((ch, i) => {
    const glyph = bitmapOf(ch);
    for (let y = 0; y < ROWS; y++) {
      const row = grid[y];
      const from = glyph[y];
      if (row === undefined || from === undefined) continue;
      row.push(...from);
      if (i < chars.length - 1) for (let t = 0; t < TRACKING; t++) row.push(false);
    }
  });
  return grid;
}

interface StyleBase {
  id: string;
  label: string;
  /** One line about what it looks like, for the menu's tooltip. */
  title: string;
  /** How many rows this style occupies. Not five for all of them. */
  height: number;
}

/** A font that is a rendering of the shared bitmap alphabet. */
export interface BitmapStyle extends StyleBase {
  /** Bitmap in, rows of characters out. */
  draw: (bits: readonly (readonly boolean[])[]) => string[];
  /**
   * The same rendering, **read back**: characters in, bitmap out, or null when
   * they are not this style's work.
   *
   * Here rather than in the reader because only the style knows what it did — that
   * `Wide` doubled every column, that `Half` folded two rows into one, that
   * `Shadow` added a row and a column of `░`. One table, both directions, so a
   * style cannot be drawn one way and read another.
   */
  read: (rows: readonly string[]) => boolean[][] | null;
}

/**
 * A font that is its own artwork: one picture per character, `height` rows
 * tall, read back by matching the pictures exactly (B-FONT-09).
 */
export interface ArtStyle extends StyleBase {
  art: Readonly<Record<string, readonly string[]>>;
}

export type BannerStyle = BitmapStyle | ArtStyle;

export function isArt(style: BannerStyle): style is ArtStyle {
  return 'art' in style;
}

/** The commonest shape: one character per lit cell, blank elsewhere. */
function solid(on: string): (bits: readonly (readonly boolean[])[]) => string[] {
  return (bits) => bits.map((row) => row.map((lit) => (lit ? on : ' ')).join(''));
}

/** …and its inverse: that character is on, a space is off, anything else is not ours. */
function readSolid(on: string): (rows: readonly string[]) => boolean[][] | null {
  return (rows) => {
    if (rows.length !== ROWS) return null;
    const width = Math.max(0, ...rows.map((r) => r.length));
    const out: boolean[][] = [];
    for (const row of rows) {
      const cells: boolean[] = [];
      for (let x = 0; x < width; x++) {
        const ch = row[x] ?? ' ';
        if (ch !== on && ch !== ' ') return null;
        cells.push(ch === on);
      }
      out.push(cells);
    }
    return out;
  };
}

/**
 * Two rows folded into one with half-blocks.
 *
 * The classic trick for a small banner, and the only style here that changes the
 * *proportions* rather than the texture: five rows become three, so a label fits
 * where the others would not. The last row has no partner and is drawn as an
 * upper half, which is what leaves it sitting on the baseline rather than
 * floating above it.
 */
function halfBlocks(bits: readonly (readonly boolean[])[]): string[] {
  const out: string[] = [];
  for (let y = 0; y < bits.length; y += 2) {
    const top = bits[y] ?? [];
    const bottom = bits[y + 1] ?? [];
    let line = '';
    for (let x = 0; x < top.length; x++) {
      const a = top[x] === true;
      const b = bottom[x] === true;
      line += a && b ? '█' : a ? '▀' : b ? '▄' : ' ';
    }
    out.push(line);
  }
  return out;
}

/** Every column drawn twice, for letters with some weight to them. */
function wide(bits: readonly (readonly boolean[])[]): string[] {
  return bits.map((row) => row.map((lit) => (lit ? '██' : '  ')).join(''));
}

/**
 * Wide, read back: column pairs collapse to one.
 *
 * A pair that disagrees is refused rather than guessed at. Half a doubled column
 * means something has been drawn over this and it is no longer a banner — saying
 * so is what keeps typing from re-rendering over somebody else's characters.
 *
 * The width is always even, which is worth knowing rather than checking twice: a
 * bitmap column is either two blocks or two spaces, and right-trimming a row can
 * only take whole pairs off the end of it.
 */
function readWide(rows: readonly string[]): boolean[][] | null {
  if (rows.length !== ROWS) return null;
  const width = Math.max(0, ...rows.map((r) => r.length));
  if (width % 2 !== 0) return null;

  const out: boolean[][] = [];
  for (const row of rows) {
    const cells: boolean[] = [];
    for (let x = 0; x < width; x += 2) {
      const a = row[x] ?? ' ';
      const b = row[x + 1] ?? ' ';
      if (a !== b) return null;
      if (a !== '█' && a !== ' ') return null;
      cells.push(a === '█');
    }
    out.push(cells);
  }
  return out;
}

/** Half-blocks, read back: each character unfolds into the two rows it stood for. */
function readHalfBlocks(rows: readonly string[]): boolean[][] | null {
  if (rows.length !== Math.ceil(ROWS / 2)) return null;
  const width = Math.max(0, ...rows.map((r) => r.length));
  const out: boolean[][] = Array.from({ length: rows.length * 2 }, () => [] as boolean[]);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? '';
    const top = out[i * 2];
    const bottom = out[i * 2 + 1];
    if (top === undefined || bottom === undefined) return null;

    for (let x = 0; x < width; x++) {
      const ch = row[x] ?? ' ';
      if (ch !== '█' && ch !== '▀' && ch !== '▄' && ch !== ' ') return null;
      top.push(ch === '█' || ch === '▀');
      bottom.push(ch === '█' || ch === '▄');
    }
  }
  // The fold rounded the height up; the row it invented is blank by construction.
  return out.slice(0, ROWS);
}

/**
 * Solid blocks with a light shadow cast down and to the right.
 *
 * A row and a column taller and wider than the rest, which is the point: it is
 * the one style that does not fit the same box, and having one such style keeps
 * the callers honest about asking how big a rendering came out.
 */
function shadowed(bits: readonly (readonly boolean[])[]): string[] {
  const height = bits.length;
  const width = Math.max(0, ...bits.map((r) => r.length));
  const out: string[] = [];

  for (let y = 0; y <= height; y++) {
    let line = '';
    for (let x = 0; x <= width; x++) {
      const lit = bits[y]?.[x] === true;
      const behind = bits[y - 1]?.[x - 1] === true;
      line += lit ? '█' : behind ? '░' : ' ';
    }
    out.push(line);
  }
  return out;
}

/** Shadow, read back: the block is the letter and the `░` is only its shadow. */
function readShadowed(rows: readonly string[]): boolean[][] | null {
  if (rows.length !== ROWS + 1) return null;
  const width = Math.max(0, ...rows.map((r) => r.length));
  const out: boolean[][] = [];

  for (let y = 0; y < ROWS; y++) {
    const row = rows[y] ?? '';
    const cells: boolean[] = [];
    for (let x = 0; x < width; x++) {
      const ch = row[x] ?? ' ';
      if (ch !== '█' && ch !== '░' && ch !== ' ') return null;
      cells.push(ch === '█');
    }
    out.push(cells);
  }
  return out;
}

/**
 * Letters drawn from the editor's own strokes (B-FONT-09).
 *
 * Five rows like the bitmap, so the fonts line up when mixed. Rounded corners
 * where a stroke turns, junctions where strokes meet, slashes where a letter
 * leans — `K`, `V`, `X`, `Z` — and the two half-stubs `╵ ╷` only for the
 * punctuation that is a dot. Every picture is distinct from every other, which
 * the reader relies on and a test checks; widths vary as the bitmap's do. A
 * picture that is only a stroke or two is ambiguous about which rows it sits on
 * when nothing stands beside it, and the reader settles that by taking the band
 * that accounts for the most cells (`readBanner`).
 *
 * Rows are strings, not `/`-joined, because `/` is a stroke here.
 */
const LINE_ART: Readonly<Record<string, readonly string[]>> = {
  A: ['╭─╮', '│ │', '├─┤', '│ │', '│ │'],
  B: ['┌─╮', '│ │', '├─┤', '│ │', '└─╯'],
  C: ['╭──', '│  ', '│  ', '│  ', '╰──'],
  D: ['┌─╮', '│ │', '│ │', '│ │', '└─╯'],
  E: ['┌──', '│  ', '├─ ', '│  ', '└──'],
  F: ['┌──', '│  ', '├─ ', '│  ', '│  '],
  G: ['╭──', '│  ', '│ ╮', '│ │', '╰─╯'],
  H: ['│ │', '│ │', '├─┤', '│ │', '│ │'],
  I: ['─┬─', ' │ ', ' │ ', ' │ ', '─┴─'],
  J: ['──┬', '  │', '  │', '  │', '╰─╯'],
  K: ['│ /', '│/ ', '│  ', '│\\ ', '│ \\'],
  L: ['│  ', '│  ', '│  ', '│  ', '└──'],
  M: ['│\\ /│', '│ V │', '│   │', '│   │', '│   │'],
  N: ['│  │', '│\\ │', '│ \\│', '│  │', '│  │'],
  O: ['╭─╮', '│ │', '│ │', '│ │', '╰─╯'],
  P: ['┌─╮', '│ │', '├─╯', '│  ', '│  '],
  Q: ['╭─╮ ', '│ │ ', '│ │ ', '│ │ ', '╰─╯\\'],
  R: ['┌─╮', '│ │', '├─╯', '│\\ ', '│ \\'],
  S: ['╭──', '│  ', '╰─╮', '  │', '──╯'],
  T: ['─┬─', ' │ ', ' │ ', ' │ ', ' │ '],
  U: ['│ │', '│ │', '│ │', '│ │', '╰─╯'],
  V: ['│ │', '│ │', '│ │', '\\ /', ' V '],
  W: ['│   │', '│   │', '│ │ │', '│ │ │', '╰─┴─╯'],
  X: ['\\ /', '\\ /', ' ╳ ', '/ \\', '/ \\'],
  Y: ['\\ /', ' V ', ' │ ', ' │ ', ' │ '],
  Z: ['───', '  /', ' / ', '/  ', '───'],

  '0': ['╭─╮', '│ │', '│/│', '│ │', '╰─╯'],
  '1': [' /│', '  │', '  │', '  │', '─┴─'],
  '2': ['╭─╮', '  │', '╭─╯', '│  ', '└──'],
  '3': ['╭─╮', '  │', ' ─┤', '  │', '╰─╯'],
  '4': ['│ │', '│ │', '╰─┤', '  │', '  │'],
  '5': ['┌──', '│  ', '╰─╮', '  │', '╰─╯'],
  '6': ['╭──', '│  ', '├─╮', '│ │', '╰─╯'],
  '7': ['───', '  /', ' / ', ' │ ', ' │ '],
  '8': ['╭─╮', '│ │', '├─┤', '│ │', '╰─╯'],
  '9': ['╭─╮', '│ │', '╰─┤', '  │', '──╯'],

  ' ': ['  ', '  ', '  ', '  ', '  '],
  '.': [' ', ' ', ' ', ' ', '╵'],
  ',': [' ', ' ', ' ', '╷', '╯'],
  ':': [' ', '╵', ' ', '╵', ' '],
  ';': [' ', '╵', ' ', '╷', '╯'],
  '!': ['│', '│', '│', ' ', '╵'],
  '?': ['╭─╮', '  │', ' ╭╯', '   ', ' ╵ '],
  '-': ['   ', '   ', '───', '   ', '   '],
  '+': ['   ', ' │ ', '─┼─', ' │ ', '   '],
  '=': ['   ', '───', '   ', '───', '   '],
  '_': ['   ', '   ', '   ', '   ', '───'],
  '/': ['  /', '  /', ' / ', '/  ', '/  '],
  '\\': ['\\  ', '\\  ', ' \\ ', '  \\', '  \\'],
  '(': ['╭', '│', '│', '│', '╰'],
  ')': ['╮', '│', '│', '│', '╯'],
  '[': ['┌─', '│ ', '│ ', '│ ', '└─'],
  ']': ['─┐', ' │', ' │', ' │', '─┘'],
  '<': ['  /', ' / ', '<  ', ' \\ ', '  \\'],
  '>': ['\\  ', ' \\ ', '  >', ' / ', '/  '],
  '*': ['   ', '\\│/', '─┼─', '/│\\', '   '],
  // Down-stubs, where the full stop is an up-stub: a lone stub must say which
  // row it is on, or a band five rows too high would read a `.` as a `'`.
  "'": ['╷', ' ', ' ', ' ', ' '],
  '"': ['╷╷', '  ', '  ', '  ', '  '],
  '|': ['│', '│', '│', '│', '│'],
  '#': [' │ │ ', '─┼─┼─', ' │ │ ', '─┼─┼─', ' │ │ '],
  '@': ['╭──╮', '│╭─┤', '│╰─┤', '│   ', '╰───'],
  '&': ['╭╮  ', '││  ', '╰┼─╮', '╭╯ │', '╰──╯'],
  '%': ['╭╮ /', '╰╯/ ', ' /  ', '/ ╭╮', '  ╰╯'],
};

/** What an unmapped character comes out as in `Lines`: a box, visibly nothing. */
const LINE_TOFU: readonly string[] = ['┌─┐', '│ │', '│ │', '│ │', '└─┘'];

/** One character's picture, every row padded to the picture's width. */
export function pictureOf(ch: string, style: ArtStyle): string[] {
  const rows = style.art[ch] ?? style.art[ch.toUpperCase()] ?? LINE_TOFU;
  const width = Math.max(0, ...rows.map((r) => r.length));
  const out: string[] = [];
  for (let y = 0; y < style.height; y++) out.push((rows[y] ?? '').padEnd(width));
  return out;
}

/** Pictures laid side by side with a tracking column between, right-trimmed. */
function composeArt(text: string, style: ArtStyle): string[] {
  const rows: string[] = Array.from({ length: style.height }, () => '');
  const chars = [...text];
  chars.forEach((ch, i) => {
    const pic = pictureOf(ch, style);
    for (let y = 0; y < style.height; y++) {
      rows[y] = (rows[y] ?? '') + (pic[y] ?? '') + (i < chars.length - 1 ? ' '.repeat(TRACKING) : '');
    }
  });
  return rows.map((row) => row.replace(/\s+$/, ''));
}

/**
 * The fonts on offer, in the order the menu shows them.
 *
 * Six, which is deliberately more than the five a menu row shows at once — a
 * list that never needed scrolling would not prove that scrolling works. All of
 * them use glyphs every terminal and browser this editor targets has had for
 * decades; the pure-ASCII pair that used to lead the list earned their place
 * nowhere and are gone.
 */
export const BANNER_STYLES: readonly BannerStyle[] = [
  { id: 'block', label: 'Block', title: 'Solid block letters', draw: solid('█'), read: readSolid('█'), height: ROWS },
  { id: 'shade', label: 'Shade', title: 'Block letters in a lighter shade', draw: solid('▓'), read: readSolid('▓'), height: ROWS },
  { id: 'wide', label: 'Wide', title: 'Block letters, twice as wide', draw: wide, read: readWide, height: ROWS },
  { id: 'half', label: 'Half', title: 'Half-height letters, three rows instead of five', draw: halfBlocks, read: readHalfBlocks, height: Math.ceil(ROWS / 2) },
  { id: 'shadow', label: 'Shadow', title: 'Block letters with a dropped shadow', draw: shadowed, read: readShadowed, height: ROWS + 1 },
  { id: 'lines', label: 'Lines', title: 'Letters drawn from line strokes: │ ─ ╭ ╯ ┼ /', art: LINE_ART, height: ROWS },
];

/**
 * A bitmap exercising every combination a style could care about.
 *
 * Four columns, so that each **pair** of rows covers on/on, on/off, off/on and
 * off/off. That is more than it looks: `Half` folds two rows into one character,
 * so a probe without an on/on column never produces a `█` at all, and a style
 * whose commonest character is missing from `glyphsOf` is a style that a click
 * never tries. Which is exactly the bug this shape fixes.
 */
const PROBE: readonly (readonly boolean[])[] = [
  [true, true, false, false],
  [true, false, true, false],
  [true, true, false, false],
  [true, false, true, false],
  [true, true, false, false],
];

/**
 * The characters a style draws with, for narrowing down which one made a cell.
 *
 * Derived by drawing rather than listed, so it cannot fall out of step with the
 * style — a new font is a `draw` function and nothing else to remember.
 */
const glyphCache = new Map<string, Set<string>>();

export function glyphsOf(style: BannerStyle): Set<string> {
  // Memoised because `recognize` asks every style on every single click, and
  // the answer is a property of the style rather than of the document.
  const hit = glyphCache.get(style.id);
  if (hit !== undefined) return hit;

  const out = new Set<string>();
  if (isArt(style)) {
    // Every stroke any picture uses: the artwork is the probe.
    for (const rows of Object.values(style.art)) {
      for (const row of rows) for (const ch of row) if (ch !== ' ') out.add(ch);
    }
  } else {
    for (const row of style.draw(PROBE)) {
      for (const ch of row) if (ch !== ' ') out.add(ch);
    }
  }
  glyphCache.set(style.id, out);
  return out;
}

/**
 * How many screen columns one bitmap column costs in this style.
 *
 * Measured as the *difference* two columns make rather than the width of one,
 * because `Shadow` adds a fixed column of its own: drawing one column gives 2 and
 * drawing two gives 3, so asking "how wide is one column" would answer 2 and be
 * wrong about every gap. The difference is 1 for it and 2 for `Wide`, which is
 * what the reader needs to know when it measures a blank gap in screen columns.
 */
const stretchCache = new Map<string, number>();

export function stretchOf(style: BannerStyle): number {
  if (isArt(style)) return 1; // a picture is already in screen columns
  const seen = stretchCache.get(style.id);
  if (seen !== undefined) return seen;
  const one = style.draw(PROBE.map((r) => r.slice(0, 1)));
  const two = style.draw(PROBE.map((r) => r.slice(0, 2)));
  const wide = Math.max(0, ...two.map((r) => r.length));
  const narrow = Math.max(0, ...one.map((r) => r.length));
  const stretch = Math.max(1, wide - narrow);
  stretchCache.set(style.id, stretch);
  return stretch;
}

/** The bitmap of one character, for the reader to match against. */
export function glyphBitmap(ch: string): boolean[][] {
  return bitmapOf(ch);
}

/** Every character the alphabet can draw, widest first — the order a parse wants. */
let sorted: string[] | null = null;

export function alphabet(): string[] {
  if (sorted !== null) return sorted;
  sorted = Object.keys(GLYPHS).sort((a, b) => {
    const wa = bitmapOf(a)[0]?.length ?? 0;
    const wb = bitmapOf(b)[0]?.length ?? 0;
    // Widest first so a narrow glyph cannot match the front of a wide one; the
    // space last of all, since an all-blank glyph matches any blank columns.
    if (a === ' ') return 1;
    if (b === ' ') return -1;
    return wb - wa;
  });
  return sorted;
}

/** Every character an art font can draw, widest first — the order a parse wants. */
const artSorted = new Map<string, string[]>();

export function artAlphabet(style: ArtStyle): string[] {
  const hit = artSorted.get(style.id);
  if (hit !== undefined) return hit;
  const widthOf = (ch: string): number => pictureOf(ch, style)[0]?.length ?? 0;
  const out = Object.keys(style.art).sort((a, b) => {
    if (a === ' ') return 1;
    if (b === ' ') return -1;
    return widthOf(b) - widthOf(a);
  });
  artSorted.set(style.id, out);
  return out;
}

export function styleFor(id: string): BannerStyle | undefined {
  return BANNER_STYLES.find((s) => s.id === id);
}

/** How many screen columns one character takes in this style, tracking excluded. */
export function charColumns(ch: string, style: BannerStyle): number {
  if (isArt(style)) return pictureOf(ch, style)[0]?.length ?? 0;
  return (bitmapOf(ch)[0]?.length ?? 0) * stretchOf(style);
}

/** One character's screen columns within its line, inclusive, relative to the origin. */
export interface Span {
  from: number;
  to: number;
}

/**
 * Where each character of a line sits, in screen columns from the line's origin.
 *
 * The layout question the caret and the word reading both ask, answered once
 * from the same numbers the renderer uses: a glyph's width in this style, and a
 * tracking column after it. Nothing is measured off the grid, so a letter whose
 * first column is blank — `G`, `:` — still has its span where the renderer
 * put it.
 */
export function spansOf(line: string, style: BannerStyle): Span[] {
  const gap = TRACKING * stretchOf(style);
  const out: Span[] = [];
  let x = 0;
  for (const ch of line) {
    const w = charColumns(ch, style);
    out.push({ from: x, to: x + w - 1 });
    x += w + gap;
  }
  return out;
}

/** Row and column of a caret index within multi-line text, by code point. */
function placeOf(text: string, caret: number): { line: number; col: number; lineText: string } {
  const chars = [...text];
  const at = Math.max(0, Math.min(caret, chars.length));
  let line = 0;
  let start = 0;
  for (let i = 0; i < at; i++) {
    if (chars[i] === '\n') {
      line++;
      start = i + 1;
    }
  }
  let end = chars.indexOf('\n', start);
  if (end === -1) end = chars.length;
  return { line, col: at - start, lineText: chars.slice(start, end).join('') };
}

/**
 * The cell a caret stands at: the left edge of the character it is before, or
 * the column after the last one on its line — so the bar sits where the next
 * letter would begin (B-FONT-06). Lines are a font-height and a leading row apart.
 */
export function caretCell(origin: Cell, text: string, caret: number, style: BannerStyle): Cell {
  const { line, col, lineText } = placeOf(text, caret);
  const spans = spansOf(lineText, style);
  const span = spans[col];
  const last = spans[spans.length - 1];
  const dx = span !== undefined ? span.from : last === undefined ? 0 : last.to + 1;
  return { x: origin.x + dx, y: origin.y + line * (style.height + LEADING) };
}

/**
 * The caret index a click on `cell` means: before the letter it landed on, or
 * after it when it landed in the letter's right half; the end of the line past
 * its last letter. Rows between lines belong to the line above them.
 */
export function caretAt(origin: Cell, text: string, style: BannerStyle, cell: Cell): number {
  const lines = text.split('\n');
  const pitch = style.height + LEADING;
  const line = Math.max(0, Math.min(lines.length - 1, Math.floor((cell.y - origin.y) / pitch)));

  let index = 0;
  for (let k = 0; k < line; k++) index += [...(lines[k] ?? '')].length + 1;

  const lineText = lines[line] ?? '';
  const spans = spansOf(lineText, style);
  const x = cell.x - origin.x;
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i] as Span;
    if (x > s.to) continue;
    return index + i + (x > s.from + (s.to - s.from) / 2 ? 1 : 0);
  }
  return index + spans.length;
}

/**
 * A caret moved by a key: one character sideways, or one line up or down keeping
 * its column as far as the other line has one. Clamped at the ends of the text.
 */
export function shiftCaret(text: string, caret: number, dx: number, dy: number): number {
  const chars = [...text];
  if (dy === 0) return Math.max(0, Math.min(chars.length, caret + dx));

  const { line, col } = placeOf(text, caret);
  const lines = text.split('\n');
  const target = line + dy;
  if (target < 0 || target >= lines.length) return caret;

  let index = 0;
  for (let k = 0; k < target; k++) index += [...(lines[k] ?? '')].length + 1;
  return index + Math.min(col, [...(lines[target] ?? '')].length);
}

/**
 * A text-field keystroke at a caret (B-FONT-06): a character or a newline goes
 * in before it, `Backspace` takes the one before it out and `Delete` the one
 * after. Null when there is nothing to take, so the caller draws nothing.
 */
export function typedAt(
  text: string,
  caret: number,
  key: string,
): { text: string; caret: number } | null {
  const chars = [...text];
  const at = Math.max(0, Math.min(chars.length, caret));
  if (key === 'Backspace') {
    if (at === 0) return null;
    return { text: [...chars.slice(0, at - 1), ...chars.slice(at)].join(''), caret: at - 1 };
  }
  if (key === 'Delete') {
    if (at >= chars.length) return null;
    return { text: [...chars.slice(0, at), ...chars.slice(at + 1)].join(''), caret: at };
  }
  const put = key === 'Enter' ? '\n' : key;
  return { text: [...chars.slice(0, at), put, ...chars.slice(at)].join(''), caret: at + 1 };
}

/** The caret at the start or the end of its own line. */
export function caretLineEdge(text: string, caret: number, where: 'home' | 'end'): number {
  const { col, lineText } = placeOf(text, caret);
  const start = caret - col;
  return where === 'home' ? start : start + [...lineText].length;
}

/**
 * A line of text as banner rows, right-trimmed.
 *
 * Trimmed because the rows go straight into the document, and a row of trailing
 * spaces is a row of cells that would occlude whatever they land on while
 * showing nothing (B-TXT-01 trims the same way on the way out).
 */
export function renderBanner(text: string, style: BannerStyle): string[] {
  if (text === '') return [];
  if (isArt(style)) return composeArt(text, style);
  return style.draw(bitmapFor(text)).map((row) => row.replace(/\s+$/, ''));
}
