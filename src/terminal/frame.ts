/**
 * The terminal renderer: one frame, drawn straight from the grid.
 *
 * `canvas/renderer.ts`'s job, for a screen whose pixels are already characters —
 * which makes this both the simplest of the two renderers and the one with the
 * most decisions in it, because a terminal cell cannot do most of what a canvas
 * does. The layers are painted in the canvas renderer's order, for the same
 * reasons it gives, and three of them had to become something else:
 *
 *   - **The grid lines are gone.** They are drawn between cells, and between two
 *     terminal cells there is nothing. Nothing stands in for them: the cursor
 *     says where the keyboard is and the status line says where the view starts,
 *     which is what the grid was mostly being read for.
 *
 *   - **Every outline became a wash.** A marquee, a box being dragged, the
 *     eraser's footprint: the canvas strokes a thin rectangle *around* cells, and
 *     the only way to mark a cell here is to colour the cell. So they are painted
 *     as backgrounds, which is why the palette's alpha values matter (see
 *     `colorOf`) — a 16% wash composited against the page is the flat colour the
 *     canvas actually produces, so the two builds agree.
 *
 *   - **The caret is not drawn at all.** The terminal has a real cursor that can
 *     be a blinking bar or a steady block, which is exactly the two readings
 *     B-UI-10 asks for, already blinking in step with every other cursor on the
 *     machine. So the position is handed to the terminal and the shape says what
 *     the cell is *for*, and B-UI-07 comes free.
 */

import { ck, unck, type CellKey, type Rect } from '../core/geom/cell.ts';
import { CHARSETS } from '../core/charset/charsets.ts';
import { describe, isResizable } from '../core/recognize/recognize.ts';
import { handlesOf } from '../core/transform/resize.ts';
import { COLORS } from '../app/canvas/palette.ts';
import { previewOf, type Drag } from '../app/canvas/gesture.ts';
import { groupsFor, type Group, type Item } from '../app/components/ribbon-items.ts';
import {
  isGroup,
  menuClear,
  menuFor,
  useEditor,
  windowOf,
  type MenuNode,
} from '../app/state/store.ts';
import { TOOLS } from '../app/tools.ts';
import { colorOf, CURSOR_BAR, CURSOR_BLOCK, type Screen } from './ansi.ts';
import type { Viewport } from './pointer.ts';

/**
 * The palette, resolved once into packed colours.
 *
 * The washes are composited against the page here rather than at each call site,
 * so a cell painted as "selected" is one number rather than a mix recomputed on
 * every frame.
 */
const C = {
  text: colorOf(COLORS.text),
  dim: colorOf(COLORS.originAxis),
  page: colorOf(COLORS.bg),
  chrome: colorOf(COLORS.grid),
  selection: colorOf(COLORS.selectionFill, COLORS.bg),
  selectionEdge: colorOf(COLORS.selectionStroke),
  preview: colorOf(COLORS.preview),
  previewFill: colorOf(COLORS.previewFill, COLORS.bg),
  erase: colorOf(COLORS.erase),
  eraseFill: colorOf(COLORS.eraseFill, COLORS.bg),
  handle: colorOf(COLORS.handle),
  cursor: colorOf(COLORS.cursor),
  hover: colorOf(COLORS.hover),
  hint: colorOf(COLORS.hint, COLORS.bg),
} as const;

/**
 * How tall the key band is: a row of group names and three rows of keys under
 * them.
 *
 * Three because that is what the web ribbon lays out — "the band lays out three
 * rows to a column" — and a band of the same shape in both builds is a band a
 * hand learns once. A group with more than three rows spills into another column
 * here exactly as it does there.
 */
const BAND_ITEM_ROWS = 3;
const BAND_ROWS = BAND_ITEM_ROWS + 1;

export interface Layout {
  /** Where the canvas is, for the mouse and the camera. */
  view: Viewport;
  bandTop: number;
  bandRows: number;
  statusRow: number;
}

