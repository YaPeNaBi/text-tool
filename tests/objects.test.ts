/**
 * Growing a selection by whole objects.
 *
 * The claim under test is not "the right cells came back" — it is that a
 * selection edge never lands halfway through a box. Every case here is a
 * picture where cell selection would take half of something.
 */

import { describe, expect, it } from 'vitest';
import { UNICODE } from '../src/core/charset/charsets.ts';
import { ck, type Rect } from '../src/core/geom/cell.ts';
import { applyDiff, createGrid, type Grid } from '../src/core/grid/grid.ts';
import { stampBox } from '../src/core/stamp/box.ts';
import { objectAt, smallestObjectAt, swallowFrom } from '../src/core/recognize/objects.ts';

function write(grid: Grid, x: number, y: number, s: string): void {
  [...s].forEach((c, i) => { if (c !== ' ') grid.set(ck(x + i, y), c); });
}

function box(grid: Grid, r: Rect): void {
  applyDiff(grid, stampBox(grid, r, UNICODE));
}

/** Two 6x3 boxes on the same rows, with `gap` blank columns between them. */
function pair(gap: number): Grid {
  const grid = createGrid();
  box(grid, { x: 0, y: 0, w: 6, h: 3 });
  box(grid, { x: 6 + gap, y: 0, w: 6, h: 3 });
  return grid;
}

describe('what counts as one object', () => {
  it('a box is its whole component, from any cell of it', () => {
    const grid = createGrid();
    box(grid, { x: 0, y: 0, w: 6, h: 3 });

    // A corner and a wall are the same answer.
    expect(objectAt(grid, 0, 0).size).toBe(objectAt(grid, 3, 0).size);
    expect(objectAt(grid, 0, 0).size).toBe(14); // 6*2 + 3*2 - 4
  });

  it('text is the block it belongs to, not the letter', () => {
    const grid = createGrid();
    write(grid, 2, 1, 'hello');

    expect(objectAt(grid, 4, 1).size).toBe(5);
  });

  it('a letter with nothing around it is still an object', () => {
    const grid = createGrid();
    write(grid, 3, 3, 'x');

    expect(objectAt(grid, 3, 3).size).toBe(1);
  });

  it('the smallest reading wins, because growing cannot shrink', () => {
    const grid = createGrid();
    box(grid, { x: 0, y: 0, w: 10, h: 5 });
    box(grid, { x: 0, y: 0, w: 5, h: 5 }); // a divider: now two cells in one box

    const at = smallestObjectAt(grid, 2, 0);
    expect(at).not.toBeNull();
    // The left-hand cell, not the whole lattice.
    expect(at?.bounds.w).toBe(5);
  });
});

describe('growing swallows whole objects', () => {
  it('reaching a touching box takes all of it', () => {
    const grid = pair(0); // flush: they share a wall
    const from: Rect = { x: 0, y: 0, w: 6, h: 3 };

    const grown = swallowFrom(grid, from, 1, 0);

    // The far wall of the second box, not one column of it.
    expect(grown.bounds.x).toBe(0);
    expect(grown.bounds.x + grown.bounds.w).toBe(12);
  });

  it('a step that reaches nothing grows by exactly one column', () => {
    const grid = pair(4);
    const from: Rect = { x: 0, y: 0, w: 6, h: 3 };

    const grown = swallowFrom(grid, from, 1, 0);

    expect(grown.bounds.w).toBe(7);
    expect(grown.bounds.h).toBe(3); // the height is held while it reaches
  });

  it('and crossing the air gap eventually swallows what is past it', () => {
    const grid = pair(3);
    let sel: Rect = { x: 0, y: 0, w: 6, h: 3 };

    // Three presses cross the gap; the fourth touches the far box.
    for (let i = 0; i < 4; i++) sel = swallowFrom(grid, sel, 1, 0).bounds;

    expect(sel.x + sel.w).toBe(15); // 6 + 3 gap + 6
  });

  it('swallowing something taller grows the region to fit it', () => {
    const grid = createGrid();
    box(grid, { x: 0, y: 0, w: 4, h: 3 });
    box(grid, { x: 4, y: 0, w: 4, h: 9 }); // flush, and much deeper

    const grown = swallowFrom(grid, { x: 0, y: 0, w: 4, h: 3 }, 1, 0);

    expect(grown.bounds.h).toBe(9);
  });

  it('and a region made taller then reaches what only the taller region touches', () => {
    const grid = createGrid();
    box(grid, { x: 0, y: 0, w: 4, h: 3 });
    box(grid, { x: 4, y: 0, w: 4, h: 9 });
    write(grid, 1, 7, 'deep'); // only inside the 9-tall region, not the 3-tall one

    const grown = swallowFrom(grid, { x: 0, y: 0, w: 4, h: 3 }, 1, 0);

    expect(grown.cells.has(ck(1, 7))).toBe(true);
  });

  it('goes up and down as well as sideways', () => {
    const grid = createGrid();
    box(grid, { x: 0, y: 4, w: 6, h: 3 });
    box(grid, { x: 0, y: 0, w: 6, h: 5 }); // sits directly above, sharing a row

    const grown = swallowFrom(grid, { x: 0, y: 4, w: 6, h: 3 }, 0, -1);

    expect(grown.bounds.y).toBe(0);
  });

  it('clamps at the origin rather than refusing (B-PLANE-04)', () => {
    const grid = createGrid();
    write(grid, 0, 0, 'a');

    const grown = swallowFrom(grid, { x: 0, y: 0, w: 1, h: 1 }, -1, 0);

    expect(grown.bounds.x).toBe(0);
    expect(grown.bounds.w).toBe(1);
  });

  it('never takes half a box', () => {
    const grid = pair(1);
    let sel: Rect = { x: 0, y: 0, w: 6, h: 3 };

    // Whatever the number of presses, the second box is either wholly in or
    // wholly out -- there is no press that leaves a torn edge.
    for (let i = 0; i < 6; i++) {
      sel = swallowFrom(grid, sel, 1, 0).bounds;
      const right = sel.x + sel.w;
      const touchesFar = right > 7;
      if (touchesFar) expect(right).toBeGreaterThanOrEqual(13);
    }
  });
});
