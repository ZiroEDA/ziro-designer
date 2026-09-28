// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The DRC test providers, registered in the order the installed build
 * registers them - which is the REVERSE of `pcbnew/CMakeLists.txt`.
 *
 * Each `drc_test_provider_*.cpp` registers itself with a file-scope
 * `DRC_REGISTER_TEST_PROVIDER<...>`, and the registry keeps the order those
 * initialisers ran in. This file used to say that order is the order the
 * objects appear in `pcbnew/CMakeLists.txt`. It is not, and C++ does not
 * promise it is: initialisation order across translation units is
 * unspecified, and this build runs them backwards.
 *
 * It is observable, and it was observed. The providers' order IS the order the
 * markers land in the board, which is the order `DIALOG_DRC` lists them in
 * within a severity (`DRC_ITEMS_PROVIDER::SetSeverities` stable_sorts by
 * severity and nothing else). On CM5_MINIMA_3, `kicad-cli pcb drc` reports its
 * warnings in this provider sequence:
 *
 *     silk_clearance(23) solder_mask(22) text_dims(16) library_parity(13)
 *     hole_to_hole(11)   edge_clearance(9) connectivity(4)
 *
 * - strictly decreasing by CMakeLists position, across seven providers - and
 * its two errors as edge_clearance(9) then courtyard_clearance(8). Ours listed
 * courtyard before edge and so led with the courtyard overlaps where KiCad
 * leads with the board-edge errors.
 *
 * So the list below is CMakeLists read bottom to top. Keep it that way, and
 * when a provider is added upstream, add it here at the position that mirrors
 * it - which is the other end from where CMakeLists grew.
 */
import './drc_test_provider_text_mirroring.js';
import './drc_test_provider_sliver_checker.js';
import './drc_test_provider_diff_pair_coupling.js';
import './drc_test_provider_matched_length.js';
import './drc_test_provider_silk_clearance.js';
import './drc_test_provider_solder_mask.js';
import './drc_test_provider_via_diameter.js';
import './drc_test_provider_zone_connections.js';
import './drc_test_provider_track_segment_length.js';
import './drc_test_provider_track_width.js';
import './drc_test_provider_track_angle.js';
import './drc_test_provider_text_dims.js';
import './drc_test_provider_misc.js';
import './drc_test_provider_schematic_parity.js';
import './drc_test_provider_library_parity.js';
import './drc_test_provider_hole_size.js';
import './drc_test_provider_hole_to_hole.js';
import './drc_test_provider_footprint_checks.js';
import './drc_test_provider_edge_clearance.js';
import './drc_test_provider_courtyard_clearance.js';
import './drc_test_provider_physical_clearance.js';
import './drc_test_provider_copper_clearance.js';
import './drc_test_provider_connection_width.js';
import './drc_test_provider_connectivity.js';
import './drc_test_provider_creepage.js';
import './drc_test_provider_disallow.js';
import './drc_test_provider_annular_width.js';
