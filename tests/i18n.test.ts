/**
 * The interface in eighteen languages (B-UI-19).
 *
 * What is pinned: every language has every message, with the same placeholders
 * as the English; plurals follow each language's own rules; a browser's
 * preference finds the right language; every sentence a planner can say is
 * recognised and translated; English reads exactly as it did before there were
 * translations; and the choice is kept, while a mere detection is not.
 */

import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { UNICODE } from '../src/core/charset/charsets.ts';
import { ck } from '../src/core/geom/cell.ts';
import { applyDiff, createGrid, type Grid } from '../src/core/grid/grid.ts';
import { fromText } from '../src/core/io/text.ts';
import { stampBox } from '../src/core/stamp/box.ts';
import { stampPath } from '../src/core/stamp/path.ts';
import { describe as describeCore, type Candidate } from '../src/core/recognize/recognize.ts';
import { candidatesAt } from '../src/core/recognize/rank.ts';
import { planBanner, planUnbanner } from '../src/core/ops/banner.ts';
import { planResize } from '../src/core/ops/resize.ts';
import { planLineEnd } from '../src/core/ops/lineend.ts';
import { planAddColumn, planAddRow } from '../src/core/ops/lattice.ts';
import { renderBanner, styleFor } from '../src/core/text/banner.ts';
import { EN, type MessageKey } from '../src/app/i18n/catalogs/en.ts';
import { catalogOf, isLoaded, keyLabel, loadLanguage, translate, translator } from '../src/app/i18n/index.ts';
import { LANGUAGES, matchLanguage, type Lang } from '../src/app/i18n/languages.ts';
import type { Message } from '../src/app/i18n/types.ts';
import { describeSelection, localizePlanText } from '../src/app/i18n/core.ts';
import { groupsFor } from '../src/app/components/ribbon-items.ts';
import { followLanguage, menuFor, useEditor } from '../src/app/state/store.ts';
import { installPlatform, type SettingName } from '../src/platform/index.ts';

const KEYS = Object.keys(EN) as MessageKey[];

// Every language but English is fetched on demand (B-UI-19); load them all once.
beforeAll(async () => {
  await Promise.all(LANGUAGES.map((l) => loadLanguage(l.code)));
});

function catalog(lang: Lang): NonNullable<ReturnType<typeof catalogOf>> {
  const c = catalogOf(lang);
  if (c === undefined) throw new Error(`${lang} not loaded`);
  return c;
}
const OTHERS = LANGUAGES.map((l) => l.code).filter((c): c is Exclude<Lang, 'en'> => c !== 'en');

function forms(msg: Message): string[] {
  return typeof msg === 'string' ? [msg] : Object.values(msg);
}

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string).sort();
}

function gridFrom(art: string): Grid {
  const grid = createGrid();
  applyDiff(grid, fromText(art));
  return grid;
}

function first(grid: Grid, x: number, y: number): Candidate {
  const c = candidatesAt(grid, x, y)[0];
  if (c === undefined) throw new Error(`nothing at ${x},${y}`);
  return c;
}

describe('the catalogs', () => {
  it('load for every language listed', () => {
    for (const l of LANGUAGES) expect(isLoaded(l.code), l.code).toBe(true);
    expect(LANGUAGES).toHaveLength(18);
  });

  it.each(OTHERS)('%s has every message, and nothing English does not', (lang) => {
    expect(Object.keys(catalog(lang)).sort()).toEqual([...KEYS].sort());
  });

  it.each(OTHERS)('%s keeps every placeholder, in every plural form', (lang) => {
    for (const key of KEYS) {
      const want = placeholders(forms(EN[key])[0] ?? '');
      const msg = catalog(lang)[key];
      if (msg === undefined) continue;
      for (const form of forms(msg)) expect(placeholders(form), `${lang} ${key}`).toEqual(want);
      if (typeof msg !== 'string') expect(msg.other, `${lang} ${key}`).toBeTruthy();
    }
  });

  it.each(OTHERS)('%s is translated, not English with a new name', (lang) => {
    const own = catalog(lang);
    // Names that are the same everywhere, and key names that keyboards print in
    // English, are allowed to match; everything else should mostly not.
    const same = KEYS.filter((k) => {
      if (k.startsWith('key.') || k === 'tool.title' || k.startsWith('charset.')) return false;
      return JSON.stringify(own[k]) === JSON.stringify(EN[k]);
    });
    expect(same.length, `${lang}: ${same.join(', ')}`).toBeLessThanOrEqual(6);
  });
});