/**
 * Where everything goes, for a terminal this tall.
 *
 * Split out from the painting because the camera has to be scrolled *before* the
 * frame is composed and it cannot be scrolled without knowing how many rows the
 * canvas got — and the number of rows depends on whether the band is up.
 */
export function layoutOf(width: number, height: number, band: boolean): Layout {
  // A band that would leave fewer than three rows of canvas is not help, it is
  // the thing in the way of the document, so a short window simply does not get
  // one until it is resized.
  const bandRows = band && height >= BAND_ROWS + 5 ? BAND_ROWS : 0;
  const statusRow = height - 1;
  return {
    view: { top: 1, width, height: Math.max(1, height - 2 - bandRows) },
    bandTop: statusRow - bandRows,
    bandRows,
    statusRow,
  };
}

/**
 * Scroll so the keyboard is on screen, with a cell of air around it.
 *
 * The web build has no such thing: its viewport is a window, tall enough that
 * walking off the bottom of it is unusual and a scrollbar is there when it
 * happens. Twenty-four rows is not that, and a cursor that has walked off the
 * frame is a cursor nobody can find. One cell of margin rather than a scrolloff
 * of several, because the canvas is short enough that every row it gives back
 * matters.
 */
export function follow(layout: Layout): void {
  const store = useEditor.getState();
  const at = store.caret ?? store.cursor;
  const cam = store.camera;

  const width = layout.view.width;
  const height = layout.view.height;
  let ox = Math.floor(cam.ox);
  let oy = Math.floor(cam.oy);

  if (at.x < ox + 1) ox = at.x - 1;
  if (at.x > ox + width - 2) ox = at.x - width + 2;
  if (at.y < oy + 1) oy = at.y - 1;
  if (at.y > oy + height - 2) oy = at.y - height + 2;

  if (ox === Math.floor(cam.ox) && oy === Math.floor(cam.oy)) return;
  // `setCamera` clamps at the origin in quadrant mode (B-CAM-01), so a cursor in
  // the top-left corner does not drag the view into space that cannot exist.
  store.setCamera({ ox, oy, zoom: 1 });
}

export interface FrameInput {
  screen: Screen;
  layout: Layout;
  /** The mouse gesture in flight, which previews like a keyboard draft does. */
  drag: Drag | null;
  /** The file dialog, drawn over the status line while it is open. */
  prompt: Prompt | null;
}

/** A question on the bottom row: the platform's file dialog, and the quit check. */
export interface Prompt {
  question: string;
  value: string;
  /** What the keys do, since a dialog nobody can leave is the worst kind. */
  hint: string;
}

export interface Cursor {
  x: number;
  y: number;
  shape: string;
}

/**
 * Where one menu item was drawn, so a click can find it.
 *
 * The web build needs nothing like this: a DOM button knows it was clicked. A
 * terminal has only a row and a column, so the one place that knows the menu's
 * geometry — the code that just drew it — has to write it down.
 */
export interface MenuHit {
  row: number;
  /** Inclusive first column, exclusive last. */
  from: number;
  to: number;
  path: readonly number[];
  label: string;
  /** The highlighted item of its row, and whether its own row is showing. */
  lit: boolean;
  open: boolean;
}

export function paint({ screen, layout, drag, prompt }: FrameInput): Cursor | null {
  const store = useEditor.getState();
  screen.clear();

  const view = layout.view;
  const preview = previewOf({
    grid: store.grid,
    charset: store.charset(),
    sticky: store.sticky,
    clampToOrigin: store.originMode === 'quadrant',
    drag,
    draft: store.draft,
    chain: store.chain,
    chainAim: store.chainAim,
    selection: store.selection,
    tool: store.tool,
    brush: store.brush,
    hover: store.hover,
    cursor: store.cursor,
    menu: store.menuOpen ? store.menuPreview : null,
  });

  drawToolbar(screen, store);
  const cursor = drawCanvas(screen, view, store, preview);
  drawMenu(screen, view);
  if (layout.bandRows > 0) drawBand(screen, layout, store);
  if (prompt === null) drawStatus(screen, layout, store);
  else drawPrompt(screen, layout, prompt);

  return prompt === null
    ? cursor
    : { x: promptCaret(screen, prompt), y: layout.statusRow, shape: CURSOR_BAR };
}

