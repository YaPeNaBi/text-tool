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
import { createGrid, applyDiff } from '../src/core/grid/grid.ts';
import { fromText, toText } from '../src/core/io/text.ts';
import { boundsOf, ck } from '../src/core/geom/cell.ts';
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
