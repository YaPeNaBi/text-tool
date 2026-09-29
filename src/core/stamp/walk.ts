/**
 * Walk stamper: an ordered run of cells, each touching the last, as glyphs.
 * Freehand strokes (B-DRAW-16) and circles (B-DRAW-13) are both drawn this way.
 *
 * A step between two cells is either straight or diagonal. Straight steps give
 * a cell arms, exactly as a polyline does, and a cell with nothing but arms
 * merges with what is already on the grid like any other line (B-DRAW-07): a
 * walk that crosses itself or a box gets a junction there. A diagonal step has
 * no arm to give, so the cells it touches are settled by what surrounds them:
 *
 *   - on a diagonal, a slash leaning the way the step does: `/` or `\`;
 *   - where a horizontal run turns into a diagonal, the charset's **bend**
 *     (`╮`, `╭`, `╯`, `╰`, or `.` and `'` in ASCII). `─` runs through the
 *     middle of its cell and a slash starts in a corner, so side by side they
 *     miss each other by half a row and the slash pokes out (`─\`). The bend
 *     carries the line from the edge's middle to that corner instead;
 *   - where a vertical run turns into a diagonal, the slash itself: there the
 *     gap is half a column, which is the smaller jump — unless the run is a
 *     single step between two diagonals leaning the same way, where `/` over
 *     `/` would miss by a whole column and `│` over `│` bridges it;
 *   - where two diagonals meet in a point facing sideways, `│`, and in a peak
 *     or trough, `─` — a slash there would lean the wrong way for one of them;
 *   - where a vertical run forks into two diagonals, `│`.
 *
 * Deciding per cell, from all of its steps at once, is what keeps the result
 * independent of which way round the walk happened to be taken.
 */

import { ck, unck, type Cell, type CellKey } from '../geom/cell.ts';
import { E, N, S, W, glyphFor, opposite, type Charset, type Dir } from '../charset/charsets.ts';
import { type CellDiff, type Grid } from '../grid/grid.ts';
import { inheritedMask } from './merge.ts';

/** `\` leans the way a top-left-to-bottom-right step does; `/` the other way. */
function slash(dx: number, dy: number): string {
  return Math.sign(dx) === Math.sign(dy) ? '\\' : '/';
}

function dirOf(dx: number, dy: number): Dir {
  if (dx > 0) return E;
  if (dx < 0) return W;
  return dy > 0 ? S : N;
}

/**
 * The glyph for a cell that has at least one diagonal step. `arms` are its
 * straight steps; `slants` the offsets of its diagonal neighbours. `sidestep`
 * says the cell is one end of a single vertical step joining two diagonals
 * that lean the same way — `/` over `/` would miss by a whole column there.
 */
function turnGlyph(arms: number, slants: readonly Cell[], cs: Charset, sidestep: boolean): string {
  if (sidestep) return glyphFor(N | S, cs);
  const [p, q] = slants as [Cell, Cell | undefined];

  if (arms === 0) {
    if (q !== undefined && slants.length === 2) {
      if (p.x === q.x) return glyphFor(N | S, cs);
      if (p.y === q.y) return glyphFor(E | W, cs);
    }
    return slash(p.x, p.y);
  }

  if (arms === E || arms === W) {
    // A bend only when the diagonal leaves on the far side from the run.
    const far = arms === W ? p.x > 0 : p.x < 0;
    if (slants.length === 1 && far) {
      return cs.bend[arms | (p.y < 0 ? N : S)] ?? slash(p.x, p.y);
    }
    return slash(p.x, p.y);
  }

  if (arms === N || arms === S) {
    const below = arms === N;
    const fork = q !== undefined && slants.length === 2 && p.y === q.y && (p.y > 0) === below;
    return fork ? glyphFor(N | S, cs) : slash(p.x, p.y);
  }

  return glyphFor(arms, cs);
}

/**
 * Stamp a walk. With `closed`, the last cell also steps back to the first, as
 * a ring does.
 */
export function stampWalk(
  grid: Grid,
  cells: readonly Cell[],
  cs: Charset,
  closed: boolean,
): CellDiff {
  const diff: CellDiff = new Map();
  const own = new Set<CellKey>(cells.map((c) => ck(c.x, c.y)));
  const arms = new Map<CellKey, number>();
  const slants = new Map<CellKey, Cell[]>();

  const slant = (key: CellKey, dx: number, dy: number): void => {
    const list = slants.get(key) ?? [];
    if (!list.some((c) => c.x === dx && c.y === dy)) list.push({ x: dx, y: dy });
    slants.set(key, list);
  };

  const steps = closed ? cells.length : cells.length - 1;
  for (let i = 0; i < steps; i++) {
    const a = cells[i] as Cell;
    const b = cells[(i + 1) % cells.length] as Cell;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (dx === 0 && dy === 0) continue;

    const ka = ck(a.x, a.y);
    const kb = ck(b.x, b.y);
    if (dx !== 0 && dy !== 0) {
      slant(ka, dx, dy);
      slant(kb, -dx, -dy);
    } else {
      const d = dirOf(dx, dy);
      arms.set(ka, (arms.get(ka) ?? 0) | d);
      arms.set(kb, (arms.get(kb) ?? 0) | opposite(d));
    }
  }

  /** One end of a single vertical step between two same-leaning diagonals. */
  const sidestep = (x: number, y: number, mask: number, offsets: readonly Cell[]): boolean => {
    if ((mask !== N && mask !== S) || offsets.length !== 1) return false;
    const other = ck(x, y + (mask === S ? 1 : -1));
    const across = slants.get(other);
    return (
      arms.get(other) === opposite(mask as Dir) &&
      across?.length === 1 &&
      across[0]?.x === -(offsets[0] as Cell).x
    );
  };

  for (const key of own) {
    const { x, y } = unck(key);
    const mask = arms.get(key) ?? 0;
    const offsets = slants.get(key);
    if (offsets !== undefined) {
      diff.set(key, turnGlyph(mask, offsets, cs, sidestep(x, y, mask, offsets)));
      continue;
    }
    if (mask === 0) continue;

    const glyph = glyphFor(mask | inheritedMask(grid, x, y, own), cs);
    if (glyph !== '') diff.set(key, glyph);
  }
  return diff;
}
