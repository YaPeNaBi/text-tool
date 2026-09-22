/**
 * The scenarios in intuitive/sticky-connectors.md, pinned.
 *
 * Each expectation is the "Ideal" picture from that document, copied verbatim,
 * so the two cannot drift apart without a test going red.
 */

import { describe, expect, it } from 'vitest';
import { UNICODE } from '../src/core/charset/charsets.ts';
import { ck } from '../src/core/geom/cell.ts';
import { applyDiff, createGrid, type CellDiff, type Grid } from '../src/core/grid/grid.ts';
import { stampBox } from '../src/core/stamp/box.ts';
import { stampEllipse } from '../src/core/stamp/ellipse.ts';
import { stampPath } from '../src/core/stamp/path.ts';
import { toText } from '../src/core/io/text.ts';
import { recognize, selectWithin, type Candidate } from '../src/core/recognize/recognize.ts';
import { planMove } from '../src/core/ops/move.ts';
import { planResize } from '../src/core/ops/resize.ts';
import { candidatesAt, defaultIndex } from '../src/core/recognize/rank.ts';
import { findConnectors } from '../src/core/route/connectors.ts';
import { handlesOf } from '../src/core/transform/resize.ts';

function write(grid: Grid, x: number, y: number, s: string): void {
  const diff: CellDiff = new Map();
  [...s].forEach((c, i) => {
    if (c !== ' ') diff.set(ck(x + i, y), c);
  });
  applyDiff(grid, diff);
}

/** `A ──▶ B`, exactly as the document draws it. */
function wired(bx = 13): Grid {
  const grid = createGrid();
  applyDiff(grid, stampBox(grid, { x: 0, y: 0, w: 7, h: 3 }, UNICODE));
  write(grid, 3, 1, 'A');
  applyDiff(grid, stampBox(grid, { x: bx, y: 0, w: 7, h: 3 }, UNICODE));
  write(grid, bx + 3, 1, 'B');
  applyDiff(grid, stampPath(grid, { x: 7, y: 1 }, { x: bx, y: 1 }, UNICODE, { headEnd: true }));
  return grid;
}

/**
 * What a fresh click selects — the most specific reading, not the widest.
 *
 * Used throughout instead of `recognize`, which answers with the whole
 * connected component. Once a connector joins a border the two differ: the
 * component is the box *and* its wire, and only one of those is what a person
 * pointed at. This is the entry point the app itself uses.
 */
function clicked(grid: Grid, x: number, y: number): Candidate {
  const list = candidatesAt(grid, x, y);
  const picked = list[defaultIndex(list)];
  if (picked === undefined) throw new Error('nothing at the seed');
  return picked;
}

function move(grid: Grid, sx: number, sy: number, dx: number, dy: number): void {
  applyDiff(grid, planMove(grid, clicked(grid, sx, sy), dx, dy, { charset: UNICODE }).diff);
}

describe('the basics (sticky §1)', () => {
  it('§1.1 the far box moves down', () => {
    const grid = wired();
    move(grid, 13, 0, 0, 4);

    expect(toText(grid)).toBe(
      [
        '┌─────┐',
        '│  A  ├──┐',
        '└─────┘  │',
        '         │',
        '         │   ┌─────┐',
        '         └──▶│  B  │',
        '             └─────┘',
      ].join('\n'),
    );
  });

  it('§1.2 the far box moves further away, and the line just stretches', () => {
    const grid = wired();
    move(grid, 13, 0, 7, 0);

    expect(toText(grid)).toBe(
      [
        '┌─────┐             ┌─────┐',
        '│  A  ├────────────▶│  B  │',
        '└─────┘             └─────┘',
      ].join('\n'),
    );
  });

  it('§1.3 the far box moves closer, keeping its arrowhead and itself', () => {
    const grid = wired(20);
    move(grid, 20, 0, -7, 0);

    // The old line ran through where B now stands. Lifting it must not punch a
    // hole in the box that moved onto it.
    expect(toText(grid)).toBe(
      ['┌─────┐      ┌─────┐', '│  A  ├─────▶│  B  │', '└─────┘      └─────┘'].join('\n'),
    );
  });

  it('§1.4 the near box moves, and the head stays where it was pointing', () => {
    const grid = wired();
    move(grid, 0, 0, 0, 4);

    expect(toText(grid)).toBe(
      [
        '             ┌─────┐',
        '         ┌──▶│  B  │',
        '         │   └─────┘',
        '         │',
        '┌─────┐  │',
        '│  A  ├──┘',
        '└─────┘',
      ].join('\n'),
    );
  });
});

