import { describe, expect, it } from 'vitest';
import {
  ASCII,
  DOUBLE,
  HEAVY,
  ROUNDED,
  UNICODE,
} from '../src/core/charset/charsets.ts';
import { ck } from '../src/core/geom/cell.ts';
import { applyDiff, createGrid, type Grid } from '../src/core/grid/grid.ts';
import { fromText, toText } from '../src/core/io/text.ts';
import { stampBox } from '../src/core/stamp/box.ts';
import { ellipseCells, stampEllipse } from '../src/core/stamp/ellipse.ts';
import { stampPath } from '../src/core/stamp/path.ts';
import { convertCharset } from '../src/core/transform/convert.ts';
import { resizeBoxDiff } from '../src/core/transform/resize.ts';
import { recognize } from '../src/core/recognize/recognize.ts';
import { trace } from '../src/core/recognize/trace.ts';
import { candidatesAt, defaultIndex, nextIndex } from '../src/core/recognize/rank.ts';

function gridFrom(art: string): Grid {
  const grid = createGrid();
  applyDiff(grid, fromText(art));
  return grid;
}

function drawn(w: number, h: number, cs = UNICODE): Grid {
  const grid = createGrid();
  applyDiff(grid, stampEllipse(grid, { x: 0, y: 0, w, h }, cs));
  return grid;
}

describe('stampEllipse (B-DRAW-13)', () => {
  it('draws a small circle with diagonal shoulders', () => {
    expect(toText(drawn(5, 5))).toBe(
      [' ╭─╮', '/   \\', '│   │', '\\   /', ' ╰─╯'].join('\n'),
    );
  });

  it('takes the shoulders one row at a time', () => {
    expect(toText(drawn(9, 9))).toBe(
      [
        '  ╭───╮',
        ' /     \\',
        '/       \\',
        '│       │',
        '│       │',
        '│       │',
        '\\       /',
        ' \\     /',
        '  ╰───╯',
      ].join('\n'),
    );
  });

  it('widens into an ellipse', () => {
    expect(toText(drawn(11, 5))).toBe(
      [
        ' ╭───────╮',
        '/         \\',
        '│         │',
        '\\         /',
        ' ╰───────╯',
      ].join('\n'),
    );
  });

  it('rounds the ends of a flat one instead of pointing them', () => {
    expect(toText(drawn(9, 3))).toBe([' ╭─────╮', '│       │', ' ╰─────╯'].join('\n'));
  });

  it('is a single connected ring, which is the whole point', () => {
    const sizes = [
      [4, 4], [5, 5], [7, 5], [9, 7], [13, 9], [15, 15], [21, 13],
      [21, 3], [21, 5], [30, 7], [3, 9], [5, 11],
    ] as const;
    for (const [w, h] of sizes) {
      const grid = drawn(w, h);
      const cells = ellipseCells({ x: 0, y: 0, w, h });
      // Seeding anywhere on the ring must reach every other cell of it.
      const first = [...cells][0] as string;
      const i = first.indexOf(',');
      const reached = trace(grid, Number(first.slice(0, i)), Number(first.slice(i + 1)));
      expect(reached.cells.size, `${w}x${h}`).toBe(cells.size);
    }
  });

  it('degenerates to a rectangle when there is no room to curve', () => {
    expect(toText(drawn(3, 3))).toBe(['┌─┐', '│ │', '└─┘'].join('\n'));
  });

  it('refuses to draw below the minimum size', () => {
    const grid = createGrid();
    expect(stampEllipse(grid, { x: 0, y: 0, w: 2, h: 5 }, UNICODE).size).toBe(0);
  });

  it('merges into a box it crosses (B-DRAW-07)', () => {
    const grid = createGrid();
    applyDiff(grid, stampBox(grid, { x: 0, y: 2, w: 12, h: 3 }, UNICODE));
    applyDiff(grid, stampEllipse(grid, { x: 2, y: 0, w: 7, h: 5 }, UNICODE));

    // Where the ring meets the box's top edge the glyph gains an arm.
    expect(grid.get(ck(2, 2))).toBe('┼');
    expect(grid.get(ck(8, 2))).toBe('┼');
  });

  it('follows the active charset', () => {
    expect(toText(drawn(5, 5, HEAVY))).toBe(
      [' ┏━┓', '/   \\', '┃   ┃', '\\   /', ' ┗━┛'].join('\n'),
    );
    expect(toText(drawn(5, 5, ASCII))).toBe(
      [' .-.', '/   \\', '|   |', '\\   /', " '-'"].join('\n'),
    );
  });
});

