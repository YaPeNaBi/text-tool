import { beforeEach, describe, expect, it } from 'vitest';
import { ASCII, UNICODE } from '../src/core/charset/charsets.ts';
import { ck } from '../src/core/geom/cell.ts';
import { applyDiff, createGrid, type Grid } from '../src/core/grid/grid.ts';
import { fromText, toText } from '../src/core/io/text.ts';
import { stampBox } from '../src/core/stamp/box.ts';
import { pathCells, stampPath } from '../src/core/stamp/path.ts';
import { brushKeys, eraseWithHeal } from '../src/core/stamp/erase.ts';
import { eraseChar, pasteDiff, typeChar } from '../src/core/stamp/text.ts';
import { handleAt, handlesOf, resizeBoxDiff, resizeRect } from '../src/core/transform/resize.ts';
import { convertCharset } from '../src/core/transform/convert.ts';
import { History } from '../src/core/history/history.ts';
import { pasteDocument, useEditor } from '../src/app/state/store.ts';
import { installPlatform } from '../src/platform/index.ts';

function gridFrom(art: string): Grid {
  const grid = createGrid();
  applyDiff(grid, fromText(art));
  return grid;
}

describe('pathCells', () => {
  it('walks a straight run', () => {
    expect(pathCells({ x: 0, y: 0 }, { x: 3, y: 0 })).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ]);
  });

  it('turns once, following the longer axis first', () => {
    const cells = pathCells({ x: 0, y: 0 }, { x: 4, y: 2 });
    expect(cells[0]).toEqual({ x: 0, y: 0 });
    expect(cells.at(-1)).toEqual({ x: 4, y: 2 });
    // horizontal first, so the corner sits at the destination column
    expect(cells).toContainEqual({ x: 4, y: 0 });
  });

  it('takes the other elbow when asked', () => {
    const cells = pathCells({ x: 0, y: 0 }, { x: 4, y: 2 }, 'v-first');
    expect(cells).toContainEqual({ x: 0, y: 2 });
  });
});

describe('stampPath', () => {
  it('draws a horizontal line', () => {
    const grid = createGrid();
    applyDiff(grid, stampPath(grid, { x: 0, y: 0 }, { x: 4, y: 0 }, UNICODE));
    expect(toText(grid)).toBe('─────');
  });

  it('draws an elbow with a proper corner glyph (B-DRAW-10)', () => {
    const grid = createGrid();
    applyDiff(grid, stampPath(grid, { x: 0, y: 0 }, { x: 2, y: 2 }, UNICODE, {
      elbow: 'h-first',
    }));
    expect(toText(grid)).toBe(['──┐', '  │', '  │'].join('\n'));
  });

  it('puts an arrowhead on the far end', () => {
    const grid = createGrid();
    applyDiff(grid, stampPath(grid, { x: 0, y: 0 }, { x: 3, y: 0 }, UNICODE, {
      headEnd: true,
    }));
    expect(toText(grid)).toBe('───▶');
  });

  it('uses the charset ASCII arrowhead', () => {
    const grid = createGrid();
    applyDiff(grid, stampPath(grid, { x: 0, y: 0 }, { x: 0, y: 2 }, ASCII, {
      headEnd: true,
    }));
    expect(toText(grid)).toBe(['|', '|', 'v'].join('\n'));
  });

  it('merges into a line it crosses instead of overwriting it (B-DRAW-07)', () => {
    const grid = gridFrom('─────');
    applyDiff(grid, stampPath(grid, { x: 2, y: -0 }, { x: 2, y: 2 }, UNICODE));
    expect(grid.get(ck(2, 0))).toBe('┬');
  });

  it('stops an arrow short of a box rather than punching through it', () => {
    const grid = createGrid();
    applyDiff(grid, stampBox(grid, { x: 5, y: 0, w: 4, h: 3 }, UNICODE));
    applyDiff(grid, stampPath(grid, { x: 0, y: 1 }, { x: 5, y: 1 }, UNICODE, {
      headEnd: true,
    }));

    expect(grid.get(ck(5, 1))).toBe('│'); // the border survived
    expect(grid.get(ck(4, 1))).toBe('▶');
  });

  it('refuses a zero-length path', () => {
    const grid = createGrid();
    expect(stampPath(grid, { x: 1, y: 1 }, { x: 1, y: 1 }, UNICODE).size).toBe(0);
  });
});

