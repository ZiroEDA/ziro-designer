// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `include/i18n_utility.h`: `_HKI( x )` is `wxT( x )`. It marks a message
 * that is stored in English and translated only where it is shown, so with
 * a catalog loaded it still returns the English - unlike `_()`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { _HKI } from '@ziroeda/include/i18n_utility.js';
import { _, wxMsgCatalog, wxTranslations } from '@ziroeda/wx/translation.js';

afterEach(() => wxTranslations.Get().SetCatalog(null));

describe('_HKI', () => {
  it('marks a string and changes nothing, even with a catalog that translates it', () => {
    wxTranslations.Get().SetCatalog(
      new wxMsgCatalog({
        language: 'de',
        nplurals: 2,
        plural: 'n != 1',
        messages: { 'Open Project...': 'Projekt öffnen ...' },
      }),
    );
    expect(_('Open Project...')).toBe('Projekt öffnen ...');
    expect(_HKI('Open Project...')).toBe('Open Project...');
  });
});