describe('recognizing an ellipse (B-REC-14)', () => {
  it('recovers a drawn circle', () => {
    const grid = drawn(9, 7);
    const found = recognize(grid, 4, 0);

    expect(found?.kind).toBe('ellipse');
    expect(found?.bounds).toEqual({ x: 0, y: 0, w: 9, h: 7 });
  });

  it('recovers it from any cell, a slash as much as a side', () => {
    const grid = drawn(9, 7);
    for (const [x, y] of [[1, 1], [0, 2], [0, 3], [2, 0], [7, 5]] as const) {
      expect(recognize(grid, x, y)?.kind, `${x},${y}`).toBe('ellipse');
    }
  });

  it('recovers one drawn in ASCII, where the bends are only dots and ticks', () => {
    const grid = drawn(9, 7, ASCII);
    expect(recognize(grid, 4, 0)?.kind).toBe('ellipse');
    expect(recognize(grid, 2, 0)?.kind).toBe('ellipse');
  });

  it('recovers one it never drew, from pasted art', () => {
    const grid = gridFrom([' .----.', '/      \\', '|      |', '\\      /', " '----'"].join('\n'));
    expect(recognize(grid, 3, 0)?.kind).toBe('ellipse');
  });

  it('still recovers the staircase it used to draw, so old documents keep their circles', () => {
    const grid = gridFrom([' ┌─┐', '┌┘ └┐', '│   │', '└┐ ┌┘', ' └─┘'].join('\n'));
    expect(recognize(grid, 1, 0)?.kind).toBe('ellipse');
  });

  it('and resizing one of those lifts the staircase, not the ring it would draw today', () => {
    const grid = gridFrom([' ┌─┐', '┌┘ └┐', '│   │', '└┐ ┌┘', ' └─┘'].join('\n'));
    applyDiff(
      grid,
      resizeBoxDiff(grid, { x: 0, y: 0, w: 5, h: 5 }, { x: 0, y: 0, w: 5, h: 5 }, UNICODE, 'ellipse'),
    );
    expect(toText(grid)).toBe(toText(drawn(5, 5)));
  });

  it('does not call a rectangle an ellipse', () => {
    const grid = createGrid();
    applyDiff(grid, stampBox(grid, { x: 0, y: 0, w: 9, h: 7 }, UNICODE));
    expect(recognize(grid, 0, 0)?.kind).toBe('box');
  });

  it('resizes by redrawing the ring at the new size', () => {
    const grid = drawn(9, 7);
    applyDiff(
      grid,
      resizeBoxDiff(grid, { x: 0, y: 0, w: 9, h: 7 }, { x: 0, y: 0, w: 5, h: 5 }, UNICODE, 'ellipse'),
    );
    expect(toText(grid)).toBe([' ╭─╮', '/   \\', '│   │', '\\   /', ' ╰─╯'].join('\n'));
  });
});

