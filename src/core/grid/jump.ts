/**
 * Jumping to the edge of what is filled — the spreadsheet's `Ctrl`+arrow.
 *
 * One of the most universally learned keys there is: Excel, Sheets, Calc, Word,
 * VS Code, Notepad++, GTK and Windows all agree on it, and on a character grid
 * it earns its keep twice over. The far wall of the box you are standing in is
 * a jump away, and so is the next shape across a gap of empty cells.
 *
 * ── The rule, which is Excel's ────────────────────────────────────────────
 *
 * Three cases, and the first is the one people forget:
 *
 *   filled, and the next cell filled   → ride the run to its **last** filled
 *                                        cell, stopping before the blank
 *   filled, and the next cell blank    → skip the gap, land on the next filled
 *   blank                              → skip the gap, land on the next filled
 *
 * The last two are the same walk, which is why this is shorter than the
 * description. What makes it feel right is the first: standing on a box's left
 * wall and pressing right lands on its right wall, not one cell along and not
 * on the next shape entirely.
 *
 * ── When there is nothing to jump to ──────────────────────────────────────
 *
 * The plane is a quadrant (B-PLANE-01), so it has two walls and two open sides,
 * and the answer differs by which way you are going:
 *
 *   left or up     → the wall. `x = 0` or `y = 0`, exactly as a spreadsheet
 *                    runs to column A. The edge is a real place, so it is
 *                    somewhere to be taken.
 *   right or down  → **one cell**. The plane is unbounded that way
 *                    (B-PLANE-03) and there is no far edge to run to; jumping
 *                    a thousand cells into empty space would strand the view
 *                    somewhere nobody asked to be.
 *
 * Refusing to move at all was the first answer and it was the wrong one in both
 * directions: it made the walls unreachable by keyboard, and it made a key that
 * usually moves you sometimes do nothing, which reads as the key being broken
 * rather than as the document being empty.
 */

import { ck, type Cell } from '../geom/cell.ts';
import { E, N, S, W } from '../charset/charsets.ts';
import { maskOf, type Grid } from './grid.ts';

/** No document is this wide, and a runaway walk is worse than a miss. */
const REACH = 4096;

function filled(grid: Grid, x: number, y: number): boolean {
  return grid.has(ck(x, y));
}

/** Where `Ctrl`+arrow lands, going one step at a time in `(dx, dy)`. */
export function jumpFrom(grid: Grid, from: Cell, dx: number, dy: number): Cell {
  const onPlane = (x: number, y: number): boolean => x >= 0 && y >= 0;

  if (!onPlane(from.x + dx, from.y + dy)) return from;

  // Inside a run: ride it to the last filled cell before the blank — or to the
  // first junction on the way, whichever comes first (B-KEY-18a).
  //
  // A wall with a line joining it is not one run, it is two stretches of wall
  // with somewhere to be in between. Riding straight past the join means the
  // one cell you most want to reach — where the connector meets the shape — is
  // the one cell `Ctrl`+arrow will not take you to, and a table's dividers are
  // unreachable for the same reason. Stopping there is also what a spreadsheet
  // does at a boundary, which is the behaviour this key is borrowing.
  if (filled(grid, from.x, from.y) && filled(grid, from.x + dx, from.y + dy)) {
    // An arm that leaves the line of travel is what makes a cell a junction:
    // going sideways, that is north or south; going up or down, east or west.
    const across = dx !== 0 ? N | S : E | W;

    let { x, y } = from;
    for (let step = 0; step < REACH; step++) {
      const nx = x + dx;
      const ny = y + dy;
      if (!onPlane(nx, ny) || !filled(grid, nx, ny)) break;
      x = nx;
      y = ny;
      // Tested after stepping, so a junction you are already standing on is
      // one you can leave.
      if ((maskOf(grid, x, y) & across) !== 0) break;
    }
    return { x, y };
  }

  // Otherwise: across the gap, to the first filled cell there is.
  let x = from.x + dx;
  let y = from.y + dy;
  for (let step = 0; step < REACH && onPlane(x, y); step++) {
    if (filled(grid, x, y)) return { x, y };
    x += dx;
    y += dy;
  }

  // Nothing that way. Toward a wall, take the wall; away from one, take a step.
  if (dx < 0) return { x: 0, y: from.y };
  if (dy < 0) return { x: from.x, y: 0 };
  return { x: from.x + dx, y: from.y + dy };
}

/**
 * Where `Alt`+arrow lands: the full stride, unless a wall is in the way.
 *
 * `dx`/`dy` are the whole stride — ten across or five down (B-KEY-19) — rather
 * than a direction and a count, which is what keeps the two numbers in the one
 * place that already owns them (`app/canvas/steps.ts`) and keeps this module
 * free of a constant about how a keyboard feels.
 *
 * ── What counts as a wall ─────────────────────────────────────────────────
 *
 * The same test `Ctrl`+arrow uses to find a junction (B-KEY-18a): a cell carrying
 * an arm **across** the line of travel. Going sideways that means north or south,
 * going up or down it means east or west.
 *
 * Reusing it is not a coincidence, it is the whole reason this works. The obvious
 * rule — "stop at the first filled cell" — is wrong in a way that only shows up
 * once you try it: striding along the top of a box, every single `─` is a filled
 * cell, so the stride becomes a one-cell step and the key appears broken. An
 * across-arm test asks the question you actually mean. A `─` you are travelling
 * *along* is not in your way; the `┐` at the end of it is, and so is the `┬` of a
 * table divider halfway down, and so is a box's `│` border met side-on.
 *
 * Two consequences worth stating, because both are deliberate:
 *
 *   - **Text never stops you.** A word has no arms, so striding across a
 *     paragraph does not stutter. The feature is about lines and boxes, which is
 *     what it was asked for.
 *   - **A diagonal never stops you.** `/` and `\` have no arms either — they
 *     **link** instead (B-CONN-08), and a slash is text to everything that is not
 *     the tracer. Blocking on one would be the first place in the codebase to
 *     disagree with that.
 *
 * ── Why it stops *on* the wall, and only once ─────────────────────────────
 *
 * The cell is tested **after** stepping onto it, exactly as B-KEY-18a is, so a
 * wall you are already standing on is one you can leave. That is what makes this
 * a pause rather than a trap: the first press puts you on the border, and the
 * next one strides off it normally.
 */
export function strideFrom(grid: Grid, from: Cell, dx: number, dy: number): Cell {
  const stepX = Math.sign(dx);
  const stepY = Math.sign(dy);
  // Only ever one axis is non-zero, as with `strideBy` itself.
  const across = stepX !== 0 ? N | S : E | W;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));

  let { x, y } = from;
  for (let step = 0; step < steps; step++) {
    const nx = x + stepX;
    const ny = y + stepY;
    // The quadrant has two walls of its own, and they clamp rather than refuse
    // (B-PLANE-04) — the same thing `moveCursor` does with a bare arrow.
    if (nx < 0 || ny < 0) break;
    x = nx;
    y = ny;
    if ((maskOf(grid, x, y) & across) !== 0) break;
  }
  return { x, y };
}
