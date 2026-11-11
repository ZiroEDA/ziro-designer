// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `external/wx/translation.ts`: `wxGetTranslation` / `_()`, contexts, plural
 * forms, `wxStripMenuCodes` and the catalog swap - against hand-built
 * catalogs for the rules, and against the committed KiCad catalogs for the
 * things only real data shows (every language's plural rule parses; the
 * mnemonic forms East Asian translators use).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  _,
  _HKI,
  wxGetTranslation,
  wxMsgCatalog,
  type wxMsgCatalogData,
  wxPLURAL,
  wxPluralFormsCalculator,
  wxStripMenuCodes,
  wxTranslations,
} from '@ziroeda/wx/translation.js';

const TRANSLATION = join(fileURLToPath(new URL('../../../..', import.meta.url)), 'translation');
const committed = (lang: string): wxMsgCatalogData =>
  JSON.parse(readFileSync(join(TRANSLATION, `${lang}.json`), 'utf8')) as wxMsgCatalogData;

const GERMAN: wxMsgCatalogData = {
  language: 'de',
  nplurals: 2,
  plural: 'n != 1',
  messages: {
    'Open Project...': 'Projekt öffnen...',
    '&File': '&Datei',
    '&Edit': '&Bearbeiten',
    Edit: 'Ändern',
    'verb\u0004Open': 'Öffnen',
    Open: 'Offen',
    '%d file': ['%d Datei', '%d Dateien'],
    '%d half': ['%d halb', ''],
  },
};

const use = (data: wxMsgCatalogData | null): void =>
  wxTranslations.Get().SetCatalog(data ? new wxMsgCatalog(data) : null);

afterEach(() => use(null));

describe('_() / wxGetTranslation', () => {
  it('returns the English text itself when no catalog is loaded', () => {
    expect(_('Open Project...')).toBe('Open Project...');
    expect(wxPLURAL('%d file', '%d files', 1)).toBe('%d file');
    expect(wxPLURAL('%d file', '%d files', 0)).toBe('%d files');
    expect(wxPLURAL('%d file', '%d files', 2)).toBe('%d files');
  });

  it('returns the translation when the catalog has one', () => {
    use(GERMAN);
    expect(_('Open Project...')).toBe('Projekt öffnen...');
    expect(wxGetTranslation('Open Project...')).toBe('Projekt öffnen...');
  });

  it('returns the English text for a message the catalog lacks', () => {
    use(GERMAN);
    expect(_('Close Project')).toBe('Close Project');
    // Never a prototype member: the lookup is not a property access.
    expect(_('constructor')).toBe('constructor');
    expect(_('toString')).toBe('toString');
  });

  it('keeps a context apart from the bare message', () => {
    use(GERMAN);
    expect(wxGetTranslation('Open', 'verb')).toBe('Öffnen');
    expect(wxGetTranslation('Open')).toBe('Offen');
    // A context the catalog has no entry under is a miss, not the bare entry.
    expect(wxGetTranslation('Open', 'adjective')).toBe('Open');
  });

  it('picks the plural form the language uses for the count', () => {
    use(GERMAN);
    expect(wxPLURAL('%d file', '%d files', 1)).toBe('%d Datei');
    expect(wxPLURAL('%d file', '%d files', 0)).toBe('%d Dateien');
    expect(wxPLURAL('%d file', '%d files', 5)).toBe('%d Dateien');
    // gettext(): the singular lookup of a plural entry is its form 0.
    expect(_('%d file')).toBe('%d Datei');
  });

  it('falls back to English for a plural form the translator left empty', () => {
    use(GERMAN);
    expect(wxPLURAL('%d half', '%d halves', 1)).toBe('%d halb');
    expect(wxPLURAL('%d half', '%d halves', 3)).toBe('%d halves');
  });

  it('_HKI marks a string and changes nothing', () => {
    use(GERMAN);
    expect(_HKI('Open Project...')).toBe('Open Project...');
  });
});

describe('the mnemonic-free spelling of a menu message', () => {
  it('finds "&File" when asked for "File", without the translation\'s own marker', () => {
    use(GERMAN);
    expect(_('File')).toBe('Datei');
    expect(_('&File')).toBe('&Datei');
  });

  it('never overrides a message that exists in its own right', () => {
    // "Edit" and "&Edit" are both KiCad messages and need not agree.
    use(GERMAN);
    expect(_('Edit')).toBe('Ändern');
    expect(_('&Edit')).toBe('&Bearbeiten');
  });

  it('holds for the real catalogs: File, in the three shapes translators use', () => {
    // Latin scripts mark a letter of the word; East Asian ones append the
    // English mnemonic in brackets, after the word or (Thai) before it.
    use(committed('de'));
    expect(_('File')).toBe('Datei');
    use(committed('zh_CN'));
    expect(_('File')).toBe('文件');
    use(committed('th'));
    expect(_('File')).toBe('ไฟล์');
    expect(_('Apply')).not.toContain('&');
  });
});

