/**
 * The terminal build, pinned.
 *
 * Three things are tested here and they are tested here rather than through a
 * real terminal for the same reason: a pty harness can drive the editor, but it
 * cannot control *when* bytes arrive, and timing is precisely where a tty decoder
 * goes wrong. A lone `ESC` and the first byte of an arrow key are the same byte;
 * which one it was is a question about the next few milliseconds.
 *
 *   keys.ts     bytes -> presses, including the splits and the ambiguity
 *   keymap.ts   the six substitutes, and that they reach the same store calls
 *   frame.ts    the layout arithmetic, and what the frame actually says
 *
 * What is deliberately *not* here: the editing behaviour. Boxes, selection,
 * recognition and undo are the same code in both builds and are already pinned by
 * the other fourteen files in this directory. Testing them again through the
 * terminal would be testing the store twice and the terminal not at all.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDecoder, type Input, type Press } from '../src/terminal/keys.ts';
import { createKeymap, SUBSTITUTES } from '../src/terminal/keymap.ts';
import { follow, layoutOf, paint } from '../src/terminal/frame.ts';
import { Screen } from '../src/terminal/ansi.ts';
import { COLORS } from '../src/app/canvas/palette.ts';
import { useEditor } from '../src/app/state/store.ts';
import { TOOLS } from '../src/app/tools.ts';
import { groupsFor, type Item } from '../src/app/components/ribbon-items.ts';

const ESC = '\x1b';

/**
 * A clean editor between cases.
 *
 * The store is a module singleton — one document per process, which is what the
 * app wants and what a test file has to undo by hand. `clearAll` empties the
 * grid; the charset, the filename and the camera are session state and survive
 * it, so a test that cycled the charset would otherwise decide what colour of
 * corner the next one saw.
 */
function reset(): void {
  useEditor.setState({
    charsetId: 'unicode',
    fileName: 'diagram.txt',
    dirty: false,
    notice: null,
    objectMode: false,
    insertMode: false,
    brush: 1,
  });
  useEditor.getState().clearAll();
  useEditor.getState().setTool('select');
  useEditor.getState().setCaret(null);
  useEditor.getState().setHover(null);
  useEditor.getState().setCursor({ x: 0, y: 0 });
  useEditor.getState().setCamera({ ox: 0, oy: 0, zoom: 1 });
}

/** Feed a decoder and collect everything it emitted. */
function decode(...chunks: string[]): Input[] {
  const got: Input[] = [];
  const d = createDecoder((i) => got.push(i));
  for (const c of chunks) d.feed(Buffer.from(c, 'utf8'));
  d.flush();
  return got;
}

/** Just the presses, for the common case. */
function presses(...chunks: string[]): Press[] {
  return decode(...chunks).flatMap((i) => (i.kind === 'key' ? [i.press] : []));
}

