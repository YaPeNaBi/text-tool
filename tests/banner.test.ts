/**
 * Huge letters, the menu that offers them, and the window that fits the menu.
 *
 * The font feature is three separable things and they are tested as three: an
 * alphabet rendered several ways, a planner that swaps text for that rendering,
 * and a menu that can show more options than it has room for. Only the last is
 * about fonts by accident — `windowOf` is the first thing in this editor with
 * more than a handful of choices, and it is the reason the limit exists.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { BANNER_STYLES, renderBanner, styleFor } from '../src/core/text/banner.ts';
import { planBanner } from '../src/core/ops/banner.ts';
import { createGrid, applyDiff, type Grid } from '../src/core/grid/grid.ts';
import { readBanner } from '../src/core/text/unbanner.ts';
import { describe as describeCandidate } from '../src/core/recognize/recognize.ts';
import { fromText, toText } from '../src/core/io/text.ts';
import { boundsOf, ck, unck } from '../src/core/geom/cell.ts';
import {
  MENU_WINDOW,
  isGroup,
  menuClear,
  menuFor,
  useEditor,
  windowOf,
  type MenuNode,
} from '../src/app/state/store.ts';

function reset(): void {
  // `menuPath` too: `openMenu` deliberately restores where the highlight was
  // (B-UI-13), so a path left deep inside a group by the previous test would
  // make the next `activateMenu` *run* an item instead of opening the group.
  useEditor.setState({
    charsetId: 'unicode',
    notice: null,
    menuOpen: false,
    menuPreview: null,
    menuPath: [0],
  });
  useEditor.getState().clearAll();
  useEditor.getState().setTool('select');
  useEditor.getState().setCursor({ x: 0, y: 0 });
}

describe('the banner alphabet', () => {
  it('renders five rows, from one bitmap, in every style', () => {
    // The whole point of a bitmap plus styles: the letter shapes cannot drift
    // between fonts, because there is only one set of them.
    for (const style of BANNER_STYLES) {
      const rows = renderBanner('A', style);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.join('')).not.toBe('');
    }
  });

  it('folds lower case to upper, banner alphabets having one case', () => {
    const style = styleFor('hash');
    expect(style).toBeDefined();
    if (style === undefined) return;
    expect(renderBanner('abc', style)).toEqual(renderBanner('ABC', style));
  });

  it('gives a character it has no glyph for a visible box, not nothing', () => {
    const style = styleFor('hash');
    if (style === undefined) return;
    // Silently dropping it would read as the editor losing a keystroke.
    expect(renderBanner('§', style).join('\n')).toContain('#');
  });

  it('is not all the same height: Half is shorter and Shadow is taller', () => {
    const block = styleFor('block');
    const half = styleFor('half');
    const shadow = styleFor('shadow');
    if (block === undefined || half === undefined || shadow === undefined) return;

    expect(renderBanner('X', half).length).toBeLessThan(renderBanner('X', block).length);
    expect(renderBanner('X', shadow).length).toBeGreaterThan(renderBanner('X', block).length);
  });

  it('right-trims, so no row lands as invisible occluding spaces', () => {
    const style = styleFor('block');
    if (style === undefined) return;
    for (const row of renderBanner('HI', style)) expect(row).toBe(row.replace(/\s+$/, ''));
  });
});

describe('setting text in a font', () => {
  const textAt = (art: string) => {
    const grid = createGrid();
    applyDiff(grid, fromText(art));
    const cells = new Set(grid.keys());
    const bounds = boundsOf(cells);
    if (bounds === null) throw new Error('empty');
    return { grid, selection: { kind: 'text' as const, cells, bounds } };
  };

  it('replaces the text with its picture, at the same corner', () => {
    const { grid, selection } = textAt('HI');
    const style = styleFor('hash');
    if (style === undefined) return;

    const plan = planBanner(grid, selection, style);
    applyDiff(grid, plan.diff);

    const out = toText(grid);
    expect(out.split('\n').length).toBe(5);
    expect(out).toContain('#');
    // The old characters are gone, not left as debris inside the new letters.
    expect(out).not.toContain('HI');
  });

  it('takes the old cells out even where the new letters miss them', () => {
    // `I` is narrow; the cells of a wider original must not survive beside it.
    const { grid, selection } = textAt('I');
    const style = styleFor('hash');
    if (style === undefined) return;
    const plan = planBanner(grid, selection, style);
    for (const key of selection.cells) expect(plan.diff.has(key)).toBe(true);
  });

  it('refuses a selection with no letters in it rather than doing nothing', () => {
    const grid = createGrid();
    grid.set(ck(0, 0), ' ');
    const cells = new Set([ck(0, 0)]);
    const style = styleFor('hash');
    if (style === undefined) return;

    const plan = planBanner(grid, { kind: 'text', cells, bounds: { x: 0, y: 0, w: 1, h: 1 } }, style);
    expect(plan.refused ?? '').not.toBe('');
    expect(plan.diff.size).toBe(0);
  });

  it('is one diff, and so one undo step', () => {
    reset();
    useEditor.getState().loadText('HELLO', 'x.txt');
    useEditor.getState().selectAt({ x: 0, y: 0 });
    useEditor.getState().setFont('block');

    expect(useEditor.getState().text()).toContain('█');
    useEditor.getState().undo();
    expect(useEditor.getState().text()).toBe('HELLO');
  });
});

describe('the menu over text', () => {
  beforeEach(reset);

  it('offers fonts, where it used to offer nothing', () => {
    useEditor.getState().loadText('HELLO', 'x.txt');
    useEditor.getState().selectAt({ x: 0, y: 0 });

    expect(useEditor.getState().selection?.kind).toBe('text');
    const items = menuFor(useEditor.getState());
    expect(items.map((i) => i.label)).toEqual(['Font']);

    const font = items[0];
    expect(font).toBeDefined();
    if (font === undefined || !isGroup(font)) return;
    expect(font.items.length).toBe(BANNER_STYLES.length);
  });

  it('previews the font being pointed at, without writing anything', () => {
    useEditor.getState().loadText('HELLO', 'x.txt');
    useEditor.getState().selectAt({ x: 0, y: 0 });
    const before = useEditor.getState().text();

    useEditor.getState().openMenu();
    useEditor.getState().activateMenu(); // into Font
    expect(useEditor.getState().menuPreview?.size ?? 0).toBeGreaterThan(0);
    // A preview is exactly as uncommitted as a half-finished drag.
    expect(useEditor.getState().text()).toBe(before);
  });

  it('changes the preview as the highlight walks the fonts', () => {
    useEditor.getState().loadText('HELLO', 'x.txt');
    useEditor.getState().selectAt({ x: 0, y: 0 });
    useEditor.getState().openMenu();
    useEditor.getState().activateMenu();

    const first = useEditor.getState().menuPreview;
    useEditor.getState().moveMenu(1);
    const second = useEditor.getState().menuPreview;
    expect(first).not.toBe(second);
  });

  it('keeps the menu clear of what it is previewing', () => {
    useEditor.getState().loadText('HELLO', 'x.txt');
    useEditor.getState().selectAt({ x: 0, y: 0 });
    const selectionOnly = menuClear(useEditor.getState());

    useEditor.getState().openMenu();
    useEditor.getState().activateMenu();
    const withPreview = menuClear(useEditor.getState());

    // Five rows of letters grow down into where the menu would have gone, so
    // the area it has to avoid grows with them.
    expect(withPreview.h).toBeGreaterThan(selectionOnly.h);
  });

  it('a box is still offered its lattice, not fonts', () => {
    useEditor.getState().loadText('┌──┐\n│  │\n└──┘', 'x.txt');
    useEditor.getState().selectAt({ x: 0, y: 0 });
    expect(menuFor(useEditor.getState()).map((i) => i.label)).not.toContain('Font');
  });
});

describe('a menu row longer than the window', () => {
  const row = (n: number): MenuNode[] =>
    Array.from({ length: n }, (_, i) => ({
      label: `item${String(i)}`,
      title: '',
      run: () => undefined,
    }));

  it('shows a short row whole, and says there is no more', () => {
    const shown = windowOf(row(3), 0);
    expect(shown.items.length).toBe(3);
    expect(shown.before).toBe(false);
    expect(shown.after).toBe(false);
  });

  it('shows exactly five of a long one', () => {
    expect(windowOf(row(9), 0).items.length).toBe(MENU_WINDOW);
    expect(windowOf(row(9), 8).items.length).toBe(MENU_WINDOW);
  });

  it('scrolls rather than pages: one step of the highlight, one item', () => {
    const long = row(9);
    const a = windowOf(long, 4);
    const b = windowOf(long, 5);
    expect(b.from - a.from).toBe(1);
  });

  it('clamps at both ends, so the first and last items are reachable', () => {
    const long = row(9);
    expect(windowOf(long, 0).from).toBe(0);
    expect(windowOf(long, 0).before).toBe(false);
    expect(windowOf(long, 8).from).toBe(9 - MENU_WINDOW);
    expect(windowOf(long, 8).after).toBe(false);
  });

  it('always keeps the highlighted item inside the window', () => {
    const long = row(12);
    for (let at = 0; at < 12; at++) {
      const shown = windowOf(long, at);
      expect(at).toBeGreaterThanOrEqual(shown.from);
      expect(at).toBeLessThan(shown.from + shown.items.length);
    }
  });

  it('the font list is long enough to need it', () => {
    // Otherwise the limit would be untested by anything a user can reach.
    expect(BANNER_STYLES.length).toBeGreaterThan(MENU_WINDOW);
  });
});

/**
 * Reading huge letters back, and typing more of them (B-FONT-03, B-FONT-04).
 *
 * The recognizer's own trick applied to text: the document stores no words, only
 * a picture of them, so the word is *re-derived* by inverting the rendering. Two
 * properties carry the whole feature and both are pinned here — that the round
 * trip is exact for every style, and that it refuses rather than guesses when the
 * cells are not a banner at all.
 */