type Store = ReturnType<typeof useEditor.getState>;
type Preview = ReturnType<typeof previewOf>;

// ---- the canvas ------------------------------------------------------------

function drawCanvas(screen: Screen, view: Viewport, store: Store, preview: Preview): Cursor | null {
  const ox = Math.floor(store.camera.ox);
  const oy = Math.floor(store.camera.oy);

  /** A document cell's place on screen, or null when it is not on it. */
  const at = (x: number, y: number): { col: number; row: number } | null => {
    const col = x - ox;
    const row = y - oy + view.top;
    if (col < 0 || col >= screen.width) return null;
    if (row < view.top || row >= view.top + view.height) return null;
    return { col, row };
  };

  const washKeys = (keys: Iterable<CellKey>, bg: number): void => {
    for (const key of keys) {
      const { x, y } = unck(key);
      const p = at(x, y);
      if (p !== null) screen.wash(p.col, p.row, bg);
    }
  };

  const washRect = (r: Rect, bg: number): void => {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        const p = at(x, y);
        if (p !== null) screen.wash(p.col, p.row, bg);
      }
    }
  };

  // ① the selection, under everything — a wash, as on the canvas.
  if (store.selection !== null) washKeys(store.selection.cells, C.selection);

  // ② the characters, and the preview's characters over them.
  const cells = preview.cells;
  for (let row = 0; row < view.height; row++) {
    const y = oy + row;
    for (let col = 0; col < screen.width; col++) {
      const x = ox + col;
      const key = ck(x, y);

      const drafted = cells !== null && cells.has(key);
      const ch = drafted ? cells.get(key) : store.grid.get(key);
      if (ch === null || ch === undefined || ch === ' ') continue;

      // `glyph`, not `put`: the selection wash is already on this cell and the
      // character goes over it, the way `fillText` follows `fillRect`.
      screen.glyph(col, view.top + row, ch, drafted ? C.preview : C.text);
    }
  }

  // ③ the outline of a rectangle gesture, which a terminal can only fill.
  if (preview.rect !== null) washRect(preview.rect, C.previewFill);
  if (preview.brush !== null) washRect(preview.brush, C.eraseFill);

  // ④ the grab points on a closed outline (B-MAN-09). The canvas draws a small
  //    square beside the glyph; there is no beside here, so the glyph itself is
  //    lit and emboldened.
  if (isResizable(store.selection) && store.selection !== null) {
    for (const h of handlesOf(store.selection.bounds)) {
      const p = at(h.x, h.y);
      if (p === null) continue;
      const ch = store.grid.get(ck(h.x, h.y)) ?? '·';
      screen.glyph(p.col, p.row, ch, C.handle, true);
    }
  }

  // ⑤ corners already placed on a line being drawn (B-DRAW-14), reversed out so
  //    a placed corner cannot be mistaken for the preview running through it.
  if (store.chain !== null) {
    for (const point of store.chain) {
      const p = at(point.x, point.y);
      if (p === null) continue;
      const ch = preview.cells?.get(ck(point.x, point.y)) ?? store.grid.get(ck(point.x, point.y));
      screen.put(p.col, p.row, ch ?? '•', C.page, C.preview, true);
    }
  }

  // ⑥ what the open menu is pointing at, so "End 1" means something.
  if (store.menuHint !== null) washKeys(store.menuHint, C.hint);

  // ⑦ the pointer's cell, which says something different from the cursor — but
  //    only while the two are apart, since a mouse that just clicked put the
  //    cursor exactly here and two markers on one cell read as two cursors.
  if (store.hover !== null && !samePlace(store.hover, store.cursor)) {
    const p = at(store.hover.x, store.hover.y);
    if (p !== null) screen.wash(p.col, p.row, C.hover);
  }

  // ⑧ the keyboard's one position (B-UI-10), handed to the terminal's own cursor.
  const point = store.caret ?? store.cursor;
  const p = at(point.x, point.y);
  if (p === null) return null;
  return { x: p.col, y: p.row, shape: store.caret !== null ? CURSOR_BAR : CURSOR_BLOCK };
}

