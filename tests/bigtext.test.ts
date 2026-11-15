/**
 * Editing big text (B-FONT-06 … B-FONT-09).
 *
 * Four claims, each pinned: a banner has a caret that moves through its letters
 * and that typing, deleting and clicking respect; big text climbs its own ladder
 * of word, line and block; a banner can be set in another font or turned back
 * into ordinary characters from what it *says*; and the Lines font draws every
 * character out of strokes and reads every one of them back.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { boundsOf, ck, unck } from '../src/core/geom/cell.ts';
import { applyDiff, createGrid, type Grid } from '../src/core/grid/grid.ts';
import { fromText } from '../src/core/io/text.ts';
import {
  BANNER_STYLES,
  caretAt,
  caretCell,
  isArt,
  renderBanner,
  spansOf,
  styleFor,
  typedAt,
  type ArtStyle,
  type BannerStyle,
} from '../src/core/text/banner.ts';
import { readBanner, readBannerBlock, readBannerWord } from '../src/core/text/unbanner.ts';
import { recognize } from '../src/core/recognize/recognize.ts';
import { isGroup, menuFor, useEditor } from '../src/app/state/store.ts';

/** A font by id, or the test is wrong about the fonts and should say so. */
function font(id: string): BannerStyle {
  const style = styleFor(id);
  if (style === undefined) throw new Error(`no font ${id}`);
  return style;
}

const block = font('block');
const linesStyle = font('lines');
if (!isArt(linesStyle)) throw new Error('Lines is not an art font');
const lines: ArtStyle = linesStyle;

function gridFrom(art: string): Grid {
  const grid = createGrid();
  applyDiff(grid, fromText(art));
  return grid;
}

function reset(): void {
  useEditor.setState({ charsetId: 'unicode', notice: null, menuOpen: false, menuPreview: null, menuPath: [0] });
  useEditor.getState().clearAll();
  useEditor.getState().setTool('select');
  useEditor.getState().setCursor({ x: 0, y: 0 });
}

/** Big text on the page, selected: all of `text` set in Block at the origin. */
function bigText(text: string): void {
  reset();
  useEditor.getState().loadText(text, 'x.txt');
  const cells = new Set(useEditor.getState().grid.keys());
  const bounds = boundsOf(cells);
  if (bounds === null) throw new Error('nothing to set');
  useEditor.getState().setSelection({ kind: 'text', cells, bounds });
  useEditor.getState().setFont('block');
}

const said = (): string | undefined => useEditor.getState().selection?.banner?.text;
const caret = (): number | undefined => useEditor.getState().bannerEdit?.caret;
const type = (s: string): void => {
  for (const ch of s) useEditor.getState().bannerKey(ch);
};

describe('the fonts on offer', () => {
  it('are block, shade, wide, half, shadow and lines — the ASCII pair are gone', () => {
    expect(BANNER_STYLES.map((s) => s.id)).toEqual(['block', 'shade', 'wide', 'half', 'shadow', 'lines']);
  });
});

describe('the Lines font (B-FONT-09)', () => {
  it('draws letters from strokes, five rows tall', () => {
    const rows = renderBanner('HI', lines);
    expect(rows).toEqual(['│ │ ─┬─', '│ │  │', '├─┤  │', '│ │  │', '│ │ ─┴─']);
  });

  it('has a distinct, even picture for every character', () => {
    const seen = new Map<string, string>();
    for (const [ch, rows] of Object.entries(lines.art)) {
      expect(rows.length, ch).toBe(lines.height);
      expect(new Set(rows.map((r) => r.length)).size, ch).toBe(1);
      const key = rows.join('/');
      expect(seen.has(key), `${ch} looks like ${seen.get(key) ?? ''}`).toBe(false);
      seen.set(key, ch);
    }
  });

  it('reads every character back, alone and between letters, from every cell', () => {
    for (const ch of Object.keys(lines.art)) {
      // A lone dash and a lone underscore are the same cells on different rows,
      // so alone they are one reading (the dash); beside letters each is itself.
      const texts = ch === '_' ? ['A_B'] : [ch, `A${ch}B`];
      for (const text of texts) {
        const grid = gridFrom(renderBanner(text, lines).join('\n'));
        for (const key of grid.keys()) {
          const { x, y } = unck(key);
          expect(readBanner(grid, { x, y })?.text, `${text} at ${x},${y}`).toBe(text.replace(/ +$/, ''));
        }
      }
    }
  });

  it('a single letter that is also a small box reads as the box; a word does not', () => {
    const o = gridFrom(renderBanner('O', lines).join('\n'));
    expect(recognize(o, 0, 0)?.kind).toBe('box');

    const ok = gridFrom(renderBanner('OK', lines).join('\n'));
    expect(recognize(ok, 0, 0)?.kind).toBe('banner');
    expect(recognize(ok, 0, 0)?.banner?.text).toBe('OK');
  });
});

