// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * Run only by `vitest.pseudo.config.ts`: the pseudo-language is really in place
 * while its file tests run. A guard whose catalog never loaded would pass
 * every test in English and prove nothing.
 */
import { describe, expect, it } from 'vitest';
import { _HKI } from '@ziroeda/include/i18n_utility.js';
import { _, wxTranslations } from '@ziroeda/wx/translation.js';

describe('the pseudo-language', () => {
  it('is loaded and translates every KiCad message', () => {
    expect(wxTranslations.Get().GetCatalog()?.GetLanguage()).toBe('qps');
    expect(_('Open Project...')).toBe('⟪Open Project...⟫');
    expect(_('Reference')).toBe('⟪Reference⟫');
  });

  it('leaves a message marked _HKI as stored', () => {
    expect(_HKI('Reference')).toBe('Reference');
  });
});
