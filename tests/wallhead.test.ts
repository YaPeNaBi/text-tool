/**
 * An arrowhead standing in a wall (B-CONN-07a, B-MAN-11g).
 *
 * The editor's own arrow tool stops one cell short of a border (B-DRAW-10a), so
 * this is the picture that arrives by paste, by load, or by nudging an arrow one
 * cell too far: the head has replaced a wall cell. The claims under test are
 * that the wall is whole through it — the box is a box — and that moving the
 * box neither loses the head nor draws a second one.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { E, N, S, W, UNICODE } from '../src/core/charset/charsets.ts';
import { ck } from '../src/core/geom/cell.ts';
import { applyDiff, createGrid, maskOf, type Grid } from '../src/core/grid/grid.ts';
import { fromText, toText } from '../src/core/io/text.ts';
import { recognize, selectWithin, type Candidate } from '../src/core/recognize/recognize.ts';
import { candidatesAt, defaultIndex } from '../src/core/recognize/rank.ts';
import { findConnectors } from '../src/core/route/connectors.ts';
import { planMove } from '../src/core/ops/move.ts';
import { planResize } from '../src/core/ops/resize.ts';
import { planResizeTrack } from '../src/core/ops/lattice.ts';
import { useEditor } from '../src/app/state/store.ts';

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

function move(grid: Grid, selection: Candidate, dx: number, dy: number): void {
  applyDiff(grid, planMove(grid, selection, dx, dy, { charset: UNICODE }).diff);
}

/** The picture that prompted this: an arrow landed on the left wall of a box. */
const LANDED = [
  '             ┌────────────────────────┐',
  '             │                        │',
  '             │                        │',
  '             │                        │',
  '─────────────▶                        │',
  '             │                        │',
  '             │                        │',
  '             │                        │',
  '             │                        │',
  '             └────────────────────────┘',
].join('\n');

/** The same, small enough to draw expectations for. */
const SMALL = ['     ┌─────┐', '─────▶     │', '     └─────┘'].join('\n');

describe('the wall is whole through the head (B-CONN-07a)', () => {
  it('the head carries the wall arms as well as its tail', () => {
    const grid = gridFrom(LANDED);
    expect(maskOf(grid, 13, 4)).toBe(W | N | S);
  });

  it('so the box is a box from any cell of its wall, with the head in it', () => {
    const grid = gridFrom(LANDED);
    for (const [x, y] of [[13, 0], [20, 0], [13, 3], [38, 5], [25, 9]] as const) {
      const box = clicked(grid, x, y);
      expect(box.kind).toBe('box');
      expect(box.bounds).toEqual({ x: 13, y: 0, w: 26, h: 10 });
      expect(box.cells.has(ck(13, 4))).toBe(true);
    }
  });

  it('and the arrow is still the arrow, as a merged line is the strand into a box', () => {
    const grid = gridFrom(LANDED);
    const arrow = clicked(grid, 5, 4);
    expect(arrow.kind).toBe('arrow');
    expect(arrow.cells.size).toBe(14);
    // One component, like a line that merged into the wall as `┤` (B-REC-10c).
    expect(recognize(grid, 13, 0)?.cells.size).toBe(68 + 13);
  });

  it('the head itself reads as the box first, like the junction it stands in', () => {
    const grid = gridFrom(LANDED);
    expect(clicked(grid, 13, 4).kind).toBe('box');
  });

  it('works from above, a ▼ in the top wall', () => {
    const grid = gridFrom(['   │', '┌──▼──┐', '│     │', '└─────┘'].join('\n'));
    expect(maskOf(grid, 3, 1)).toBe(N | E | W);
    expect(clicked(grid, 0, 1).kind).toBe('box');
    expect(clicked(grid, 0, 1).bounds).toEqual({ x: 0, y: 1, w: 7, h: 3 });
  });

  it('and in ASCII, where the corners beside the head are ambiguous (B-CONN-04)', () => {
    // The `+` corners narrow to the neighbours that point back; the `>` has to
    // count as one, or the wall breaks on both sides of the head.
    const grid = gridFrom(['   +-----+', '--->     |', '   +-----+'].join('\n'));
    expect(clicked(grid, 3, 0).kind).toBe('box');
    expect(clicked(grid, 3, 0).bounds).toEqual({ x: 3, y: 0, w: 7, h: 3 });
    expect(clicked(grid, 0, 1).kind).toBe('arrow');
  });

  it('a head stopped one cell short is unchanged: two components, as drawn', () => {
    const grid = gridFrom(['     ┌─────┐', '────▶│     │', '     └─────┘'].join('\n'));
    expect(maskOf(grid, 4, 1)).toBe(W);
    expect(recognize(grid, 5, 0)?.cells.size).toBe(16);
    expect(clicked(grid, 5, 0).kind).toBe('box');
    expect(clicked(grid, 0, 1).kind).toBe('arrow');
  });

  it('a wall on one side only is the end of something, not a wall', () => {
    // The head has replaced a corner: `│` above it, nothing below.
    const grid = gridFrom(['  ┌─────┐', '  │     │', '──▶─────┘'].join('\n'));
    expect(maskOf(grid, 2, 2)).toBe(W);
    expect(clicked(grid, 2, 0).kind).not.toBe('box');
  });

  it('without a shaft the head is text, walls or no walls (B-CONN-07)', () => {
    const grid = gridFrom(['│', '▶', '│'].join('\n'));
    expect(maskOf(grid, 0, 1)).toBe(0);
    expect(recognize(grid, 0, 0)?.cells.size).toBe(1);
  });
});