describe('charset packs (B-CS-06)', () => {
  const box = (cs: typeof UNICODE): string => {
    const grid = createGrid();
    applyDiff(grid, stampBox(grid, { x: 0, y: 0, w: 4, h: 3 }, cs));
    applyDiff(grid, stampBox(grid, { x: 3, y: 0, w: 4, h: 3 }, cs));
    return toText(grid);
  };

  it('draws rounded corners', () => {
    expect(box(ROUNDED)).toBe(['╭──┬──╮', '│  │  │', '╰──┴──╯'].join('\n'));
  });

  it('draws heavy lines', () => {
    expect(box(HEAVY)).toBe(['┏━━┳━━┓', '┃  ┃  ┃', '┗━━┻━━┛'].join('\n'));
  });

  it('draws double lines', () => {
    expect(box(DOUBLE)).toBe(['╔══╦══╗', '║  ║  ║', '╚══╩══╝'].join('\n'));
  });

  it('round-trips through every pack losslessly (B-CS-04)', () => {
    const grid = createGrid();
    applyDiff(grid, stampBox(grid, { x: 0, y: 0, w: 5, h: 4 }, UNICODE));
    applyDiff(grid, stampBox(grid, { x: 4, y: 0, w: 5, h: 4 }, UNICODE));
    const original = toText(grid);

    for (const cs of [ROUNDED, HEAVY, DOUBLE, ASCII, UNICODE]) {
      applyDiff(grid, convertCharset(grid, cs));
    }
    expect(toText(grid)).toBe(original);
  });

  it('understands art pasted in any of them (B-CONN-02)', () => {
    for (const art of [
      ['╭──╮', '│  │', '╰──╯'],
      ['┏━━┓', '┃  ┃', '┗━━┛'],
      ['╔══╗', '║  ║', '╚══╝'],
    ]) {
      expect(recognize(gridFrom(art.join('\n')), 0, 0)?.kind).toBe('box');
    }
  });
});

describe('candidate ranking (B-REC-10)', () => {
  function twoBoxesSharingAnEdge(): Grid {
    const grid = createGrid();
    applyDiff(grid, stampBox(grid, { x: 0, y: 0, w: 4, h: 3 }, UNICODE));
    applyDiff(grid, stampBox(grid, { x: 3, y: 0, w: 4, h: 3 }, UNICODE));
    return grid;
  }

  it('offers a lone box exactly one reading', () => {
    const grid = createGrid();
    applyDiff(grid, stampBox(grid, { x: 2, y: 1, w: 6, h: 4 }, UNICODE));

    const list = candidatesAt(grid, 2, 1);
    expect(list.length).toBe(1);
    expect(list[0]?.kind).toBe('box');
  });

  it('finds the standalone box inside a shared-edge pair (B-REC-12)', () => {
    const list = candidatesAt(twoBoxesSharingAnEdge(), 0, 0);

    // smallest first: the left-hand box on its own
    expect(list[0]?.kind).toBe('box');
    expect(list[0]?.bounds).toEqual({ x: 0, y: 0, w: 4, h: 3 });

    // widest last: the whole component, divider included
    expect(list.at(-1)?.bounds).toEqual({ x: 0, y: 0, w: 7, h: 3 });
    expect(list.length).toBeGreaterThan(1);
  });

  it('reaches the right-hand box when seeded on it', () => {
    const list = candidatesAt(twoBoxesSharingAnEdge(), 6, 0);
    expect(list[0]?.bounds).toEqual({ x: 3, y: 0, w: 4, h: 3 });
  });

  it('only offers rectangles whose border runs through the click', () => {
    const list = candidatesAt(twoBoxesSharingAnEdge(), 1, 0);
    // (1,0) is on the top edge of the left box and of the whole, but the
    // right-hand box's border never touches it.
    for (const c of list) {
      expect(c.bounds.x).toBe(0);
    }
  });

  it('starts specific and widens on repeat clicks (B-REC-11)', () => {
    const list = candidatesAt(twoBoxesSharingAnEdge(), 0, 0);

    // A click on a box selects that box. Anything else is a bad answer, and it
    // is the answer that quietly disables sticky connectors: a line drawn into
    // a border merges with it, so the widest reading is box-and-line as one
    // blob — and a connector inside the selection is not a connector at all.
    let index = defaultIndex(list);
    expect(list[index]?.bounds.w).toBe(4);

    index = nextIndex(list, index);
    expect(list[index]?.bounds.w).toBe(7); // second click widens

    // and it comes back round rather than dead-ending
    for (let i = 0; i < list.length; i++) index = nextIndex(list, index);
    expect(list[index]?.bounds.w).toBe(7);
  });

  it('gives a text run a single reading', () => {
    const grid = gridFrom('hello');
    const list = candidatesAt(grid, 1, 0);
    expect(list.length).toBe(1);
    expect(list[0]?.kind).toBe('text');
  });

  it('gives an empty cell nothing at all (B-REC-07)', () => {
    expect(candidatesAt(createGrid(), 4, 4)).toEqual([]);
  });
});

