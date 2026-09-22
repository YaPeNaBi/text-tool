/**
 * The spreadsheet jump, cell by cell.
 *
 * The case worth pinning is the first one: standing on a box's left wall and
 * pressing right must land on its *right* wall — not one cell along, and not on
 * the next shape entirely. Everything else follows from that one.
 */

import { describe, expect, it } from 'vitest';
import { UNICODE } from '../src/core/charset/charsets.ts';
import { ck, type Cell } from '../src/core/geom/cell.ts';
import { applyDiff, createGrid, type Grid } from '../src/core/grid/grid.ts';
import { jumpFrom } from '../src/core/grid/jump.ts';
import { stampBox } from '../src/core/stamp/box.ts';

function write(grid: Grid, x: number, y: number, s: string): void {
  [...s].forEach((c, i) => { if (c !== ' ') grid.set(ck(x + i, y), c); });
}

const at = (x: number, y: number): Cell => ({ x, y });

describe('jumping to the edge of what is filled', () => {
  it('rides a run to its last filled cell', () => {
    const grid = createGrid();
    write(grid, 0, 0, 'hello');

    expect(jumpFrom(grid, at(0, 0), 1, 0)).toEqual(at(4, 0));
  });

  it('and back again from the far end', () => {
    const grid = createGrid();
    write(grid, 0, 0, 'hello');

    expect(jumpFrom(grid, at(4, 0), -1, 0)).toEqual(at(0, 0));
  });

  it('crosses a gap to the next filled cell', () => {
    const grid = createGrid();
    write(grid, 0, 0, 'ab');
    write(grid, 9, 0, 'cd');

    // Standing on the last of the first run: over the blanks, onto the next.
    expect(jumpFrom(grid, at(1, 0), 1, 0)).toEqual(at(9, 0));
  });

  it('and from a blank cell lands on the first thing it meets', () => {
    const grid = createGrid();
    write(grid, 9, 0, 'cd');

    expect(jumpFrom(grid, at(2, 0), 1, 0)).toEqual(at(9, 0));
  });

  it('lands on the far wall of the box it is standing in', () => {
    const grid = createGrid();
    applyDiff(grid, stampBox(grid, { x: 0, y: 0, w: 9, h: 5 }, UNICODE));

    // The top edge is one unbroken run, so this is the ride case.
    expect(jumpFrom(grid, at(0, 0), 1, 0)).toEqual(at(8, 0));
    // And down the left wall.
    expect(jumpFrom(grid, at(0, 0), 0, 1)).toEqual(at(0, 4));
  });

  it('crosses from one box to the next', () => {
    const grid = createGrid();
    applyDiff(grid, stampBox(grid, { x: 0, y: 0, w: 5, h: 3 }, UNICODE));
    applyDiff(grid, stampBox(grid, { x: 12, y: 0, w: 5, h: 3 }, UNICODE));

    expect(jumpFrom(grid, at(4, 0), 1, 0)).toEqual(at(12, 0));
  });

  it('stops at the origin rather than going negative (B-PLANE-01)', () => {
    const grid = createGrid();
    write(grid, 0, 0, 'a');

    expect(jumpFrom(grid, at(0, 0), -1, 0)).toEqual(at(0, 0));
    expect(jumpFrom(grid, at(0, 0), 0, -1)).toEqual(at(0, 0));
  });

  it('with nothing to the left, takes the wall', () => {
    const grid = createGrid();
    write(grid, 20, 3, 'far away');

    expect(jumpFrom(grid, at(7, 3), -1, 0)).toEqual(at(0, 3));
  });

  it('and with nothing above, takes the top', () => {
    const grid = createGrid();

    expect(jumpFrom(grid, at(7, 3), 0, -1)).toEqual(at(7, 0));
  });

  it('but right and down only step, because there is no far wall', () => {
    const grid = createGrid();
    write(grid, 0, 0, 'ab');

    expect(jumpFrom(grid, at(1, 0), 1, 0)).toEqual(at(2, 0));
    expect(jumpFrom(grid, at(1, 0), 0, 1)).toEqual(at(1, 1));
  });

  it('an empty document still lets the walls be reached', () => {
    const grid = createGrid();

    expect(jumpFrom(grid, at(5, 5), -1, 0)).toEqual(at(0, 5));
    expect(jumpFrom(grid, at(5, 5), 0, -1)).toEqual(at(5, 0));
    expect(jumpFrom(grid, at(5, 5), 1, 0)).toEqual(at(6, 5));
    expect(jumpFrom(grid, at(5, 5), 0, 1)).toEqual(at(5, 6));
  });

  it('a wall that is already reached is not left', () => {
    const grid = createGrid();

    expect(jumpFrom(grid, at(0, 4), -1, 0)).toEqual(at(0, 4));
    expect(jumpFrom(grid, at(4, 0), 0, -1)).toEqual(at(4, 0));
  });

  it('a single cell with blanks either side jumps over, not onto itself', () => {
    const grid = createGrid();
    write(grid, 4, 0, 'x');
    write(grid, 10, 0, 'y');

    expect(jumpFrom(grid, at(4, 0), 1, 0)).toEqual(at(10, 0));
  });
});

describe('a junction is somewhere to stop (B-KEY-18a)', () => {
  /** A two-column table with a line hanging off its bottom wall. */
  function joined(): Grid {
    const grid = createGrid();
    for (const [y, row] of [
      [0, '┌────────────────┬────────────────┐'],
      [1, '│                │                │'],
      [2, '│                │                │'],
      [3, '│                │                │'],
      [4, '└─────────────┬──┼────────────────┘'],
      [5, '                 │'],
      [6, '                 │'],
      [7, '                 │'],
    ] as const) {
      write(grid, 0, y, row);
    }
    return grid;
  }

  /** Where a run of presses in one direction comes to rest, in order. */
  function walk(grid: Grid, from: Cell, dx: number, dy: number, times: number): Cell[] {
    const out: Cell[] = [];
    let cell = from;
    for (let i = 0; i < times; i++) {
      cell = jumpFrom(grid, cell, dx, dy);
      out.push(cell);
    }
    return out;
  }

  it('stops where a line meets the wall rather than riding past it', () => {
    const grid = joined();

    // The stub at 14, the connector at 17, then the corner. Riding straight to
    // 34 would make the one cell you most want — where the line joins — the one
    // cell this key cannot reach.
    expect(walk(grid, at(0, 4), 1, 0, 3).map((c) => c.x)).toEqual([14, 17, 34]);
  });

  it('and at a table divider on the way along the top', () => {
    const grid = joined();

    expect(walk(grid, at(0, 0), 1, 0, 2).map((c) => c.x)).toEqual([17, 34]);
  });

  it('going down, the wall it crosses is the stop', () => {
    const grid = joined();

    // Down the divider: the bottom wall, then the loose end of the line.
    expect(walk(grid, at(17, 0), 0, 1, 2).map((c) => c.y)).toEqual([4, 7]);
  });

  it('a junction already stood on is one you can leave', () => {
    const grid = joined();

    expect(jumpFrom(grid, at(17, 4), 1, 0)).toEqual(at(34, 4));
    expect(jumpFrom(grid, at(17, 4), -1, 0)).toEqual(at(14, 4));
  });

  it('an unbroken wall still rides all the way', () => {
    const grid = createGrid();
    applyDiff(grid, stampBox(grid, { x: 0, y: 0, w: 9, h: 5 }, UNICODE));

    // Nothing joins it, so there is nothing to stop at before the far corner.
    expect(jumpFrom(grid, at(0, 0), 1, 0)).toEqual(at(8, 0));
  });
});
