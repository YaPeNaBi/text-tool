/**
 * Adding a column and a row to a box, and what that makes of it.
 *
 * The interesting claim is not that the picture comes out right — it is that
 * the result is still *one shape*. A lattice is several rectangles sharing
 * walls, which is exactly the arrangement the editor treats as neighbours
 * everywhere else, so the tests that matter most here are the ones about
 * moving it afterwards.
 */

import { describe, expect, it } from 'vitest';
import { UNICODE } from '../src/core/charset/charsets.ts';
import { ck, type Rect } from '../src/core/geom/cell.ts';
import { applyDiff, createGrid, type Grid } from '../src/core/grid/grid.ts';
import { stampBox } from '../src/core/stamp/box.ts';
import { stampEllipse } from '../src/core/stamp/ellipse.ts';
import { stampPath } from '../src/core/stamp/path.ts';
import { toText } from '../src/core/io/text.ts';
import { recognize, selectWithin, type Candidate } from '../src/core/recognize/recognize.ts';
import { candidatesAt, defaultIndex } from '../src/core/recognize/rank.ts';
import { planMove } from '../src/core/ops/move.ts';
import {
  canDivide,
  columnEdges,
  planAddColumn,
  planAddRow,
  neighbourCell,
  planResizeTrack,
  railAt,
  rowEdges,
  tableOf,
  type Rail,
} from '../src/core/ops/lattice.ts';
import { dividersInside } from '../src/core/derive/contain.ts';
import { travellingWith } from '../src/core/derive/gather.ts';

function write(grid: Grid, x: number, y: number, s: string): void {
  [...s].forEach((c, i) => { if (c !== ' ') grid.set(ck(x + i, y), c); });
}

function boxed(w = 8, h = 4): Grid {
  const grid = createGrid();
  applyDiff(grid, stampBox(grid, { x: 0, y: 0, w, h }, UNICODE));
  return grid;
}

/** What the app does on a fresh click. */
function clicked(grid: Grid, x: number, y: number): Candidate {
  const list = candidatesAt(grid, x, y);
  const picked = list[defaultIndex(list)];
  if (picked === undefined) throw new Error('nothing there');
  return picked;
}

/** Run a sequence of the two operations, threading the selection through. */
function build(grid: Grid, steps: ReadonlyArray<'col' | 'row'>): Candidate {
  let sel = recognize(grid, 0, 0);
  if (sel === null) throw new Error('no box');

  for (const step of steps) {
    const plan =
      step === 'col'
        ? planAddColumn(grid, sel, { charset: UNICODE })
        : planAddRow(grid, sel, { charset: UNICODE });
    expect(plan.refused).toBeUndefined();
    applyDiff(grid, plan.diff);
    sel = plan.selection as Candidate;
  }
  return sel;
}

describe('adding a column', () => {
  it('widens the box and turns the old wall into a divider', () => {
    const grid = boxed();
    build(grid, ['col']);

    expect(toText(grid)).toBe(
      [
        '┌──────┬──────┐',
        '│      │      │',
        '│      │      │',
        '└──────┴──────┘',
      ].join('\n'),
    );
  });

  it('makes the new column as wide as the last, so three come out even', () => {
    const grid = boxed();
    build(grid, ['col', 'col']);

    expect(toText(grid)).toBe(
      [
        '┌──────┬──────┬──────┐',
        '│      │      │      │',
        '│      │      │      │',
        '└──────┴──────┴──────┘',
      ].join('\n'),
    );
  });

  it('never moves what is already inside', () => {
    const grid = boxed();
    applyDiff(grid, stampBox(grid, { x: 2, y: 1, w: 3, h: 2 }, UNICODE));
    const before = toText(grid).split('\n');

    build(grid, ['col']);
    const after = toText(grid).split('\n');

    // Every cell of the original box's interior is where it was.
    for (let y = 1; y < 3; y++) {
      expect((after[y] as string).slice(1, 7)).toBe((before[y] as string).slice(1, 7));
    }
  });

  it('says what it did, because the box changed beyond where it was clicked', () => {
    const grid = boxed();
    const sel = recognize(grid, 0, 0) as Candidate;
    expect(planAddColumn(grid, sel, { charset: UNICODE }).note).toContain('Column added');
  });
});

