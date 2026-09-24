/**
 * Character sets and connectivity.
 *
 * Connectivity is NEVER stored in the document (B-CONN-01). A glyph declares
 * which directions it can connect to; ambiguous glyphs are narrowed against
 * their actual neighbours at the moment they are needed.
 */

export const N = 1;
export const E = 2;
export const S = 4;
export const W = 8;

export type Dir = typeof N | typeof E | typeof S | typeof W;

export const DIRS: ReadonlyArray<{ d: Dir; dx: number; dy: number }> = [
  { d: N, dx: 0, dy: -1 },
  { d: E, dx: 1, dy: 0 },
  { d: S, dx: 0, dy: 1 },
  { d: W, dx: -1, dy: 0 },
];

export function opposite(d: Dir): Dir {
  switch (d) {
    case N:
      return S;
    case S:
      return N;
    case E:
      return W;
    case W:
      return E;
  }
}

export interface Charset {
  id: string;
  label: string;
  /** mask (0..15) -> glyph. Mask 0 means "nothing here". */
  glyph: Record<number, string>;
  /** Arrowhead pointing in each direction. */
  arrow: Record<Dir, string>;
  /**
   * Where a freehand run turns into a diagonal (B-DRAW-16), keyed by the side
   * the straight run arrives from plus the way the diagonal leaves: W|S, E|S,
   * W|N or E|N. The bend carries the line from the middle of the cell edge to
   * where the `/` or `\` starts, instead of leaving half a row's jump.
   */
  bend: Record<number, string>;
}

const ROUND_BEND: Record<number, string> = {
  [S | W]: '╮',
  [E | S]: '╭',
  [N | W]: '╯',
  [N | E]: '╰',
};

export const UNICODE: Charset = {
  id: 'unicode',
  label: 'Unicode',
  arrow: { [N]: '▲', [E]: '▶', [S]: '▼', [W]: '◀' },
  // Rounded even here: a bend into a diagonal is a curve, and a square corner
  // makes the diagonal look as if it leaves from a wall.
  bend: ROUND_BEND,
  glyph: {
    0: '',
    [N]: '│',
    [E]: '─',
    [N | E]: '└',
    [S]: '│',
    [N | S]: '│',
    [E | S]: '┌',
    [N | E | S]: '├',
    [W]: '─',
    [N | W]: '┘',
    [E | W]: '─',
    [N | E | W]: '┴',
    [S | W]: '┐',
    [N | S | W]: '┤',
    [E | S | W]: '┬',
    [N | E | S | W]: '┼',
  },
};

export const ASCII: Charset = {
  id: 'ascii',
  label: 'ASCII',
  arrow: { [N]: '^', [E]: '>', [S]: 'v', [W]: '<' },
  // The ASCII-art convention: `-.` bends down, `-'` bends up.
  bend: { [S | W]: '.', [E | S]: '.', [N | W]: "'", [N | E]: "'" },
  glyph: {
    0: '',
    [N]: '|',
    [E]: '-',
    [N | E]: '+',
    [S]: '|',
    [N | S]: '|',
    [E | S]: '+',
    [N | E | S]: '+',
    [W]: '-',
    [N | W]: '+',
    [E | W]: '-',
    [N | E | W]: '+',
    [S | W]: '+',
    [N | S | W]: '+',
    [E | S | W]: '+',
    [N | E | S | W]: '+',
  },
};

/**
 * The remaining packs are one table each, exactly as promised (B-CS-06).
 * Rounded and heavy borrow Unicode's junctions, because neither script has
 * distinct ones; double has its own throughout.
 */
export const ROUNDED: Charset = {
  id: 'rounded',
  label: 'Rounded',
  arrow: { [N]: '▲', [E]: '▶', [S]: '▼', [W]: '◀' },
  bend: ROUND_BEND,
  glyph: {
    ...UNICODE.glyph,
    [N | E]: '╰',
    [E | S]: '╭',
    [N | W]: '╯',
    [S | W]: '╮',
  },
};

export const HEAVY: Charset = {
  id: 'heavy',
  label: 'Heavy',
  arrow: { [N]: '▲', [E]: '▶', [S]: '▼', [W]: '◀' },
  // No heavy arcs exist, so heavy and double bend with their own corners.
  bend: { [S | W]: '┓', [E | S]: '┏', [N | W]: '┛', [N | E]: '┗' },
  glyph: {
    0: '',
    [N]: '┃',
    [E]: '━',
    [N | E]: '┗',
    [S]: '┃',
    [N | S]: '┃',
    [E | S]: '┏',
    [N | E | S]: '┣',
    [W]: '━',
    [N | W]: '┛',
    [E | W]: '━',
    [N | E | W]: '┻',
    [S | W]: '┓',
    [N | S | W]: '┫',
    [E | S | W]: '┳',
    [N | E | S | W]: '╋',
  },
};

export const DOUBLE: Charset = {
  id: 'double',
  label: 'Double',
  arrow: { [N]: '▲', [E]: '▶', [S]: '▼', [W]: '◀' },
  bend: { [S | W]: '╗', [E | S]: '╔', [N | W]: '╝', [N | E]: '╚' },
  glyph: {
    0: '',
    [N]: '║',
    [E]: '═',
    [N | E]: '╚',
    [S]: '║',
    [N | S]: '║',
    [E | S]: '╔',
    [N | E | S]: '╠',
    [W]: '═',
    [N | W]: '╝',
    [E | W]: '═',
    [N | E | W]: '╩',
    [S | W]: '╗',
    [N | S | W]: '╣',
    [E | S | W]: '╦',
    [N | E | S | W]: '╬',
  },
};

