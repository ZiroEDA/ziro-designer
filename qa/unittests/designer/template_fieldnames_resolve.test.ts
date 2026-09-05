// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `TEMPLATES::resolveTemplates` (`common/template_fieldnames.cpp:249-274`).
 *
 * The Preferences page edits the GLOBAL list and Schematic Setup edits the
 * PROJECT's; every consumer reads the resolved one. Ours had no resolved list
 * at all — the Symbol Properties dialog, the Symbol Fields Table and
 * `${VAR}` resolution were all handed the project's templates alone, so a
 * template added on the Preferences page was stored and never used again.
 */
import { describe, expect, it } from 'vitest';
import {
  MANDATORY_FIELD_NAMES,
  resolveTemplateFieldnames,
  templateNamesNeedingTrim,
  transferTemplateFieldnames,
  type TemplateFieldname,
} from '@ziroeda/designer/src/editors/schematic/template_fieldnames.js';
import { MANDATORY_FIELDS } from '@ziroeda/eeschema/src/tools/properties.js';

const t = (name: string, visible = false, url = false): TemplateFieldname => ({
  name,
  visible,
  url,
});

describe('the resolved list is the project’s, then the globals it did not take', () => {
  it('keeps the project’s own order and appends the rest after it', () => {
    // `m_resolved = m_project;` then a push_back per surviving global — so the
    // project's order is preserved and the globals follow, never interleaved.
    const out = resolveTemplateFieldnames([t('Zeta'), t('Alpha')], [t('Beta'), t('Omega')]);
    expect(out.map((f) => f.name)).toEqual(['Zeta', 'Alpha', 'Beta', 'Omega']);
  });

  it('drops a global the project already names, whatever the two say', () => {
    // `overriddenInProject` compares the NAME only, and the project entry is
    // the one that survives — its visible/url win outright rather than being
    // merged with the global's.
    const out = resolveTemplateFieldnames([t('MPN', true, true)], [t('MPN', false, false)]);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ name: 'MPN', visible: true, url: true });
  });

  it('treats a case variant as a different template, because wxString does', () => {
    // `global.m_Name == project.m_Name` is case SENSITIVE. Folding case here
    // would silently swallow a global the user can see on the page.
    const out = resolveTemplateFieldnames([t('mpn')], [t('MPN')]);
    expect(out.map((f) => f.name)).toEqual(['mpn', 'MPN']);
  });

  it('is the globals alone when the project has none', () => {
    expect(resolveTemplateFieldnames([], [t('MPN')]).map((f) => f.name)).toEqual(['MPN']);
  });

  it('and the project alone when there are no globals', () => {
    const project = [t('MPN')];
    // Identity, not a copy: a caller memoising on this must not see a change
    // where nothing changed.
    expect(resolveTemplateFieldnames(project, [])).toBe(project);
  });

  it('touches neither input', () => {
    const project = [t('A')];
    const globals = [t('B')];
    resolveTemplateFieldnames(project, globals);
    expect(project).toHaveLength(1);
    expect(globals).toHaveLength(1);
  });
});

