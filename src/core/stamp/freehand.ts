/**
 * Freehand: a dragged stroke, rendered as line glyphs.
 *
 * The pointer moves in pixels and the document is a grid, so a stroke is not a
 * curve to be approximated — it is a **sequence of cells the pointer was in**,
 * and drawing it is deciding what character each of those cells should hold.
 * That question is the walk stamper's (`walk.ts`), which the circle shares:
 * straight steps become line glyphs that merge with what is already there, so a
 * stroke that crosses itself gets a `┼` (B-DRAW-14c) and a stroke drawn across
 * a box joins it; diagonal steps become `/` and `\`, with a bend wherever a
 * horizontal run turns into one. This file does the one thing the walk stamper
 * does not — turn a sparse list of samples into a walk.
 *
 * ── Why the samples need filling in ───────────────────────────────────────
 *
 * A pointer moving quickly reports a cell here and a cell four away, with
 * nothing in between. Joined naively that is not a line, it is dots. The walk
 * below fills the gap by moving toward the target on both axes at once
 * whenever both still have distance left, which is a diagonal step; once one
 * axis catches up, the rest of the walk is straight.
 */

import type { Cell } from '../geom/cell.ts';
import type { Charset } from '../charset/charsets.ts';
import type { CellDiff, Grid } from '../grid/grid.ts';
import { stampWalk } from './walk.ts';

/** A stroke shorter than this is a click, not a drawing. */
export const MIN_STROKE = 2;

/**
 * Fill the gaps between pointer samples, so the result is a walk of cells each
 * touching the last, orthogonally or diagonally. Consecutive duplicates are
 * dropped: standing still is not a step.
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
      x += Math.sign(to.x - x);
      y += Math.sign(to.y - y);
      push({ x, y });
    }
  }
  return out;
}

/** No single pointer move spans more of the grid than this. */
const MAX_SPAN = 4096;

/** The stroke as characters. */
export function stampStroke(grid: Grid, samples: readonly Cell[], cs: Charset): CellDiff {
  const cells = strokeCells(samples);
  if (cells.length < MIN_STROKE) return new Map();
  return stampWalk(grid, cells, cs, false);
}
