/**
 * Circle / ellipse stamper: rectangle -> CellDiff (B-DRAW-13).
 *
 * The outline is drawn the way a hand draws one on a character grid: flat caps,
 * straight sides, and the shoulders between them taken as diagonals.
 *
 *        ╭───╮
 *       /     \
 *      /       \
 *      │       │
 *      \       /
 *       \     /
 *        ╰───╯
 *
 * A diagonal is not a connection in the four-arm model, so this ring is one
 * shape only because the recognizer also follows **links** (B-CONN-08): a slash
 * to the slash beyond its corner, a bend to the slash it turns into, a slash to
 * the loose end of the side it stands on. The ring is stamped by the same walk
 * stamper as a freehand stroke, and the matcher asks for exactly these cells, so
 * drawing and reading agree by construction (B-DRAW-13a).
 *
 * ── How the ring is built ────────────────────────────────────────────────
 *
 * Start from the filled ellipse, one span per row, and walk the right side top
 * to bottom (the left side is its mirror). Between two rows whose edges differ
 * by `d` columns, the *narrower* row reaches out by `d - 1` cells and a single
 * diagonal step lands on the wider row's edge; equal edges are a vertical step.
 * Every diagonal is then exactly one cell per row — the only slope a slash can
 * draw — and the wide flat stretches sit on the caps, where they belong.
 *
 * The staircase this stamper drew before is still recognised (see
 * `staircaseCells`), so older documents and pasted art keep their circles.
 */

import { ck, type Cell, type CellKey, type Rect } from '../geom/cell.ts';
import { DIRS, type Charset } from '../charset/charsets.ts';
import { connected, outlineConnected, type CellDiff, type Grid } from '../grid/grid.ts';
import { linked } from '../grid/links.ts';
import { stampWalk } from './walk.ts';

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

/** The spans of the rows the ellipse covers, from the first non-empty row. */
function spansOf(r: Rect): { top: number; rows: Array<[number, number]> } | null {
  if (r.w < MIN_ELLIPSE || r.h < MIN_ELLIPSE) return null;

  const rows: Array<[number, number]> = [];
  let top = r.y;
  for (let y = r.y; y < r.y + r.h; y++) {
    const span = spanAt(r, y);
    if (span === null) {
      if (rows.length > 0) break;
      continue;
    }
    if (rows.length === 0) top = y;
    rows.push(span);
  }
  return rows.length === 0 ? null : { top, rows };
}

/**
 * One side of the ring, top to bottom, for edges that grow outward as the
 * number grows: the right side as it is, the left side negated.
 */
function sideOf(edges: readonly number[], top: number): Cell[] {
  const out: Cell[] = [{ x: edges[0] as number, y: top }];
  for (let i = 0; i + 1 < edges.length; i++) {
    const here = edges[i] as number;
    const next = edges[i + 1] as number;
    const y = top + i;

    if (next > here) {
      // Widening: the narrower row above reaches out, then one diagonal down.
      for (let x = here + 1; x < next; x++) out.push({ x, y });
      out.push({ x: next, y: y + 1 });
    } else if (next < here) {
      // Narrowing: one diagonal down, then the narrower row reaches back in.
      for (let x = here - 1; x >= next; x--) out.push({ x, y: y + 1 });
    } else {
      out.push({ x: here, y: y + 1 });
    }
  }
  return out;
}

/**
 * The ring as a closed walk, clockwise from the top cap's left end. Each cell
 * touches the next, and the last touches the first.
 */
export function ellipseWalk(r: Rect): Cell[] {
  const spans = spansOf(r);
  if (spans === null) return [];

  const { top, rows } = spans;
  const bottom = top + rows.length - 1;
  const [capLo, capHi] = rows[0] as [number, number];
  const [baseLo, baseHi] = rows[rows.length - 1] as [number, number];

  const right = sideOf(rows.map((s) => s[1]), top);
  const left = sideOf(rows.map((s) => -s[0]), top).map((c) => ({ x: -c.x, y: c.y }));

  const walk: Cell[] = [];
  for (let x = capLo; x <= capHi; x++) walk.push({ x, y: top });
  walk.push(...right.slice(1));
  for (let x = baseHi - 1; x >= baseLo; x--) walk.push({ x, y: bottom });
  walk.push(...left.slice(1, -1).reverse());
  return walk;
}

