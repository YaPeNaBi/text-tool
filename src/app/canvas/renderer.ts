/**
 * Canvas renderer.
 *
 * Draws straight from the grid — there is no intermediate render pipeline, so
 * what is on screen and what `toText()` emits cannot diverge (B-TXT-02).
 * Only visible cells are touched, so document size never affects frame cost
 * (B-CAM-06).
 */

import { ck, unck, type Cell, type CellKey, type Rect } from '../../core/geom/cell.ts';
import type { Grid } from '../../core/grid/grid.ts';
import { isResizable, type Candidate } from '../../core/recognize/recognize.ts';
import { handlesOf } from '../../core/transform/resize.ts';
import {
  cellToScreenX,
  cellToScreenY,
  screenToCell,
  type Camera,
  type Metrics,
  type OriginMode,
} from './camera.ts';
import { COLORS } from './palette.ts';

export interface RenderInput {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  grid: Grid;
  camera: Camera;
  metrics: Metrics;
  originMode: OriginMode;
  selection: Candidate | null;
  /** Uncommitted overlay: key -> char, or null for "erased in preview". */
  preview: Map<CellKey, string | null> | null;
  /** Outline shown while dragging a box or a marquee. */
  previewRect: Rect | null;
  /** The eraser brush footprint under the pointer. */
  brushRect: Rect | null;
  hover: Cell | null;
  /** Cells the open menu is pointing at, lit so "End 1" means something. */
  hint: ReadonlySet<CellKey> | null;
  caret: Cell | null;
  /** Blink phase; the caret is only painted when true. */
  caretOn: boolean;
  /** Corners placed so far on a line being drawn click by click. */
  chain: readonly Cell[] | null;
  /** Where the keyboard is. Always somewhere, in every tool. */
  cursor: Cell;
}

export function render(input: RenderInput): void {
  const { ctx, width, height, grid, camera, metrics, preview } = input;

  ctx.save();
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, width, height);

  const topLeft = screenToCell(0, 0, camera, metrics);
  const bottomRight = screenToCell(width, height, camera, metrics);
  const minX = topLeft.x;
  const minY = topLeft.y;
  const maxX = bottomRight.x + 1;
  const maxY = bottomRight.y + 1;

  drawGrid(input, minX, minY, maxX, maxY);
  drawOriginAxes(input);
  drawSelection(input);
  drawCells(input, minX, minY, maxX, maxY, grid, preview);
  drawPreviewRect(input);
  drawBrush(input);
  drawHandles(input);
  drawChain(input);
  drawHint(input);
  drawHover(input);
  drawCursor(input);
  drawCaret(input);

  ctx.restore();
}

function drawGrid(
  { ctx, metrics, camera, width, height }: RenderInput,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): void {
  if (metrics.cellW < 6 || metrics.cellH < 8) return;

  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();

  for (let x = minX; x <= maxX; x++) {
    const sx = Math.round(cellToScreenX(x, camera, metrics)) + 0.5;
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, height);
  }
  for (let y = minY; y <= maxY; y++) {
    const sy = Math.round(cellToScreenY(y, camera, metrics)) + 0.5;
    ctx.moveTo(0, sy);
    ctx.lineTo(width, sy);
  }
  ctx.stroke();
}

/** The plane's corner should be unmistakable (B-UI-04). */
function drawOriginAxes({ ctx, camera, metrics, width, height }: RenderInput): void {
  ctx.strokeStyle = COLORS.originAxis;
  ctx.lineWidth = 2;
  ctx.beginPath();

  const x0 = Math.round(cellToScreenX(0, camera, metrics)) + 0.5;
  const y0 = Math.round(cellToScreenY(0, camera, metrics)) + 0.5;

  if (x0 >= 0 && x0 <= width) {
    ctx.moveTo(x0, 0);
    ctx.lineTo(x0, height);
  }
  if (y0 >= 0 && y0 <= height) {
    ctx.moveTo(0, y0);
    ctx.lineTo(width, y0);
  }
  ctx.stroke();
}

