/**
 * Bytes from a tty, turned into presses and clicks.
 *
 * This is the terminal's `KeyboardEvent` and `PointerEvent` factory, and the one
 * decision in it that matters is the vocabulary: **a press is named the way the
 * DOM names it** — `ArrowLeft`, `Enter`, `Escape`, `Insert`, or the character
 * itself. Nothing forced that. It is chosen so that `canvas/steps.ts` works here
 * unchanged, and so that the two keymaps can be read side by side and compared;
 * a terminal keymap spelled in `\x1b[C` would be a keymap nobody could check
 * against the one it is supposed to agree with.
 *
 * Shift follows the DOM too, and it is the one place where that costs something
 * to explain: a terminal does not report Shift for a letter, it reports the
 * **capital**. So `K` arrives as `{ key: 'K', shift: true }`, exactly as a browser
 * would report it, and `directionOf` lowercases it back to `k` as it already did.
 *
 * ## What a tty cannot tell you
 *
 * Three things, and it is worth being plain about them because two bindings in
 * the web keymap rest on them:
 *
 *   - **There is no key release.** Nothing arrives when a key comes back up, so
 *     "hold Shift, draw, let go to keep it" (B-DRAW-15) has no release to fire on.
 *   - **There are no bare modifiers.** Shift and Ctrl pressed alone send nothing
 *     at all, so neither double-tap gesture (B-SEL-14, B-KEY-21) can be seen.
 *   - **`Ctrl` and a digit has no encoding.** Control codes only cover the
 *     letters; `Ctrl`+`4` is either nothing or a stray `ESC`, depending on the
 *     terminal.
 *
 * The keymap answers all three (see `terminal/keymap.ts`, `SUBSTITUTES`). They are
 * named here because this is the layer that knows *why* the answer was needed.
 */

import { StringDecoder } from 'node:string_decoder';

/** A key press, named as the DOM would name it. */
export interface Press {
  key: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
}

export interface Click {
  action: 'down' | 'drag' | 'up';
  button: 'left' | 'middle' | 'right' | 'none';
  /** Zero-based terminal cell, not a document cell — the frame converts. */
  col: number;
  row: number;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
}

export interface Wheel {
  /** -1 is away from the user. */
  dir: -1 | 1;
  col: number;
  row: number;
  ctrl: boolean;
  shift: boolean;
}

export type Input =
  | { kind: 'key'; press: Press }
  | { kind: 'mouse'; click: Click }
  | { kind: 'wheel'; wheel: Wheel };

/**
 * How long a lone `ESC` waits to see whether it was the start of a sequence.
 *
 * Every arrow key is an `ESC` followed by more, and the only thing telling that
 * apart from the Escape key is that nothing follows. In practice a sequence
 * arrives in one `read`, so this almost never has to fire — but a loaded machine
 * can split a chunk anywhere, and an arrow key that came out as Escape-then-`[C`
 * would drop the user out of their mode and then type a bracket.
 *
 * Short enough that Escape does not feel sticky; long enough to survive a split.
 */
const ESC_MS = 25;

/** `CSI 1;<mod>` — the modifier bitmask xterm puts in that parameter. */
function modifiers(param: number | undefined): Pick<Press, 'ctrl' | 'alt' | 'shift'> {
  const bits = param === undefined || param < 1 ? 0 : param - 1;
  return { shift: (bits & 1) !== 0, alt: (bits & 2) !== 0, ctrl: (bits & 4) !== 0 };
}

const NONE = { ctrl: false, alt: false, shift: false };

/** The letter-shaped final bytes of a CSI sequence. */
const CSI_FINAL: Record<string, string> = {
  A: 'ArrowUp',
  B: 'ArrowDown',
  C: 'ArrowRight',
  D: 'ArrowLeft',
  H: 'Home',
  F: 'End',
};

/** `CSI <n> ~` — the numbered ones. */
const CSI_TILDE: Record<number, string> = {
  1: 'Home',
  2: 'Insert',
  3: 'Delete',
  4: 'End',
  5: 'PageUp',
  6: 'PageDown',
  11: 'F1',
  12: 'F2',
  13: 'F3',
  14: 'F4',
  15: 'F5',
};

