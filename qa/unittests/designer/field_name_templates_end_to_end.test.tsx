// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Schematic Editor > Field Name Templates, from the page to the
 * places a template is supposed to show up.
 *
 * There are two lists and one resolved list. The Preferences page edits the
 * GLOBAL one — `PANEL_TEMPLATE_FIELDNAMES` built with `m_global = true` over
 * `cfg->m_Drawing.field_names` (`panel_template_fieldnames.cpp:50-60`) — and
 * Schematic Setup edits the PROJECT's. Every CONSUMER asks
 * `m_TemplateFieldNames.GetTemplateFieldNames()`, the resolved list:
 *
 *     DIALOG_SYMBOL_PROPERTIES::UpdateFieldsFromLibrary  dialog_symbol_properties.cpp:473-483
 *     DIALOG_SYMBOL_FIELDS_TABLE::LoadFieldNames         dialog_symbol_fields_table.cpp:777-780
 *
 * Ours handed both of them `setup.fieldTemplates`, the project's list alone, so
 * a template typed on the Preferences page was stored, listed back on that same
 * page, and used by nothing else in the app. The page looked finished.
 *
 * The first two describes below are the round trip through the page. The rest
 * are the consumers, because those are what "end to end" means here — a test
 * that only proved the page writes `drawing.field_names` would have passed
 * throughout the whole time this was broken.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PanelTemplateFieldnames } from '@ziroeda/designer/src/editors/schematic/prefs/PanelTemplateFieldnames.js';
import { EESCHEMA_DEFAULTS } from '@ziroeda/designer/src/prefs/settings.js';
import type { EeschemaSettings } from '@ziroeda/designer/src/prefs/settings.js';
import type { PrefsContext } from '@ziroeda/designer/src/dialogs/prefs/types.js';
import { transferTemplateFieldnamesPage } from '@ziroeda/designer/src/editors/schematic/prefs/resets.js';
import { resolveTemplateFieldnames } from '@ziroeda/designer/src/editors/schematic/template_fieldnames.js';
import { rowsFromSymbol } from '@ziroeda/designer/src/editors/schematic/symbol_props_rows.js';
import {
  FieldsDataModel,
  loadFieldNames,
  symbolTextVarResolver,
} from '@ziroeda/eeschema/src/tools/fields_data_model.js';
import { readSchematic } from '@ziroeda/eeschema';
import { parse } from '@ziroeda/sexpr';

afterEach(cleanup);

const settingsWith = (names: EeschemaSettings['drawing']['field_names']): EeschemaSettings => {
  const s = structuredClone(EESCHEMA_DEFAULTS);
  s.drawing.field_names = names;
  return s;
};

function ctxFor(eeschema: EeschemaSettings): PrefsContext {
  return {
    eeschema,
    upE: (fn: (s: EeschemaSettings) => void) => fn(eeschema),
  } as unknown as PrefsContext;
}

describe('the page edits the GLOBAL list, which is eeschema.json’s', () => {
  it('shows what drawing.field_names holds', () => {
    render(
      <PanelTemplateFieldnames
        ctx={ctxFor(settingsWith([{ name: 'MPN', visible: true, url: false }]))}
      />,
    );
    expect(screen.getByDisplayValue('MPN')).toBeTruthy();
  });

  /** `m_title->SetLabel( _( "Global Field Name Templates" ) )` (`:50`). */
  it('says so, because the same panel serves the project’s list too', () => {
    render(<PanelTemplateFieldnames ctx={ctxFor(settingsWith([]))} />);
    expect(screen.getByText('Global Field Name Templates')).toBeTruthy();
  });

  it('writes an edit back into drawing.field_names and nowhere else', () => {
    const s = settingsWith([{ name: 'MPN', visible: false, url: false }]);
    render(<PanelTemplateFieldnames ctx={ctxFor(s)} />);
    fireEvent.change(screen.getByDisplayValue('MPN'), { target: { value: 'Manufacturer' } });
    expect(s.drawing.field_names).toEqual([{ name: 'Manufacturer', visible: false, url: false }]);
  });
});

/* ------------------------------------------------------- and out again -- */

const GLOBAL = [{ name: 'MPN', visible: true, url: false }];
const PROJECT = [{ name: 'Vendor', visible: false, url: false }];