describe('what the page commits is not what the grid held', () => {
  /*
   * `TransferDataFromWindow` (`panel_template_fieldnames.cpp:193-252`) plus
   * `AddTemplateFieldName` (`template_fieldnames.cpp:277-304`). The grid can
   * hold a blank row, a repeated name and "reference"; the file cannot.
   */
  it('drops a blank name', () => {
    // `if( !field.m_Name.IsEmpty() )` — an empty row is what pressing Add
    // leaves behind, so this is the common case and not an edge one.
    expect(transferTemplateFieldnames([t(''), t('MPN'), t('')])).toEqual([t('MPN')]);
  });

  it('refuses a case variant of any mandatory field name', () => {
    // `GetCanonicalFieldName( fieldId ).CmpNoCase( … ) == 0` — the s-expression
    // parser folds those onto the mandatory field, so such a template could
    // never become a distinct user field.
    const rows = ['reference', 'VALUE', 'Footprint', 'dAtAsHeEt', 'description'].map((n) => t(n));
    expect(transferTemplateFieldnames([...rows, t('MPN')])).toEqual([t('MPN')]);
  });

  it('and the list it refuses is the one the rest of the app calls mandatory', () => {
    // Two spellings of the same five names would let a template through on one
    // side and not the other.
    expect([...MANDATORY_FIELD_NAMES]).toEqual([...MANDATORY_FIELDS]);
  });

  it('lets a name that merely CONTAINS a mandatory one through', () => {
    // `CmpNoCase` is a whole-string compare, not a prefix test.
    expect(transferTemplateFieldnames([t('Reference Designator')]).map((f) => f.name)).toEqual([
      'Reference Designator',
    ]);
  });

  it('overwrites a repeat in place, so the last typed wins and keeps its slot', () => {
    // `if( temp.m_Name == aFieldName.m_Name ) { temp = aFieldName; return; }` —
    // an assignment into the existing element, not an erase and a push_back.
    const out = transferTemplateFieldnames([t('MPN', false), t('Vendor'), t('MPN', true)]);
    expect(out).toEqual([t('MPN', true), t('Vendor')]);
  });

  it('compares a repeat case-sensitively, unlike the mandatory check', () => {
    // `temp.m_Name == aFieldName.m_Name` is `operator==`; the mandatory test
    // two lines above it is `CmpNoCase`. Two different comparisons, one
    // function.
    expect(transferTemplateFieldnames([t('MPN'), t('mpn')]).map((f) => f.name)).toEqual([
      'MPN',
      'mpn',
    ]);
  });
});

describe('the whitespace warning, which is the transfer’s one modal', () => {
  /*
   *     wxString trimmedName = field.m_Name;
   *     trimmedName.Trim(); trimmedName.Trim( false );
   *     if( field.m_Name != trimmedName ) { … "Remove White Space" / "Keep White Space" … }
   *     if( dlg.ShowModal() == wxID_OK ) field.m_Name = trimmedName;
   *     (`panel_template_fieldnames.cpp:204-230`)
   */
  it('is asked for a padded name, on either side', () => {
    expect(templateNamesNeedingTrim([t(' MPN'), t('MPN '), t('MPN')])).toEqual([' MPN', 'MPN ']);
  });

  it('is not asked for a blank or an all-space name', () => {
    // `if( !field.m_Name.IsEmpty() )` guards the whole block, and an all-space
    // name is dropped by the transfer without a word either way.
    expect(templateNamesNeedingTrim([t(''), t('   ')])).toEqual(['   ']);
    expect(transferTemplateFieldnames([t('   ')], true)).toEqual([]);
  });

  it('"Remove White Space" trims the name', () => {
    expect(transferTemplateFieldnames([t(' MPN ')], true)).toEqual([t('MPN')]);
  });

  it('"Keep White Space" keeps it, and the field is added either way', () => {
    // Neither answer cancels: `AddTemplateFieldName` runs after the branch.
    expect(transferTemplateFieldnames([t(' MPN ')], false)).toEqual([t(' MPN ')]);
  });

  it('trims before the duplicate check, so a padded twin collapses onto its neighbour', () => {
    // `field.m_Name = trimmedName` is assigned BEFORE `AddTemplateFieldName`,
    // so what the duplicate test compares is the trimmed name — and the later
    // row overwrites the earlier one in place.
    expect(transferTemplateFieldnames([t('MPN', false), t(' MPN ', true)], true)).toEqual([
      t('MPN', true),
    ]);
    // …and without the trim they are two different templates.
    expect(transferTemplateFieldnames([t('MPN', false), t(' MPN ', true)], false)).toHaveLength(2);
  });

  it('trims before the mandatory check too, so " reference " is still refused', () => {
    expect(transferTemplateFieldnames([t('  reference  ')], true)).toEqual([]);
  });
});
