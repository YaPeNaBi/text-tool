/**
 * Freehand strokes, and the ends a line can wear.
 */

import { describe, expect, it } from 'vitest';
import { ASCII, UNICODE } from '../src/core/charset/charsets.ts';
import { applyDiff, createGrid, maskOf, type Grid } from '../src/core/grid/grid.ts';
import { toText } from '../src/core/io/text.ts';
import { stampBox } from '../src/core/stamp/box.ts';
import { stampPath } from '../src/core/stamp/path.ts';
import { stampStroke, strokeCells } from '../src/core/stamp/freehand.ts';
import { endsOf, planLineEnd } from '../src/core/ops/lineend.ts';
import { recognize, type Candidate } from '../src/core/recognize/recognize.ts';

const at = (x: number, y: number): { x: number; y: number } => ({ x, y });

describe('a stroke is the cells the pointer was in (B-DRAW-16)', () => {
  it('fills the gap between two samples, so a fast drag is still a line', () => {
    // Two samples five apart: without filling in, that is dots.
    expect(strokeCells([at(0, 0), at(5, 0)]).map((c) => c.x)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('walks a diagonal directly, one cell per step', () => {
    const walk = strokeCells([at(0, 0), at(2, 2)]);

    expect(walk).toEqual([at(0, 0), at(1, 1), at(2, 2)]);
  });

  it('spends the diagonal first and finishes straight on the longer axis', () => {
    const walk = strokeCells([at(0, 0), at(4, 2)]);

    expect(walk).toEqual([at(0, 0), at(1, 1), at(2, 2), at(3, 2), at(4, 2)]);
  });

  it('standing still is not a step', () => {
    expect(strokeCells([at(3, 3), at(3, 3), at(3, 3)])).toEqual([at(3, 3)]);
  });

  it('draws a dragged L as line glyphs with a corner', () => {
    const grid = createGrid();
    applyDiff(grid, stampStroke(grid, [at(0, 0), at(4, 0), at(4, 2)], UNICODE));

    expect(toText(grid).split('\n')).toEqual(['────┐', '    │', '    │']);
  });

  it('a stroke that crosses itself gets a junction, not two glyphs fighting', () => {
    const grid = createGrid();
    applyDiff(grid, stampStroke(grid, [at(2, 0), at(2, 4)], UNICODE));
    applyDiff(grid, stampStroke(grid, [at(0, 2), at(4, 2)], UNICODE));

    expect(toText(grid).split('\n')[2]).toBe('──┼──');
  });

  it('and a stroke drawn into a box joins it', () => {
    const grid = createGrid();
    applyDiff(grid, stampBox(grid, { x: 0, y: 0, w: 5, h: 3 }, UNICODE));
    applyDiff(grid, stampStroke(grid, [at(2, 2), at(2, 5)], UNICODE));

    // The wall gained a southward arm where the stroke met it.
    expect(toText(grid).split('\n')[2]).toBe('└─┬─┘');
  });

  it('a stroke of one cell is a click, and draws nothing', () => {
    const grid = createGrid();
    expect(stampStroke(grid, [at(1, 1)], UNICODE).size).toBe(0);
  });

  it('draws a down-right diagonal as backslashes', () => {
    const grid = createGrid();
    applyDiff(grid, stampStroke(grid, [at(0, 0), at(3, 3)], UNICODE));

    expect(toText(grid).split('\n')).toEqual(['\\', ' \\', '  \\', '   \\']);
  });

  it('draws an up-right diagonal as forward slashes', () => {
    const grid = createGrid();
    applyDiff(grid, stampStroke(grid, [at(0, 3), at(3, 0)], UNICODE));

    expect(toText(grid).split('\n')).toEqual(['   /', '  /', ' /', '/']);
  });

  it('a diagonal is plain text: it does not merge with a box it is drawn across', () => {
    const grid = createGrid();
    applyDiff(grid, stampBox(grid, { x: 0, y: 0, w: 5, h: 5 }, UNICODE));
    applyDiff(grid, stampStroke(grid, [at(1, 1), at(3, 3)], UNICODE));

    expect(toText(grid).split('\n')).toEqual([
      '┌───┐',
      '│\\  │',
      '│ \\ │',
      '│  \\│',
      '└───┘',
    ]);
  });

  it('a line turning down into a diagonal bends instead of jumping', () => {
    const grid = createGrid();
    applyDiff(grid, stampStroke(grid, [at(0, 0), at(2, 0), at(4, 2)], UNICODE));

    expect(toText(grid).split('\n')).toEqual(['──╮', '   \\', '    \\']);
  });

  it('and turning up bends the other way, even off a corner', () => {
    const grid = createGrid();
    applyDiff(grid, stampStroke(grid, [at(0, 3), at(0, 2), at(1, 2), at(3, 0)], UNICODE));

    expect(toText(grid).split('\n')).toEqual(['   /', '  /', '┌╯', '│']);
  });

  it('a diagonal landing on a line bends into it', () => {
    const grid = createGrid();
    applyDiff(grid, stampStroke(grid, [at(0, 0), at(2, 2), at(4, 2)], UNICODE));

    expect(toText(grid).split('\n')).toEqual(['\\', ' \\', '  ╰──']);
  });

  it('a vertical run meets a diagonal without a bend: the slash is the smaller jump', () => {
    const grid = createGrid();
    applyDiff(grid, stampStroke(grid, [at(0, 0), at(0, 2), at(2, 4)], UNICODE));

    expect(toText(grid).split('\n')).toEqual(['│', '│', '\\', ' \\', '  \\']);
  });

  it('ASCII bends with the classic dot and tick', () => {
    const grid = createGrid();
    applyDiff(grid, stampStroke(grid, [at(0, 0), at(2, 0), at(4, 2), at(6, 2)], ASCII));

    expect(toText(grid).split('\n')).toEqual(['--.', '   \\', "    '--"]);
  });
});

describe('what sits at the end of a line (B-LINE-01, B-LINE-02)', () => {
  function wire(): { grid: Grid; sel: Candidate } {
    const grid = createGrid();
    applyDiff(grid, stampPath(grid, at(0, 0), at(6, 0), UNICODE, {}));
    const sel = recognize(grid, 3, 0);
    if (sel === null) throw new Error('no line');
    return { grid, sel };
  }

  it('finds both ends, in reading order', () => {
    const { grid, sel } = wire();
    const ends = endsOf(grid, sel.cells);

    expect(ends?.map((e) => e.at.x)).toEqual([0, 6]);
    expect(ends?.map((e) => e.wearing)).toEqual(['normal', 'normal']);
  });

  it('puts an arrow on the far end, pointing away from the line', () => {
    const { grid, sel } = wire();
    applyDiff(grid, planLineEnd(grid, sel, 1, 'arrow', UNICODE).diff);

    expect(toText(grid)).toBe('──────▶');
  });

  it('and a bar across it for exactly one', () => {
    const { grid, sel } = wire();
    applyDiff(grid, planLineEnd(grid, sel, 1, 'one', UNICODE).diff);

    expect(toText(grid)).toBe('──────╫');
  });

  it('the bar is weak: it joins the shaft rather than becoming one', () => {
    const { grid, sel } = wire();
    applyDiff(grid, planLineEnd(grid, sel, 1, 'one', UNICODE).diff);

    // It reaches back west along the run, and nowhere else — so the line is
    // still one line, and the tick is not a stray vertical stub.
    expect(maskOf(grid, 6, 0)).toBe(8); // W
    expect(recognize(grid, 3, 0)?.cells.size).toBe(7);
  });

  it('a tick standing alone in a page of text is not a line at all', () => {
    const grid = createGrid();
    grid.set('4,4', '╫');

    expect(maskOf(grid, 4, 4)).toBe(0);
  });

  it('taking one off puts the cell back to what its connectivity says', () => {
    const { grid, sel } = wire();
    applyDiff(grid, planLineEnd(grid, sel, 1, 'arrow', UNICODE).diff);

    const again = recognize(grid, 3, 0);
    if (again === null) throw new Error('lost the line');
    applyDiff(grid, planLineEnd(grid, again, 1, 'normal', UNICODE).diff);

    expect(toText(grid)).toBe('───────');
  });

  it('a ring has no ends to set', () => {
    const grid = createGrid();
    applyDiff(grid, stampBox(grid, { x: 0, y: 0, w: 5, h: 3 }, UNICODE));
    const box = recognize(grid, 0, 0);
    if (box === null) throw new Error('no box');

    expect(endsOf(grid, box.cells)).toBeNull();
    expect(planLineEnd(grid, box, 0, 'arrow', UNICODE).refused).toBeDefined();
  });
});
