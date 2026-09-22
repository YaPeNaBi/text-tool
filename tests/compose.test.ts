import { describe, expect, it } from 'vitest';
import { UNICODE } from '../src/core/charset/charsets.ts';
import { ck } from '../src/core/geom/cell.ts';
import { applyDiff, createGrid, type CellDiff, type Grid } from '../src/core/grid/grid.ts';
import { fromText, toText } from '../src/core/io/text.ts';
import { stampBox } from '../src/core/stamp/box.ts';
import { stampPath } from '../src/core/stamp/path.ts';
import { recognize } from '../src/core/recognize/recognize.ts';
import {
  childrenOf,
  componentsInside,
  containerAt,
  descendantsOf,
  enclosesArea,
} from '../src/core/derive/contain.ts';
import { alignmentOf, labelBoundsOf, labelOf } from '../src/core/derive/label.ts';
import { carriesContents, travellingWith } from '../src/core/derive/gather.ts';
import { candidatesAt } from '../src/core/recognize/rank.ts';
import { sharedCells } from '../src/core/derive/shared.ts';
import { planMove, subjectOf } from '../src/core/ops/move.ts';
import { merge, nothing, refuse } from '../src/core/ops/plan.ts';

function gridFrom(art: string): Grid {
  const grid = createGrid();
  applyDiff(grid, fromText(art));
  return grid;
}

function write(grid: Grid, x: number, y: number, s: string): void {
  const diff: CellDiff = new Map();
  [...s].forEach((c, i) => {
    if (c !== ' ') diff.set(ck(x + i, y), c);
  });
  applyDiff(grid, diff);
}

/** A container with a child and two labels — the running example of nesting.md. */
function nested(): Grid {
  const grid = createGrid();
  applyDiff(grid, stampBox(grid, { x: 0, y: 0, w: 19, h: 6 }, UNICODE));
  write(grid, 7, 4, 'outer');
  applyDiff(grid, stampBox(grid, { x: 3, y: 1, w: 11, h: 3 }, UNICODE));
  write(grid, 5, 2, 'inner');
  return grid;
}

const shapeAt = (grid: Grid, x: number, y: number) => recognize(grid, x, y);

function move(grid: Grid, x: number, y: number, dx: number, dy: number): void {
  const shape = shapeAt(grid, x, y);
  if (shape === null) throw new Error('nothing to move');
  applyDiff(grid, planMove(grid, shape, dx, dy, { charset: UNICODE }).diff);
}