/** `ESC O <x>` — the same keys again, from a terminal in application mode. */
const SS3: Record<string, string> = {
  A: 'ArrowUp',
  B: 'ArrowDown',
  C: 'ArrowRight',
  D: 'ArrowLeft',
  H: 'Home',
  F: 'End',
  P: 'F1',
  Q: 'F2',
  R: 'F3',
  S: 'F4',
};

/**
 * A control byte, or null when it is not one.
 *
 * `0x08` is read as Backspace rather than as `Ctrl`+`H`. It is genuinely both —
 * terminals send `0x7f` for the Backspace key and `0x08` for the chord — but
 * `Ctrl`+`H` is bound to nothing and some terminals and some SSH configurations
 * still send `0x08` for the key, so reading it as the key is right far more often
 * than it is wrong.
 */
function control(code: number): Press | null {
  if (code === 0x0d || code === 0x0a) return { key: 'Enter', ...NONE };
  if (code === 0x09) return { key: 'Tab', ...NONE };
  if (code === 0x7f || code === 0x08) return { key: 'Backspace', ...NONE };
  if (code === 0x00) return { key: ' ', ctrl: true, alt: false, shift: false };
  if (code >= 0x01 && code <= 0x1a) {
    return { key: String.fromCharCode(0x60 + code), ctrl: true, alt: false, shift: false };
  }
  return null;
}

/** A printable press, with Shift inferred from the capital the way the DOM does. */
function printable(ch: string, alt: boolean): Press {
  return { key: ch, ctrl: false, alt, shift: ch.length === 1 && ch >= 'A' && ch <= 'Z' };
}

export interface Decoder {
  feed(chunk: Buffer): void;
  /** Give up waiting: a held `ESC` was the Escape key after all. */
  flush(): void;
  stop(): void;
}