/** The cells of the outline, as a set. Always a single closed ring. */
export function ellipseCells(r: Rect): Set<CellKey> {
  return new Set(ellipseWalk(r).map((c) => ck(c.x, c.y)));
}

/**
 * The staircase ring this stamper drew before diagonals: a closed rectilinear
 * path, 4-connected by construction, the step between two rows drawn in the
 * wider one. No longer drawn, still recognised.
 *
 *        ┌────┐
 *      ┌─┘    └─┐
 *     ┌┘        └┐
 *     │          │
 *     └┐        ┌┘
 *      └─┐    ┌─┘
 *        └────┘
 */
export function staircaseCells(r: Rect): Set<CellKey> {
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

  // Every row owns its own left and right edge cell, or a row whose span
  // matches its neighbour's is skipped by the step rule and the ring breaks.
  for (let i = first; i <= last; i++) {
    const span = spans[i];
    if (span === undefined || span === null) continue;
    out.add(ck(span[0], r.y + i));
    out.add(ck(span[1], r.y + i));
  }

  // Sides: the step between two rows belongs to whichever is wider.
  for (let i = first; i < last; i++) {
    const here = spans[i];
    const next = spans[i + 1];
    if (here === undefined || here === null || next === undefined || next === null) continue;

    run(r.y + (next[0] <= here[0] ? i + 1 : i), here[0], next[0]);
    run(r.y + (next[1] >= here[1] ? i + 1 : i), here[1], next[1]);
  }
  return out;
}

/** Every ring a circle with these bounds can be drawn as, current one first. */
export function ellipseRings(r: Rect): Set<CellKey>[] {
  return [ellipseCells(r), staircaseCells(r)];
}

/**
 * Which ring, if either, the grid really draws for these bounds — every cell
 * present (and within `among`, when given) and every one joined to the next.
 *
 * Presence alone would not do: the cells of the current ring can all be
 * occupied by an old staircase, which covers them without being them. So the
 * current ring must connect step by step along its walk, arm or link
 * (B-CONN-08), and the staircase, having no diagonals, cell by cell.
 */
export function ringOnGrid(
  grid: Grid,
  r: Rect,
  among?: ReadonlySet<CellKey>,
): Set<CellKey> | null {
  const present = (ring: ReadonlySet<CellKey>): boolean =>
    ring.size > 0 && [...ring].every((key) => grid.has(key) && (among?.has(key) ?? true));

  const walk = ellipseWalk(r);
  const ring = new Set(walk.map((c) => ck(c.x, c.y)));
  const joined = walk.every((a, i) => {
    const b = walk[(i + 1) % walk.length] as Cell;
    const dir = DIRS.find((d) => d.dx === b.x - a.x && d.dy === b.y - a.y);
    return (dir !== undefined && connected(grid, a.x, a.y, dir)) || linked(grid, a, b);
  });
  if (present(ring) && joined) return ring;

  const stairs = staircaseCells(r);
  return present(stairs) && outlineConnected(grid, stairs) ? stairs : null;
}

/**
 * The ring to lift for a circle with these bounds: what was drawn, rather than
 * what would be drawn today.
 */
export function drawnRing(grid: Grid, r: Rect): Set<CellKey> {
  return ringOnGrid(grid, r) ?? ellipseCells(r);
}

/**
 * Stamp the outline, merging with what is already there exactly as the box
 * stamper does (B-DRAW-07, B-DRAW-08).
 */
export function stampEllipse(grid: Grid, r: Rect, cs: Charset): CellDiff {
  const walk = ellipseWalk(r);
  if (walk.length === 0) return new Map();
  return stampWalk(grid, walk, cs, true);
}