function samePlace(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return a.x === b.x && a.y === b.y;
}

// ---- the actions menu ------------------------------------------------------

/**
 * The menu the web build draws as a floating strip (`ShapeMenu.tsx`).
 *
 * It was missing here until the font menu needed it, and its absence was the
 * quiet kind: `e` opened a menu the keys would happily walk and nothing on
 * screen said so. Everything about *what* it offers and *where the highlight
 * is* comes from the store, exactly as the web one does, so the two cannot
 * disagree about what the item at index 1 means.
 *
 * Anchored under the selection and flipped above it when there is no room —
 * the same rule as the web build, for the same reason: the menu must never
 * cover the thing it acts on, which here is often the very text being previewed
 * in a font.
 */
/**
 * Where every item of the open menu sits on screen.
 *
 * Derived, never remembered. The first version of this cached what the last
 * frame drew, and a pty test found the hole in that immediately: two mouse
 * events arriving in one read are handled before any frame runs, so the click
 * was tested against the geometry of a menu that did not exist yet. Computing it
 * on demand costs a few dozen string lengths and cannot be stale.
 *
 * Both callers read the same list — `drawMenu` to paint it, the shell to decide
 * what a click landed on — so what is on screen and what is clickable are one
 * fact rather than two that have to agree.
 */
export function menuHitsFor(width: number, view: Viewport): MenuHit[] {
  const store = useEditor.getState();
  const hits: MenuHit[] = [];
  if (!store.menuOpen || store.selection === null) return hits;

  const items = menuFor(store);
  if (items.length === 0) return hits;

  const rows = rowsOf(items, store.menuPath);
  const ox = Math.floor(store.camera.ox);
  const oy = Math.floor(store.camera.oy);
  const clear = menuClear(store);

  // Under the shape if it fits, over it if not, clamped into the canvas either
  // way — a menu half off the top would be worse than one sitting on the shape.
  // `menuClear` is the selection *plus whatever is being previewed*, so the menu
  // steps below five rows of banner letters rather than landing on them.
  const below = clear.y + clear.h - oy + view.top + 1;
  const above = clear.y - oy + view.top - rows.length;
  let top = below + rows.length <= view.top + view.height ? below : above;
  top = Math.max(view.top, Math.min(top, view.top + view.height - rows.length));

  const left = Math.max(0, Math.min(clear.x - ox, width - 24));

  rows.forEach((row, depth) => {
    const y = top + depth;
    if (y < view.top || y >= view.top + view.height) return;

    const shown = windowOf(row, store.menuPath[depth] ?? 0);
    let col = left + (shown.before ? 3 : 0);

    shown.items.forEach((item, i) => {
      const at = shown.from + i;
      const lit = store.menuPath.length > depth && store.menuPath[depth] === at;
      const open = lit && store.menuPath.length > depth + 1;
      const label = ` ${item.label}${isGroup(item) ? (open ? ' ▾' : ' ▸') : ''} `;
      hits.push({
        row: y,
        from: col,
        to: col + label.length,
        path: [...store.menuPath.slice(0, depth), at],
        label,
        lit,
        open,
      });
      col += label.length;
    });
  });
  return hits;
}