export function createDecoder(emit: (input: Input) => void): Decoder {
  /**
   * Characters seen but not yet understood — always either empty or the start of
   * an escape sequence, since everything else is consumed the moment it arrives.
   */
  let held = '';
  /**
   * The UTF-8 decoder, which has to be one object across every chunk.
   *
   * `chunk.toString('utf8')` looks like it would do, and does, until a read lands
   * in the middle of a character: two of the three bytes of a `┌` decode to a
   * replacement character, the third to another, and the glyph is gone for good.
   * A `StringDecoder` keeps the partial bytes instead and finishes them on the
   * next chunk. It matters for pasted box-drawing more than for typing, which is
   * exactly the case where losing a character is least likely to be noticed.
   */
  const utf8 = new StringDecoder('utf8');
  let timer: ReturnType<typeof setTimeout> | null = null;

  const arm = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, ESC_MS);
  };

  const disarm = (): void => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };

  /**
   * Read one thing off the front of `held`.
   *
   * Returns the number of characters consumed, or 0 for "this is the start of
   * something and the rest has not arrived yet". `final` forces a decision: a
   * partial sequence that is never going to be completed is dropped rather than
   * jamming the decoder forever.
   */
  const step = (final: boolean): number => {
    const first = held[0];
    if (first === undefined) return 0;

    if (first !== '\x1b') {
      const code = first.charCodeAt(0);
      const ctrl = control(code);
      if (ctrl !== null) {
        emit({ kind: 'key', press: ctrl });
        return 1;
      }
      // By code point, so an astral character is one press rather than two
      // halves of a surrogate pair typed a moment apart.
      const point = String.fromCodePoint(held.codePointAt(0) ?? 0x20);
      emit({ kind: 'key', press: printable(point, false) });
      return point.length;
    }

    const second = held[1];
    if (second === undefined) {
      // A lone ESC: the Escape key, once we are sure nothing follows it.
      if (!final) return 0;
      emit({ kind: 'key', press: { key: 'Escape', ...NONE } });
      return 1;
    }

    if (second === 'O') {
      const third = held[2];
      if (third === undefined) return final ? 2 : 0;
      const name = SS3[third];
      if (name !== undefined) emit({ kind: 'key', press: { key: name, ...NONE } });
      return 3;
    }

    if (second !== '[') {
      // `ESC` and a character is Alt and that character — the one modifier a
      // terminal reports by prefixing rather than by a parameter.
      if (second === '\x1b') {
        emit({ kind: 'key', press: { key: 'Escape', ...NONE } });
        return 1;
      }
      const ctrl = control(second.charCodeAt(0));
      if (ctrl !== null) {
        emit({ kind: 'key', press: { ...ctrl, alt: true } });
        return 2;
      }
      const point = String.fromCodePoint(held.codePointAt(1) ?? 0x20);
      emit({ kind: 'key', press: printable(point, true) });
      return 1 + point.length;
    }

    // ---- CSI: ESC [ <private> <params> <final> ----

    let i = 2;
    const priv = held[i] === '<' || held[i] === '?' ? held[i] : '';
    if (priv !== '') i++;

    let params = '';
    while (i < held.length && /[\d;]/.test(held[i] ?? '')) {
      params += held[i];
      i++;
    }
    const finalByte = held[i];
    if (finalByte === undefined) return final ? held.length : 0;
    const len = i + 1;

    const nums = params === '' ? [] : params.split(';').map((p) => (p === '' ? 0 : Number(p)));

    if (priv === '<') {
      emitMouse(nums, finalByte);
      return len;
    }
    if (priv === '?') return len; // a device report we did not ask for

    if (finalByte === 'Z') {
      emit({ kind: 'key', press: { key: 'Tab', ctrl: false, alt: false, shift: true } });
      return len;
    }

    const byLetter = CSI_FINAL[finalByte];
    if (byLetter !== undefined) {
      // `CSI 1;5C`: the first parameter is a placeholder, the second the modifier.
      emit({ kind: 'key', press: { key: byLetter, ...modifiers(nums[1]) } });
      return len;
    }
    if (finalByte === '~') {
      const name = CSI_TILDE[nums[0] ?? 0];
      if (name !== undefined) emit({ kind: 'key', press: { key: name, ...modifiers(nums[1]) } });
      return len;
    }
    return len; // something this program has no use for
  };

  /** `CSI < Cb ; Cx ; Cy M|m` — SGR mouse reporting. */
  const emitMouse = (nums: number[], finalByte: string): void => {
    const cb = nums[0] ?? 0;
    const col = (nums[1] ?? 1) - 1;
    const row = (nums[2] ?? 1) - 1;
    const shift = (cb & 4) !== 0;
    const alt = (cb & 8) !== 0;
    const ctrl = (cb & 16) !== 0;

    if ((cb & 64) !== 0) {
      emit({ kind: 'wheel', wheel: { dir: (cb & 3) === 0 ? -1 : 1, col, row, ctrl, shift } });
      return;
    }

    const button =
      finalByte === 'm'
        ? 'none'
        : (['left', 'middle', 'right', 'none'] as const)[cb & 3] ?? 'none';
    const action = finalByte === 'm' ? 'up' : (cb & 32) !== 0 ? 'drag' : 'down';
    emit({ kind: 'mouse', click: { action, button, col, row, ctrl, alt, shift } });
  };

  /** Drain everything that can be decoded; `final` forces the held ESC to decide. */
  const drain = (final: boolean): void => {
    for (;;) {
      const used = step(final);
      if (used <= 0) break;
      held = held.slice(used);
      if (held === '') break;
    }
  };

  const flush = (): void => {
    disarm();
    if (held === '') return;
    drain(true);
    held = '';
  };

  return {
    feed(chunk) {
      disarm();
      // Decoded first, then parsed over characters: every escape sequence is
      // ASCII, so nothing is lost by working in characters, and working in bytes
      // would risk cutting a multi-byte one in half.
      held += utf8.write(chunk);
      drain(false);
      if (held !== '') arm();
    },
    flush,
    stop: disarm,
  };
}
