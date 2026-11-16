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

import { boundsOf, ck, rectWithin, unck, type Cell, type CellKey } from '../geom/cell.ts';
import { DIRS } from '../charset/charsets.ts';
import { connected, type Grid } from '../grid/grid.ts';
import { links } from '../grid/links.ts';
import { candidatesAt } from '../recognize/rank.ts';
import { isClosed } from './contain.ts';

/**
 * Enough contact points to identify the neighbours without scanning a whole
 * lattice. Two flush boxes touch at two corners; a table cell at a handful.
 */
export const MAX_CONTACT_PROBES = 12;

/**
 * Cells of `moving` that are **joined** to something staying put — by an arm
 * both sides agree on, or by a diagonal link (B-CONN-08).
 *
 * Joined, not merely beside. A neighbour that shares a cell with the mover runs
 * on out of it, so the shared cell is always joined to the rest of the
 * neighbour. A wall that only runs alongside — the stretch of one box's floor a
 * crossing box passes over — is beside the other box's strokes and joined to
 * none of them, and asking there finds only rectangles pieced together from
 * both boxes, which then held that stretch of wall behind (B-MAN-16).
 */
export function contactCells(grid: Grid, moving: ReadonlySet<CellKey>): Cell[] {
  const out: Cell[] = [];

  for (const key of moving) {
    const { x, y } = unck(key);
    const joined =
      DIRS.some((dir) => !moving.has(ck(x + dir.dx, y + dir.dy)) && connected(grid, x, y, dir)) ||
      links(grid, x, y).some((c) => !moving.has(ck(c.x, c.y)));
    if (joined) out.push({ x, y });
  }
  return out;
}

/**
 * The cells of `moving` that a **neighbouring closed shape** also relies on.
 *
 * Found by asking the recognizer what else passes through each contact point
 * and taking the closed reading that **borrows the fewest of the mover's cells**.
 * Two flush boxes also form one big rectangle, and re-deriving *that* would keep
 * almost the whole outline behind; where two boxes cross, pieces of both make
 * rectangles nobody drew, each borrowing a stretch of the mover's wall as one of
 * its sides. The real neighbour borrows only what it truly shares — the wall
 * between flush boxes, the crossings between overlapping ones (B-MAN-16). Ties
 * go to the smaller reading, which is the order they arrive in.
 *
 * Returns an empty set for the overwhelmingly common case of a shape that
 * touches nothing, which is also the fast path.
 */
export function sharedCells(grid: Grid, moving: ReadonlySet<CellKey>): Set<CellKey> {
  const out = new Set<CellKey>();
  const contact = contactCells(grid, moving);
  if (contact.length === 0) return out;

  const considered = new Set<string>();
  const reach = boundsOf(moving);

  for (const cell of contact.slice(0, MAX_CONTACT_PROBES)) {
    let neighbour: { cells: ReadonlySet<CellKey>; id: string } | null = null;
    let fewest = Infinity;

    for (const candidate of candidatesAt(grid, cell.x, cell.y)) {
      if (!isClosed(candidate)) continue;
      // A closed outline lying wholly within the mover's own bounds is not a
      // neighbour. Where two boxes overlap, the square they intersect in is
      // made of the mover's walls and the other box's — and being the
      // smallest reading, it would otherwise be taken for the neighbour and
      // keep half the mover's outline behind (B-MAN-16).
      if (reach !== null && rectWithin(reach, candidate.bounds)) continue;

      let outside = 0;
      let inside = 0;
      for (const key of candidate.cells) {
        if (moving.has(key)) inside++;
        else outside++;
      }
      // Wholly ours: this reading *is* the mover. Wholly theirs: it shares
      // nothing, so it is not a neighbour we are about to damage.
      if (outside === 0 || inside === 0) continue;

      if (inside < fewest) {
        fewest = inside;
        neighbour = {
          cells: candidate.cells,
          id: `${candidate.bounds.x},${candidate.bounds.y},${candidate.bounds.w},${candidate.bounds.h}`,
        };
      }
    }

    if (neighbour === null || considered.has(neighbour.id)) continue;
    considered.add(neighbour.id);
    for (const key of neighbour.cells) {
      if (moving.has(key)) out.add(key);
    }
  }
  return out;
}
