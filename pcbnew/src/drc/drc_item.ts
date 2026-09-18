// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/drc/drc_item.h` / `drc_item.cpp`: `PCB_DRC_CODE`, `DRC_ITEM` over
 * `RC_ITEM` with its static table of every error type, and
 * `DRC_ITEMS_PROVIDER` over the board's markers.
 *
 * The static items are the DATA table KiCad itself hardcodes (title and
 * settings key per code); everything that lists DRC checks reads it here.
 */

import { RC_ITEM, RC_ITEMS_PROVIDER } from '@ziroeda/common/src/rc_item.js';
import { type KIID, niluuid } from '@ziroeda/common/src/kiid.js';
import { MARKER_T } from '@ziroeda/common/src/marker_base.js';
import type { BOARD } from '../board.js';
import type { PCB_MARKER } from '../pcb_marker.js';

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

/** The `DRC_RULE` members a `DRC_ITEM` reads of its violating rule. -- DRC_RULE pending (#636 stage 4) */
export interface DRC_RULE_FOR_ITEM {
  m_Name: string;
  m_Severity: number;
  IsImplicit(): boolean;
}

/** A `DRC_TEST_PROVIDER` reference. -- DRC_TEST_PROVIDER pending (#636 stage 4) */
export type DRC_TEST_PROVIDER_FOR_ITEM = object;

/**
 * An implementation of the RC_ITEM class for DRC violations.
 */
export class DRC_ITEM extends RC_ITEM {
  private m_violatingRule: DRC_RULE_FOR_ITEM | null = null;
  private m_violatingTest: DRC_TEST_PROVIDER_FOR_ITEM | null = null;

  /** `DRC_ITEM( int aErrorCode, const wxString& aTitle, const wxString& aSettingsKey )` (private). */
  private constructor(aErrorCode = 0, aTitle = '', aSettingsKey = '') {
    super();
    this.m_errorCode = aErrorCode;
    this.m_errorTitle = aTitle;
    this.m_settingsKey = aSettingsKey;
    this.m_parent = null;
  }

  /** `std::make_shared<DRC_ITEM>( item )`: `RC_ITEM( const std::shared_ptr<RC_ITEM>& )` on a template. */
  private static copyOf(aItem: DRC_ITEM): DRC_ITEM {
    const item = new DRC_ITEM();
    item.m_errorCode = aItem.m_errorCode;
    item.m_errorMessage = aItem.m_errorMessage;
    item.m_errorTitle = aItem.m_errorTitle;
    item.m_settingsKey = aItem.m_settingsKey;
    item.m_parent = aItem.m_parent;
    item.m_ids = [...aItem.m_ids];
    item.m_violatingRule = aItem.m_violatingRule;
    item.m_violatingTest = aItem.m_violatingTest;
    return item;
  }

  /**
   * Constructs a DRC_ITEM for the given error code
   * @see DRCE_T
   */
  static Create(aErrorCode: number): DRC_ITEM | null;
  /**
   * Constructs a DRC item from a given error settings key
   * @param aErrorKey is a settings key for an error code (the untranslated string that is used
   * to represent a given error code in settings files and for storing ignored DRC items)
   * @return the created item
   */
  static Create(aErrorKey: string): DRC_ITEM | null;
  static Create(a: number | string): DRC_ITEM | null {
    if (typeof a === 'string') {
      for (const item of DRC_ITEM.allItemTypes) {
        if (a === item.GetSettingsKey()) return DRC_ITEM.copyOf(item);
      }

      // This can happen if a project has old-format exclusions.  Just drop these items.
      return null;
    }

    const template = DRC_ITEM.byCode.get(a);

    if (template === undefined) {
      console.assert(false, 'Unknown DRC error code');
      return null;
    }

    return DRC_ITEM.copyOf(template);
  }

  static GetItemsWithSeverities(): RC_ITEM[] {
    if (DRC_ITEM.itemsWithSeveritiesAll.length === 0) {
      for (const item of DRC_ITEM.allItemTypes) {
        if (item === DRC_ITEM.heading_internal) break;

        DRC_ITEM.itemsWithSeveritiesAll.push(item);
      }
    }

    return DRC_ITEM.itemsWithSeveritiesAll;
  }

