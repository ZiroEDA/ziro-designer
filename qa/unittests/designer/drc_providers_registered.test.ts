// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `DRC_TEST_PROVIDER_REGISTRY` is filled by file-scope
 * `DRC_REGISTER_TEST_PROVIDER<...>` objects - in C++ by linking pcbnew, here by
 * importing the module. The `qa` suites imported `drc_test_providers.js`
 * themselves, so every provider test passed while the *app* built its engine
 * over an empty registry and `Run DRC` reported 0 violations on a board KiCad
 * finds 176 in.
 *
 * This file imports ONLY the frame the PCB editor creates, exactly as the app
 * does, and looks at the registry the way `DRC_ENGINE::RunTests` does. Nothing
 * here may import `drc_test_providers.js`, directly or through a helper - that
 * is the bug it is here to catch.
 */
import { describe, expect, it } from 'vitest';
import { DRC_TEST_PROVIDER_REGISTRY } from '@ziroeda/pcbnew/src/drc/drc_test_provider.js';
import '@ziroeda/designer/src/editors/pcb/pcb_edit_frame.js';

/** `pcbnew/CMakeLists.txt`'s object order, which is the registration order. */
const KICAD_LINK_ORDER = [
  'annular_width',
  'disallow',
  'creepage',
  'connectivity',
  'copper width', // connection_width
  'clearance', // copper_clearance
  'physical_clearance',
  'courtyard_clearance',
  'edge_clearance',
  'footprint checks',
  'hole_to_hole_clearance',
  'hole_size',
  'library_parity',
  'schematic_parity',
  'miscellaneous',
  'text_dimensions',
  'angle', // track_angle
  'width', // track_width
  'segment_length',
  'zone connections',
  'diameter', // via_diameter
  'solder_mask_issues',
  'silk_clearance',
  'length', // matched_length
  'diff_pair_coupling',
  'sliver checker',
  'text_mirroring',
];

describe('the PCB editor frame registers the DRC test providers', () => {
  it('has every provider, in KiCad link order', () => {
    const names = DRC_TEST_PROVIDER_REGISTRY.Instance()
      .GetTestProviders()
      .map((p) => p.GetName());

    expect(names).toEqual(KICAD_LINK_ORDER);
  });
});