const DOC = readSchematic(
  parse(`(kicad_sch (version 20250114) (generator "eeschema")
  (lib_symbols
    (symbol "Device:R" (pin_numbers hide)
      (property "Reference" "R" (at 0 0 0) (effects (font (size 1.27 1.27))))
      (property "Value" "R" (at 0 0 0) (effects (font (size 1.27 1.27))))))
  (symbol (lib_id "Device:R") (at 40 60 0) (unit 1) (uuid "s1")
    (property "Reference" "R1" (at 40 57 0) (effects (font (size 1.27 1.27))))
    (property "Value" "10k" (at 40 63 0) (effects (font (size 1.27 1.27))))))`),
);
const SYMBOL = DOC.symbols[0]!;
const LIB = DOC.libSymbols[0];

describe('Symbol Properties offers every resolved template as a row', () => {
  /*
   * `for( const TEMPLATE_FIELDNAME& templateFieldname : …GetTemplateFieldNames() )
   *      if( defined.count( … ) <= 0 ) m_fields->push_back( … );`
   * (`dialog_symbol_properties.cpp:473-483`) — the RESOLVED list, so a global
   * template is a row on a symbol that has never carried that field.
   */
  it('includes a global one the project does not name', () => {
    const rows = rowsFromSymbol(SYMBOL, resolveTemplateFieldnames(PROJECT, GLOBAL), LIB);
    const names = rows.map((r) => r.key);
    expect(names).toContain('MPN');
    expect(names).toContain('Vendor');
  });

  it('and carries that template’s own visibility onto the new row', () => {
    // `field.SetVisible( templateFieldname.m_Visible )`.
    // `effects.hidden` is the negation: a template marked visible makes a row
    // that is not hidden.
    const rows = rowsFromSymbol(SYMBOL, resolveTemplateFieldnames(PROJECT, GLOBAL), LIB);
    expect(rows.find((r) => r.key === 'MPN')?.effects.hidden).toBe(false);
    expect(rows.find((r) => r.key === 'Vendor')?.effects.hidden).toBe(true);
  });

  it('does not offer it twice when the project names it too', () => {
    const both = resolveTemplateFieldnames([{ name: 'MPN', visible: false, url: false }], GLOBAL);
    const rows = rowsFromSymbol(SYMBOL, both, LIB);
    expect(rows.filter((r) => r.key === 'MPN')).toHaveLength(1);
    // The PROJECT's entry is the one that survives `resolveTemplates`, so the
    // row is hidden — the global says visible and does not get a say.
    expect(rows.find((r) => r.key === 'MPN')?.effects.hidden).toBe(true);
  });
});

describe('the Symbol Fields Table gives every resolved template a column', () => {
  /*
   * `for( const TEMPLATE_FIELDNAME& tfn : …GetTemplateFieldNames() )
   *      if( userFieldNames.count( tfn.m_Name ) == 0 ) AddField( … );`
   * (`dialog_symbol_fields_table.cpp:777-780`).
   */
  const REFS = [{ symbol: SYMBOL, ref: 'R', refNumber: '1', unit: 1, path: '/' }];
  const columns = (templates: readonly { name: string }[]): string[] =>
    loadFieldNames(new FieldsDataModel(REFS), REFS, templates);

  it('adds a column for a global template', () => {
    expect(columns(resolveTemplateFieldnames(PROJECT, GLOBAL))).toContain('MPN');
  });

  it('and none at all when the page is empty', () => {
    expect(columns(resolveTemplateFieldnames([], []))).not.toContain('MPN');
  });
});

describe('a ${TEMPLATE} token on a symbol that has no such field is empty', () => {
  /*
   * `SCH_SYMBOL::ResolveTextVar` (`eeschema/sch_symbol.cpp:1967-1978`). Without
   * this the token falls through to the document resolver and a field reading
   * `${MPN}` prints `${MPN}` — the token itself — on a symbol that simply has
   * not been given that field yet, which is every symbol the moment a template
   * is added.
   */
  const resolve = (token: string, templates: readonly { name: string }[]): string | undefined =>
    symbolTextVarResolver(
      { symbol: SYMBOL, ref: 'R', refNumber: '1', unit: 1, path: '/' },
      undefined,
      templates,
    )(token);

  it('answers empty for a template name', () => {
    expect(resolve('MPN', resolveTemplateFieldnames(PROJECT, GLOBAL))).toBe('');
  });

  it('and for its fully upper-cased spelling, which is the only other form', () => {
    // `token->IsSameAs( … ) || token->IsSameAs( …Upper() )` — as written or
    // ALL CAPS, and nothing in between, so a mixed-case guess still misses.
    expect(resolve('VENDOR', PROJECT)).toBe('');
    expect(resolve('vendor', PROJECT)).toBeUndefined();
  });

  it('leaves an unrelated token to the document resolver', () => {
    expect(resolve('NOT_A_TEMPLATE', resolveTemplateFieldnames(PROJECT, GLOBAL))).toBeUndefined();
  });

  it('and a field the symbol DOES carry still answers with its value', () => {
    // The loop over `sym.fields` runs first, so a template that is also a real
    // field is not blanked.
    expect(resolve('Value', [{ name: 'Value' }])).toBe('10k');
  });
});

