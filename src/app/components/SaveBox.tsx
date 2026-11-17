/**
 * The save box (B-FILE-07): one question, two answers.
 *
 * `Ctrl`+`S` used to go straight to the platform's file dialog, and on the
 * web that is only one of the two things "save" can usefully mean — the other
 * being a link that *is* the drawing (B-FILE-08), which no file picker could
 * offer. So the key asks. The first button is focused on the way in, which
 * keeps `Ctrl`+`S` `Enter` a save for anyone who never wanted the question.
 *
 * Unlike the shape menu, this one holds focus: it is modal, the keymap stands
 * aside while it is up, and `Enter` on a focused button is the browser's own
 * doing. The arrow keys move between the two because the hand that pressed
 * `Ctrl`+`S` is nowhere near `Tab`.
 */

import { useEffect, useRef, useState } from 'react';
import { platform } from '../../platform/index.ts';
import { copyLink, documentLink, saveDocument, useEditor } from '../state/store.ts';
import { useT } from '../i18n/useT.ts';

export function SaveBox(): React.JSX.Element | null {
  const t = useT();
  const open = useEditor((s) => s.saveOpen);
  const fileName = useEditor((s) => s.fileName);
  const revision = useEditor((s) => s.revision);
  const closeSave = useEditor((s) => s.closeSave);
  const first = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [linkLength, setLinkLength] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    first.current?.focus();
    return () => {
      // Nothing keeps focus once the box is gone: a Save button still focused
      // would turn the next Space into another save.
      const el = document.activeElement;
      if (el instanceof HTMLElement) el.blur();
    };
  }, [open]);

  // How long the link would be, so the choice is an informed one. Measured on
  // open rather than kept current, because the document cannot change while
  // the box is up.
  useEffect(() => {
    if (!open) return;
    let live = true;
    setLinkLength(null);
    void documentLink().then((url) => {
      if (live) setLinkLength(url.length);
    });
    return () => {
      live = false;
    };
  }, [open, revision]);

  if (!open) return null;

  const inPlace = platform().canSaveInPlace();

  const onKeyDown = (ev: React.KeyboardEvent): void => {
    if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
    ev.preventDefault();
    const buttons = [...(box.current?.querySelectorAll('button') ?? [])];
    const at = buttons.findIndex((b) => b === document.activeElement);
    const next = buttons[(at + (ev.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length];
    next?.focus();
  };

  return (
    <div className="save-scrim" onPointerDown={closeSave}>
      <div
        className="save-box"
        role="dialog"
        aria-label={t('save.title')}
        ref={box}
        onPointerDown={(ev) => ev.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <h2>{t('save.title')}</h2>
        <button
          ref={first}
          onClick={() => {
            closeSave();
            void saveDocument(false);
          }}
        >
          {t(inPlace ? 'save.to' : 'save.download', { name: fileName })}
          <span className="what">{t('save.file')}</span>
        </button>
        <button onClick={() => void copyLink()}>
          {t('save.link')}
          <span className="what">
            {t('save.linkWhat')}
            {linkLength === null ? '' : ` · ${t('save.linkLength', { count: linkLength })}`}
          </span>
        </button>
        <div className="esc">
          {/* The key goes where the language puts it: "Esc closes", "按 Esc 关闭". */}
          {(() => {
            const [before = '', after = ''] = t('save.closes', { key: '\u0000' }).split('\u0000');
            return (
              <>
                {before}
                <kbd>{t('key.esc')}</kbd>
                {after}
              </>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
