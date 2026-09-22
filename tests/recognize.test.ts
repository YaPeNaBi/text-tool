import { describe, expect, it } from 'vitest';
import { UNICODE } from '../src/core/charset/charsets.ts';
import { ck } from '../src/core/geom/cell.ts';
import { applyDiff, createGrid, type Grid } from '../src/core/grid/grid.ts';
import { fromText } from '../src/core/io/text.ts';
import { recognize, selectWithin } from '../src/core/recognize/recognize.ts';
import { stampBox } from '../src/core/stamp/box.ts';
import { trace } from '../src/core/recognize/trace.ts';
import { segmentize } from '../src/core/recognize/segmentize.ts';

function gridFrom(art: string): Grid {
  const grid = createGrid();
  applyDiff(grid, fromText(art));
  return grid;
}

describe('recognize', () => {
  it('recovers a drawn box', () => {
    const grid = createGrid();
    applyDiff(grid, stampBox(grid, { x: 2, y: 1, w: 5, h: 4 }, UNICODE));

    const found = recognize(grid, 2, 1);
    expect(found?.kind).toBe('box');
    expect(found?.bounds).toEqual({ x: 2, y: 1, w: 5, h: 4 });
  });

  it('recovers a box from pasted Unicode art it never drew (B-REC-02)', () => {
    const grid = gridFrom(['┌──┐', '│  │', '└──┘'].join('\n'));

    const found = recognize(grid, 0, 0);
    expect(found?.kind).toBe('box');
    expect(found?.bounds).toEqual({ x: 0, y: 0, w: 4, h: 3 });
  });

  it('recovers a box from pasted ASCII art, ambiguous corners and all (B-CONN-04)', () => {
    const grid = gridFrom(['+--+', '|  |', '+--+'].join('\n'));

    const found = recognize(grid, 2, 0);
    expect(found?.kind).toBe('box');
    expect(found?.bounds).toEqual({ x: 0, y: 0, w: 4, h: 3 });
    expect(found?.cells.size).toBe(10);
  });

  it('is seeded anywhere on the shape, not just a corner', () => {
    const grid = gridFrom(['┌──┐', '│  │', '└──┘'].join('\n'));

    for (const [x, y] of [[0, 0], [2, 0], [3, 1], [1, 2]] as const) {
      expect(recognize(grid, x, y)?.kind).toBe('box');
    }
  });

  it('returns nothing for an empty cell (B-REC-07)', () => {
    const grid = gridFrom(['┌──┐', '│ab│', '└──┘'].join('\n'));
    expect(recognize(grid, 9, 9)).toBeNull();
  });

  it('selects the text run around a text cell (B-REC-07)', () => {
    const grid = gridFrom(['┌────┐', '│ ab │', '└────┘'].join('\n'));

    const found = recognize(grid, 2, 1);
    expect(found?.kind).toBe('text');
    expect(found?.bounds).toEqual({ x: 2, y: 1, w: 2, h: 1 });
  });

  it('stops a text run at the border it sits inside', () => {
    const grid = gridFrom(['┌──┐', '│ab│', '└──┘'].join('\n'));

    const found = recognize(grid, 1, 1);
    expect(found?.kind).toBe('text');
    expect(found?.cells.size).toBe(2);
  });

  it('reads an unclosed rectangle as the open path it actually is (B-REC-08)', () => {
    const grid = gridFrom(['┌──┐', '│  │'].join('\n'));

    const found = recognize(grid, 0, 0);
    expect(found?.kind).toBe('line');
    expect(found?.cells.size).toBe(6);
  });

  it('falls back to a cell set when the shape branches (B-REC-06)', () => {
    // A T: three loose ends meeting at a junction is neither a box nor a path.
    const grid = gridFrom(['──┬──', '  │  '].join('\n'));

    const found = recognize(grid, 0, 0);
    expect(found?.kind).toBe('cells');
    expect(found?.cells.size).toBe(6);
  });

  it('treats edge-sharing boxes as one component in v0 (B-REC-12)', () => {
    const grid = createGrid();
    applyDiff(grid, stampBox(grid, { x: 0, y: 0, w: 4, h: 3 }, UNICODE));
    applyDiff(grid, stampBox(grid, { x: 3, y: 0, w: 4, h: 3 }, UNICODE));

    const found = recognize(grid, 0, 0);
    expect(found?.kind).toBe('cells');
    expect(found?.bounds).toEqual({ x: 0, y: 0, w: 7, h: 3 });
  });

  it('keeps separate shapes separate', () => {
    const grid = createGrid();
    applyDiff(grid, stampBox(grid, { x: 0, y: 0, w: 4, h: 3 }, UNICODE));
    applyDiff(grid, stampBox(grid, { x: 8, y: 0, w: 4, h: 3 }, UNICODE));

    expect(recognize(grid, 0, 0)?.bounds).toEqual({ x: 0, y: 0, w: 4, h: 3 });
    expect(recognize(grid, 8, 0)?.bounds).toEqual({ x: 8, y: 0, w: 4, h: 3 });
  });
});

