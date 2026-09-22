/**
 * Moving a set of cells.
 *
 * Glyphs are carried verbatim; a move does not re-run junction merging at the
 * destination (B-MAN-06).
 */

import { ck, unck, type CellKey } from '../geom/cell.ts';
import type { CellDiff, Grid } from '../grid/grid.ts';

export function moveDiff(
  grid: Grid,
  cells: ReadonlySet<CellKey>,
  dx: number,
  dy: number,
): CellDiff {
  const diff: CellDiff = new Map();
  if (dx === 0 && dy === 0) return diff;

  // Lift first, then drop. Overlapping keys are re-set below, so the drop wins.
  for (const key of cells) diff.set(key, null);

  for (const key of cells) {
    const ch = grid.get(key);
    if (ch === undefined) continue;
    const { x, y } = unck(key);
    diff.set(ck(x + dx, y + dy), ch);
  }
  return diff;
}

export function movedKeys(
  cells: ReadonlySet<CellKey>,
  dx: number,
  dy: number,
): Set<CellKey> {
  const out = new Set<CellKey>();
  for (const key of cells) {
    const { x, y } = unck(key);
    out.add(ck(x + dx, y + dy));
  }
  return out;
}