/**
 * The menu the web build draws as a floating strip (`ShapeMenu.tsx`).
 *
 * It was missing here until the font menu needed it, and its absence was the
 * quiet kind: `e` opened a menu the keys would happily walk and nothing on
 * screen said so. Everything about *what* it offers and *where the highlight is*
 * comes from the store, exactly as the web one does, so the two cannot disagree
 * about what the item at index 1 means.
 */
function drawMenu(screen: Screen, view: Viewport): void {
  const hits = menuHitsFor(screen.width, view);
  if (hits.length === 0) return;

  const store = useEditor.getState();
  const items = menuFor(store);
  const rows = rowsOf(items, store.menuPath);

  // `‹` and `›` say the row carries on, which is the only thing standing between
  // five of seven fonts and a list that looks complete (B-UI-17).
  rows.forEach((row, depth) => {
    const mine = hits.filter((h) => h.path.length === depth + 1);
    const first = mine[0];
    const last = mine[mine.length - 1];
    if (first === undefined || last === undefined) return;

    const shown = windowOf(row, store.menuPath[depth] ?? 0);
    if (shown.before) screen.text(first.from - 3, first.row, ' ‹ ', C.dim, C.chrome);
    if (shown.after) screen.text(last.to, last.row, ' › ', C.dim, C.chrome);
  });

  for (const hit of hits) {
    screen.text(hit.from, hit.row, hit.label, hit.lit ? C.page : C.text, hit.lit ? C.cursor : C.chrome, hit.lit);
  }
}

/** The rows on screen: the top level, then each group opened from it. */
function rowsOf(items: readonly MenuNode[], path: readonly number[]): MenuNode[][] {
  const rows: MenuNode[][] = [[...items]];
  let level = items;

  for (let i = 0; i < path.length - 1; i++) {
    const step = level[path[i] ?? 0];
    if (step === undefined || !isGroup(step)) break;
    rows.push([...step.items]);
    level = step.items;
  }
  return rows;
}

// ---- the toolbar -----------------------------------------------------------

/**
 * The row that picks a tool, and the two facts that belong beside it.
 *
 * The one thing here that the web toolbar does not have to think about is width.
 * A browser window is nine hundred pixels of slack; eighty columns is not, and a
 * toolbar that ran under the filename would have hidden the two tools at the end
 * of the row — which are the eraser and freehand, the two that need the mouse and
 * so the two someone is most likely to be hunting for.
 *
 * So it measures first and drops the labels if the keys will not otherwise fit,
 * keeping the label on the tool that is actually selected. Every tool stays
 * reachable and visible at any width a terminal can be, which is the property
 * worth protecting; the words are not.
 */

/**
 * The filename and charset, shortened to fit whatever room the keys left.
 *
 * In that order of sacrifice: the charset goes first, being two presses of `F2`
 * from being obvious anyway; then the front of the filename, since the end of a
 * path is the part that identifies it; then the whole thing. The dirty mark is
 * never dropped — "is there unsaved work" is the one fact on this row that cannot
 * be recovered by looking harder.
 */