describe('adding a row', () => {
  it('deepens the box, and closes the columns above it', () => {
    const grid = boxed();
    build(grid, ['col', 'row']);

    expect(toText(grid)).toBe(
      [
        '┌──────┬──────┐',
        '│      │      │',
        '│      │      │',
        '├──────┼──────┤',
        '│      │      │',
        '│      │      │',
        '└──────┴──────┘',
      ].join('\n'),
    );
  });

  it('reads its own structure back, so a second row matches the first', () => {
    const grid = boxed();
    const sel = build(grid, ['row']);

    expect(rowEdges(grid, sel.bounds)).toEqual([3]);
    expect(columnEdges(grid, sel.bounds)).toEqual([]);
  });
});

describe('a lattice is still one shape', () => {
  it('carries its dividers when it moves', () => {
    const grid = boxed();
    const sel = build(grid, ['col', 'row']);

    expect(dividersInside(grid, sel).size).toBeGreaterThan(0);
    expect(travellingWith(grid, sel).size).toBeGreaterThan(sel.cells.size);

    applyDiff(grid, planMove(grid, sel, 4, 2, { charset: UNICODE }).diff);

    // It ended up four right and two down, with nothing at all left behind —
    // `toText` crops to the content, so an intact picture and an empty origin
    // together are what say the whole thing travelled.
    expect(recognize(grid, 4, 2)?.bounds).toEqual({ x: 4, y: 2, w: 15, h: 7 });
    expect(grid.has(ck(0, 0))).toBe(false);
    expect(toText(grid)).toBe(
      [
        '┌──────┬──────┐',
        '│      │      │',
        '│      │      │',
        '├──────┼──────┤',
        '│      │      │',
        '│      │      │',
        '└──────┴──────┘',
      ].join('\n'),
    );
  });

  it('a click still takes one cell of it, and drilling reaches the whole', () => {
    const grid = boxed();
    build(grid, ['col']);

    // Most specific first: the cell you pointed at, not the table (B-REC-11).
    expect(clicked(grid, 3, 0).bounds).toEqual({ x: 0, y: 0, w: 8, h: 4 });
    const readings = candidatesAt(grid, 3, 0).map((c) => c.bounds.w);
    expect(readings).toContain(15);
  });
});

describe('growing over a connector', () => {
  function wired(): Grid {
    const grid = boxed();
    applyDiff(grid, stampBox(grid, { x: 24, y: 0, w: 8, h: 4 }, UNICODE));
    applyDiff(grid, stampPath(grid, { x: 8, y: 1 }, { x: 24, y: 1 }, UNICODE, { headEnd: true }));
    return grid;
  }

  it('re-routes rather than swallowing the line it grew onto', () => {
    const grid = wired();
    applyDiff(grid, planAddColumn(grid, clicked(grid, 3, 0), { charset: UNICODE }).diff);

    expect(toText(grid)).toBe(
      [
        '┌──────┬──────┐         ┌──────┐',
        '│      │      ├────────▶│      │',
        '│      │      │         │      │',
        '└──────┴──────┘         └──────┘',
      ].join('\n'),
    );
  });

  it('the new wall wears a join, not a crossing', () => {
    const grid = wired();
    applyDiff(grid, planAddColumn(grid, clicked(grid, 3, 0), { charset: UNICODE }).diff);
    // `├` is the line arriving at the wall. `┼` would be the wall built on top
    // of a shaft still lying under it, with the line passing straight through.
    expect(grid.get(ck(14, 1))).toBe('├');
  });
});

