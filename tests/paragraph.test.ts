/**
 * A paragraph: loose text read as prose (B-SEL-19e).
 *
 * The claim under test is the cut itself — which words a flush left edge and a
 * one-blank gap join, and which they leave out — and then that `Enter` offers it
 * as the rung after the word, from the keyboard, and comes back round.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { ck } from '../src/core/geom/cell.ts';
import { applyDiff, createGrid, type Grid } from '../src/core/grid/grid.ts';
import { fromText, toText } from '../src/core/io/text.ts';
import { paragraphAt } from '../src/core/derive/paragraph.ts';
import { useEditor } from '../src/app/state/store.ts';

function gridFrom(art: string): Grid {
  const grid = createGrid();
  applyDiff(grid, fromText(art));
  return grid;
}

/** What the paragraph says, as the status bar and the clipboard would see it. */
function said(grid: Grid, x: number, y: number): string | null {
  const found = paragraphAt(grid, x, y);
  return found === null ? null : toText(grid, found.bounds, found.cells);
}

describe('the line through a word', () => {
  it('joins words one blank apart, and stops at two', () => {
    const grid = gridFrom('one two three  four');
    expect(said(grid, 5, 0)).toBe('one two three');
  });

  it('is the same line from any word in it', () => {
    const grid = gridFrom('one two three');
    expect(said(grid, 0, 0)).toBe(said(grid, 12, 0));
  });

  it('takes a dash between two thoughts, though the charset calls it a line', () => {
    const grid = gridFrom('first - second');
    expect(said(grid, 0, 0)).toBe('first - second');
  });

  it('and a longer stroke, an arrow, a plus', () => {
    expect(said(gridFrom('a --> b'), 0, 0)).toBe('a --> b');
    expect(said(gridFrom('a + b'), 0, 0)).toBe('a + b');
    expect(said(gridFrom('end --'), 0, 0)).toBe('end --');
  });

  it('but never a wall, however close it stands', () => {
    const grid = gridFrom(['┌───────────┐', '│ note here │', '└───────────┘'].join('\n'));
    const found = paragraphAt(grid, 2, 1);
    expect(found?.cells.size).toBe(8); // "note here", and not a cell of the box
    expect(found?.bounds).toEqual({ x: 2, y: 1, w: 9, h: 1 });
  });

  it('nor a wire, which belongs to whatever it runs into', () => {
    const grid = gridFrom(['      │', 'word ─┘'].join('\n'));
    expect(said(grid, 0, 1)).toBe('word');
  });

  it('is nothing on a blank, a wall, or a stroke with no words beside it', () => {
    expect(paragraphAt(gridFrom('word'), 9, 9)).toBeNull();
    expect(paragraphAt(gridFrom(['┌──┐', '│  │', '└──┘'].join('\n')), 0, 0)).toBeNull();
    expect(paragraphAt(gridFrom('-----'), 2, 0)).toBeNull();
  });
});

describe('the lines above and below', () => {
  it('join when their first character sits in the same column', () => {
    const grid = gridFrom(['  one two', '  three', '  four five'].join('\n'));
    expect(said(grid, 3, 1)).toBe(['one two', 'three', 'four five'].join('\n'));
  });

  it('whichever line was asked from', () => {
    const grid = gridFrom(['one', 'two', 'three'].join('\n'));
    expect(said(grid, 0, 0)).toBe(said(grid, 0, 2));
  });

  it('but an indented line is not the same paragraph', () => {
    const grid = gridFrom(['one two', '  three'].join('\n'));
    expect(said(grid, 0, 0)).toBe('one two');
    // Nor, from the indented line, is the flush one above it.
    expect(said(grid, 2, 1)).toBe('three');
  });

  it('nor one that starts further left', () => {
    const grid = gridFrom(['  one', 'two'].join('\n'));
    expect(said(grid, 2, 0)).toBe('one');
  });

  it('nor one across a blank row', () => {
    const grid = gridFrom(['one', '', 'two'].join('\n'));
    expect(said(grid, 0, 0)).toBe('one');
  });

  it('a line whose first word is one blank further left is not flush either', () => {
    // Row 1 reads `x two` as one line, so its left edge is 0, not 2.
    const grid = gridFrom(['  one', 'x two'].join('\n'));
    expect(said(grid, 2, 0)).toBe('one');
  });

  it('a rule drawn under a heading is not its second line', () => {
    const grid = gridFrom(['Heading', '───────', 'body text'].join('\n'));
    expect(said(grid, 0, 0)).toBe('Heading');
    expect(said(grid, 0, 2)).toBe('body text');
  });

  it('inside a box, the label lines that are flush are the paragraph', () => {
    const grid = gridFrom([
      '┌────────────┐',
      '│ note here  │',
      '│ more text  │',
      '└────────────┘',
    ].join('\n'));
    expect(said(grid, 2, 1)).toBe(['note here', 'more text'].join('\n'));
  });

  it('two paragraphs side by side stay apart', () => {
    const grid = gridFrom(['left one    right one', 'left two    right two'].join('\n'));
    expect(said(grid, 0, 0)).toBe(['left one', 'left two'].join('\n'));
    expect(said(grid, 12, 0)).toBe(['right one', 'right two'].join('\n'));
  });
});

describe('enter on a word takes its paragraph, and again comes back (B-SEL-19e)', () => {
  beforeEach(() => {
    useEditor.getState().clearAll();
    useEditor.getState().setTool('select');
    useEditor.getState().setSelection(null);
    useEditor.getState().loadText(['one - two', 'three', '', 'four'].join('\n'), 'prose.txt');
  });

  function selected(): string {
    const { grid, selection } = useEditor.getState();
    return selection === null ? '' : toText(grid, selection.bounds, selection.cells);
  }

  it('word, paragraph, word', () => {
    const ed = useEditor.getState();
    ed.setCursor({ x: 7, y: 0 }); // on "two"

    ed.cycleShape();
    expect(useEditor.getState().selection?.kind).toBe('text');
    expect(selected()).toBe('two');

    ed.cycleShape();
    expect(useEditor.getState().selection?.kind).toBe('text');
    expect(selected()).toBe(['one - two', 'three'].join('\n'));
    // The paragraph beyond the blank row is another paragraph.
    expect(useEditor.getState().selection?.cells.has(ck(0, 3))).toBe(false);

    ed.cycleShape();
    expect(selected()).toBe('two');
  });

  it('from the dash, the same ladder', () => {
    const ed = useEditor.getState();
    ed.setCursor({ x: 4, y: 0 });

    ed.cycleShape();
    expect(selected()).toBe('-');
    ed.cycleShape();
    expect(selected()).toBe(['one - two', 'three'].join('\n'));
  });

  it('a lone word is its own paragraph, so enter settles on it', () => {
    const ed = useEditor.getState();
    ed.setCursor({ x: 0, y: 3 }); // "four"

    ed.cycleShape();
    expect(selected()).toBe('four');
    ed.cycleShape();
    expect(selected()).toBe('four');
  });

  it('touches nothing in the document', () => {
    const ed = useEditor.getState();
    const before = ed.text();
    ed.setCursor({ x: 0, y: 0 });
    for (let i = 0; i < 3; i++) ed.cycleShape();
    expect(useEditor.getState().text()).toBe(before);
  });
});
