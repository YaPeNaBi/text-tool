/**
 * A block of text (content §1).
 *
 * The recognizer reports a run of letters on one row, because that is what it
 * can say about characters alone. It is rarely what a person means: two lines
 * stacked are a paragraph, and three lines in a box are that box's label.
 */

import { describe, expect, it } from 'vitest';
import { UNICODE } from '../src/core/charset/charsets.ts';
import { ck } from '../src/core/geom/cell.ts';
import { applyDiff, createGrid, type Grid } from '../src/core/grid/grid.ts';
import { stampBox } from '../src/core/stamp/box.ts';
import { containersAt } from '../src/core/derive/contain.ts';
import { textBlockAt } from '../src/core/derive/label.ts';
import { selectFlow, selectWithin } from '../src/core/recognize/recognize.ts';

function write(grid: Grid, x: number, y: number, s: string): void {
  [...s].forEach((c, i) => {
    if (c !== ' ') grid.set(ck(x + i, y), c);
  });
}

/** What the store does: ask what encloses the cell, then ask for the block. */
function blockAt(grid: Grid, x: number, y: number): Set<string> {
  const inside = containersAt(grid, x, y)[0];
  return textBlockAt(grid, inside?.bounds ?? null, x, y);
}

describe('loose text', () => {
  it('takes the line below, and the one below that', () => {
    const grid = createGrid();
    write(grid, 2, 1, 'one');
    write(grid, 2, 2, 'two');
    write(grid, 2, 3, 'three');

    expect(blockAt(grid, 3, 1).size).toBe(11);
  });

  it('and the line above, whichever line was clicked', () => {
    const grid = createGrid();
    write(grid, 2, 1, 'one');
    write(grid, 2, 2, 'two');

    expect(blockAt(grid, 3, 2)).toEqual(blockAt(grid, 3, 1));
  });

  it('but not a line that shares no column with it', () => {
    const grid = createGrid();
    write(grid, 0, 1, 'here');
    write(grid, 20, 2, 'elsewhere');

    // Directly below is what makes it the same paragraph. A word further along
    // the page is a separate thought, however close the rows.
    expect(blockAt(grid, 1, 1).size).toBe(4);
  });

  it('nor one with a blank row between', () => {
    const grid = createGrid();
    write(grid, 2, 1, 'one');
    write(grid, 2, 3, 'three');

    expect(blockAt(grid, 3, 1).size).toBe(3);
  });

  it('joins two runs on the same row through the line above them', () => {
    const grid = createGrid();
    write(grid, 0, 0, 'aaaaaaa');
    write(grid, 0, 1, 'bb');
    write(grid, 5, 1, 'cc');

    // Both lower runs sit under the same line, so all three are one block.
    expect(blockAt(grid, 1, 1).size).toBe(11);
  });
});

describe('text inside a shape', () => {
  function boxed(): Grid {
    const grid = createGrid();
    applyDiff(grid, stampBox(grid, { x: 0, y: 0, w: 11, h: 5 }, UNICODE));
    return grid;
  }

  it('is the whole label, gaps and all', () => {
    const grid = boxed();
    write(grid, 1, 1, 'ab');
    write(grid, 1, 3, 'cd');

    // Rows 1 and 3 with a blank row between: loose on the page these would be
    // two paragraphs, but inside a box they are one label.
    expect(blockAt(grid, 1, 1).size).toBe(4);
  });

  it('and stops at the wall', () => {
    const grid = boxed();
    write(grid, 1, 1, 'inside');
    write(grid, 12, 1, 'outside');

    expect(blockAt(grid, 2, 1).size).toBe(6);
  });

  it('the box itself is what encloses it', () => {
    const grid = boxed();
    write(grid, 1, 1, 'ab');
    expect(containersAt(grid, 1, 1)[0]?.bounds).toEqual({ x: 0, y: 0, w: 11, h: 5 });
  });
});

describe('sweeping a selection in reading order', () => {
  it('runs to the end of a row and on to the next', () => {
    const grid = createGrid();
    write(grid, 0, 0, 'abcd');
    write(grid, 0, 1, 'efgh');

    // From 'c' to 'f': c, d, e, f — not the rectangle those two corners make.
    const sel = selectFlow(grid, { x: 2, y: 0 }, { x: 1, y: 1 });
    expect(sel?.cells.size).toBe(4);
    expect(sel?.cells.has(ck(3, 0))).toBe(true); // 'd', past the far corner
    expect(sel?.cells.has(ck(2, 1))).toBe(false); // 'g', beyond the end
  });

  it('is the same whichever end it is dragged from', () => {
    const grid = createGrid();
    write(grid, 0, 0, 'abcd');
    write(grid, 0, 1, 'efgh');

    const down = selectFlow(grid, { x: 2, y: 0 }, { x: 1, y: 1 });
    const up = selectFlow(grid, { x: 1, y: 1 }, { x: 2, y: 0 });
    expect([...(up?.cells ?? [])].sort()).toEqual([...(down?.cells ?? [])].sort());
  });

  it('on one row it is just that stretch of it', () => {
    const grid = createGrid();
    write(grid, 0, 0, 'abcdef');

    expect(selectFlow(grid, { x: 1, y: 0 }, { x: 3, y: 0 })?.cells.size).toBe(3);
  });

  it('takes only what is there, not the blanks between', () => {
    const grid = createGrid();
    write(grid, 0, 0, 'ab');
    write(grid, 8, 0, 'cd');

    expect(selectFlow(grid, { x: 0, y: 0 }, { x: 9, y: 0 })?.cells.size).toBe(4);
  });

  it('and is a different answer from the rectangle through the same corners', () => {
    const grid = createGrid();
    write(grid, 0, 0, 'abcd');
    write(grid, 0, 1, 'efgh');

    const flow = selectFlow(grid, { x: 2, y: 0 }, { x: 1, y: 1 });
    const area = selectWithin(grid, { x: 1, y: 0, w: 2, h: 2 });

    // Four cells each, and not the same four: the flow runs off the right of
    // row 0 and starts again at the left of row 1, where the rectangle stays
    // between two columns throughout.
    expect(flow?.cells.has(ck(3, 0))).toBe(true);
    expect(area?.cells.has(ck(3, 0))).toBe(false);
    expect(area?.cells.has(ck(1, 0))).toBe(true);
    expect(flow?.cells.has(ck(1, 0))).toBe(false);
  });
});
