/**
 * Stage ② of recognition (B-REC-09): collapse a traced component into a graph.
 *
 * Nodes are the interesting cells — loose ends, corners and junctions. Runs are
 * the straight stretches between them. A 40×20 box stops being 116 cells and
 * becomes 4 nodes and 4 runs, which is what lets every matcher run on every
 * click without thinking about it.
 */

import { ck, unck, type CellKey } from '../geom/cell.ts';
import { DIRS, opposite, type Dir } from '../charset/charsets.ts';
import { connected, type Grid } from '../grid/grid.ts';

export interface Run {
  from: CellKey;
  to: CellKey;
  /** Every cell of the run, both endpoints included, in walking order. */
  cells: CellKey[];
  axis: 'h' | 'v';
}

export interface RunGraph {
  cells: ReadonlySet<CellKey>;
  /** How many neighbours inside the component each cell has. */
  degree: Map<CellKey, number>;
  /** Cells that are not plain pass-through: degree ≠ 2, or a corner. */
  nodes: Set<CellKey>;
  runs: Run[];
}

/** The directions in which this cell connects to another cell of the component. */
function linksWithin(
  grid: Grid,
  cells: ReadonlySet<CellKey>,
  x: number,
  y: number,
): Dir[] {
  const out: Dir[] = [];
  for (const dir of DIRS) {
    if (!cells.has(ck(x + dir.dx, y + dir.dy))) continue;
    if (connected(grid, x, y, dir)) out.push(dir.d);
  }
  return out;
}

function isCorner(dirs: Dir[]): boolean {
  return dirs.length === 2 && (dirs[0] as Dir) !== opposite(dirs[1] as Dir);
}

export function segmentize(grid: Grid, cells: ReadonlySet<CellKey>): RunGraph {
  const links = new Map<CellKey, Dir[]>();
  const degree = new Map<CellKey, number>();
  const nodes = new Set<CellKey>();

  for (const key of cells) {
    const { x, y } = unck(key);
    const dirs = linksWithin(grid, cells, x, y);
    links.set(key, dirs);
    degree.set(key, dirs.length);
    if (dirs.length !== 2 || isCorner(dirs)) nodes.add(key);
  }

  const runs: Run[] = [];
  const walked = new Set<string>(); // "key|dir", marked from both ends

  for (const start of nodes) {
    for (const d of links.get(start) ?? []) {
      const edge = `${start}|${d}`;
      if (walked.has(edge)) continue;

      const delta = DIRS.find((e) => e.d === d);
      if (delta === undefined) continue;

      const path: CellKey[] = [start];
      let { x, y } = unck(start);
      let cursor = start;

      // Straight runs only, so the direction never changes mid-walk. A
      // pass-through cell always links onward, so this terminates on a node;
      // the bound is insurance against a caller passing an inconsistent set.
      for (let guard = 0; guard <= cells.size; guard++) {
        x += delta.dx;
        y += delta.dy;
        cursor = ck(x, y);
        path.push(cursor);
        if (nodes.has(cursor) || !cells.has(cursor)) break;
      }

      walked.add(edge);
      walked.add(`${cursor}|${opposite(d)}`);
      runs.push({
        from: start,
        to: cursor,
        cells: path,
        axis: delta.dx !== 0 ? 'h' : 'v',
      });
    }
  }

  return { cells, degree, nodes, runs };
}
