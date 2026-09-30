/**
 * Stage ④ of recognition: **all** the ways a click could be read, ranked
 * (B-REC-10, B-REC-11).
 *
 * Two boxes sharing an edge are one connected component. There is no answer
 * available from geometry alone about which one you meant, and guessing
 * silently is the one thing the design forbids. So instead of guessing,
 * enumerate: every rectangle in the component whose border passes through the
 * seed, smallest first, then the whole component last.
 *
 * The UI turns that list into repeated clicks that widen the selection
 * outward, which is the same mental model as group-drilling in a vector
 * editor.
 *
 * ── Planned addition (intuitive/plan.md, phase 4) ─────────────────────────
 *
 * A table candidate from `recognize/table.ts`, ranked **below the individual
 * cell rectangles and above the whole-component fallback**, so drilling outward
 * reads `cell → row → table`.
 *
 * That position is also the mitigation for the table matcher's main hazard: two
 * boxes drawn flush look like a 1×2 table, and ranking the table below the cells
 * means a wrong guess is one click from the right answer rather than being
 * forced on the user.
 */

import { boundsOf, ck, unck, type CellKey, type Rect } from '../geom/cell.ts';
import { DIRS } from '../charset/charsets.ts';
import { connected, outlineConnected, type Grid } from '../grid/grid.ts';
import { borderKeys } from '../stamp/box.ts';
import { ringOnGrid } from '../stamp/ellipse.ts';
import { trace } from './trace.ts';
import { segmentize } from './segmentize.ts';
import {
  matchBox,
  matchEllipse,
  matchPath,
  matchBanner,
  matchTextRun,
  type Candidate,
} from './recognize.ts';

/**
 * Guards against pathological input. A hand-drawn diagram has a handful of
 * corners per component; these caps only ever bite on generated art, and when
 * they do the answer degrades to "fewer candidates", never to a hang.
 */
export const MAX_EDGES = 24;
export const MAX_RECTS_TESTED = 20_000;
export const MAX_CANDIDATES = 8;

function area(r: Rect): number {
  return r.w * r.h;
}

/**
 * How committed a reading is, lower being stronger.
 *
 * A closed outline beats an open one even when the open one has fewer cells:
 * two boxes sharing an edge contain a U-shaped strand that is one cell smaller
 * than the left box, and answering "a line" to a click on a box would be
 * obtuse. This is the plan's "most specific matcher" rule, applied before size
 * rather than after it.
 */
function specificity(c: Candidate): number {
  switch (c.kind) {
    // The most committed reading there is: a banner has been *parsed*, letter by
    // letter, and a parse that succeeded is not a guess about what these cells
    // might be. It also has to beat `text`, which would otherwise claim one row
    // of it and hand the Font menu a row of block characters to render.
    case 'banner':
      return 0;
    case 'box':
    case 'ellipse':
      return 1;
    case 'arrow':
      return 2;
    case 'line':
      return 3;
    case 'text':
      return 4;
    case 'cells':
      return 5;
  }
}

function sameCells(a: ReadonlySet<CellKey>, b: ReadonlySet<CellKey>): boolean {
  if (a.size !== b.size) return false;
  for (const key of a) {
    if (!b.has(key)) return false;
  }
  return true;
}

/** The `n` values nearest `pivot`, sorted. Keeps the search local to the click. */
function nearest(values: Set<number>, pivot: number, n: number): number[] {
  return [...values]
    .sort((p, q) => Math.abs(p - pivot) - Math.abs(q - pivot))
    .slice(0, n)
    .sort((p, q) => p - q);
}

/** The rectangle's border, if the component really draws it. */
function borderOf(
  grid: Grid,
  cells: ReadonlySet<CellKey>,
  r: Rect,
): Set<CellKey> | null {
  const border = new Set(borderKeys(r));
  for (const key of border) {
    if (!cells.has(key)) return null;
  }
  return outlineConnected(grid, border) ? border : null;
}

/**
 * The ellipse ring for these bounds, if the component really draws it.
 *
 * Presence alone is far too generous — a circle overlapping a box leaves cells
 * at every position of some smaller rectangle — so `ringOnGrid` also asks that
 * the ring connect all the way round.
 */
function ringOf(grid: Grid, cells: ReadonlySet<CellKey>, r: Rect): Set<CellKey> | null {
  return ringOnGrid(grid, r, cells);
}

/**
 * The **strand** through the seed: how far you can walk along the run graph
 * without passing *through* a junction.
 *
 * This is what makes a line attached to a box selectable on its own. Junction
 * cells are included as the strand's endpoints — they are where it stops, and
 * you want them highlighted — but the walk never continues past one.
 */
function strandAt(
  grid: Grid,
  cells: ReadonlySet<CellKey>,
  seedX: number,
  seedY: number,
): Set<CellKey> | null {
  const graph = segmentize(grid, cells);
  const seed = ck(seedX, seedY);
  if ((graph.degree.get(seed) ?? 0) > 2) return null; // standing on a junction

  const out = new Set<CellKey>([seed]);
  const queue: CellKey[] = [seed];

  while (queue.length > 0) {
    const key = queue.pop() as CellKey;
    if ((graph.degree.get(key) ?? 0) > 2) continue; // stop at, but include, junctions

    const { x, y } = unck(key);
    for (const dir of DIRS) {
      const next = ck(x + dir.dx, y + dir.dy);
      if (!cells.has(next) || out.has(next)) continue;
      if (!connected(grid, x, y, dir)) continue;
      out.add(next);
      queue.push(next);
    }
  }
  return out.size === cells.size ? null : out; // no use if it is the whole thing
}

