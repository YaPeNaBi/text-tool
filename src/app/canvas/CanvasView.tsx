/**
 * Canvas host: pixels in, intent out.
 *
 * What is left here is the part that genuinely needs the DOM — the element, its
 * size, the pointer's place on the grid, and the frame. The two things that do
 * not are next door:
 *
 *   gesture.ts   what a gesture in flight looks like, as a pure function
 *   keymap.ts    what a key means
 *
 * The split is worth naming because the file used to hold all three and read as
 * one long else-if. A `ResizeObserver`, a `fillText` loop and thirty-odd key
 * bindings are three different kinds of thing, and only one of them is a canvas.
 *
 * Every gesture previews against the *unmodified* grid and writes exactly
 * once on release, which is what makes one drag one undo step (B-DRAW-04,
 * B-MAN-02) and what makes occlusion gesture-scoped (B-MAN-03).
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ck, rectContains, rectFromCorners, type Cell } from '../../core/geom/cell.ts';
import { MIN_BOX } from '../../core/stamp/box.ts';
import { MIN_ELLIPSE } from '../../core/stamp/ellipse.ts';
import { maskOf } from '../../core/grid/grid.ts';
import { isResizable } from '../../core/recognize/recognize.ts';
import { subjectOf } from '../../core/ops/move.ts';
import { railAt } from '../../core/ops/lattice.ts';
import { handleAt, resizeRect, type HandleId } from '../../core/transform/resize.ts';
import { brushAt, selectionHas, useEditor } from '../state/store.ts';
import { clampZoom, metricsFor, screenToCell } from './camera.ts';
import { elbowFor, previewOf, type Drag } from './gesture.ts';
import { render } from './renderer.ts';
import { installKeyboard } from './keymap.ts';
import { ShapeMenu } from '../components/ShapeMenu.tsx';

const CARET_BLINK_MS = 530;

function clampCell(c: Cell): Cell {
  return { x: Math.max(0, c.x), y: Math.max(0, c.y) };
}

const RESIZE_CURSOR: Record<HandleId, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
};

export function CanvasView(): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const [size, setSize] = useState({ w: 0, h: 0 });
  const [caretOn, setCaretOn] = useState(true);

  // The ref is the source of truth for handlers; the state copy exists so the
  // canvas redraws. Reading state inside a handler would go stale whenever two
  // pointer events land in the same tick.
  const dragRef = useRef<Drag | null>(null);
  const [drag, setDragState] = useState<Drag | null>(null);
  const setDrag = useCallback((next: Drag | null): void => {
    dragRef.current = next;
    setDragState(next);
  }, []);

  const hover = useEditor((s) => s.hover);
  const setHover = useEditor((s) => s.setHover);
  const grid = useEditor((s) => s.grid);
  const revision = useEditor((s) => s.revision);
  const tool = useEditor((s) => s.tool);
  const camera = useEditor((s) => s.camera);
  const selection = useEditor((s) => s.selection);
  const originMode = useEditor((s) => s.originMode);
  const charsetId = useEditor((s) => s.charsetId);
  const caret = useEditor((s) => s.caret);
  const brush = useEditor((s) => s.brush);
  const chain = useEditor((s) => s.chain);
  const chainAim = useEditor((s) => s.chainAim);
  const menuHint = useEditor((s) => s.menuHint);
  const menuPreview = useEditor((s) => s.menuPreview);
  const menuOpen = useEditor((s) => s.menuOpen);
  const keyCursor = useEditor((s) => s.cursor);
  const draft = useEditor((s) => s.draft);

  const metrics = metricsFor(camera.zoom);

  // ---- viewport sizing -----------------------------------------------------

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (wrap === null) return;

    const observer = new ResizeObserver(() => {
      setSize({ w: wrap.clientWidth, h: wrap.clientHeight });
    });
    observer.observe(wrap);
    setSize({ w: wrap.clientWidth, h: wrap.clientHeight });
    return () => observer.disconnect();
  }, []);

  // ---- one position, two readings (B-UI-10) --------------------------------
  //
  // The keyboard has a single place on the grid. Whether it is drawn as a
  // blinking bar or as a square is a question about what that place is *for*,
  // and the selection answers it: inside the selection the keyboard is editing
  // what is selected, so it shows a caret; outside it, the keyboard is only
  // pointing, so it shows its square.
  //
  // With nothing selected there is no area to be inside, so the question falls
  // back to whether a caret was actually placed.
  //
  // Typing outside the selection answers it the other way round: the keystroke
  // clears the selection (B-SEL-07) and leaves a caret, so the square becomes a
  // bar on the same keystroke that dissolves the area — which is one rule
  // producing both halves rather than a special case for each.
  const keyPoint = caret ?? keyCursor;
  const writing =
    selection === null
      ? caret !== null
      : rectContains(selection.bounds, keyPoint.x, keyPoint.y);

  // Restarting on every move keeps it solid while you type.
  useEffect(() => {
    if (!writing) return;
    setCaretOn(true);
    const id = setInterval(() => setCaretOn((on) => !on), CARET_BLINK_MS);
    return () => clearInterval(id);
  }, [writing, keyPoint]);

  // ---- preview derived from the current gesture ----------------------------

  const pointerCell = useCallback(
    (ev: { clientX: number; clientY: number }): Cell => {
      const canvas = canvasRef.current;
      if (canvas === null) return { x: 0, y: 0 };
      const box = canvas.getBoundingClientRect();
      return clampCell(
        screenToCell(ev.clientX - box.left, ev.clientY - box.top, camera, metrics),
      );
    },
    [camera, metrics],
  );

  const preview = previewOf({
    grid,
    charset: useEditor.getState().charset(),
    sticky: useEditor.getState().sticky,
    clampToOrigin: originMode === 'quadrant',
    drag,
    draft,
    chain,
    chainAim,
    selection,
    tool,
    brush,
    hover,
    cursor: keyCursor,
    // Gated on the menu being open: several paths close it without clearing
    // what it was offering, and a preview outliving its menu would be a change
    // nobody could dismiss.
    menu: menuOpen ? menuPreview : null,
  });

  // ---- draw ----------------------------------------------------------------

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || size.w === 0 || size.h === 0) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    canvas.style.width = `${size.w}px`;
    canvas.style.height = `${size.h}px`;

    const ctx = canvas.getContext('2d');
    if (ctx === null) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    render({
      ctx,
      width: size.w,
      height: size.h,
      grid,
      camera,
      metrics,
      originMode,
      selection,
      preview: preview.cells,
      previewRect: preview.rect,
      brushRect: preview.brush,
      hover,
      hint: menuHint,
      caret: writing ? keyPoint : null,
      caretOn,
      chain,
      cursor: keyPoint,
    });
  }, [
    size,
    grid,
    revision,
    camera,
    metrics,
    originMode,
    selection,
    preview,
    hover,
    menuHint,
    menuPreview,
    menuOpen,
    writing,
    keyPoint,
    caretOn,
    chain,
    draft,
    charsetId,
  ]);

  // ---- pointer -------------------------------------------------------------

  const onPointerDown = (ev: React.PointerEvent<HTMLCanvasElement>): void => {
    // Capture can throw for a pointer the browser no longer tracks; a failed
    // capture only costs us drags that leave the canvas, so carry on.
    try {
      ev.currentTarget.setPointerCapture(ev.pointerId);
    } catch {
      /* not capturable */
    }
    const cell = pointerCell(ev);

    // Any press dismisses the actions menu. The right-click that opens one
    // arrives here first with button 2, so this closes and `onContextMenu`
    // reopens — which is also what makes right-clicking elsewhere dismiss.
    useEditor.getState().closeMenu();

    // The pointer takes the keyboard's place with it, and abandons anything the
    // keyboard was drawing: two ways of pointing at the grid, and whichever was
    // used last is the one that means something.
    useEditor.getState().setCursor(cell);

    if (ev.button === 1) {
      setDrag({ kind: 'pan', sx: ev.clientX, sy: ev.clientY, cam: camera });
      return;
    }
    if (ev.button !== 0) return;

    const store = useEditor.getState();

    switch (tool) {
      case 'box':
        setDrag({ kind: 'box', anchor: cell, cur: cell });
        return;
      case 'circle':
        setDrag({ kind: 'circle', anchor: cell, cur: cell });
        return;
      case 'line':
      case 'arrow':
        // While a chain is running every press is a corner, decided on
        // release; otherwise this may still turn into a one-shot drag.
        if (store.chain === null) {
          setDrag({
            kind: 'path',
            anchor: cell,
            cur: cell,
            arrow: tool === 'arrow',
            alt: ev.altKey,
          });
        }
        return;
      case 'erase':
        setDrag({ kind: 'erase', cur: cell, cells: new Set(brushAt(cell)) });
        return;
      case 'freehand':
        setDrag({ kind: 'freehand', cur: cell, samples: [cell] });
        return;
      case 'text':
        store.setCaret(cell);
        return;
      default:
        break;
    }

    // ---- select tool ----

    // Shift takes the whole connected thing; Ctrl takes just the piece under
    // the pointer, so a selection can be built out of parts (B-SEL-09).
    // `metaKey` too, that being the same gesture on a Mac.
    if (ev.shiftKey) {
      store.toggleAt(cell, 'component');
      return;
    }
    if (ev.ctrlKey || ev.metaKey) {
      store.toggleAt(cell, 'piece');
      return;
    }

    // A separator resizes the track beside it, whatever is selected — the
    // spreadsheet gesture, and the one people try without being told. It comes
    // before selection because a rail is never on a shape's own outline, so
    // nothing else wants that cell.
    const rail = railAt(store.grid, cell.x, cell.y);
    if (rail !== null) {
      setDrag({ kind: 'track', rail, start: cell, cur: cell });
      return;
    }

    // A handle on a closed outline resizes it; anywhere else on the shape moves it.
    const sel = store.selection;
    if (isResizable(sel) && sel !== null) {
      const handle = handleAt(sel.bounds, cell.x, cell.y);
      if (handle !== null) {
        setDrag({
          kind: 'resize',
          handle,
          start: cell,
          cur: cell,
          from: sel.bounds,
          repeat: store.drill?.key === ck(cell.x, cell.y),
        });
        return;
      }
    }

    // Clicking inside the current selection keeps that interpretation for the
    // drag (B-SEL-06); otherwise recognize afresh.
    //
    // `repeat` marks a press that should read the cell again on release, which
    // is either of two things: the cell the last click already answered for, so
    // a second click steps outward; or anywhere inside a selection this press
    // did not itself make, so a click can narrow a whole diagram down to the
    // one line under the pointer. A press that *did* just select must not also
    // drill, or every single click would land one reading past the one it asked
    // for.
    const held = selectionHas(sel, cell);
    const repeat = held || store.drill?.key === ck(cell.x, cell.y);
    const existing = held ? sel : null;
    const picked = existing ?? store.selectAt(cell);

    if (picked !== null) {
      // Gather once, here. What travels with a shape cannot change mid-drag,
      // and deriving it per frame would trace components on every pointer
      // event (see ops/move.ts).
      const subject = subjectOf(store.grid, picked);
      setDrag({
        kind: 'move',
        start: cell,
        cur: cell,
        cells: subject.cells,
        bounds: subject.bounds,
        repeat,
      });
    } else {
      store.setSelection(null);
      setDrag({ kind: 'marquee', anchor: cell, cur: cell });
    }
  };

  const onPointerMove = (ev: React.PointerEvent<HTMLCanvasElement>): void => {
    const cell = pointerCell(ev);
    setHover(cell);

    const active = dragRef.current;
    if (active === null) return;

    if (active.kind === 'pan') {
      const dx = (ev.clientX - active.sx) / metrics.cellW;
      const dy = (ev.clientY - active.sy) / metrics.cellH;
      useEditor.getState().setCamera({
        ox: active.cam.ox - dx,
        oy: active.cam.oy - dy,
        zoom: active.cam.zoom,
      });
      return;
    }

    if (active.kind === 'freehand') {
      // Sampled in *cells*, not pixels: two pointer events inside one cell are
      // one place, and the stroke is a list of the places it has been. The
      // array is mutated and the wrapper replaced, so the redraw fires without
      // rebuilding the whole stroke on every event.
      if (active.cur.x === cell.x && active.cur.y === cell.y) return;
      active.samples.push(cell);
      setDrag({ ...active, cur: cell });
      return;
    }

    if (active.kind === 'erase') {
      // The set is mutated in place and the wrapper replaced, so the redraw
      // fires without rebuilding the whole footprint on every event.
      for (const key of brushAt(cell)) active.cells.add(key);
      setDrag({ ...active, cur: cell });
      return;
    }

    const altChanged = active.kind === 'path' && active.alt !== ev.altKey;
    if (active.cur.x === cell.x && active.cur.y === cell.y && !altChanged) return;

    if (active.kind === 'path') setDrag({ ...active, cur: cell, alt: ev.altKey });
    else setDrag({ ...active, cur: cell });
  };

  const onPointerUp = (ev: React.PointerEvent<HTMLCanvasElement>): void => {
    try {
      if (ev.currentTarget.hasPointerCapture(ev.pointerId)) {
        ev.currentTarget.releasePointerCapture(ev.pointerId);
      }
    } catch {
      /* never captured */
    }
    const store = useEditor.getState();
    const active = dragRef.current;

    // No drag was started, so on the line tools this release is a click that
    // places the next corner (B-DRAW-14).
    if (active === null) {
      if ((tool === 'line' || tool === 'arrow') && ev.button === 0) {
        store.addChainPoint(pointerCell(ev), 'pointer');
      }
      return;
    }

    if (active.kind === 'box') {
      const r = rectFromCorners(active.anchor, active.cur);
      if (r.w >= MIN_BOX && r.h >= MIN_BOX) store.drawBox(r);
    } else if (active.kind === 'circle') {
      const r = rectFromCorners(active.anchor, active.cur);
      if (r.w >= MIN_ELLIPSE && r.h >= MIN_ELLIPSE) store.drawEllipse(r);
    } else if (active.kind === 'path') {
      // A press and release on one cell is a click: start a chain instead of
      // committing a zero-length line.
      if (active.anchor.x === active.cur.x && active.anchor.y === active.cur.y) {
        store.addChainPoint(active.anchor, 'pointer');
      } else {
        store.drawPath(active.anchor, active.cur, {
          elbow: elbowFor(active.anchor, active.cur, ev.altKey),
          headEnd: active.arrow,
        });
      }
    } else if (active.kind === 'freehand') {
      store.drawStroke(active.samples);
    } else if (active.kind === 'erase') {
      store.eraseAt(active.cells);
    } else if (active.kind === 'marquee') {
      store.selectRegion(rectFromCorners(active.anchor, active.cur));
    } else if (active.kind === 'resize') {
      const dx = active.cur.x - active.start.x;
      const dy = active.cur.y - active.start.y;

      // A press and release with no movement is a *click*, whatever cell it
      // landed on. Handles cover half a small box's border, so letting them
      // swallow clicks would make the shape impossible to cycle through.
      if (dx === 0 && dy === 0) {
        if (active.repeat) store.drillAt(active.start);
      } else {
        store.resizeSelection(resizeRect(active.from, active.handle, dx, dy));
      }
    } else if (active.kind === 'track') {
      const by =
        active.rail.axis === 'column'
          ? active.cur.x - active.start.x
          : active.cur.y - active.start.y;
      if (by !== 0) store.resizeTrack(active.rail, by);
    } else if (active.kind === 'move') {
      const dx = active.cur.x - active.start.x;
      const dy = active.cur.y - active.start.y;

      // Nothing moved: this was a click, not a drag, so read the cell again
      // (B-REC-11). `drillAt` starts fresh on a cell it has not just answered
      // for and steps outward on one it has, which is what lets a click narrow
      // a big selection down to the line under the pointer — press Ctrl+Enter
      // to take a whole diagram and clicking inside it used to do nothing at
      // all, because the press was inside the selection and so kept it.
      //
      // B-SEL-06 is untouched: the interpretation is still pinned for the whole
      // of a *drag*, which is the case it exists for.
      if (dx === 0 && dy === 0) {
        if (active.repeat) store.drillAt(active.start);
      } else {
        store.moveSelection(dx, dy, active.cells);
      }
    }
    setDrag(null);
  };

  // ---- wheel (non-passive, so zoom can preventDefault) ---------------------

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    const onWheel = (ev: WheelEvent): void => {
      ev.preventDefault();
      const store = useEditor.getState();
      const cam = store.camera;
      const m = metricsFor(cam.zoom);

      // Zoom is on Shift, and sideways on Ctrl. That is the other way round
      // from most programs, where Ctrl+wheel zooms — a deliberate trade: on a
      // character grid a diagram runs off the right-hand edge far more often
      // than it wants resizing, so the commoner want gets the commoner
      // modifier. Ctrl+wheel is still intercepted either way, so the browser's
      // own zoom never fires over the canvas.
      if (ev.shiftKey) {
        const box = canvas.getBoundingClientRect();
        const px = ev.clientX - box.left;
        const py = ev.clientY - box.top;

        const cellX = cam.ox + px / m.cellW;
        const cellY = cam.oy + py / m.cellH;

        const next = clampZoom(cam.zoom * (ev.deltaY < 0 ? 1.1 : 1 / 1.1));
        const nm = metricsFor(next);

        store.setCamera({
          ox: cellX - px / nm.cellW,
          oy: cellY - py / nm.cellH,
          zoom: next,
        });
        return;
      }

      // A wheel only reports deltaY, so sideways means spending that on x.
      // A trackpad reports both, and unmodified it is left alone to do the
      // two-axis scroll it is already doing.
      const dx = ev.ctrlKey ? ev.deltaY : ev.deltaX;
      const dy = ev.ctrlKey ? 0 : ev.deltaY;
      store.setCamera({
        ox: cam.ox + dx / m.cellW,
        oy: cam.oy + dy / m.cellH,
        zoom: cam.zoom,
      });
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  // ---- keyboard (keymap.ts) ------------------------------------------------

  useEffect(() => installKeyboard(() => setDrag(null)), [setDrag]);

  // ---- cursor (B-UI-05) ----------------------------------------------------

  const hoveredRail =
    tool === 'select' && drag === null && hover !== null
      ? railAt(grid, hover.x, hover.y)
      : null;

  let cursor = 'default';
  if (drag?.kind === 'pan') cursor = 'grabbing';
  else if (drag?.kind === 'resize') cursor = RESIZE_CURSOR[drag.handle];
  else if (drag?.kind === 'track') {
    cursor = drag.rail.axis === 'column' ? 'col-resize' : 'row-resize';
  } else if (tool === 'text') cursor = 'text';
  else if (tool !== 'select') cursor = 'crosshair';
  else if (hoveredRail !== null) {
    // Say a separator is grabbable before it is grabbed: a gesture nobody can
    // see is a gesture nobody finds.
    cursor = hoveredRail.axis === 'column' ? 'col-resize' : 'row-resize';
  } else if (
    hover !== null &&
    grid.has(ck(hover.x, hover.y)) &&
    maskOf(grid, hover.x, hover.y) === 0
  ) {
    // Text reads as text under the select tool, because clicking it puts a
    // caret in it. Said before it is clicked for the same reason a separator
    // is: a gesture nobody can see is a gesture nobody finds.
    cursor = 'text';
  } else if (hover !== null && isResizable(selection) && selection !== null) {
    const handle = handleAt(selection.bounds, hover.x, hover.y);
    if (handle !== null) cursor = RESIZE_CURSOR[handle];
    else if (selectionHas(selection, hover)) cursor = 'move';
  } else if (hover !== null && selectionHas(selection, hover)) {
    cursor = 'move';
  }

  return (
    <div className="canvas-wrap" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHover(null)}
        onContextMenu={(ev) => {
          ev.preventDefault();
          // On a Mac a Ctrl+click raises this as well as the press that
          // already handled it. That gesture is add-to-selection here, so the
          // menu stays out of its way.
          if (ev.ctrlKey) return;
          const store = useEditor.getState();

          // On the line tools right-click confirms the chain (B-DRAW-14); that
          // meaning comes first, because a chain in progress is a live gesture.
          if (store.chain !== null) {
            store.commitChain();
            return;
          }
          // Otherwise: the actions menu, but only over the selection itself.
          // Right-clicking past it dismisses rather than reaching for whatever
          // happens to be under the pointer.
          if (tool === 'select' && selectionHas(store.selection, pointerCell(ev))) {
            store.openMenu();
          }
        }}
      />
      <ShapeMenu />
    </div>
  );
}