describe('choosing a side (sticky §2)', () => {
  it('§2.1 the far box moves directly below, so the line leaves the bottom', () => {
    const grid = wired();
    move(grid, 13, 0, -13, 6);

    expect(toText(grid)).toBe(
      [
        '┌─────┐',
        '│  A  │',
        '└──┬──┘',
        '   │',
        '   │',
        '   ▼',
        '┌─────┐',
        '│  B  │',
        '└─────┘',
      ].join('\n'),
    );
  });

  it('§2.2 the far box moves to the other side, so the whole thing mirrors', () => {
    // A is to the right this time, so B has room to go past it.
    const grid = createGrid();
    applyDiff(grid, stampBox(grid, { x: 14, y: 0, w: 7, h: 3 }, UNICODE));
    write(grid, 17, 1, 'A');
    applyDiff(grid, stampBox(grid, { x: 27, y: 0, w: 7, h: 3 }, UNICODE));
    write(grid, 30, 1, 'B');
    applyDiff(grid, stampPath(grid, { x: 21, y: 1 }, { x: 27, y: 1 }, UNICODE, { headEnd: true }));

    move(grid, 27, 0, -27, 0);

    expect(toText(grid)).toBe(
      ['┌─────┐       ┌─────┐', '│  B  │◀──────┤  A  │', '└─────┘       └─────┘'].join('\n'),
    );
  });

  it('§2.3 a long diagonal keeps the dominant axis', () => {
    const grid = wired();
    move(grid, 13, 0, 6, 8);

    // Horizontal distance still dominates, so it leaves east and arrives west.
    expect(clicked(grid, 0, 0).kind).toBe('box');
    expect(clicked(grid, 8, 1).kind).toBe('arrow');
  });
});

