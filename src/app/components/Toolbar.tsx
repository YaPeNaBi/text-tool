import { useEffect } from 'react';
import { CHARSETS } from '../../core/charset/charsets.ts';
import { copyDocument, openDocument, useEditor } from '../state/store.ts';
import { TOOLS } from '../tools.ts';
import { NOTICE_MS } from '../canvas/palette.ts';
import logoLight from '../../assets/logo-light.svg';
import logoDark from '../../assets/logo-dark.svg';
import { useT } from '../i18n/useT.ts';
import { charsetLabel } from '../i18n/core.ts';
import { TOOL_KEYS } from './ribbon-items.ts';

export function Toolbar(): React.JSX.Element {
  const t = useT();
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
  const theme = useEditor((s) => s.theme);
  const toggleTheme = useEditor((s) => s.toggleTheme);
  const openSave = useEditor((s) => s.openSave);

  // One shared transient message, cleared on a timer.
  useEffect(() => {
    if (notice === null) return;
    const id = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(id);
  }, [notice, setNotice]);

  return (
    <div className="toolbar">
      <span className="brand">
        {/* The mark drawn for the theme it sits on: a light tile on the light
            chrome, a dark one on the dark (B-UI-18). The name beside it says
            what it is, so the image itself is decoration. */}
        <img className="brand-logo" src={theme === 'dark' ? logoDark : logoLight} alt="" />
        char.tools
      </span>

      <div className="group">
        {TOOLS.map((tl) => (
          <button
            key={tl.id}
            className={tool === tl.id ? 'active' : ''}
            onClick={() => setTool(tl.id)}
            title={t('tool.title', { tool: t(TOOL_KEYS[tl.id]), key: tl.key })}
          >
            {t(TOOL_KEYS[tl.id])}
            <span className="hint">{tl.key}</span>
          </button>
        ))}
      </div>

      <div className="group">
        <button onClick={undo} disabled={!canUndo} title={t('toolbar.undo.title')}>
          {t('toolbar.undo')}
        </button>
        <button onClick={redo} disabled={!canRedo} title={t('toolbar.redo.title')}>
          {t('toolbar.redo')}
        </button>
      </div>

      <div className="group">
        <label className="check" title={t('toolbar.sticky.title')}>
          <input
            type="checkbox"
            checked={sticky}
            onChange={toggleSticky}
          />
          {t('toolbar.sticky')}
        </label>
        <label className="check" title={t('toolbar.dark.title')}>
          <input type="checkbox" checked={theme === 'dark'} onChange={toggleTheme} />
          {t('toolbar.dark')}
        </label>
      </div>

      <div className="group">
        <label htmlFor="charset">{t('toolbar.charset')}</label>
        <select
          id="charset"
          value={charsetId}
          onChange={(ev) => setCharset(ev.target.value)}
        >
          {Object.values(CHARSETS).map((cs) => (
            <option key={cs.id} value={cs.id}>
              {charsetLabel(cs.id, cs.label, t)}
            </option>
          ))}
        </select>
      </div>

      <div className="group right">
        {notice !== null && <span className="notice">{notice}</span>}
        <button onClick={() => void openDocument()} title={t('toolbar.open.title')}>
          {t('toolbar.open')}
        </button>
        <button onClick={openSave} title={t('toolbar.save.title')}>
          {t('toolbar.save')}
        </button>
        <button
          onClick={() => void copyDocument(useEditor.getState().selection !== null)}
          title={t('toolbar.copy.title')}
        >
          {t('toolbar.copy')}
        </button>
        <button onClick={clearAll} title={t('toolbar.clear.title')}>
          {t('toolbar.clear')}
        </button>
      </div>
    </div>
  );
}
