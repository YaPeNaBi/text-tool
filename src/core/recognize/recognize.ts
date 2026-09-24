/**
 * Recognition: grid + seed -> what the user means by clicking there.
 *
 * A pure function (B-REC-01). It cannot tell how the content was produced,
 * which is exactly the point — drawn, pasted and loaded art all behave the
 * same (B-REC-02).
 */

import {
  borderCellCount,
  boundsOf,
  ck,
  rectOnBorder,
  unck,
  type Cell,
  type CellKey,
  type Rect,
} from '../geom/cell.ts';
import { arrowDir } from '../charset/charsets.ts';
import { maskOf, type Grid } from '../grid/grid.ts';
import { links } from '../grid/links.ts';
import { ellipseRings } from '../stamp/ellipse.ts';
import { trace } from './trace.ts';
import { segmentize, type RunGraph } from './segmentize.ts';

export type CandidateKind = 'box' | 'ellipse' | 'line' | 'arrow' | 'text' | 'cells';

export interface Candidate {
  kind: CandidateKind;
  cells: Set<CellKey>;
  bounds: Rect;
}

export const MIN_RECOGNIZED_BOX = 2;

/**
 * Box matcher (B-REC-05): the component must be exactly the perimeter of its
 * own bounding box — every perimeter cell present, and no cell off it.
 */
export function matchBox(cells: ReadonlySet<CellKey>, bounds: Rect): boolean {
  if (bounds.w < MIN_RECOGNIZED_BOX || bounds.h < MIN_RECOGNIZED_BOX) return false;
  if (cells.size !== borderCellCount(bounds)) return false;

  for (let x = bounds.x; x < bounds.x + bounds.w; x++) {
    if (!cells.has(ck(x, bounds.y))) return false;
    if (!cells.has(ck(x, bounds.y + bounds.h - 1))) return false;
  }
  for (let y = bounds.y; y < bounds.y + bounds.h; y++) {
    if (!cells.has(ck(bounds.x, y))) return false;
    if (!cells.has(ck(bounds.x + bounds.w - 1, y))) return false;
  }
  // Size check above already rules out interior cells, but be explicit.
  for (const key of cells) {
    const { x, y } = unck(key);
    if (!rectOnBorder(bounds, x, y)) return false;
  }
  return true;
}

/**
 * Ellipse matcher (B-REC-14): the mirror of the box matcher. A component is an
 * ellipse when it is exactly the outline the ellipse stamper would draw for its
 * own bounding box — which is the cheapest possible way to keep the stamper and
 * the matcher honest about each other. The staircase ring the stamper used to
 * draw still counts, so older documents keep their circles.
 */
export function matchEllipse(cells: ReadonlySet<CellKey>, bounds: Rect): boolean {
  return ellipseRings(bounds).some((want) => {
    if (want.size === 0 || want.size !== cells.size) return false;
    for (const key of want) {
      if (!cells.has(key)) return false;
    }
    return true;
  });
}

/**
 * Polyline / arrow matcher (B-REC-08): an open path is a component that never
 * branches and has exactly two loose ends. An arrowhead on either end promotes
 * it from a line to an arrow.
 */
export function matchPath(grid: Grid, graph: RunGraph): 'line' | 'arrow' | null {
  const ends: CellKey[] = [];

  for (const [key, deg] of graph.degree) {
    if (deg > 2) return null; // a junction: this is not a simple path
    if (deg === 1) ends.push(key);
    if (deg === 0) return null; // a lone cell is not a path
  }
  if (ends.length !== 2) return null; // 0 ends means a closed loop

  for (const key of ends) {
    if (arrowDir(grid.get(key)) !== null) return 'arrow';
  }
  return 'line';
}

/** True for a cell holding something that is not part of any line. */
function isTextCell(grid: Grid, x: number, y: number): boolean {
  const ch = grid.get(ck(x, y));
  if (ch === undefined || ch === ' ') return false;
  return maskOf(grid, x, y) === 0 && links(grid, x, y).length === 0;
}

/**
 * Text matcher: the run of ordinary characters around the seed, on one row,
 * bounded by blanks or by anything that belongs to a line.
 */