describe('a caret through the big letters (B-FONT-06)', () => {
  it('t puts the caret at the letter under the keyboard, and the bar is as tall as the font', () => {
    bigText('HI');
    // The `I` begins at column 5: H is four wide, plus a tracking column.
    expect(spansOf('HI', block)[1]).toEqual({ from: 5, to: 7 });
    useEditor.getState().setCursor({ x: 5, y: 2 });
    useEditor.getState().setTool('text');

    expect(useEditor.getState().typingBanner()).toBe(true);
    expect(caret()).toBe(1);
    expect(useEditor.getState().caret).toEqual({ x: 5, y: 0 });
    expect(useEditor.getState().caretRows()).toBe(block.height);
  });

  it('…and at the end when the keyboard is off the letters', () => {
    bigText('HI');
    useEditor.getState().setCursor({ x: 20, y: 9 });
    useEditor.getState().setTool('text');
    expect(caret()).toBe(2);
    expect(useEditor.getState().caret).toEqual({ x: 8, y: 0 }); // one past the I
  });

  it('types where the caret is, not at the end', () => {
    bigText('HI');
    useEditor.getState().setCursor({ x: 5, y: 0 });
    useEditor.getState().setTool('text');
    type('X');
    expect(said()).toBe('HXI');
    expect(caret()).toBe(2);
    expect(useEditor.getState().text()).toBe(renderBanner('HXI', block).join('\n'));
  });

  it('moves with the arrows, Home and End, and stops at the ends', () => {
    bigText('HI');
    useEditor.getState().setCursor({ x: 20, y: 9 });
    useEditor.getState().setTool('text');
    expect(caret()).toBe(2);

    useEditor.getState().moveBannerCaret(-1, 0);
    expect(caret()).toBe(1);
    useEditor.getState().bannerCaretTo('home');
    expect(caret()).toBe(0);
    useEditor.getState().moveBannerCaret(-1, 0);
    expect(caret()).toBe(0);
    useEditor.getState().bannerCaretTo('end');
    expect(caret()).toBe(2);
    useEditor.getState().moveBannerCaret(1, 0);
    expect(caret()).toBe(2);
  });

  it('backspace takes the letter before the caret, delete the one after', () => {
    bigText('HI');
    useEditor.getState().setCursor({ x: 5, y: 0 }); // before the I
    useEditor.getState().setTool('text');

    useEditor.getState().bannerKey('Delete');
    expect(said()).toBe('H');
    type('I');
    useEditor.getState().moveBannerCaret(-1, 0);
    useEditor.getState().bannerKey('Backspace');
    expect(said()).toBe('I');
    expect(caret()).toBe(0);
    // Nothing before the caret: nothing happens, and nothing is drawn.
    const before = useEditor.getState().text();
    useEditor.getState().bannerKey('Backspace');
    expect(useEditor.getState().text()).toBe(before);
  });

  it('enter in the middle splits the line, and up and down cross between lines', () => {
    bigText('HI');
    useEditor.getState().setCursor({ x: 5, y: 0 });
    useEditor.getState().setTool('text');
    useEditor.getState().bannerKey('Enter');
    expect(said()).toBe('H\nI');
    expect(caret()).toBe(2);
    // The caret stands at the start of the second line, a font-height and a
    // leading row down.
    expect(useEditor.getState().caret).toEqual({ x: 0, y: block.height + 1 });

    useEditor.getState().moveBannerCaret(0, -1);
    expect(caret()).toBe(0);
    useEditor.getState().moveBannerCaret(0, 1);
    expect(caret()).toBe(2);
  });

  it('a click lands the caret on the letter clicked, or drops the letters when it misses', () => {
    bigText('HI');
    useEditor.getState().setTool('text');
    useEditor.getState().placeCaret({ x: 6, y: 3 }); // on the I, left half
    expect(caret()).toBe(1);
    useEditor.getState().placeCaret({ x: 3, y: 1 }); // right half of the H
    expect(caret()).toBe(1);
    useEditor.getState().placeCaret({ x: 0, y: 1 });
    expect(caret()).toBe(0);

    useEditor.getState().placeCaret({ x: 30, y: 30 });
    expect(useEditor.getState().typingBanner()).toBe(false);
    expect(useEditor.getState().selection).toBeNull();
    expect(useEditor.getState().caret).toEqual({ x: 30, y: 30 });
  });

  it('a word selected from the ladder is edited as its whole block', () => {
    bigText('HI YOU');
    useEditor.getState().setCursor({ x: 14, y: 2 }); // the stem of the Y, which begins at column 12
    useEditor.getState().setTool('select');
    useEditor.getState().setSelection(null);
    useEditor.getState().cycleShape();
    expect(said()).toBe('YOU');

    useEditor.getState().setTool('text');
    expect(said()).toBe('HI YOU'); // the block, with the caret where the Y begins
    expect(caret()).toBe(3);
    type('!');
    expect(said()).toBe('HI !YOU');
  });

  it('the pure layout: caret cells and the click that finds them agree', () => {
    const origin = { x: 2, y: 1 };
    for (const text of ['HI', 'HI YOU', 'A\nBC']) {
      const n = [...text].length;
      for (let i = 0; i <= n; i++) {
        const cell = caretCell(origin, text, i, block);
        // A click on the caret's own cell is a click on the left edge of the
        // letter after it, which is where that caret goes.
        if (i < n && [...text][i] !== '\n') expect(caretAt(origin, text, block, cell)).toBe(i);
      }
    }
  });

  it('typedAt is an ordinary text field', () => {
    expect(typedAt('HI', 1, 'X')).toEqual({ text: 'HXI', caret: 2 });
    expect(typedAt('HI', 1, 'Backspace')).toEqual({ text: 'I', caret: 0 });
    expect(typedAt('HI', 1, 'Delete')).toEqual({ text: 'H', caret: 1 });
    expect(typedAt('HI', 0, 'Backspace')).toBeNull();
    expect(typedAt('HI', 2, 'Delete')).toBeNull();
    expect(typedAt('HI', 2, 'Enter')).toEqual({ text: 'HI\n', caret: 3 });
  });
});

