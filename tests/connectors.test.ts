import { describe, expect, it } from 'vitest';
import { E, N, S, W, UNICODE } from '../src/core/charset/charsets.ts';
import { ck } from '../src/core/geom/cell.ts';
import { applyDiff, createGrid, type Grid } from '../src/core/grid/grid.ts';
import { fromText, toText } from '../src/core/io/text.ts';
import { stampBox } from '../src/core/stamp/box.ts';
import { polylineCells, stampPath, stampPolyline } from '../src/core/stamp/path.ts';
import { moveDiff } from '../src/core/transform/move.ts';
import {
  findConnectors,
  rerouteDiff,
  routeVertices,
} from '../src/core/route/connectors.ts';
import { recognize } from '../src/core/recognize/recognize.ts';
import { candidatesAt } from '../src/core/recognize/rank.ts';

function gridFrom(art: string): Grid {
  const grid = createGrid();
  applyDiff(grid, fromText(art));
  return grid;
}

/** Two boxes with an arrow from the left one to the right one. */
function wired(): { grid: Grid; left: Set<string>; right: Set<string> } {
  const grid = createGrid();
  applyDiff(grid, stampBox(grid, { x: 0, y: 0, w: 8, h: 4 }, UNICODE));
  applyDiff(grid, stampBox(grid, { x: 20, y: 0, w: 8, h: 4 }, UNICODE));
  applyDiff(
    grid,
    stampPath(grid, { x: 8, y: 1 }, { x: 20, y: 1 }, UNICODE, { headEnd: true }),
  );
  return {
    grid,
    left: recognize(grid, 0, 0)?.cells ?? new Set(),
    right: recognize(grid, 20, 0)?.cells ?? new Set(),
  };
}

function move(grid: Grid, shape: Set<string>, dx: number, dy: number): void {
  const connectors = findConnectors(grid, shape);
  const diff = moveDiff(grid, shape, dx, dy);

  const landed = new Set<string>();
  for (const key of shape) {
    const comma = key.indexOf(',');
    landed.add(
      `${Number(key.slice(0, comma)) + dx},${Number(key.slice(comma + 1)) + dy}`,
    );
  }
  for (const [key, value] of rerouteDiff(grid, landed, connectors, diff, UNICODE).diff) {
    diff.set(key, value);
  }
  applyDiff(grid, diff);
}

describe('polylines (B-DRAW-14)', () => {
  it('walks through every vertex in order', () => {
    const cells = polylineCells([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 3 },
    ]);
    expect(cells[0]).toEqual({ x: 0, y: 0 });
    expect(cells.at(-1)).toEqual({ x: 4, y: 3 });
    expect(cells.length).toBe(8); // 5 across + 3 down, corner counted once
  });

  it('draws corners at the vertices', () => {
    const grid = createGrid();
    applyDiff(
      grid,
      stampPolyline(
        grid,
        [
          { x: 0, y: 0 },
          { x: 3, y: 0 },
          { x: 3, y: 2 },
          { x: 6, y: 2 },
        ],
        UNICODE,
      ),
    );
    expect(toText(grid)).toBe(['───┐', '   │', '   └───'].join('\n'));
  });

  it('puts the arrowhead on the final vertex only', () => {
    const grid = createGrid();
    applyDiff(
      grid,
      stampPolyline(
        grid,
        [
          { x: 0, y: 0 },
          { x: 3, y: 0 },
          { x: 3, y: 2 },
        ],
        UNICODE,
        { headEnd: true },
      ),
    );
    expect(toText(grid)).toBe(['───┐', '   │', '   ▼'].join('\n'));
  });

  it('crosses itself as a junction rather than a fight over one cell', () => {
    const grid = createGrid();
    applyDiff(
      grid,
      stampPolyline(
        grid,
        [
          { x: 2, y: 0 },
          { x: 2, y: 4 },
          { x: 4, y: 4 },
          { x: 4, y: 2 },
          { x: 0, y: 2 },
        ],
        UNICODE,
      ),
    );
    expect(grid.get(ck(2, 2))).toBe('┼');
  });

  it('is one diff, so one undo step', () => {
    const grid = createGrid();
    const diff = stampPolyline(
      grid,
      [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 5, y: 5 },
      ],
      UNICODE,
    );
    const inverse = applyDiff(grid, diff);
    applyDiff(grid, inverse);
    expect(grid.size).toBe(0);
  });
});

