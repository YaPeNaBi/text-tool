/**
 * Typing into a shape, and the one sanctioned case of growing something unasked.
 *
 * Typing past the right-hand edge of a box used to replace the border with a
 * letter — the box sprang a leak and the only way back was undo. There is no
 * reading of "type a longer word" that means "delete the box", so:
 *
 *   **content §4 — typing may grow the shape it is inside rather than destroy
 *   its border.**
 *
 * This is the only place in the codebase permitted to resize something the user
 * did not select, and the exception earns itself: the alternative is silent
 * damage.
 *
 * ── A table cell is not a special case ────────────────────────────────────
 *
 * tables §8 asks for the same rule one level up: typing more than fits a cell
 * widens the **column**, and every row follows. That reads like a second
 * feature and is not one. `planResizeTrack` shifts everything from a rail
 * rightward, and the rail to shift is the right-hand wall of whatever the caret
 * is in — a cell's wall in a table, a box's own border in a box. The only
 * difference between the two is how far the shift reaches, which is the table's
 * bounds in one case and the box's own in the other.
 *
 * So this file finds two rectangles, the innermost and the outermost, and hands
 * both to one operation. It never asks which kind of thing it is looking at.
 *
 * ── What is deliberately absent ───────────────────────────────────────────
 *
 * **No shrinking back.** Deleting a label leaves the box the size it grew to
 * (content §4, recorded there as an open question and settled here). Growing
 * prevents damage; shrinking is only tidying, and tidying that happens without
 * being asked is how a tool starts to feel possessed.
 *
 * **No re-alignment.** `planResize` re-centres a label because the shape around
 * it changed size. Here the shape changes size *because of* the label, and
 * moving the text as it is typed would take the caret away from the character
 * that has just been written.
 */

import { unck, type Cell, type Rect } from '../geom/cell.ts';
import type { Charset } from '../charset/charsets.ts';
import { applyDiff, type CellDiff, type Grid } from '../grid/grid.ts';
import { containersAt } from '../derive/contain.ts';
import { typeChar } from '../stamp/text.ts';
import { planResizeTrack } from './lattice.ts';
import { merge, nothing, type Plan } from './plan.ts';

export interface TypingOptions {
  charset: Charset;
  /** Insert mode pushes the rest of the word right instead of overwriting it. */
  insertMode?: boolean;
  sticky?: boolean;
}

/** The cell the caret is in, and the outermost thing that cell belongs to. */
interface Nest {
  inner: Rect;
  outer: Rect;
}

function nestAt(grid: Grid, caret: Cell): Nest | null {
  const containers = containersAt(grid, caret.x, caret.y);
  const inner = containers[0];
  const outer = containers[containers.length - 1];
  if (inner === undefined || outer === undefined) return null;
  return { inner: inner.bounds, outer: outer.bounds };
}

/** Does this diff write onto the wall at `edge`, along the given axis? */
function reaches(diff: CellDiff, edge: number, axis: 'column' | 'row'): boolean {
  for (const key of diff.keys()) {
    const { x, y } = unck(key);
    if ((axis === 'column' ? x : y) >= edge) return true;
  }
  return false;
}

/**
 * One character at the caret, growing what it is inside if it has to.
 *
 * The write is computed twice when the shape grows, and that is not waste: in
 * insert mode the run being pushed along is read from the grid, and the grid it
 * has to be read from is the one *after* the wall moved. Computing it once
 * against the old grid pushes the border along with the word, which is the bug
 * this whole function exists to prevent.
 */
export function planType(
  grid: Grid,
  caret: Cell,
  ch: string,
  opts: TypingOptions,
): Plan {
  const insert = opts.insertMode === true;
  const write = typeChar(grid, caret.x, caret.y, ch, insert);

  const nest = nestAt(grid, caret);
  if (nest === null) return { diff: write };

  const rail = nest.inner.x + nest.inner.w - 1;
  if (!reaches(write, rail, 'column')) return { diff: write };

  const grow = planResizeTrack(grid, nest.outer, 'column', rail, 1, {
    charset: opts.charset,
    ...(opts.sticky === undefined ? {} : { sticky: opts.sticky }),
  });
  if (grow.diff.size === 0) return { diff: write };

  const after = new Map(grid) as Grid;
  applyDiff(after, grow.diff);

  return {
    diff: merge(grow.diff, typeChar(after, caret.x, caret.y, ch, insert)),
    ...(grow.note === undefined ? {} : { note: grow.note }),
  };
}

/**
 * `Enter` on the shape's last interior row grows it downward, for exactly the
 * reason typing past the last column grows it rightward.
 *
 * Returns the grow only. Where the caret lands is the store's business, and it
 * is the same cell whether the shape grew or not.
 */
export function planNewline(grid: Grid, caret: Cell, opts: TypingOptions): Plan {
  const nest = nestAt(grid, caret);
  if (nest === null) return nothing();

  const rail = nest.inner.y + nest.inner.h - 1;
  if (caret.y + 1 < rail) return nothing();

  const grow = planResizeTrack(grid, nest.outer, 'row', rail, 1, {
    charset: opts.charset,
    ...(opts.sticky === undefined ? {} : { sticky: opts.sticky }),
  });

  // The diff only. Typing must not reach over and change what is selected —
  // `planResizeTrack` hands back a selection because a drag on a separator
  // wants one, and a keystroke emphatically does not.
  return {
    diff: grow.diff,
    ...(grow.note === undefined ? {} : { note: grow.note }),
  };
}