describe('resizing keeps its connectors (B-MAN-12)', () => {
  function pair(): Grid {
    const grid = createGrid();
    applyDiff(grid, stampBox(grid, { x: 0, y: 0, w: 9, h: 3 }, UNICODE));
    applyDiff(grid, stampBox(grid, { x: 22, y: 0, w: 9, h: 3 }, UNICODE));
    applyDiff(grid, stampPath(grid, { x: 9, y: 1 }, { x: 22, y: 1 }, UNICODE, { headEnd: true }));
    return grid;
  }

  it('follows a box that grows taller', () => {
    const grid = pair();
    const shape = recognize(grid, 22, 0);
    if (shape === null) throw new Error('no shape');

    applyDiff(
      grid,
      planResize(grid, shape, { x: 22, y: 0, w: 9, h: 7 }, { charset: UNICODE }).diff,
    );

    expect(toText(grid)).toBe(
      [
        '┌───────┐             ┌───────┐',
        '│       ├────────────▶│       │',
        '└───────┘             │       │',
        '                      │       │',
        '                      │       │',
        '                      │       │',
        '                      └───────┘',
      ].join('\n'),
    );
  });

  it('stretches when an edge is dragged away', () => {
    const grid = pair();
    const shape = recognize(grid, 22, 0);
    if (shape === null) throw new Error('no shape');

    applyDiff(
      grid,
      planResize(grid, shape, { x: 27, y: 0, w: 9, h: 3 }, { charset: UNICODE }).diff,
    );

    expect(toText(grid)).toBe(
      [
        '┌───────┐                  ┌───────┐',
        '│       ├─────────────────▶│       │',
        '└───────┘                  └───────┘',
      ].join('\n'),
    );
  });

  it('refuses to close over its own label (content §5)', () => {
    const grid = createGrid();
    applyDiff(grid, stampBox(grid, { x: 0, y: 0, w: 14, h: 3 }, UNICODE));
    write(grid, 2, 1, 'settlement');
    const shape = recognize(grid, 0, 0);
    if (shape === null) throw new Error('no shape');

    const before = toText(grid);
    const plan = planResize(grid, shape, { x: 0, y: 0, w: 8, h: 3 }, { charset: UNICODE });

    expect(plan.refused).toContain('Cannot shrink past the contents');
    expect(plan.diff.size).toBe(0);
    expect(toText(grid)).toBe(before);
  });

  it('refuses to close over a child (nesting §7)', () => {
    const grid = createGrid();
    applyDiff(grid, stampBox(grid, { x: 0, y: 0, w: 19, h: 6 }, UNICODE));
    applyDiff(grid, stampBox(grid, { x: 3, y: 1, w: 11, h: 3 }, UNICODE));
    const shape = recognize(grid, 0, 0);
    if (shape === null) throw new Error('no shape');

    const plan = planResize(grid, shape, { x: 0, y: 0, w: 10, h: 6 }, { charset: UNICODE });
    expect(plan.refused).toBeDefined();
    expect(plan.diff.size).toBe(0);
  });

  it('allows a resize that still clears the contents', () => {
    const grid = createGrid();
    applyDiff(grid, stampBox(grid, { x: 0, y: 0, w: 19, h: 6 }, UNICODE));
    applyDiff(grid, stampBox(grid, { x: 3, y: 1, w: 11, h: 3 }, UNICODE));
    const shape = recognize(grid, 0, 0);
    if (shape === null) throw new Error('no shape');

    const plan = planResize(grid, shape, { x: 0, y: 0, w: 25, h: 8 }, { charset: UNICODE });
    expect(plan.refused).toBeUndefined();
    expect(plan.diff.size).toBeGreaterThan(0);
  });
});

