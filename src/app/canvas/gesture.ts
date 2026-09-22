/**
 * A gesture in flight, and what it looks like before it commits.
 *
 * Every gesture previews against the **unmodified** grid and writes exactly once
 * on release, which is what makes one drag one undo step (B-DRAW-04, B-MAN-02)
 * and what makes occlusion gesture-scoped (B-MAN-03). Keeping the preview a pure
 * function of the gesture is how that stays true: there is nowhere here to write
 * to, so a preview that accidentally mutated could not compile.
 *
 * It is also the one place that knows a drag and a keyboard draft are the same
 * thing seen twice. Both pin one corner and follow the other — the pointer with
 * a drag, the arrow keys with `Space` — so both come out of `rectPreview` rather
 * than out of two lists of branches that have to agree about MIN_BOX.
 */

import { rectFromCorners, type Cell, type CellKey, type Rect } from '../../core/geom/cell.ts';
import type { Charset } from '../../core/charset/charsets.ts';
import type { CellDiff, Grid } from '../../core/grid/grid.ts';
import type { Candidate } from '../../core/recognize/recognize.ts';
import { MIN_BOX, stampBox } from '../../core/stamp/box.ts';
import { MIN_ELLIPSE, stampEllipse } from '../../core/stamp/ellipse.ts';
import { stampPath, stampPolyline, type Elbow } from '../../core/stamp/path.ts';
import { eraseWithHeal } from '../../core/stamp/erase.ts';
import { stampStroke } from '../../core/stamp/freehand.ts';
import { planMove } from '../../core/ops/move.ts';
import { planResizeTrack, type Rail } from '../../core/ops/lattice.ts';
import { resizeBoxDiff, resizeRect, type HandleId } from '../../core/transform/resize.ts';
import type { ToolId } from '../tools.ts';

export type Drag =
  | { kind: 'box'; anchor: Cell; cur: Cell }
  | { kind: 'circle'; anchor: Cell; cur: Cell }
  | { kind: 'path'; anchor: Cell; cur: Cell; arrow: boolean; alt: boolean }
  | { kind: 'erase'; cur: Cell; cells: Set<CellKey> }
  /** A stroke being dragged by hand: every cell the pointer has been in. */
  | { kind: 'freehand'; cur: Cell; samples: Cell[] }
  /** `repeat` marks a second click on a cell that was already selected. */
  | { kind: 'move'; start: Cell; cur: Cell; cells: Set<CellKey>; bounds: Rect; repeat: boolean }
  | { kind: 'resize'; handle: HandleId; start: Cell; cur: Cell; from: Rect; repeat: boolean }
  | { kind: 'marquee'; anchor: Cell; cur: Cell }
  /** Dragging a table separator to resize the track beside it (tables §7). */
  | { kind: 'track'; rail: Rail; start: Cell; cur: Cell }
  | { kind: 'pan'; sx: number; sy: number; cam: Camera };

/** Just enough of the camera to remember where a pan started from. */
interface Camera {
  ox: number;
  oy: number;
  zoom: number;
}

/** A shape being drawn from the keyboard: one corner pinned, the cursor the other. */
export interface Draft {
  kind: 'box' | 'circle';
  anchor: Cell;
}

/** `auto` follows the longer axis; Alt asks for the other elbow. */
export function elbowFor(anchor: Cell, cur: Cell, alt: boolean): Elbow {
  if (!alt) return 'auto';
  return Math.abs(cur.x - anchor.x) >= Math.abs(cur.y - anchor.y) ? 'v-first' : 'h-first';
}

export interface PreviewInput {
  grid: Grid;
  charset: Charset;
  /** Lines attached to what is moving are redrawn to follow it (B-MAN-11). */
  sticky: boolean;
  /** Quadrant mode clamps at the origin instead of refusing (B-PLANE-04). */
  clampToOrigin: boolean;
  drag: Drag | null;
  draft: Draft | null;
  /** Corners placed so far on a line being drawn click by click (B-DRAW-14). */
  chain: readonly Cell[] | null;
  /** Which input aims that chain's unplaced last leg (B-DRAW-14d). */
  chainAim: 'pointer' | 'keyboard';
  selection: Candidate | null;
  tool: ToolId;
  brush: number;
  hover: Cell | null;
  /** Where the keyboard is, which aims a draft or a chain when the pointer is not. */
  cursor: Cell;
}

export interface Preview {
  /** Uncommitted overlay: key -> char, or null for "erased in preview". */
  cells: CellDiff | null;
  /** Outline shown while dragging a box, a marquee or a resize. */
  rect: Rect | null;
  /** The eraser brush footprint under the pointer. */
  brush: Rect | null;
}

const NOTHING: Preview = { cells: null, rect: null, brush: null };

/**
 * The characters a rectangle gesture would leave — once it is big enough to be
 * one. Below the minimum there is still an outline to show, so the answer is
 * null rather than an empty diff and the caller keeps drawing the rect.
 */
