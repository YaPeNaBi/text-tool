/**
 * The toolbar, left to right — and the only place that order is written down.
 *
 * The row of buttons and the `Ctrl`+digit that reaches each one are the same
 * fact seen twice: the digit *is* the position. Kept as two lists they drift
 * the first time one of them gains an entry, which is the reason `MENU_ITEMS`
 * lives in the store rather than in the menu that draws it.
 *
 * Tools are numbered rather than lettered on `Ctrl` because the obvious letters
 * are taken: Ctrl+C, Ctrl+V, Ctrl+A and Ctrl+S are copy, paste, select all and
 * save, and Ctrl+T and Ctrl+L belong to the browser and cannot be intercepted
 * at all. The digits follow the toolbar, which is on screen to be read.
 *
 * There is a second route, and it is the one a hand on the keyboard actually
 * uses: a **bare letter, from select** (B-KEY-21). Select does not write any
 * more, so the plain letters are free again — which is the whole reason the
 * numbered row had to exist in the first place. The two live side by side
 * because they answer different questions: the digit is "the fourth button",
 * readable straight off the toolbar and reachable from anywhere, and the letter
 * is "connect", reachable only from the mode that has nothing else to do with
 * it.
 */

export type ToolId =
  | 'select'
  | 'box'
  | 'circle'
  | 'line'
  | 'arrow'
  | 'text'
  | 'erase'
  | 'freehand';

export interface Tool {
  id: ToolId;
  label: string;
  /**
   * The key that reaches it, on `Ctrl`. A digit for everything in the numbered
   * row; a letter for anything past it, since the row is what the digits are
   * counting and a tool that is not in it has no number to be.
   */
  key: string;
  /**
   * The bare letter that enters it **from select** (B-KEY-21), for the four
   * modes a diagram is actually built out of. Absent means "no letter": the
   * tool is still reached by its `Ctrl` key and by its button, and a mode with
   * no letter is better than a letter nobody can guess.
   *
   * `c` is *connect* rather than *circle*, and `s` is the circle — `c` was
   * worth more to the line tool, which is the one reached constantly, and it
   * leaves `hjkl` whole (`l` would otherwise have been both "line" and vim's
   * rightward step).
   */
  mode?: string;
}

export const TOOLS: readonly Tool[] = [
  { id: 'select', label: 'Select', key: '1' },
  { id: 'box', label: 'Box', key: '2', mode: 'b' },
  { id: 'circle', label: 'Circle', key: '3', mode: 's' },
  { id: 'line', label: 'Line', key: '4', mode: 'c' },
  { id: 'arrow', label: 'Arrow', key: '5' },
  { id: 'text', label: 'Text', key: '6', mode: 't' },
  { id: 'erase', label: 'Eraser', key: '7' },
  { id: 'freehand', label: 'Freehand', key: 'Q' },
];

/**
 * The tool `Ctrl`+this picks, or undefined when nothing answers to it.
 *
 * By key rather than by position, so a tool that is not in the numbered row is
 * still reached from the same table. One list, still: the button, the hint on
 * it and the shortcut that matches are the same fact written once.
 */
export function toolForKey(key: string): ToolId | undefined {
  const lower = key.toLowerCase();
  return TOOLS.find((t) => t.key.toLowerCase() === lower)?.id;
}

/**
 * The tool a bare letter enters, or undefined when nothing answers to it.
 *
 * Only ever consulted under select (B-KEY-21). From the same table as the
 * buttons and the `Ctrl` keys, so the ribbon can print the letter beside the
 * mode without a second list to keep in step.
 */
export function toolForMode(key: string): ToolId | undefined {
  const lower = key.toLowerCase();
  return TOOLS.find((t) => t.mode === lower)?.id;
}
