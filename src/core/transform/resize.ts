/**
 * Resizing a recognised box (B-MAN-09).
 *
 * The border is **redrawn**, never scaled: the old outline is lifted and a new
 * one is stamped at the new size, so corners stay corners and junctions with
 * neighbouring shapes are recomputed rather than smeared.
 */

import type { CellKey, Rect } from '../geom/cell.ts';
import { ck } from '../geom/cell.ts';
import type { Charset } from '../charset/charsets.ts';
import { cloneWithout, type CellDiff, type Grid } from '../grid/grid.ts';
import { MIN_BOX, borderKeys, stampBox } from '../stamp/box.ts';
import { drawnRing, stampEllipse } from '../stamp/ellipse.ts';

/** Which stamper owns this outline. Adding a shape means adding a case here. */
export type ResizeKind = 'box' | 'ellipse';

export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export interface Handle {
  id: HandleId;
  x: number;
  y: number;
}

/**
 * The shortest edge that can spare a midpoint handle.
 *
 * Below this, an edge is corners and one or two cells, and turning those cells
 * into handles leaves nowhere to grab the shape in order to *move* it. A small
 * box would then be resizable from every side and draggable from none, which is
 * how "I dragged it and nothing happened" starts.
 */
export const MIN_EDGE_FOR_MIDPOINT = 5;

/**
 * The grab points, as cells. On a small box the edge midpoints collide with the
 * corners; corners win, because they resize both axes at once — and short edges
 * give up their midpoint entirely so there is always somewhere to grab.
 */
export function handlesOf(r: Rect): Handle[] {
  // At the minimum size every border cell is a corner. Handles there would
  // leave the shape resizable from everywhere and movable from nowhere, so it
  // gets none: redrawing a 2×2 box is easier than being unable to drag it.
  if (r.w < 3 || r.h < 3) return [];

  const left = r.x;
  const right = r.x + r.w - 1;
  const top = r.y;
  const bottom = r.y + r.h - 1;
  const midX = left + Math.floor((r.w - 1) / 2);
  const midY = top + Math.floor((r.h - 1) / 2);

  const all: Handle[] = [
    { id: 'nw', x: left, y: top },
    { id: 'ne', x: right, y: top },
    { id: 'se', x: right, y: bottom },
    { id: 'sw', x: left, y: bottom },
  ];

  // Horizontal edges carry the north/south midpoints, vertical edges the
  // east/west ones — but only where the edge is long enough to spare a cell.
  if (r.w >= MIN_EDGE_FOR_MIDPOINT) {
    all.push({ id: 'n', x: midX, y: top }, { id: 's', x: midX, y: bottom });
  }
  if (r.h >= MIN_EDGE_FOR_MIDPOINT) {
    all.push({ id: 'w', x: left, y: midY }, { id: 'e', x: right, y: midY });
  }

  const seen = new Set<CellKey>();
  return all.filter((h) => {
    const key = ck(h.x, h.y);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function handleAt(r: Rect, x: number, y: number): HandleId | null {
  const hit = handlesOf(r).find((h) => h.x === x && h.y === y);
  return hit === undefined ? null : hit.id;
}

/**
 * Move the edges a handle owns, keeping the box at least MIN_BOX in each axis
 * and inside the quadrant (B-PLANE-04).
 */
export function resizeRect(r: Rect, id: HandleId, dx = 0, dy = 0): Rect {
  let left = r.x;
  let right = r.x + r.w - 1;
  let top = r.y;
  let bottom = r.y + r.h - 1;

  if (id.includes('w')) left = Math.max(0, Math.min(left + dx, right - (MIN_BOX - 1)));
  if (id.includes('e')) right = Math.max(right + dx, left + MIN_BOX - 1);
  if (id.includes('n')) top = Math.max(0, Math.min(top + dy, bottom - (MIN_BOX - 1)));
  if (id.includes('s')) bottom = Math.max(bottom + dy, top + MIN_BOX - 1);

  return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}

/** Lift the old border, stamp the new one. One diff, so one undo step. */
export function resizeBoxDiff(
  grid: Grid,
  from: Rect,
  to: Rect,
  cs: Charset,
  kind: ResizeKind = 'box',
): CellDiff {
  const diff: CellDiff = new Map();
  const old = kind === 'ellipse' ? [...drawnRing(grid, from)] : borderKeys(from);
  for (const key of old) diff.set(key, null);

  // Stamp against a grid that no longer holds the old outline, otherwise the
  // new border would merge with the one it is replacing.
  const without = cloneWithout(grid, old);
  const stamped = kind === 'ellipse'
    ? stampEllipse(without, to, cs)
    : stampBox(without, to, cs);

  for (const [key, ch] of stamped) diff.set(key, ch);
  return diff;
}