  private static itemsWithSeveritiesAll: RC_ITEM[] = [];

  SetViolatingRule(aRule: DRC_RULE_FOR_ITEM | null): void {
    this.m_violatingRule = aRule;
  }
  GetViolatingRule(): DRC_RULE_FOR_ITEM | null {
    return this.m_violatingRule;
  }

  override GetViolatingRuleDesc(aTranslate: boolean): string {
    if (this.m_violatingRule) return `Rule: ${this.m_violatingRule.m_Name}`;
    else return 'Local override';
  }

  SetViolatingTest(aProvider: DRC_TEST_PROVIDER_FOR_ITEM | null): void {
    this.m_violatingTest = aProvider;
  }
  GetViolatingTest(): DRC_TEST_PROVIDER_FOR_ITEM | null {
    return this.m_violatingTest;
  }

  override GetAuxItem2ID(): KIID {
    if (this.m_errorCode === PCB_DRC_CODE.DRCE_DIFF_PAIR_UNCOUPLED_LENGTH_TOO_LONG) {
      // we have lots of segments, but it's enough to show the first P and the first N
      return niluuid;
    }

    return this.m_ids.length > 2 ? this.m_ids[2]! : niluuid;
  }

  override GetAuxItem3ID(): KIID {
    if (this.m_errorCode === PCB_DRC_CODE.DRCE_DIFF_PAIR_UNCOUPLED_LENGTH_TOO_LONG) {
      // we have lots of segments, but it's enough to show the first P and the first N
      return niluuid;
    }

    return this.m_ids.length > 3 ? this.m_ids[3]! : niluuid;
  }

  // These, being statically-defined, require specialized I18N handling.
  // We don't translate on initialization and instead do it in the getters.
  // NOTE: Avoid changing the settings key for a DRC item after it has been created

  static readonly heading_electrical = new DRC_ITEM(0, 'Electrical', '');
  static readonly heading_DFM = new DRC_ITEM(0, 'Design for Manufacturing', '');
  static readonly heading_schematic_parity = new DRC_ITEM(0, 'Schematic Parity', '');
  static readonly heading_signal_integrity = new DRC_ITEM(0, 'Signal Integrity', '');
  static readonly heading_readability = new DRC_ITEM(0, 'Readability', '');
  static readonly heading_misc = new DRC_ITEM(0, 'Miscellaneous', '');
  static readonly heading_internal = new DRC_ITEM(0, '', '');
  static readonly heading_deprecated = new DRC_ITEM(0, '', '');

