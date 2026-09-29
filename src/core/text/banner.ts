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
const ROWS = 5;

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
const TRACKING = 1;

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
}

/** The commonest shape: one character per lit cell, blank elsewhere. */
function solid(on: string): (bits: readonly (readonly boolean[])[]) => string[] {
  return (bits) => bits.map((row) => row.map((lit) => (lit ? on : ' ')).join(''));
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
  { id: 'hash', label: 'Hash', title: 'Solid letters built from #, pure ASCII', draw: solid('#') },
  { id: 'stars', label: 'Stars', title: 'The same letters in *, pure ASCII', draw: solid('*') },
  { id: 'block', label: 'Block', title: 'Solid block letters', draw: solid('█') },
  { id: 'shade', label: 'Shade', title: 'Block letters in a lighter shade', draw: solid('▓') },
  { id: 'wide', label: 'Wide', title: 'Block letters, twice as wide', draw: wide },
  { id: 'half', label: 'Half', title: 'Half-height letters, three rows instead of five', draw: halfBlocks },
  { id: 'shadow', label: 'Shadow', title: 'Block letters with a dropped shadow', draw: shadowed },
];

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