describe('containment (nesting §1)', () => {
  it('finds a child strictly inside', () => {
    const kids = childrenOf(nested(), { x: 0, y: 0, w: 19, h: 6 });
    expect(kids.length).toBe(1);
    expect(kids[0]?.bounds).toEqual({ x: 3, y: 1, w: 11, h: 3 });
  });

  it('does not call a neighbour a child', () => {
    const grid = createGrid();
    applyDiff(grid, stampBox(grid, { x: 0, y: 0, w: 4, h: 3 }, UNICODE));
    applyDiff(grid, stampBox(grid, { x: 3, y: 0, w: 4, h: 3 }, UNICODE));

    expect(childrenOf(grid, { x: 0, y: 0, w: 4, h: 3 }).length).toBe(0);
  });

  it('sees text, lines and boxes alike', () => {
    const parts = componentsInside(nested(), { x: 0, y: 0, w: 19, h: 6 });
    expect(parts.map((p) => p.kind).sort()).toEqual(['box', 'text', 'text']);
  });

  it('leaves out anything crossing the border', () => {
    const grid = createGrid();
    applyDiff(grid, stampBox(grid, { x: 0, y: 0, w: 12, h: 5 }, UNICODE));
    applyDiff(grid, stampPath(grid, { x: 3, y: 2 }, { x: 20, y: 2 }, UNICODE));

    for (const part of componentsInside(grid, { x: 0, y: 0, w: 12, h: 5 })) {
      expect(part.bounds.x + part.bounds.w).toBeLessThan(12);
    }
  });

  it('walks nesting transitively', () => {
    const grid = createGrid();
    applyDiff(grid, stampBox(grid, { x: 0, y: 0, w: 25, h: 8 }, UNICODE));
    applyDiff(grid, stampBox(grid, { x: 2, y: 1, w: 21, h: 6 }, UNICODE));
    applyDiff(grid, stampBox(grid, { x: 5, y: 2, w: 13, h: 3 }, UNICODE));

    expect(childrenOf(grid, { x: 0, y: 0, w: 25, h: 8 }).length).toBe(1);
    expect(descendantsOf(grid, { x: 0, y: 0, w: 25, h: 8 }).length).toBe(2);
  });

  it('finds what a cell is inside, innermost first', () => {
    const grid = nested();
    expect(containerAt(grid, 5, 2)?.bounds).toEqual({ x: 3, y: 1, w: 11, h: 3 });
    expect(containerAt(grid, 7, 4)?.bounds).toEqual({ x: 0, y: 0, w: 19, h: 6 });
    expect(containerAt(grid, 40, 40)).toBeNull();
  });

  it('counts a lattice as enclosing even when it reads as a blob', () => {
    const grid = createGrid();
    applyDiff(grid, stampBox(grid, { x: 0, y: 0, w: 4, h: 3 }, UNICODE));
    applyDiff(grid, stampBox(grid, { x: 3, y: 0, w: 4, h: 3 }, UNICODE));

    const sel = shapeAt(grid, 0, 0);
    expect(sel?.kind).toBe('cells');
    expect(sel !== null && enclosesArea(sel)).toBe(true);
  });
});

describe('labels (content §1)', () => {
  it('takes the text inside and nothing else', () => {
    expect(labelOf(nested(), { x: 3, y: 1, w: 11, h: 3 }).size).toBe(5);
  });

  it('ignores line cells inside the bounds', () => {
    // The outer box contains the inner box's border, which is not its label.
    expect(labelOf(nested(), { x: 0, y: 0, w: 19, h: 6 }).size).toBe(10);
  });

  it('recovers how the label was aligned', () => {
    const shape = { x: 0, y: 0, w: 20, h: 3 };
    expect(alignmentOf(shape, { x: 1, y: 1, w: 5, h: 1 })).toBe('left');
    expect(alignmentOf(shape, { x: 14, y: 1, w: 5, h: 1 })).toBe('right');
    expect(alignmentOf(shape, { x: 7, y: 1, w: 5, h: 1 })).toBe('centre');
  });

  it('reports no bounds for an empty shape', () => {
    const grid = createGrid();
    applyDiff(grid, stampBox(grid, { x: 0, y: 0, w: 6, h: 3 }, UNICODE));
    expect(labelBoundsOf(grid, { x: 0, y: 0, w: 6, h: 3 })).toBeNull();
  });
});

describe('what travels (nesting §2, content §2)', () => {
  it('carries the label', () => {
    const grid = createGrid();
    applyDiff(grid, stampBox(grid, { x: 0, y: 0, w: 13, h: 3 }, UNICODE));
    write(grid, 2, 1, 'payments');

    move(grid, 0, 0, 6, 3);
    expect(toText(grid)).toBe(
      ['┌───────────┐', '│ payments  │', '└───────────┘'].join('\n'),
    );
  });

  it('carries a child and its label', () => {
    const grid = nested();
    const before = toText(grid);
    move(grid, 0, 0, 5, 2);
    expect(toText(grid)).toBe(before);
  });

  it('does not steal a note sitting beside the box', () => {
    const grid = createGrid();
    applyDiff(grid, stampBox(grid, { x: 0, y: 0, w: 11, h: 3 }, UNICODE));
    write(grid, 2, 1, 'core');
    write(grid, 13, 1, 'a loose note');

    move(grid, 0, 0, 0, 4);
    expect(grid.get(ck(13, 1))).toBe('a');
    expect(grid.get(ck(2, 5))).toBe('c');
  });

  it('a child does not drag its parent (nesting §3)', () => {
    const grid = nested();
    move(grid, 3, 1, 2, 0);

    expect(grid.get(ck(0, 0))).toBe('┌');
    expect(grid.get(ck(5, 1))).toBe('┌');
  });

  it('an open shape carries nothing', () => {
    const grid = gridFrom('──────');
    const shape = shapeAt(grid, 0, 0);
    expect(shape !== null && carriesContents(grid, shape)).toBe(false);
  });

  it('gathers the shape plus everything wholly inside it', () => {
    const grid = nested();
    const outer = shapeAt(grid, 0, 0);
    if (outer === null) throw new Error('no shape');

    const carried = travellingWith(grid, outer);
    expect(carried.size).toBeGreaterThan(outer.cells.size);
    expect(carried.has(ck(3, 1))).toBe(true); // the inner box's corner
    expect(carried.has(ck(5, 2))).toBe(true); // the letter 'i' of 'inner'
  });
});