describe('a line drawn *into* a border, not stopping short', () => {
  /**
   * The reported case. Drawing with the line tool merges the line into the
   * box's edge, giving `├` — so the box and the line become one component. If a
   * click takes the widest reading, the selection contains the line, and a
   * connector inside the selection is not a connector: nothing re-routes.
   */
  function merged(): Grid {
    const grid = createGrid();
    applyDiff(grid, stampBox(grid, { x: 0, y: 0, w: 8, h: 5 }, UNICODE));
    applyDiff(grid, stampBox(grid, { x: 22, y: 2, w: 7, h: 5 }, UNICODE));
    applyDiff(grid, stampPath(grid, { x: 7, y: 2 }, { x: 17, y: 2 }, UNICODE));
    return grid;
  }

  it('the line really does merge into the border', () => {
    expect(merged().get(ck(7, 2))).toBe('├');
  });

  it('a click takes the box, not the box-and-line blob', () => {
    const picked = clicked(merged(), 2, 0);
    expect(picked.kind).toBe('box');
    expect(picked.bounds).toEqual({ x: 0, y: 0, w: 8, h: 5 });
  });

  it('so the line is seen as a connector and follows the box', () => {
    const grid = merged();
    const picked = clicked(grid, 2, 0);
    expect(findConnectors(grid, picked.cells).length).toBe(1);

    applyDiff(grid, planMove(grid, picked, 0, 9, { charset: UNICODE }).diff);

    // The line still reaches the box, and still joins it, from its new
    // position — a connector that meets a wall wears the junction (B-MAN-11g).
    expect(clicked(grid, 0, 9).kind).toBe('box');
    expect(toText(grid)).toContain('│      ├─────────┘');
  });

  it('and the wall it left behind is mended, junction and all', () => {
    const grid = merged();
    const picked = clicked(grid, 2, 0);
    applyDiff(grid, planMove(grid, picked, 0, 9, { charset: UNICODE }).diff);

    // The cell that carried the old `├` is empty: the box took its wall with
    // it, and nothing of the join was left sitting in the blank.
    expect(grid.get(ck(7, 2))).toBeUndefined();
  });

  /**
   * The other half of the same case, and the half that stayed broken.
   *
   * Above, the box that moves is the one the line merged *into*, so tracing
   * away from it never meets the junction. Move the box at the far end instead
   * and the trace runs the length of the shaft, arrives at that `├`, and
   * carries on around the near box — one blob, no simple path, connector
   * discarded. Every fixture in this file drew the line one cell clear of the
   * border, where no junction is made, so nothing caught it.
   */
  function wiredMerged(headEnd: boolean): Grid {
    const grid = createGrid();
    applyDiff(grid, stampBox(grid, { x: 0, y: 0, w: 8, h: 4 }, UNICODE));
    applyDiff(grid, stampBox(grid, { x: 20, y: 0, w: 8, h: 4 }, UNICODE));
    applyDiff(grid, stampPath(grid, { x: 7, y: 1 }, { x: 20, y: 1 }, UNICODE, { headEnd }));
    return grid;
  }

  it('the far box sees the connector too, and it follows', () => {
    const grid = wiredMerged(true);
    const picked = clicked(grid, 24, 0);
    expect(findConnectors(grid, picked.cells).length).toBe(1);

    applyDiff(grid, planMove(grid, picked, 0, 6, { charset: UNICODE }).diff);

    expect(toText(grid)).toBe(
      [
        '┌──────┐',
        '│      │',
        '│      ├─────┐',
        '└──────┘     │',
        '             │',
        '             │',
        '             │      ┌──────┐',
        '             └─────▶│      │',
        '                    │      │',
        '                    └──────┘',
      ].join('\n'),
    );
  });

  it('and the wall it let go of is mended, not left with an arm', () => {
    const grid = wiredMerged(true);
    applyDiff(grid, planMove(grid, clicked(grid, 24, 0), 0, 6, { charset: UNICODE }).diff);

    // The connector left row 1 for row 2, so the old join is a plain wall
    // again — and the far box, which the line let go of entirely, keeps
    // nothing of it at all.
    expect(grid.get(ck(7, 1))).toBe('│');
    expect(grid.get(ck(20, 1))).toBeUndefined();
    expect(clicked(grid, 0, 0).kind).toBe('box');
  });

  it('a plain line merged at both ends follows just the same', () => {
    const grid = wiredMerged(false);
    expect(grid.get(ck(7, 1))).toBe('├');
    expect(grid.get(ck(20, 1))).toBe('┤');

    applyDiff(grid, planMove(grid, clicked(grid, 24, 0), 0, 6, { charset: UNICODE }).diff);

    expect(toText(grid)).toBe(
      [
        '┌──────┐',
        '│      │',
        '│      ├──────┐',
        '└──────┘      │',
        '              │',
        '              │',
        '              │     ┌──────┐',
        '              └─────┤      │',
        '                    │      │',
        '                    └──────┘',
      ].join('\n'),
    );
  });

  it('a circle is a shape to be attached to as much as a box is', () => {
    const grid = createGrid();
    applyDiff(grid, stampEllipse(grid, { x: 0, y: 0, w: 9, h: 9 }, UNICODE));
    applyDiff(grid, stampBox(grid, { x: 20, y: 2, w: 8, h: 4 }, UNICODE));
    applyDiff(grid, stampPath(grid, { x: 8, y: 4 }, { x: 20, y: 4 }, UNICODE, { headEnd: true }));

    const picked = clicked(grid, 24, 2);
    expect(findConnectors(grid, picked.cells).length).toBe(1);

    applyDiff(grid, planMove(grid, picked, 0, 10, { charset: UNICODE }).diff);

    // The ring is whole again, and the arrow arrived where the box went.
    expect(clicked(grid, 4, 0).kind).toBe('ellipse');
    expect(toText(grid)).toContain('└────▶│      │');
  });

  /**
   * The restraint that pays for the rule above. A line crossing another line
   * ends the walk exactly the way a border does — but a rail is not something
   * to be attached to, and cutting the connector in half at the crossing to
   * re-anchor it there would be an invention. So that case is left alone.
   */
  it('a crossing is not a junction to attach to', () => {
    const grid = createGrid();
    applyDiff(grid, stampPath(grid, { x: 5, y: 0 }, { x: 5, y: 4 }, UNICODE, {}));
    applyDiff(grid, stampBox(grid, { x: 15, y: 1, w: 7, h: 3 }, UNICODE));
    applyDiff(grid, stampPath(grid, { x: 0, y: 2 }, { x: 15, y: 2 }, UNICODE, { headEnd: true }));
    expect(grid.get(ck(5, 2))).toBe('┼');

    const picked = clicked(grid, 18, 1);
    expect(findConnectors(grid, picked.cells).length).toBe(0);

    applyDiff(grid, planMove(grid, picked, 0, 8, { charset: UNICODE }).diff);

    // The rail and the line through it are exactly as they were.
    expect(toText(grid).split('\n').slice(0, 5)).toEqual([
      '     │',
      '     │',
      '─────┼────────▶',
      '     │',
      '     │',
    ]);
  });
});