describe('what will not take a column', () => {
  it('refuses a circle, and changes nothing', () => {
    const grid = createGrid();
    applyDiff(grid, stampEllipse(grid, { x: 0, y: 0, w: 9, h: 9 }, UNICODE));
    const sel = recognize(grid, 4, 0) as Candidate;
    expect(sel.kind).toBe('ellipse');

    const plan = planAddColumn(grid, sel, { charset: UNICODE });
    expect(plan.refused).toBeDefined();
    expect(plan.diff.size).toBe(0);
    expect(canDivide(sel)).toBe(false);
  });

  it('and the menu will not offer itself over a line or nothing at all', () => {
    const grid = createGrid();
    applyDiff(grid, stampPath(grid, { x: 0, y: 0 }, { x: 6, y: 0 }, UNICODE, {}));
    expect(canDivide(recognize(grid, 0, 0))).toBe(false);
    expect(canDivide(null)).toBe(false);
  });
});

describe('one gesture, one undo step', () => {
  it('undo puts the box back exactly', () => {
    const grid = boxed();
    const before = toText(grid);
    const sel = recognize(grid, 0, 0) as Candidate;

    const inverse = applyDiff(grid, planAddColumn(grid, sel, { charset: UNICODE }).diff);
    applyDiff(grid, inverse);
    expect(toText(grid)).toBe(before);
  });
});

describe('a new track copies the one beside it', () => {
  it('a column added to a table with rows is divided by those rows', () => {
    const grid = boxed();
    build(grid, ['row', 'col']);

    expect(toText(grid)).toBe(
      [
        '┌──────┬──────┐',
        '│      │      │',
        '│      │      │',
        '├──────┼──────┤',
        '│      │      │',
        '│      │      │',
        '└──────┴──────┘',
      ].join('\n'),
    );
  });

  it('and a row added to a table with columns is divided by those columns', () => {
    const grid = boxed();
    build(grid, ['col', 'row']);

    // The same table either way round, which is the point: the two operations
    // are not each other's special case.
    expect(toText(grid)).toBe(
      [
        '┌──────┬──────┐',
        '│      │      │',
        '│      │      │',
        '├──────┼──────┤',
        '│      │      │',
        '│      │      │',
        '└──────┴──────┘',
      ].join('\n'),
    );
  });

  it('every intersection is a crossing, however many tracks there are', () => {
    const grid = boxed();
    build(grid, ['col', 'col', 'row', 'row']);

    const text = toText(grid);
    expect(text.split('\n')).toEqual([
      '┌──────┬──────┬──────┐',
      '│      │      │      │',
      '│      │      │      │',
      '├──────┼──────┼──────┤',
      '│      │      │      │',
      '│      │      │      │',
      '├──────┼──────┼──────┤',
      '│      │      │      │',
      '│      │      │      │',
      '└──────┴──────┴──────┘',
    ]);
    // Three columns and three rows: nine cells, not one big one and eight gaps.
    expect(text.split('\n').filter((r) => r.includes('┼')).length).toBe(2);
  });

  it('reads the divisions off the neighbour, not off the top of the table', () => {
    const grid = boxed();
    const sel = build(grid, ['col', 'row']);

    // The bottom row is divided the way the top row is, so the edges read the
    // same at both rails.
    expect(columnEdges(grid, sel.bounds, sel.bounds.y)).toEqual([7]);
    expect(columnEdges(grid, sel.bounds, 3)).toEqual([7]);
  });
});

