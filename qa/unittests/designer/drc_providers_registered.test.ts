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

/**
 * The order the installed build's static initialisers run in, which is
 * `pcbnew/CMakeLists.txt` read BOTTOM TO TOP - see `drc_test_providers.ts` for
 * how that was measured off `kicad-cli`. It is the order the markers land in
 * the board and so the order DIALOG_DRC lists them within a severity, which is
 * the whole reason it is pinned.
 */
const KICAD_INIT_ORDER = [
  'text_mirroring',
  'sliver checker',
  'diff_pair_coupling',
  'length', // matched_length
  'silk_clearance',
  'solder_mask_issues',
  'diameter', // via_diameter
  'zone connections',
  'segment_length',
  'width', // track_width
  'angle', // track_angle
  'text_dimensions',
  'miscellaneous',
  'schematic_parity',
  'library_parity',
  'hole_size',
  'hole_to_hole_clearance',
  'footprint checks',
  'edge_clearance',
  'courtyard_clearance',
  'physical_clearance',
  'clearance', // copper_clearance
  'copper width', // connection_width
  'connectivity',
  'creepage',
  'disallow',
  'annular_width',
];

describe('the PCB editor frame registers the DRC test providers', () => {
  it('has every provider, in the order the installed build registers them', () => {
    const names = DRC_TEST_PROVIDER_REGISTRY.Instance()
      .GetTestProviders()
      .map((p) => p.GetName());

    expect(names).toEqual(KICAD_INIT_ORDER);
  });
});

/**
 * The consequence, which is what a reader of the list above actually cares
 * about: the providers' order IS the order markers land in the board, and so
 * the order `DIALOG_DRC` lists them within a severity.
 *
 * Pinned as the two providers whose relative order was WRONG, and visibly so:
 * on CM5_MINIMA_3 KiCad leads with two board-edge errors and follows with two
 * courtyard overlaps, and we led with the courtyards because `CMakeLists.txt`
 * lists `courtyard_clearance` before `edge_clearance` and we took that for the
 * initialisation order.
 */
describe('the order is the order violations come out in', () => {
  it('runs edge_clearance before courtyard_clearance, as the installed build does', () => {
    const names = DRC_TEST_PROVIDER_REGISTRY.Instance()
      .GetTestProviders()
      .map((p) => p.GetName());

    expect(names.indexOf('edge_clearance')).toBeLessThan(names.indexOf('courtyard_clearance'));
  });

  it('runs the warning providers CM5_MINIMA_3 exercises in kicad-cli order', () => {
    // Measured: `kicad-cli pcb drc` on that board reports its warnings in this
    // provider sequence. Nothing else in this file would catch a reordering
    // that kept the two above in place.
    const names = DRC_TEST_PROVIDER_REGISTRY.Instance()
      .GetTestProviders()
      .map((p) => p.GetName());
    const observed = [
      'silk_clearance',
      'solder_mask_issues',
      'text_dimensions',
      'library_parity',
      'hole_to_hole_clearance',
      'edge_clearance',
      'connectivity',
    ];

    expect(observed.map((n) => names.indexOf(n))).toEqual(
      [...observed.map((n) => names.indexOf(n))].sort((a, b) => a - b),
    );
    expect(names.indexOf(observed[0]!)).toBeGreaterThan(-1);
  });
});
