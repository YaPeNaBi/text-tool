/**
 * Reading huge letters back off the grid.
 *
 * The recognizer's trick, one level up. `recognize.ts` re-derives a *shape* from
 * characters because the document stores no shapes; this re-derives a *word* from
 * a picture of it, because the document stores no text either — a banner is
 * twenty-two characters that happen to look like `HI` (B-FONT-02).
 *
 * That is what makes typing into one possible. Once the word and the font are
 * known, adding a letter is not a matter of appending glyphs and hoping the
 * spacing lines up: it is re-rendering `text + ch` through the same style, so the
 * tracking, the multi-line leading and the trimming are whatever `renderBanner`
 * says they are and cannot drift from what drew it in the first place.
 *
 * ── Why this can be exact ─────────────────────────────────────────────────
 *
 * Because it is inverting a known function rather than interpreting artwork.
 * Every style can undo its own rendering (`BannerStyle.read`) and the alphabet is
 * right here, so the parse is a walk: at each column, which glyph fits exactly?
 * Exactly — every lit cell *and* every blank one inside the glyph's own columns,
 * plus a blank tracking column after it. A parse that cannot account for some
 * cell fails, and a failed parse is reported as "not a banner" rather than as a
 * guess. That matters more than being clever: a wrong reading would re-render
 * over characters the user never selected.
 *
 * ── What it deliberately does not do ──────────────────────────────────────
 *
 * It does not find banners it was not asked about. There is no scan of the
 * document, no index and nothing stored (B-CONN-01's rule, applied to text): you
 * get a reading for the cell you asked about, worked out on the spot, or null.
 */

import { ck, unck, type Cell, type CellKey, type Rect } from '../geom/cell.ts';
import type { Grid } from '../grid/grid.ts';
import {
  BANNER_STYLES,
  TRACKING,
  alphabet,
  glyphBitmap,
  glyphsOf,
  stretchOf,
  type BannerStyle,
} from './banner.ts';

/**
 * The widest blank gap that can still be inside one banner.
 *
 * A gap between two lit columns is one tracking column, plus three more for every
 * space in the text (two blank columns of the space glyph and its own tracking).
 * Seven therefore allows two consecutive spaces, which is as much as any label
 * plausibly has; wider than that and two separate banners standing near each
 * other would be read as one, which is a worse mistake than refusing to join a
 * third space.
 *
 * In **bitmap** columns. A style is free to stretch those — `Wide` draws each as
 * two — so every use of this multiplies by `stretchOf`, which is the difference
 * between finding a space in a wide banner and stopping at it.
 */
const MAX_GAP = 7;

/**
 * How far left the first glyph may begin before the leftmost lit column.
 *
 * `renderBanner` trims the right of each row but not the left, so a word starting
 * with a glyph whose first column is blank — `:` is the only one — renders with a
 * blank column nobody can see. Two columns of slack is enough to find it again.
 */
const LEFT_SLACK = 2;

export interface Banner {
  style: BannerStyle;
  /** What it says, as the text that would render to exactly these cells. */
  text: string;
  /** The top-left of the rendering, which is where a re-render must go. */
  origin: Cell;
  cells: Set<CellKey>;
  bounds: Rect;
}

/** Rows of the grid over a rectangle, as strings, blanks included. */
function rowsOf(grid: Grid, r: Rect): string[] {
  const out: string[] = [];
  for (let y = r.y; y < r.y + r.h; y++) {
    let row = '';
    for (let x = r.x; x < r.x + r.w; x++) row += grid.get(ck(x, y)) ?? ' ';
    out.push(row.replace(/\s+$/, ''));
  }
  return out;
}

/** True when a glyph's bitmap sits at `pos` exactly, off cells and all. */
function fits(
  bits: readonly (readonly boolean[])[],
  width: number,
  glyph: readonly (readonly boolean[])[],
  pos: number,
): boolean {
  const gw = glyph[0]?.length ?? 0;
  if (gw === 0) return false;

  for (let y = 0; y < glyph.length; y++) {
    const want = glyph[y];
    const have = bits[y];
    if (want === undefined || have === undefined) return false;
    for (let x = 0; x < gw; x++) {
      // Past the right edge the bitmap is blank: a row was right-trimmed, so a
      // final glyph whose last column is off still fits.
      const lit = pos + x < width ? have[pos + x] === true : false;
      if (lit !== (want[x] === true)) return false;
    }
  }
  return true;
}

/** True when the tracking columns after a glyph are blank, as the renderer left them. */
function blankAfter(
  bits: readonly (readonly boolean[])[],
  width: number,
  pos: number,
): boolean {
  for (let t = 0; t < TRACKING; t++) {
    const x = pos + t;
    if (x >= width) return true;
    for (const row of bits) if (row[x] === true) return false;
  }
  return true;
}