describe('the editor hands the dialogs the resolved list, not the project’s', () => {
  /*
   * Read as SOURCE: both dialogs take a `fieldTemplates` prop, and a frame that
   * passed `setup.fieldTemplates` would look identical to one passing the
   * resolved list on any project whose global list happens to be empty — which
   * is every project, until someone opens the Preferences page.
   */
  it('SchematicEditor passes resolvedFieldTemplates to both', () => {
    const src = readFileSync(
      resolve(process.cwd(), '../designer/src/editors/schematic/SchematicEditor.tsx'),
      'utf8',
    );
    expect(src).not.toContain('fieldTemplates={setup.fieldTemplates}');
    expect([...src.matchAll(/fieldTemplates=\{resolvedFieldTemplates\}/g)]).toHaveLength(2);
    expect(src).toContain(
      'resolveTemplateFieldnames(setup.fieldTemplates, es.drawing.field_names)',
    );
  });
});

describe('the page’s TransferDataFromWindow, which is what OK runs', () => {
  /*
   * `PANEL_TEMPLATE_FIELDNAMES::TransferDataFromWindow` (`:193-252`). It filters
   * once, on OK — filtering per keystroke would delete the row a user is
   * halfway through clearing.
   */
  const withNames = (names: string[]): EeschemaSettings =>
    settingsWith(names.map((n) => ({ name: n, visible: false, url: false })));

  it('filters the list in place when nothing needs asking', () => {
    const s = withNames(['', 'MPN', 'reference', 'MPN']);
    expect(transferTemplateFieldnamesPage(ctxFor(s))).toBeUndefined();
    expect(s.drawing.field_names.map((f) => f.name)).toEqual(['MPN']);
  });

  it('asks before it filters when a name is padded, and changes nothing yet', () => {
    const s = withNames([' MPN ']);
    const asked = transferTemplateFieldnamesPage(ctxFor(s));
    expect(asked?.caption).toBe('Warning');
    expect(asked?.message).toContain("The field name ' MPN ' contains trailing");
    expect(asked?.labels).toEqual({ ok: 'Remove White Space', cancel: 'Keep White Space' });
    // Nothing written: the answer decides the name, so the transfer waits.
    expect(s.drawing.field_names.map((f) => f.name)).toEqual([' MPN ']);
  });

  it('trims on the affirmative answer', () => {
    const s = withNames([' MPN ']);
    expect(transferTemplateFieldnamesPage(ctxFor(s), true)).toBeUndefined();
    expect(s.drawing.field_names.map((f) => f.name)).toEqual(['MPN']);
  });

  it('and keeps the padding on the other, because neither answer cancels', () => {
    const s = withNames([' MPN ']);
    expect(transferTemplateFieldnamesPage(ctxFor(s), false)).toBeUndefined();
    expect(s.drawing.field_names.map((f) => f.name)).toEqual([' MPN ']);
  });

  it('names the count rather than one field when several are padded', () => {
    const asked = transferTemplateFieldnamesPage(ctxFor(withNames([' A', 'B ', 'C'])));
    expect(asked?.message).toBe('2 field names contain trailing and/or leading white space.');
  });

  /** The page is `sch-fields`, and its factory is what hands the shell the hook. */
  it('is the function the schematic factory registers for that page', async () => {
    const { createPrefsPanel } = await import(
      '@ziroeda/designer/src/editors/schematic/prefs/index.js'
    );
    expect(createPrefsPanel('sch-fields')?.transfer).toBe(transferTemplateFieldnamesPage);
    // …and the page still has no reset, which is a different virtual.
    expect(createPrefsPanel('sch-fields')?.reset).toBeUndefined();
  });
});
