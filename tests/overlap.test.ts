/**
 * Overlapping shapes come apart cleanly (B-MAN-16).
 *
 * Two boxes drawn across each other cross at two `┼`, and each holds a corner
 * of the other inside its bounds. Moving or resizing one of them must leave the
 * other whole and take nothing of it along: the strokes of the other box inside
 * this one are not this one's dividers, and the crossings are the other box's
 * walls as much as this one's.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { HEAVY, UNICODE } from '../src/core/charset/charsets.ts';
import { ck, type Rect } from '../src/core/geom/cell.ts';
import { applyDiff, createGrid, type Grid } from '../src/core/grid/grid.ts';
import { toText } from '../src/core/io/text.ts';
import { stampBox } from '../src/core/stamp/box.ts';
import { stampPath } from '../src/core/stamp/path.ts';
import type { Candidate } from '../src/core/recognize/recognize.ts';
import { candidatesAt, defaultIndex } from '../src/core/recognize/rank.ts';
import { travellingWith } from '../src/core/derive/gather.ts';
import { planMove } from '../src/core/ops/move.ts';
import { planResize } from '../src/core/ops/resize.ts';
import { useEditor } from '../src/app/state/store.ts';

function boxes(...rects: Rect[]): Grid {
  const grid = createGrid();
  for (const r of rects) applyDiff(grid, stampBox(grid, r, UNICODE));
  return grid;
}

/** What a click selects: the most specific reading, as the app takes it. */
function clicked(grid: Grid, x: number, y: number): Candidate {
  const list = candidatesAt(grid, x, y);
  const picked = list[defaultIndex(list)];
  if (picked === undefined) throw new Error('nothing at the seed');
  return picked;
}

const A: Rect = { x: 5, y: 0, w: 13, h: 6 };
const B: Rect = { x: 0, y: 3, w: 10, h: 5 };

/** The picture from the report: B drawn across A's lower-left corner. */
const crossed = (): Grid => boxes(A, B);

describe('the picture', () => {
  it('is two boxes crossing at two points', () => {
    expect(toText(crossed())).toBe(
      [
        '     ┌───────────┐',
        '     │           │',
        '     │           │',
        '┌────┼───┐       │',
        '│    │   │       │',
        '│    └───┼───────┘',
        '│        │',
        '└────────┘',
      ].join('\n'),
    );
  });

  it('neither box counts the other’s corner as its own', () => {
    const grid = crossed();
    for (const shape of [clicked(grid, 0, 4), clicked(grid, 12, 0)]) {
      expect(shape.kind).toBe('box');
      expect(travellingWith(grid, shape).size).toBe(shape.cells.size);
    }
  });
});

describe('moving one off the other', () => {
  it('takes B away whole and leaves A whole — the case from the report', () => {
    const grid = crossed();
    applyDiff(grid, planMove(grid, clicked(grid, 0, 4), 0, 7, { charset: UNICODE }).diff);

    expect(toText(grid)).toBe(
      [
        '     ┌───────────┐',
        '     │           │',
        '     │           │',
        '     │           │',
        '     │           │',
        '     └───────────┘',
        '',
        '',
        '',
        '',
        '┌────────┐',
        '│        │',
        '│        │',
        '│        │',
        '└────────┘',
      ].join('\n'),
    );
  });

  it('and the other way round: A away, B whole', () => {
    const grid = crossed();
    applyDiff(grid, planMove(grid, clicked(grid, 12, 0), 6, 0, { charset: UNICODE }).diff);

    expect(toText(grid)).toBe(
      [
        '           ┌───────────┐',
        '           │           │',
        '           │           │',
        '┌────────┐ │           │',
        '│        │ │           │',
        '│        │ └───────────┘',
        '│        │',
        '└────────┘',
      ].join('\n'),
    );
  });

  it('a step at a time stays two crossing boxes until they part', () => {
    const grid = crossed();
    let b = clicked(grid, 0, 4);
    for (let step = 0; step < 7; step++) {
      const plan = planMove(grid, b, 0, 1, { charset: UNICODE });
      applyDiff(grid, plan.diff);
      b = plan.selection ?? b;
    }
    expect(toText(grid).split('\n').slice(10)).toEqual([
      '┌────────┐',
      '│        │',
      '│        │',
      '│        │',
      '└────────┘',
    ]);
    expect(clicked(grid, 12, 0).bounds).toEqual(A);
  });

  it('a box crossed at four points leaves the other whole too', () => {
    // A tall box through a wide one: a plus sign of two boxes.
    const grid = boxes({ x: 3, y: 0, w: 4, h: 5 }, { x: 0, y: 1, w: 10, h: 3 });
    // The tall box's walls cut the wide one into three closed rectangles, so a
    // first click takes only the left third; clicking again widens to the whole
    // box (B-REC-11), which is what is moved here.
    const wide = candidatesAt(grid, 0, 2).find((c) => c.bounds.w === 10);
    if (wide === undefined) throw new Error('no reading of the whole wide box');
    applyDiff(grid, planMove(grid, wide, 0, 6, { charset: UNICODE }).diff);

    expect(toText(grid)).toBe(
      [
        '   ┌──┐',
        '   │  │',
        '   │  │',
        '   │  │',
        '   └──┘',
        '',
        '',
        '┌────────┐',
        '│        │',
        '└────────┘',
      ].join('\n'),
    );
  });
});

