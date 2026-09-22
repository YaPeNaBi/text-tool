/**
 * Camera and cell metrics.
 *
 * Cell size is measured from the font at runtime, never hardcoded
 * (B-CAM-05), so the grid stays correct across platforms and font stacks —
 * which is what keeps the eventual desktop builds honest.
 */

import type { Cell } from '../../core/geom/cell.ts';

export interface Camera {
  /** Top-left cell of the viewport. Fractional for smooth panning. */
  ox: number;
  oy: number;
  zoom: number;
}

export type OriginMode = 'quadrant' | 'infinite';

export const BASE_FONT = 14;
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 3;

export const FONT_STACK =
  '"Cascadia Mono", "Cascadia Code", Consolas, "DejaVu Sans Mono", Menlo, monospace';

export interface Metrics {
  fontSize: number;
  cellW: number;
  cellH: number;
  font: string;
}

const cache = new Map<number, Metrics>();
let measureCtx: CanvasRenderingContext2D | null = null;

function measureAdvance(font: string): number {
  if (measureCtx === null) {
    const canvas = document.createElement('canvas');
    measureCtx = canvas.getContext('2d');
  }
  if (measureCtx === null) return BASE_FONT * 0.6;
  measureCtx.font = font;
  // 'M' is a safe reference glyph in any monospace face.
  return measureCtx.measureText('M').width;
}

export function metricsFor(zoom: number): Metrics {
  const fontSize = Math.max(6, Math.round(BASE_FONT * zoom));
  const hit = cache.get(fontSize);
  if (hit !== undefined) return hit;

  const font = `${fontSize}px ${FONT_STACK}`;
  // Floor the advance so horizontal box glyphs overlap by a hair rather than
  // leaving seams between cells.
  const cellW = Math.max(1, Math.floor(measureAdvance(font)));
  const cellH = Math.max(1, Math.round(fontSize * 1.2));

  const m: Metrics = { fontSize, cellW, cellH, font };
  cache.set(fontSize, m);
  return m;
}

export function screenToCell(px: number, py: number, cam: Camera, m: Metrics): Cell {
  return {
    x: Math.floor(cam.ox + px / m.cellW),
    y: Math.floor(cam.oy + py / m.cellH),
  };
}

export function cellToScreenX(x: number, cam: Camera, m: Metrics): number {
  return (x - cam.ox) * m.cellW;
}

export function cellToScreenY(y: number, cam: Camera, m: Metrics): number {
  return (y - cam.oy) * m.cellH;
}

/** The camera never shows negative space in quadrant mode (B-CAM-01). */
export function clampCamera(cam: Camera, mode: OriginMode): Camera {
  if (mode === 'infinite') return cam;
  return { ...cam, ox: Math.max(0, cam.ox), oy: Math.max(0, cam.oy) };
}

export function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}
