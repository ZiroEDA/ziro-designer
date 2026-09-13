// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/drc/drc_item.h`: `PCB_DRC_CODE`, the error codes a `DRC_ITEM`
 * carries. The `DRC_ITEM` class itself (over `RC_ITEM`) lands with the DRC
 * engine (#636 stage 6).
 */

export enum PCB_DRC_CODE {
  DRCE_FIRST = 1,
  DRCE_UNCONNECTED_ITEMS = DRCE_FIRST, // items are unconnected
  DRCE_SHORTING_ITEMS, // items short two nets but are not a net-tie
  DRCE_ALLOWED_ITEMS, // a disallowed item has been used
  DRCE_TEXT_ON_EDGECUTS, // text or dimension on Edge.Cuts layer
  DRCE_CLEARANCE, // items are too close together
  DRCE_CREEPAGE, // items are too close together ( creepage )
  DRCE_TRACKS_CROSSING, // tracks are crossing
  DRCE_EDGE_CLEARANCE, // a copper item is too close to the board edge
  DRCE_ZONES_INTERSECT, // copper zone outlines intersect
  DRCE_ISOLATED_COPPER, // copper fill with no electrical connections
  DRCE_STARVED_THERMAL, // insufficient number of thermal spokes connected to zone
  DRCE_DANGLING_VIA, // via which isn't connected to anything
  DRCE_DANGLING_TRACK, // track with at least one end not connected to anything
  DRCE_DRILLED_HOLES_TOO_CLOSE, // overlapping drilled holes break drill bits
  DRCE_DRILLED_HOLES_COLOCATED, // two holes at the same location
  DRCE_HOLE_CLEARANCE, //
  DRCE_TRACK_WIDTH, // Track width is too small or too large
  DRCE_TRACK_ANGLE, // Angle between two connected tracks is too small or too large
  DRCE_TRACK_SEGMENT_LENGTH, // Track segment is too short or too long
  DRCE_ANNULAR_WIDTH, // Via size and drill leave annular ring too small
  DRCE_CONNECTION_WIDTH, // Net connection too small
  DRCE_DRILL_OUT_OF_RANGE, // Too small via or pad drill
  DRCE_VIA_DIAMETER, // Via diameter checks (min/max)
  DRCE_PADSTACK, // something is questionable with a pad or via stackup
  DRCE_PADSTACK_INVALID, // something is invalid with a pad or via stackup
  DRCE_MICROVIA_DRILL_OUT_OF_RANGE, // Too small micro via drill
  DRCE_OVERLAPPING_FOOTPRINTS, // footprint courtyards overlap
  DRCE_MISSING_COURTYARD, // footprint has no courtyard defined
  DRCE_MALFORMED_COURTYARD, // footprint has a courtyard but malformed
  // (not convertible to a closed polygon with holes)
  DRCE_PTH_IN_COURTYARD,
  DRCE_NPTH_IN_COURTYARD,
  DRCE_DISABLED_LAYER_ITEM, // item on a disabled layer
  DRCE_INVALID_OUTLINE, // invalid board outline
  DRCE_MISSING_FOOTPRINT, // footprint not found for netlist item
  DRCE_DUPLICATE_FOOTPRINT, // more than one footprints found for netlist item
  DRCE_EXTRA_FOOTPRINT, // netlist item not found for footprint
  DRCE_NET_CONFLICT, // pad net doesn't match netlist
  DRCE_SCHEMATIC_PARITY, // footprint attributes don't match symbol attributes
  DRCE_FOOTPRINT_FILTERS, // footprint doesn't match symbol's footprint filters
  DRCE_FOOTPRINT_TYPE_MISMATCH, // footprint attribute does not match actual pads
  DRCE_LIB_FOOTPRINT_ISSUES, // footprint not found in active libraries
  DRCE_LIB_FOOTPRINT_MISMATCH, // footprint does not match the current library
  DRCE_PAD_TH_WITH_NO_HOLE, // footprint has Plated Through-Hole with no hole
  DRCE_FOOTPRINT, // error in footprint definition
  DRCE_UNRESOLVED_VARIABLE,
  DRCE_ASSERTION_FAILURE, // user-defined (custom rule) assertion
  DRCE_GENERIC_WARNING, // generic warning
  DRCE_GENERIC_ERROR, // generic error
  DRCE_COPPER_SLIVER,
  DRCE_SOLDERMASK_BRIDGE, // failure to maintain min soldermask web thickness
  //   between copper items with different nets
  DRCE_SILK_MASK_CLEARANCE, // silkscreen clipped by mask (potentially leaving it
  //   over pads, exposed copper, etc.)
  DRCE_SILK_EDGE_CLEARANCE,
  DRCE_SILK_CLEARANCE, // silk-to-silk or silk-to-other clearance error
  DRCE_TEXT_HEIGHT,
  DRCE_TEXT_THICKNESS,
  DRCE_LENGTH_OUT_OF_RANGE,
  DRCE_SKEW_OUT_OF_RANGE,
  DRCE_VIA_COUNT_OUT_OF_RANGE,
  DRCE_DIFF_PAIR_GAP_OUT_OF_RANGE,
  DRCE_DIFF_PAIR_UNCOUPLED_LENGTH_TOO_LONG,
  DRCE_MIRRORED_TEXT_ON_FRONT_LAYER,
  DRCE_NONMIRRORED_TEXT_ON_BACK_LAYER,
  DRCE_MISSING_TUNING_PROFILE, // Tuning profile used in net class is not defined
  DRCE_TUNING_PROFILE_IMPLICIT_RULES, // Pseudo-code for setting severities
  DRCE_TRACK_ON_POST_MACHINED_LAYER, // Track connected to pad/via on post-machined/backdrilled layer
  DRCE_TRACK_NOT_CENTERED_ON_VIA, // Track endpoint within via pad but not at via center
  DRCE_SCHEMATIC_FIELDS_PARITY, // Mismatch with schematic fields

  DRCE_LAST = DRCE_SCHEMATIC_FIELDS_PARITY,
}

export const DRCE_PADSTACK = PCB_DRC_CODE.DRCE_PADSTACK;
export const DRCE_PADSTACK_INVALID = PCB_DRC_CODE.DRCE_PADSTACK_INVALID;
export const DRCE_PAD_TH_WITH_NO_HOLE = PCB_DRC_CODE.DRCE_PAD_TH_WITH_NO_HOLE;