describe('translating', () => {
  it('fills placeholders', () => {
    expect(translate('fr', 'save.to', { name: 'plan.txt' })).toBe('Enregistrer dans plan.txt');
    expect(translate('ja', 'notice.opened', { name: 'a.txt' })).toBe('a.txt を開きました');
  });

  it('picks the plural form each language asks for', () => {
    expect(translate('en', 'status.cells', { count: 1 })).toBe('1 cell');
    expect(translate('en', 'status.cells', { count: 2 })).toBe('2 cells');
    expect(translate('ru', 'status.cells', { count: 1 })).toBe('1 клетка');
    expect(translate('ru', 'status.cells', { count: 3 })).toBe('3 клетки');
    expect(translate('ru', 'status.cells', { count: 5 })).toBe('5 клеток');
    expect(translate('ru', 'status.cells', { count: 21 })).toBe('21 клетка');
    expect(translate('sk', 'status.cells', { count: 4 })).toBe('4 bunky');
    expect(translate('sk', 'status.cells', { count: 7 })).toBe('7 buniek');
    expect(translate('fr', 'status.cells', { count: 0 })).toBe('0 case');
    expect(translate('ko', 'status.cells', { count: 9 })).toBe('9칸');
  });

  it('names keys the way the keyboard prints them', () => {
    expect(keyLabel('Ctrl', translator('de'))).toBe('Strg');
    expect(keyLabel('click', translator('fr'))).toBe('clic');
    expect(keyLabel('←→↑↓', translator('de'))).toBe('←→↑↓');
    expect(keyLabel('Ctrl', translator('en'))).toBe('Ctrl');
  });
});

describe('matching a browser’s languages', () => {
  it.each([
    [['fr-CA', 'en'], 'fr'],
    [['de-AT'], 'de'],
    [['pt-BR', 'es-419'], 'es'],
    [['zh-CN'], 'zh-Hans'],
    [['zh-Hans-SG'], 'zh-Hans'],
    [['zh-TW'], 'zh-Hans'],
    [['zh-HK'], 'yue-Hant'],
    [['yue'], 'yue-Hant'],
    [['wuu'], 'wuu-Hans'],
    [['in-ID'], 'id'],
    [['ja-JP'], 'ja'],
    [['ko'], 'ko'],
    [['mr-IN', 'hi'], 'mr'],
    [['bn-BD'], 'bn'],
    [['sk-SK'], 'sk'],
    [['sv-FI'], 'sv'],
    [['el'], 'el'],
  ] as const)('%j → %s', (tags, want) => {
    expect(matchLanguage(tags)).toBe(want);
  });

  it('finds nothing in a list of languages it does not speak', () => {
    expect(matchLanguage(['pt-BR', 'nl'])).toBeNull();
    expect(matchLanguage([])).toBeNull();
  });
});

describe('what the status bar says', () => {
  const ascii = ['┌──┐', '│  │', '└──┘'].join('\n');

  it('reads, in English, exactly as the core describes it', () => {
    const en = translator('en');
    const block = styleFor('block');
    if (block === undefined) throw new Error('no block font');
    const cases: Candidate[] = [
      first(gridFrom(ascii), 0, 0),
      first(gridFrom('───▶'), 0, 0),
      first(gridFrom('────'), 0, 0),
      first(gridFrom('hello'), 0, 0),
      first(gridFrom(renderBanner('HI', block).join('\n')), 0, 0),
      { kind: 'cells', cells: new Set([ck(0, 0), ck(1, 0)]), bounds: { x: 0, y: 0, w: 2, h: 1 } },
      { kind: 'ellipse', cells: new Set([ck(0, 0)]), bounds: { x: 0, y: 0, w: 5, h: 5 } },
      { kind: 'ellipse', cells: new Set([ck(0, 0)]), bounds: { x: 0, y: 0, w: 9, h: 5 } },
    ];
    for (const c of cases) expect(describeSelection(c, en)).toBe(describeCore(c));
  });

  it('and says it in the language the editor is in', () => {
    const box = first(gridFrom(ascii), 0, 0);
    expect(describeSelection(box, translator('de'))).toBe('Rechteck 4×3');
    expect(describeSelection(first(gridFrom('hello'), 0, 0), translator('ru'))).toBe('Текст: 5 символов');
  });
});