describe('the ladder for big text (B-FONT-07)', () => {
  function twoLines(): void {
    reset();
    const rows = [...renderBanner('HI YOU', block), '', ...renderBanner('OK', block)];
    useEditor.getState().loadText(rows.join('\n'), 'big.txt');
  }

  it('reads a word, a line and a block', () => {
    twoLines();
    const grid = useEditor.getState().grid;
    expect(readBannerWord(grid, { x: 14, y: 2 })?.text).toBe('YOU');
    expect(readBanner(grid, { x: 14, y: 2 })?.text).toBe('HI YOU');
    expect(readBannerBlock(grid, { x: 14, y: 2 })?.text).toBe('HI YOU\nOK');
    expect(readBannerBlock(grid, { x: 0, y: 7 })?.origin).toEqual({ x: 0, y: 0 });
  });

  it('enter climbs word, line, block, and comes back round', () => {
    twoLines();
    useEditor.getState().setCursor({ x: 14, y: 2 });

    useEditor.getState().cycleShape();
    expect(said()).toBe('YOU');
    useEditor.getState().cycleShape();
    expect(said()).toBe('HI YOU');
    useEditor.getState().cycleShape();
    expect(said()).toBe('HI YOU\nOK');
    useEditor.getState().cycleShape();
    expect(said()).toBe('YOU');
  });

  it('a click takes the line, and enter then widens to the block', () => {
    twoLines();
    useEditor.getState().selectAt({ x: 14, y: 2 });
    expect(said()).toBe('HI YOU');
    useEditor.getState().cycleShape();
    expect(said()).toBe('HI YOU\nOK');
  });

  it('a lone word is one rung, so enter settles on it', () => {
    bigText('HI');
    useEditor.getState().setSelection(null);
    useEditor.getState().cycleShape();
    expect(said()).toBe('HI');
    useEditor.getState().cycleShape();
    expect(said()).toBe('HI');
  });
});

