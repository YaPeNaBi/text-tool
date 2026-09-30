/**
 * Huge letters, from one alphabet drawn several ways.
 *
 * The obvious way to ship banner fonts is the way figlet does it: one file of
 * finished artwork per font, every letter drawn by hand in that font's own
 * style. Six fonts is then six alphabets to author and six places for a wonky
 * `S` to hide.
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
 * ── The bitmap ────────────────────────────────────────────────────────────
 *
 * `#` is on, `.` is off, `/` ends a row. Five rows, always; width varies per
 * glyph, which is what keeps `I` from sitting in a puddle of space. Lower case
 * is folded to upper — banner alphabets have one case, and a letter that
 * silently vanished would be worse than one that is merely capital.
 */

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

export interface BannerStyle {
  id: string;
  label: string;
  /** One line about what it looks like, for the menu's tooltip. */
  title: string;
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
  /** How many rows this style occupies. Not five for all of them. */
  height: number;
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
 * The fonts on offer, in the order the menu shows them.
 *
 * Six, which is deliberately more than the five a menu row shows at once — a
 * list that never needed scrolling would not prove that scrolling works.
 *
 * `Hash` and `Stars` are pure ASCII and survive anywhere, including a document
 * opened in something that cannot show box-drawing characters; the rest use
 * block glyphs, which every terminal and browser this editor targets has had
 * for decades. That is why the plain-ASCII pair come first.
 */
export const BANNER_STYLES: readonly BannerStyle[] = [
  { id: 'hash', label: 'Hash', title: 'Solid letters built from #, pure ASCII', draw: solid('#'), read: readSolid('#'), height: ROWS },
  { id: 'stars', label: 'Stars', title: 'The same letters in *, pure ASCII', draw: solid('*'), read: readSolid('*'), height: ROWS },
  { id: 'block', label: 'Block', title: 'Solid block letters', draw: solid('█'), read: readSolid('█'), height: ROWS },
  { id: 'shade', label: 'Shade', title: 'Block letters in a lighter shade', draw: solid('▓'), read: readSolid('▓'), height: ROWS },
  { id: 'wide', label: 'Wide', title: 'Block letters, twice as wide', draw: wide, read: readWide, height: ROWS },
  { id: 'half', label: 'Half', title: 'Half-height letters, three rows instead of five', draw: halfBlocks, read: readHalfBlocks, height: Math.ceil(ROWS / 2) },
  { id: 'shadow', label: 'Shadow', title: 'Block letters with a dropped shadow', draw: shadowed, read: readShadowed, height: ROWS + 1 },
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
  // Memoised because `recognize` asks all seven styles on every single click,
  // and the answer is a property of the style rather than of the document.
  const hit = glyphCache.get(style.id);
  if (hit !== undefined) return hit;

  const out = new Set<string>();
  for (const row of style.draw(PROBE)) {
    for (const ch of row) if (ch !== ' ') out.add(ch);
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

export function styleFor(id: string): BannerStyle | undefined {
  return BANNER_STYLES.find((s) => s.id === id);
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
  return style.draw(bitmapFor(text)).map((row) => row.replace(/\s+$/, ''));
}
