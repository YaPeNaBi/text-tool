/**
 * Freehand: a dragged stroke, rendered as line glyphs.
 *
 * The pointer moves in pixels and the document is a grid, so a stroke is not a
 * curve to be approximated — it is a **sequence of cells the pointer was in**,
 * and drawing it is deciding what character each of those cells should hold.
 * That question already has an answer: it is the one every other stamper asks.
 * So this file does exactly one thing the others do not — turn a sparse list of
 * samples into a connected walk — and then hands the walk to `stampPolyline`,
 * which accumulates connectivity per cell and merges with what is already
 * there. A stroke that crosses itself gets a `┼` for free (B-DRAW-14c), and a
 * stroke drawn across a box joins it the same way a drawn line would.
 *
 * ── Why the samples need filling in ───────────────────────────────────────
 *
 * A pointer moving quickly reports a cell here and a cell four away, with
 * nothing in between. Joined naively that is not a line, it is dots. Worse, a
 * diagonal move has no orthogonal meaning at all: the grid is 4-connected, so
 * "one right and one down" has to become two steps, and which order they go in
 * is what gives a freehand diagonal its staircase.
 *
 * The walk always spends its step on the axis with further to go, which keeps
 * the staircase even rather than drawing one long leg and then turning.
 */

import type { Cell } from '../geom/cell.ts';
import type { Charset } from '../charset/charsets.ts';
import type { CellDiff, Grid } from '../grid/grid.ts';
import { stampPolyline } from './path.ts';

/** A stroke shorter than this is a click, not a drawing. */
export const MIN_STROKE = 2;

/**
 * Fill the gaps between pointer samples, so the result is a walk of cells each
 * touching the last. Consecutive duplicates are dropped: standing still is not
 * a step.
 */
export function strokeCells(samples: readonly Cell[]): Cell[] {
  const out: Cell[] = [];

  const push = (cell: Cell): void => {
    const last = out[out.length - 1];
    if (last !== undefined && last.x === cell.x && last.y === cell.y) return;
    out.push(cell);
  };

  const first = samples[0];
  if (first === undefined) return out;
  push(first);

  for (let i = 1; i < samples.length; i++) {
    const to = samples[i];
    if (to === undefined) continue;

    let { x, y } = out[out.length - 1] as Cell;
    // A bound, because a sample that arrives from a wild pointer jump should
    // cost a long line rather than a hung tab.
    for (let step = 0; step < MAX_SPAN && (x !== to.x || y !== to.y); step++) {
      if (Math.abs(to.x - x) >= Math.abs(to.y - y)) x += Math.sign(to.x - x);
      else y += Math.sign(to.y - y);
      push({ x, y });
    }
  }
  return out;
}

/** No single pointer move spans more of the grid than this. */
const MAX_SPAN = 4096;

/**
 * The stroke as characters.
 *
 * Every cell of the walk becomes a vertex, which sounds wasteful and is not:
 * consecutive vertices are already adjacent, so the polyline stamper has no
 * elbow to work out and simply does the connectivity accumulation this needs.
 */
export function stampStroke(grid: Grid, samples: readonly Cell[], cs: Charset): CellDiff {
  const cells = strokeCells(samples);
  if (cells.length < MIN_STROKE) return new Map();
  return stampPolyline(grid, cells, cs, {});
}