describe('what an operation says', () => {
  /** Every sentence a planner can say, produced by the planner itself. */
  function sentences(): string[] {
    const out: string[] = [];
    const block = styleFor('block');
    if (block === undefined) throw new Error('no block font');

    // Nothing to set in a font: a selection of nothing but a blank.
    const blank = createGrid();
    blank.set(ck(0, 0), ' ');
    out.push(planBanner(blank, { kind: 'text', cells: new Set([ck(0, 0)]), bounds: { x: 0, y: 0, w: 1, h: 1 } }, block).refused ?? '');

    // …and rows tall: one row of text becomes five of letters.
    const word = gridFrom('HI');
    out.push(planBanner(word, first(word, 0, 0), block).note ?? '');

    // Nothing to turn back: ordinary text is not big letters.
    out.push(planUnbanner(word, first(word, 0, 0)).refused ?? '');

    // A box that will not shrink over its label.
    const labelled = createGrid();
    applyDiff(labelled, stampBox(labelled, { x: 0, y: 0, w: 10, h: 5 }, UNICODE));
    applyDiff(labelled, fromText('hello', 2, 2));
    out.push(planResize(labelled, first(labelled, 0, 0), { x: 0, y: 0, w: 4, h: 5 }, { charset: UNICODE }).refused ?? '');

    // Line ends on a box, and on an end that is not there.
    out.push(planLineEnd(labelled, first(labelled, 0, 0), 0, 'arrow', UNICODE).refused ?? '');
    const line = createGrid();
    applyDiff(line, stampPath(line, { x: 0, y: 0 }, { x: 6, y: 0 }, UNICODE));
    out.push(planLineEnd(line, first(line, 3, 0), 5, 'arrow', UNICODE).refused ?? '');

    // A column and a row on a line, and on a box — with something below it.
    out.push(planAddColumn(line, first(line, 3, 0), { charset: UNICODE }).refused ?? '');
    out.push(planAddRow(line, first(line, 3, 0), { charset: UNICODE }).refused ?? '');
    const box = createGrid();
    applyDiff(box, stampBox(box, { x: 0, y: 0, w: 8, h: 4 }, UNICODE));
    out.push(planAddColumn(box, first(box, 0, 0), { charset: UNICODE }).note ?? '');
    applyDiff(box, fromText('below', 0, 6));
    out.push(planAddRow(box, first(box, 0, 0), { charset: UNICODE }).note ?? '');

    // The router's two, by the text it writes: a stranded route needs a maze.
    const router = readFileSync(new URL('../src/core/route/connectors.ts', import.meta.url), 'utf8');
    expect(router).toContain("'No clear route — the line goes straight there'");
    expect(router).toContain('lines had no clear route — they go straight there`');
    out.push('No clear route — the line goes straight there', '3 lines had no clear route — they go straight there');
    return out;
  }

  it('produces every sentence the translations know of', () => {
    const said = sentences();
    expect(said.every((s) => s !== '')).toBe(true);
    expect(said).toHaveLength(12);
  });

  it.each(OTHERS)('every one of them is translated into %s', (lang) => {
    const t = translator(lang);
    for (const s of sentences()) {
      const out = localizePlanText(s, t);
      expect(out, `${lang}: ${s}`).not.toBe(s);
      // Numbers survive the trip.
      for (const n of s.match(/\d+/g) ?? []) expect(out, `${lang}: ${s}`).toContain(n);
    }
  });

  it('English stays exactly as written', () => {
    const en = translator('en');
    for (const s of sentences()) expect(localizePlanText(s, en)).toBe(s);
  });
});

