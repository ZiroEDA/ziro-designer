// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * FOOTPRINT::FootprintNeedsUpdate lives in the library-parity provider's file,
 * as upstream, so the frame and the Exchange Footprints dialog import that
 * provider for a function - and importing a provider registers it. Its place
 * in the list must still be the installed build's, because that order is the
 * order DIALOG_DRC lists violations in (see drc_providers_registered.test.ts).
 *
 * This file imports the provider FIRST, before the module that registers the
 * rest.
 */
import '@ziroeda/pcbnew/drc/drc_test_provider_library_parity.js';
import '@ziroeda/pcbnew/browser/drc_test_providers.js';
import { describe, expect, it } from 'vitest';
import { DRC_TEST_PROVIDER_REGISTRY } from '@ziroeda/pcbnew/drc/drc_test_provider.js';

describe('a provider imported early keeps its initialisation-order place', () => {
  it('lists library_parity after schematic_parity and before hole_size', () => {
    const names = DRC_TEST_PROVIDER_REGISTRY.Instance()
      .GetTestProviders()
      .map((p) => p.GetName());
    expect(names[0]).toBe('text_mirroring');
    expect(names.slice(names.indexOf('schematic_parity'), names.indexOf('hole_size') + 1)).toEqual([
      'schematic_parity',
      'library_parity',
      'hole_size',
    ]);
  });
});
