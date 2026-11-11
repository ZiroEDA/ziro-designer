// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The language half of `PGM_BASE` (common/pgm_base.cpp:95-148, :578-675):
 * the `LanguagesList` table, what "Default" resolves to in a browser, and
 * `SetLanguage`.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_LANGUAGE,
  effectiveLanguage,
  languageForLocales,
  LanguagesList,
  SetLanguage,
} from '@ziroeda/common/pgm_base.js';
import { _, type wxMsgCatalogData, wxTranslations } from '@ziroeda/wx/translation.js';

const TRANSLATION = join(fileURLToPath(new URL('../../..', import.meta.url)), 'translation');
const PGM_BASE_CPP = '/home/akshay/kicad-reference/common/pgm_base.cpp';

afterEach(() => wxTranslations.Get().SetCatalog(null));

const catalogData = (language: string, messages: Record<string, string>): wxMsgCatalogData => ({
  language,
  nplurals: 2,
  plural: 'n != 1',
  messages,
});

describe('LanguagesList', () => {
  it('has a compiled catalog for every row, and no catalog without a row', () => {
    // KiCad's menu and KiCad's LINGUAS agree one for one; so must ours.
    const files = readdirSync(TRANSLATION)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -5))
      .sort();
    const rows = LanguagesList.filter((l) => l.label !== DEFAULT_LANGUAGE)
      .map((l) => l.catalog)
      .sort();
    expect(rows).toEqual(files);
    expect(LanguagesList[0]).toMatchObject({
      label: 'Default',
      catalog: '',
      doNotTranslate: false,
    });
  });

  it('pairs each label with the catalog of that language', () => {
    // Spot checks a transposed row would fail: the pairs KiCad's table and
    // its .po headers state independently.
    const catalogOf = (label: string): string =>
      LanguagesList.find((l) => l.label === label)!.catalog;
    expect(catalogOf('Deutsch')).toBe('de');
    expect(catalogOf('ภาษาไทย')).toBe('th');
    expect(catalogOf('简体中文')).toBe('zh_CN');
    expect(catalogOf('繁體中文')).toBe('zh_TW');
    expect(catalogOf('Português')).toBe('pt');
    expect(catalogOf('Português (Brasil)')).toBe('pt_BR');
    expect(catalogOf('Español (Latinoamericano)')).toBe('es_MX');
    expect(catalogOf('Norsk Bokmål')).toBe('no');
    expect(catalogOf('日本語')).toBe('ja');
    expect(catalogOf('한국어')).toBe('ko');
    // ...and what the catalog itself says it is.
    for (const [label, word] of [
      ['Deutsch', 'Datei'],
      ['ภาษาไทย', 'ไฟล์'],
      ['简体中文', '文件'],
      ['日本語', 'ファイル'],
      ['Français', 'Fichiers'],
    ] as const) {
      const data = JSON.parse(
        readFileSync(join(TRANSLATION, `${catalogOf(label)}.json`), 'utf8'),
      ) as wxMsgCatalogData;
      expect(String(data.messages['&File']), label).toContain(word);
    }
  });

  it.skipIf(!existsSync(PGM_BASE_CPP))("is KiCad's table, row for row", () => {
    const cpp = readFileSync(PGM_BASE_CPP, 'utf8');
    const table = cpp.slice(
      cpp.indexOf('LANGUAGE_DESCR LanguagesList[]'),
      cpp.indexOf('// Sentinel'),
    );
    const rows = [
      ...table.matchAll(
        /\{\s*(wxLANGUAGE_\w+),\s*(ID_LANGUAGE_\w+),\s*(?:_\(|wxT\()\s*"([^"]+)"\s*\),\s*(true|false)\s*\}/g,
      ),
    ].map((m) => ({ wxLang: m[1], kiId: m[2], label: m[3], doNotTranslate: m[4] === 'true' }));
    expect(rows).toHaveLength(45);
    expect(
      LanguagesList.map(({ wxLang, kiId, label, doNotTranslate }) => ({
        wxLang,
        kiId,
        label,
        doNotTranslate,
      })),
    ).toEqual(rows);
  });
});

