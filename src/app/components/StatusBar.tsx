import { describe } from '../../core/recognize/recognize.ts';
import { useEditor } from '../state/store.ts';

export function StatusBar(): React.JSX.Element {
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

  // revision is read so the cell count refreshes on every mutation.
  void revision;

  return (
    <div className="statusbar">
      <span>{hover === null ? '—' : `${hover.x}, ${hover.y}`}</span>
      <span>{grid.size} cells</span>
      <span>
        {selection === null ? 'no selection' : describe(selection)}
        {/* Drill-through depth, so it is obvious more readings exist (B-UI-06). */}
        {drill !== null && drill.list.length > 1
          ? ` · ${drill.index + 1}/${drill.list.length}`
          : ''}
      </span>

      {caret !== null && (
        <span>
          caret {caret.x}, {caret.y} · {insertMode ? 'INS' : 'OVR'}
        </span>
      )}
      {tool === 'erase' && <span>brush {brush}</span>}
      {chain !== null && (
        <span>
          line: {chain.length} {chain.length === 1 ? 'point' : 'corners'} · Enter or
          right-click to finish
        </span>
      )}

      <span className="right">
        {fileName}
        {dirty ? ' •' : ''}
      </span>
      <span>{Math.round(zoom * 100)}%</span>
    </div>
  );
}