describe('reading a banner back off the grid', () => {
  const drawn = (text: string, styleId: string): Grid => {
    const style = styleFor(styleId);
    if (style === undefined) throw new Error(styleId);
    const grid = createGrid();
    applyDiff(grid, fromText(renderBanner(text, style).join('\n')));
    return grid;
  };

  it('round-trips every style, from every cell of the rendering', () => {
    // From *every* cell, not just the first: a click lands wherever it lands, and
    // a reading that only worked from the top-left corner would work almost never.
    for (const style of BANNER_STYLES) {
      for (const text of ['HI', 'HELLO', 'STATUS 7', 'A B']) {
        const grid = drawn(text, style.id);
        for (const key of grid.keys()) {
          const { x, y } = unck(key);
          const got = readBanner(grid, { x, y });
          expect(got?.text).toBe(text);
          expect(got?.style.id).toBe(style.id);
        }
      }
    }
  });

  it('finds the origin, which is not always a filled cell', () => {
    // `G` begins with a blank column in this alphabet, and getting this wrong is
    // what made an early version lose the selection on the first keystroke.
    const grid = drawn('GO', 'hash');
    expect(grid.has(ck(0, 0))).toBe(false);
    expect(readBanner(grid, { x: 1, y: 0 })?.origin).toEqual({ x: 0, y: 0 });
  });

  it('refuses things that are not banners', () => {
    for (const art of [
      'hello world',
      '┌────┐\n│    │\n└────┘',
      '+----+\n|    |\n+----+',
      '##########',
      '# # #\n#####\n# # #',
      '█ █\n███\n █ ',
    ]) {
      const grid = createGrid();
      applyDiff(grid, fromText(art));
      for (const key of grid.keys()) {
        const { x, y } = unck(key);
        expect(readBanner(grid, { x, y })).toBeNull();
      }
    }
  });

  it('refuses a banner something has been drawn over', () => {
    // The guard that stops typing re-rendering over somebody else's characters.
    const grid = drawn('HI', 'block');
    grid.set(ck(1, 1), '─');
    expect(readBanner(grid, { x: 0, y: 0 })).toBeNull();
  });

  it('is what a click reads, ahead of the row of text it used to be', () => {
    reset();
    useEditor.getState().loadText('HELLO', 'x.txt');
    useEditor.getState().selectAt({ x: 0, y: 0 });
    useEditor.getState().setFont('block');

    const picked = useEditor.getState().selectAt({ x: 1, y: 2 });
    expect(picked?.kind).toBe('banner');
    expect(picked?.banner?.text).toBe('HELLO');
    expect(picked?.banner?.styleId).toBe('block');
    expect(describeCandidate(picked as NonNullable<typeof picked>)).toBe('Banner `HELLO` · Block');
  });

  it('leaves the banner selected after choosing a font, ready to type into', () => {
    // Without this you would have to click the thing you had just made, and a
    // click on a letter's blank corner would select nothing at all.
    reset();
    useEditor.getState().loadText('GO', 'x.txt');
    useEditor.getState().selectAt({ x: 0, y: 0 });
    useEditor.getState().setFont('hash');
    expect(useEditor.getState().selection?.kind).toBe('banner');
  });

  it('still drills inward to the letters underneath', () => {
    reset();
    useEditor.getState().loadText('HELLO', 'x.txt');
    useEditor.getState().selectAt({ x: 0, y: 0 });
    useEditor.getState().setFont('block');
    expect(useEditor.getState().selectAt({ x: 1, y: 2 })?.kind).toBe('banner');
    expect(useEditor.getState().drillAt({ x: 1, y: 2 })?.kind).not.toBe('banner');
  });
});