describe('resizing a track (tables §7)', () => {
  function table(): { grid: Grid; sel: Candidate } {
    const grid = boxed();
    const sel = build(grid, ['col', 'row']);
    return { grid, sel };
  }

  it('finds the separator under the pointer, and only the separator', () => {
    const { grid } = table();

    expect(railAt(grid, 7, 1)).toMatchObject({ axis: 'column', at: 7 });
    expect(railAt(grid, 1, 3)).toMatchObject({ axis: 'row', at: 3 });
    // The table is worked out from the rail, not guessed at.
    expect(railAt(grid, 7, 1)?.table).toEqual({ x: 0, y: 0, w: 15, h: 7 });

    // The outer walls are the resize handles' business, not a column's.
    expect(railAt(grid, 0, 1)).toBeNull();
    expect(railAt(grid, 14, 1)).toBeNull();
    expect(railAt(grid, 3, 0)).toBeNull();
    expect(railAt(grid, 3, 6)).toBeNull();
    // And blank space is not a rail at all.
    expect(railAt(grid, 3, 1)).toBeNull();
  });

  it('widens the column to its left and shifts the rest right', () => {
    const { grid } = table();
    const rail = railAt(grid, 7, 1) as Rail;
    applyDiff(grid, planResizeTrack(grid, rail.table, rail.axis, rail.at, 4, {
      charset: UNICODE,
    }).diff);

    expect(toText(grid)).toBe(
      [
        '┌──────────┬──────┐',
        '│          │      │',
        '│          │      │',
        '├──────────┼──────┤',
        '│          │      │',
        '│          │      │',
        '└──────────┴──────┘',
      ].join('\n'),
    );
  });

  it('deepens the row above a horizontal separator', () => {
    const { grid } = table();
    const rail = railAt(grid, 1, 3) as Rail;
    applyDiff(grid, planResizeTrack(grid, rail.table, rail.axis, rail.at, 2, {
      charset: UNICODE,
    }).diff);

    const rows = toText(grid).split('\n');
    expect(rows.length).toBe(9);
    expect(rows[5]).toBe('├──────┼──────┤');
  });

  it('narrows back to exactly where it started', () => {
    const { grid } = table();
    const before = toText(grid);
    const rail = railAt(grid, 7, 1) as Rail;

    applyDiff(grid, planResizeTrack(grid, rail.table, 'column', 7, 4, { charset: UNICODE }).diff);
    const wider = railAt(grid, 11, 1) as Rail;
    applyDiff(grid, planResizeTrack(grid, wider.table, 'column', 11, -4, { charset: UNICODE }).diff);

    expect(toText(grid)).toBe(before);
  });

  it('will not narrow a column into its own wall', () => {
    const { grid } = table();
    const rail = railAt(grid, 7, 1) as Rail;
    // Ask for far more than there is room for.
    applyDiff(grid, planResizeTrack(grid, rail.table, 'column', 7, -20, {
      charset: UNICODE,
    }).diff);

    const rows = toText(grid).split('\n');
    expect(rows[0]).toBe('┌─┬──────┐'); // one interior cell left, not none
    expect(rows[1]).toBe('│ │      │');
  });

  it('carries the cells of the columns it shifts', () => {
    const { grid } = table();
    write(grid, 1, 1, 'ab');
    write(grid, 9, 1, 'cd');

    const rail = railAt(grid, 7, 1) as Rail;
    applyDiff(grid, planResizeTrack(grid, rail.table, 'column', 7, 3, { charset: UNICODE }).diff);

    // The left column's text stayed; the right column's moved with its walls.
    expect(grid.get(ck(1, 1))).toBe('a');
    expect(grid.get(ck(12, 1))).toBe('c');
  });

  it('a plain box is a table with one column, and grows the same way', () => {
    const grid = boxed(9, 3);
    // Its own right border is that single column's rail.
    applyDiff(grid, planResizeTrack(grid, { x: 0, y: 0, w: 9, h: 3 }, 'column', 8, 5, {
      charset: UNICODE,
    }).diff);

    // Nine wide plus five is fourteen: the same arithmetic a column does.
    expect(toText(grid)).toBe(
      ['┌────────────┐', '│            │', '└────────────┘'].join('\n'),
    );
  });
});

