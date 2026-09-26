/**
 * The one palette, for both renderers.
 *
 * Lifted out of `renderer.ts` when the terminal build arrived, the third time
 * this has happened for the same reason (`tools.ts`, `ribbon-items.ts`,
 * `steps.ts`): the canvas paints these into a 2D context and the terminal turns
 * them into SGR escapes, and a selection that is blue in one window and green in
 * the other is a bug nobody would think to look for in a colour table.
 *
 * Kept as CSS colour strings rather than as structured triples because the
 * canvas takes them verbatim and it is the commoner of the two consumers; the
 * terminal parses them on the way out (`terminal/ansi.ts`). The alpha values are
 * meaningful there too — a terminal cell has no transparency, so a wash is
 * composited against `bg` to get the flat colour the same wash would have
 * produced on screen.
 */

export const COLORS = {
  bg: '#0f1115',
  grid: '#1b1f27',
  originAxis: '#39414f',
  text: '#dfe4ec',
  selectionFill: 'rgba(88, 166, 255, 0.16)',
  selectionStroke: '#58a6ff',
  handle: '#58a6ff',
  handleCore: '#0f1115',
  preview: '#7ee787',
  previewFill: 'rgba(126, 231, 135, 0.10)',
  erase: '#f0806c',
  eraseFill: 'rgba(240, 128, 108, 0.12)',
  caret: '#7ee787',
  cursor: '#e3b341',
  hover: '#3a4451',
  hint: 'rgba(227, 179, 65, 0.30)',
  hintStroke: '#e3b341',
} as const;

/**
 * How long a transient outcome stays on screen (B-UI-09).
 *
 * Here rather than beside the toolbar that first needed it, because the terminal
 * has to clear its own on the same timer and a notice that lingers in one build
 * and not the other is the same kind of quiet drift the palette above is here to
 * prevent.
 */
export const NOTICE_MS = 2000;
