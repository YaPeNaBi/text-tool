/**
 * The document.
 *
 * A sparse map from cell key to a single character, and nothing else
 * (B-DOC-01). No shape objects, no ids, no z-order — structure is recovered
 * by recognition, never stored.
 */

import { ck, unck, type CellKey } from '../geom/cell.ts';
import {
  DIRS,
  E,
  N,
  S,
  W,
  arrowDir,
  decorDir,
  type Dir,
  declaredMask,
  dirDelta,
  isAmbiguous,
  isStrongLineChar,
  opposite,
} from '../charset/charsets.ts';

export type Grid = Map<CellKey, string>;

/** A mutation: key -> character, or null to erase (B-DOC-03). */
export type CellDiff = Map<CellKey, string | null>;

export function createGrid(): Grid {
  return new Map();
}

/**
 * A copy of the document with some cells removed, for previewing an operation
 * that has to see the grid *without* what it is about to replace — resizing a
 * box, for instance, must not merge the new border into the old one.
 */
export function cloneWithout(grid: Grid, keys: Iterable<CellKey>): Grid {
  const out = new Map(grid);
  for (const key of keys) out.delete(key);
  return out;
}

/**
 * Apply a diff in place and return its exact inverse (B-DOC-05).
 * Writing a blank deletes the key so the map never accumulates spaces
 * (B-DOC-02).
 */
export function applyDiff(grid: Grid, diff: CellDiff): CellDiff {
  const inverse: CellDiff = new Map();

  for (const [key, next] of diff) {
    const prev = grid.get(key);
    const normalized = next === null || next === '' || next === ' ' ? null : next;

    if (prev === normalized) continue;
    if (prev === undefined && normalized === null) continue;

    inverse.set(key, prev ?? null);

    if (normalized === null) grid.delete(key);
    else grid.set(key, normalized);
  }
  return inverse;
}

/**
 * Connectivity of the cell at (x,y), derived on demand (B-CONN-01).
 *
 * Unambiguous glyphs report what they declare. Ambiguous ones (`+`, `┼`)
 * narrow to the directions where a neighbour actually connects back
 * (B-CONN-04), falling back to the declared mask when isolated (B-CONN-05).
 * Arrowheads report their tail only when a shaft is really behind them, so
 * ordinary text containing `v` or `>` stays text (B-CONN-06).
 */
export function maskOf(grid: Grid, x: number, y: number): number {
  const ch = grid.get(ck(x, y));
  if (ch === undefined) return 0;

  // An end decoration is weak on an arrowhead's terms (B-CONN-06) but joins
  // differently: the glyph says which way the *run* lies, not which end of it
  // this is — a tick looks the same at either — so it joins whichever side
  // actually has a shaft (B-LINE-04).
  const tick = decorDir(ch);
  if (tick !== null) {
    for (const d of tick === E || tick === W ? [E, W] : [N, S]) {
      const { dx, dy } = dirDelta(d as Dir);
      const shaft = grid.get(ck(x + dx, y + dy));
      if (!isStrongLineChar(shaft)) continue;
      if ((declaredMask(shaft) & opposite(d as Dir)) !== 0) return d;
    }
    return 0;
  }

  const points = arrowDir(ch);
  if (points !== null) {
    // The shaft sits behind the head; the head connects backwards only.
    const tail = opposite(points);
    const { dx, dy } = dirDelta(tail);
    const shaft = grid.get(ck(x + dx, y + dy));
    if (!isStrongLineChar(shaft)) return 0;
    return (declaredMask(shaft) & points) === 0 ? 0 : tail;
  }

  if (!isStrongLineChar(ch)) return 0;

  const declared = declaredMask(ch);
  if (!isAmbiguous(ch)) return declared;

  let narrowed = 0;
  for (const { d, dx, dy } of DIRS) {
    const nb = grid.get(ck(x + dx, y + dy));
    if (!isStrongLineChar(nb)) continue;
    if (declaredMask(nb) & opposite(d)) narrowed |= d;
  }
  return narrowed === 0 ? declared : narrowed;
}

/**
 * Directions in which a line cell at (x,y) would connect to an existing
 * neighbour. `skip` excludes cells that belong to the stamp being placed,
 * whose connectivity is already known geometrically.
 */
export function neighbourMask(
  grid: Grid,
  x: number,
  y: number,
  skip?: ReadonlySet<CellKey>,
): number {
  let mask = 0;
  for (const { d, dx, dy } of DIRS) {
    if (skip?.has(ck(x + dx, y + dy))) continue;
    if (maskOf(grid, x + dx, y + dy) & opposite(d)) mask |= d;
  }
  return mask;
}

/**
 * True when an outline is really *drawn* as that outline, not merely covered
 * by characters that happen to sit in the right places: each cell must also
 * connect along it. A `┘` cannot serve as the middle of a left edge, because
 * it has no southward arm.
 */
export function outlineConnected(grid: Grid, outline: ReadonlySet<CellKey>): boolean {
  for (const key of outline) {
    const { x, y } = unck(key);
    let required = 0;
    for (const dir of DIRS) {
      if (outline.has(ck(x + dir.dx, y + dir.dy))) required |= dir.d;
    }
    if ((maskOf(grid, x, y) & required) !== required) return false;
  }
  return true;
}

/** True when two adjacent cells both connect toward each other (B-CONN-03). */
export function connected(
  grid: Grid,
  x: number,
  y: number,
  d: (typeof DIRS)[number],
): boolean {
  if ((maskOf(grid, x, y) & d.d) === 0) return false;
  return (maskOf(grid, x + d.dx, y + d.dy) & opposite(d.d)) !== 0;
}
