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
 * Almost nothing here is clickable. Every one of these is reachable by the key
 * it names, and a button that duplicated the key would be a second thing to keep
 * in step with the handler for no gain; a row earns one only when it reaches
 * something no key on screen does.
 *
 * **What each row says is in `ribbon-items.ts`, not here.** The band is a list,
 * and a list kept in two places drifts the first time one of them gains a row —
 * which is exactly what happened while the terminal build was being written, and
 * how the split earned itself. This file is only the strip: the chips, the
 * captions, and the fixed height.
 */

import { useEditor } from '../state/store.ts';
import { groupsFor } from './ribbon-items.ts';

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
