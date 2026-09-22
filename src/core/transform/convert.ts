/**
 * Charset conversion as a single document-wide, undoable transform
 * (B-CS-03).
 *
 * Connectivity is re-derived per cell and re-emitted in the target charset,
 * so line cells survive a round trip unchanged (B-CS-04). Text is untouched
 * (B-CS-05).
 */

import { unck } from '../geom/cell.ts';
import {
  arrowDir,
  arrowFor,
  glyphFor,
  isStrongLineChar,
  type Charset,
} from '../charset/charsets.ts';
import { maskOf, neighbourMask, type CellDiff, type Grid } from '../grid/grid.ts';

/**
 * `only` restricts the conversion to a set of cells — one line restyled where
 * it sits, rather than the whole page. Connectivity is still read from the real
 * grid, so a wire converted on its own still merges correctly with the walls it
 * meets; only what gets *written* is limited.
 */
export function convertCharset(
  grid: Grid,
  target: Charset,
  only?: ReadonlySet<string>,
): CellDiff {
  const diff: CellDiff = new Map();

  for (const [key, ch] of grid) {
    if (only !== undefined && !only.has(key)) continue;
    const { x, y } = unck(key);

    // An arrowhead converts to the target's arrowhead, keeping its direction.
    // Only a real one: a `v` with no shaft behind it is a letter (B-CS-05).
    const points = arrowDir(ch);
    if (points !== null) {
      if (maskOf(grid, x, y) === 0) continue;
      const next = arrowFor(points, target);
      if (next !== ch) diff.set(key, next);
      continue;
    }

    if (!isStrongLineChar(ch)) continue;

    // An unambiguous glyph keeps its declared mask; an ambiguous one is
    // narrowed by maskOf. Union with real neighbours so that a `+` that
    // becomes `┼` keeps every arm it actually had.
    const mask = maskOf(grid, x, y) | neighbourMask(grid, x, y);
    const next = glyphFor(mask, target);

    if (next !== '' && next !== ch) diff.set(key, next);
  }
  return diff;
}
