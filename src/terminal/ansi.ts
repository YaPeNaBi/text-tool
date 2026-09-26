/**
 * The terminal as a grid of coloured cells.
 *
 * This is to `terminal/frame.ts` what a `CanvasRenderingContext2D` is to
 * `canvas/renderer.ts`: somewhere to put characters, which knows nothing about
 * diagrams. It exists because the canvas renderer paints in **layers** — the
 * selection wash, then the document, then the preview over it, then the hint,
 * then the hover, then the cursor — and a terminal cell can only hold one set of
 * attributes. A back buffer is where those layers get resolved into one, in the
 * same order and to the same result.
 *
 * Two things here are worth more than they cost:
 *
 *   - **Rows are diffed against the last frame.** A keystroke usually changes one
 *     row, and repainting eighty by twenty-four cells to show it is what makes a
 *     TUI feel laggy over SSH. Comparing the row strings is a few microseconds
 *     and skips almost all of the writing.
 *
 *   - **Colours come from the canvas palette** (`canvas/palette.ts`), composited
 *     rather than approximated. A terminal cell has no alpha, so the washes —
 *     `selectionFill` at 0.16, `hint` at 0.30 — are mixed against the background
 *     they would have been drawn over, which lands on the flat colour the canvas
 *     actually shows. One palette, two renderings.
 */

/** No colour of our own: leave the terminal's own foreground or background. */
export const DEFAULT = -1;

export interface Cell {
  ch: string;
  fg: number;
  bg: number;
  bold: boolean;
}

// ---- escape sequences ------------------------------------------------------

export const ALT_SCREEN_ON = '\x1b[?1049h';
export const ALT_SCREEN_OFF = '\x1b[?1049l';
export const CURSOR_HIDE = '\x1b[?25l';
export const CURSOR_SHOW = '\x1b[?25h';
export const RESET = '\x1b[0m';
/** Wrapping turns a full-width row into a stray blank line on the next one. */
export const WRAP_OFF = '\x1b[?7l';
export const WRAP_ON = '\x1b[?7h';

/**
 * Mouse reporting: button events with drag, in SGR coordinates.
 *
 * `1002` rather than `1003` — motion is reported only while a button is held.
 * `1003` reports every movement, which would mean a frame per pixel of mouse
 * travel to update a hover outline, and the hover is worth less than that.
 *
 * `1006` is what makes the numbers usable at all: the original encoding puts a
 * coordinate in one byte with an offset of 32, so column 224 onwards is
 * unreportable and a wide terminal silently loses its right-hand side.
 */
export const MOUSE_ON = '\x1b[?1002h\x1b[?1006h';
export const MOUSE_OFF = '\x1b[?1006l\x1b[?1002l';

/**
 * The shape of the terminal's own cursor.
 *
 * B-UI-10 asks for one position drawn two ways — a bar where the keyboard is
 * writing, a block where it is only pointing — and a terminal has exactly that,
 * in hardware, already blinking. So the caret is not drawn at all here: the real
 * cursor is parked on it and given the right shape, which is both less code than
 * the canvas needs and a better result, since it blinks in step with every other
 * cursor on the machine.
 */
export const CURSOR_BAR = '\x1b[5 q';
export const CURSOR_BLOCK = '\x1b[2 q';
export const CURSOR_DEFAULT = '\x1b[0 q';

export function moveTo(col: number, row: number): string {
  return `\x1b[${String(row + 1)};${String(col + 1)}H`;
}

// ---- colour ----------------------------------------------------------------

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** `#rrggbb` or `rgba(r, g, b, a)` — the two spellings the palette uses. */
function parse(css: string): Rgba {
  if (css.startsWith('#')) {
    const n = Number.parseInt(css.slice(1), 16);
    return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff, a: 1 };
  }
  const nums = css.match(/[\d.]+/g) ?? [];
  const at = (i: number, fallback: number): number => {
    const v = nums[i];
    return v === undefined ? fallback : Number(v);
  };
  return { r: at(0, 0), g: at(1, 0), b: at(2, 0), a: at(3, 1) };
}

function pack(r: number, g: number, b: number): number {
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}

/**
 * A palette colour as a packed number, flattened against what it sits on.
 *
 * `over` is the colour underneath — the page background for a wash on empty
 * space. Alpha-free entries ignore it, so every palette entry can go through
 * one function and the call sites do not have to know which are washes.
 */
export function colorOf(css: string, over = '#000000'): number {
  const top = parse(css);
  if (top.a >= 1) return pack(top.r, top.g, top.b);
  const under = parse(over);
  const mix = (t: number, u: number): number => t * top.a + u * (1 - top.a);
  return pack(mix(top.r, under.r), mix(top.g, under.g), mix(top.b, under.b));
}

/**
 * Whether to emit colour at all.
 *
 * `NO_COLOR` is the convention every CLI now honours, and a pipe is not a
 * terminal — `npm run tui > out.txt` should not fill the file with escapes. Both
 * are checked once, at import: neither changes while the program runs.
 */
export const COLOR = process.env['NO_COLOR'] === undefined && process.stdout.isTTY === true;

function sgr(fg: number, bg: number, bold: boolean): string {
  if (!COLOR) return bold ? '\x1b[0;1m' : '\x1b[0m';
  let out = '\x1b[0';
  if (bold) out += ';1';
  if (fg !== DEFAULT) out += `;38;2;${String((fg >> 16) & 0xff)};${String((fg >> 8) & 0xff)};${String(fg & 0xff)}`;
  if (bg !== DEFAULT) out += `;48;2;${String((bg >> 16) & 0xff)};${String((bg >> 8) & 0xff)};${String(bg & 0xff)}`;
  return `${out}m`;
}