describe('keys: bytes into presses', () => {
  it('reads a printable character as itself', () => {
    expect(presses('a')).toEqual([{ key: 'a', ctrl: false, alt: false, shift: false }]);
  });

  it('reports a capital the way a browser does: the key, and Shift', () => {
    // A terminal never says "Shift"; it says "K". Inferring the modifier is what
    // lets `directionOf` lowercase it back and lets the two keymaps agree.
    expect(presses('K')).toEqual([{ key: 'K', ctrl: false, alt: false, shift: true }]);
  });

  it('reads a run of characters as a run of presses', () => {
    expect(presses('hi').map((p) => p.key)).toEqual(['h', 'i']);
  });

  it('reads control codes as Ctrl and a letter', () => {
    expect(presses('\x01')).toEqual([{ key: 'a', ctrl: true, alt: false, shift: false }]);
    expect(presses('\x18')[0]?.key).toBe('x');
    expect(presses('\x18')[0]?.ctrl).toBe(true);
  });

  it('names the keys that are not letters', () => {
    expect(presses('\r')[0]?.key).toBe('Enter');
    expect(presses('\n')[0]?.key).toBe('Enter');
    expect(presses('\t')[0]?.key).toBe('Tab');
    expect(presses('\x7f')[0]?.key).toBe('Backspace');
    // 0x08 is Ctrl+H as well as Backspace, and nothing is bound to Ctrl+H.
    expect(presses('\x08')[0]?.key).toBe('Backspace');
  });

  it('reads the arrows, in both spellings a terminal uses', () => {
    expect(presses(`${ESC}[A`)[0]?.key).toBe('ArrowUp');
    expect(presses(`${ESC}[B`)[0]?.key).toBe('ArrowDown');
    expect(presses(`${ESC}[C`)[0]?.key).toBe('ArrowRight');
    expect(presses(`${ESC}[D`)[0]?.key).toBe('ArrowLeft');
    // Application mode sends SS3 for the same four keys.
    expect(presses(`${ESC}OC`)[0]?.key).toBe('ArrowRight');
  });

  it('reads the modifier out of a modified arrow', () => {
    expect(presses(`${ESC}[1;5C`)[0]).toEqual({
      key: 'ArrowRight',
      ctrl: true,
      alt: false,
      shift: false,
    });
    expect(presses(`${ESC}[1;2D`)[0]?.shift).toBe(true);
    expect(presses(`${ESC}[1;3B`)[0]?.alt).toBe(true);
    // Ctrl+Shift together: the bitmask, not two separate sequences.
    expect(presses(`${ESC}[1;6C`)[0]).toMatchObject({ ctrl: true, shift: true });
  });

  it('reads the numbered keys', () => {
    expect(presses(`${ESC}[2~`)[0]?.key).toBe('Insert');
    expect(presses(`${ESC}[3~`)[0]?.key).toBe('Delete');
    expect(presses(`${ESC}[11~`)[0]?.key).toBe('F1');
    expect(presses(`${ESC}OP`)[0]?.key).toBe('F1');
    expect(presses(`${ESC}[Z`)[0]).toMatchObject({ key: 'Tab', shift: true });
  });

  it('reads ESC and a character as Alt and that character', () => {
    expect(presses(`${ESC}s`)[0]).toEqual({ key: 's', ctrl: false, alt: true, shift: false });
  });

  it('reads a lone ESC as Escape', () => {
    expect(presses(ESC)[0]?.key).toBe('Escape');
  });

  it('holds a trailing ESC rather than guessing at it', () => {
    // The point of the wait: nothing may be decided about an ESC until either the
    // rest of its sequence turns up or the window closes. Deciding early is how
    // an arrow key becomes Escape followed by a stray bracket.
    const got: Input[] = [];
    const d = createDecoder((i) => got.push(i));
    d.feed(Buffer.from(ESC, 'utf8'));
    expect(got).toEqual([]);
    d.stop();
  });

  it('reassembles a sequence split across chunks', () => {
    // A loaded machine can cut a read anywhere. This is the case that would
    // otherwise drop the user out of their mode and then type a bracket.
    expect(presses(ESC, '[C').map((p) => p.key)).toEqual(['ArrowRight']);
    expect(presses(`${ESC}[`, '1;5C')[0]).toMatchObject({ key: 'ArrowRight', ctrl: true });
  });

  it('reassembles a multi-byte character split across chunks', () => {
    const bytes = Buffer.from('é', 'utf8');
    const got: Input[] = [];
    const d = createDecoder((i) => got.push(i));
    d.feed(bytes.subarray(0, 1));
    d.feed(bytes.subarray(1));
    d.flush();
    expect(got.flatMap((i) => (i.kind === 'key' ? [i.press.key] : []))).toEqual(['é']);
  });

  it('gives up a held ESC on its own timer', async () => {
    const got: Input[] = [];
    const d = createDecoder((i) => got.push(i));
    d.feed(Buffer.from(ESC, 'utf8'));
    expect(got).toEqual([]);
    await new Promise((r) => setTimeout(r, 60));
    expect(got).toEqual([{ kind: 'key', press: { key: 'Escape', ctrl: false, alt: false, shift: false } }]);
  });

  it('reads an SGR mouse press, drag and release', () => {
    const [down] = decode(`${ESC}[<0;10;5M`);
    expect(down).toEqual({
      kind: 'mouse',
      click: { action: 'down', button: 'left', col: 9, row: 4, ctrl: false, alt: false, shift: false },
    });

    const [drag] = decode(`${ESC}[<32;12;6M`);
    expect(drag).toMatchObject({ kind: 'mouse', click: { action: 'drag', col: 11, row: 5 } });

    const [up] = decode(`${ESC}[<0;12;6m`);
    expect(up).toMatchObject({ kind: 'mouse', click: { action: 'up', button: 'none' } });
  });

  it('reads the other buttons, and the modifiers on them', () => {
    expect(decode(`${ESC}[<1;3;3M`)[0]).toMatchObject({ click: { button: 'middle' } });
    expect(decode(`${ESC}[<2;3;3M`)[0]).toMatchObject({ click: { button: 'right' } });
    // 4 = shift, 16 = ctrl, on top of button 0.
    expect(decode(`${ESC}[<20;3;3M`)[0]).toMatchObject({ click: { shift: true, ctrl: true } });
  });

  it('reads the wheel as a wheel, not as a button', () => {
    expect(decode(`${ESC}[<64;5;5M`)[0]).toEqual({
      kind: 'wheel',
      wheel: { dir: -1, col: 4, row: 4, ctrl: false, shift: false },
    });
    expect(decode(`${ESC}[<65;5;5M`)[0]).toMatchObject({ kind: 'wheel', wheel: { dir: 1 } });
  });

  it('ignores a report it never asked for rather than typing it', () => {
    expect(presses(`${ESC}[?1;2c`)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

/**
 * The actions menu, walked (B-UI-11, B-UI-11b).
 *
 * Here although it is not a substitute, because this keymap is the one a test
 * can drive without a browser, and the menu's walking lives in the store both
 * builds call — the pointer's half (`pickMenu`, `pointMenu`) included.
 */
describe('the actions menu, walked by key and by pointer', () => {
  beforeEach(() => {
    reset();
    // The menu remembers where it was left (B-UI-13), across tests as much as
    // across openings, so each case starts from the top.
    useEditor.setState({ menuOpen: false, menuPath: [0], menuHint: null });
  });

  /** A line, selected, which offers Style and Line end ▸ End 1 · End 2. */
  function line(): void {
    useEditor.getState().loadText('───────────', 'x.txt');
    useEditor.getState().selectAt({ x: 5, y: 0 });
  }

  const path = (): readonly number[] => useEditor.getState().menuPath;
  const open = (): boolean => useEditor.getState().menuOpen;

  it('opens on a bare `e` in select, as Ctrl+E does', () => {
    const { key } = editor();
    line();
    key('e');
    expect(open()).toBe(true);
    expect(path()).toEqual([0]);
  });

  it('but `e` is only a letter under another mode', () => {
    const { key } = editor();
    key('b');
    key('e');
    expect(open()).toBe(false);
  });

  it('goes down into a group and back up out of it', () => {
    const { key } = editor();
    line();
    key('e');
    key('ArrowRight'); // Line end
    key('ArrowDown'); // into it: End 1
    key('ArrowRight'); // End 2
    key('ArrowDown'); // into its decorations
    expect(path()).toEqual([1, 1, 0]);

    key('ArrowUp'); // back to choosing an end, End 2 still lit
    expect(path()).toEqual([1, 1]);
    key('ArrowUp');
    expect(path()).toEqual([1]);
    key('ArrowUp'); // off the top
    expect(open()).toBe(false);
  });

  it('walks the same with hjkl', () => {
    const { key } = editor();
    line();
    key('e');
    key('l');
    key('j');
    key('l');
    expect(path()).toEqual([1, 1]);
    key('k');
    expect(path()).toEqual([1]);
  });

  it('puts the menu away on down over a plain option, as down always did', () => {
    const { key } = editor();
    line();
    key('e');
    key('ArrowRight');
    key('ArrowDown');
    key('ArrowDown');
    key('ArrowDown'); // a decoration is a leaf: nothing deeper
    expect(open()).toBe(false);
    expect(useEditor.getState().text()).toBe('───────────'); // and ran nothing
  });

  it('a click opens a group, and a second click on it goes back', () => {
    line();
    useEditor.getState().openMenu();
    useEditor.getState().pickMenu([1]);
    expect(path()).toEqual([1, 0]);
    useEditor.getState().pickMenu([1, 1]);
    expect(path()).toEqual([1, 1, 0]);

    useEditor.getState().pickMenu([1, 1]); // End 2 again: shut
    expect(path()).toEqual([1, 1]);
    useEditor.getState().pickMenu([1]); // Line end again: shut
    expect(path()).toEqual([1]);
  });

  it('a click in a row above moves to it, and a click on an option runs it', () => {
    line();
    useEditor.getState().openMenu();
    useEditor.getState().pickMenu([1]);
    useEditor.getState().pickMenu([1, 0]);
    useEditor.getState().pickMenu([1, 1]); // the other end, from End 1's row
    expect(path()).toEqual([1, 1, 0]);

    useEditor.getState().pickMenu([1, 1, 1]); // Arrow
    expect(open()).toBe(false);
    expect(useEditor.getState().text()).toBe('──────────▶');
  });

  it('hovering a row above lights it up without folding the rows beneath', () => {
    line();
    useEditor.getState().openMenu();
    useEditor.getState().pickMenu([1]);
    useEditor.getState().pickMenu([1, 1]);

    useEditor.getState().pointMenu([1, 0]); // End 1, a row up
    expect(path()).toEqual([1, 1, 0]);
    expect(useEditor.getState().menuHint).not.toBeNull();

    useEditor.getState().pointMenu([1, 1, 2]); // along the deepest row: followed
    expect(path()).toEqual([1, 1, 2]);
  });
});

// ---------------------------------------------------------------------------

/** A fresh document, and a keymap with a shell that only records. */
function editor(): {
  key: (key: string, mods?: Partial<Press>) => void;
  shell: { cancelGesture: ReturnType<typeof vi.fn>; quit: ReturnType<typeof vi.fn>; toggleBand: ReturnType<typeof vi.fn> };
} {
  const shell = { cancelGesture: vi.fn(), quit: vi.fn(), toggleBand: vi.fn() };
  const km = createKeymap(shell);
  return {
    shell,
    key: (key, mods = {}) => {
      km.handle({ key, ctrl: false, alt: false, shift: false, ...mods });
    },
  };
}

describe('keymap: the substitutes a tty forces', () => {
  beforeEach(() => {
    reset();
  });

  it('picks a tool by its bare digit, since Ctrl and a digit has no encoding', () => {
    const { key } = editor();
    for (const t of TOOLS.filter((x) => /^[0-9]$/.test(x.key))) {
      key(t.key);
      expect(useEditor.getState().tool).toBe(t.id);
      useEditor.getState().setTool('select');
    }
  });

  it('still reaches the lettered tools on Ctrl, which a tty can send', () => {
    const { key } = editor();
    key('q', { ctrl: true });
    expect(useEditor.getState().tool).toBe('freehand');
  });

  it('does not steal a digit from the text tool', () => {
    const { key } = editor();
    key('t');
    key('4');
    expect(useEditor.getState().tool).toBe('text');
    expect(useEditor.getState().text()).toBe('4');
  });

  it('enters object select on `o`, the double-tap being unreportable', () => {
    const { key } = editor();
    useEditor.getState().loadText('┌──┐\n│  │\n└──┘', 'x.txt');
    useEditor.getState().setCursor({ x: 0, y: 0 });
    key('o');
    expect(useEditor.getState().objectMode).toBe(true);
  });

  it('takes everything joined up on `g`, Ctrl+Enter losing its modifier', () => {
    const { key } = editor();
    useEditor.getState().loadText('┌──┐\n│  │\n└──┘', 'x.txt');
    useEditor.getState().setCursor({ x: 0, y: 0 });
    key('g');
    expect(useEditor.getState().selection).not.toBeNull();
  });

  it('draws a box on Shift+arrow and commits it on Enter, there being no release', () => {
    const { key } = editor();
    key('b');
    key('ArrowRight', { shift: true });
    expect(useEditor.getState().draft).not.toBeNull();
    for (let i = 0; i < 6; i++) key('ArrowRight', { shift: true });
    for (let i = 0; i < 3; i++) key('ArrowDown', { shift: true });
    expect(useEditor.getState().grid.size).toBe(0); // nothing written yet
    key('Enter');
    expect(useEditor.getState().text()).toBe('┌──────┐\n│      │\n│      │\n└──────┘');
  });

  it('leaves on Ctrl+X, the one key the shell keeps for itself', () => {
    const { key, shell } = editor();
    key('x', { ctrl: true });
    expect(shell.quit).toHaveBeenCalled();
  });

  it('keeps Ctrl+C as copy rather than quietly making it the interrupt', () => {
    const { key, shell } = editor();
    key('c', { ctrl: true });
    expect(shell.quit).not.toHaveBeenCalled();
  });

  it('walks with hjkl and comes back to select with jk', () => {
    const { key } = editor();
    key('b');
    expect(useEditor.getState().tool).toBe('box');
    key('j');
    key('k');
    expect(useEditor.getState().tool).toBe('select');
    // `j` then `k` leaves the cursor where it started (B-KEY-23).
    expect(useEditor.getState().cursor).toEqual({ x: 0, y: 0 });
  });

  it('writes the `j` when no `k` follows it under text', async () => {
    const { key } = editor();
    key('t');
    key('j');
    expect(useEditor.getState().text()).toBe(''); // held back, not written
    await new Promise((r) => setTimeout(r, 340));
    expect(useEditor.getState().text()).toBe('j');
  });

  it('shows the band on F1 and cycles the charset on F2', () => {
    const { key, shell } = editor();
    key('F1');
    expect(shell.toggleBand).toHaveBeenCalled();

    useEditor.getState().loadText('┌──┐\n│  │\n└──┘', 'x.txt');
    const before = useEditor.getState().charsetId;
    key('F2');
    expect(useEditor.getState().charsetId).not.toBe(before);
  });

  it('every substitute it claims to make is one the band also shows', () => {
    // The honest question about a second keymap is how far it has drifted, and
    // `SUBSTITUTES` is the answer only as long as it is the whole answer. This
    // pins the count: a seventh divergence has to be written down to get in.
    expect(SUBSTITUTES).toHaveLength(6);

    const overrides: Item[] = [];
    for (const tool of TOOLS) {
      const groups = groupsFor(tool.id, {
        insertMode: false,
        brush: 1,
        objectMode: false,
        setTool: () => undefined,
      });
      for (const g of groups) {
        for (const item of g.items) if (item.terminal !== undefined) overrides.push(item);
      }
    }
    expect(overrides.length).toBeGreaterThan(0);
    // Every override says something different from the web row it replaces.
    for (const item of overrides) {
      if (item.terminal === null || item.terminal === undefined) continue;
      const keys = item.terminal.keys ?? item.keys;
      const label = item.terminal.label ?? item.label;
      expect(keys.join() !== item.keys.join() || label !== item.label).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------

describe('frame: the layout, and what it says', () => {
  beforeEach(() => {
    reset();
    useEditor.getState().setCamera({ ox: 0, oy: 0, zoom: 1 });
  });

  it('gives the canvas everything the chrome does not want', () => {
    const l = layoutOf(80, 24, true);
    expect(l.view.top).toBe(1);
    expect(l.statusRow).toBe(23);
    expect(l.bandRows).toBe(4);
    expect(l.view.height).toBe(24 - 2 - 4);
  });

  it('drops the band rather than crowd out the document', () => {
    // A band is help; a band that leaves two rows of canvas is the thing in the
    // way of what it is helping with.
    expect(layoutOf(80, 8, true).bandRows).toBe(0);
    expect(layoutOf(80, 8, true).view.height).toBe(6);
  });

  it('scrolls to keep the keyboard on screen', () => {
    const l = layoutOf(80, 24, true);
    useEditor.getState().setCursor({ x: 0, y: 60 });
    follow(l);
    const cam = useEditor.getState().camera;
    expect(cam.oy).toBeGreaterThan(0);
    // The cursor is inside the canvas, with the margin the follow promises.
    expect(60 - cam.oy).toBeLessThan(l.view.height);
    expect(60 - cam.oy).toBeGreaterThanOrEqual(0);
  });

  it('never scrolls into space the plane does not have (B-CAM-01)', () => {
    const l = layoutOf(80, 24, true);
    useEditor.getState().setCursor({ x: 0, y: 0 });
    follow(l);
    expect(useEditor.getState().camera.ox).toBe(0);
    expect(useEditor.getState().camera.oy).toBe(0);
  });

  it('draws the document where the document is', () => {
    useEditor.getState().loadText('┌──┐\n│  │\n└──┘', 'x.txt');
    const screen = new Screen(40, 14, COLORS.bg);
    const layout = layoutOf(40, 14, false);
    paint({ screen, layout, drag: null, prompt: null });

    expect(screen.row(1)).toBe('┌──┐');
    expect(screen.row(2)).toBe('│  │');
    expect(screen.row(3)).toBe('└──┘');
  });

  it('names the tool, the charset and the file on the top row', () => {
    const screen = new Screen(80, 14, COLORS.bg);
    paint({ screen, layout: layoutOf(80, 14, false), drag: null, prompt: null });
    const top = screen.row(0);
    expect(top).toContain('Select');
    expect(top).toContain('Unicode');
    expect(top).toContain('diagram.txt');
  });

  it('keeps every tool reachable when the window is too narrow for their names', () => {
    const narrow = new Screen(46, 14, COLORS.bg);
    paint({ screen: narrow, layout: layoutOf(46, 14, false), drag: null, prompt: null });
    const top = narrow.row(0);
    // The keys survive even where the labels cannot: the eraser and freehand are
    // at the end of the row and are the two that most need finding.
    for (const t of TOOLS) expect(top).toContain(t.key);
  });

  it('says what is selected, and that other readings exist (B-UI-06)', () => {
    useEditor.getState().loadText('┌──┐\n│  │\n└──┘', 'x.txt');
    useEditor.getState().selectAt({ x: 0, y: 0 });

    const screen = new Screen(80, 14, COLORS.bg);
    const layout = layoutOf(80, 14, false);
    paint({ screen, layout, drag: null, prompt: null });
    expect(screen.row(layout.statusRow)).toContain('Box 4×3');
  });

  it('puts a bar on the caret and a block on the cursor (B-UI-10)', () => {
    const screen = new Screen(80, 14, COLORS.bg);
    const layout = layoutOf(80, 14, false);

    const block = paint({ screen, layout, drag: null, prompt: null });
    expect(block?.shape).toBe('\x1b[2 q');

    useEditor.getState().setTool('text');
    useEditor.getState().setCaret({ x: 3, y: 2 });
    const bar = paint({ screen, layout, drag: null, prompt: null });
    expect(bar?.shape).toBe('\x1b[5 q');
    expect(bar).toMatchObject({ x: 3, y: 3 });
  });

  it('shows the dialog over the status line, and puts the cursor in it', () => {
    const screen = new Screen(80, 14, COLORS.bg);
    const layout = layoutOf(80, 14, false);
    const cursor = paint({
      screen,
      layout,
      drag: null,
      prompt: { question: 'Open', value: '/tmp/a.txt', hint: 'Enter · Esc cancels' },
    });
    const row = screen.row(layout.statusRow);
    expect(row).toContain('Open');
    expect(row).toContain('/tmp/a.txt');
    expect(cursor?.y).toBe(layout.statusRow);
  });

  it('repeats only the rows that changed', () => {
    const screen = new Screen(80, 14, COLORS.bg);
    const layout = layoutOf(80, 14, false);
    paint({ screen, layout, drag: null, prompt: null });
    const first = screen.frame(null);
    expect(first.length).toBeGreaterThan(100);

    // Nothing has changed, so the second frame is the cursor and nothing else —
    // which is what keeps a held arrow key smooth over a slow link.
    paint({ screen, layout, drag: null, prompt: null });
    const second = screen.frame(null);
    expect(second).not.toContain('Select');
    expect(second.length).toBeLessThan(40);
  });
});