describe('walking the cells of a table', () => {
  function table(): Grid {
    const grid = boxed();
    build(grid, ['col', 'row']);
    return grid;
  }

  const first = { x: 0, y: 0, w: 8, h: 4 };

  it('steps to the neighbour in each direction', () => {
    const grid = table();

    expect(neighbourCell(grid, first, 1, 0)).toEqual({ x: 7, y: 0, w: 8, h: 4 });
    expect(neighbourCell(grid, first, 0, 1)).toEqual({ x: 0, y: 3, w: 8, h: 4 });
    // Nothing lies west or north of the first cell.
    expect(neighbourCell(grid, first, -1, 0)).toBeNull();
    expect(neighbourCell(grid, first, 0, -1)).toBeNull();
  });

  it('and comes back to where it started', () => {
    const grid = table();
    const east = neighbourCell(grid, first, 1, 0) as Rect;
    expect(neighbourCell(grid, east, -1, 0)).toEqual(first);

    const south = neighbourCell(grid, first, 0, 1) as Rect;
    expect(neighbourCell(grid, south, 0, -1)).toEqual(first);
  });

  it('finds the table from any cell of it', () => {
    const grid = table();
    const whole = { x: 0, y: 0, w: 15, h: 7 };

    expect(tableOf(grid, first)).toEqual(whole);
    expect(tableOf(grid, { x: 7, y: 3, w: 8, h: 4 })).toEqual(whole);
  });

  it('a plain box has no neighbours, so arrow keys still nudge it', () => {
    const grid = boxed(6, 3);
    const box = { x: 0, y: 0, w: 6, h: 3 };

    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      expect(neighbourCell(grid, box, dx, dy), `${dx},${dy}`).toBeNull();
    }
    // A box is a table of one cell — that is why there is nothing to step to.
    expect(tableOf(grid, box)).toEqual(box);
  });

  it('steps across a column of uneven width', () => {
    const grid = table();
    const rail = railAt(grid, 7, 1) as Rail;
    applyDiff(grid, planResizeTrack(grid, rail.table, 'column', 7, 5, { charset: UNICODE }).diff);

    // The first cell is wider now, and stepping east lands on the second whole.
    expect(neighbourCell(grid, { x: 0, y: 0, w: 13, h: 4 }, 1, 0)).toEqual({
      x: 12,
      y: 0,
      w: 8,
      h: 4,
    });
  });
});

