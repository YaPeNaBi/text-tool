/**
 * What was already in a cell, when something is stamped on top of it.
 *
 * One rule, shared by the three stampers that can land on existing characters —
 * the box, the polyline and the walk (circles and freehand) — because a box, a
 * circle and a line meeting the end of a line should all produce the same glyph,
 * and three copies of the answer would not stay the same one for long.
 *
 * ── The rule ──────────────────────────────────────────────────────────────
 *
 * **Merge what the cell connects to, not what it claims.** B-DRAW-07 has always
 * asked for the merge; what it could not say in one line is which arms of the old
 * glyph survive it.
 *
 * A straight run does not know where it ends: the last cell of `─────` is a `─`
 * like every other, declaring both east and west, because there is no glyph for
 * "horizontal, but only leftwards". That eastward arm points at nothing, and it
 * is harmless right up until a box border lands on the cell — at which point the
 * union of `│` and `─` is `┼`, and a line that merely *ended* at a wall is drawn
 * as one that *crosses* it, with an arm reaching into the box's empty interior
 * (B-DRAW-07a).
 *
 * So the old glyph's arms are not taken on trust. They are recovered from what is
 * actually next to the cell, which is what `neighbourMask` already computes for
 * the adjacency half of the merge (B-DRAW-08). The outcome is that order stops
 * mattering: drawing the box first and the line into it, or the line first and
 * the box over it, now give the same `┤`.
 *
 * ── The exception, and why it is not a special case ───────────────────────
 *
 * An arm pointing at a **slash** is kept even though the slash does not point
 * back. A slash has no arms to point with; it joins through a **link**
 * (B-CONN-08), and the loose arm aiming at it is half of that link rather than a
 * leftover. This is not a nicety — it is what holds a circle together. The ring
 * runs down the side as `│` and turns the corner into a `\` shoulder, and a
 * connector drawn out of that cell must not take the southward arm with it, or
 * the ring stops being a ring and the shape stops being recognisable as a circle.
 *
 * That case is why this is a function and not a deletion: the first attempt at
 * the fix simply dropped the old glyph's mask, and the circle test caught it.
 */

import { slashMask } from '../grid/links.ts';
import { maskOf, neighbourMask, type Grid } from '../grid/grid.ts';
import type { CellKey } from '../geom/cell.ts';

/**
 * The connectivity a stamp should inherit at (x, y).
 *
 * `own` are the cells of the stamp being placed, whose own connectivity the
 * caller already knows geometrically and must not re-derive from a grid that
 * does not yet contain them.
 */
export function inheritedMask(
  grid: Grid,
  x: number,
  y: number,
  own?: ReadonlySet<CellKey>,
): number {
  return neighbourMask(grid, x, y, own) | (maskOf(grid, x, y) & slashMask(grid, x, y));
}
