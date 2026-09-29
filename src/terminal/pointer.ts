/**
 * The mouse, for the terminal.
 *
 * `CanvasView`'s pointer handlers, with the pixels taken out — and taking them
 * out is most of what this file is. A terminal reports the cell directly, so
 * everything the canvas does with `getBoundingClientRect` and `screenToCell`
 * collapses into one subtraction, and what is left is the part that was never
 * about pixels: which gesture a press starts, and what a release means.
 *
 * It exists at all because two tools have no keyboard gesture. The eraser and
 * freehand are drags or they are nothing — `Space` draws nothing in either
 * (see `VIM_TOOLS` in `canvas/steps.ts`) — so a terminal build without a mouse
 * would have shipped two tools that could not be used. Everything else here is
 * reach rather than necessity: clicking to select is how the recognizer is meant
 * to be met, and drilling through readings by clicking again is the gesture
 * `rank.ts` exists for.
 *
 * The same rule holds as everywhere else: a gesture previews against the
 * unmodified grid and writes exactly once on release (B-DRAW-04, B-MAN-02), so
 * one drag is one undo step. `gesture.ts` does that work for both builds; this
 * only decides when a `Drag` begins and ends.
 */

import { ck, rectFromCorners, type Cell } from '../core/geom/cell.ts';
import { MIN_BOX } from '../core/stamp/box.ts';
import { MIN_ELLIPSE } from '../core/stamp/ellipse.ts';
import { isResizable } from '../core/recognize/recognize.ts';
import { subjectOf } from '../core/ops/move.ts';
import { railAt } from '../core/ops/lattice.ts';
import { handleAt, resizeRect } from '../core/transform/resize.ts';
import { brushAt, selectionHas, useEditor } from '../app/state/store.ts';
import { elbowFor, type Drag } from '../app/canvas/gesture.ts';
import type { Click, Wheel } from './keys.ts';
import type { MenuHit } from './frame.ts';

/** Where the canvas sits in the terminal, so a click can be placed on the grid. */
export interface Viewport {
  /** The first terminal row the canvas occupies. */
  top: number;
  width: number;
  height: number;
}

export interface Pointer {
  /** The gesture in flight, for `previewOf`. */
  drag: Drag | null;
  /**
   * `menu` is where the last frame drew the actions menu, empty when none is up.
   *
   * The pointer needs it because a terminal click is a row and a column and
   * nothing else — there is no element under it to ask. The web build gets this
   * for free from the DOM, which is why only this build has to be told.
   */
  press(click: Click, view: Viewport, menu?: readonly MenuHit[]): void;
  scroll(wheel: Wheel, view: Viewport): void;
  /** Escape abandons whatever is in flight, drawing nothing. */
  cancel(): void;
}

export function createPointer(): Pointer {
  const self: Pointer = {
    drag: null,
    press: (click, view, menu) => press(self, click, view, menu ?? []),
    scroll: (wheel, view) => scroll(wheel, view),
    cancel: () => {
      self.drag = null;
    },
  };
  return self;
}

/** A click's document cell. The plane has no negative half in quadrant mode. */
function cellOf(click: Click | Wheel, view: Viewport): Cell {
  const cam = useEditor.getState().camera;
  return {
    x: Math.max(0, Math.floor(cam.ox) + click.col),
    y: Math.max(0, Math.floor(cam.oy) + (click.row - view.top)),
  };
}

/** True when the click landed on the canvas rather than on a band or the status. */
function onCanvas(click: Click | Wheel, view: Viewport): boolean {
  return click.row >= view.top && click.row < view.top + view.height;
}

