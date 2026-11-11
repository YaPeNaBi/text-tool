/**
 * The document survives a refresh (B-FILE-06).
 *
 * What is pinned is the contract between the store and the platform: every
 * change hands the platform the whole document as text, an empty grid hands it
 * nothing, and what the platform hands back at startup lands on the grid as
 * though it had never left — with no undo step underneath it. The browser side
 * of it, that `localStorage` holds the string, is the e2e suite's to check.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { keepDocument, restoreDocument, useEditor } from '../src/app/state/store.ts';
import { ck } from '../src/core/geom/cell.ts';
import { fromText } from '../src/core/io/text.ts';
import { installPlatform, type KeptDocument } from '../src/platform/index.ts';

/** A platform that keeps in memory, and remembers how often it was asked to. */
function withKept(initial: KeptDocument | null): { held: () => KeptDocument | null; writes: () => number } {
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
    keep: (doc) => {
      held = doc;
      writes++;
    },
    kept: () => held,
  });
  return { held: () => held, writes: () => writes };
}

const BOX = ['┌──┐', '│  │', '└──┘'].join('\n');

let stop: (() => void) | null = null;

beforeEach(() => {
  useEditor.getState().clearAll();
  useEditor.setState({ fileName: 'diagram.txt', dirty: false, notice: null });
});

afterEach(() => {
  stop?.();
  stop = null;
});

describe('keeping the document (B-FILE-06)', () => {
  it('hands the platform the whole document as text after every edit', () => {
    const platform = withKept(null);
    stop = keepDocument();

    useEditor.getState().apply(fromText(BOX));

    expect(platform.held()).toEqual({ name: 'diagram.txt', text: BOX, dirty: true });
  });

  it('keeps where the drawing is, not only what it is', () => {
    const platform = withKept(null);
    stop = keepDocument();

    useEditor.getState().apply(fromText(BOX, 4, 2));

    // Two blank rows and four blank columns of margin: a save would crop
    // these away, and a refresh that did would move the box to the corner.
    expect(platform.held()?.text).toBe(`\n\n    ${BOX.split('\n').join('\n    ')}`);
  });

  it('an empty grid keeps nothing, so a cleared page does not come back', () => {
    const platform = withKept(null);
    stop = keepDocument();

    useEditor.getState().apply(fromText(BOX));
    useEditor.getState().clearAll();

    expect(platform.held()).toBeNull();
  });

  it('a save is kept too, so the name and the clean state come back with it', () => {
    const platform = withKept(null);
    stop = keepDocument();

    useEditor.getState().apply(fromText(BOX));
    useEditor.setState({ fileName: 'plan.txt', dirty: false });

    expect(platform.held()).toEqual({ name: 'plan.txt', text: BOX, dirty: false });
  });

  it('changes that are not to the document are not kept', () => {
    const platform = withKept(null);
    stop = keepDocument();

    useEditor.getState().apply(fromText(BOX));
    const before = platform.writes();

    useEditor.getState().setTool('box');
    useEditor.getState().setCamera({ ox: 3, oy: 3, zoom: 2 });
    useEditor.getState().setCursor({ x: 4, y: 4 });

    expect(platform.writes()).toBe(before);
  });
});

describe('restoring the document (B-FILE-06)', () => {
  it('puts what was kept back on the grid, by name, still dirty', () => {
    withKept({ name: 'plan.txt', text: BOX, dirty: true });

    restoreDocument();

    const s = useEditor.getState();
    expect(s.text()).toBe(BOX);
    expect(s.fileName).toBe('plan.txt');
    expect(s.dirty).toBe(true);
  });

  it('puts it back where it was', () => {
    withKept({ name: 'plan.txt', text: `\n\n    ${BOX.split('\n').join('\n    ')}`, dirty: true });

    restoreDocument();

    expect(useEditor.getState().grid.get(ck(4, 2))).toBe('┌');
    expect(useEditor.getState().grid.get(ck(0, 0))).toBeUndefined();
  });

  it('is not an undo step, and says nothing was opened', () => {
    withKept({ name: 'plan.txt', text: BOX, dirty: false });

    restoreDocument();

    const s = useEditor.getState();
    expect(s.canUndo).toBe(false);
    expect(s.notice).toBeNull();
    s.undo();
    expect(useEditor.getState().text()).toBe(BOX);
  });

  it('with nothing kept, leaves the page as it was', () => {
    withKept(null);
    useEditor.setState({ fileName: 'untouched.txt' });

    restoreDocument();

    const s = useEditor.getState();
    expect(s.grid.size).toBe(0);
    expect(s.fileName).toBe('untouched.txt');
  });
});
