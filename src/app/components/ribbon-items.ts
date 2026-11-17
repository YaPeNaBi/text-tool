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
import type { MessageKey, Translate } from '../i18n/index.ts';

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
  /** Every label in the language the editor is in (B-UI-19). */
  t: Translate;
}

/** Each tool's name, as a message (B-UI-19). */
export const TOOL_KEYS: Readonly<Record<ToolId, MessageKey>> = {
  select: 'tool.select',
  box: 'tool.box',
  circle: 'tool.circle',
  line: 'tool.line',
  arrow: 'tool.arrow',
  text: 'tool.text',
  erase: 'tool.erase',
  freehand: 'tool.freehand',
};

export function groupsFor(tool: ToolId, live: Live): readonly Group[] {
  const { t } = live;
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
    label: t('ribbon.stride'),
  };

  const typing: Group = {
    name: t('group.typing'),
    items: [
      { keys: ['Insert'], label: t('ribbon.typingMode'), state: t(live.insertMode ? 'ribbon.insert' : 'ribbon.overwrite') },
      { keys: ['Enter'], label: t('ribbon.newLine') },
      { keys: ['Tab'], label: t('ribbon.shapeText') },
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
    label: t('ribbon.leave'),
    terminal: { label: t('ribbon.leave.terminal') },
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
    name: t('group.modes'),
    items: [
      ...TOOLS.filter((tl) => tl.mode !== undefined).map((tl) => ({
        keys: [tl.mode as string],
        label: t(TOOL_KEYS[tl.id]),
      })),
      { keys: ['hjkl'], label: t('ribbon.walk') },
      { keys: ['←→↑↓'], label: t('ribbon.walk') },
    ],
  };

  switch (tool) {
    case 'select':
      return [
        modes,
        {
          name: t('group.select'),
          items: [
            { keys: [], label: t('ribbon.clickWidens') },
            { keys: ['Shift', 'click'], label: t('ribbon.addAll') },
            { keys: ['Ctrl', 'click'], label: t('ribbon.addPiece') },
            { keys: ['Ctrl', 'A'], label: t('ribbon.everything') },
            { keys: ['Enter'], label: t('ribbon.enterLadder') },
            // A terminal sends a plain carriage return for Ctrl+Enter, so the
            // modifier never arrives and the binding needs a letter of its own.
            { keys: ['Ctrl', 'Enter'], label: t('ribbon.joined'), terminal: { keys: ['g'] } },
          ],
        },
        {
          name: t('group.move'),
          items: [
            { keys: ['Ctrl', '←→↑↓'], label: t('ribbon.moveSelection') },
            { keys: ['Ctrl', 'Alt'], label: t('ribbon.moveStride') },
            { keys: ['Alt', '←→↑↓'], label: t('ribbon.nudge') },
          ],
        },
        {
          name: t('group.sweep'),
          items: [
            { keys: ['Shift', '←→↑↓'], label: t('ribbon.rectangle') },
            { keys: ['Ctrl', 'Shift'], label: t('ribbon.toJump') },
            { keys: ['Ctrl', 'Alt'], label: t('ribbon.readingOrder') },
          ],
        },
        {
          name: t('group.objects'),
          items: [
            {
              keys: ['Shift', 'Shift'],
              label: t('ribbon.byObject'),
              state: t(live.objectMode ? 'ribbon.on' : 'ribbon.off'),
              // A bare modifier sends nothing down a tty, so the double tap
              // cannot be seen there at all.
              terminal: { keys: ['o'] },
            },
            { keys: ['Shift', '←→↑↓'], label: t('ribbon.growObjects') },
          ],
        },
        {
          name: t('group.act'),
          items: [
            // Bare, since select does not write; `Ctrl`+`E` still works (B-UI-11).
            { keys: ['e'], label: t('ribbon.actions') },
            { keys: ['Ctrl', 'D'], label: t('ribbon.duplicate') },
            { keys: ['Delete'], label: t('ribbon.erase') },
          ],
        },
      ];

    case 'box':
    case 'circle': {
      const draw: Item[] = [
        { keys: [], label: t('ribbon.dragCorners') },
        { keys: ['Space'], label: t('ribbon.startAtCursor') },
      ];
      // The one-gesture version is the box's alone (B-DRAW-15); a circle is
      // still Space and Enter, and listing a key that does nothing here would
      // be worse than listing nothing.
      if (tool === 'box') {
        draw.push({
          keys: ['Shift', '←→↑↓'],
          label: t('ribbon.drawLetGo'),
          // There is no key release down a tty, so the gesture keeps its start
          // and borrows Space's ending.
          terminal: { label: t('ribbon.drawEnter') },
        });
      }
      draw.push(
        { keys: ['←→↑↓'], label: t('ribbon.sizeIt') },
        // The home row reaches into the drawing modes too (B-KEY-22), so it is
        // listed where it works rather than only under select — a key that is
        // only documented in the mode you had to leave is one nobody finds.
        { keys: ['hjkl'], label: t('ribbon.sizeIt') },
        { keys: ['Enter'], label: t('ribbon.commit') },
        { keys: ['Esc'], label: t('ribbon.abandon') },
        stride,
      );

      return [
        { name: t('group.draw'), items: draw },
        {
          name: t('group.joins'),
          items: [{ keys: [], label: t('ribbon.crossings') }, leave],
        },
      ];
    }

    case 'line':
    case 'arrow':
      return [
        {
          name: t('group.draw'),
          items: [
            { keys: [], label: t('ribbon.clickCorners') },
            { keys: ['Space'], label: t('ribbon.dropAtCursor') },
            { keys: ['←→↑↓'], label: t('ribbon.aim') },
            { keys: ['hjkl'], label: t('ribbon.aim') },
            { keys: ['Enter'], label: t('ribbon.finish') },
            { keys: ['Esc'], label: t('ribbon.abandon') },
            stride,
          ],
        },
        {
          name: t('group.shape'),
          items: [
            { keys: ['Alt'], label: t('ribbon.flipElbow') },
            { keys: [], label: t('ribbon.singleSegment') },
            leave,
          ],
        },
        {
          name: t('group.freehand'),
          items: [
            {
              keys: ['Ctrl', 'Q'],
              label: t('ribbon.drawByHand'),
              run: () => { live.setTool('freehand'); },
            },
            { keys: [], label: t('ribbon.strokeGlyphs') },
          ],
        },
      ];

    case 'freehand':
      return [
        {
          name: t('group.draw'),
          items: [
            { keys: [], label: t('ribbon.followsPointer') },
            { keys: [], label: t('ribbon.everyCell') },
            { keys: [], label: t('ribbon.crossings') },
          ],
        },
        {
          name: t('group.back'),
          items: [
            {
              keys: ['Ctrl', '4'],
              label: t('ribbon.straightLines'),
              // Control codes only cover the letters, so the numbered row is
              // reached by its bare digit here — which select does not need back,
              // and no drawing mode was using.
              terminal: { keys: ['4'] },
              run: () => { live.setTool('line'); },
            },
            { keys: ['Ctrl', 'Z'], label: t('ribbon.undoStroke') },
            leave,
          ],
        },
      ];

    case 'text':
      return [
        {
          name: t('group.caret'),
          items: [
            { keys: [], label: t('ribbon.caretStarts') },
            { keys: ['←→↑↓'], label: t('ribbon.walkIt') },
            // One press, not two: the caret and the mode are the same fact
            // now, so leaving the writing is leaving the mode (B-KEY-21).
            { keys: ['Esc'], label: t('ribbon.done') },
            // Under text too, where the `j` and `k` are never written (B-KEY-23).
            { keys: ['jk'], label: t('ribbon.homeRow') },
            {
              keys: [],
              label: t('ribbon.hugeLetters'),
            },
            stride,
          ],
        },
        typing,
      ];

    case 'erase':
      return [
        {
          name: t('group.brush'),
          items: [
            { keys: [], label: t('ribbon.rubOut') },
            { keys: ['[', ']'], label: t('ribbon.size'), state: `${live.brush}×${live.brush}` },
            stride,
          ],
        },
        {
          name: t('group.repair'),
          items: [{ keys: [], label: t('ribbon.mended') }, leave],
        },
      ];
  }
}