/**
 * A stamp inherits what a cell *connects to*, not what it claims (B-DRAW-07a).
 *
 * A straight run does not know where it ends — the last cell of `─────` is a `─`
 * like every other, declaring east as well as west — so the old glyph's arms
 * cannot be taken on trust when something lands on top of them.
 */
describe('merging onto the end of a line (B-DRAW-07a)', () => {
  const lineAcross = (grid: Grid, toX: number): void => {
    applyDiff(grid, stampPath(grid, { x: 2, y: 4 }, { x: toX, y: 4 }, UNICODE, {}));
  };

  it('a box meeting a line end joins it with a T, not a cross', () => {
    const grid = createGrid();
    lineAcross(grid, 12);
    applyDiff(grid, stampBox(grid, { x: 12, y: 1, w: 8, h: 7 }, UNICODE));

    expect(grid.get(ck(12, 4))).toBe('┤');
  });

  it('and the order it was drawn in makes no difference', () => {
    // The whole complaint: box-then-line already gave `┤`, line-then-box gave
    // `┼`, and the same two shapes in the same two places must not depend on
    // which one was drawn first.
    const boxFirst = createGrid();
    applyDiff(boxFirst, stampBox(boxFirst, { x: 12, y: 1, w: 8, h: 7 }, UNICODE));
    lineAcross(boxFirst, 12);

    const lineFirst = createGrid();
    lineAcross(lineFirst, 12);
    applyDiff(lineFirst, stampBox(lineFirst, { x: 12, y: 1, w: 8, h: 7 }, UNICODE));

    expect(toText(lineFirst)).toBe(toText(boxFirst));
  });

  it('a line that really crosses the border still crosses', () => {
    const grid = createGrid();
    lineAcross(grid, 18); // straight through, out the far side
    applyDiff(grid, stampBox(grid, { x: 12, y: 1, w: 8, h: 7 }, UNICODE));

    expect(grid.get(ck(12, 4))).toBe('┼');
  });

  it('a circle meeting a line end joins it the same way', () => {
    const grid = createGrid();
    applyDiff(grid, stampPath(grid, { x: 0, y: 5 }, { x: 8, y: 5 }, UNICODE, {}));
    applyDiff(grid, stampEllipse(grid, { x: 8, y: 1, w: 11, h: 9 }, UNICODE));

    expect(grid.get(ck(8, 5))).toBe('┤');
  });

  it('a line ending on another line end makes a corner, not a T', () => {
    const grid = createGrid();
    lineAcross(grid, 8);
    applyDiff(grid, stampPath(grid, { x: 8, y: 0 }, { x: 8, y: 4 }, UNICODE, {}));

    expect(grid.get(ck(8, 4))).toBe('┘');
  });

  it('but an arm pointing at a slash is kept, being half of a link', () => {
    // The exception, and the case that caught the first version of this fix.
    // A circle's ring runs down its side as `│` and turns into a `\` shoulder;
    // the slash declares no arms, so the join is a **link** (B-CONN-08) and the
    // `│`'s loose arm is half of it. Drawing a connector out of that cell must
    // not take the arm with it, or the ring stops being a ring.
    const grid = createGrid();
    applyDiff(grid, stampEllipse(grid, { x: 0, y: 0, w: 9, h: 9 }, UNICODE));
    expect(grid.get(ck(8, 6))).toBe('/'); // the shoulder it has to reach

    applyDiff(grid, stampPath(grid, { x: 8, y: 5 }, { x: 16, y: 5 }, UNICODE, {}));

    // `├`, keeping south — not `└`, which would cut the ring below it.
    expect(grid.get(ck(8, 5))).toBe('├');
    expect(candidatesAt(grid, 4, 0).some((c) => c.kind === 'ellipse')).toBe(true);
  });
});