describe('handles must leave somewhere to grab', () => {
  it('a short edge gives up its midpoint', () => {
    // 7×3: the sides are three cells, so they are corners and one grip.
    const handles = handlesOf({ x: 0, y: 0, w: 7, h: 3 });
    expect(handles.some((h) => h.id === 'w' || h.id === 'e')).toBe(false);
    expect(handles.some((h) => h.id === 'n' || h.id === 's')).toBe(true);
  });

  it('a roomy shape keeps all eight', () => {
    expect(handlesOf({ x: 0, y: 0, w: 9, h: 7 }).length).toBe(8);
  });

  it('the smallest boxes have none at all, so they can still be dragged', () => {
    expect(handlesOf({ x: 0, y: 0, w: 2, h: 2 })).toEqual([]);
    expect(handlesOf({ x: 0, y: 0, w: 2, h: 9 })).toEqual([]);
  });

  it('every side of every box keeps somewhere to grab', () => {
    for (const [w, h] of [[3, 3], [5, 3], [7, 3], [7, 5], [9, 7], [12, 4]] as const) {
      const handles = handlesOf({ x: 0, y: 0, w, h });
      const isHandle = (x: number, y: number) => handles.some((s) => s.x === x && s.y === y);

      const sides = {
        top: Array.from({ length: w }, (_, i) => [i, 0] as const),
        bottom: Array.from({ length: w }, (_, i) => [i, h - 1] as const),
        left: Array.from({ length: h }, (_, i) => [0, i] as const),
        right: Array.from({ length: h }, (_, i) => [w - 1, i] as const),
      };
      for (const [name, cells] of Object.entries(sides)) {
        const grips = cells.filter(([x, y]) => !isHandle(x, y)).length;
        expect(grips, `${w}x${h} ${name}`).toBeGreaterThan(0);
      }
    }
  });
});

