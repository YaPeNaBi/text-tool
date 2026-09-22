/**
 * What the current tool can do, under the row that picked it.
 *
 * Word's ribbon, in one strip: choosing a mode above changes the band below to
 * that mode's own controls, grouped, captioned, and labelled with the keys that
 * reach them. The editor had thirty-odd bindings and no way to learn any of
 * them from inside the app — the keymap lived in the README, which is the one
 * place a person mid-drawing will not look.
 *
 * Two rules keep it honest:
 *
 *  - **It shows state, not just shortcuts.** Overwrite versus insert, the brush
 *    size, whether object select is on: those are things the editor already
 *    knows and the user could previously only infer. A ribbon that listed keys
 *    and nothing else would be a printed page glued to the window.
 *  - **Its height never changes.** Not between tools, not when a value inside
 *    it grows. A band that resizes moves the canvas down under the pointer, and
 *    the document appears to jump — the same failure the toolbar is fixed
 *    against, and the reason `.ribbon` is a fixed height rather than `auto`.
 *
 * Nothing here is clickable. Every one of these is reachable by the key it
 * names, and a button that duplicated the key would be a second thing to keep
 * in step with the handler for no gain.
 */

import { useEditor } from '../state/store.ts';
import { TOOLS, type ToolId } from '../tools.ts';

interface Item {
  /** Keys, drawn as chips. Empty for a gesture that has no key. */
  keys: readonly string[];
  label: string;
  /** A live value, when this row is a state rather than only a shortcut. */
  state?: string;
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

interface Group {
  name: string;
  items: readonly Item[];
}

/** What the editor knows that the ribbon wants to show, and can be asked to do. */
interface Live {
  insertMode: boolean;
  brush: number;
  objectMode: boolean;
  setTool: (tool: ToolId) => void;
}

function groupsFor(tool: ToolId, live: Live): readonly Group[] {
  /** The same stride everywhere, so it is listed everywhere (B-KEY-19). */
  const stride: Item = { keys: ['Alt', '←→↑↓'], label: 'Stride: ten across, five down' };

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
   */
  const leave: Item = { keys: ['Ctrl', 'Ctrl'], label: 'Back to select' };

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
            { keys: ['Ctrl', 'Enter'], label: 'Everything joined to it' },
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
            },
            { keys: ['Shift', '←→↑↓'], label: 'Grow by objects' },
          ],
        },
        {
          name: 'Act',
          items: [
            { keys: ['Ctrl', 'E'], label: 'Actions · line ends, style' },
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
        draw.push({ keys: ['Shift', '←→↑↓'], label: 'Draw, and let go to keep it' });
      }
      draw.push(
        { keys: ['←→↑↓'], label: 'Size it' },
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

export function Ribbon(): React.JSX.Element {
  const tool = useEditor((s) => s.tool);
  const insertMode = useEditor((s) => s.insertMode);
  const brush = useEditor((s) => s.brush);
  const objectMode = useEditor((s) => s.objectMode);
  const setTool = useEditor((s) => s.setTool);

  const groups = groupsFor(tool, { insertMode, brush, objectMode, setTool });

  return (
    <div className="ribbon">
      {groups.map((group) => (
        <div className="ribbon-group" key={group.name}>
          <div className="ribbon-items">
            {group.items.map((item, i) => (
              // Keyed by position: two rows in a group may legitimately carry
              // the same label — `hjkl` and the arrow keys both say "Walk" —
              // and the list is a fixed table, never reordered.
              <span className="ribbon-item" key={`${group.name}-${String(i)}`}>
                {item.keys.length > 0 && (
                  <span className="keys">
                    {item.keys.map((k, i) => (
                      <kbd key={`${k}-${String(i)}`}>{k}</kbd>
                    ))}
                  </span>
                )}
                {item.run === undefined ? (
                  <span className="what">{item.label}</span>
                ) : (
                  <button className="what ribbon-go" onClick={item.run} title={item.label}>
                    {item.label}
                  </button>
                )}
                {item.state !== undefined && <span className="ribbon-state">{item.state}</span>}
              </span>
            ))}
          </div>
          <div className="ribbon-caption">{group.name}</div>
        </div>
      ))}
    </div>
  );
}
