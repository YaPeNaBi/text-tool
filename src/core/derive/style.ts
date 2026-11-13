/**
 * The character set a shape is drawn in, read back from its glyphs (B-CS-07).
 *
 * The active charset decides what *newly drawn* cells look like (B-CS-02). A
 * shape being redrawn — moved, resized, grown by a column, its wall mended where
 * a connector left — is not newly drawn: it was drawn once already, in some set,
 * and coming back in another is the editor overwriting a choice the user made.
 * So before anything redraws a shape it asks here what the shape was drawn in,
 * and draws in that.
 *
 * Found by counting: for each pack, how many of the cells hold a glyph from its
 * table. Rounded shares every straight and junction with Unicode and differs
 * only at the corners, so no single glyph can tell them apart and the count
 * decides; a tie goes to the set the caller prefers — the active one — which is
 * what a straight run, drawn identically in both, should turn its corner in.
 *
 * Only line glyphs vote. Arrowheads are the same four characters in every
 * Unicode pack, and the bends Unicode borrows from Rounded would let a rounded
 * corner vote for both.
 *
 * Derived every time, like everything else here. Never stored.
 */

import { CHARSETS, DIRS, type Charset } from '../charset/charsets.ts';
import { ck, type CellKey } from '../geom/cell.ts';
import type { Grid } from '../grid/grid.ts';

/** The line glyphs each pack draws, for membership tests. */
const DRAWS: ReadonlyArray<readonly [Charset, ReadonlySet<string>]> = Object.values(CHARSETS).map(
  (cs) => [cs, new Set(Object.values(cs.glyph).filter((g) => g !== ''))] as const,
);

/** The set most of these cells are drawn in; `prefer` when nothing says otherwise. */
export function styleOf(grid: Grid, cells: Iterable<CellKey>, prefer: Charset): Charset {
  const votes = new Map<string, number>();
  for (const key of cells) {
    const ch = grid.get(key);
    if (ch === undefined) continue;
    for (const [cs, glyphs] of DRAWS) {
      if (glyphs.has(ch)) votes.set(cs.id, (votes.get(cs.id) ?? 0) + 1);
    }
  }

  let best = prefer;
  let most = votes.get(prefer.id) ?? 0;
  for (const [cs] of DRAWS) {
    const n = votes.get(cs.id) ?? 0;
    if (n > most) {
      best = cs;
      most = n;
    }
  }
  return best;
}

/**
 * The set of a cell *and the cells it connects to* along `arms`, for mending a
 * junction: a `┣` left where a heavy wire met a thin wall is outvoted by the `│`
 * above and below it, so the wall heals in its own set rather than the wire's.
 */
export function styleAround(
  grid: Grid,
  x: number,
  y: number,
  arms: number,
  prefer: Charset,
): Charset {
  const cells: CellKey[] = [ck(x, y)];
  for (const { d, dx, dy } of DIRS) {
    if ((arms & d) !== 0) cells.push(ck(x + dx, y + dy));
  }
  return styleOf(grid, cells, prefer);
}
