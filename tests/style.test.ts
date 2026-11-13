/**
 * A shape keeps its character set (B-CS-07).
 *
 * The active charset decides what newly drawn cells look like (B-CS-02) and
 * nothing else. Everything here redraws a shape that already exists — moves it,
 * widens it, grows it a column, mends its wall, follows it with an arrow — and
 * the claim is the same each time: it comes back in the set it was drawn in,
 * however the toolbar is set.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { ASCII, DOUBLE, HEAVY, ROUNDED, UNICODE, type Charset } from '../src/core/charset/charsets.ts';
import { ck, type Rect } from '../src/core/geom/cell.ts';
import { applyDiff, createGrid, type Grid } from '../src/core/grid/grid.ts';
import { fromText, toText } from '../src/core/io/text.ts';
import { borderKeys, stampBox } from '../src/core/stamp/box.ts';
import { stampPath } from '../src/core/stamp/path.ts';
import { eraseWithHeal } from '../src/core/stamp/erase.ts';
import { styleOf } from '../src/core/derive/style.ts';
import { type Candidate } from '../src/core/recognize/recognize.ts';
import { candidatesAt, defaultIndex } from '../src/core/recognize/rank.ts';
import { planMove } from '../src/core/ops/move.ts';
import { planResize } from '../src/core/ops/resize.ts';
import { planAddColumn, planResizeTrack } from '../src/core/ops/lattice.ts';
import { isGroup, menuFor, useEditor } from '../src/app/state/store.ts';

const SMALL: Rect = { x: 0, y: 0, w: 7, h: 3 };

function boxIn(cs: Charset, r: Rect = SMALL): Grid {
  const grid = createGrid();
  applyDiff(grid, stampBox(grid, r, cs));
  return grid;
}

function gridFrom(art: string): Grid {
  const grid = createGrid();
  applyDiff(grid, fromText(art));
  return grid;
}

/** What a click selects: the most specific reading, as the app itself takes it. */
function clicked(grid: Grid, x: number, y: number): Candidate {
  const list = candidatesAt(grid, x, y);
  const picked = list[defaultIndex(list)];
  if (picked === undefined) throw new Error('nothing at the seed');
  return picked;
}

describe('reading the set a shape is drawn in', () => {
  it('names each pack from a box drawn in it', () => {
    for (const cs of [UNICODE, ROUNDED, HEAVY, DOUBLE, ASCII]) {
      const grid = boxIn(cs);
      // Asked with every other pack preferred, so the answer is the glyphs' own.
      expect(styleOf(grid, borderKeys(SMALL), cs === UNICODE ? HEAVY : UNICODE).id).toBe(cs.id);
    }
  });

  it('lets the preferred set decide where the glyphs cannot', () => {
    // A straight run is the same characters in Unicode and Rounded.
    const grid = gridFrom('──────');
    expect(styleOf(grid, grid.keys(), ROUNDED).id).toBe('rounded');
    expect(styleOf(grid, grid.keys(), UNICODE).id).toBe('unicode');
  });

  it('is outvoted by the shape, not by one junction in another set', () => {
    const grid = boxIn(UNICODE);
    grid.set(ck(0, 1), '┣'); // a heavy wire once joined here
    expect(styleOf(grid, borderKeys(SMALL), HEAVY).id).toBe('unicode');
  });
});

describe('a box moved under another charset', () => {
  it('is redrawn in its own: rounded stays rounded', () => {
    const grid = boxIn(ROUNDED);
    applyDiff(grid, planMove(grid, clicked(grid, 0, 0), 3, 1, { charset: UNICODE }).diff);

    expect(grid.has(ck(0, 0))).toBe(false);
    expect(toText(grid)).toBe(['╭─────╮', '│     │', '╰─────╯'].join('\n'));
  });

  it('and heavy stays heavy, even with ASCII active', () => {
    const grid = boxIn(HEAVY);
    applyDiff(grid, planMove(grid, clicked(grid, 0, 0), 2, 0, { charset: ASCII }).diff);

    expect(toText(grid)).toBe(['┏━━━━━┓', '┃     ┃', '┗━━━━━┛'].join('\n'));
  });

  it('leaves the wall it shared with a neighbour mended in the neighbour’s set', () => {
    const grid = boxIn(HEAVY);
    applyDiff(grid, stampBox(grid, { x: 6, y: 0, w: 7, h: 3 }, HEAVY)); // flush, sharing x=6
    expect(toText(grid)).toBe(['┏━━━━━┳━━━━━┓', '┃     ┃     ┃', '┗━━━━━┻━━━━━┛'].join('\n'));

    applyDiff(grid, planMove(grid, clicked(grid, 12, 0), 3, 0, { charset: UNICODE }).diff);

    // The `┳` and `┻` that held both boxes are the left box's corners now, and
    // heavy ones; the right box is redrawn heavy where it landed.
    expect(toText(grid)).toBe(
      ['┏━━━━━┓  ┏━━━━━┓', '┃     ┃  ┃     ┃', '┗━━━━━┛  ┗━━━━━┛'].join('\n'),
    );
  });
});

