/**
 * Links (B-CONN-08): the connections a diagonal makes, which the four-arm
 * model cannot express — and, just as much, the ones it must not make.
 */

import { describe, expect, it } from 'vitest';
import { UNICODE } from '../src/core/charset/charsets.ts';
import { applyDiff, createGrid, type Grid } from '../src/core/grid/grid.ts';
import { linked } from '../src/core/grid/links.ts';
import { fromText } from '../src/core/io/text.ts';
import { stampBox } from '../src/core/stamp/box.ts';
import { stampStroke } from '../src/core/stamp/freehand.ts';
import { recognize } from '../src/core/recognize/recognize.ts';
import { trace } from '../src/core/recognize/trace.ts';

const at = (x: number, y: number): { x: number; y: number } => ({ x, y });

function gridFrom(art: string[]): Grid {
  const grid = createGrid();
  applyDiff(grid, fromText(art.join('\n')));
  return grid;
}

describe('what a diagonal joins', () => {
  it('a slash joins the slash beyond the corner it leans toward', () => {
    const grid = gridFrom(['  /', ' /', '/']);
    expect(linked(grid, at(0, 2), at(1, 1))).toBe(true);
    expect(trace(grid, 0, 2).cells.size).toBe(3);
  });

  it('but not one leaning the other way across that corner', () => {
    const grid = gridFrom(['\\', ' /']);
    expect(linked(grid, at(0, 0), at(1, 1))).toBe(false);
  });

  it('a bend joins the slash it turns into', () => {
    const grid = gridFrom(['──╮', '   \\']);
    expect(linked(grid, at(2, 0), at(3, 1))).toBe(true);
    expect(trace(grid, 0, 0).cells.size).toBe(4);
  });

  it('and so does an ASCII dot, which is otherwise only a full stop', () => {
    const grid = gridFrom(['--.', '   \\']);
    expect(trace(grid, 0, 0).cells.size).toBe(4);
  });

  it('a slash stands on the loose end of a vertical line', () => {
    const grid = gridFrom([' \\', '  \\', '  │']);
    expect(linked(grid, at(2, 1), at(2, 2))).toBe(true);
  });

  it('two slashes leaning apart meet at their shared corner', () => {
    expect(trace(gridFrom(['/\\']), 0, 0).cells.size).toBe(2);
    expect(trace(gridFrom(['/', '\\']), 0, 0).cells.size).toBe(2);
  });
});

describe('what it must not join', () => {
  it('a slash in a sentence is still text', () => {
    const grid = gridFrom(['either/or']);
    expect(trace(grid, 6, 0).cells.size).toBe(0);
    expect(recognize(grid, 6, 0)?.kind).toBe('text');
  });

  it('a full stop after a dash is still text', () => {
    const grid = gridFrom(['wait--.']);
    expect(trace(grid, 6, 0).cells.size).toBe(0);
  });

  it('a slash beside a box corner leaves the box a box', () => {
    const grid = createGrid();
    applyDiff(grid, stampBox(grid, { x: 1, y: 1, w: 5, h: 3 }, UNICODE));
    applyDiff(grid, fromText('\\', 0, 0));
    applyDiff(grid, fromText('/', 6, 0));
    expect(recognize(grid, 3, 1)?.kind).toBe('box');
  });

  it('two straight lines ending near each other stay two lines', () => {
    const grid = gridFrom(['│', '│', ' │', ' │']);
    expect(linked(grid, at(0, 1), at(1, 2))).toBe(false);
    expect(trace(grid, 0, 0).cells.size).toBe(2);
  });
});

describe('a freehand stroke with diagonals is one thing', () => {
  it('traces whole, bends and slashes included', () => {
    const grid = createGrid();
    applyDiff(grid, stampStroke(grid, [at(0, 0), at(3, 0), at(5, 2), at(9, 2)], UNICODE));
    expect(trace(grid, 0, 0).cells.size).toBe(10);
  });

  it('a point facing sideways is drawn round, not as a slash leaning the wrong way', () => {
    const grid = createGrid();
    applyDiff(grid, stampStroke(grid, [at(2, 0), at(0, 2), at(2, 4)], UNICODE));
    expect(grid.get('0,2')).toBe('│');
    expect(trace(grid, 2, 0).cells.size).toBe(5);
  });

  it('and a peak is flat on top', () => {
    const grid = createGrid();
    applyDiff(grid, stampStroke(grid, [at(0, 2), at(2, 0), at(4, 2)], UNICODE));
    expect(grid.get('2,0')).toBe('─');
    expect(trace(grid, 0, 2).cells.size).toBe(5);
  });
});
