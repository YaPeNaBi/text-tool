/**
 * Trace: the connected component of line cells reachable from a seed
 * (B-REC-03).
 */

import { ck, unck, type CellKey } from '../geom/cell.ts';
import { DIRS } from '../charset/charsets.ts';
import { connected, maskOf, type Grid } from '../grid/grid.ts';

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
  // arrowheads only when a shaft backs them, text never does.
  if (maskOf(grid, seedX, seedY) === 0) return { cells, truncated: false };

  const queue: CellKey[] = [start];
  cells.add(start);
  let truncated = false;

  while (queue.length > 0) {
    const key = queue.pop() as CellKey;
    const { x, y } = unck(key);

    for (const dir of DIRS) {
      if (!connected(grid, x, y, dir)) continue;

      const nk = ck(x + dir.dx, y + dir.dy);
      if (cells.has(nk)) continue;

      if (cells.size >= TRACE_CAP) {
        truncated = true;
        queue.length = 0;
        break;
      }
      cells.add(nk);
      queue.push(nk);
    }
  }
  return { cells, truncated };
}