  static readonly unconnectedItems = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_UNCONNECTED_ITEMS,
    'Missing connection between items',
    'unconnected_items',
  );
  static readonly shortingItems = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_SHORTING_ITEMS,
    'Items shorting two nets',
    'shorting_items',
  );
  static readonly itemsNotAllowed = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_ALLOWED_ITEMS,
    'Items not allowed',
    'items_not_allowed',
  );
  static readonly textOnEdgeCuts = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_TEXT_ON_EDGECUTS,
    'Text or graphic on Edge.Cuts layer',
    'text_on_edge_cuts',
  );
  static readonly clearance = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_CLEARANCE,
    'Clearance violation',
    'clearance',
  );
  static readonly creepage = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_CREEPAGE,
    'Creepage violation',
    'creepage',
  );
  static readonly tracksCrossing = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_TRACKS_CROSSING,
    'Tracks crossing',
    'tracks_crossing',
  );
  static readonly edgeClearance = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_EDGE_CLEARANCE,
    'Board edge clearance violation',
    'copper_edge_clearance',
  );
  static readonly zonesIntersect = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_ZONES_INTERSECT,
    'Copper zones intersect',
    'zones_intersect',
  );
  static readonly isolatedCopper = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_ISOLATED_COPPER,
    'Isolated copper fill',
    'isolated_copper',
  );
  static readonly starvedThermal = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_STARVED_THERMAL,
    'Thermal relief connection to zone incomplete',
    'starved_thermal',
  );
  static readonly viaDangling = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_DANGLING_VIA,
    'Via is not connected or connected on only one layer',
    'via_dangling',
  );
  static readonly trackDangling = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_DANGLING_TRACK,
    'Track has unconnected end',
    'track_dangling',
  );
  static readonly holeClearance = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_HOLE_CLEARANCE,
    'Hole clearance violation',
    'hole_clearance',
  );
  static readonly holeNearHole = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_DRILLED_HOLES_TOO_CLOSE,
    'Drilled hole too close to other hole',
    'hole_to_hole',
  );
  static readonly holesCoLocated = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_DRILLED_HOLES_COLOCATED,
    'Drilled holes co-located',
    'holes_co_located',
  );
  static readonly connectionWidth = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_CONNECTION_WIDTH,
    'Copper connection too narrow',
    'connection_width',
  );
  static readonly trackWidth = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_TRACK_WIDTH,
    'Track width',
    'track_width',
  );
  static readonly trackAngle = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_TRACK_ANGLE,
    'Track angle',
    'track_angle',
  );
  static readonly trackSegmentLength = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_TRACK_SEGMENT_LENGTH,
    'Track segment length',
    'track_segment_length',
  );
  static readonly annularWidth = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_ANNULAR_WIDTH,
    'Annular width',
    'annular_width',
  );
  static readonly drillTooSmall = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_DRILL_OUT_OF_RANGE,
    'Hole size out of range',
    'drill_out_of_range',
  );
  static readonly viaDiameter = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_VIA_DIAMETER,
    'Via diameter',
    'via_diameter',
  );
  static readonly padstack = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_PADSTACK,
    'Padstack is questionable',
    'padstack',
  );
  static readonly padstackInvalid = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_PADSTACK_INVALID,
    'Padstack is not valid',
    'padstack_invalid',
  );
  static readonly microviaDrillTooSmall = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_MICROVIA_DRILL_OUT_OF_RANGE,
    'Micro via hole size out of range',
    'microvia_drill_out_of_range',
  );
  static readonly courtyardsOverlap = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_OVERLAPPING_FOOTPRINTS,
    'Courtyards overlap',
    'courtyards_overlap',
  );
  static readonly missingCourtyard = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_MISSING_COURTYARD,
    'Footprint has no courtyard defined',
    'missing_courtyard',
  );
  static readonly malformedCourtyard = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_MALFORMED_COURTYARD,
    'Footprint has malformed courtyard',
    'malformed_courtyard',
  );
  static readonly pthInsideCourtyard = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_PTH_IN_COURTYARD,
    'PTH inside courtyard',
    'pth_inside_courtyard',
  );
  static readonly npthInsideCourtyard = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_NPTH_IN_COURTYARD,
    'NPTH inside courtyard',
    'npth_inside_courtyard',
  );
  static readonly itemOnDisabledLayer = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_DISABLED_LAYER_ITEM,
    'Item on a disabled copper layer',
    'item_on_disabled_layer',
  );
  static readonly invalidOutline = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_INVALID_OUTLINE,
    'Board has malformed outline',
    'invalid_outline',
  );
  static readonly duplicateFootprints = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_DUPLICATE_FOOTPRINT,
    'Duplicate footprints',
    'duplicate_footprints',
  );
  static readonly missingFootprint = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_MISSING_FOOTPRINT,
    'Missing footprint',
    'missing_footprint',
  );
  static readonly extraFootprint = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_EXTRA_FOOTPRINT,
    'Extra footprint',
    'extra_footprint',
  );
  static readonly netConflict = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_NET_CONFLICT,
    "Pad net doesn't match schematic",
    'net_conflict',
  );
  static readonly schematicParity = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_SCHEMATIC_PARITY,
    "Footprint attributes don't match symbol",
    'footprint_symbol_mismatch',
  );
  static readonly footprintFilters = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_FOOTPRINT_FILTERS,
    "Footprint doesn't match symbol's footprint filters",
    'footprint_filters_mismatch',
  );
  static readonly schematicFieldsParity = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_SCHEMATIC_FIELDS_PARITY,
    'Footprint field does not match symbol field',
    'footprint_symbol_field_mismatch',
  );
  static readonly libFootprintIssues = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_LIB_FOOTPRINT_ISSUES,
    'Footprint not found in libraries',
    'lib_footprint_issues',
  );
  static readonly libFootprintMismatch = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_LIB_FOOTPRINT_MISMATCH,
    "Footprint doesn't match copy in library",
    'lib_footprint_mismatch',
  );
  static readonly unresolvedVariable = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_UNRESOLVED_VARIABLE,
    'Unresolved text variable',
    'unresolved_variable',
  );
  static readonly assertionFailure = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_ASSERTION_FAILURE,
    'Assertion failure',
    'assertion_failure',
  );
  static readonly genericWarning = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_GENERIC_WARNING,
    'Warning',
    'generic_warning',
  );
  static readonly genericError = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_GENERIC_ERROR,
    'Error',
    'generic_error',
  );
  static readonly copperSliver = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_COPPER_SLIVER,
    'Copper sliver',
    'copper_sliver',
  );
  static readonly solderMaskBridge = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_SOLDERMASK_BRIDGE,
    'Solder mask aperture bridges items with different nets',
    'solder_mask_bridge',
  );
  static readonly silkMaskClearance = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_SILK_MASK_CLEARANCE,
    'Silkscreen clipped by solder mask',
    'silk_over_copper',
  );
  static readonly silkEdgeClearance = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_SILK_EDGE_CLEARANCE,
    'Silkscreen clipped by board edge',
    'silk_edge_clearance',
  );
  static readonly silkClearance = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_SILK_CLEARANCE,
    'Silkscreen clearance',
    'silk_overlap',
  );
  static readonly textHeightOutOfRange = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_TEXT_HEIGHT,
    'Text height out of range',
    'text_height',
  );
  static readonly textThicknessOutOfRange = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_TEXT_THICKNESS,
    'Text thickness out of range',
    'text_thickness',
  );
  static readonly lengthOutOfRange = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_LENGTH_OUT_OF_RANGE,
    'Track length out of range',
    'length_out_of_range',
  );
  static readonly skewOutOfRange = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_SKEW_OUT_OF_RANGE,
    'Skew between tracks out of range',
    'skew_out_of_range',
  );
  // Note: this used to only check against a max value, hence the settings key too_many_vias
  static readonly viaCountOutOfRange = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_VIA_COUNT_OUT_OF_RANGE,
    'Too many or too few vias on a connection',
    'too_many_vias',
  );
  static readonly diffPairGapOutOfRange = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_DIFF_PAIR_GAP_OUT_OF_RANGE,
    'Differential pair gap out of range',
    'diff_pair_gap_out_of_range',
  );
  static readonly diffPairUncoupledLengthTooLong = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_DIFF_PAIR_UNCOUPLED_LENGTH_TOO_LONG,
    'Differential uncoupled length too long',
    'diff_pair_uncoupled_length_too_long',
  );
  static readonly footprint = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_FOOTPRINT,
    'Footprint is not valid',
    'footprint',
  );
  static readonly footprintTypeMismatch = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_FOOTPRINT_TYPE_MISMATCH,
    "Footprint component type doesn't match footprint pads",
    'footprint_type_mismatch',
  );
  static readonly footprintTHPadhasNoHole = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_PAD_TH_WITH_NO_HOLE,
    'Through hole pad has no hole',
    'through_hole_pad_without_hole',
  );
  static readonly mirroredTextOnFrontLayer = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_MIRRORED_TEXT_ON_FRONT_LAYER,
    'Mirrored text on front layer',
    'mirrored_text_on_front_layer',
  );
  static readonly nonMirroredTextOnBackLayer = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_NONMIRRORED_TEXT_ON_BACK_LAYER,
    'Non-Mirrored text on back layer',
    'nonmirrored_text_on_back_layer',
  );
  static readonly missingTuningProfile = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_MISSING_TUNING_PROFILE,
    'Missing tuning profile',
    'missing_tuning_profile',
  );
  static readonly tuningProfileImplicitRules = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_TUNING_PROFILE_IMPLICIT_RULES,
    'Tuning profile track geometries',
    'tuning_profile_track_geometries',
  );
  static readonly trackOnPostMachinedLayer = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_TRACK_ON_POST_MACHINED_LAYER,
    'Track connected to post-machined or backdrilled layer',
    'track_on_post_machined_layer',
  );
  static readonly trackNotCenteredOnVia = new DRC_ITEM(
    PCB_DRC_CODE.DRCE_TRACK_NOT_CENTERED_ON_VIA,
    'Track endpoint not centered on via',
    'track_not_centered_on_via',
  );

  /// A list of all DRC_ITEM types which are valid error codes
  static readonly allItemTypes: readonly DRC_ITEM[] = [
    DRC_ITEM.heading_electrical,
    DRC_ITEM.shortingItems,
    DRC_ITEM.tracksCrossing,
    DRC_ITEM.clearance,
    DRC_ITEM.creepage,
    DRC_ITEM.viaDangling,
    DRC_ITEM.trackDangling,
    DRC_ITEM.starvedThermal,

    DRC_ITEM.heading_DFM,
    DRC_ITEM.edgeClearance,
    DRC_ITEM.holeClearance,
    DRC_ITEM.holeNearHole,
    DRC_ITEM.holesCoLocated,
    DRC_ITEM.trackWidth,
    DRC_ITEM.trackAngle,
    DRC_ITEM.trackSegmentLength,
    DRC_ITEM.annularWidth,
    DRC_ITEM.drillTooSmall,
    DRC_ITEM.microviaDrillTooSmall,
    DRC_ITEM.courtyardsOverlap,
    DRC_ITEM.missingCourtyard,
    DRC_ITEM.malformedCourtyard,
    DRC_ITEM.invalidOutline,
    DRC_ITEM.copperSliver,
    DRC_ITEM.solderMaskBridge,
    DRC_ITEM.connectionWidth,
    DRC_ITEM.trackOnPostMachinedLayer,
    DRC_ITEM.trackNotCenteredOnVia,
    DRC_ITEM.tuningProfileImplicitRules,

    DRC_ITEM.heading_schematic_parity,
    DRC_ITEM.duplicateFootprints,
    DRC_ITEM.missingFootprint,
    DRC_ITEM.extraFootprint,
    DRC_ITEM.schematicParity,
    DRC_ITEM.schematicFieldsParity,
    DRC_ITEM.footprintFilters,
    DRC_ITEM.netConflict,
    DRC_ITEM.unconnectedItems,

    DRC_ITEM.heading_signal_integrity,
    DRC_ITEM.lengthOutOfRange,
    DRC_ITEM.skewOutOfRange,
    DRC_ITEM.viaCountOutOfRange,
    DRC_ITEM.diffPairGapOutOfRange,
    DRC_ITEM.diffPairUncoupledLengthTooLong,

    DRC_ITEM.heading_readability,
    DRC_ITEM.silkClearance,
    DRC_ITEM.silkMaskClearance,
    DRC_ITEM.silkEdgeClearance,
    DRC_ITEM.textHeightOutOfRange,
    DRC_ITEM.textThicknessOutOfRange,
    DRC_ITEM.mirroredTextOnFrontLayer,
    DRC_ITEM.nonMirroredTextOnBackLayer,

    DRC_ITEM.heading_misc,
    DRC_ITEM.itemsNotAllowed,
    DRC_ITEM.textOnEdgeCuts,
    DRC_ITEM.zonesIntersect,
    DRC_ITEM.isolatedCopper,
    DRC_ITEM.footprint,
    DRC_ITEM.padstack,
    DRC_ITEM.pthInsideCourtyard,
    DRC_ITEM.npthInsideCourtyard,
    DRC_ITEM.itemOnDisabledLayer,
    DRC_ITEM.unresolvedVariable,
    DRC_ITEM.footprintTypeMismatch,
    DRC_ITEM.libFootprintIssues,
    DRC_ITEM.libFootprintMismatch,
    DRC_ITEM.footprintTHPadhasNoHole,
    DRC_ITEM.missingTuningProfile,

    // DRC_ITEM types with no user-editable severities
    // NOTE: this MUST be the last grouping in the list!
    DRC_ITEM.heading_internal,
    DRC_ITEM.padstackInvalid,
    DRC_ITEM.genericError,
    DRC_ITEM.genericWarning,
  ];

  /** `DRC_ITEM::Create( int aErrorCode )`'s switch, as a map over the same statics. */
  private static readonly byCode: ReadonlyMap<number, DRC_ITEM> = new Map<number, DRC_ITEM>([
    [PCB_DRC_CODE.DRCE_UNCONNECTED_ITEMS, DRC_ITEM.unconnectedItems],
    [PCB_DRC_CODE.DRCE_SHORTING_ITEMS, DRC_ITEM.shortingItems],
    [PCB_DRC_CODE.DRCE_ALLOWED_ITEMS, DRC_ITEM.itemsNotAllowed],
    [PCB_DRC_CODE.DRCE_TEXT_ON_EDGECUTS, DRC_ITEM.textOnEdgeCuts],
    [PCB_DRC_CODE.DRCE_CLEARANCE, DRC_ITEM.clearance],
    [PCB_DRC_CODE.DRCE_CREEPAGE, DRC_ITEM.creepage],
    [PCB_DRC_CODE.DRCE_TRACKS_CROSSING, DRC_ITEM.tracksCrossing],
    [PCB_DRC_CODE.DRCE_EDGE_CLEARANCE, DRC_ITEM.edgeClearance],
    [PCB_DRC_CODE.DRCE_ZONES_INTERSECT, DRC_ITEM.zonesIntersect],
    [PCB_DRC_CODE.DRCE_ISOLATED_COPPER, DRC_ITEM.isolatedCopper],
    [PCB_DRC_CODE.DRCE_STARVED_THERMAL, DRC_ITEM.starvedThermal],
    [PCB_DRC_CODE.DRCE_DANGLING_VIA, DRC_ITEM.viaDangling],
    [PCB_DRC_CODE.DRCE_DANGLING_TRACK, DRC_ITEM.trackDangling],
    [PCB_DRC_CODE.DRCE_DRILLED_HOLES_TOO_CLOSE, DRC_ITEM.holeNearHole],
    [PCB_DRC_CODE.DRCE_DRILLED_HOLES_COLOCATED, DRC_ITEM.holesCoLocated],
    [PCB_DRC_CODE.DRCE_HOLE_CLEARANCE, DRC_ITEM.holeClearance],
    [PCB_DRC_CODE.DRCE_CONNECTION_WIDTH, DRC_ITEM.connectionWidth],
    [PCB_DRC_CODE.DRCE_TRACK_WIDTH, DRC_ITEM.trackWidth],
    [PCB_DRC_CODE.DRCE_TRACK_ANGLE, DRC_ITEM.trackAngle],
    [PCB_DRC_CODE.DRCE_TRACK_SEGMENT_LENGTH, DRC_ITEM.trackSegmentLength],
    [PCB_DRC_CODE.DRCE_ANNULAR_WIDTH, DRC_ITEM.annularWidth],
    [PCB_DRC_CODE.DRCE_DRILL_OUT_OF_RANGE, DRC_ITEM.drillTooSmall],
    [PCB_DRC_CODE.DRCE_VIA_DIAMETER, DRC_ITEM.viaDiameter],
    [PCB_DRC_CODE.DRCE_PADSTACK, DRC_ITEM.padstack],
    [PCB_DRC_CODE.DRCE_PADSTACK_INVALID, DRC_ITEM.padstackInvalid],
    [PCB_DRC_CODE.DRCE_MICROVIA_DRILL_OUT_OF_RANGE, DRC_ITEM.microviaDrillTooSmall],
    [PCB_DRC_CODE.DRCE_OVERLAPPING_FOOTPRINTS, DRC_ITEM.courtyardsOverlap],
    [PCB_DRC_CODE.DRCE_MISSING_COURTYARD, DRC_ITEM.missingCourtyard],
    [PCB_DRC_CODE.DRCE_MALFORMED_COURTYARD, DRC_ITEM.malformedCourtyard],
    [PCB_DRC_CODE.DRCE_PTH_IN_COURTYARD, DRC_ITEM.pthInsideCourtyard],
    [PCB_DRC_CODE.DRCE_NPTH_IN_COURTYARD, DRC_ITEM.npthInsideCourtyard],
    [PCB_DRC_CODE.DRCE_DISABLED_LAYER_ITEM, DRC_ITEM.itemOnDisabledLayer],
    [PCB_DRC_CODE.DRCE_INVALID_OUTLINE, DRC_ITEM.invalidOutline],
    [PCB_DRC_CODE.DRCE_MISSING_FOOTPRINT, DRC_ITEM.missingFootprint],
    [PCB_DRC_CODE.DRCE_DUPLICATE_FOOTPRINT, DRC_ITEM.duplicateFootprints],
    [PCB_DRC_CODE.DRCE_NET_CONFLICT, DRC_ITEM.netConflict],
    [PCB_DRC_CODE.DRCE_EXTRA_FOOTPRINT, DRC_ITEM.extraFootprint],
    [PCB_DRC_CODE.DRCE_SCHEMATIC_PARITY, DRC_ITEM.schematicParity],
    [PCB_DRC_CODE.DRCE_SCHEMATIC_FIELDS_PARITY, DRC_ITEM.schematicFieldsParity],
    [PCB_DRC_CODE.DRCE_FOOTPRINT_FILTERS, DRC_ITEM.footprintFilters],
    [PCB_DRC_CODE.DRCE_LIB_FOOTPRINT_ISSUES, DRC_ITEM.libFootprintIssues],
    [PCB_DRC_CODE.DRCE_LIB_FOOTPRINT_MISMATCH, DRC_ITEM.libFootprintMismatch],
    [PCB_DRC_CODE.DRCE_UNRESOLVED_VARIABLE, DRC_ITEM.unresolvedVariable],
    [PCB_DRC_CODE.DRCE_ASSERTION_FAILURE, DRC_ITEM.assertionFailure],
    [PCB_DRC_CODE.DRCE_GENERIC_WARNING, DRC_ITEM.genericWarning],
    [PCB_DRC_CODE.DRCE_GENERIC_ERROR, DRC_ITEM.genericError],
    [PCB_DRC_CODE.DRCE_COPPER_SLIVER, DRC_ITEM.copperSliver],
    [PCB_DRC_CODE.DRCE_SILK_CLEARANCE, DRC_ITEM.silkClearance],
    [PCB_DRC_CODE.DRCE_SILK_MASK_CLEARANCE, DRC_ITEM.silkMaskClearance],
    [PCB_DRC_CODE.DRCE_SILK_EDGE_CLEARANCE, DRC_ITEM.silkEdgeClearance],
    [PCB_DRC_CODE.DRCE_SOLDERMASK_BRIDGE, DRC_ITEM.solderMaskBridge],
    [PCB_DRC_CODE.DRCE_TEXT_HEIGHT, DRC_ITEM.textHeightOutOfRange],
    [PCB_DRC_CODE.DRCE_TEXT_THICKNESS, DRC_ITEM.textThicknessOutOfRange],
    [PCB_DRC_CODE.DRCE_LENGTH_OUT_OF_RANGE, DRC_ITEM.lengthOutOfRange],
    [PCB_DRC_CODE.DRCE_SKEW_OUT_OF_RANGE, DRC_ITEM.skewOutOfRange],
    [PCB_DRC_CODE.DRCE_VIA_COUNT_OUT_OF_RANGE, DRC_ITEM.viaCountOutOfRange],
    [PCB_DRC_CODE.DRCE_DIFF_PAIR_GAP_OUT_OF_RANGE, DRC_ITEM.diffPairGapOutOfRange],
    [
      PCB_DRC_CODE.DRCE_DIFF_PAIR_UNCOUPLED_LENGTH_TOO_LONG,
      DRC_ITEM.diffPairUncoupledLengthTooLong,
    ],
    [PCB_DRC_CODE.DRCE_FOOTPRINT, DRC_ITEM.footprint],
    [PCB_DRC_CODE.DRCE_FOOTPRINT_TYPE_MISMATCH, DRC_ITEM.footprintTypeMismatch],
    [PCB_DRC_CODE.DRCE_PAD_TH_WITH_NO_HOLE, DRC_ITEM.footprintTHPadhasNoHole],
    [PCB_DRC_CODE.DRCE_MIRRORED_TEXT_ON_FRONT_LAYER, DRC_ITEM.mirroredTextOnFrontLayer],
    [PCB_DRC_CODE.DRCE_NONMIRRORED_TEXT_ON_BACK_LAYER, DRC_ITEM.nonMirroredTextOnBackLayer],
    [PCB_DRC_CODE.DRCE_MISSING_TUNING_PROFILE, DRC_ITEM.missingTuningProfile],
    [PCB_DRC_CODE.DRCE_TRACK_ON_POST_MACHINED_LAYER, DRC_ITEM.trackOnPostMachinedLayer],
    [PCB_DRC_CODE.DRCE_TRACK_NOT_CENTERED_ON_VIA, DRC_ITEM.trackNotCenteredOnVia],
  ]);
}

