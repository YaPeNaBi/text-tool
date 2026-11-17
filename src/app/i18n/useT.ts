/**
 * The translator for the language the editor is in, for a component (B-UI-19).
 * Subscribing to the language is what re-renders the component when it changes.
 */

import { useMemo } from 'react';
import { useEditor } from '../state/store.ts';
import { translator, type Translate } from './index.ts';

export function useT(): Translate {
  const lang = useEditor((s) => s.lang);
  return useMemo(() => translator(lang), [lang]);
}
