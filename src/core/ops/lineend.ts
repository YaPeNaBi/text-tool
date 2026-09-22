/**
 * What sits at the end of a line.
 *
 * A line has two ends and they are not interchangeable: an arrow means
 * something at one end that it does not mean at the other. So the ends are
 * found, ordered, and addressed individually — `endsOf` hands back both in
 * reading order, and the caller says which one it means.
 *
 * ── Decorations are weak, and that is the whole trick ─────────────────────
 *
 * An arrowhead is not a line glyph. It declares no connectivity of its own and
 * counts as part of a line only when there is a real shaft behind it
 * (B-CONN-06), which is what keeps a `v` in the middle of a word a letter. Any
 * decoration added here has to earn its place the same way, or every diagram
 * that happens to contain the character stops being readable as text.
 */

import { ck, unck, type Cell, type CellKey } from '../geom/cell.ts';
import {
  DIRS,
  arrowDir,
  arrowFor,
  decorDir,
  tickAlong,
  glyphFor,
  opposite,
  type Charset,
  type Dir,
} from '../charset/charsets.ts';
import { neighbourMask, type CellDiff, type Grid } from '../grid/grid.ts';
import { segmentize } from '../recognize/segmentize.ts';
import type { Candidate } from '../recognize/recognize.ts';
import { nothing, refuse, type Plan } from './plan.ts';

/** What an end can be wearing. */
export type LineEnd = 'normal' | 'arrow' | 'one';

export interface EndPoint {
  /** The end cell itself. */
  at: Cell;
  /** Which way it faces — away from the line. */
  facing: Dir;
  /** What it is wearing now. */
  wearing: LineEnd;
}

/**
 * The two loose ends of an open path, in reading order.
 *
 * Reading order — top to bottom, then left to right — rather than the order the
 * line was drawn in, because the drawing order is not recoverable from the
 * characters and a menu that said "end 1" would otherwise mean different ends
 * on different days.
 *
 * Null when the shape is not a simple path: a ring has no ends, and something
 * that branches has more than two, neither of which is a line whose ends can be
 * set.
 */
export function endsOf(grid: Grid, cells: ReadonlySet<CellKey>): EndPoint[] | null {
  const graph = segmentize(grid, cells);

  const loose: CellKey[] = [];
  for (const [key, degree] of graph.degree) {
    if (degree <= 1) loose.push(key);
  }
  if (loose.length !== 2) return null;

  return loose
    .map(unck)
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((at) => ({ at, facing: facingOf(grid, cells, at), wearing: wearingAt(grid, at) }));
}

/** Away from the line: the one direction the end does *not* connect in. */
function facingOf(grid: Grid, cells: ReadonlySet<CellKey>, at: Cell): Dir {
  const head = arrowDir(grid.get(ck(at.x, at.y)));
  if (head !== null) return head;

  for (const dir of DIRS) {
    if (cells.has(ck(at.x + dir.dx, at.y + dir.dy))) return opposite(dir.d);
  }
  // A one-cell line has no neighbour to face away from; east is as good as any.
  return DIRS[1]?.d ?? 2;
}

function wearingAt(grid: Grid, at: Cell): LineEnd {
  const ch = grid.get(ck(at.x, at.y));
  if (decorDir(ch) !== null) return 'one';
  return arrowDir(ch) === null ? 'normal' : 'arrow';
}

/**
 * Put `end` on one of a line's ends.
 *
 * The end cell is *replaced*, not appended to — an arrowhead occupies the last
 * cell of the shaft rather than growing the line by one, which is the same
 * thing `stampPath` does when it draws an arrow in the first place. Taking one
 * off is the mirror: the cell goes back to whatever its connectivity says it
 * should be.
 */
export function planLineEnd(
  grid: Grid,
  selection: Candidate,
  which: number,
  end: LineEnd,
  cs: Charset,
): Plan {
  const ends = endsOf(grid, selection.cells);
  if (ends === null) return refuse('Only a line has ends to set');

  const target = ends[which];
  if (target === undefined) return refuse('That end is not there any more');
  if (target.wearing === end) return nothing();

  const { x, y } = target.at;
  const key = ck(x, y);
  const diff: CellDiff = new Map();

  if (end === 'arrow') {
    diff.set(key, arrowFor(target.facing, cs));
  } else if (end === 'one') {
    // A bar across the run — crow's-foot *exactly one*, as one cell.
    diff.set(key, tickAlong(target.facing));
  } else {
    // Back to a plain glyph. Its connectivity is whatever the neighbours say,
    // which for the last cell of a shaft is the one arm pointing back along it.
    const mask = neighbourMask(grid, x, y);
    diff.set(key, mask === 0 ? null : glyphFor(mask, cs));
  }

  return { diff, selection };
}

/**
 * The cells to light up when an end is being pointed at.
 *
 * A few cells rather than one, because a single character at the end of a long
 * wire is not enough to catch the eye — and telling *which* end a menu means is
 * the entire reason the highlight exists.
 */
export const END_HIGHLIGHT = 3;

export function endCells(cells: ReadonlySet<CellKey>, at: Cell): Set<CellKey> {
  const out = new Set<CellKey>([ck(at.x, at.y)]);

  let cur = at;
  for (let step = 0; step < END_HIGHLIGHT - 1; step++) {
    const next = DIRS.map((d) => ({ x: cur.x + d.dx, y: cur.y + d.dy })).find(
      (c) => cells.has(ck(c.x, c.y)) && !out.has(ck(c.x, c.y)),
    );
    if (next === undefined) break;
    out.add(ck(next.x, next.y));
    cur = next;
  }
  return out;
}