describe('the editor in another language', () => {
  beforeEach(() => {
    useEditor.getState().clearAll();
    useEditor.getState().setTool('select');
    useEditor.setState({ lang: 'en', notice: null, menuOpen: false, menuPath: [0] });
  });
  afterEach(() => useEditor.setState({ lang: 'en' }));

  it('offers its menu in it', () => {
    useEditor.getState().loadText(['┌─────┐', '│     │', '└─────┘'].join('\n'), 'x.txt');
    useEditor.getState().selectAt({ x: 0, y: 0 });
    useEditor.getState().setLang('de');
    expect(menuFor(useEditor.getState()).map((i) => i.label)).toEqual([
      'Spalte hinzufügen',
      'Zeile hinzufügen',
      'Stil',
    ]);
  });

  it('says its notices in it, a planner’s refusals included', () => {
    useEditor.getState().setLang('es');
    useEditor.getState().openSave();
    expect(useEditor.getState().notice).toBe('Aún no hay nada que guardar');

    useEditor.getState().loadText('──────', 'x.txt');
    useEditor.getState().selectAt({ x: 2, y: 0 });
    useEditor.getState().addColumn();
    expect(useEditor.getState().notice).toBe('Solo un rectángulo admite una columna');
  });

  it('labels its key band in it', () => {
    const groups = groupsFor('select', {
      insertMode: false,
      brush: 1,
      objectMode: false,
      setTool: () => undefined,
      t: translator('ja'),
    });
    expect(groups.map((g) => g.name)).toEqual(['モード', '選択', '移動', '範囲選択', 'オブジェクト', '操作']);
  });
});

describe('the language is remembered (B-UI-19)', () => {
  function withSettings(initial: Partial<Record<SettingName, string>>): Map<SettingName, string> {
    const held = new Map(Object.entries(initial) as [SettingName, string][]);
    installPlatform({
      id: 'terminal',
      limitation: null,
      canSaveInPlace: () => false,
      openFile: () => Promise.resolve(null),
      saveFile: () => Promise.resolve(null),
      saveFileAs: () => Promise.resolve(null),
      readClipboard: () => Promise.resolve(''),
      writeClipboard: () => Promise.resolve(),
      recentFiles: () => Promise.resolve([]),
      onMenuCommand: () => undefined,
      keep: () => undefined,
      kept: () => null,
      keepSetting: (name, value) => {
        held.set(name, value);
      },
      keptSetting: (name) => held.get(name) ?? null,
    });
    return held;
  }

  let stop: (() => void) | null = null;
  beforeEach(() => useEditor.setState({ lang: 'en' }));
  afterEach(() => {
    stop?.();
    stop = null;
    useEditor.setState({ lang: 'en' });
  });

  it('a kept choice wins over the browser', async () => {
    withSettings({ language: 'fr' });
    const show = vi.fn();
    stop = await followLanguage(['de-DE'], show);
    expect(useEditor.getState().lang).toBe('fr');
    expect(show).toHaveBeenCalledWith('fr');
  });

  it('with nothing kept, the browser decides — and nothing is written down', async () => {
    const held = withSettings({});
    stop = await followLanguage(['de-AT', 'en'], () => undefined);
    expect(useEditor.getState().lang).toBe('de');
    expect(held.has('language')).toBe(false);
  });

  it('a browser it cannot speak gets English', async () => {
    withSettings({});
    stop = await followLanguage(['pt-BR'], () => undefined);
    expect(useEditor.getState().lang).toBe('en');
  });

  it('something kept that is not a language is ignored', async () => {
    withSettings({ language: 'klingon' });
    stop = await followLanguage(['ko'], () => undefined);
    expect(useEditor.getState().lang).toBe('ko');
  });

  it('a choice is shown and kept', async () => {
    const held = withSettings({});
    const show = vi.fn();
    stop = await followLanguage(['en'], show);
    useEditor.getState().setLang('hi');
    expect(show).toHaveBeenLastCalledWith('hi');
    expect(held.get('language')).toBe('hi');
  });
});