export function matchTextRun(grid: Grid, x: number, y: number): Candidate | null {
  if (!isTextCell(grid, x, y)) return null;

  let x0 = x;
  let x1 = x;
  while (isTextCell(grid, x0 - 1, y)) x0--;
  while (isTextCell(grid, x1 + 1, y)) x1++;

  const cells = new Set<CellKey>();
  for (let cx = x0; cx <= x1; cx++) cells.add(ck(cx, y));

  return { kind: 'text', cells, bounds: { x: x0, y, w: x1 - x0 + 1, h: 1 } };
}

/**
 * Returns null only when the seed cell is empty (B-REC-07).
 * Otherwise recognition always yields something (B-REC-06).
 */
export function recognize(grid: Grid, x: number, y: number): Candidate | null {
  const { cells, truncated } = trace(grid, x, y);
  if (cells.size === 0) return matchTextRun(grid, x, y);

  const bounds = boundsOf(cells);
  if (bounds === null) return null;

  if (!truncated) {
    if (matchBox(cells, bounds)) return { kind: 'box', cells, bounds };
    if (matchEllipse(cells, bounds)) return { kind: 'ellipse', cells, bounds };

    const path = matchPath(grid, segmentize(grid, cells));
    if (path !== null) return { kind: path, cells, bounds };
  }
  return { kind: 'cells', cells, bounds };
}

/** Marquee selection: every non-empty cell intersecting the rect (B-SEL-03). */
export function selectWithin(grid: Grid, r: Rect): Candidate | null {
  const cells = new Set<CellKey>();
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const key = ck(x, y);
      if (grid.has(key)) cells.add(key);
    }
  }
  return fromCells(cells);
}

/**
 * Everything between two cells **in reading order** — the text-editor sweep.
 *
 * Not a rectangle. From the first cell to the end of its row, every row in
 * between whole, and the last row up to the second cell. Which is what dragging
 * a cursor through a paragraph gives you anywhere else, and is a different
 * answer from `selectWithin` on purpose: one is for prose, the other for a
 * region of the drawing, and a grid is asked for both.
 */
export function selectFlow(grid: Grid, from: Cell, to: Cell): Candidate | null {
  const [head, tail] =
    from.y < to.y || (from.y === to.y && from.x <= to.x) ? [from, to] : [to, from];

  const cells = new Set<CellKey>();
  const bounds = boundsOf(new Set(grid.keys()));
  const left = bounds?.x ?? 0;
  const right = bounds === null ? 0 : bounds.x + bounds.w - 1;

  for (let y = head.y; y <= tail.y; y++) {
    const first = y === head.y ? head.x : left;
    const last = y === tail.y ? tail.x : right;
    for (let x = first; x <= last; x++) {
      const key = ck(x, y);
      if (grid.has(key)) cells.add(key);
    }
  }
  return fromCells(cells);
}

/** Everything in the document (B-SEL-10). */
export function selectAll(grid: Grid): Candidate | null {
  return fromCells(new Set(grid.keys()));
}

/** Wrap a bare set of cells as a candidate, or null when it is empty. */
export function fromCells(cells: Set<CellKey>): Candidate | null {
  if (cells.size === 0) return null;
  const bounds = boundsOf(cells);
  if (bounds === null) return null;
  return { kind: 'cells', cells, bounds };
}

/** How the status bar names a selection (B-UI-06). */
export function describe(c: Candidate): string {
  const size = `${c.bounds.w}×${c.bounds.h}`;
  switch (c.kind) {
    case 'box':
      return `Box ${size}`;
    case 'ellipse':
      return c.bounds.w === c.bounds.h ? `Circle ${size}` : `Ellipse ${size}`;
    case 'arrow':
      return `Arrow ${c.cells.size} cells`;
    case 'line':
      return `Line ${c.cells.size} cells`;
    case 'text':
      // Counted, not measured. A selected run used to be one row, where width
      // and character count are the same number; a block of text is several,
      // where the width is the length of its longest line and says nothing
      // about how much is selected.
      return `Text ${c.cells.size} chars`;
    case 'cells':
      return `Cells ${size}`;
  }
}

/** Shapes whose border can be redrawn at a new size (B-MAN-09). */
export function isResizable(c: Candidate | null): boolean {
  return c !== null && (c.kind === 'box' || c.kind === 'ellipse');
}
