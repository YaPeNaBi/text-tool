/**
 * Eraser (B-DRAW-12).
 *
 * Erasing part of a line leaves the survivors pointing at nothing — a `┬` whose
 * stem is gone is visibly wrong. So the eraser also *repairs* the cells around
 * what it removed, dropping the arms that no longer lead anywhere.
 *
 * The repair never deletes: if a cell would be left with no connectivity at all
 * it keeps its original glyph, so a deliberate one-cell stub survives.
 */

import { ck, unck, type Cell, type CellKey } from '../geom/cell.ts';
import {
  DIRS,
  glyphFor,
  isStrongLineChar,
  opposite,
  type Charset,
} from '../charset/charsets.ts';
import { maskOf, type CellDiff, type Grid } from '../grid/grid.ts';

export const MIN_BRUSH = 1;
export const MAX_BRUSH = 9;

/** The cells a square brush of `size` covers, centred on `c` and clamped to the quadrant. */
export function brushKeys(c: Cell, size: number): CellKey[] {
  const n = Math.max(MIN_BRUSH, Math.min(MAX_BRUSH, Math.round(size)));
  const half = Math.floor((n - 1) / 2);
  const keys: CellKey[] = [];
  for (let y = c.y - half; y < c.y - half + n; y++) {
    for (let x = c.x - half; x < c.x - half + n; x++) {
      if (x < 0 || y < 0) continue;
      keys.push(ck(x, y));
    }
  }
  return keys;
}

/**
 * Erase `keys`, then mend the line cells that bordered them.
 * `cs` is the active charset, so repaired glyphs match what is being drawn now.
 */
export function eraseWithHeal(
  grid: Grid,
  keys: Iterable<CellKey>,
  cs: Charset,
): CellDiff {
  const gone = new Set<CellKey>();
  for (const key of keys) {
    if (grid.has(key)) gone.add(key);
  }

  const diff: CellDiff = new Map();
  for (const key of gone) diff.set(key, null);
  if (gone.size === 0) return diff;

  // Directions each survivor no longer has a neighbour in.
  const lost = new Map<CellKey, number>();
  for (const key of gone) {
    const { x, y } = unck(key);
    if (maskOf(grid, x, y) === 0) continue; // erasing text mends nothing

    for (const { d, dx, dy } of DIRS) {
      const nkey = ck(x + dx, y + dy);
      if (gone.has(nkey)) continue;
      if (!isStrongLineChar(grid.get(nkey))) continue;
      lost.set(nkey, (lost.get(nkey) ?? 0) | opposite(d));
    }
  }

  for (const [key, dropped] of lost) {
    const { x, y } = unck(key);
    const next = maskOf(grid, x, y) & ~dropped;
    if (next === 0) continue; // a lone stub keeps its glyph rather than vanishing

    const glyph = glyphFor(next, cs);
    if (glyph !== '' && glyph !== grid.get(key)) diff.set(key, glyph);
  }
  return diff;
}
