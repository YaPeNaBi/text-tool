/**
 * Light and dark (B-UI-18).
 *
 * Three things are pinned. The store starts light and switches; the theme is
 * restored from and kept by the platform, and anything the platform hands back
 * that is not a theme is ignored; and the stylesheet and the canvas palette
 * agree — every colour in `styles.css` is a token, each theme defines all of
 * them, and each `--bg` is the palette's `bg`, so the page around the canvas
 * cannot drift from the canvas itself. The terminal's half — `F4`, and the page
 * it paints — is here too.
 */

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_THEME, PALETTES, isTheme, type Theme } from '../src/app/canvas/palette.ts';
import { followTheme, useEditor } from '../src/app/state/store.ts';
import { installPlatform } from '../src/platform/index.ts';
import { colorOf, Screen } from '../src/terminal/ansi.ts';
import { layoutOf, paint } from '../src/terminal/frame.ts';
import { createKeymap } from '../src/terminal/keymap.ts';

/** A platform that keeps a theme in memory, and counts how often it was asked to. */
function withKeptTheme(initial: string | null): { held: () => string | null; writes: () => number } {
  let held = initial;
  let writes = 0;
  installPlatform({
    id: 'terminal',
    limitation: null,
    canSaveInPlace: () => false,
    openFile: () => Promise.resolve(null),
    saveFile: () => Promise.resolve(null),
    saveFileAs: () => Promise.resolve(null),
    readClipboard: () => Promise.resolve(''),
    writeClipboard: () => Promise.resolve(),
    recentFiles: () => Promise.resolve([]),
    onMenuCommand: () => undefined,
    keep: () => undefined,
    kept: () => null,
    keepTheme: (theme) => {
      held = theme;
      writes++;
    },
    keptTheme: () => held,
  });
  return { held: () => held, writes: () => writes };
}

let stop: (() => void) | null = null;

beforeEach(() => {
  useEditor.setState({ theme: DEFAULT_THEME, notice: null });
});

afterEach(() => {
  stop?.();
  stop = null;
});

describe('the theme in the store', () => {
  it('is light by default', () => {
    expect(DEFAULT_THEME).toBe('light');
    expect(useEditor.getState().theme).toBe('light');
  });

  it('switches to dark and back', () => {
    useEditor.getState().toggleTheme();
    expect(useEditor.getState().theme).toBe('dark');
    useEditor.getState().toggleTheme();
    expect(useEditor.getState().theme).toBe('light');
  });

  it('knows what a theme is', () => {
    expect(isTheme('light')).toBe(true);
    expect(isTheme('dark')).toBe(true);
    for (const v of ['', 'Dark', 'blue', null, undefined, 1]) expect(isTheme(v)).toBe(false);
  });
});

describe('the theme is remembered (B-UI-18)', () => {
  it('starts from what the platform kept, and shows it at once', () => {
    withKeptTheme('dark');
    const shown: Theme[] = [];
    stop = followTheme((t) => shown.push(t));

    expect(useEditor.getState().theme).toBe('dark');
    expect(shown).toEqual(['dark']);
  });

  it('starts light when nothing was kept, and writes nothing until it changes', () => {
    const kept = withKeptTheme(null);
    const shown: Theme[] = [];
    stop = followTheme((t) => shown.push(t));

    expect(shown).toEqual(['light']);
    expect(kept.writes()).toBe(0);
  });

  it('ignores a kept value that is not a theme', () => {
    withKeptTheme('purple');
    stop = followTheme(() => undefined);
    expect(useEditor.getState().theme).toBe('light');
  });

  it('shows and keeps every change', () => {
    const kept = withKeptTheme(null);
    const show = vi.fn();
    stop = followTheme(show);

    useEditor.getState().toggleTheme();
    expect(show).toHaveBeenLastCalledWith('dark');
    expect(kept.held()).toBe('dark');

    useEditor.getState().toggleTheme();
    expect(show).toHaveBeenLastCalledWith('light');
    expect(kept.held()).toBe('light');
    expect(kept.writes()).toBe(2);
  });

  it('does not keep or show anything for a change that is not the theme', () => {
    const kept = withKeptTheme(null);
    const show = vi.fn();
    stop = followTheme(show);
    show.mockClear();

    useEditor.getState().toggleSticky();
    useEditor.getState().toggleSticky();
    expect(show).not.toHaveBeenCalled();
    expect(kept.writes()).toBe(0);
  });
});

describe('the stylesheet and the palette agree', () => {
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

  /** The custom properties one `selector { … }` block defines. */
  function tokens(selector: string): Map<string, string> {
    const at = css.indexOf(`${selector} {`);
    if (at === -1) throw new Error(`no ${selector} block`);
    const body = css.slice(at, css.indexOf('}', at));
    const out = new Map<string, string>();
    for (const m of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) out.set(m[1] as string, (m[2] as string).trim());
    return out;
  }

  const light = tokens(':root');
  const dark = tokens(':root[data-theme="dark"]');

  it('paints the page in the palette’s own background, in both themes', () => {
    expect(light.get('--bg')).toBe(PALETTES.light.bg);
    expect(dark.get('--bg')).toBe(PALETTES.dark.bg);
  });

  it('defines every token in both themes', () => {
    expect([...dark.keys()].sort()).toEqual([...light.keys()].sort());
  });

  it('uses no colour that is not a token, so a theme switch reaches everything', () => {
    // Strip the two token blocks; nothing left may spell a colour itself.
    const rest = css
      .replace(/:root \{[^}]*\}/, '')
      .replace(/:root\[data-theme="dark"\] \{[^}]*\}/, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(rest).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(rest).not.toMatch(/\brgba?\(/);
  });
});

describe('the terminal follows the theme', () => {
  const editor = (): ((key: string) => void) => {
    const km = createKeymap({ cancelGesture: vi.fn(), quit: vi.fn(), toggleBand: vi.fn() });
    return (key) => km.handle({ key, ctrl: false, alt: false, shift: false });
  };

  beforeEach(() => {
    useEditor.getState().clearAll();
    useEditor.getState().setTool('select');
  });

  it('paints a light page by default', () => {
    const screen = new Screen(40, 12, PALETTES.dark.bg);
    paint({ screen, layout: layoutOf(40, 12, false), drag: null, prompt: null });
    expect(screen.bg).toBe(colorOf(PALETTES.light.bg));
  });

  it('F4 switches to dark, says so, and the next frame is painted dark', () => {
    const key = editor();
    key('F4');
    expect(useEditor.getState().theme).toBe('dark');
    expect(useEditor.getState().notice).toBe('Dark theme');

    const screen = new Screen(40, 12, PALETTES.light.bg);
    paint({ screen, layout: layoutOf(40, 12, false), drag: null, prompt: null });
    expect(screen.bg).toBe(colorOf(PALETTES.dark.bg));

    key('F4');
    expect(useEditor.getState().theme).toBe('light');
    expect(useEditor.getState().notice).toBe('Light theme');
  });
});
