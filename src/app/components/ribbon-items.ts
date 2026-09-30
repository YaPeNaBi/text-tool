/**
 * What each tool can do, as data.
 *
 * Lifted out of `Ribbon.tsx` when the terminal build arrived, and the reason is
 * the same one `tools.ts` exists for: the band is a *list*, and a list kept in
 * two places drifts the first time one of them gains a row. The web ribbon
 * draws these as chips in a fixed-height strip; the terminal draws them as a
 * band above the status line. One table, two renderings.
 *
 * It is plain TypeScript with no JSX for a second, blunter reason: Node runs
 * the terminal build straight from source, and a `.tsx` would not parse.
 */

import { TOOLS, type ToolId } from '../tools.ts';

export interface Item {
  /** Keys, drawn as chips. Empty for a gesture that has no key. */
  keys: readonly string[];
  label: string;
  /** A live value, when this row is a state rather than only a shortcut. */
  state?: string;
  /**
   * What the terminal shows instead, where a tty cannot deliver the web gesture.
   *
   * There are six such bindings and they are listed together in
   * `terminal/keymap.ts` (`SUBSTITUTES`) with what forced each one. This field is
   * how the band tells the truth about them: printing `Shift Shift` at someone
   * whose terminal will never send a bare modifier is worse than printing
   * nothing, because they would conclude the *feature* was missing rather than
   * that the key was different.
   *
   * `null` drops the row from the terminal band altogether, for a gesture that
   * has no terminal equivalent at all rather than a different key.
   */
  terminal?: { keys?: readonly string[]; label?: string } | null;
  /**
   * What pressing it does, for the few rows that are worth a button.
   *
   * The band is a keymap first and stays one: a button that only repeated a
   * key would be a second thing to keep in step for no gain. A row earns one
   * when it reaches something the row above cannot — picking up a tool that is
   * not in the numbered strip, which is otherwise reachable only by knowing
   * its letter already.
   */
  run?: () => void;
}

export interface Group {
  name: string;
  items: readonly Item[];
}

/** What the editor knows that the ribbon wants to show, and can be asked to do. */
export interface Live {
  insertMode: boolean;
  brush: number;
  objectMode: boolean;
  setTool: (tool: ToolId) => void;
}