describe('finding connectors (B-MAN-11)', () => {
  it('finds an arrow aimed at the shape', () => {
    const { grid, right } = wired();
    const found = findConnectors(grid, right);

    expect(found.length).toBe(1);
    expect(found[0]?.anchor).toEqual({ x: 19, y: 1 });
    expect(found[0]?.free).toEqual({ x: 8, y: 1 });
    expect(found[0]?.headed).toBe(true);
    expect(found[0]?.approach).toBe(E);
  });

  it('finds a line that only touches the shape', () => {
    const { grid, left } = wired();
    const found = findConnectors(grid, left);

    expect(found.length).toBe(1);
    expect(found[0]?.anchor).toEqual({ x: 8, y: 1 });
    expect(found[0]?.approach).toBe(W);
    // the far end is up against the other box
    expect(found[0]?.freeApproach).toBe(E);
  });

  it('ignores a line merely running past the shape', () => {
    const grid = createGrid();
    applyDiff(grid, stampBox(grid, { x: 0, y: 0, w: 8, h: 4 }, UNICODE));
    applyDiff(grid, stampPath(grid, { x: 8, y: 0 }, { x: 8, y: 6 }, UNICODE));

    expect(findConnectors(grid, recognize(grid, 0, 0)?.cells ?? new Set()).length).toBe(0);
  });

  it('ignores a shape touching another shape', () => {
    const grid = createGrid();
    applyDiff(grid, stampBox(grid, { x: 0, y: 0, w: 4, h: 3 }, UNICODE));
    applyDiff(grid, stampBox(grid, { x: 3, y: 0, w: 4, h: 3 }, UNICODE));

    // The neighbour is a closed loop, not a path, so it is left alone.
    const list = candidatesAt(grid, 0, 0);
    const box = list[0];
    expect(box).toBeDefined();
    expect(findConnectors(grid, box?.cells ?? new Set()).length).toBe(0);
  });
});

