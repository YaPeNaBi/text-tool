/**
 * Everything that travels with a shape.
 *
 * The single answer to "what moves when I move this", and what makes two rules
 * from two different documents turn out to be the same rule:
 *
 *   - nesting §2 — moving a container moves everything strictly inside it
 *   - content §2 — moving a shape moves its label
 *
 * Both are "take what is wholly inside", so both are this function, and neither
 * is a feature of the move planner.
 */

import type { CellKey } from '../geom/cell.ts';
import type { Grid } from '../grid/grid.ts';
import type { Candidate } from '../recognize/recognize.ts';
import { componentsInside, dividersInside, enclosesArea } from './contain.ts';

/**
 * The shape's own cells, plus every component lying wholly inside it.
 *
 * Two omissions do most of the work here.
 *
 * **Blank interior cells are not included**, which is what preserves content §3
 * — a shape carries its border and its contents, never its empty space. That is
 * why dropping a box around a word *adopts* the word instead of erasing it: the
 * word was never part of the box being moved, so nothing overwrote it.
 *
 * **Nothing looks upward**, which is how nesting §3 is enforced: a child has no
 * way to drag its parent, because this function never asks what it is inside.
 *
 * Anything crossing the border is deliberately left out too — that is a
 * connector, and `route/` re-routes it rather than carrying it (nesting §9).
 */
export function travellingWith(grid: Grid, shape: Candidate): Set<CellKey> {
  const out = new Set<CellKey>(shape.cells);

  // Only something that encloses an area has an inside to carry.
  if (!enclosesArea(shape)) return out;

  for (const part of componentsInside(grid, shape.bounds)) {
    for (const key of part.cells) out.add(key);
  }
  // Its own inner walls, which are neither content nor connector but part of
  // the shape — a table that leaves its dividers behind is not a table.
  for (const key of dividersInside(grid, shape)) out.add(key);
  return out;
}

/**
 * True when the shape carries anything beyond itself.
 *
 * The question a drag has to answer before it starts, so that what is about to
 * move is visible rather than a surprise — the mitigation for the one real
 * hazard of cascading moves. `subjectOf` answers it as part of gathering, which
 * is what the pointer path actually calls; this is the same question asked on
 * its own, for callers with nothing to gather.
 */
export function carriesContents(grid: Grid, shape: Candidate): boolean {
  return travellingWith(grid, shape).size > shape.cells.size;
}