/**
 * The text a bitmap spells, or null when nothing in the alphabet accounts for it.
 *
 * Widest glyph first, space last (see `alphabet`), so a narrow letter cannot claim
 * the front of a wide one and a blank run is only read as a space once no real
 * glyph fits there.
 */
function parse(bits: readonly (readonly boolean[])[], width: number): string | null {
  const chars = alphabet();
  let pos = 0;
  let out = '';

  while (pos < width) {
    let taken = 0;
    for (const ch of chars) {
      const glyph = glyphBitmap(ch);
      const gw = glyph[0]?.length ?? 0;
      if (!fits(bits, width, glyph, pos)) continue;
      if (!blankAfter(bits, width, pos + gw)) continue;
      out += ch;
      taken = gw + TRACKING;
      break;
    }
    if (taken === 0) return null;
    pos += taken;
  }
  // Trailing spaces are unrenderable, so a parse that ends in one has invented it.
  return out.replace(/ +$/, '');
}

/** True when any cell of this column band is filled. */
function columnFilled(grid: Grid, x: number, top: number, height: number): boolean {
  for (let y = top; y < top + height; y++) if (grid.has(ck(x, y))) return true;
  return false;
}

/** How far the banner reaches in one direction, jumping gaps a space could explain. */
function reach(
  grid: Grid,
  from: number,
  top: number,
  height: number,
  step: number,
  span: number,
): number {
  let edge = from;
  let x = from;
  for (;;) {
    let gap = 0;
    while (gap <= span && !columnFilled(grid, x + step * (gap + 1), top, height)) gap++;
    if (gap > span) return edge;
    x += step * (gap + 1);
    edge = x;
  }
}

/**
 * Read the banner the cell at `at` belongs to, or null.
 *
 * Every style is tried, and within a style every row the band could start on —
 * the click may have landed on any row of the letters. The first reading that
 * parses and covers the clicked cell wins, and the styles are tried in the menu's
 * own order so that a rendering two styles could both explain is read as the one
 * offered first.
 */
export function readBanner(grid: Grid, at: Cell): Banner | null {
  const here = grid.get(ck(at.x, at.y));
  if (here === undefined || here === ' ') return null;

  for (const style of BANNER_STYLES) {
    if (!glyphsOf(style).has(here)) continue;

    for (let top = at.y - style.height + 1; top <= at.y; top++) {
      const found = tryAt(grid, at, style, top);
      if (found !== null) return found;
    }
  }
  return null;
}

function tryAt(grid: Grid, at: Cell, style: BannerStyle, top: number): Banner | null {
  // A band with content immediately above or below it is taller than this style
  // draws, so it is not this style's work — that check is what stops a six-row
  // Shadow from also reading as a five-row Block sitting on a row of shadow.
  const span = MAX_GAP * stretchOf(style);
  if (rowFilled(grid, top - 1, at.x, span) || rowFilled(grid, top + style.height, at.x, span)) {
    return null;
  }

  const left = reach(grid, at.x, top, style.height, -1, span);
  const right = reach(grid, at.x, top, style.height, 1, span);

  // `:` renders with a blank first column, so the leftmost *lit* column is not
  // always where the first glyph begins.
  for (let slack = 0; slack <= LEFT_SLACK; slack++) {
    const rect: Rect = { x: left - slack, y: top, w: right - (left - slack) + 1, h: style.height };
    if (rect.x < 0) break;

    const bits = style.read(rowsOf(grid, rect));
    if (bits === null) continue;

    const width = Math.max(0, ...bits.map((r) => r.length));
    const text = parse(bits, width);
    if (text === null || text.trim() === '') continue;

    const cells = new Set<CellKey>();
    for (let y = rect.y; y < rect.y + rect.h; y++) {
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        if (grid.has(ck(x, y))) cells.add(ck(x, y));
      }
    }
    if (!cells.has(ck(at.x, at.y))) continue;

    return { style, text, origin: { x: rect.x, y: rect.y }, cells, bounds: rect };
  }
  return null;
}

/** Whether a row has anything on it near `x`, within the widest banner gap. */
function rowFilled(grid: Grid, y: number, x: number, span: number): boolean {
  for (let dx = -span; dx <= span; dx++) if (grid.has(ck(x + dx, y))) return true;
  return false;
}

/** The cells a banner occupies, as a selection would hold them. */
export function bannerCells(b: Banner): Set<CellKey> {
  const out = new Set<CellKey>();
  for (const key of b.cells) {
    const { x, y } = unck(key);
    out.add(ck(x, y));
  }
  return out;
}
