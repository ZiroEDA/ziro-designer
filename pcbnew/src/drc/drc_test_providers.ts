// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The DRC test providers, registered in link order.
 *
 * Each `drc_test_provider_*.cpp` registers itself with a static
 * `DRC_REGISTER_TEST_PROVIDER<...> dummy` at load, and the registry keeps the
 * order the static initialisers ran in - the order the objects appear in
 * `pcbnew/CMakeLists.txt`. Importing them here in that order reproduces it;
 * the ones not yet ported are listed where they belong.
 */
import './drc_test_provider_annular_width.js';
import './drc_test_provider_disallow.js';
// drc_test_provider_creepage
import './drc_test_provider_connectivity.js';
import './drc_test_provider_connection_width.js';
import './drc_test_provider_copper_clearance.js';
import './drc_test_provider_physical_clearance.js';
import './drc_test_provider_courtyard_clearance.js';
import './drc_test_provider_edge_clearance.js';
import './drc_test_provider_footprint_checks.js';
import './drc_test_provider_hole_to_hole.js';
import './drc_test_provider_hole_size.js';
import './drc_test_provider_library_parity.js';
import './drc_test_provider_schematic_parity.js';
import './drc_test_provider_misc.js';
import './drc_test_provider_text_dims.js';
import './drc_test_provider_track_angle.js';
import './drc_test_provider_track_width.js';
import './drc_test_provider_track_segment_length.js';
import './drc_test_provider_zone_connections.js';
import './drc_test_provider_via_diameter.js';
import './drc_test_provider_solder_mask.js';
import './drc_test_provider_silk_clearance.js';
// drc_test_provider_matched_length
import './drc_test_provider_diff_pair_coupling.js';
import './drc_test_provider_sliver_checker.js';
import './drc_test_provider_text_mirroring.js';