export function groupsFor(tool: ToolId, live: Live): readonly Group[] {
  /**
   * The same stride everywhere, so it is listed everywhere (B-KEY-19).
   *
   * The wall is named because it is the half of this key nobody would guess
   * (B-KEY-19a) — that the count is *up to* ten rather than exactly ten. The
   * distance you could work out by pressing it twice; a stride that sometimes
   * stops short would just look erratic.
   */
  const stride: Item = {
    keys: ['Alt', '←→↑↓'],
    label: 'Stride: ten across, five down — stops at a wall',
  };

  const typing: Group = {
    name: 'Typing',
    items: [
      { keys: ['Insert'], label: 'Mode', state: live.insertMode ? 'Insert' : 'Overwrite' },
      { keys: ['Enter'], label: 'New line, same column' },
      { keys: ['Tab'], label: 'Shape ↔ text' },
    ],
  };

  /**
   * The way back, listed under every mode that is not select (B-KEY-21).
   *
   * A modal editor's worst failure is stranding someone in a mode they cannot
   * name, so the exit is on screen wherever it applies rather than only in the
   * mode they would have to leave to read about it.
   *
   * `jk` is the one shown, being the one a hand on the home row reaches without
   * moving (B-KEY-23); two taps of `Ctrl` ride along in the label rather than
   * as a row of their own, which would have cost several modes a column. The
   * terminal cannot see those two taps at all, so it names `Esc` instead — the
   * key that was always the other way out.
   */
  const leave: Item = {
    keys: ['jk'],
    label: 'Back to select · or Ctrl Ctrl',
    terminal: { label: 'Back to select · or Esc' },
  };

  /**
   * The mode letters, off the same table as the toolbar (tools.ts), with the
   * two ways of walking underneath them.
   *
   * The letters are generated rather than typed out, so a tool that gains one
   * gains its ribbon row in the same edit — the drift this whole file exists
   * to prevent. No `run`: the toolbar directly above is already these buttons,
   * and a second copy would be a second thing to keep in step for no reach
   * gained.
   *
   * Walking is grouped *here*, rather than with the other movement keys, for a
   * reason about width as much as sense: the band lays out three rows to a
   * column, so four letters already claim a second column and the two walk
   * rows ride along in it for nothing. Put with the modifier moves they would
   * have cost a column of their own, and this band is already wider than a
   * 1280px window. They belong here anyway — `hjkl` is what keeps the hand on
   * the letters that leave select.
   */
  const modes: Group = {
    name: 'Modes',
    items: [
      ...TOOLS.filter((t) => t.mode !== undefined).map((t) => ({
        keys: [t.mode as string],
        label: t.label,
      })),
      { keys: ['hjkl'], label: 'Walk' },
      { keys: ['←→↑↓'], label: 'Walk' },
    ],
  };

  switch (tool) {
    case 'select':
      return [
        modes,
        {
          name: 'Select',
          items: [
            { keys: [], label: 'Click · again widens' },
            { keys: ['Shift', 'click'], label: 'Add all of it' },
            { keys: ['Ctrl', 'click'], label: 'Add one piece' },
            { keys: ['Ctrl', 'A'], label: 'Everything' },
            { keys: ['Enter'], label: 'This shape · the whole one' },
            // A terminal sends a plain carriage return for Ctrl+Enter, so the
            // modifier never arrives and the binding needs a letter of its own.
            { keys: ['Ctrl', 'Enter'], label: 'Everything joined to it', terminal: { keys: ['g'] } },
          ],
        },
        {
          name: 'Move',
          items: [
            { keys: ['Ctrl', '←→↑↓'], label: 'Move the selection, else jump' },
            { keys: ['Ctrl', 'Alt'], label: 'Move it by a stride' },
            { keys: ['Alt', '←→↑↓'], label: 'Nudge, or stride if nothing is' },
          ],
        },
        {
          name: 'Sweep',
          items: [
            { keys: ['Shift', '←→↑↓'], label: 'A rectangle · grows the selection' },
            { keys: ['Ctrl', 'Shift'], label: 'Out to the jump' },
            { keys: ['Ctrl', 'Alt'], label: 'Reading order, nothing selected' },
          ],
        },
        {
          name: 'Objects',
          items: [
            {
              keys: ['Shift', 'Shift'],
              label: 'Select by object',
              state: live.objectMode ? 'On' : 'Off',
              // A bare modifier sends nothing down a tty, so the double tap
              // cannot be seen there at all.
              terminal: { keys: ['o'] },
            },
            { keys: ['Shift', '←→↑↓'], label: 'Grow by objects' },
          ],
        },
        {
          name: 'Act',
          items: [
            // Bare, since select does not write; `Ctrl`+`E` still works (B-UI-11).
            { keys: ['e'], label: 'Actions · line ends, style, fonts' },
            { keys: ['Ctrl', 'D'], label: 'Duplicate' },
            { keys: ['Delete'], label: 'Erase' },
          ],
        },
      ];

    case 'box':
    case 'circle': {
      const draw: Item[] = [
        { keys: [], label: 'Drag corner to corner' },
        { keys: ['Space'], label: 'Or start at the cursor' },
      ];
      // The one-gesture version is the box's alone (B-DRAW-15); a circle is
      // still Space and Enter, and listing a key that does nothing here would
      // be worse than listing nothing.
      if (tool === 'box') {
        draw.push({
          keys: ['Shift', '←→↑↓'],
          label: 'Draw, and let go to keep it',
          // There is no key release down a tty, so the gesture keeps its start
          // and borrows Space's ending.
          terminal: { label: 'Draw, then Enter to keep it' },
        });
      }
      draw.push(
        { keys: ['←→↑↓'], label: 'Size it' },
        // The home row reaches into the drawing modes too (B-KEY-22), so it is
        // listed where it works rather than only under select — a key that is
        // only documented in the mode you had to leave is one nobody finds.
        { keys: ['hjkl'], label: 'Size it' },
        { keys: ['Enter'], label: 'Commit' },
        { keys: ['Esc'], label: 'Abandon · then back to select' },
        stride,
      );

      return [
        { name: 'Draw', items: draw },
        {
          name: 'Joins',
          items: [{ keys: [], label: 'Crossings become junctions' }, leave],
        },
      ];
    }

    case 'line':
    case 'arrow':
      return [
        {
          name: 'Draw',
          items: [
            { keys: [], label: 'Click corner after corner' },
            { keys: ['Space'], label: 'Or drop at the cursor' },
            { keys: ['←→↑↓'], label: 'Aim the next corner' },
            { keys: ['hjkl'], label: 'Aim the next corner' },
            { keys: ['Enter'], label: 'Finish, through the cursor' },
            { keys: ['Esc'], label: 'Abandon · then back to select' },
            stride,
          ],
        },
        {
          name: 'Shape',
          items: [
            { keys: ['Alt'], label: 'Flip the elbow, dragging' },
            { keys: [], label: 'Drag for a single segment' },
            leave,
          ],
        },
        {
          name: 'Freehand',
          items: [
            {
              keys: ['Ctrl', 'Q'],
              label: 'Draw by hand',
              run: () => { live.setTool('freehand'); },
            },
            { keys: [], label: 'The stroke becomes line glyphs' },
          ],
        },
      ];

    case 'freehand':
      return [
        {
          name: 'Draw',
          items: [
            { keys: [], label: 'Drag, and it follows the pointer' },
            { keys: [], label: 'Every cell it crosses is drawn' },
            { keys: [], label: 'Crossings become junctions' },
          ],
        },
        {
          name: 'Back',
          items: [
            {
              keys: ['Ctrl', '4'],
              label: 'Straight lines',
              // Control codes only cover the letters, so the numbered row is
              // reached by its bare digit here — which select does not need back,
              // and no drawing mode was using.
              terminal: { keys: ['4'] },
              run: () => { live.setTool('line'); },
            },
            { keys: ['Ctrl', 'Z'], label: 'Undo the whole stroke' },
            leave,
          ],
        },
      ];

    case 'text':
      return [
        {
          name: 'Caret',
          items: [
            { keys: [], label: 'It starts where the keyboard was' },
            { keys: ['←→↑↓'], label: 'Walk it' },
            // One press, not two: the caret and the mode are the same fact
            // now, so leaving the writing is leaving the mode (B-KEY-21).
            { keys: ['Esc'], label: 'Done · back to select' },
            // Under text too, where the `j` and `k` are never written (B-KEY-23).
            { keys: ['jk'], label: 'The same, from the home row' },
            {
              keys: [],
              label: 'Huge letters: type, Backspace, Enter, Space',
            },
            stride,
          ],
        },
        typing,
      ];

    case 'erase':
      return [
        {
          name: 'Brush',
          items: [
            { keys: [], label: 'Drag to rub out' },
            { keys: ['[', ']'], label: 'Size', state: `${live.brush}×${live.brush}` },
            stride,
          ],
        },
        {
          name: 'Repair',
          items: [{ keys: [], label: 'Stray arms are mended' }, leave],
        },
      ];
  }
}