describe('resizing one off the other', () => {
  it('B narrowed clear of A leaves A without holes', () => {
    const grid = crossed();
    const plan = planResize(grid, clicked(grid, 0, 4), { x: 0, y: 3, w: 4, h: 5 }, { charset: UNICODE });
    applyDiff(grid, plan.diff);

    expect(toText(grid)).toBe(
      [
        '     ┌───────────┐',
        '     │           │',
        '     │           │',
        '┌──┐ │           │',
        '│  │ │           │',
        '│  │ └───────────┘',
        '│  │',
        '└──┘',
      ].join('\n'),
    );
  });

  it('A pulled in from the left leaves B without holes', () => {
    const grid = crossed();
    const plan = planResize(grid, clicked(grid, 12, 0), { x: 11, y: 0, w: 7, h: 6 }, { charset: UNICODE });
    applyDiff(grid, plan.diff);

    expect(toText(grid)).toBe(
      [
        '           ┌─────┐',
        '           │     │',
        '           │     │',
        '┌────────┐ │     │',
        '│        │ │     │',
        '│        │ └─────┘',
        '│        │',
        '└────────┘',
      ].join('\n'),
    );
  });

  it('a box sharing a wall leaves its neighbour the wall', () => {
    const grid = boxes({ x: 0, y: 0, w: 7, h: 4 }, { x: 6, y: 0, w: 7, h: 4 });
    expect(toText(grid).split('\n')[0]).toBe('┌─────┬─────┐');

    const plan = planResize(grid, clicked(grid, 1, 0), { x: 0, y: 0, w: 4, h: 4 }, { charset: UNICODE });
    applyDiff(grid, plan.diff);

    expect(toText(grid)).toBe(
      ['┌──┐  ┌─────┐', '│  │  │     │', '│  │  │     │', '└──┘  └─────┘'].join('\n'),
    );
  });
});

describe('a box across a table', () => {
  /** A two-column table, and a box whose corner crosses its divider and its walls. */
  function tableAndBox(): Grid {
    const grid = boxes({ x: 0, y: 0, w: 9, h: 5 });
    applyDiff(grid, stampPath(grid, { x: 4, y: 0 }, { x: 4, y: 4 }, UNICODE));
    applyDiff(grid, stampBox(grid, { x: 2, y: 2, w: 10, h: 5 }, UNICODE));
    return grid;
  }

  it('is drawn crossing the divider', () => {
    expect(toText(tableAndBox()).split('\n').slice(0, 5)).toEqual([
      '┌───┬───┐',
      '│   │   │',
      '│ ┌─┼───┼──┐',
      '│ │ │   │  │',
      '└─┼─┴───┘  │',
    ]);
  });

  it('moving the table takes its divider whole and leaves the box whole', () => {
    const grid = tableAndBox();
    const table = candidatesAt(grid, 0, 1).find((c) => c.bounds.w === 9 && c.bounds.h === 5);
    if (table === undefined) throw new Error('no reading of the whole table');
    applyDiff(grid, planMove(grid, table, 15, 0, { charset: UNICODE }).diff);

    // Read from the origin, so the columns the table left are in the picture.
    expect(toText(grid, { x: 0, y: 0, w: 24, h: 7 })).toBe(
      [
        '               ┌───┬───┐',
        '               │   │   │',
        '  ┌────────┐   │   │   │',
        '  │        │   │   │   │',
        '  │        │   └───┴───┘',
        '  │        │',
        '  └────────┘',
      ].join('\n'),
    );
  });

  it('moving the box leaves the table whole, divider and all', () => {
    const grid = tableAndBox();
    applyDiff(grid, planMove(grid, clicked(grid, 11, 4), 0, 6, { charset: UNICODE }).diff);

    expect(toText(grid).split('\n').slice(0, 5)).toEqual([
      '┌───┬───┐',
      '│   │   │',
      '│   │   │',
      '│   │   │',
      '└───┴───┘',
    ]);
  });
});

describe('what has not changed', () => {
  it('a table still carries its own dividers', () => {
    const grid = boxes({ x: 0, y: 0, w: 9, h: 4 });
    applyDiff(grid, stampPath(grid, { x: 4, y: 0 }, { x: 4, y: 3 }, UNICODE));
    const table = candidatesAt(grid, 0, 1).find((c) => c.bounds.w === 9);
    if (table === undefined) throw new Error('no table reading');

    applyDiff(grid, planMove(grid, table, 0, 2, { charset: UNICODE }).diff);
    // Read from the origin, so the two rows it moved down by are in the picture.
    expect(toText(grid, { x: 0, y: 0, w: 9, h: 6 })).toBe(
      ['', '', '┌───┬───┐', '│   │   │', '│   │   │', '└───┴───┘'].join('\n'),
    );
  });
});

describe('restyling one leaves the other alone', () => {
  beforeEach(() => {
    useEditor.getState().clearAll();
    useEditor.getState().setTool('select');
  });

  it('only B’s own walls change set, not A’s strokes inside it', () => {
    useEditor.getState().loadText(toText(crossed()), 'x.txt');
    useEditor.getState().selectAt({ x: 0, y: 4 });
    useEditor.getState().restyleSelection(HEAVY.id);

    const grid = useEditor.getState().grid;
    expect(grid.get(ck(0, 4))).toBe('┃'); // B's wall
    expect(grid.get(ck(5, 4))).toBe('│'); // A's wall, inside B
    expect(grid.get(ck(7, 5))).toBe('─'); // A's floor, inside B
  });
});
