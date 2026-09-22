/**
 * Circle / ellipse stamper: rectangle -> CellDiff (B-DRAW-13).
 *
 * The hard part on a character grid is **connectivity**. Take the ellipse's
 * filled area and keep its boundary cells, and you get a ring that steps
 * diagonally at the shoulders — which is not connected in a world where cells
 * only touch north/south/east/west. It would look broken, and worse, the
 * recognizer could never trace it as one shape.
 *
 * So the outline is built as a closed rectilinear path instead. Between two
 * rows the horizontal step is drawn in the **wider** of the two, and the
 * vertical move happens at the narrower row's edge. That single rule produces
 * the staircase you expect, and it is 4-connected by construction:
 *
 *        ┌────┐
 *      ┌─┘    └─┐
 *     ┌┘        └┐
 *     │          │
 *     └┐        ┌┘
 *      └─┐    ┌─┘
 *        └────┘
 */

import { ck, type CellKey, type Rect } from '../geom/cell.ts';
import { glyphFor, type Charset } from '../charset/charsets.ts';
import { maskOf, neighbourMask, type CellDiff, type Grid } from '../grid/grid.ts';
import { E, N, S, W } from '../charset/charsets.ts';

/** Below this there is no room for a curve, and it would just be a box. */
export const MIN_ELLIPSE = 3;

/** Inclusive column span of the filled ellipse on row `y`, or null if empty. */
function spanAt(r: Rect, y: number): [number, number] | null {
  const cx = r.x + (r.w - 1) / 2;
  const cy = r.y + (r.h - 1) / 2;
  const a = r.w / 2;
  const b = r.h / 2;

  const t = 1 - ((y - cy) / b) ** 2;
  if (t < 0) return null;

  const dx = a * Math.sqrt(t);
  const lo = Math.max(r.x, Math.ceil(cx - dx));
  const hi = Math.min(r.x + r.w - 1, Math.floor(cx + dx));
  return lo > hi ? null : [lo, hi];
}

/** The cells of the outline, as a set. Always a single closed ring. */
export function ellipseCells(r: Rect): Set<CellKey> {
  const out = new Set<CellKey>();
  if (r.w < MIN_ELLIPSE || r.h < MIN_ELLIPSE) return out;

  const spans: Array<[number, number] | null> = [];
  for (let y = r.y; y < r.y + r.h; y++) spans.push(spanAt(r, y));

  const run = (y: number, from: number, to: number): void => {
    for (let x = Math.min(from, to); x <= Math.max(from, to); x++) out.add(ck(x, y));
  };

  // Caps: the first and last non-empty rows are drawn edge to edge.
  const first = spans.findIndex((s) => s !== null);
  const last = spans.length - 1 - [...spans].reverse().findIndex((s) => s !== null);
  if (first < 0) return out;

  const firstSpan = spans[first];
  const lastSpan = spans[last];
  if (firstSpan !== undefined && firstSpan !== null) run(r.y + first, firstSpan[0], firstSpan[1]);
  if (lastSpan !== undefined && lastSpan !== null) run(r.y + last, lastSpan[0], lastSpan[1]);

  // Every row owns its own left and right edge cell. Without this a row whose
  // span matches its neighbour's is skipped by the step rule below, and the
  // ring silently breaks — which is exactly the failure this shape must not
  // have.
  for (let i = first; i <= last; i++) {
    const span = spans[i];
    if (span === undefined || span === null) continue;
    out.add(ck(span[0], r.y + i));
    out.add(ck(span[1], r.y + i));
  }

  // Sides: the step between two rows belongs to whichever is wider, so the
  // vertical move always happens at the narrower row's edge.
  for (let i = first; i < last; i++) {
    const here = spans[i];
    const next = spans[i + 1];
    if (here === undefined || here === null || next === undefined || next === null) continue;

    run(r.y + (next[0] <= here[0] ? i + 1 : i), here[0], next[0]);
    run(r.y + (next[1] >= here[1] ? i + 1 : i), here[1], next[1]);
  }
  return out;
}

/**
 * Stamp the outline, merging with what is already there exactly as the box
 * stamper does (B-DRAW-07, B-DRAW-08).
 */
export function stampEllipse(grid: Grid, r: Rect, cs: Charset): CellDiff {
  const diff: CellDiff = new Map();
  const own = ellipseCells(r);
  if (own.size === 0) return diff;

  for (const key of own) {
    const i = key.indexOf(',');
    const x = Number(key.slice(0, i));
    const y = Number(key.slice(i + 1));

    // Geometry first: which way does the ring continue from here?
    let mask = 0;
    if (own.has(ck(x, y - 1))) mask |= N;
    if (own.has(ck(x + 1, y))) mask |= E;
    if (own.has(ck(x, y + 1))) mask |= S;
    if (own.has(ck(x - 1, y))) mask |= W;

    mask |= maskOf(grid, x, y);
    mask |= neighbourMask(grid, x, y, own);

    const glyph = glyphFor(mask, cs);
    if (glyph !== '') diff.set(key, glyph);
  }
  return diff;
}