describe('the head is the connector’s, not the wall’s (B-MAN-11g)', () => {
  it('the line into it is a headed connector, and remembers the wall cell', () => {
    const grid = gridFrom(LANDED);
    const found = findConnectors(grid, clicked(grid, 13, 0).cells);

    expect(found.length).toBe(1);
    expect(found[0]?.anchor).toEqual({ x: 12, y: 4 });
    expect(found[0]?.approach).toBe(E);
    expect(found[0]?.headed).toBe(true);
    expect(found[0]?.headInWall).toEqual({ x: 13, y: 4 });
  });

  it('moving the box redraws the arrow one cell short of a whole wall', () => {
    const grid = gridFrom(SMALL);
    move(grid, clicked(grid, 5, 0), 3, 0);

    expect(toText(grid)).toBe(['        ┌─────┐', '───────▶│     │', '        └─────┘'].join('\n'));
    expect(clicked(grid, 8, 0).kind).toBe('box');
  });

  it('and follows it round a corner, the head still aimed at the wall', () => {
    const grid = gridFrom(SMALL);
    move(grid, clicked(grid, 5, 0), 0, 2);

    expect(toText(grid)).toBe(['│', '│    ┌─────┐', '└───▶│     │', '     └─────┘'].join('\n'));
  });

  it('a marquee round the box carries the wall, not a second head', () => {
    const grid = gridFrom(SMALL);
    // A cell-set selection is translated glyph for glyph rather than redrawn,
    // which is exactly where a carried `▶` would end up beside the new one.
    const marquee = selectWithin(grid, { x: 5, y: 0, w: 7, h: 3 });
    if (marquee === null) throw new Error('nothing selected');
    move(grid, marquee, 3, 0);

    expect(toText(grid)).toBe(['        ┌─────┐', '───────▶│     │', '        └─────┘'].join('\n'));
  });

  it('resizing redraws the wall whole and keeps the arrow on it', () => {
    const grid = gridFrom(SMALL);
    const plan = planResize(grid, clicked(grid, 5, 0), { x: 5, y: 0, w: 10, h: 3 }, { charset: UNICODE });
    applyDiff(grid, plan.diff);

    expect(toText(grid)).toBe(['     ┌────────┐', '────▶│        │', '     └────────┘'].join('\n'));
  });

  it('when the head stands in the far wall, that wall is put back and the head redrawn', () => {
    const grid = gridFrom(['┌─────┐      ┌─────┐', '│  A  ├──────▶  B  │', '└─────┘      └─────┘'].join('\n'));
    const found = findConnectors(grid, clicked(grid, 0, 0).cells);
    expect(found[0]?.headedAtFree).toBe(true);
    expect(found[0]?.headInWallAtFree).toEqual({ x: 13, y: 1 });

    move(grid, clicked(grid, 0, 0), 0, 3);

    expect(toText(grid)).toBe(
      [
        '             ┌─────┐',
        '         ┌──▶│  B  │',
        '         │   └─────┘',
        '┌─────┐  │',
        '│  A  ├──┘',
        '└─────┘',
      ].join('\n'),
    );
    expect(clicked(grid, 13, 0).kind).toBe('box');
  });
});

describe('a table track shifted under the head (B-MAN-11g)', () => {
  it('carries the wall in the head’s place, and the head is redrawn once', () => {
    // An arrow landed on the right wall of a two-column table, and the first
    // column is widened: the wall shifts glyph for glyph, so the head would
    // have travelled with it and been drawn again beside it.
    const grid = gridFrom(['┌───┬───┐', '│   │   ◀────', '└───┴───┘'].join('\n'));
    const plan = planResizeTrack(grid, { x: 0, y: 0, w: 9, h: 3 }, 'column', 4, 2, {
      charset: UNICODE,
    });
    applyDiff(grid, plan.diff);

    expect(toText(grid)).toBe(['┌─────┬───┐', '│     │   │◀─', '└─────┴───┘'].join('\n'));
    // Drilling out from the corner still reaches the whole table, wall and all.
    expect(candidatesAt(grid, 0, 0).some((c) => c.kind === 'box' && c.bounds.w === 11)).toBe(true);
  });
});

describe('from the keyboard (B-SEL-19)', () => {
  beforeEach(() => {
    useEditor.getState().clearAll();
    useEditor.getState().setTool('select');
    useEditor.getState().setSelection(null);
    useEditor.getState().loadText(LANDED, 'landed.txt');
  });

  it('enter on the wall takes the box, and settles there', () => {
    const ed = useEditor.getState();
    ed.setCursor({ x: 13, y: 2 });

    ed.cycleShape();
    expect(useEditor.getState().selection?.kind).toBe('box');
    expect(useEditor.getState().selection?.bounds.w).toBe(26);
    ed.cycleShape();
    expect(useEditor.getState().selection?.kind).toBe('box');
  });

  it('enter on the shaft takes the arrow', () => {
    const ed = useEditor.getState();
    ed.setCursor({ x: 5, y: 4 });

    ed.cycleShape();
    expect(useEditor.getState().selection?.kind).toBe('arrow');
  });
});
