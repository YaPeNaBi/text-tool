/**
 * Line and arrow stamper: two points -> CellDiff (B-DRAW-10).
 *
 * Paths are orthogonal — one elbow at most — and merge into whatever they touch
 * exactly as the box stamper does (B-DRAW-07, B-DRAW-08), so a line drawn into
 * a box edge produces `┬` rather than punching a hole in it.
 */

import { ck, type Cell, type CellKey } from '../geom/cell.ts';
import {
  E,
  N,
  S,
  W,
  arrowFor,
  glyphFor,
  isStrongLineChar,
  opposite,
  type Charset,
  type Dir,
} from '../charset/charsets.ts';
import { maskOf, neighbourMask, type CellDiff, type Grid } from '../grid/grid.ts';

/** Which way the elbow turns. `auto` follows the longer axis first. */
export type Elbow = 'auto' | 'h-first' | 'v-first';

export interface PathOptions {
  elbow?: Elbow;
  /** Arrowhead at the far end. */
  headEnd?: boolean;
  /** Arrowhead at the anchor end, for double-headed arrows. */
  headStart?: boolean;
}

/** Shortest path needing a direction: anything less is a dot, not a line. */
export const MIN_PATH = 2;

/** Where a drawn-but-not-yet-committed polyline turns. */
export type Vertex = Cell;

function dirBetween(from: Cell, to: Cell): Dir | null {
  if (to.x > from.x) return E;
  if (to.x < from.x) return W;
  if (to.y > from.y) return S;
  if (to.y < from.y) return N;
  return null;
}

function step(out: Cell[], from: Cell, to: Cell): void {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  let { x, y } = from;
  while (x !== to.x || y !== to.y) {
    x += dx;
    y += dy;
    out.push({ x, y });
  }
}

/**
 * The ordered cells of an orthogonal path, anchor first.
 * A straight run has no elbow; anything else turns exactly once.
 */
export function pathCells(from: Cell, to: Cell, elbow: Elbow = 'auto'): Cell[] {
  const cells: Cell[] = [{ x: from.x, y: from.y }];
  if (from.x === to.x && from.y === to.y) return cells;

  if (from.x === to.x || from.y === to.y) {
    step(cells, from, to);
    return cells;
  }

  const hFirst =
    elbow === 'h-first' ||
    (elbow === 'auto' && Math.abs(to.x - from.x) >= Math.abs(to.y - from.y));

  const corner: Cell = hFirst ? { x: to.x, y: from.y } : { x: from.x, y: to.y };
  step(cells, from, corner);
  step(cells, corner, to);
  return cells;
}

/**
 * The cells of a polyline through every given vertex, in order.
 * Consecutive duplicates are dropped where one segment ends and the next
 * begins, so the run reads as one continuous walk.
 */
export function polylineCells(points: readonly Vertex[], elbow: Elbow = 'auto'): Cell[] {
  const out: Cell[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const leg = pathCells(points[i] as Cell, points[i + 1] as Cell, elbow);
    for (const cell of leg) {
      const last = out[out.length - 1];
      if (last !== undefined && last.x === cell.x && last.y === cell.y) continue;
      out.push(cell);
    }
  }
  if (out.length === 0 && points.length === 1) out.push(points[0] as Cell);
  return out;
}

/** True when an arrowhead would land on an existing line and destroy it. */
function occupiedByLine(grid: Grid, c: Cell | undefined): boolean {
  return c !== undefined && isStrongLineChar(grid.get(ck(c.x, c.y)));
}

/**
 * Stamp a path. Endpoints carrying an arrowhead are written as the arrow glyph
 * verbatim; every other cell merges with what is already on the grid.
 *
 * An arrowhead aimed at something that is already drawn — the usual case, one
 * box pointing at another — stops one cell short instead of punching a hole in
 * the target's border.
 */
export function stampPath(
  grid: Grid,
  from: Cell,
  to: Cell,
  cs: Charset,
  opts: PathOptions = {},
): CellDiff {
  return stampPolyline(grid, [from, to], cs, opts);
}

/**
 * Stamp a run through any number of vertices (B-DRAW-14).
 *
 * Connectivity is accumulated per *cell* rather than per index, so a polyline
 * that crosses itself produces `┼` at the crossing instead of two glyphs
 * fighting over one cell.
 */
export function stampPolyline(
  grid: Grid,
  points: readonly Vertex[],
  cs: Charset,
  opts: PathOptions = {},
): CellDiff {
  const diff: CellDiff = new Map();
  const full = polylineCells(points, opts.elbow ?? 'auto');
  if (full.length < MIN_PATH) return diff;

  // Skipped cells stay in `own` so neighbour merging still ignores them.
  const own = new Set<CellKey>(full.map((c) => ck(c.x, c.y)));

  let lo = 0;
  let hi = full.length - 1;
  if (opts.headEnd === true && hi - lo >= 2 && occupiedByLine(grid, full[hi])) hi--;
  if (opts.headStart === true && hi - lo >= 2 && occupiedByLine(grid, full[lo])) lo++;

  // Geometry of the run: every step tells both of its cells about the other.
  const geometry = new Map<CellKey, number>();
  for (let i = lo; i < hi; i++) {
    const a = full[i] as Cell;
    const b = full[i + 1] as Cell;
    const d = dirBetween(a, b);
    if (d === null) continue;

    const ka = ck(a.x, a.y);
    const kb = ck(b.x, b.y);
    geometry.set(ka, (geometry.get(ka) ?? 0) | d);
    geometry.set(kb, (geometry.get(kb) ?? 0) | opposite(d));
  }

  const headEnd =
    opts.headEnd === true && hi > lo ? dirBetween(full[hi - 1] as Cell, full[hi] as Cell) : null;
  const headStart =
    opts.headStart === true && hi > lo ? dirBetween(full[lo + 1] as Cell, full[lo] as Cell) : null;

  for (let i = lo; i <= hi; i++) {
    const cell = full[i] as Cell;
    const key = ck(cell.x, cell.y);

    // An arrowhead replaces the cell rather than merging into it: it is a
    // terminator, and merging would turn it back into a line glyph.
    const head = (i === hi ? headEnd : null) ?? (i === lo ? headStart : null);
    if (head !== null) {
      diff.set(key, arrowFor(head, cs));
      continue;
    }

    const mask =
      (geometry.get(key) ?? 0) |
      maskOf(grid, cell.x, cell.y) |
      neighbourMask(grid, cell.x, cell.y, own);

    const glyph = glyphFor(mask, cs);
    if (glyph !== '') diff.set(key, glyph);
  }
  return diff;
}