describe('growing pushes what is in the way', () => {
  it('moves a neighbouring box along instead of writing over it', () => {
    const grid = boxed(9, 3);
    applyDiff(grid, stampBox(grid, { x: 12, y: 0, w: 7, h: 3 }, UNICODE));

    applyDiff(grid, planResizeTrack(grid, { x: 0, y: 0, w: 9, h: 3 }, 'column', 8, 6, {
      charset: UNICODE,
    }).diff);

    // Both boxes are whole, and the gap between them is the one it had.
    expect(toText(grid)).toBe(
      [
        '┌─────────────┐   ┌─────┐',
        '│             │   │     │',
        '└─────────────┘   └─────┘',
      ].join('\n'),
    );
  });

  it('carries loose text along too', () => {
    const grid = boxed(9, 3);
    write(grid, 10, 1, 'note'); // two cells clear of the wall

    applyDiff(grid, planResizeTrack(grid, { x: 0, y: 0, w: 9, h: 3 }, 'column', 8, 4, {
      charset: UNICODE,
    }).diff);

    expect(toText(grid)).toContain('note');
    expect(grid.get(ck(14, 1))).toBe('n');
  });

  it('but only pushes what it actually reaches', () => {
    const grid = boxed(9, 3);
    write(grid, 14, 1, 'note'); // six cells clear

    applyDiff(grid, planResizeTrack(grid, { x: 0, y: 0, w: 9, h: 3 }, 'column', 8, 4, {
      charset: UNICODE,
    }).diff);

    // Four cells of growth stops at column 12, so the note never felt it.
    expect(grid.get(ck(14, 1))).toBe('n');
  });

  it('shoves a whole row of neighbours, each into the next', () => {
    const grid = boxed(9, 3);
    applyDiff(grid, stampBox(grid, { x: 9, y: 0, w: 5, h: 3 }, UNICODE));
    applyDiff(grid, stampBox(grid, { x: 15, y: 0, w: 5, h: 3 }, UNICODE));

    applyDiff(grid, planResizeTrack(grid, { x: 0, y: 0, w: 9, h: 3 }, 'column', 8, 3, {
      charset: UNICODE,
    }).diff);

    // The first neighbour was touched directly; the second only because the
    // first arrived on it. Both moved by the same three, so the gaps held.
    expect(recognize(grid, 12, 1)?.bounds).toEqual({ x: 12, y: 0, w: 5, h: 3 });
    expect(recognize(grid, 18, 1)?.bounds).toEqual({ x: 18, y: 0, w: 5, h: 3 });
  });

  it('leaves alone what is not in its row band', () => {
    const grid = boxed(9, 3);
    applyDiff(grid, stampBox(grid, { x: 12, y: 8, w: 7, h: 3 }, UNICODE));

    applyDiff(grid, planResizeTrack(grid, { x: 0, y: 0, w: 9, h: 3 }, 'column', 8, 6, {
      charset: UNICODE,
    }).diff);

    // The lower box shares no row with the one that grew, so nothing pushed it.
    expect(recognize(grid, 12, 8)?.bounds).toEqual({ x: 12, y: 8, w: 7, h: 3 });
  });

  it('leaves alone something already overlapping, rather than tearing it', () => {
    const grid = boxed(9, 3);
    // Straddles the right wall: half in, half out.
    applyDiff(grid, stampBox(grid, { x: 6, y: 0, w: 7, h: 3 }, UNICODE));
    const before = recognize(grid, 12, 1)?.bounds;

    applyDiff(grid, planResizeTrack(grid, { x: 0, y: 0, w: 9, h: 3 }, 'column', 8, 3, {
      charset: UNICODE,
    }).diff);

    // Moving half a shape is worse than the collision it was meant to avoid.
    expect(recognize(grid, 12, 1)?.bounds).toEqual(before);
  });

  it('does not pull things back when the track narrows', () => {
    const grid = boxed(15, 3);
    applyDiff(grid, stampBox(grid, { x: 18, y: 0, w: 7, h: 3 }, UNICODE));

    applyDiff(grid, planResizeTrack(grid, { x: 0, y: 0, w: 15, h: 3 }, 'column', 14, -5, {
      charset: UNICODE,
    }).diff);

    // Growing would have destroyed; shrinking destroys nothing, so closing the
    // gap unasked would be tidying (content §4).
    expect(recognize(grid, 18, 1)?.bounds).toEqual({ x: 18, y: 0, w: 7, h: 3 });
  });
});

