import { useEffect } from 'react';
import { CHARSETS } from '../../core/charset/charsets.ts';
import {
  copyDocument,
  openDocument,
  saveDocument,
  useEditor,
} from '../state/store.ts';
import { TOOLS } from '../tools.ts';
import { NOTICE_MS } from '../canvas/palette.ts';

export function Toolbar(): React.JSX.Element {
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  const charsetId = useEditor((s) => s.charsetId);
  const setCharset = useEditor((s) => s.setCharset);
  const canUndo = useEditor((s) => s.canUndo);
  const canRedo = useEditor((s) => s.canRedo);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const clearAll = useEditor((s) => s.clearAll);
  const notice = useEditor((s) => s.notice);
  const setNotice = useEditor((s) => s.setNotice);
  const sticky = useEditor((s) => s.sticky);
  const toggleSticky = useEditor((s) => s.toggleSticky);

  // One shared transient message, cleared on a timer.
  useEffect(() => {
    if (notice === null) return;
    const id = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(id);
  }, [notice, setNotice]);

  return (
    <div className="toolbar">
      <span className="brand">ascii writer</span>

      <div className="group">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={tool === t.id ? 'active' : ''}
            onClick={() => setTool(t.id)}
            title={`${t.label} (Ctrl+${t.key})`}
          >
            {t.label}
            <span className="hint">{t.key}</span>
          </button>
        ))}
      </div>

      <div className="group">
        <button onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">
          Undo
        </button>
        <button onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)">
          Redo
        </button>
      </div>

      <div className="group">
        <label className="check" title="Lines follow the shape they touch when it moves">
          <input
            type="checkbox"
            checked={sticky}
            onChange={toggleSticky}
          />
          Sticky
        </label>
      </div>

      <div className="group">
        <label htmlFor="charset">Charset</label>
        <select
          id="charset"
          value={charsetId}
          onChange={(ev) => setCharset(ev.target.value)}
        >
          {Object.values(CHARSETS).map((cs) => (
            <option key={cs.id} value={cs.id}>
              {cs.label}
            </option>
          ))}
        </select>
      </div>

      <div className="group right">
        {notice !== null && <span className="notice">{notice}</span>}
        <button onClick={() => void openDocument()} title="Open a .txt file (Ctrl+O)">
          Open
        </button>
        <button onClick={() => void saveDocument(false)} title="Save (Ctrl+S)">
          Save
        </button>
        <button
          onClick={() => void copyDocument(useEditor.getState().selection !== null)}
          title="Copy selection, or the whole document (Ctrl+C)"
        >
          Copy
        </button>
        <button onClick={clearAll} title="Erase everything">
          Clear
        </button>
      </div>
    </div>
  );
}