describe('planMove', () => {
  it('is one diff, so one undo step', () => {
    const grid = nested();
    const shape = shapeAt(grid, 0, 0);
    if (shape === null) throw new Error('no shape');

    const inverse = applyDiff(grid, planMove(grid, shape, 3, 3, { charset: UNICODE }).diff);
    applyDiff(grid, inverse);
    expect(toText(grid)).toBe(toText(nested()));
  });

  it('slides along the origin rather than refusing (B-PLANE-04)', () => {
    const grid = nested();
    const shape = shapeAt(grid, 0, 0);
    if (shape === null) throw new Error('no shape');

    const plan = planMove(grid, shape, -5, -5, { charset: UNICODE });
    expect(plan.refused).toBeUndefined();
    expect(plan.diff.size).toBe(0);
  });

  it('gathers once, and the subject knows what it carries', () => {
    const grid = nested();
    const shape = shapeAt(grid, 0, 0);
    if (shape === null) throw new Error('no shape');

    const subject = subjectOf(grid, shape);
    expect(subject.carries).toBe(true);
    expect(subject.cells.size).toBeGreaterThan(shape.cells.size);
  });

  it('accepts a pre-gathered set instead of re-deriving', () => {
    const grid = nested();
    const shape = shapeAt(grid, 0, 0);
    if (shape === null) throw new Error('no shape');

    const a = planMove(grid, shape, 2, 2, { charset: UNICODE });
    const b = planMove(grid, shape, 2, 2, {
      charset: UNICODE,
      cells: subjectOf(grid, shape).cells,
    });
    expect(b.diff.size).toBe(a.diff.size);
  });

  it('moves the selection with it', () => {
    const grid = nested();
    const shape = shapeAt(grid, 0, 0);
    if (shape === null) throw new Error('no shape');

    const plan = planMove(grid, shape, 4, 1, { charset: UNICODE });
    expect(plan.selection?.bounds).toEqual({ x: 4, y: 1, w: 19, h: 6 });
  });
});

describe('Plan', () => {
  it('a refusal changes nothing', () => {
    const plan = refuse('nope');
    expect(plan.diff.size).toBe(0);
    expect(plan.refused).toBe('nope');
  });

  it('nothing is empty, and is not a refusal', () => {
    expect(nothing().diff.size).toBe(0);
    expect(nothing().refused).toBeUndefined();
  });

  it('merges later writes over earlier ones', () => {
    const a: CellDiff = new Map([
      [ck(0, 0), 'a'],
      [ck(1, 0), 'b'],
    ]);
    const b: CellDiff = new Map([[ck(0, 0), null]]);

    const out = merge(a, b);
    expect(out.get(ck(0, 0))).toBeNull();
    expect(out.get(ck(1, 0))).toBe('b');
  });
});