describe('typing into a banner', () => {
  /** Select a word, set it in a font, and enter the writing mode. */
  const typing = (word: string, styleId: string): void => {
    reset();
    useEditor.getState().loadText(word, 'x.txt');
    useEditor.getState().selectAt({ x: 0, y: 0 });
    useEditor.getState().setFont(styleId);
    useEditor.getState().setTool('text');
  };
  const type = (s: string): void => {
    for (const ch of s) useEditor.getState().editBanner((t) => t + ch);
  };
  const said = (): string | undefined => useEditor.getState().selection?.banner?.text;

  it('needs the writing mode, so select keeps its mode letters', () => {
    // B-KEY-21 is not negotiable: under select, `b` is box. `t` is how you say
    // that the next key is a letter, exactly as it is for a run of small text.
    reset();
    useEditor.getState().loadText('GO', 'x.txt');
    useEditor.getState().selectAt({ x: 0, y: 0 });
    useEditor.getState().setFont('hash');
    expect(useEditor.getState().typingBanner()).toBe(false);

    useEditor.getState().setTool('text');
    expect(useEditor.getState().typingBanner()).toBe(true);
  });

  it('adds letters in the same font', () => {
    typing('HI', 'block');
    type('!');
    expect(said()).toBe('HI!');
    // Rendered, not appended: the same cells the whole string would have drawn.
    const style = styleFor('block');
    if (style === undefined) return;
    expect(useEditor.getState().text()).toBe(renderBanner('HI!', style).join('\n'));
  });

  it('backspace takes a whole letter off, not a cell', () => {
    typing('HI', 'block');
    useEditor.getState().editBanner((t) => [...t].slice(0, -1).join(''));
    expect(said()).toBe('H');
    const style = styleFor('block');
    if (style === undefined) return;
    expect(useEditor.getState().text()).toBe(renderBanner('H', style).join('\n'));
  });

  it('backspaced down to nothing leaves nothing behind', () => {
    typing('A', 'block');
    useEditor.getState().editBanner(() => '');
    expect(useEditor.getState().text()).toBe('');
    expect(useEditor.getState().selection).toBeNull();
  });

  it('space makes a space of the right width, though it draws nothing', () => {
    // The case that needs session state: the rows are right-trimmed, so `HI ` and
    // `HI` draw identical cells and the picture can only ever be read as `HI`.
    typing('HI', 'block');
    type(' YOU');
    expect(said()).toBe('HI YOU');
    const style = styleFor('block');
    if (style === undefined) return;
    expect(useEditor.getState().text()).toBe(renderBanner('HI YOU', style).join('\n'));
  });

  it('Enter drops a whole font-height, not one row', () => {
    typing('HI', 'block');
    useEditor.getState().editBanner((t) => `${t}\n`);
    type('OK');

    const rows = useEditor.getState().text().split('\n');
    const style = styleFor('block');
    if (style === undefined) return;
    // Five rows of letters, a blank one, then five more.
    expect(rows.length).toBe(style.height * 2 + 1);
    expect(rows[style.height]).toBe('');
  });

  it('leaves no debris when a second line gets shorter', () => {
    // The selection covers one line; the rendering covers both. Clearing only
    // what was selected would leave the tail of the other line standing.
    typing('HI', 'block');
    useEditor.getState().editBanner((t) => `${t}\n`);
    type('OK');
    useEditor.getState().editBanner((t) => [...t].slice(0, -1).join(''));

    const style = styleFor('block');
    if (style === undefined) return;
    const want = [
      ...renderBanner('HI', style),
      '',
      ...renderBanner('O', style),
    ].join('\n');
    expect(useEditor.getState().text()).toBe(want);
  });

  it('is one undo step per keystroke', () => {
    typing('HI', 'block');
    type('!');
    expect(said()).toBe('HI!');
    useEditor.getState().undo();
    const style = styleFor('block');
    if (style === undefined) return;
    expect(useEditor.getState().text()).toBe(renderBanner('HI', style).join('\n'));
  });

  it('forgets a pending space when the grid changes some other way', () => {
    // An undo puts the picture back without putting the intent back, so a
    // remembered trailing space has to go with it.
    typing('HI', 'block');
    type(' ');
    expect(useEditor.getState().bannerEdit?.text).toBe('HI ');
    useEditor.getState().undo();
    expect(useEditor.getState().bannerEdit).toBeNull();
  });
});
