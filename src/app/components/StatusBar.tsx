import { useEditor } from '../state/store.ts';
import { useT } from '../i18n/useT.ts';
import { describeSelection } from '../i18n/core.ts';
import { LANGUAGES, isLang } from '../i18n/languages.ts';

export function StatusBar(): React.JSX.Element {
  const t = useT();
  const revision = useEditor((s) => s.revision);
  const grid = useEditor((s) => s.grid);
  const selection = useEditor((s) => s.selection);
  const drill = useEditor((s) => s.drill);
  const zoom = useEditor((s) => s.camera.zoom);
  const hover = useEditor((s) => s.hover);
  const caret = useEditor((s) => s.caret);
  const insertMode = useEditor((s) => s.insertMode);
  const tool = useEditor((s) => s.tool);
  const brush = useEditor((s) => s.brush);
  const chain = useEditor((s) => s.chain);
  const fileName = useEditor((s) => s.fileName);
  const dirty = useEditor((s) => s.dirty);
  const lang = useEditor((s) => s.lang);
  const setLang = useEditor((s) => s.setLang);

  // revision is read so the cell count refreshes on every mutation.
  void revision;

  return (
    <div className="statusbar">
      <span>{hover === null ? '—' : `${hover.x}, ${hover.y}`}</span>
      <span>{t('status.cells', { count: grid.size })}</span>
      <span>
        {selection === null ? t('status.noSelection') : describeSelection(selection, t)}
        {/* Drill-through depth, so it is obvious more readings exist (B-UI-06). */}
        {drill !== null && drill.list.length > 1
          ? ` · ${drill.index + 1}/${drill.list.length}`
          : ''}
      </span>

      {caret !== null && (
        <span>
          {t('status.caret', {
            x: caret.x,
            y: caret.y,
            mode: t(insertMode ? 'status.ins' : 'status.ovr'),
          })}
        </span>
      )}
      {tool === 'erase' && <span>{t('status.brush', { size: brush })}</span>}
      {chain !== null && <span>{t('status.line', { count: chain.length })}</span>}

      <span className="right">
        {fileName}
        {dirty ? ' •' : ''}
      </span>
      <span>{Math.round(zoom * 100)}%</span>
      {/* The interface's language (B-UI-19), each under its own name — and
          marked as being in it, so a screen reader says "Deutsch" in German. */}
      <select
        className="lang"
        aria-label={t('status.language')}
        title={t('status.language')}
        value={lang}
        onChange={(ev) => {
          if (isLang(ev.target.value)) setLang(ev.target.value);
        }}
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code} lang={l.code}>
            {l.name}
          </option>
        ))}
      </select>
    </div>
  );
}