describe('eraser', () => {
  it('covers a square footprint clamped to the quadrant', () => {
    expect(brushKeys({ x: 5, y: 5 }, 1)).toEqual([ck(5, 5)]);
    expect(brushKeys({ x: 5, y: 5 }, 3).length).toBe(9);
    expect(brushKeys({ x: 0, y: 0 }, 3).length).toBe(4); // negatives dropped
  });

  it('mends the glyphs it leaves behind (B-DRAW-12)', () => {
    // A T-junction; erasing the stem should leave a plain horizontal line.
    const grid = gridFrom(['──┬──', '  │  '].join('\n'));
    applyDiff(grid, eraseWithHeal(grid, [ck(2, 1)], UNICODE));

    expect(toText(grid)).toBe('─────');
  });

  it('leaves a stub alone rather than erasing more than asked', () => {
    const grid = gridFrom('─');
    applyDiff(grid, eraseWithHeal(grid, [ck(5, 5)], UNICODE));
    expect(grid.get(ck(0, 0))).toBe('─');
  });

  it('turns a box corner into a line end when the arm goes', () => {
    const grid = gridFrom(['┌──', '│  '].join('\n'));
    applyDiff(grid, eraseWithHeal(grid, [ck(0, 1)], UNICODE));

    expect(grid.get(ck(0, 0))).toBe('─');
  });

  it('erasing text mends nothing', () => {
    const grid = gridFrom('ab─');
    applyDiff(grid, eraseWithHeal(grid, [ck(1, 0)], UNICODE));

    expect(grid.get(ck(2, 0))).toBe('─');
    expect(grid.has(ck(1, 0))).toBe(false);
  });
});

describe('typing', () => {
  it('overwrites what is under the caret', () => {
    const grid = gridFrom('abc');
    applyDiff(grid, typeChar(grid, 1, 0, 'X', false));
    expect(toText(grid)).toBe('aXc');
  });

  it('pushes the rest of the word right in insert mode', () => {
    const grid = gridFrom('abc');
    applyDiff(grid, typeChar(grid, 1, 0, 'X', true));
    expect(toText(grid)).toBe('aXbc');
  });

  it('insert mode stops at the first blank, so a border stays put', () => {
    const grid = gridFrom('│ ab   │');
    applyDiff(grid, typeChar(grid, 2, 0, 'X', true));
    expect(toText(grid)).toBe('│ Xab  │');
  });

  it('backspace in insert mode pulls the word left', () => {
    const grid = gridFrom('abc');
    applyDiff(grid, eraseChar(grid, 0, 0, true));
    expect(toText(grid)).toBe('bc');
  });

  it('backspace in overwrite mode just clears the cell', () => {
    const grid = gridFrom('abc');
    applyDiff(grid, eraseChar(grid, 1, 0, false));
    expect(grid.has(ck(1, 0))).toBe(false);
    expect(grid.get(ck(2, 0))).toBe('c');
  });
});

describe('paste import (B-TXT-04)', () => {
  it('lands one character per cell and expands tabs', () => {
    const diff = pasteDiff('a\tb', 0, 0);
    expect(diff.get(ck(0, 0))).toBe('a');
    expect(diff.get(ck(5, 0))).toBe('b');
  });

  it('is offset by the paste origin and never stores blanks', () => {
    const diff = pasteDiff('a b', 10, 3);
    expect(diff.get(ck(10, 3))).toBe('a');
    expect(diff.has(ck(11, 3))).toBe(false);
    expect(diff.get(ck(12, 3))).toBe('b');
  });

  it('round-trips a diagram through text', () => {
    const art = ['┌──┐', '│ab│', '└──┘'].join('\n');
    const grid = createGrid();
    applyDiff(grid, pasteDiff(art, 0, 0));
    expect(toText(grid)).toBe(art);
  });
});

