/**
 * Which way a key goes, and how far a modifier carries it.
 *
 * Lifted out of `keymap.ts` when the terminal build arrived, for the reason
 * `ribbon-items.ts` exists: there are now two keymaps — one reading
 * `KeyboardEvent`s from a browser, one reading bytes from a tty — and the four
 * directions, their `hjkl` spelling and the size of an `Alt` stride are the same
 * facts in both. Kept in two places they drift the first time one gains a key,
 * and a direction table that disagrees with itself is a keyboard that means
 * different things in two windows showing the same document.
 *
 * What did *not* move is everything about precedence: which branch reads a key
 * first is a question each keymap answers for itself, because the two have
 * different things to be innermost about. This file is the vocabulary; the
 * keymaps are the grammar.
 */

import type { ToolId } from '../tools.ts';

/**
 * How far `Alt` carries things: the coarse step, twice as far sideways.
 *
 * Alt already means "move the thing" — with no thing, it moves *you*, and the
 * coarse step is the useful gap in the range: a bare arrow is one cell, Ctrl is
 * a jump to wherever content happens to be, and neither crosses open space at a
 * predictable rate. A stride you can count in, without becoming a substitute
 * for the jump.
 *
 * Ten across and five down rather than five of each, because a cell is about
 * twice as tall as it is wide — 8px by 17px at 100%. Five of each is one
 * *number* but two very different distances on screen, and 10 × 8 against
 * 5 × 17 is 80px against 85px: near enough the same ground, which is what makes
 * one key feel like one gesture in either direction.
 *
 * The terminal inherits the same numbers even though its cells are whatever the
 * font in that window happens to be. The stride is a unit the hand learns, and
 * it is worth more as one number across both builds than as two numbers each
 * tuned to a cell size nobody measures.
 */
export const BIG_STEP_X = 10;
export const BIG_STEP_Y = 5;

/** One arrow's worth of stride. Only ever one axis is non-zero. */
export function strideBy(dx: number, dy: number): readonly [number, number] {
  return [dx * BIG_STEP_X, dy * BIG_STEP_Y];
}

/** Which way each arrow key goes. */
export const ARROWS: Record<string, readonly [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/**
 * The same four directions under the home row (B-KEY-22).
 *
 * `hjkl` is not a shortcut for the arrows so much as the reason a hand can
 * stay where the mode letters are: `c`, `b`, `s` and `t` are all within reach
 * of a hand resting here, and a keymap that made you leave for every step
 * would have been modal in name only.
 *
 * `Shift` and `Alt` mean on these exactly what they mean on the arrows — sweep
 * and nudge, size a box and stride — because they are the same key twice, not
 * a second scheme. `Ctrl` is the exception and stays on the arrows alone:
 * `Ctrl`+`L` is the address bar and `Ctrl`+`J` the downloads pane, and a jump
 * that silently does not happen is worse than one key to reach for. The
 * terminal has no such conflict, but it keeps the same exception rather than
 * growing a binding the web build cannot have.
 */
export const VIM: Record<string, readonly [number, number]> = {
  h: [-1, 0],
  l: [1, 0],
  k: [0, -1],
  j: [0, 1],
};

/**
 * The modes `hjkl` walks in: select, and the four the keyboard can draw in.
 *
 * Walking to a cell and walking a shape's free corner out from it are the same
 * gesture — the cursor is the thing that moves either way (B-UI-10) — so the
 * hand that reached `b` on the home row would have had to leave it at the very
 * next keystroke to size the box it just asked for. That is the failure
 * B-KEY-22 was written against, one mode further in.
 *
 * Not text, where a letter is a letter and `h` must write an `h`. Not the
 * eraser or freehand either: those have no keyboard gesture at all — `Space`
 * draws nothing in them — so the cursor there is not on its way anywhere, and
 * a binding that only *looks* like the others is worse than none.
 */
export const VIM_TOOLS: ReadonlySet<ToolId> = new Set<ToolId>([
  'select',
  'box',
  'circle',
  'line',
  'arrow',
]);

/**
 * Which way a key goes: the arrows anywhere, `hjkl` where the letters are free.
 *
 * One function rather than two lookups at each call site, so the two spellings
 * cannot drift into meaning different things under one modifier.
 */
export function directionOf(key: string, tool: ToolId): readonly [number, number] | undefined {
  return ARROWS[key] ?? (VIM_TOOLS.has(tool) ? VIM[key.toLowerCase()] : undefined);
}