function press(self: Pointer, click: Click, view: Viewport, menu: readonly MenuHit[]): void {
  if (click.action === 'up') {
    release(self, click, view);
    return;
  }
  if (click.action === 'drag') {
    move(self, click, view);
    return;
  }

  // The menu is over the canvas and gets the click first, exactly as a DOM
  // button would in the web build. Without this the press below would close the
  // menu and start selecting whatever happened to be underneath it.
  const hit = menu.find((h) => h.row === click.row && click.col >= h.from && click.col < h.to);
  if (hit !== undefined) {
    if (click.button === 'left') useEditor.getState().pickMenu(hit.path);
    else if (click.button === 'right') useEditor.getState().leaveMenu();
    return;
  }

  if (!onCanvas(click, view)) return;

  const cell = cellOf(click, view);
  const store = useEditor.getState();

  // Any press dismisses the actions menu, which is also what makes a right-click
  // elsewhere put one away.
  store.closeMenu();

  // The pointer takes the keyboard's place with it, and abandons anything the
  // keyboard was drawing: two ways of pointing at the grid, and whichever was
  // used last is the one that means something.
  store.setCursor(cell);
  store.setHover(cell);

  if (click.button === 'middle') {
    self.drag = { kind: 'pan', sx: click.col, sy: click.row, cam: store.camera };
    return;
  }
  // Right-click opens the actions menu on whatever is selected, as it does on the
  // canvas. `openMenu` decides whether there is anything to offer.
  if (click.button === 'right') {
    store.openMenu();
    return;
  }
  if (click.button !== 'left') return;

  switch (store.tool) {
    case 'box':
      self.drag = { kind: 'box', anchor: cell, cur: cell };
      return;
    case 'circle':
      self.drag = { kind: 'circle', anchor: cell, cur: cell };
      return;
    case 'line':
    case 'arrow':
      // While a chain is running every press is a corner, decided on release;
      // otherwise this may still turn into a one-shot drag.
      if (store.chain === null) {
        self.drag = {
          kind: 'path',
          anchor: cell,
          cur: cell,
          arrow: store.tool === 'arrow',
          alt: click.alt,
        };
      }
      return;
    case 'erase':
      self.drag = { kind: 'erase', cur: cell, cells: new Set(brushAt(cell)) };
      return;
    case 'freehand':
      self.drag = { kind: 'freehand', cur: cell, samples: [cell] };
      return;
    case 'text':
      store.setCaret(cell);
      return;
    default:
      break;
  }

  // ---- select tool ----

  // Shift takes the whole connected thing; Ctrl takes just the piece under the
  // pointer, so a selection can be built out of parts (B-SEL-09).
  if (click.shift) {
    store.toggleAt(cell, 'component');
    return;
  }
  if (click.ctrl) {
    store.toggleAt(cell, 'piece');
    return;
  }

  // A separator resizes the track beside it, whatever is selected — the
  // spreadsheet gesture. It comes before selection because a rail is never on a
  // shape's own outline, so nothing else wants that cell.
  const rail = railAt(store.grid, cell.x, cell.y);
  if (rail !== null) {
    self.drag = { kind: 'track', rail, start: cell, cur: cell };
    return;
  }

  // A handle on a closed outline resizes it; anywhere else on the shape moves it.
  const sel = store.selection;
  if (isResizable(sel) && sel !== null) {
    const handle = handleAt(sel.bounds, cell.x, cell.y);
    if (handle !== null) {
      self.drag = {
        kind: 'resize',
        handle,
        start: cell,
        cur: cell,
        from: sel.bounds,
        repeat: store.drill?.key === ck(cell.x, cell.y),
      };
      return;
    }
  }

  // Clicking inside the current selection keeps that interpretation for the drag
  // (B-SEL-06); otherwise recognize afresh. `repeat` marks a press that should
  // read the cell again on release — either the cell the last click already
  // answered for, so a second click steps outward, or anywhere inside a selection
  // this press did not itself make.
  const held = selectionHas(sel, cell);
  const repeat = held || store.drill?.key === ck(cell.x, cell.y);
  const picked = held ? sel : store.selectAt(cell);

  if (picked !== null) {
    // Gather once, here. What travels with a shape cannot change mid-drag, and
    // deriving it per event would trace components on every mouse report.
    const subject = subjectOf(store.grid, picked);
    self.drag = {
      kind: 'move',
      start: cell,
      cur: cell,
      cells: subject.cells,
      bounds: subject.bounds,
      repeat,
    };
  } else {
    store.setSelection(null);
    self.drag = { kind: 'marquee', anchor: cell, cur: cell };
  }
}