function rightOf(store: Store, room: number): string {
  const dot = store.dirty ? ' •' : '';
  const name = store.fileName;
  const charset = CHARSETS[store.charsetId]?.label ?? store.charsetId;

  const full = ` ${charset} · ${name}${dot} `;
  if (full.length <= room) return full;

  const plain = ` ${name}${dot} `;
  if (plain.length <= room) return plain;

  // Keep the tail: `…/notes/diagram.txt` says more than `/home/someone/pro…`.
  const keep = room - dot.length - 3;
  if (keep >= 3) return ` …${name.slice(name.length - keep)}${dot} `;
  return dot === '' ? '' : `${dot} `.slice(0, room);
}
function drawToolbar(screen: Screen, store: Store): void {
  screen.band(0, C.chrome);

  // The keys are measured first and the rest of the row gets what is left, which
  // is the whole of the width policy here. Tools are the only thing on this row
  // that cannot be found out any other way — the filename is in the status line's
  // reach and the charset is two presses of F2 from being obvious — so when
  // something has to give, it is not them.
  // A key each, plus the label on the one that is selected — that label is the
  // last thing to go, since a row of bare digits with nothing named would leave
  // the current mode as the only thing on screen you could not read.
  const active = TOOLS.find((t) => t.id === store.tool);
  const keysNeed =
    TOOLS.reduce((n, t) => n + t.key.length + 3, 0) + (active?.label.length ?? 0) + 1;
  const right = rightOf(store, Math.max(0, screen.width - keysNeed - 1));
  const rightAt = Math.max(0, screen.width - right.length);

  const brand = ' ascii writer ';
  const full = TOOLS.reduce((n, t) => n + t.key.length + t.label.length + 4, 0);
  const wide = brand.length + full < rightAt;
  let col = wide ? screen.text(0, 0, brand, C.dim, C.chrome) + 1 : 0;

  // The same table the web toolbar reads, so the order on screen and the key that
  // reaches it are one fact (tools.ts).
  for (const t of TOOLS) {
    const active = store.tool === t.id;
    const chip = wide || active ? ` ${t.key} ${t.label} ` : ` ${t.key} `;
    if (col + chip.length > rightAt) break;
    col = screen.text(col, 0, chip, active ? C.page : C.text, active ? C.selectionEdge : C.chrome, active);
    col++;
  }

  // A notice takes the middle if there is middle to take; the filename never
  // gives up its corner, being the thing you check before pressing Ctrl+S.
  const notice = store.notice;
  if (notice !== null && col + notice.length + 3 <= rightAt) {
    screen.text(rightAt - notice.length - 2, 0, ` ${notice} `, C.page, C.cursor, true);
  }
  screen.text(rightAt, 0, right, C.dim, C.chrome);
}

// ---- the key band ----------------------------------------------------------

/**
 * A group's rows, cut into columns of three.
 *
 * The web ribbon does the same thing with CSS and for the same reason: a fixed
 * height means a group of five rows is two columns, not a taller strip. Doing it
 * by hand here is four lines, and it keeps the two bands the same shape.
 */
function columnsOf(groups: readonly Group[]): { name: string; items: readonly Item[] }[] {
  const out: { name: string; items: readonly Item[] }[] = [];
  for (const g of groups) {
    // Resolved *before* the slicing, so a row that this build drops does not
    // leave a gap in a column and push the rest of the group sideways.
    const items = g.items.map(forTerminal).filter((it): it is Item => it !== null);
    for (let i = 0; i < items.length; i += BAND_ITEM_ROWS) {
      out.push({
        name: i === 0 ? g.name : `${g.name} ⋯`,
        items: items.slice(i, i + BAND_ITEM_ROWS),
      });
    }
  }
  return out;
}

/**
 * A row as the terminal should show it: the override applied, or the row dropped.
 *
 * This is the only place the `terminal` field on an `Item` is read, and the reason
 * it exists: six bindings in the band cannot work down a tty (`SUBSTITUTES` in
 * `terminal/keymap.ts`), and a band that printed the web's key for them would
 * teach the wrong thing with complete confidence.
 */
function forTerminal(item: Item): Item | null {
  if (item.terminal === null) return null;
  if (item.terminal === undefined) return item;
  const { keys, label } = item.terminal;
  return { ...item, keys: keys ?? item.keys, label: label ?? item.label };
}

/**
 * One row of an item: its keys as chips, then what it does.
 *
 * `terminal` on the item is what makes this honest. Six bindings in the web band
 * cannot work here (`SUBSTITUTES` in `keymap.ts`), and a band that printed
 * `Shift Shift` at someone whose terminal will never send it would be worse than
 * no band: they would conclude the feature was broken rather than that the key
 * was different.
 */