describe('resize (B-MAN-09)', () => {
  it('offers eight grab points on a roomy box', () => {
    expect(handlesOf({ x: 0, y: 0, w: 5, h: 5 }).length).toBe(8);
  });

  it('gives the smallest box none, so it can still be dragged', () => {
    // Every cell of a 2×2 border is a corner. Handles there would make the box
    // resizable from everywhere and movable from nowhere.
    expect(handlesOf({ x: 0, y: 0, w: 2, h: 2 }).length).toBe(0);
  });

  it('drops an edge midpoint when the edge is too short to spare one', () => {
    const handles = handlesOf({ x: 0, y: 0, w: 7, h: 3 });
    expect(handles.some((h) => h.id === 'w' || h.id === 'e')).toBe(false);
    expect(handles.length).toBe(6);
  });

  it('finds the handle under a cell', () => {
    const r = { x: 0, y: 0, w: 5, h: 3 };
    expect(handleAt(r, 0, 0)).toBe('nw');
    expect(handleAt(r, 4, 2)).toBe('se');
    expect(handleAt(r, 1, 1)).toBeNull();
  });

  it('moves only the edges the handle owns', () => {
    const r = { x: 2, y: 2, w: 6, h: 4 };
    expect(resizeRect(r, 'e', 3, 9)).toEqual({ x: 2, y: 2, w: 9, h: 4 });
    expect(resizeRect(r, 'nw', -1, -1)).toEqual({ x: 1, y: 1, w: 7, h: 5 });
  });

  it('never shrinks below the minimum or crosses the origin', () => {
    const r = { x: 0, y: 0, w: 4, h: 4 };
    expect(resizeRect(r, 'e', -99)).toEqual({ x: 0, y: 0, w: 2, h: 4 });
    expect(resizeRect(r, 'nw', -99, -99)).toEqual({ x: 0, y: 0, w: 4, h: 4 });
  });

  it('redraws the border rather than scaling it', () => {
    const grid = createGrid();
    applyDiff(grid, stampBox(grid, { x: 0, y: 0, w: 4, h: 3 }, UNICODE));
    applyDiff(
      grid,
      resizeBoxDiff(grid, { x: 0, y: 0, w: 4, h: 3 }, { x: 0, y: 0, w: 6, h: 4 }, UNICODE),
    );

    expect(toText(grid)).toBe(['┌────┐', '│    │', '│    │', '└────┘'].join('\n'));
  });

  it('leaves no orphan cells from the old outline', () => {
    const grid = createGrid();
    applyDiff(grid, stampBox(grid, { x: 0, y: 0, w: 8, h: 5 }, UNICODE));
    applyDiff(
      grid,
      resizeBoxDiff(grid, { x: 0, y: 0, w: 8, h: 5 }, { x: 0, y: 0, w: 4, h: 3 }, UNICODE),
    );

    expect(toText(grid)).toBe(['┌──┐', '│  │', '└──┘'].join('\n'));
  });
});

describe('charset conversion with arrows', () => {
  it('converts arrowheads along with the lines (B-CS-04)', () => {
    const grid = gridFrom('───▶');
    applyDiff(grid, convertCharset(grid, ASCII));
    expect(toText(grid)).toBe('--->');

    applyDiff(grid, convertCharset(grid, UNICODE));
    expect(toText(grid)).toBe('───▶');
  });

  it('leaves a v that is only a letter alone (B-CS-05)', () => {
    const grid = gridFrom('level');
    applyDiff(grid, convertCharset(grid, ASCII));
    expect(toText(grid)).toBe('level');
  });
});