describe('what a move must never do', () => {
  it('leaves both boxes whole in every §1 case', () => {
    for (const [dx, dy] of [
      [0, 4],
      [7, 0],
      [-3, 0],
      [0, -0],
      [6, 8],
    ] as const) {
      const grid = wired();
      move(grid, 13, 0, dx, dy);

      expect(clicked(grid, 0, 0).kind, `A after ${dx},${dy}`).toBe('box');
      expect(clicked(grid, 13 + dx, dy).kind, `B after ${dx},${dy}`).toBe('box');
    }
  });

  it('is one diff, so one undo step', () => {
    const grid = wired();
    const before = toText(grid);
    const shape = recognize(grid, 13, 0);
    if (shape === null) throw new Error('no shape');

    const inverse = applyDiff(grid, planMove(grid, shape, 0, 4, { charset: UNICODE }).diff);
    applyDiff(grid, inverse);
    expect(toText(grid)).toBe(before);
  });
});

/**
 * A connector joins what it reaches, so the wall wears the junction — the same
 * `┬`, `┴`, `├` or `┤` you get drawing the line there by hand (B-MAN-11g).
 * An arrow is the exception: merging it would replace the head with a `┤` and
 * lose which way it pointed.
 */
describe('a re-routed connector joins the wall it reaches', () => {
  it('a line joins at both ends', () => {
    const grid = createGrid();
    applyDiff(grid, stampBox(grid, { x: 0, y: 0, w: 7, h: 3 }, UNICODE));
    applyDiff(grid, stampBox(grid, { x: 13, y: 0, w: 7, h: 3 }, UNICODE));
    applyDiff(grid, stampPath(grid, { x: 7, y: 1 }, { x: 13, y: 1 }, UNICODE, {}));

    move(grid, 13, 0, 0, 4);

    expect(grid.get(ck(6, 1))).toBe('├'); // left box, where the line leaves
    expect(toText(grid)).toContain('└──┤'); // right box, where it arrives
  });

  it('but an arrow keeps its head clear of the wall (B-DRAW-10a)', () => {
    const grid = wired();
    move(grid, 13, 0, 0, 4);

    expect(grid.get(ck(6, 1))).toBe('├'); // the tail joins
    expect(toText(grid)).toContain('▶│  B  │'); // the head does not
  });

  it('the junction moves with the side the connector picks', () => {
    const grid = wired();
    // Straight down: the line now leaves through A's bottom, so that is where
    // the `┬` belongs and A's right wall is plain again.
    move(grid, 13, 0, -13, 6);

    expect(grid.get(ck(3, 2))).toBe('┬');
    expect(grid.get(ck(6, 1))).toBe('│');
  });

  it('a loose end joins nothing, because there is nothing to join', () => {
    const grid = createGrid();
    applyDiff(grid, stampBox(grid, { x: 0, y: 0, w: 7, h: 3 }, UNICODE));
    applyDiff(grid, stampPath(grid, { x: 7, y: 1 }, { x: 16, y: 1 }, UNICODE, {}));

    move(grid, 0, 0, 0, 5);

    // The box end joins; the far end is still just a line stopping in space.
    expect(toText(grid)).toContain('├');
    expect(clicked(grid, 0, 5).kind).toBe('box');
  });
});