describe('fonts on big text, and the way back (B-FONT-08)', () => {
  it('the menu over a banner offers Regular, then every font', () => {
    bigText('HI');
    const items = menuFor(useEditor.getState());
    expect(items.map((i) => i.label)).toEqual(['Font']);
    const font = items[0];
    if (font === undefined || !isGroup(font)) throw new Error('Font is not a group');
    expect(font.items.map((i) => i.label)).toEqual(['Regular', 'Block', 'Shade', 'Wide', 'Half', 'Shadow', 'Lines']);
    const regular = font.items[0];
    if (regular === undefined || isGroup(regular)) throw new Error('Regular is not an item');
    expect(regular.preview?.(useEditor.getState())?.get(ck(0, 0))).toBe('H');
  });

  it('…and only the fonts over small text', () => {
    reset();
    useEditor.getState().loadText('HI', 'x.txt');
    useEditor.getState().selectAt({ x: 0, y: 0 });
    const font = menuFor(useEditor.getState())[0];
    if (font === undefined || !isGroup(font)) throw new Error('Font is not a group');
    expect(font.items.map((i) => i.label)).toEqual(['Block', 'Shade', 'Wide', 'Half', 'Shadow', 'Lines']);
  });

  it('Regular turns the letters back into the words they say, where they stood', () => {
    bigText('HI YOU');
    useEditor.getState().unsetFont();
    expect(useEditor.getState().text()).toBe('HI YOU');
    expect(useEditor.getState().selection?.kind).toBe('text');
    useEditor.getState().undo();
    expect(useEditor.getState().text()).toBe(renderBanner('HI YOU', block).join('\n'));
  });

  it('a font chosen over a banner re-renders its words, not its picture', () => {
    bigText('HI');
    useEditor.getState().setFont('lines');
    expect(useEditor.getState().text()).toBe(renderBanner('HI', lines).join('\n'));
    expect(said()).toBe('HI');
    expect(useEditor.getState().selection?.banner?.styleId).toBe('lines');
  });

  it('both act on the whole block, whichever line is selected', () => {
    reset();
    const rows = [...renderBanner('HI', block), '', ...renderBanner('OK', block)];
    useEditor.getState().loadText(rows.join('\n'), 'big.txt');
    useEditor.getState().selectAt({ x: 0, y: 7 }); // the second line
    useEditor.getState().unsetFont();
    expect(useEditor.getState().text()).toBe('HI\nOK');
  });
});

describe('what the keyboard does not lose (B-FONT-05)', () => {
  beforeEach(() => bigText('HI'));

  it('keeps a trailing space and the caret after it', () => {
    useEditor.getState().setCursor({ x: 20, y: 9 });
    useEditor.getState().setTool('text');
    type(' ');
    expect(useEditor.getState().bannerEdit).toEqual({ at: ck(0, 0), text: 'HI ', caret: 3 });
    type('X');
    expect(said()).toBe('HI X');
  });

  it('forgets the caret with the text when the grid changes another way', () => {
    useEditor.getState().setTool('text');
    type('!');
    useEditor.getState().undo();
    expect(useEditor.getState().bannerEdit).toBeNull();
  });
});