export const CHARSETS: Record<string, Charset> = {
  [UNICODE.id]: UNICODE,
  [ROUNDED.id]: ROUNDED,
  [HEAVY.id]: HEAVY,
  [DOUBLE.id]: DOUBLE,
  [ASCII.id]: ASCII,
};


/**
 * Glyph -> the directions it is willing to connect to (B-CONN-02).
 * Covers both shipped charsets plus rounded/heavy variants so that pasted
 * art from elsewhere is understood without any conversion step.
 */
const DECLARED: Readonly<Record<string, number>> = {
  '│': N | S,
  '|': N | S,
  '┃': N | S,
  '║': N | S,
  '─': E | W,
  '-': E | W,
  '━': E | W,
  '═': E | W,
  '┌': E | S,
  '╭': E | S,
  '┏': E | S,
  '╔': E | S,
  '┐': S | W,
  '╮': S | W,
  '┓': S | W,
  '╗': S | W,
  '└': N | E,
  '╰': N | E,
  '┗': N | E,
  '╚': N | E,
  '┘': N | W,
  '╯': N | W,
  '┛': N | W,
  '╝': N | W,
  '├': N | E | S,
  '┣': N | E | S,
  '╠': N | E | S,
  '┤': N | S | W,
  '┫': N | S | W,
  '╣': N | S | W,
  '┬': E | S | W,
  '┳': E | S | W,
  '╦': E | S | W,
  '┴': N | E | W,
  '┻': N | E | W,
  '╩': N | E | W,
  '┼': N | E | S | W,
  '╋': N | E | S | W,
  '╬': N | E | S | W,
  '+': N | E | S | W,
};

/** Glyphs whose declared mask is a superset of their real connectivity. */
const AMBIGUOUS: ReadonlySet<string> = new Set(['+', '┼', '╋']);

/**
 * Arrowheads: glyph -> the direction it points (B-DRAW-10).
 *
 * These are **weak** glyphs. `v`, `^`, `<` and `>` are ordinary text far more
 * often than they are arrowheads, so an arrowhead only counts as part of a line
 * when a shaft is actually behind it — see `maskOf` in grid.ts. Without that
 * rule the `v` in "level" would be traced as a diagram.
 */
const ARROWS: Readonly<Record<string, Dir>> = {
  '^': N,
  '▲': N,
  '△': N,
  '>': E,
  '▶': E,
  '▷': E,
  'v': S,
  'V': S,
  '▼': S,
  '▽': S,
  '<': W,
  '◀': W,
  '◁': W,
};

/** The direction an arrowhead points, or null if this is not an arrowhead. */
/**
 * End decorations: glyph -> the direction the end faces (B-LINE-04).
 *
 * A second family of **weak** glyphs, on exactly the terms arrowheads are
 * (B-CONN-06): a decoration counts as part of a line only when a shaft is
 * really behind it. That is what lets a notation character sit at the end of a
 * wire without the recognizer reading it back as more wire — the failure that
 * rules out writing crow's foot with `|` and `<`, both of which are already
 * spoken for as a line glyph and an arrowhead.
 *
 * `╫` is a horizontal run crossed by a bar and `╪` a vertical one, which is the
 * *exactly one* tick of crow's-foot notation as a single cell.
 */
const DECOR: Readonly<Record<string, Dir>> = {
  '╫': E,
  '╪': S,
};

/** The bar that crosses a run travelling in `d`. */
function tickFor(d: Dir): string {
  return d === E || d === W ? '╫' : '╪';
}

/**
 * The direction a decoration's end faces, or null when it is not one.
 *
 * The glyph itself only says which way the *run* lies, not which end of it this
 * is — a tick looks the same at either. The caller knows which end it asked
 * about, so nothing is lost.
 */
export function decorDir(ch: string | undefined): Dir | null {
  if (ch === undefined) return null;
  return DECOR[ch] ?? null;
}

export function tickAlong(d: Dir): string {
  return tickFor(d);
}

export function arrowDir(ch: string | undefined): Dir | null {
  if (ch === undefined) return null;
  return ARROWS[ch] ?? null;
}

/**
 * A glyph whose connectivity stands on its own, independent of its neighbours.
 * Arrowheads are deliberately excluded — they are weak (see ARROWS).
 */
export function isStrongLineChar(ch: string | undefined): boolean {
  return ch !== undefined && ch in DECLARED;
}

export function declaredMask(ch: string | undefined): number {
  if (ch === undefined) return 0;
  return DECLARED[ch] ?? 0;
}

export function isAmbiguous(ch: string | undefined): boolean {
  return ch !== undefined && AMBIGUOUS.has(ch);
}

export function glyphFor(mask: number, cs: Charset): string {
  return cs.glyph[mask & 0b1111] ?? '';
}

export function arrowFor(d: Dir, cs: Charset): string {
  return cs.arrow[d];
}

export function dirDelta(d: Dir): { dx: number; dy: number } {
  const hit = DIRS.find((e) => e.d === d);
  return hit === undefined ? { dx: 0, dy: 0 } : { dx: hit.dx, dy: hit.dy };
}

export function charsetOf(id: string): Charset {
  return CHARSETS[id] ?? UNICODE;
}