function itemWidth(item: Item): number {
  const chips = item.keys.reduce((n, k) => n + k.length + 3, 0);
  return chips + item.label.length + (item.state === undefined ? 0 : item.state.length + 3) + 2;
}

function drawItem(screen: Screen, col: number, row: number, limit: number, item: Item): void {
  let x = col;
  for (const k of item.keys) {
    if (x + k.length + 2 > limit) return;
    x = screen.text(x, row, ` ${k} `, C.page, C.cursor);
    x++;
  }
  if (x >= limit) return;
  const label = item.state === undefined ? item.label : `${item.label}: ${item.state}`;
  screen.text(x, row, label.slice(0, Math.max(0, limit - x)), item.state === undefined ? C.text : C.cursor, C.chrome);
}

function drawBand(screen: Screen, layout: Layout, store: Store): void {
  for (let r = 0; r < layout.bandRows; r++) screen.band(layout.bandTop + r, C.chrome);

  const groups = groupsFor(store.tool, {
    insertMode: store.insertMode,
    brush: store.brush,
    objectMode: store.objectMode,
    setTool: store.setTool,
  });

  let col = 1;
  for (const column of columnsOf(groups)) {
    const width = Math.max(
      column.name.length,
      ...column.items.map((it) => itemWidth(it)),
    );
    if (col + 8 > screen.width) break; // no room for even a stub of another column

    const limit = Math.min(screen.width, col + width);
    screen.text(col, layout.bandTop, column.name.toUpperCase(), C.selectionEdge, C.chrome, true);
    column.items.forEach((item, i) => {
      drawItem(screen, col, layout.bandTop + 1 + i, limit, item);
    });
    col += width + 2;
  }
}

// ---- the status line -------------------------------------------------------

function drawStatus(screen: Screen, layout: Layout, store: Store): void {
  const row = layout.statusRow;
  screen.band(row, C.chrome);

  const parts: string[] = [];
  parts.push(store.hover === null ? `${store.cursor.x}, ${store.cursor.y}` : `${store.hover.x}, ${store.hover.y}`);
  parts.push(`${store.grid.size} cells`);

  // The selection, and how many other readings of the same click exist (B-UI-06).
  let what = store.selection === null ? 'no selection' : describe(store.selection);
  if (store.drill !== null && store.drill.list.length > 1) {
    what += ` · ${store.drill.index + 1}/${store.drill.list.length}`;
  }
  parts.push(what);

  if (store.caret !== null) parts.push(`caret ${store.caret.x}, ${store.caret.y} · ${store.insertMode ? 'INS' : 'OVR'}`);
  if (store.tool === 'erase') parts.push(`brush ${store.brush}×${store.brush}`);
  if (store.chain !== null) {
    parts.push(`line: ${store.chain.length} ${store.chain.length === 1 ? 'point' : 'corners'} · Enter finishes`);
  }
  if (store.objectMode) parts.push('objects');
  if (!store.sticky) parts.push('sticky off');

  screen.text(1, row, parts.join('  ·  '), C.text, C.chrome);

  const help = ' ^X quit  F1 keys ';
  screen.text(screen.width - help.length, row, help, C.dim, C.chrome);
}

// ---- the file dialog -------------------------------------------------------

/** Where the cursor sits in the dialog: after the last character typed. */
function promptCaret(screen: Screen, prompt: Prompt): number {
  return Math.min(prompt.question.length + 3 + prompt.value.length, screen.width - 1);
}

function drawPrompt(screen: Screen, layout: Layout, prompt: Prompt): void {
  const row = layout.statusRow;
  screen.band(row, C.chrome);
  let col = screen.text(0, row, ` ${prompt.question} `, C.page, C.selectionEdge, true);
  col = screen.text(col, row, ` ${prompt.value}`, C.text, C.chrome);
  const hint = ` ${prompt.hint} `;
  if (col < screen.width - hint.length) screen.text(screen.width - hint.length, row, hint, C.dim, C.chrome);
}