describe('the menu is reachable from the keyboard too (B-UI-11a)', () => {
  /** A 2×2 table, and the selection a keyboard sweep of it produces. */
  function swept(): { grid: Grid; sel: Candidate } {
    const grid = boxed();
    build(grid, ['col', 'row']);

    // Every keyboard route to a whole table — a Shift+arrow sweep, object
    // select, the Ctrl+Enter structure rung — answers `cells`, because the
    // trace is one component with dividers in it and no rectangle matcher
    // will claim that. Only a click ever lands on a `box`.
    const sel = selectWithin(grid, { x: 0, y: 0, w: 15, h: 7 });
    if (sel === null) throw new Error('nothing swept');
    expect(sel.kind).toBe('cells');
    return { grid, sel };
  }

  it('offers itself over a swept table, not only a clicked one', () => {
    expect(canDivide(swept().sel)).toBe(true);
  });

  it('and adding a column from one grows the whole table', () => {
    const { grid, sel } = swept();
    const plan = planAddColumn(grid, sel, { charset: UNICODE });

    expect(plan.refused).toBeUndefined();
    applyDiff(grid, plan.diff);
    expect(toText(grid).split('\n')[0]).toBe('┌──────┬──────┬──────┐');
  });

  it('and adding a row deepens it', () => {
    const { grid, sel } = swept();
    const plan = planAddRow(grid, sel, { charset: UNICODE });

    expect(plan.refused).toBeUndefined();
    applyDiff(grid, plan.diff);
    expect(toText(grid).split('\n')).toHaveLength(10);
  });

  it('but a circle still has no lattice to extend', () => {
    const grid = createGrid();
    applyDiff(grid, stampEllipse(grid, { x: 0, y: 0, w: 9, h: 7 }, UNICODE));

    const circle = recognize(grid, 4, 0);
    expect(circle?.kind).toBe('ellipse');
    expect(canDivide(circle)).toBe(false);
  });
});

describe('a new row pushes what is under it out of the way (B-TBL-05)', () => {
  /** A box, a connector hanging from its bottom wall, and a box below that. */
  function stacked(): Grid {
    const grid = createGrid();
    for (const [y, row] of [
      [0, '┌────────────────────┐'],
      [1, '│                    │'],
      [2, '│                    │'],
      [3, '└─────────┬──────────┘'],
      [4, '          │'],
      [5, '          │'],
      [6, '          │'],
      [7, '     ┌────┴─────┐'],
      [8, '     │          │'],
      [9, '     └──────────┘'],
    ] as const) {
      write(grid, 0, y, row);
    }
    return grid;
  }

  it('moves everything below down instead of growing over it', () => {
    const grid = stacked();
    const plan = planAddRow(grid, clicked(grid, 0, 0), { charset: UNICODE });
    expect(plan.refused).toBeUndefined();
    applyDiff(grid, plan.diff);

    expect(toText(grid).split('\n')).toEqual([
      '┌────────────────────┐',
      '│                    │',
      '│                    │',
      '├─────────┬──────────┤',
      '│                    │',
      '│                    │',
      '└─────────┬──────────┘',
      '          │',
      '          │',
      '          │',
      '     ┌────┴─────┐',
      '     │          │',
      '     └──────────┘',
    ]);
  });

  it('and the connector keeps its length rather than being re-routed', () => {
    const grid = stacked();
    const before = toText(grid).split('\n').slice(4).join('\n');
    applyDiff(grid, planAddRow(grid, clicked(grid, 0, 0), { charset: UNICODE }).diff);

    // Everything under the wall came down as one, so what was below is
    // unchanged in itself — it is only somewhere else.
    expect(toText(grid).split('\n').slice(7).join('\n')).toBe(before);
  });

  it('says how far the push reached', () => {
    const grid = stacked();
    const plan = planAddRow(grid, clicked(grid, 0, 0), { charset: UNICODE });

    // No silent reflow (tables §13).
    expect(plan.note).toContain('pushed down');
  });

  it('with nothing below, nothing is pushed and nothing is said', () => {
    const grid = boxed(9, 5);
    const plan = planAddRow(grid, clicked(grid, 0, 0), { charset: UNICODE });

    expect(plan.note).not.toContain('pushed');
    applyDiff(grid, plan.diff);
    expect(toText(grid).split('\n')).toHaveLength(9);
  });

  it('a new column pushes nothing down, having nowhere to push to', () => {
    const grid = stacked();
    applyDiff(grid, planAddColumn(grid, clicked(grid, 0, 0), { charset: UNICODE }).diff);

    // Widening reaches sideways, so nothing under the box is in its way. It may
    // still re-route a connector onto the wall that moved (B-MAN-12) — what it
    // must not do is shift the page down.
    expect(toText(grid).split('\n')).toHaveLength(10);
  });
});