describe('what "Default" follows: the browser\'s languages', () => {
  const label = (...locales: string[]): string => languageForLocales(locales).label;

  it('maps a plain language tag onto its row', () => {
    expect(label('th')).toBe('ภาษาไทย');
    expect(label('de')).toBe('Deutsch');
    expect(label('ja')).toBe('日本語');
  });

  it('ignores a region KiCad has no separate catalog for', () => {
    expect(label('de-AT')).toBe('Deutsch');
    expect(label('fr-CA')).toBe('Français');
    expect(label('th-TH')).toBe('ภาษาไทย');
    expect(label('en-GB')).toBe('English');
  });

  it('tells the two Chinese catalogs apart by script, then by region', () => {
    expect(label('zh-CN')).toBe('简体中文');
    expect(label('zh-SG')).toBe('简体中文');
    expect(label('zh')).toBe('简体中文');
    expect(label('zh-TW')).toBe('繁體中文');
    expect(label('zh-HK')).toBe('繁體中文');
    expect(label('zh-Hant')).toBe('繁體中文');
    // The script wins over the region: Traditional as written in mainland China.
    expect(label('zh-Hant-CN')).toBe('繁體中文');
    expect(label('zh-Hans-TW')).toBe('简体中文');
  });

  it('tells the two Portuguese catalogs apart', () => {
    expect(label('pt-BR')).toBe('Português (Brasil)');
    expect(label('pt-PT')).toBe('Português');
    expect(label('pt')).toBe('Português');
  });

  it('gives Latin America the Latin American Spanish, and Spain its own', () => {
    expect(label('es-MX')).toBe('Español (Latinoamericano)');
    expect(label('es-419')).toBe('Español (Latinoamericano)');
    expect(label('es-AR')).toBe('Español (Latinoamericano)');
    expect(label('es-ES')).toBe('Español');
    expect(label('es')).toBe('Español');
  });

  it('knows Norwegian by both its codes and the two retired ISO codes', () => {
    expect(label('nb-NO')).toBe('Norsk Bokmål');
    expect(label('no')).toBe('Norsk Bokmål');
    expect(label('iw')).toBe('עברית');
    expect(label('in')).toBe('Bahasa Indonesia');
  });

  it("takes the first preference KiCad can serve, in the user's order", () => {
    // Welsh has no catalog; German is the next choice.
    expect(label('cy', 'de', 'fr')).toBe('Deutsch');
    // English is a served preference like any other: it is not skipped for a later one.
    expect(label('en-US', 'th')).toBe('English');
  });

  it('falls back to English when nothing matches, and for odd input', () => {
    expect(label('cy')).toBe('English');
    expect(label()).toBe('English');
    expect(label('')).toBe('English');
    expect(label('x-klingon')).toBe('English');
    // Case and the underscore form are not the browser's, but cost nothing to accept.
    expect(label('ZH_tw')).toBe('繁體中文');
  });
});

describe('effectiveLanguage', () => {
  it('is the stored row when one is chosen, whatever the browser says', () => {
    expect(effectiveLanguage('Deutsch', ['th']).catalog).toBe('de');
    expect(effectiveLanguage('English', ['th']).catalog).toBe('en');
  });

  it('is the browser\'s for "Default" and for a value that names no row', () => {
    expect(effectiveLanguage('Default', ['th']).catalog).toBe('th');
    // pgm_base.cpp:588-600: no match leaves wxLANGUAGE_DEFAULT.
    expect(effectiveLanguage('Klingon', ['zh-TW']).catalog).toBe('zh_TW');
  });
});

describe('SetLanguage', () => {
  it("loads the row's catalog and the interface follows", async () => {
    const load = vi.fn(async (name: string) =>
      catalogData('whatever-the-header-says', { Close: `[${name}] Schließen` }),
    );
    const descr = await SetLanguage('Deutsch', ['th'], load);

    expect(load).toHaveBeenCalledExactlyOnceWith('de');
    expect(descr.label).toBe('Deutsch');
    expect(_('Close')).toBe('[de] Schließen');
    expect(wxTranslations.Get().GetCatalog()?.GetLanguage()).toBe('de');
  });

  it('does not fetch a catalog that is already in use', async () => {
    const load = vi.fn(async () => catalogData('de', { Close: 'Schließen' }));
    await SetLanguage('Deutsch', [], load);
    await SetLanguage('Deutsch', [], load);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('resolves "Default" through the browser\'s languages', async () => {
    const load = vi.fn(async () => catalogData('th', { Close: 'ปิด' }));
    const descr = await SetLanguage(DEFAULT_LANGUAGE, ['th-TH', 'en'], load);
    expect(load).toHaveBeenCalledExactlyOnceWith('th');
    expect(descr.label).toBe('ภาษาไทย');
    expect(_('Close')).toBe('ปิด');
  });

  it('loads nothing for English and drops the catalog that was in use', async () => {
    await SetLanguage('Deutsch', [], async () => catalogData('de', { Close: 'Schließen' }));
    const load = vi.fn();
    await SetLanguage('English', ['de'], load);
    expect(load).not.toHaveBeenCalled();
    expect(_('Close')).toBe('Close');
  });

  it('falls back to English and says so when the catalog cannot be loaded', async () => {
    await SetLanguage('Deutsch', [], async () => catalogData('de', { Close: 'Schließen' }));
    // pgm_base.cpp:666.
    await expect(
      SetLanguage('ภาษาไทย', [], async () => {
        throw new Error('HTTP 404');
      }),
    ).rejects.toThrow('The KiCad language file for this language is not installed.');
    expect(_('Close')).toBe('Close');
  });

  it('lets the last request win when an earlier catalog arrives late', async () => {
    let releaseGerman!: (d: wxMsgCatalogData) => void;
    const german = SetLanguage(
      'Deutsch',
      [],
      () => new Promise((resolve) => (releaseGerman = resolve)),
    );
    const thai = SetLanguage('ภาษาไทย', [], async () => catalogData('th', { Close: 'ปิด' }));
    await thai;
    releaseGerman(catalogData('de', { Close: 'Schließen' }));
    await german;
    expect(_('Close')).toBe('ปิด');
  });

  it('does not let a late failure of an abandoned request clear the current one', async () => {
    let failGerman!: (e: Error) => void;
    const german = SetLanguage(
      'Deutsch',
      [],
      () => new Promise((_resolve, reject) => (failGerman = reject)),
    );
    await SetLanguage('ภาษาไทย', [], async () => catalogData('th', { Close: 'ปิด' }));
    failGerman(new Error('HTTP 500'));
    await expect(german).rejects.toThrow();
    expect(_('Close')).toBe('ปิด');
  });
});
