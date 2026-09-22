/**
 * Typing (B-DRAW-11).
 *
 * Two modes, because a character grid supports both honestly:
 *
 *  - **overwrite** — the default. The caret replaces whatever is under it,
 *    which is what you want when labelling a diagram.
 *  - **insert** — pushes the rest of the *word* right. It stops at the first
 *    blank cell, so typing inside a box never shoves the box's border along.
 */

import { ck, type CellKey } from '../geom/cell.ts';
import type { CellDiff, Grid } from '../grid/grid.ts';

/** The contiguous occupied cells from (x,y) rightward. Empty when (x,y) is blank. */
function runRight(grid: Grid, x: number, y: number): string[] {
  const chars: string[] = [];
  for (let cx = x; ; cx++) {
    const ch = grid.get(ck(cx, y));
    if (ch === undefined) break;
    chars.push(ch);
  }
  return chars;
}

/** Write one character at the caret. */
export function typeChar(
  grid: Grid,
  x: number,
  y: number,
  ch: string,
  insert: boolean,
): CellDiff {
  const diff: CellDiff = new Map();

  if (insert) {
    const run = runRight(grid, x, y);
    for (let i = run.length - 1; i >= 0; i--) {
      diff.set(ck(x + i + 1, y), run[i] as string);
    }
  }
  diff.set(ck(x, y), ch);
  return diff;
}

/** Erase the character at (x,y); in insert mode the rest of the word follows it left. */
export function eraseChar(grid: Grid, x: number, y: number, insert: boolean): CellDiff {
  const diff: CellDiff = new Map();

  if (insert) {
    const run = runRight(grid, x + 1, y);
    for (let i = 0; i < run.length; i++) diff.set(ck(x + i, y), run[i] as string);
    diff.set(ck(x + run.length, y), null);
    return diff;
  }
  diff.set(ck(x, y), null);
  return diff;
}

/** Paste text as cells, one character per cell, tabs expanded (B-TXT-04). */
export function pasteDiff(text: string, originX: number, originY: number): CellDiff {
  const diff: CellDiff = new Map();
  const lines = text.replace(/\r\n?/g, '\n').split('\n');

  lines.forEach((line, row) => {
    const expanded = line.replace(/\t/g, '    ');
    for (let col = 0; col < expanded.length; col++) {
      const ch = expanded[col];
      if (ch === undefined || ch === ' ') continue;
      const key: CellKey = ck(originX + col, originY + row);
      diff.set(key, ch);
    }
  });
  return diff;
}