// ---- the back buffer -------------------------------------------------------

export class Screen {
  width: number;
  height: number;
  private cells: Cell[];
  /** Last frame, per row, so an unchanged row costs one string compare. */
  private painted: string[] = [];
  /** The page colour: every untouched cell, and what the washes composite over. */
  readonly bg: number;

  constructor(width: number, height: number, bgCss: string) {
    this.width = width;
    this.height = height;
    this.bg = colorOf(bgCss);
    this.cells = [];
    this.resize(width, height);
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.cells = new Array<Cell>(this.width * this.height);
    this.painted = [];
    this.clear();
  }

  clear(): void {
    for (let i = 0; i < this.cells.length; i++) {
      this.cells[i] = { ch: ' ', fg: DEFAULT, bg: this.bg, bold: false };
    }
  }

  put(x: number, y: number, ch: string, fg: number, bg = this.bg, bold = false): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.cells[y * this.width + x] = { ch, fg, bg, bold };
  }

  /**
   * Put a character on a cell without disturbing the background it sits on.
   *
   * The counterpart of `wash`, and the pair is what lets the layers be painted in
   * the canvas renderer's order: the selection washes first and the characters go
   * on top of it, exactly as `fillRect` then `fillText` does on a canvas. A plain
   * `put` would carry its own background and rub the wash out.
   */
  glyph(x: number, y: number, ch: string, fg: number, bold = false): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const at = this.cells[y * this.width + x];
    if (at === undefined) return;
    at.ch = ch;
    at.fg = fg;
    at.bold = bold;
  }

  /** Change a cell's background without disturbing whatever character is on it. */
  wash(x: number, y: number, bg: number): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const at = this.cells[y * this.width + x];
    if (at !== undefined) at.bg = bg;
  }

  /** Write a string, clipped at the right edge. Returns where it ended. */
  text(x: number, y: number, s: string, fg: number, bg = this.bg, bold = false): number {
    let col = x;
    // By code point, so a box-drawing glyph or an emoji is one cell rather than
    // two halves of a surrogate pair.
    for (const ch of s) {
      if (col >= this.width) break;
      if (col >= 0) this.put(col, y, ch, fg, bg, bold);
      col++;
    }
    return col;
  }

  /** Fill a run with a background, for a band or a status line. */
  band(y: number, bg: number): void {
    for (let x = 0; x < this.width; x++) this.wash(x, y, bg);
  }

  /**
   * The changed rows, as one string for the terminal.
   *
   * Composing rather than writing, so that the renderer can be tested without a
   * tty and so that the shell keeps every write in one place. It is one string
   * rather than a write per row for a reason a terminal makes obvious: two
   * writes can be seen separately, and a frame delivered in twenty-four pieces
   * tears.
   *
   * `cursor` is where the real cursor should be parked, and its shape; null hides
   * it, which is what an off-screen keyboard position means. It is moved last and
   * in the same string as the cells, so it never shows for one frame in the place
   * the previous frame left it.
   *
   * Calling this *is* declaring the frame painted — the row diff is updated here —
   * so the caller must actually write what it gets back.
   */
  frame(cursor: { x: number; y: number; shape: string } | null): string {
    let out = CURSOR_HIDE;

    for (let y = 0; y < this.height; y++) {
      const row = this.rowString(y);
      if (this.painted[y] === row) continue;
      this.painted[y] = row;
      out += moveTo(0, y) + row;
    }

    return out + (cursor === null
      ? CURSOR_DEFAULT
      : cursor.shape + moveTo(cursor.x, cursor.y) + CURSOR_SHOW);
  }

  /**
   * One row's characters, with every attribute dropped.
   *
   * For tests and for anyone reading a frame by eye: "what does the status line
   * say" is a question about text, and answering it by picking escape sequences
   * out of `frame()` would make every test about colour as well.
   */
  row(y: number): string {
    let out = '';
    for (let x = 0; x < this.width; x++) out += this.cells[y * this.width + x]?.ch ?? ' ';
    return out.replace(/\s+$/, '');
  }

  /**
   * One row, with an SGR change only where the attributes actually change.
   *
   * The trailing run of untouched page is replaced by "erase to end of line" with
   * the page colour left set — every terminal worth the name erases in the
   * current background — which is both far shorter than eighty spaces and what
   * stops a frame that shrank from leaving the previous one's right edge behind.
   *
   * The page is painted rather than left to the terminal's own colours, which is
   * the one decision here that could have gone either way. A full-screen editor
   * on the alternate screen owns its window the way vim with a colourscheme does,
   * and owning it is what keeps the terminal and the browser showing the same
   * document in the same colours. `NO_COLOR` opts out of all of it.
   */
  private rowString(y: number): string {
    let out = '';
    let fg = NaN;
    let bg = NaN;
    let bold: boolean | null = null;

    let last = -1;
    for (let x = this.width - 1; x >= 0; x--) {
      const c = this.cells[y * this.width + x];
      if (c !== undefined && (c.ch !== ' ' || c.bg !== this.bg)) {
        last = x;
        break;
      }
    }

    for (let x = 0; x <= last; x++) {
      const c = this.cells[y * this.width + x] ?? { ch: ' ', fg: DEFAULT, bg: this.bg, bold: false };
      if (c.fg !== fg || c.bg !== bg || c.bold !== bold) {
        out += sgr(c.fg, c.bg, c.bold);
        fg = c.fg;
        bg = c.bg;
        bold = c.bold;
      }
      out += c.ch;
    }
    return `${out}${sgr(DEFAULT, this.bg, false)}\x1b[K`;
  }
}
