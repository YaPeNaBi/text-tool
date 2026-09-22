/**
 * Typing that grows what it is inside (content §4, tables §8).
 *
 * The claim these pin down is that the two are one rule and not two: a box is a
 * table with a single column, and its own border is that column's separator.
 */

import { describe, expect, it } from 'vitest';
import { UNICODE } from '../src/core/charset/charsets.ts';
import { ck } from '../src/core/geom/cell.ts';
import { applyDiff, createGrid, type Grid } from '../src/core/grid/grid.ts';
import { stampBox } from '../src/core/stamp/box.ts';
import { toText } from '../src/core/io/text.ts';
import { recognize, type Candidate } from '../src/core/recognize/recognize.ts';
import { planNewline, planType } from '../src/core/ops/typing.ts';
import { planAddColumn, planAddRow } from '../src/core/ops/lattice.ts';

function boxed(w = 9, h = 3): Grid {
  const grid = createGrid();
  applyDiff(grid, stampBox(grid, { x: 0, y: 0, w, h }, UNICODE));
  return grid;
}

/** Type a word one keystroke at a time, exactly as the store does. */
function type(grid: Grid, x: number, y: number, s: string, insertMode = false): void {
  let cx = x;
  for (const ch of s) {
    applyDiff(grid, planType(grid, { x: cx, y }, ch, { charset: UNICODE, insertMode }).diff);
    cx++;
  }
}

function table(): Grid {
  const grid = createGrid();
  applyDiff(grid, stampBox(grid, { x: 0, y: 0, w: 8, h: 4 }, UNICODE));
  let sel = recognize(grid, 0, 0) as Candidate;
  for (const step of ['col', 'row'] as const) {
    const plan =
      step === 'col'
        ? planAddColumn(grid, sel, { charset: UNICODE })
        : planAddRow(grid, sel, { charset: UNICODE });
    applyDiff(grid, plan.diff);
    sel = plan.selection as Candidate;
  }
  return grid;
}

describe('a box grows with the text in it (content §4)', () => {
  it('keeps its border instead of springing a leak', () => {
    const grid = boxed();
    type(grid, 1, 1, 'reconciliation');

    expect(toText(grid)).toBe(
      ['┌──────────────┐', '│reconciliation│', '└──────────────┘'].join('\n'),
    );
  });

  it('grows one column per keystroke, not one per word', () => {
    const grid = boxed();
    type(grid, 1, 1, 'abcdefghij');

    // Ten letters need ten interior cells, and there are exactly ten.
    expect(recognize(grid, 0, 0)?.bounds).toEqual({ x: 0, y: 0, w: 12, h: 3 });
  });

  it('does not grow while there is still room', () => {
    const grid = boxed();
    type(grid, 1, 1, 'abc');
    expect(recognize(grid, 0, 0)?.bounds).toEqual({ x: 0, y: 0, w: 9, h: 3 });
  });

  it('leaves text outside any shape exactly as it was', () => {
    const grid = createGrid();
    type(grid, 3, 3, 'loose');
    expect(toText(grid)).toBe('loose');
  });

  it('insert mode pushes the word along without pushing the wall', () => {
    const grid = boxed();
    type(grid, 1, 1, 'abcdefg'); // seven letters in seven interior cells
    expect(recognize(grid, 0, 0)?.bounds).toEqual({ x: 0, y: 0, w: 9, h: 3 });

    // Nothing is written on the wall, but the word being shoved along reaches
    // it — which is the case a per-keystroke test would miss.
    type(grid, 1, 1, 'X', true);

    expect(toText(grid)).toBe(
      ['┌────────┐', '│Xabcdefg│', '└────────┘'].join('\n'),
    );
  });

  it('does not shrink back when the text is deleted (content §4, settled)', () => {
    const grid = boxed();
    type(grid, 1, 1, 'reconciliation');
    const grown = recognize(grid, 0, 0)?.bounds;

    for (let x = 1; x <= 14; x++) grid.delete(ck(x, 1));
    expect(recognize(grid, 0, 0)?.bounds).toEqual(grown);
  });
});

describe('Enter deepens the box for the same reason', () => {
  it('grows downward on the last interior row', () => {
    const grid = boxed();
    type(grid, 1, 1, 'one');
    applyDiff(grid, planNewline(grid, { x: 3, y: 1 }, { charset: UNICODE }).diff);
    type(grid, 1, 2, 'two');

    expect(toText(grid)).toBe(
      ['┌───────┐', '│one    │', '│two    │', '└───────┘'].join('\n'),
    );
  });

  it('and does nothing when there is a row to spare', () => {
    const grid = boxed(9, 5);
    expect(planNewline(grid, { x: 1, y: 1 }, { charset: UNICODE }).diff.size).toBe(0);
  });
});

describe('a table cell widens its column (tables §8)', () => {
  it('and every row follows, so the lattice holds', () => {
    const grid = table();
    type(grid, 1, 1, 'Administrator');

    expect(toText(grid)).toBe(
      [
        '┌─────────────┬──────┐',
        '│Administrator│      │',
        '│             │      │',
        '├─────────────┼──────┤',
        '│             │      │',
        '│             │      │',
        '└─────────────┴──────┘',
      ].join('\n'),
    );
  });

  it('the separator survives on every row, which is the whole point', () => {
    const grid = table();
    type(grid, 1, 1, 'Administrator');

    const rail = 14;
    for (const y of [1, 2, 4, 5]) {
      expect(grid.get(ck(rail, y)), `row ${y}`).toBe('│');
    }
    expect(grid.get(ck(rail, 0))).toBe('┬');
    expect(grid.get(ck(rail, 3))).toBe('┼');
    expect(grid.get(ck(rail, 6))).toBe('┴');
  });

  it('typing in the last column grows the table rather than the cell alone', () => {
    const grid = table();
    type(grid, 9, 1, 'Administrator');

    const rows = toText(grid).split('\n');
    // The first column is untouched; the table is wider than it was.
    expect(rows[0]?.startsWith('┌──────┬')).toBe(true);
    expect((rows[0] as string).length).toBeGreaterThan(15);
    // And it is still one rectangle, not a cell hanging off the side.
    expect(rows.every((r) => r.length === (rows[0] as string).length)).toBe(true);
  });
});