describe('history coalescing (B-HIST-02)', () => {
  it('folds one typing run into a single undo step', () => {
    const grid = createGrid();
    const history = new History();

    for (const [i, ch] of [...'hello'].entries()) {
      history.record(applyDiff(grid, typeChar(grid, i, 0, ch, false)), 'type:1');
    }
    expect(toText(grid)).toBe('hello');

    history.undo(grid);
    expect(toText(grid)).toBe('');
    expect(history.canUndo).toBe(false);
  });

  it('a different run id starts a new step', () => {
    const grid = createGrid();
    const history = new History();

    history.record(applyDiff(grid, typeChar(grid, 0, 0, 'a', false)), 'type:1');
    history.record(applyDiff(grid, typeChar(grid, 1, 0, 'b', false)), 'type:2');

    history.undo(grid);
    expect(toText(grid)).toBe('a');
  });

  it('an unkeyed mutation is always its own step', () => {
    const grid = createGrid();
    const history = new History();

    history.record(applyDiff(grid, typeChar(grid, 0, 0, 'a', false)));
    history.record(applyDiff(grid, typeChar(grid, 1, 0, 'b', false)));

    history.undo(grid);
    expect(toText(grid)).toBe('a');
  });
});

/**
 * Where a paste lands (B-TXT-04).
 *
 * The rule is one line — the keyboard's cell — but it replaced a three-step
 * fallback that preferred the *pointer*, so what is worth pinning is the case
 * that changed: a mouse resting somewhere else must not win.
 */
describe('paste anchoring (B-TXT-04)', () => {
  /** A platform whose only job is to hold a clipboard. */
  const withClipboard = (text: string): void => {
    installPlatform({
      id: 'terminal',
      limitation: null,
      canSaveInPlace: () => false,
      openFile: () => Promise.resolve(null),
      saveFile: () => Promise.resolve(null),
      saveFileAs: () => Promise.resolve(null),
      readClipboard: () => Promise.resolve(text),
      writeClipboard: () => Promise.resolve(),
      recentFiles: () => Promise.resolve([]),
      onMenuCommand: () => undefined,
    });
  };

  beforeEach(() => {
    useEditor.getState().clearAll();
    useEditor.getState().setTool('select');
    useEditor.getState().setHover(null);
    useEditor.getState().setCursor({ x: 0, y: 0 });
  });

  it('lands at the keyboard cursor', async () => {
    withClipboard('ab');
    useEditor.getState().setCursor({ x: 4, y: 2 });

    await pasteDocument();

    expect(useEditor.getState().grid.get(ck(4, 2))).toBe('a');
    expect(useEditor.getState().grid.get(ck(5, 2))).toBe('b');
  });

  it('ignores where the mouse happens to be resting', async () => {
    // The whole point of the change. The hover is *only* set by the pointer
    // moving; a click sets the cursor as well, so point-and-paste still works —
    // what no longer counts is hovering without clicking.
    withClipboard('ab');
    useEditor.getState().setCursor({ x: 4, y: 2 });
    useEditor.getState().setHover({ x: 30, y: 9 });

    await pasteDocument();

    expect(useEditor.getState().grid.get(ck(4, 2))).toBe('a');
    expect(useEditor.getState().grid.has(ck(30, 9))).toBe(false);
  });

  it('lands at the caret while writing, the caret being the cursor (B-UI-10)', async () => {
    withClipboard('ab');
    useEditor.getState().setTool('text');
    useEditor.getState().setCaret({ x: 7, y: 3 });
    useEditor.getState().setHover({ x: 30, y: 9 });

    await pasteDocument();

    expect(useEditor.getState().grid.get(ck(7, 3))).toBe('a');
  });

  it('selects what landed, wherever it landed', async () => {
    withClipboard('ab');
    useEditor.getState().setCursor({ x: 4, y: 2 });

    await pasteDocument();

    expect(useEditor.getState().selection?.bounds).toEqual({ x: 4, y: 2, w: 2, h: 1 });
  });
});
