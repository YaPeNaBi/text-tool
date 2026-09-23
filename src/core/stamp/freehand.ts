/**
 * Freehand: a dragged stroke, rendered as line glyphs.
 *
 * The pointer moves in pixels and the document is a grid, so a stroke is not a
 * curve to be approximated — it is a **sequence of cells the pointer was in**,
 * and drawing it is deciding what character each of those cells should hold.
 * That question already has an answer for the orthogonal part of a stroke: it
 * is the one every other stamper asks, so orthogonal runs are handed to
 * `stampPolyline`, which accumulates connectivity per cell and merges with
 * what is already there. A stroke that crosses itself gets a `┼` for free
 * (B-DRAW-14c), and a stroke drawn across a box joins it the same way a drawn
 * line would.
 *
 * A diagonal step has no such glyph in the orthogonal set, so it gets its own:
 * `/` or `\`, chosen by which way the step leans. These are ordinary text as
 * far as connectivity is concerned (B-CONN-06) — they do not merge with
 * neighbouring box-drawing the way `─` and `│` do — but they draw a 45°
 * freehand stroke as a line instead of a staircase.
 *
 * ── Why the samples need filling in ───────────────────────────────────────
 *
 * A pointer moving quickly reports a cell here and a cell four away, with
 * nothing in between. Joined naively that is not a line, it is dots. The walk
 * below fills the gap by moving toward the target on both axes at once
 * whenever both still have distance left, which is a diagonal step; once one
 * axis catches up, the rest of the walk is straight.
 */

import { ck, type Cell } from '../geom/cell.ts';
import type { Charset } from '../charset/charsets.ts';
import type { CellDiff, Grid } from '../grid/grid.ts';
import { stampPolyline } from './path.ts';

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

/** `\` leans the way a top-left-to-bottom-right step does; `/` the other way. */
function diagonalGlyph(dx: number, dy: number): string {
  return dx === dy ? '\\' : '/';
}

/**
 * The stroke as characters.
 *
 * The walk is split into runs at each diagonal step: a maximal orthogonal run
 * goes to `stampPolyline` exactly as before (so box-joining and self-crossing
 * still work within it), and each diagonal step is stamped directly as `/` or
 * `\` at both of the cells it touches.
 */
export function stampStroke(grid: Grid, samples: readonly Cell[], cs: Charset): CellDiff {
  const cells = strokeCells(samples);
  if (cells.length < MIN_STROKE) return new Map();

  const diff: CellDiff = new Map();
  let i = 0;
  while (i < cells.length - 1) {
    const a = cells[i] as Cell;
    const b = cells[i + 1] as Cell;

    if (a.x !== b.x && a.y !== b.y) {
      const glyph = diagonalGlyph(Math.sign(b.x - a.x), Math.sign(b.y - a.y));
      diff.set(ck(a.x, a.y), glyph);
      diff.set(ck(b.x, b.y), glyph);
      i += 1;
      continue;
    }

    let j = i + 1;
    while (j < cells.length - 1) {
      const p = cells[j] as Cell;
      const q = cells[j + 1] as Cell;
      if (p.x !== q.x && p.y !== q.y) break;
      j += 1;
    }

    const run = stampPolyline(grid, cells.slice(i, j + 1), cs, {});
    for (const [key, value] of run) diff.set(key, value);
    i = j;
  }
  return diff;
}
