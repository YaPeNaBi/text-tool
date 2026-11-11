/**
 * A paragraph: loose text read as prose (B-SEL-19e).
 *
 * The recognizer reports a run of characters on one row, because that is all
 * it can say from characters alone. `textBlockAt` widens that to the block a
 * click takes. This is a third, stricter cut, for the keyboard: `Enter` is
 * pressed with the word already in view, and what the eye calls a paragraph is
 * a flush left edge and lines that touch.
 *
 * ── The rule ──────────────────────────────────────────────────────────────
 *
 * A **line** is every run of characters through the seed that is at most one
 * blank from the next — `one - two three` is a line, and so is the whole of a
 * sentence; a word two blanks away is a column, not a continuation. A stroke
 * that lies wholly on the row — a `-` or a `+` or a `-->` between two
 * thoughts — is part of the line, since it is punctuation to the person who
 * typed it however the charset reads it. A wall or a wire is not: it belongs
 * to something that leaves the row, and taking it would take the box.
 *
 * A **paragraph** is the line through the seed plus every line stacked
 * *directly* above and below it whose first character sits in the **same
 * column**. A blank row ends it, and so does an indent. Each line has to hold
 * at least one character that is not a glyph, so a rule drawn under a heading
 * is not the heading's second line.
 *
 * Derived every time, like everything else here. Never stored.
 */

import { boundsOf, ck, unck, type CellKey } from '../geom/cell.ts';
import type { Grid } from '../grid/grid.ts';
import { isTextCell, type Candidate } from '../recognize/recognize.ts';
import { trace } from '../recognize/trace.ts';

/**
 * How far a line or a paragraph may run before we stop following it. Long
 * enough for any prose a diagram holds, short enough not to hang.
 */
export const PARAGRAPH_REACH = 4096;

/** The widest gap that still joins two runs on a row. One more is a column. */
const JOIN_GAP = 1;

/**
 * Whether a cell can be part of a line of prose: a character, or a stroke that
 * lies entirely on this row. A cell whose component reaches another row is a
 * wall or a wire, and ends the line as surely as a blank does.
 */
function joins(grid: Grid, x: number, y: number): boolean {
  if (x < 0 || !grid.has(ck(x, y))) return false;
  const { cells } = trace(grid, x, y);
  if (cells.size === 0) return true; // text: never traced through
  for (const key of cells) {
    if (unck(key).y !== y) return false;
  }
  return true;
}

/** The line of prose through (x, y): runs of joinable cells, at most one blank apart. */
function lineThrough(grid: Grid, x: number, y: number): Set<CellKey> {
  const out = new Set<CellKey>();
  if (!joins(grid, x, y)) return out;
  out.add(ck(x, y));

  for (const step of [-1, 1]) {
    let gap = 0;
    for (let cx = x + step, n = 0; cx >= 0 && n < PARAGRAPH_REACH; cx += step, n++) {
      if (joins(grid, cx, y)) {
        out.add(ck(cx, y));
        gap = 0;
        continue;
      }
      if (grid.has(ck(cx, y))) break; // a wall or a wire: not prose
      if (++gap > JOIN_GAP) break;
    }
  }
  return out;
}

function leftOf(cells: ReadonlySet<CellKey>): number {
  let left = Infinity;
  for (const key of cells) left = Math.min(left, unck(key).x);
  return left;
}

/** At least one character that is not a glyph, so a bare rule is not a line. */
function hasText(grid: Grid, cells: ReadonlySet<CellKey>): boolean {
  for (const key of cells) {
    const { x, y } = unck(key);
    if (isTextCell(grid, x, y)) return true;
  }
  return false;
}

/**
 * The paragraph through a cell, as a selection, or null when the cell is not
 * in one — blank, part of a shape, or a stroke with no words beside it.
 */
export function paragraphAt(grid: Grid, x: number, y: number): Candidate | null {
  const first = lineThrough(grid, x, y);
  if (!hasText(grid, first)) return null;

  const left = leftOf(first);
  const cells = new Set(first);

  for (const step of [-1, 1]) {
    for (let cy = y + step, n = 0; cy >= 0 && n < PARAGRAPH_REACH; cy += step, n++) {
      const line = lineThrough(grid, left, cy);
      if (line.size === 0 || leftOf(line) !== left || !hasText(grid, line)) break;
      for (const key of line) cells.add(key);
    }
  }

  const bounds = boundsOf(cells);
  return bounds === null ? null : { kind: 'text', cells, bounds };
}
