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
import { boundsOf } from '../geom/cell.ts';
import {
  BANNER_STYLES,
  LEADING,
  TRACKING,
  alphabet,
  artAlphabet,
  glyphBitmap,
  glyphsOf,
  isArt,
  pictureOf,
  spansOf,
  stretchOf,
  type ArtStyle,
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

/**
 * The same walk for a font that is its own artwork (B-FONT-09): at each column,
 * which picture sits here exactly — every stroke and every blank of it — with a
 * blank tracking column after? Rows past their trimmed end are blank.
 */
function parseArt(rows: readonly string[], style: ArtStyle): string | null {
  const width = Math.max(0, ...rows.map((r) => r.length));
  const at = (x: number, y: number): string => rows[y]?.[x] ?? ' ';

  let pos = 0;
  let out = '';
  while (pos < width) {
    let taken = 0;
    for (const ch of artAlphabet(style)) {
      const pic = pictureOf(ch, style);
      const gw = pic[0]?.length ?? 0;
      if (gw === 0) continue;

      let ok = true;
      for (let y = 0; y < style.height && ok; y++) {
        for (let x = 0; x < gw; x++) {
          if (at(pos + x, y) !== (pic[y]?.[x] ?? ' ')) {
            ok = false;
            break;
          }
        }
      }
      if (!ok) continue;
      for (let t = 0; t < TRACKING && ok; t++) {
        for (let y = 0; y < style.height; y++) {
          if (at(pos + gw + t, y) !== ' ') ok = false;
        }
      }
      if (!ok) continue;

      out += ch;
      taken = gw + TRACKING;
      break;
    }
    if (taken === 0) return null;
    pos += taken;
  }
  return out.replace(/ +$/, '');
}

/** A bitmap font read back: the style undoes its rendering, then the bitmap is walked. */
function parseBitmap(rows: readonly string[], style: BannerStyle): string | null {
  if (isArt(style)) return parseArt(rows, style);
  const bits = style.read(rows);
  if (bits === null) return null;
  const width = Math.max(0, ...bits.map((r) => r.length));
  return parse(bits, width);
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

    // Every band the clicked row could belong to is tried, and the reading that
    // accounts for the most cells wins. A stroke font makes this necessary: the
    // upper dot of a `:` is also a complete `.` in a band four rows too high,
    // and that band is as blank above and below as the right one. Ties go to
    // the lowest band, so a lone dash reads as `-` rather than `_`.
    let best: Banner | null = null;
    for (let top = at.y; top > at.y - style.height; top--) {
      const found = tryAt(grid, at, style, top);
      if (found !== null && (best === null || found.cells.size > best.cells.size)) best = found;
    }
    if (best !== null) return best;
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

    const text = parseBitmap(rowsOf(grid, rect), style);
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

/**
 * How many lines a block of big text may run to. Long enough for any heading a
 * diagram carries, short enough not to hang.
 */
const MAX_LINES = 64;

/**
 * The line directly above or below this one, when it belongs to the same block:
 * the same font, the same left edge, and exactly the leading row between — the
 * gap the renderer leaves between the lines of one banner (B-FONT-07).
 */
function lineBeside(grid: Grid, line: Banner, step: -1 | 1): Banner | null {
  const pitch = line.style.height + LEADING;
  const top = line.origin.y + step * pitch;
  if (top < 0) return null;

  // The first glyph may begin with a blank column, so look a little way in.
  for (let dx = 0; dx <= LEFT_SLACK; dx++) {
    for (let y = top; y < top + line.style.height; y++) {
      const x = line.origin.x + dx;
      if (!grid.has(ck(x, y))) continue;
      const found = readBanner(grid, { x, y });
      if (
        found !== null &&
        found.style.id === line.style.id &&
        found.origin.x === line.origin.x &&
        found.origin.y === top
      ) {
        return found;
      }
      return null;
    }
  }
  return null;
}

/**
 * The whole block of big text the cell belongs to: its line, and every line
 * stacked flush above and below it (B-FONT-07). One banner, several lines — the
 * same thing typing `Enter` into one produces, read back.
 */
export function readBannerBlock(grid: Grid, at: Cell): Banner | null {
  const line = readBanner(grid, at);
  if (line === null) return null;

  const lines: Banner[] = [line];
  for (const step of [-1, 1] as const) {
    let cur = line;
    for (let n = 0; n < MAX_LINES; n++) {
      const next = lineBeside(grid, cur, step);
      if (next === null) break;
      if (step < 0) lines.unshift(next);
      else lines.push(next);
      cur = next;
    }
  }
  if (lines.length === 1) return line;

  const cells = new Set<CellKey>();
  for (const l of lines) for (const key of l.cells) cells.add(key);
  const first = lines[0] as Banner;
  return {
    style: line.style,
    text: lines.map((l) => l.text).join('\n'),
    origin: first.origin,
    cells,
    bounds: boundsOf(cells) ?? first.bounds,
  };
}

/**
 * The word of big text the cell belongs to: the run of letters between spaces
 * on its line, as a banner of its own (B-FONT-07). Null when the cell is not in
 * a banner at all; the whole line when it is somehow in no word of it.
 */
export function readBannerWord(grid: Grid, at: Cell): Banner | null {
  const line = readBanner(grid, at);
  if (line === null) return null;

  const chars = [...line.text];
  const spans = spansOf(line.text, line.style);
  let start = -1;
  for (let i = 0; i <= chars.length; i++) {
    const blank = i === chars.length || chars[i] === ' ';
    if (!blank && start === -1) start = i;
    if (!blank || start === -1) continue;

    const from = (spans[start] as { from: number }).from;
    const to = (spans[i - 1] as { to: number }).to;
    if (at.x >= line.origin.x + from && at.x <= line.origin.x + to) {
      const cells = new Set<CellKey>();
      for (const key of line.cells) {
        const { x } = unck(key);
        if (x >= line.origin.x + from && x <= line.origin.x + to) cells.add(key);
      }
      return {
        style: line.style,
        text: chars.slice(start, i).join(''),
        origin: { x: line.origin.x + from, y: line.origin.y },
        cells,
        bounds: boundsOf(cells) ?? line.bounds,
      };
    }
    start = -1;
  }
  return line;
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