function drawCells(
  { ctx, camera, metrics }: RenderInput,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  grid: Grid,
  preview: Map<CellKey, string | null> | null,
): void {
  ctx.font = metrics.font;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillStyle = COLORS.text;

  const halfW = metrics.cellW / 2;
  const halfH = metrics.cellH / 2;

  for (let y = minY; y <= maxY; y++) {
    const sy = cellToScreenY(y, camera, metrics) + halfH;

    for (let x = minX; x <= maxX; x++) {
      const key = ck(x, y);

      let ch: string | null | undefined;
      if (preview !== null && preview.has(key)) ch = preview.get(key);
      else ch = grid.get(key);

      if (ch === null || ch === undefined || ch === ' ') continue;

      const isPreviewCell = preview !== null && preview.has(key);
      ctx.fillStyle = isPreviewCell ? COLORS.preview : COLORS.text;
      ctx.fillText(ch, cellToScreenX(x, camera, metrics) + halfW, sy);
    }
  }
}

function drawSelection({ ctx, camera, metrics, selection }: RenderInput): void {
  if (selection === null) return;

  ctx.fillStyle = COLORS.selectionFill;
  for (const key of selection.cells) {
    const { x, y } = unck(key);
    ctx.fillRect(
      cellToScreenX(x, camera, metrics),
      cellToScreenY(y, camera, metrics),
      metrics.cellW,
      metrics.cellH,
    );
  }

  const b = selection.bounds;
  ctx.strokeStyle = COLORS.selectionStroke;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(
    Math.round(cellToScreenX(b.x, camera, metrics)) + 0.5,
    Math.round(cellToScreenY(b.y, camera, metrics)) + 0.5,
    b.w * metrics.cellW - 1,
    b.h * metrics.cellH - 1,
  );
  ctx.setLineDash([]);
}

function drawPreviewRect({ ctx, camera, metrics, previewRect }: RenderInput): void {
  if (previewRect === null) return;

  ctx.fillStyle = COLORS.previewFill;
  ctx.strokeStyle = COLORS.preview;
  ctx.lineWidth = 1;

  const sx = Math.round(cellToScreenX(previewRect.x, camera, metrics)) + 0.5;
  const sy = Math.round(cellToScreenY(previewRect.y, camera, metrics)) + 0.5;
  const w = previewRect.w * metrics.cellW - 1;
  const h = previewRect.h * metrics.cellH - 1;

  ctx.fillRect(sx, sy, w, h);
  ctx.strokeRect(sx, sy, w, h);
}

/** Grab points on a recognised closed outline (B-MAN-09). */
function drawHandles({ ctx, camera, metrics, selection }: RenderInput): void {
  if (!isResizable(selection) || selection === null) return;
  // Below this the handles cover the glyphs they sit on and help nobody.
  if (metrics.cellW < 5 || metrics.cellH < 7) return;

  const size = Math.max(5, Math.min(metrics.cellW, metrics.cellH) - 2);

  for (const h of handlesOf(selection.bounds)) {
    const cx = cellToScreenX(h.x, camera, metrics) + metrics.cellW / 2;
    const cy = cellToScreenY(h.y, camera, metrics) + metrics.cellH / 2;
    const x = Math.round(cx - size / 2);
    const y = Math.round(cy - size / 2);

    ctx.fillStyle = COLORS.handleCore;
    ctx.fillRect(x, y, size, size);
    ctx.strokeStyle = COLORS.handle;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
  }
}

function drawBrush({ ctx, camera, metrics, brushRect }: RenderInput): void {
  if (brushRect === null) return;

  ctx.fillStyle = COLORS.eraseFill;
  ctx.strokeStyle = COLORS.erase;
  ctx.lineWidth = 1;

  const sx = Math.round(cellToScreenX(brushRect.x, camera, metrics)) + 0.5;
  const sy = Math.round(cellToScreenY(brushRect.y, camera, metrics)) + 0.5;
  const w = brushRect.w * metrics.cellW - 1;
  const h = brushRect.h * metrics.cellH - 1;

  ctx.fillRect(sx, sy, w, h);
  ctx.strokeRect(sx, sy, w, h);
}

