/**
 * Selecting by the object rather than by the cell.
 *
 * Every other selection in the editor answers "which cells?". This one answers
 * "which things?", and the difference shows the moment a selection edge lands
 * halfway through a box: cell selection takes half a box, which is never what
 * anyone meant.
 *
 * ── The rule ──────────────────────────────────────────────────────────────
 *
 * A selection is a **region**, not a set. Growing it is two steps:
 *
 *   1. push one edge out by one cell, across the region's whole width or
 *      height — so the reach is `1 × height` going sideways, `width × 1` going
 *      up or down;
 *   2. every object that region now touches is swallowed **whole**, and
 *      whatever the swallowed objects reach becomes part of the region.
 *
 * Step 2 repeats until the region stops growing, which is what makes a chain
 * work: swallowing a box widens the region to that box's full extent, and the
 * wider region may reach a third box that the first pass never came near.
 *
 * The region is kept rather than recomputed from the cells, and that is the
 * whole reason an air gap behaves: push past the end of a box and the region
 * grows into empty space, holding its height, until it finally touches
 * something. A region derived from its cells would snap back to the last glyph
 * and never cross the gap.
 *
 * ── What counts as one object ─────────────────────────────────────────────
 *
 * The same two answers the rest of the editor uses. A cell with connectivity
 * belongs to its connected component — the box, the line, the whole lattice.
 * A cell without any is text, which traces as nothing, so it belongs to the
 * block of writing it sits in (content §1). Nothing here needs to know which
 * kind it is looking at.
 */

import { boundsOf, ck, type CellKey, type Rect } from '../geom/cell.ts';
import type { Grid } from '../grid/grid.ts';
import { textBlockAt } from '../derive/label.ts';
import { trace } from './trace.ts';
import { candidatesAt } from './rank.ts';
import type { Candidate } from './recognize.ts';

/**
 * Swallowing is a fixed point, and a fixed point on a grid wants a bound. Each
 * pass either grows the region or stops, so this is only ever reached by a
 * document with a very long chain of touching objects.
 */
const MAX_PASSES = 64;

/** The whole object a cell belongs to: its component, or the writing it is in. */
export function objectAt(grid: Grid, x: number, y: number): Set<CellKey> {
  const component = trace(grid, x, y).cells;
  if (component.size > 0) return component;
  return textBlockAt(grid, null, x, y);
}

/**
 * The smallest object through this cell, ties broken in reading order.
 *
 * `candidatesAt` gives every reading through a cell, widest to narrowest and
 * overlapping — a cell on a table's wall is in the cell, the row and the table
 * at once. Smallest first is the useful default for the same reason a click
 * takes the most specific reading (B-REC-11): the small thing is reachable by
 * growing, and the big one is not reachable by shrinking.
 */
export function smallestObjectAt(grid: Grid, x: number, y: number): Candidate | null {
  const list = candidatesAt(grid, x, y);
  if (list.length === 0) return null;

  return (
    [...list].sort(
      (a, b) =>
        a.cells.size - b.cells.size ||
        a.bounds.y - b.bounds.y ||
        a.bounds.x - b.bounds.x,
    )[0] ?? null
  );
}

/** One edge pushed out by one cell, clamped at the origin (B-PLANE-04). */
function pushed(r: Rect, dx: number, dy: number): Rect {
  if (dx > 0) return { ...r, w: r.w + 1 };
  if (dx < 0) {
    const x = Math.max(0, r.x - 1);
    return { ...r, x, w: r.w + (r.x - x) };
  }
  if (dy > 0) return { ...r, h: r.h + 1 };
  const y = Math.max(0, r.y - 1);
  return { ...r, y, h: r.h + (r.y - y) };
}

function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.w, b.x + b.w);
  const bottom = Math.max(a.y + a.h, b.y + b.h);
  return { x, y, w: right - x, h: bottom - y };
}

function same(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

/**
 * Grow a region one step and take whole every object it now touches.
 *
 * The result carries the **region** as its bounds, not the extent of the cells
 * it found. Those differ exactly when the region is reaching across empty
 * space, which is the case the next press has to be able to continue from.
 */
export function swallowFrom(grid: Grid, region: Rect, dx: number, dy: number): Candidate {
  let rect = pushed(region, dx, dy);
  const cells = new Set<CellKey>();

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const before = rect;

    for (let y = rect.y; y < rect.y + rect.h; y++) {
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        const key = ck(x, y);
        if (cells.has(key) || !grid.has(key)) continue;
        for (const k of objectAt(grid, x, y)) cells.add(k);
      }
    }

    const reached = boundsOf(cells);
    if (reached !== null) rect = union(rect, reached);
    if (same(rect, before)) break;
  }

  return { kind: 'cells', cells, bounds: rect };
}
