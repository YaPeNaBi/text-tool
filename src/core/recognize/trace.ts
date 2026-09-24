/**
 * Trace: the connected component of line cells reachable from a seed
 * (B-REC-03). Cells join through their arms and, where a diagonal is
 * involved, through links (B-CONN-08).
 */

import { ck, unck, type CellKey } from '../geom/cell.ts';
import { DIRS } from '../charset/charsets.ts';
import { connected, maskOf, type Grid } from '../grid/grid.ts';
import { links } from '../grid/links.ts';

/** Beyond this the component is not worth interpreting (B-REC-04). */
export const TRACE_CAP = 20_000;

export interface TraceResult {
  cells: Set<CellKey>;
  /** True when the cap was hit, so callers know the component is partial. */
  truncated: boolean;
}

export function trace(grid: Grid, seedX: number, seedY: number): TraceResult {
  const start = ck(seedX, seedY);
  const cells = new Set<CellKey>();

  // A cell is traceable when it has connectivity at all: line glyphs always do,
  // arrowheads only when a shaft backs them, a slash only when it is linked,
  // text never does.
  if (maskOf(grid, seedX, seedY) === 0 && links(grid, seedX, seedY).length === 0) {
    return { cells, truncated: false };
  }

  const queue: CellKey[] = [start];
  cells.add(start);
  let truncated = false;

  // Hitting the cap empties the queue, which ends the walk.
  const visit = (nk: CellKey): void => {
    if (cells.has(nk)) return;
    if (cells.size >= TRACE_CAP) {
      truncated = true;
      queue.length = 0;
      return;
    }
    cells.add(nk);
    queue.push(nk);
  };

  while (queue.length > 0) {
    const key = queue.pop() as CellKey;
    const { x, y } = unck(key);

    for (const dir of DIRS) {
      if (connected(grid, x, y, dir)) visit(ck(x + dir.dx, y + dir.dy));
    }
    if (truncated) break;
    for (const to of links(grid, x, y)) visit(ck(to.x, to.y));
  }
  return { cells, truncated };
}