/** Corners already placed, so it is clear where the line will turn (B-DRAW-14). */
function drawChain({ ctx, camera, metrics, chain }: RenderInput): void {
  if (chain === null || chain.length === 0) return;

  const size = Math.max(4, Math.min(metrics.cellW, metrics.cellH) - 3);
  ctx.fillStyle = COLORS.preview;

  for (const point of chain) {
    const cx = cellToScreenX(point.x, camera, metrics) + metrics.cellW / 2;
    const cy = cellToScreenY(point.y, camera, metrics) + metrics.cellH / 2;
    ctx.fillRect(Math.round(cx - size / 2), Math.round(cy - size / 2), size, size);
  }
}

/** A bar on the leading edge of the cell, so it reads as "type here" (B-DRAW-11). */
function drawCaret({ ctx, camera, metrics, caret, caretOn }: RenderInput): void {
  if (caret === null || !caretOn) return;

  ctx.fillStyle = COLORS.caret;
  ctx.fillRect(
    Math.round(cellToScreenX(caret.x, camera, metrics)),
    Math.round(cellToScreenY(caret.y, camera, metrics)),
    Math.max(2, Math.round(metrics.cellW * 0.12)),
    metrics.cellH,
  );
}

/**
 * The keyboard's own square.
 *
 * Deliberately louder than the hover outline and a different colour: the hover
 * says where the pointer happens to be, this says where the next keystroke will
 * land. When both are visible they mean different things and must not be
 * mistaken for each other.
 *
 * The square and the caret are the same position drawn two ways, and only ever
 * one of them at a time (B-UI-10): the bar says "this is writing", the square
 * says "this is where writing would start". Two markers in two places was the
 * bug — it read as two cursors, and people reasonably asked which one the
 * keyboard was actually pointing at.
 */
function drawCursor({ ctx, camera, metrics, cursor, caret }: RenderInput): void {
  if (caret !== null) return;

  ctx.strokeStyle = COLORS.cursor;
  ctx.lineWidth = 2;
  ctx.strokeRect(
    Math.round(cellToScreenX(cursor.x, camera, metrics)) + 1,
    Math.round(cellToScreenY(cursor.y, camera, metrics)) + 1,
    metrics.cellW - 2,
    metrics.cellH - 2,
  );
  ctx.lineWidth = 1;
}

/**
 * The cells the menu is pointing at.
 *
 * Drawn under the hover and over the selection, because it is answering a
 * question the selection cannot: *which* end of this line is "End 1". A wash
 * rather than an outline, so it reads as attention rather than as a second
 * selection.
 */
function drawHint({ ctx, camera, metrics, hint }: RenderInput): void {
  if (hint === null) return;

  ctx.fillStyle = COLORS.hint;
  ctx.strokeStyle = COLORS.hintStroke;
  ctx.lineWidth = 1;

  for (const key of hint) {
    const { x, y } = unck(key);
    const sx = Math.round(cellToScreenX(x, camera, metrics));
    const sy = Math.round(cellToScreenY(y, camera, metrics));
    ctx.fillRect(sx, sy, metrics.cellW, metrics.cellH);
    ctx.strokeRect(sx + 0.5, sy + 0.5, metrics.cellW - 1, metrics.cellH - 1);
  }
}

function drawHover({ ctx, camera, metrics, hover }: RenderInput): void {
  if (hover === null) return;

  ctx.strokeStyle = COLORS.hover;
  ctx.lineWidth = 1;
  ctx.strokeRect(
    Math.round(cellToScreenX(hover.x, camera, metrics)) + 0.5,
    Math.round(cellToScreenY(hover.y, camera, metrics)) + 0.5,
    metrics.cellW - 1,
    metrics.cellH - 1,
  );
}
