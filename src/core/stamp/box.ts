/**
 * Box stamper: rectangle -> CellDiff.
 *
 * Draws only the border (B-DRAW-06) and merges connectivity with whatever is
 * already there, so crossings and T-junctions come out right (B-DRAW-07,
 * B-DRAW-08).
 */

import { ck, type CellKey, type Rect } from '../geom/cell.ts';
import { E, N, S, W, glyphFor, type Charset } from '../charset/charsets.ts';
import { maskOf, neighbourMask, type CellDiff, type Grid } from '../grid/grid.ts';

/** Geometric connectivity of a border cell, from its position on the rect. */
function borderMask(r: Rect, x: number, y: number): number {
  const left = x === r.x;
  const right = x === r.x + r.w - 1;
  const top = y === r.y;
  const bottom = y === r.y + r.h - 1;

  let mask = 0;
  if (top && !left) mask |= W;
  if (top && !right) mask |= E;
  if (bottom && !left) mask |= W;
  if (bottom && !right) mask |= E;
  if (left && !top) mask |= N;
  if (left && !bottom) mask |= S;
  if (right && !top) mask |= N;
  if (right && !bottom) mask |= S;
  return mask;
}

export function borderKeys(r: Rect): CellKey[] {
  const keys: CellKey[] = [];
  for (let x = r.x; x < r.x + r.w; x++) {
    keys.push(ck(x, r.y));
    if (r.h > 1) keys.push(ck(x, r.y + r.h - 1));
  }
  for (let y = r.y + 1; y < r.y + r.h - 1; y++) {
    keys.push(ck(r.x, y));
    if (r.w > 1) keys.push(ck(r.x + r.w - 1, y));
  }
  return keys;
}

export const MIN_BOX = 2;

export function stampBox(grid: Grid, r: Rect, cs: Charset): CellDiff {
  const diff: CellDiff = new Map();
  if (r.w < MIN_BOX || r.h < MIN_BOX) return diff; // B-DRAW-03

  const own = new Set(borderKeys(r));

  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const key = ck(x, y);
      if (!own.has(key)) continue;

      const mask =
        borderMask(r, x, y) | maskOf(grid, x, y) | neighbourMask(grid, x, y, own);
      diff.set(key, glyphFor(mask, cs));
    }
  }
  return diff;
}

/** Erase every given cell. */
export function eraseCells(keys: Iterable<CellKey>): CellDiff {
  const diff: CellDiff = new Map();
  for (const k of keys) diff.set(k, null);
  return diff;
}