function rectPreview(
  grid: Grid,
  kind: 'box' | 'circle',
  r: Rect,
  cs: Charset,
): CellDiff | null {
  const min = kind === 'box' ? MIN_BOX : MIN_ELLIPSE;
  if (r.w < min || r.h < min) return null;
  return kind === 'box' ? stampBox(grid, r, cs) : stampEllipse(grid, r, cs);
}

/** What the canvas should draw on top of the document this frame. */
export function previewOf(input: PreviewInput): Preview {
  const { drag, draft, chain, tool, hover } = input;

  const brush =
    tool === 'erase' && hover !== null && drag?.kind !== 'pan'
      ? brushFootprint(hover, input.brush)
      : null;

  // The pointer speaks first, and the keyboard fills the silence: a middle-drag
  // pan is still a drag, but it draws nothing, so a chain being aimed underneath
  // it stays on screen. A rect the pointer put up survives the same way unless
  // the keyboard has one of its own.
  const pointer = drag !== null ? fromDrag(input, drag) : NOTHING;
  if (pointer.cells !== null) return { ...pointer, brush };

  const keys = fromKeyboard(input, draft, chain);
  return { cells: keys.cells, rect: keys.rect ?? pointer.rect, brush };
}

/** Centred on the pointer, and never off the left or top of the plane. */
function brushFootprint(at: Cell, size: number): Rect {
  const half = Math.floor((size - 1) / 2);
  return { x: Math.max(0, at.x - half), y: Math.max(0, at.y - half), w: size, h: size };
}

function fromDrag(input: PreviewInput, drag: Drag): Omit<Preview, 'brush'> {
  const { grid, charset, selection, sticky, clampToOrigin } = input;

  switch (drag.kind) {
    case 'box':
    case 'circle': {
      const r = rectFromCorners(drag.anchor, drag.cur);
      return { cells: rectPreview(grid, drag.kind, r, charset), rect: r };
    }

    case 'path':
      return {
        cells: stampPath(grid, drag.anchor, drag.cur, charset, {
          elbow: elbowFor(drag.anchor, drag.cur, drag.alt),
          headEnd: drag.arrow,
        }),
        rect: null,
      };

    case 'erase':
      return { cells: eraseWithHeal(grid, drag.cells, charset), rect: null };

    case 'freehand':
      return { cells: stampStroke(grid, drag.samples, charset), rect: null };

    case 'marquee':
      return { cells: null, rect: rectFromCorners(drag.anchor, drag.cur) };

    case 'track': {
      const { rail } = drag;
      const by = rail.axis === 'column' ? drag.cur.x - drag.start.x : drag.cur.y - drag.start.y;
      const plan = planResizeTrack(grid, rail.table, rail.axis, rail.at, by, { charset, sticky });
      return { cells: plan.diff, rect: null };
    }

    case 'resize': {
      const to = resizeRect(
        drag.from,
        drag.handle,
        drag.cur.x - drag.start.x,
        drag.cur.y - drag.start.y,
      );
      return { cells: resizeBoxDiff(grid, drag.from, to, charset), rect: to };
    }

    case 'move': {
      if (selection === null) return { cells: null, rect: null };
      // The full plan, so the preview shows the contents and the re-routed
      // connectors coming along rather than only the outline.
      const plan = planMove(
        grid,
        selection,
        drag.cur.x - drag.start.x,
        drag.cur.y - drag.start.y,
        { charset, sticky, clampToOrigin, cells: drag.cells },
      );
      return { cells: plan.diff, rect: null };
    }

    case 'pan':
      return { cells: null, rect: null };
  }
}

/**
 * The same two previews, aimed by the keyboard instead of the pointer. A draft
 * is a drag with the cursor for its free corner; a chain is a polyline through
 * every corner placed so far, plus the segment currently being aimed.
 */
function fromKeyboard(
  input: PreviewInput,
  draft: Draft | null,
  chain: readonly Cell[] | null,
): Omit<Preview, 'brush'> {
  const { grid, charset, tool, hover, cursor, chainAim } = input;

  if (draft !== null) {
    const r = rectFromCorners(draft.anchor, cursor);
    return { cells: rectPreview(grid, draft.kind, r, charset), rect: r };
  }

  if (chain !== null) {
    // Aimed by whichever input is driving *this* chain, not by whichever one
    // happens to be over the canvas. A pointer resting on the grid used to win
    // outright, which meant a line started with `Space` ignored the arrow keys
    // completely — the cursor moved and the preview did not (B-DRAW-14d).
    const points = [...chain, chainAim === 'pointer' ? hover ?? cursor : cursor];
    if (points.length < 2) return NOTHING;
    return {
      cells: stampPolyline(grid, points, charset, { headEnd: tool === 'arrow' }),
      rect: null,
    };
  }

  return NOTHING;
}