function move(self: Pointer, click: Click, view: Viewport): void {
  const cell = cellOf(click, view);
  const store = useEditor.getState();
  store.setHover(cell);

  const active = self.drag;
  if (active === null) return;

  if (active.kind === 'pan') {
    store.setCamera({
      ox: active.cam.ox - (click.col - active.sx),
      oy: active.cam.oy - (click.row - active.sy),
      zoom: active.cam.zoom,
    });
    return;
  }

  if (active.kind === 'freehand') {
    // Sampled in cells: two reports inside one cell are one place, and the
    // stroke is the list of places it has been.
    if (active.cur.x === cell.x && active.cur.y === cell.y) return;
    active.samples.push(cell);
    self.drag = { ...active, cur: cell };
    return;
  }

  if (active.kind === 'erase') {
    for (const key of brushAt(cell)) active.cells.add(key);
    self.drag = { ...active, cur: cell };
    return;
  }

  if (active.cur.x === cell.x && active.cur.y === cell.y) return;
  self.drag = { ...active, cur: cell };
}

function release(self: Pointer, click: Click, view: Viewport): void {
  const store = useEditor.getState();
  const active = self.drag;
  self.drag = null;

  // No drag was started, so on the line tools this release is a click that places
  // the next corner (B-DRAW-14).
  if (active === null) {
    if ((store.tool === 'line' || store.tool === 'arrow') && onCanvas(click, view)) {
      store.addChainPoint(cellOf(click, view), 'pointer');
    }
    return;
  }

  switch (active.kind) {
    case 'box': {
      const r = rectFromCorners(active.anchor, active.cur);
      if (r.w >= MIN_BOX && r.h >= MIN_BOX) store.drawBox(r);
      return;
    }
    case 'circle': {
      const r = rectFromCorners(active.anchor, active.cur);
      if (r.w >= MIN_ELLIPSE && r.h >= MIN_ELLIPSE) store.drawEllipse(r);
      return;
    }
    case 'path':
      // A press and release on one cell is a click: start a chain rather than
      // commit a zero-length line.
      if (active.anchor.x === active.cur.x && active.anchor.y === active.cur.y) {
        store.addChainPoint(active.anchor, 'pointer');
      } else {
        store.drawPath(active.anchor, active.cur, {
          elbow: elbowFor(active.anchor, active.cur, active.alt),
          headEnd: active.arrow,
        });
      }
      return;
    case 'freehand':
      store.drawStroke(active.samples);
      return;
    case 'erase':
      store.eraseAt(active.cells);
      return;
    case 'marquee':
      store.selectRegion(rectFromCorners(active.anchor, active.cur));
      return;
    case 'resize': {
      const dx = active.cur.x - active.start.x;
      const dy = active.cur.y - active.start.y;
      // A press and release with no movement is a *click*, whatever cell it
      // landed on: handles cover half a small box's border, and letting them
      // swallow clicks would make the shape impossible to cycle through.
      if (dx === 0 && dy === 0) {
        if (active.repeat) store.drillAt(active.start);
      } else {
        store.resizeSelection(resizeRect(active.from, active.handle, dx, dy));
      }
      return;
    }
    case 'track': {
      const by =
        active.rail.axis === 'column'
          ? active.cur.x - active.start.x
          : active.cur.y - active.start.y;
      if (by !== 0) store.resizeTrack(active.rail, by);
      return;
    }
    case 'move': {
      const dx = active.cur.x - active.start.x;
      const dy = active.cur.y - active.start.y;
      // Nothing moved: this was a click, so read the cell again (B-REC-11).
      // `drillAt` starts fresh on a cell it has not just answered for and steps
      // outward on one it has, which is what lets a click narrow a big selection
      // down to the one line under the pointer.
      if (dx === 0 && dy === 0) {
        if (active.repeat) store.drillAt(active.start);
      } else {
        store.moveSelection(dx, dy, active.cells);
      }
      return;
    }
    case 'pan':
      return;
  }
}

/**
 * The wheel scrolls, and Shift scrolls sideways.
 *
 * The canvas puts zoom on Shift and sideways on Ctrl, deliberately the other way
 * round from most programs because a diagram runs off the right-hand edge far
 * more often than it wants resizing. Here there is no zoom to bind at all — a
 * terminal cell is the size the font makes it, and one document cell is one of
 * them — so the commoner want gets the commoner modifier and Ctrl is left alone.
 */
function scroll(wheel: Wheel, view: Viewport): void {
  // A wheel over the key band is not a request to move the document.
  if (!onCanvas(wheel, view)) return;

  const store = useEditor.getState();
  const cam = store.camera;
  const by = wheel.dir * 3;
  if (wheel.shift) store.setCamera({ ...cam, ox: cam.ox + by * 2 });
  else store.setCamera({ ...cam, oy: cam.oy + by });
}