describe('re-routing (B-MAN-11)', () => {
  it('follows the shape down, keeping both ends attached', () => {
    const { grid, right } = wired();
    move(grid, right, 0, 6);

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

  it('stretches when the shape moves along the same axis', () => {
    const { grid, right } = wired();
    move(grid, right, 6, 0);

    expect(toText(grid)).toBe(
      [
        '┌──────┐                  ┌──────┐',
        '│      ├─────────────────▶│      │',
        '│      │                  │      │',
        '└──────┘                  └──────┘',
      ].join('\n'),
    );
  });

  it('re-routes when the shape the line leaves from moves', () => {
    const { grid, left } = wired();
    move(grid, left, 0, 5);

    // The arrowhead still lands on the right-hand box, and on the side facing
    // where A ended up rather than the row it happened to start on.
    expect(grid.get(ck(19, 2))).toBe('▶');
    expect(toText(grid)).toContain('└──────┘');
  });

  it('keeps the arrowhead pointing at the shape, never past it', () => {
    const { grid, right } = wired();
    move(grid, right, 3, 9);

    // Whatever the route, the head sits immediately west of the box's edge.
    const head = grid.get(ck(22, 10));
    expect(head).toBe('▶');
    expect(grid.get(ck(23, 10))).toBe('│');
  });

  it('leaves the document alone when nothing is attached', () => {
    const grid = createGrid();
    applyDiff(grid, stampBox(grid, { x: 0, y: 0, w: 5, h: 3 }, UNICODE));
    const shape = recognize(grid, 0, 0)?.cells ?? new Set();

    const before = toText(grid);
    move(grid, shape, 4, 4);
    expect(toText(grid)).toBe(before);
  });
});

describe('routeVertices', () => {
  it('is a straight run when the ends line up', () => {
    expect(routeVertices({ x: 0, y: 0 }, W, { x: 9, y: 0 }, E)).toEqual([
      { x: 0, y: 0 },
      { x: 9, y: 0 },
    ]);
  });

  it('is one elbow when only one end is anchored', () => {
    const path = routeVertices({ x: 0, y: 0 }, null, { x: 9, y: 4 }, E);
    expect(path.length).toBe(3);
    // the arrival leg must be horizontal, so the turn happens on the free column
    expect(path[1]).toEqual({ x: 0, y: 4 });
  });

  it('is a Z when both ends leave along the same axis', () => {
    const path = routeVertices({ x: 0, y: 0 }, W, { x: 10, y: 6 }, E);
    expect(path.length).toBe(4);
    expect(path[1]).toEqual({ x: 5, y: 0 });
    expect(path[2]).toEqual({ x: 5, y: 6 });
  });

  it('takes one elbow when the two ends leave along different axes', () => {
    const path = routeVertices({ x: 0, y: 0 }, N, { x: 10, y: 6 }, E);
    expect(path.length).toBe(3);
  });

  it('steps across the middle for a vertical pair', () => {
    const path = routeVertices({ x: 0, y: 0 }, N, { x: 6, y: 10 }, S);
    expect(path[1]).toEqual({ x: 0, y: 5 });
    expect(path[2]).toEqual({ x: 6, y: 5 });
  });
});

describe('drilling into shapes that are not boxes', () => {
  it('offers a whole standalone arrow as itself', () => {
    // An arrow stops one cell short of what it points at (B-DRAW-10a), so it
    // is its own component and has exactly one reading.
    const { grid } = wired();
    const list = candidatesAt(grid, 12, 1);

    expect(list.length).toBe(1);
    expect(list[0]?.kind).toBe('arrow');
  });

  it('reaches a line that has merged into a box', () => {
    const grid = createGrid();
    applyDiff(grid, stampBox(grid, { x: 10, y: 0, w: 6, h: 4 }, UNICODE));
    // No arrowhead, so this one runs right into the border and joins it.
    applyDiff(grid, stampPath(grid, { x: 0, y: 2 }, { x: 10, y: 2 }, UNICODE));

    // One component: the line and the box together.
    expect(recognize(grid, 4, 2)?.cells.size).toBeGreaterThan(16);

    const list = candidatesAt(grid, 4, 2);
    expect(list[0]?.kind).toBe('line');
    expect(list.at(-1)?.kind).toBe('cells');

    // and clicking the box still gives the box
    expect(candidatesAt(grid, 12, 0)[0]?.kind).toBe('box');
  });

  it('reaches a circle overlapping a box', () => {
    const grid = gridFrom(
      ['   ┌───┐', '  ┌┘   └┐', '┌─┼─────┼──┐', '│ └┐   ┌┘  │', '└──┴───┴───┘'].join('\n'),
    );

    expect(candidatesAt(grid, 5, 0)[0]?.kind).toBe('ellipse');
    expect(candidatesAt(grid, 1, 4)[0]?.kind).toBe('box');
  });

  it('will not offer a rectangle the characters only accidentally form', () => {
    const grid = gridFrom(
      ['   ┌───┐', '  ┌┘   └┐', '┌─┼─────┼──┐', '│ └┐   ┌┘  │', '└──┴───┴───┘'].join('\n'),
    );

    // (3,0)-(7,2) has a character at every border position, but `┘` at (3,1)
    // has no southward arm, so it cannot be a left edge.
    for (const c of candidatesAt(grid, 5, 0)) {
      expect(`${c.kind} ${c.bounds.w}x${c.bounds.h}`).not.toBe('box 5x3');
    }
  });

  it('reaches one of two circles sharing a cell', () => {
    const grid = gridFrom(
      [' ┌───┐ ┌───┐', '┌┘   └┬┘   └┐', '│     │     │', '└┐   ┌┴┐   ┌┘', ' └───┘ └───┘'].join(
        '\n',
      ),
    );

    const list = candidatesAt(grid, 3, 0);
    expect(list[0]?.kind).toBe('ellipse');
    expect(list[0]?.bounds).toEqual({ x: 0, y: 0, w: 7, h: 5 });
  });
});