describe('neighbours, not wires (sticky §7.2)', () => {
  function boxes(spec: Array<[number, number, number, number]>): Grid {
    const grid = createGrid();
    for (const [x, y, w, h] of spec) {
      applyDiff(grid, stampBox(grid, { x, y, w, h }, UNICODE));
    }
    return grid;
  }

  /** Take the smallest reading at the seed, which is the individual box. */
  function dragSmallest(grid: Grid, x: number, y: number, dx: number, dy: number): void {
    const shape = candidatesAt(grid, x, y)[0];
    if (shape === undefined) throw new Error('no candidate');
    applyDiff(grid, planMove(grid, shape, dx, dy, { charset: UNICODE }).diff);
  }

  it('finds the cells two flush boxes share', () => {
    const grid = boxes([
      [0, 0, 5, 3],
      [4, 0, 5, 3],
    ]);
    const left = candidatesAt(grid, 0, 0)[0];
    if (left === undefined) throw new Error('no candidate');

    const shared = sharedCells(grid, left.cells);
    expect([...shared].sort()).toEqual([ck(4, 0), ck(4, 1), ck(4, 2)].sort());
  });

  it('finds nothing for a box standing on its own', () => {
    const grid = boxes([[0, 0, 5, 3]]);
    const only = candidatesAt(grid, 0, 0)[0];
    if (only === undefined) throw new Error('no candidate');

    expect(sharedCells(grid, only.cells).size).toBe(0);
  });

  it('leaves the neighbour whole when one is dragged away', () => {
    const grid = boxes([
      [0, 0, 5, 3],
      [4, 0, 5, 3],
    ]);
    dragSmallest(grid, 0, 0, 0, 4);

    expect(toText(grid)).toBe(
      ['    ┌───┐', '    │   │', '    └───┘', '', '┌───┐', '│   │', '└───┘'].join('\n'),
    );
  });

  it('works whichever of the two is moved', () => {
    const grid = boxes([
      [0, 0, 5, 3],
      [4, 0, 5, 3],
    ]);
    dragSmallest(grid, 8, 0, 6, 4);

    expect(grid.get(ck(4, 0))).toBe('┐'); // the box left behind is closed again
    expect(grid.get(ck(4, 2))).toBe('┘');
    expect(recognize(grid, 0, 0)?.kind).toBe('box');
  });

  it('detaches from two neighbours at once', () => {
    const grid = boxes([
      [0, 0, 5, 3],
      [4, 0, 5, 3],
      [8, 0, 5, 3],
    ]);
    dragSmallest(grid, 6, 0, 0, 5);

    // All three are complete boxes again.
    expect(recognize(grid, 0, 0)?.kind).toBe('box');
    expect(recognize(grid, 8, 0)?.kind).toBe('box');
    expect(recognize(grid, 4, 5)?.kind).toBe('box');
  });

  it('detaches vertically as well', () => {
    const grid = boxes([
      [0, 0, 7, 3],
      [0, 2, 7, 3],
    ]);
    dragSmallest(grid, 0, 0, 9, 0);

    expect(recognize(grid, 0, 2)?.kind).toBe('box');
    expect(recognize(grid, 9, 0)?.kind).toBe('box');
  });

  it('carries its label out with it', () => {
    const grid = boxes([
      [0, 0, 9, 3],
      [8, 0, 9, 3],
    ]);
    write(grid, 2, 1, 'left');
    write(grid, 10, 1, 'right');
    dragSmallest(grid, 0, 0, 0, 5);

    expect(grid.get(ck(2, 6))).toBe('l');
    expect(grid.get(ck(10, 1))).toBe('r');
  });

  it('is still one diff, so one undo step', () => {
    const grid = boxes([
      [0, 0, 5, 3],
      [4, 0, 5, 3],
    ]);
    const before = toText(grid);
    const shape = candidatesAt(grid, 0, 0)[0];
    if (shape === undefined) throw new Error('no candidate');

    const inverse = applyDiff(grid, planMove(grid, shape, 0, 4, { charset: UNICODE }).diff);
    applyDiff(grid, inverse);
    expect(toText(grid)).toBe(before);
  });
});