/**
 * The markers of a board, filtered by marker type and severity.
 */
export class DRC_ITEMS_PROVIDER extends RC_ITEMS_PROVIDER {
  private m_board: BOARD;
  private m_markerTypes: MARKER_T[] = [];
  private m_severities: number;
  private m_filteredMarkers: PCB_MARKER[] = [];

  constructor(
    aBoard: BOARD,
    aMarkerType: MARKER_T,
    otherMarkerType: MARKER_T = MARKER_T.MARKER_UNSPEC,
  ) {
    super();
    this.m_board = aBoard;
    this.m_severities = 0;

    this.m_markerTypes.push(aMarkerType);

    if (otherMarkerType !== MARKER_T.MARKER_UNSPEC) this.m_markerTypes.push(otherMarkerType);
  }

  override SetSeverities(aSeverities: number): void {
    this.m_severities = aSeverities;

    this.m_filteredMarkers = [];

    for (const marker of this.m_board.Markers() as PCB_MARKER[]) {
      if (
        this.m_markerTypes.includes(marker.GetMarkerType()) &&
        (marker.GetSeverity() & this.m_severities) > 0
      ) {
        this.m_filteredMarkers.push(marker);
      }
    }

    // Sort markers so that errors appear before warnings (a stable sort)
    this.m_filteredMarkers = this.m_filteredMarkers
      .map((m, i) => [m, i] as const)
      .sort((a, b) => b[0].GetSeverity() - a[0].GetSeverity() || a[1] - b[1])
      .map(([m]) => m);
  }

  override GetSeverities(): number {
    return this.m_severities;
  }

  override GetCount(aSeverity = -1): number {
    if (aSeverity < 0) return this.m_filteredMarkers.length;

    let count = 0;

    for (const marker of this.m_board.Markers() as PCB_MARKER[]) {
      if (
        this.m_markerTypes.includes(marker.GetMarkerType()) &&
        (marker.GetSeverity() & aSeverity) > 0
      ) {
        count++;
      }
    }

    return count;
  }

  override GetItem(aIndex: number): RC_ITEM | null {
    const marker = this.m_filteredMarkers[aIndex];

    return marker ? marker.GetRCItem() : null;
  }

  override DeleteItem(aIndex: number, aDeep: boolean): void {
    const marker = this.m_filteredMarkers[aIndex]!;
    this.m_filteredMarkers.splice(aIndex, 1);

    if (aDeep) this.m_board.Delete(marker);
  }
}
