// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_TEMPLATE_SELECTOR's pure logic: ApplyFilter, BuildTemplateList's sort,
 * and TEMPLATE_WIDGET::SetDescription's truncation.
 */
import { describe, expect, it } from 'vitest';
import {
  applyFilter,
  projectNameFrom,
  sortTemplates,
  truncateDescription,
} from '@ziroeda/designer/src/home/dialogs/template_selector.js';

interface Tpl {
  title: string;
  description: string;
  category?: 'user' | 'system';
}

const t = (title: string, description = '', category: 'user' | 'system' = 'system'): Tpl => ({
  title,
  description,
  category,
});

describe('applyFilter (DIALOG_TEMPLATE_SELECTOR::ApplyFilter)', () => {
  const all = [
    t('Arduino Micro', 'An expansion board', 'system'),
    t('My Board', 'personal template', 'user'),
  ];

  it('0 = All Templates shows both kinds', () => {
    expect(applyFilter(all, 0, '')).toHaveLength(2);
  });

  it('1 selects the user templates and 2 the system ones', () => {
    // 10.0.5 filters on one boolean, m_isUserTemplate - there is no third
    // category, and no fourth choice in the dropdown.
    expect(applyFilter(all, 1, '').map((x) => x.title)).toEqual(['My Board']);
    expect(applyFilter(all, 2, '').map((x) => x.title)).toEqual(['Arduino Micro']);
  });

  it('searches the title and the description, case-insensitively', () => {
    expect(applyFilter(all, 0, 'ARDUINO').map((x) => x.title)).toEqual(['Arduino Micro']);
    // Matched on description alone, which upstream tests too.
    expect(applyFilter(all, 0, 'expansion').map((x) => x.title)).toEqual(['Arduino Micro']);
    expect(applyFilter(all, 0, 'nothing here')).toHaveLength(0);
  });

  it('combines the two: a search inside a category cannot escape it', () => {
    expect(applyFilter(all, 1, 'expansion')).toHaveLength(0);
    expect(applyFilter(all, 2, 'expansion')).toHaveLength(1);
  });

  it('an empty search is not a filter', () => {
    expect(applyFilter(all, 0, '')).toHaveLength(2);
  });

  it('treats a template with no category as a system one', () => {
    const bare = [{ title: 'Bundled', description: '' }];
    expect(applyFilter(bare, 2, '')).toHaveLength(1);
    expect(applyFilter(bare, 1, '')).toHaveLength(0);
  });
});

describe('sortTemplates (BuildTemplateList)', () => {
  it('sorts case-insensitively by title', () => {
    expect(sortTemplates([t('zeta'), t('Alpha'), t('beta')]).map((x) => x.title)).toEqual([
      'Alpha',
      'beta',
      'zeta',
    ]);
  });

  it('puts "default" first however it is cased and wherever it starts', () => {
    expect(sortTemplates([t('Alpha'), t('Default'), t('beta')]).map((x) => x.title)).toEqual([
      'Default',
      'Alpha',
      'beta',
    ]);
    // Upstream checks both sides of the comparison, so a "default" that starts
    // last has to win too.
    expect(sortTemplates([t('Alpha'), t('beta'), t('default')]).map((x) => x.title)).toEqual([
      'default',
      'Alpha',
      'beta',
    ]);
  });

  it('does not mutate its input', () => {
    const input = [t('zeta'), t('Alpha')];
    sortTemplates(input);
    expect(input.map((x) => x.title)).toEqual(['zeta', 'Alpha']);
  });
});

describe("projectNameFrom (NewProject's extension handling)", () => {
  it('leaves a plain name alone', () => {
    expect(projectNameFrom('Arduino_Mega')).toBe('Arduino_Mega');
    expect(projectNameFrom('')).toBe('');
  });

  it('drops a .kicad_pro the user typed, whatever its case', () => {
    // fn.SetExt( FILEEXT::ProjectFileExtension ) replaces it, so it never
    // survives into the name and must not be doubled by the fixed suffix.
    expect(projectNameFrom('board.kicad_pro')).toBe('board');
    expect(projectNameFrom('board.KiCad_Pro')).toBe('board');
  });

  it('keeps any other extension as part of the name', () => {
    // The line above SetExt folds a non-project extension back in:
    //   fn.SetName( fn.GetName() + wxT( "." ) + fn.GetExt() );
    // so "rev.2" is a project called "rev.2", not one called "rev".
    expect(projectNameFrom('rev.2')).toBe('rev.2');
    expect(projectNameFrom('board.kicad_sch')).toBe('board.kicad_sch');
    expect(projectNameFrom('my.board.v3')).toBe('my.board.v3');
  });

  it('only strips the extension at the end', () => {
    expect(projectNameFrom('kicad_pro')).toBe('kicad_pro');
    expect(projectNameFrom('a.kicad_pro.b')).toBe('a.kicad_pro.b');
  });
});

describe('truncateDescription (TEMPLATE_WIDGET::SetDescription)', () => {
  it('leaves anything up to 120 characters alone', () => {
    const exactly120 = 'x'.repeat(120);
    expect(truncateDescription(exactly120)).toBe(exactly120);
    expect(truncateDescription('short')).toBe('short');
  });

  it('cuts at 120 and appends an ellipsis past that', () => {
    const long = 'y'.repeat(200);
    const out = truncateDescription(long);
    expect(out).toBe(`${'y'.repeat(120)}...`);
    // 120 characters plus the three dots, exactly as upstream builds it.
    expect(out).toHaveLength(123);
  });

  it('handles an empty description', () => {
    expect(truncateDescription('')).toBe('');
  });
});
