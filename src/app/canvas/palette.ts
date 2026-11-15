/**
 * The palettes, for both renderers: light, the default, and dark (B-UI-18).
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
 *
 * Two themes, one shape: `Palette` is the list of every colour either renderer
 * asks for, so a theme missing one does not compile. The page chrome around the
 * canvas is CSS (`styles.css`), whose `--bg` for each theme must match the `bg`
 * here — a test reads the stylesheet and holds the two to it.
 */

export type Theme = 'light' | 'dark';

export interface Palette {
  bg: string;
  grid: string;
  originAxis: string;
  text: string;
  selectionFill: string;
  selectionStroke: string;
  handle: string;
  handleCore: string;
  preview: string;
  previewFill: string;
  erase: string;
  eraseFill: string;
  caret: string;
  cursor: string;
  hover: string;
  hint: string;
  hintStroke: string;
}

/**
 * Ink on paper. Each colour keeps the job it has in the dark theme and the same
 * distance from the page: the grid as faint against white as it is against
 * near-black, the origin a step louder, and every accent dark enough that the
 * terminal can still print the page colour on top of it legibly — a lit menu
 * item is white on the cursor's amber, a notice white on it too.
 */
const LIGHT: Palette = {
  bg: '#ffffff',
  grid: '#eaeef2',
  originAxis: '#9aa4b0',
  text: '#1f2328',
  selectionFill: 'rgba(9, 105, 218, 0.12)',
  selectionStroke: '#0969da',
  handle: '#0969da',
  handleCore: '#ffffff',
  preview: '#1a7f37',
  previewFill: 'rgba(26, 127, 55, 0.10)',
  erase: '#cf222e',
  eraseFill: 'rgba(207, 34, 46, 0.10)',
  caret: '#1a7f37',
  cursor: '#9a6700',
  hover: '#b4bcc6',
  hint: 'rgba(212, 167, 44, 0.35)',
  hintStroke: '#9a6700',
};

/** The original theme, unchanged. */
const DARK: Palette = {
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
};

export const PALETTES: Readonly<Record<Theme, Palette>> = { light: LIGHT, dark: DARK };

/**
 * Light unless the user has chosen otherwise (B-UI-18). The system's own
 * light/dark preference is deliberately not consulted: light is the standard,
 * and switching is one checkbox, remembered.
 */
export const DEFAULT_THEME: Theme = 'light';

export function isTheme(v: unknown): v is Theme {
  return v === 'light' || v === 'dark';
}

/**
 * How long a transient outcome stays on screen (B-UI-09).
 *
 * Here rather than beside the toolbar that first needed it, because the terminal
 * has to clear its own on the same timer and a notice that lingers in one build
 * and not the other is the same kind of quiet drift the palette above is here to
 * prevent.
 */
export const NOTICE_MS = 2000;
