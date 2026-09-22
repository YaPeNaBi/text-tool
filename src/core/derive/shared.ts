/**
 * Cells that belong to two shapes at once (sticky §7.2).
 *
 * Two boxes drawn flush share a column. Those cells are as much one shape's
 * right wall as the other's left wall, and nothing in the document says which —
 * they are simply `┬`, `│`, `┴`.
 *
 * That matters the moment one of the two moves. Translating the shared column
 * away takes the neighbour's wall with it and leaves a shape with a hole in it;
 * leaving the column behind and translating the rest lands the mover as an open
 * shape. Both are wrong, and both are what happens without this module.
 *
 * The answer is that the shared cells **stay**, re-derived for whoever is left,
 * and the mover is **redrawn** at its destination rather than carried glyph for
 * glyph. A neighbour is a neighbour, not a wire and not a part.
 */

import { ck, unck, type Cell, type CellKey } from '../geom/cell.ts';
import { DIRS } from '../charset/charsets.ts';
import { maskOf, type Grid } from '../grid/grid.ts';
import { candidatesAt } from '../recognize/rank.ts';
import { isClosed } from './contain.ts';

/**
 * Enough contact points to identify the neighbours without scanning a whole
 * lattice. Two flush boxes touch at two corners; a table cell at a handful.
 */
export const MAX_CONTACT_PROBES = 12;

/** Cells of `moving` that sit against something staying put. */
export function contactCells(grid: Grid, moving: ReadonlySet<CellKey>): Cell[] {
  const out: Cell[] = [];

  for (const key of moving) {
    const { x, y } = unck(key);
    for (const dir of DIRS) {
      const nx = x + dir.dx;
      const ny = y + dir.dy;
      if (moving.has(ck(nx, ny))) continue;
      if (maskOf(grid, nx, ny) === 0) continue;

      out.push({ x, y });
      break;
    }
  }
  return out;
}

/**
 * The cells of `moving` that a **neighbouring closed shape** also relies on.
 *
 * Found by asking the recognizer what else passes through each contact point
 * and taking the smallest closed reading that is not the mover itself. Smallest
 * matters: two flush boxes also form one big rectangle, and re-deriving *that*
 * would keep almost the whole outline behind. The neighbour is the tightest
 * shape that shares cells and extends past them.
 *
 * Returns an empty set for the overwhelmingly common case of a shape that
 * touches nothing, which is also the fast path.
 */
export function sharedCells(grid: Grid, moving: ReadonlySet<CellKey>): Set<CellKey> {
  const out = new Set<CellKey>();
  const contact = contactCells(grid, moving);
  if (contact.length === 0) return out;

  const considered = new Set<string>();

  for (const cell of contact.slice(0, MAX_CONTACT_PROBES)) {
    for (const candidate of candidatesAt(grid, cell.x, cell.y)) {
      if (!isClosed(candidate)) continue;

      let outside = 0;
      let inside = 0;
      for (const key of candidate.cells) {
        if (moving.has(key)) inside++;
        else outside++;
      }
      // Wholly ours: this reading *is* the mover. Wholly theirs: it shares
      // nothing, so it is not a neighbour we are about to damage.
      if (outside === 0 || inside === 0) continue;

      const id = `${candidate.bounds.x},${candidate.bounds.y},${candidate.bounds.w},${candidate.bounds.h}`;
      if (!considered.has(id)) {
        considered.add(id);
        for (const key of candidate.cells) {
          if (moving.has(key)) out.add(key);
        }
      }
      // Candidates arrive smallest first, so the first match is the neighbour.
      break;
    }
  }
  return out;
}