describe('wxStripMenuCodes', () => {
  it('drops the marker and keeps the letter', () => {
    expect(wxStripMenuCodes('&File')).toBe('File');
    expect(wxStripMenuCodes('Ab&brechen')).toBe('Abbrechen');
  });

  it('drops an appended East Asian mnemonic group, with the space before it', () => {
    expect(wxStripMenuCodes('文件 (&F)')).toBe('文件');
    expect(wxStripMenuCodes('ไฟล์(&F)')).toBe('ไฟล์');
    expect(wxStripMenuCodes('(&A)นำไปใช้')).toBe('นำไปใช้');
    expect(wxStripMenuCodes('导出 (&E)...')).toBe('导出...');
  });

  it('reads && as a literal ampersand', () => {
    expect(wxStripMenuCodes('Drag && Drop')).toBe('Drag & Drop');
  });

  it('leaves a label with no mnemonic alone', () => {
    expect(wxStripMenuCodes('Schematic Editor')).toBe('Schematic Editor');
    expect(wxStripMenuCodes('f(x)')).toBe('f(x)');
  });
});

describe('plural rules', () => {
  /** [rule, [count, form]…], the forms from the Unicode CLDR tables, not from the rule. */
  const CASES: readonly (readonly [string, string, readonly (readonly [number, number])[]])[] = [
    ['de', 'n != 1', [[0, 1], [1, 0], [2, 1], [101, 1]]],
    ['fr', 'n > 1', [[0, 0], [1, 0], [2, 1]]],
    ['ja', '0', [[0, 0], [1, 0], [7, 0]]],
    [
      'ru',
      '(n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2)',
      [[1, 0], [21, 0], [101, 0], [2, 1], [4, 1], [22, 1], [0, 2], [5, 2], [11, 2], [12, 2], [14, 2], [111, 2]],
    ],
    ['cs', '((n==1) ? 0 : (n>=2 && n<=4) ? 1 : 2)', [[1, 0], [2, 1], [4, 1], [0, 2], [5, 2], [22, 2]]],
    [
      'ar',
      'n==0 ? 0 : n==1 ? 1 : n==2 ? 2 : n%100>=3 && n%100<=10 ? 3 : n%100>=11 ? 4 : 5',
      [[0, 0], [1, 1], [2, 2], [3, 3], [10, 3], [103, 3], [11, 4], [99, 4], [100, 5], [102, 5]],
    ],
    ['lv', 'n%10==1 && n%100!=11 ? 0 : n != 0 ? 1 : 2', [[1, 0], [21, 0], [11, 1], [2, 1], [0, 2]]],
  ]; // biome-ignore format: one language per row

  it.each(CASES)('%s: %s', (_lang, rule, pairs) => {
    const index = wxPluralFormsCalculator(rule);
    for (const [n, form] of pairs) expect([n, index(n)]).toEqual([n, form]);
  });

  it('follows C precedence and associativity', () => {
    // * / % bind tighter than + -, which bind tighter than comparisons.
    expect(wxPluralFormsCalculator('n + 2 * 3')(1)).toBe(7);
    expect(wxPluralFormsCalculator('n - 1 - 1')(5)).toBe(3);
    expect(wxPluralFormsCalculator('n / 2')(7)).toBe(3);
    expect(wxPluralFormsCalculator('!n')(0)).toBe(1);
    expect(wxPluralFormsCalculator('!n')(3)).toBe(0);
    // && binds tighter than ||.
    expect(wxPluralFormsCalculator('n == 1 || n == 2 && n == 3')(1)).toBe(1);
    // ?: is right-associative.
    expect(wxPluralFormsCalculator('n == 1 ? 10 : n == 2 ? 20 : 30')(2)).toBe(20);
    expect(wxPluralFormsCalculator('n <= 2')(2)).toBe(1);
    expect(wxPluralFormsCalculator('n >= 2')(1)).toBe(0);
  });

  it('refuses what is not a plural expression - it is parsed, never evaluated as code', () => {
    expect(() => wxPluralFormsCalculator('alert(1)')).toThrow();
    expect(() => wxPluralFormsCalculator('n ==')).toThrow();
    expect(() => wxPluralFormsCalculator('(n')).toThrow();
    expect(() => wxPluralFormsCalculator('n n')).toThrow();
  });

  it('every committed catalog has a rule that parses and stays inside its forms', () => {
    const files = readdirSync(TRANSLATION).filter((f) => f.endsWith('.json'));
    expect(files.length).toBe(44);
    for (const f of files) {
      const data = committed(f.slice(0, -5));
      const index = wxPluralFormsCalculator(data.plural);
      for (let n = 0; n <= 200; n++) {
        const form = index(n);
        expect(form, `${f} n=${n}`).toBeGreaterThanOrEqual(0);
        expect(form, `${f} n=${n}`).toBeLessThan(data.nplurals);
      }
      for (const value of Object.values(data.messages)) {
        if (Array.isArray(value)) expect(value.length, f).toBe(data.nplurals);
      }
    }
  });
});

describe('wxTranslations', () => {
  it('tells its subscribers when the catalog changes, and only then', () => {
    const t = wxTranslations.Get();
    const heard = vi.fn();
    const stop = t.Subscribe(heard);
    const before = t.GetVersion();

    use(GERMAN);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(t.GetVersion()).toBe(before + 1);

    // The same catalog object again is not a change.
    t.SetCatalog(t.GetCatalog());
    expect(heard).toHaveBeenCalledTimes(1);

    use(null);
    expect(heard).toHaveBeenCalledTimes(2);

    stop();
    use(GERMAN);
    expect(heard).toHaveBeenCalledTimes(2);
  });
});