describe('a box grown under another charset', () => {
  it('a resize draws the wider border in the box’s set', () => {
    const grid = boxIn(HEAVY);
    const plan = planResize(grid, clicked(grid, 0, 0), { x: 0, y: 0, w: 10, h: 3 }, { charset: UNICODE });
    applyDiff(grid, plan.diff);

    expect(toText(grid)).toBe(['┏━━━━━━━━┓', '┃        ┃', '┗━━━━━━━━┛'].join('\n'));
  });

  it('a new column is divided in the box’s set', () => {
    const grid = boxIn(DOUBLE);
    applyDiff(grid, planAddColumn(grid, clicked(grid, 0, 0), { charset: UNICODE }).diff);

    expect(toText(grid)).toBe(['╔═════╦═════╗', '║     ║     ║', '╚═════╩═════╝'].join('\n'));
  });

  it('a track widened — as typing past the end does — fills the gap in the box’s set', () => {
    const grid = boxIn(HEAVY);
    applyDiff(grid, planResizeTrack(grid, SMALL, 'column', 6, 2, { charset: UNICODE }).diff);

    expect(toText(grid)).toBe(['┏━━━━━━━┓', '┃       ┃', '┗━━━━━━━┛'].join('\n'));
  });
});

describe('what is drawn around a shape keeps its own set too', () => {
  it('a heavy arrow follows a thin box as a heavy arrow', () => {
    const grid = createGrid();
    applyDiff(grid, stampBox(grid, { x: 0, y: 0, w: 7, h: 3 }, UNICODE));
    applyDiff(grid, stampBox(grid, { x: 13, y: 0, w: 7, h: 3 }, UNICODE));
    applyDiff(grid, stampPath(grid, { x: 7, y: 1 }, { x: 13, y: 1 }, HEAVY, { headEnd: true }));
    expect(toText(grid).split('\n')[1]).toBe('│     │━━━━━▶│     │');

    applyDiff(grid, planMove(grid, clicked(grid, 13, 0), 0, 4, { charset: UNICODE }).diff);

    // The same route sticky §1.1 draws, in the stroke the arrow had.
    expect(toText(grid)).toBe(
      [
        '┌─────┐',
        '│     ┣━━┓',
        '└─────┘  ┃',
        '         ┃',
        '         ┃   ┌─────┐',
        '         ┗━━▶│     │',
        '             └─────┘',
      ].join('\n'),
    );
  });

  it('a wall mends in its own set when a wire in another is lifted', () => {
    const grid = boxIn(HEAVY, { x: 5, y: 0, w: 7, h: 3 });
    applyDiff(grid, stampPath(grid, { x: 0, y: 1 }, { x: 5, y: 1 }, UNICODE));
    expect(toText(grid).split('\n')[1]).toBe('─────┤     ┃'); // a thin junction in a heavy wall

    const wire = [0, 1, 2, 3, 4].map((x) => ck(x, 1));
    applyDiff(grid, eraseWithHeal(grid, wire, UNICODE));

    expect(toText(grid)).toBe(['┏━━━━━┓', '┃     ┃', '┗━━━━━┛'].join('\n'));
  });
});

describe('Style in the actions menu (B-UI-16)', () => {
  beforeEach(() => {
    useEditor.getState().clearAll();
    useEditor.getState().setTool('select');
    useEditor.getState().setSelection(null);
    useEditor.setState({ charsetId: 'unicode', menuOpen: false, menuPath: [0] });
  });

  it('is offered for a box, after its lattice, with every pack and a preview each', () => {
    useEditor.getState().loadText(['┌─────┐', '│     │', '└─────┘'].join('\n'), 'box.txt');
    useEditor.getState().selectAt({ x: 0, y: 0 });

    const items = menuFor(useEditor.getState());
    expect(items.map((i) => i.label)).toEqual(['Add column', 'Add row', 'Style']);

    const style = items[2];
    if (style === undefined || !isGroup(style)) throw new Error('Style is not a group');
    expect(style.items.map((i) => i.label)).toEqual(['Unicode', 'Rounded', 'Heavy', 'Double', 'ASCII']);

    const heavy = style.items[2];
    if (heavy === undefined || isGroup(heavy)) throw new Error('Heavy is not an item');
    const shown = heavy.preview?.(useEditor.getState());
    expect(shown?.get(ck(0, 0))).toBe('┏');
  });

  it('and still first for a line, as it was', () => {
    useEditor.getState().loadText('───────', 'line.txt');
    useEditor.getState().selectAt({ x: 3, y: 0 });

    expect(menuFor(useEditor.getState()).map((i) => i.label)).toEqual(['Style', 'Line end']);
  });

  it('restyles a table’s dividers along with its walls', () => {
    useEditor.getState().loadText(['┌───┬───┐', '│   │   │', '└───┴───┘'].join('\n'), 'table.txt');
    const ed = useEditor.getState();
    ed.setCursor({ x: 0, y: 0 });
    ed.cycleShape(); // the first cell
    ed.cycleShape(); // the whole table
    expect(useEditor.getState().selection?.bounds.w).toBe(9);

    ed.restyleSelection('heavy');

    expect(useEditor.getState().text()).toBe(['┏━━━┳━━━┓', '┃   ┃   ┃', '┗━━━┻━━━┛'].join('\n'));
  });
});