describe('recognize paths and arrows', () => {
  it('recognises a straight line (B-REC-08)', () => {
    const grid = gridFrom('─────');

    const found = recognize(grid, 2, 0);
    expect(found?.kind).toBe('line');
    expect(found?.cells.size).toBe(5);
  });

  it('recognises an elbowed polyline', () => {
    const grid = gridFrom(['──┐', '  │', '  └──'].join('\n'));

    const found = recognize(grid, 0, 0);
    expect(found?.kind).toBe('line');
    expect(found?.cells.size).toBe(7);
  });

  it('promotes a path with an arrowhead to an arrow (B-REC-08)', () => {
    const grid = gridFrom('───▶');

    const found = recognize(grid, 0, 0);
    expect(found?.kind).toBe('arrow');
    expect(found?.cells.size).toBe(4);
  });

  it('recognises an ASCII arrow the same way', () => {
    const grid = gridFrom('--->');

    const found = recognize(grid, 0, 0);
    expect(found?.kind).toBe('arrow');
    expect(found?.cells.size).toBe(4);
  });

  it('does not mistake a v inside a word for an arrowhead (B-CONN-06)', () => {
    const grid = gridFrom('level');

    // Traced as text, not as a line: no shaft is behind it.
    expect(recognize(grid, 2, 0)?.kind).toBe('text');
    expect(recognize(grid, 2, 0)?.cells.size).toBe(5);
  });

  it('ignores an arrowhead with nothing behind it', () => {
    const grid = gridFrom('  >  ');
    expect(recognize(grid, 2, 0)?.kind).toBe('text');
  });
});

describe('segmentize', () => {
  it('collapses a box into four corners and four runs (B-REC-09)', () => {
    const grid = gridFrom(['┌───┐', '│   │', '└───┘'].join('\n'));
    const graph = segmentize(grid, trace(grid, 0, 0).cells);

    expect(graph.nodes.size).toBe(4);
    expect(graph.runs.length).toBe(4);
  });

  it('puts a node at every corner of a polyline', () => {
    const grid = gridFrom(['──┐', '  │', '  └──'].join('\n'));
    const graph = segmentize(grid, trace(grid, 0, 0).cells);

    // two loose ends plus two corners
    expect(graph.nodes.size).toBe(4);
    expect(graph.runs.length).toBe(3);
  });

  it('marks a junction as a node with degree three', () => {
    const grid = gridFrom(['──┬──', '  │  '].join('\n'));
    const graph = segmentize(grid, trace(grid, 0, 0).cells);

    expect(graph.degree.get(ck(2, 0))).toBe(3);
    expect(graph.runs.length).toBe(3);
  });
});

describe('trace', () => {
  it('requires both cells to agree before connecting (B-CONN-03)', () => {
    const grid = createGrid();
    applyDiff(
      grid,
      new Map([
        [ck(0, 0), '─'],
        [ck(1, 0), '│'],
      ]),
    );

    expect(trace(grid, 0, 0).cells.size).toBe(1);
  });

  it('does not trace through text (B-CONN-06)', () => {
    const grid = gridFrom('──X──');
    expect(trace(grid, 0, 0).cells.size).toBe(2);
  });
});

describe('selectWithin', () => {
  it('collects every non-empty cell in the region (B-SEL-03)', () => {
    const grid = gridFrom(['┌──┐', '│ab│', '└──┘'].join('\n'));

    const found = selectWithin(grid, { x: 0, y: 0, w: 4, h: 2 });
    expect(found?.kind).toBe('cells');
    expect(found?.cells.size).toBe(8);
  });

  it('returns nothing for an empty region', () => {
    const grid = gridFrom('┌──┐');
    expect(selectWithin(grid, { x: 20, y: 20, w: 3, h: 3 })).toBeNull();
  });
});