describe('a slice of a line is not a shape with connectors (B-MAN-11f)', () => {
  /** A box with a U-shaped line hanging off its bottom edge. */
  function hanging(): Grid {
    const grid = createGrid();
    for (const [y, row] of [
      [0, '┌─────────────────────┐'],
      [1, '│                 fefe│'],
      [2, '└───────────┬─────────┘'],
      [3, '            │                │'],
      [4, '            │                │'],
      [5, '            │                │'],
      [6, '            └────────────────┘'],
    ] as const) {
      write(grid, 0, y, row);
    }
    return grid;
  }

  /** The run between the U's two corners, as a marquee would select it. */
  function bottomRun(grid: Grid): Candidate {
    const sel = selectWithin(grid, { x: 13, y: 6, w: 16, h: 1 });
    if (sel === null) throw new Error('nothing swept');
    return sel;
  }

  it('drags without re-routing the rest of the line onto the box', () => {
    const grid = hanging();
    applyDiff(grid, planMove(grid, bottomRun(grid), 3, 0, { charset: UNICODE }).diff);

    const rows = toText(grid).split('\n');
    // The box is untouched: no connector was invented onto its wall.
    expect(rows[0]).toBe('┌─────────────────────┐');
    expect(rows[2]).toBe('└───────────┬─────────┘');
    // Both legs stay exactly where they were.
    expect(rows[3]).toBe('            │                │');
  });

  it('and no junction sprouts where nothing joins, however often it is dragged', () => {
    const grid = hanging();
    let sel: Candidate = bottomRun(grid);

    for (let i = 0; i < 4; i++) {
      const plan = planMove(grid, sel, 2, 0, { charset: UNICODE });
      applyDiff(grid, plan.diff);
      sel = plan.selection ?? sel;
    }

    // The reported symptom was a bottom row growing `┴` spikes — `└──┴─┴───` —
    // one more with every drag, where a re-route crossed a run it had left
    // behind. A moved run is plain `─` and nothing else.
    for (const row of toText(grid).split('\n').slice(3)) {
      expect(row).not.toMatch(/[┴┬┼├┤]/);
    }
  });

  it('but an arrow aimed at a word still follows the word', () => {
    const grid = createGrid();
    applyDiff(grid, stampBox(grid, { x: 0, y: 0, w: 7, h: 3 }, UNICODE));
    write(grid, 3, 1, 'A');
    write(grid, 7, 1, '───▶word');

    const word = recognize(grid, 11, 1);
    expect(word).not.toBeNull();
    if (word === null) return;

    applyDiff(grid, planMove(grid, word, 3, 2, { charset: UNICODE }).diff);

    // Text carries connectors because it has no connectivity of its own, so
    // the line running into it is a real attachment rather than more of itself.
    expect(toText(grid).split('\n')[3]).toBe('          └──▶word');
  });
});

describe('an open path has no sides to drag (B-MAN-15a)', () => {
  /** Two boxes joined by a U-shaped connector under them. */
  function bridged(): Grid {
    const grid = createGrid();
    for (const [y, row] of [
      [0, '┌───────────────┐                ┌─────────────────┐'],
      [1, '│               │                │                 │'],
      [2, '│               │                │                 │'],
      [3, '│               │                │                 │'],
      [4, '└─────┬─────────┘                └────────┬────────┘'],
      [5, '      │                                   │'],
      [6, '      └───────────────────────────────────┘'],
    ] as const) {
      write(grid, 0, y, row);
    }
    return grid;
  }

  it('moving the connector\'s bottom run does not stamp a rectangle', () => {
    const grid = bridged();
    const sel = selectWithin(grid, { x: 6, y: 6, w: 37, h: 1 });
    expect(sel).not.toBeNull();
    if (sel === null) return;

    applyDiff(grid, planMove(grid, sel, 0, 1, { charset: UNICODE }).diff);

    const rows = toText(grid).split('\n');
    // The run is the full width of the connector's bounds and sits along the
    // bottom of them, so it read as a shape's south edge and "resizing" it drew
    // a whole box — whose top edge welded itself across both boxes' walls.
    expect(rows[4]).toBe('└─────┬─────────┘                └────────┬────────┘');
    expect(rows[0]).toBe('┌───────────────┐                ┌─────────────────┐');
  });

  it('while a real box side still resizes', () => {
    const grid = createGrid();
    applyDiff(grid, stampBox(grid, { x: 0, y: 0, w: 9, h: 5 }, UNICODE));

    // The right-hand wall, on its own.
    const side = selectWithin(grid, { x: 8, y: 0, w: 1, h: 5 });
    expect(side).not.toBeNull();
    if (side === null) return;

    // Nine wide becomes eleven: the wall moved and the box followed it.
    applyDiff(grid, planMove(grid, side, 2, 0, { charset: UNICODE }).diff);
    expect(toText(grid).split('\n')[0]).toBe('┌─────────┐');
  });
});