/**
 * Closed shapes inside the component whose outline passes through the seed —
 * rectangles and ellipses alike.
 *
 * Candidate edges come from the run graph's nodes — corners and junctions —
 * because a shape's sides must start and stop somewhere interesting. The
 * seed's own row and column are always in play, since the seed is on the
 * outline by definition.
 */
function shapesThrough(
  grid: Grid,
  cells: ReadonlySet<CellKey>,
  seedX: number,
  seedY: number,
): Candidate[] {
  const graph = segmentize(grid, cells);

  const xs = new Set<number>([seedX]);
  const ys = new Set<number>([seedY]);
  for (const key of graph.nodes) {
    const { x, y } = unck(key);
    xs.add(x);
    ys.add(y);
  }

  const cols = nearest(xs, seedX, MAX_EDGES);
  const rows = nearest(ys, seedY, MAX_EDGES);

  const lefts = cols.filter((x) => x <= seedX);
  const rights = cols.filter((x) => x >= seedX);
  const tops = rows.filter((y) => y <= seedY);
  const bottoms = rows.filter((y) => y >= seedY);

  const found: Candidate[] = [];
  const seen = new Set<string>();
  const seedKey = ck(seedX, seedY);
  let tested = 0;

  for (const left of lefts) {
    for (const right of rights) {
      if (right - left < 1) continue;
      for (const top of tops) {
        for (const bottom of bottoms) {
          if (bottom - top < 1) continue;
          if (tested++ > MAX_RECTS_TESTED) return found;

          const r: Rect = { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
          const id = `${r.x},${r.y},${r.w},${r.h}`;
          if (seen.has(id)) continue;
          seen.add(id);

          // A rectangle: the seed must lie ON the border, not merely inside.
          const onEdge =
            seedX === left || seedX === right || seedY === top || seedY === bottom;
          if (onEdge) {
            const border = borderOf(grid, cells, r);
            if (border !== null) found.push({ kind: 'box', cells: border, bounds: r });
          }

          // An ellipse inscribed in the same bounds. Its ring is inset from
          // the corners, so membership decides whether the seed is on it.
          const ring = ringOf(grid, cells, r);
          if (ring !== null && ring.has(seedKey)) {
            found.push({ kind: 'ellipse', cells: ring, bounds: r });
          }
        }
      }
    }
  }
  return found;
}

/**
 * Every reading of the click, ranked: smallest first, whole component last.
 * Empty only when the seed cell is empty.
 */
export function candidatesAt(grid: Grid, x: number, y: number): Candidate[] {
  // First, and outside the trace entirely: a banner's letters are separated by a
  // blank column by construction, so no flood fill will ever find more than one
  // of them (see `matchBanner`).
  const banner = matchBanner(grid, x, y);
  const { cells, truncated } = trace(grid, x, y);

  if (cells.size === 0) {
    const text = matchTextRun(grid, x, y);
    // Both, in that order: the whole word first, and the one row under the
    // pointer after it, so clicking again narrows from the banner to its letters.
    const only: Candidate[] = [];
    if (banner !== null) only.push(banner);
    if (text !== null) only.push(text);
    return only;
  }

  const bounds = boundsOf(cells);
  if (bounds === null) return [];

  // A component too big to interpret is offered as itself and nothing else.
  if (truncated) return [{ kind: 'cells', cells, bounds }];

  const out: Candidate[] = [];
  const push = (c: Candidate): void => {
    if (!out.some((existing) => sameCells(existing.cells, c.cells))) out.push(c);
  };
  if (banner !== null) push(banner);

  const parts = shapesThrough(grid, cells, x, y);

  // A line or arrow running into a shape is its own reading, so clicking it
  // selects the connector rather than everything it is attached to.
  const strand = strandAt(grid, cells, x, y);
  if (strand !== null) {
    const strandBounds = boundsOf(strand);
    if (strandBounds !== null) {
      const kind = matchPath(grid, segmentize(grid, strand)) ?? 'cells';
      parts.push({ kind, cells: strand, bounds: strandBounds });
    }
  }

  // Most specific first, then smallest, so drill-through walks outward. Cell
  // count beats area because it compares fairly across different kinds.
  parts.sort(
    (a, b) =>
      specificity(a) - specificity(b) ||
      a.cells.size - b.cells.size ||
      area(a.bounds) - area(b.bounds),
  );
  for (const part of parts) {
    if (out.length >= MAX_CANDIDATES) break;
    push(part);
  }

  // The whole component, however it reads, always comes last: it is the
  // widest interpretation, so drill-through ends there.
  if (matchBox(cells, bounds)) push({ kind: 'box', cells, bounds });
  else if (matchEllipse(cells, bounds)) push({ kind: 'ellipse', cells, bounds });
  else {
    const path = matchPath(grid, segmentize(grid, cells));
    push({ kind: path ?? 'cells', cells, bounds });
  }

  return out;
}

/**
 * Where a fresh click lands: the **most specific** reading, not the widest.
 *
 * Clicking a box should select that box. Anything else is a bad answer, and it
 * is a bad answer in a way that quietly disables sticky connectors: a line
 * drawn *into* a border merges with it, so the widest reading is the box and
 * the line as one blob — and a connector that is part of the selection is not a
 * connector at all. Nothing re-routes, because there is nothing left to route.
 *
 * This restores the order the architecture always specified: *cell → smallest
 * rect → enclosing rect → whole component* (plan.md §3.1).
 */
export function defaultIndex(list: readonly Candidate[]): number {
  void list;
  return 0;
}

/** Repeated clicks widen the reading, then come back round (B-REC-11). */
export function nextIndex(list: readonly Candidate[], current: number): number {
  if (list.length === 0) return 0;
  return (current + 1) % list.length;
}
