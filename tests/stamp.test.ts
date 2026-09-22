import { describe, expect, it } from 'vitest';
import { ASCII, UNICODE } from '../src/core/charset/charsets.ts';
import { applyDiff, createGrid } from '../src/core/grid/grid.ts';
import { stampBox } from '../src/core/stamp/box.ts';
import { convertCharset } from '../src/core/transform/convert.ts';
import { moveDiff } from '../src/core/transform/move.ts';
import { fromText, toText } from '../src/core/io/text.ts';
import { ck } from '../src/core/geom/cell.ts';

function gridWithBox(x: number, y: number, w: number, h: number) {
  const grid = createGrid();
  applyDiff(grid, stampBox(grid, { x, y, w, h }, UNICODE));
  return grid;
}

describe('stampBox', () => {
  it('draws only the border (B-DRAW-06)', () => {
    const grid = gridWithBox(0, 0, 4, 3);
    expect(toText(grid)).toBe(['┌──┐', '│  │', '└──┘'].join('\n'));
  });

  it('refuses to draw below the minimum size (B-DRAW-03)', () => {
    const grid = createGrid();
    expect(stampBox(grid, { x: 0, y: 0, w: 1, h: 5 }, UNICODE).size).toBe(0);
  });

  it('merges connectivity with existing lines instead of overwriting (B-DRAW-07)', () => {
    const grid = gridWithBox(0, 0, 4, 3);
    applyDiff(grid, stampBox(grid, { x: 3, y: 0, w: 4, h: 3 }, UNICODE));

    expect(toText(grid)).toBe(['┌──┬──┐', '│  │  │', '└──┴──┘'].join('\n'));
  });

  it('overwrites text rather than merging with it (B-DRAW-09)', () => {
    const grid = createGrid();
    applyDiff(grid, new Map([[ck(1, 0), 'A']]));
    applyDiff(grid, stampBox(grid, { x: 0, y: 0, w: 4, h: 3 }, UNICODE));

    expect(grid.get(ck(1, 0))).toBe('─');
  });

  it('leaves interior content alone (B-DRAW-06)', () => {
    const grid = createGrid();
    applyDiff(grid, new Map([[ck(2, 1), 'x']]));
    applyDiff(grid, stampBox(grid, { x: 0, y: 0, w: 6, h: 3 }, UNICODE));

    expect(grid.get(ck(2, 1))).toBe('x');
  });
});

describe('applyDiff', () => {
  it('returns an exact inverse (B-DOC-05)', () => {
    const grid = gridWithBox(0, 0, 4, 3);
    const before = toText(grid);

    const inverse = applyDiff(grid, stampBox(grid, { x: 10, y: 10, w: 5, h: 4 }, UNICODE));
    expect(toText(grid)).not.toBe(before);

    applyDiff(grid, inverse);
    expect(toText(grid)).toBe(before);
  });

  it('never stores blanks (B-DOC-02)', () => {
    const grid = createGrid();
    applyDiff(grid, new Map([[ck(0, 0), ' ']]));
    expect(grid.size).toBe(0);
  });
});

describe('convertCharset', () => {
  it('round-trips line cells losslessly (B-CS-04)', () => {
    const grid = gridWithBox(0, 0, 4, 3);
    applyDiff(grid, stampBox(grid, { x: 3, y: 0, w: 4, h: 3 }, UNICODE));
    const original = toText(grid);

    applyDiff(grid, convertCharset(grid, ASCII));
    expect(toText(grid)).toBe(['+--+--+', '|  |  |', '+--+--+'].join('\n'));

    applyDiff(grid, convertCharset(grid, UNICODE));
    expect(toText(grid)).toBe(original);
  });

  it('leaves text untouched (B-CS-05)', () => {
    const grid = createGrid();
    applyDiff(grid, fromText('┌──┐\n│ab│\n└──┘'));
    applyDiff(grid, convertCharset(grid, ASCII));

    expect(grid.get(ck(1, 1))).toBe('a');
    expect(grid.get(ck(2, 1))).toBe('b');
  });
});

describe('moveDiff', () => {
  it('lifts then drops, so overlap does not erase the destination', () => {
    const grid = gridWithBox(0, 0, 4, 3);
    const cells = new Set(grid.keys());

    applyDiff(grid, moveDiff(grid, cells, 1, 0));
    expect(toText(grid)).toBe(['┌──┐', '│  │', '└──┘'].join('\n'));

    // The whole thing shifted right rather than losing its leading column.
    expect(grid.has(ck(0, 0))).toBe(false);
    expect(grid.get(ck(1, 0))).toBe('┌');
  });
});
