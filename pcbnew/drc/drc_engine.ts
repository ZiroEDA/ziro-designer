// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/drc/drc_engine.h` + `drc_engine.cpp`: the rule engine on the live
 * BOARD (#636 stage 4). The rules come from `loadImplicitRules` (the board
 * setup, the netclasses, the tuning profiles, the keepouts) and the
 * project's `.kicad_dru` (`loadRules`); `EvalRules` resolves one constraint
 * for an item pair, and it is what `GetOwnClearance` and every test
 * provider ask.
 *
 * The `std::shared_mutex` around the clearance caches and the thread pool of
 * `InitializeClearanceCache` collapse to plain Maps and a loop: one thread.
 * The view-based engine the dialog still runs is `drc_engine_view.ts`.
 */
import type { DS_PROXY_VIEW_ITEM } from '@ziroeda/common/src/drawing_sheet/ds_proxy_view_item.js';
import { DescribeRef } from '@ziroeda/common/src/common.js';
import { PARSE_ERROR } from '@ziroeda/common/src/dsnlexer.js';
import { type EdaUnits, pcbIUScale } from '@ziroeda/common/src/eda_units.js';
import { HOLE_PROXY } from '@ziroeda/common/src/eda_item_flags.js';
import { ExpandTextVars } from '@ziroeda/common/src/common.js';
import type { OutStr } from '@ziroeda/common/src/font/font.js';
import type { KIID } from '@ziroeda/common/src/kiid.js';
import {
  IsPcbLayer,
  type PCB_LAYER_ID,
  PCB_LAYER_ID as LAYER,
} from '@ziroeda/common/src/layer_ids.js';
import { LSET } from '@ziroeda/common/src/lset.js';
import type { NETCLASS } from '@ziroeda/common/src/netclass.js';
import type { PROGRESS_REPORTER } from '@ziroeda/common/src/progress_reporter.js';
import { RPT_SEVERITY_ERROR, type Reporter } from '@ziroeda/common/src/reporter.js';
import { EscapeHTML } from '@ziroeda/common/src/string_utils.js';
import { UNITS_PROVIDER } from '@ziroeda/common/src/units_provider.js';
import { BaseType, KICAD_T } from '@ziroeda/core/src/typeinfo.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { NETLIST } from '../netlist_reader/pcb_netlist.js';
import type { BOARD } from '../board.js';
import type { BOARD_CONNECTED_ITEM } from '../board_connected_item.js';
import type { BOARD_DESIGN_SETTINGS } from '../board_design_settings.js';
import { MAXIMUM_CLEARANCE } from '../board_design_settings_defaults.js';
import type { BOARD_ITEM } from '../board_item.js';
import type { FOOTPRINT } from '../footprint.js';
import type { NETINFO_ITEM } from '../netinfo.js';
import type { PAD } from '../pad.js';
import { PAD_ATTRIB } from '../padstack.js';
import type { PCB_MARKER } from '../pcb_marker.js';
import type { PCB_SHAPE } from '../pcb_shape.js';
import type { PCB_TRACK, PCB_VIA } from '../pcb_track.js';
import type { ZONE } from '../zone.js';
import { PrintZoneConnection, ZONE_CONNECTION } from '../zones.js';
import { DRC_CACHE_GENERATOR } from './drc_cache_generator.js';
import { type DRC_ITEM, PCB_DRC_CODE } from './drc_item.js';
import {
  DRC_CONSTRAINT,
  DRC_CONSTRAINT_T,
  DRC_DISALLOW_T,
  DRC_DISALLOW_VIAS,
  DRC_IMPLICIT_SOURCE,
  DRC_RULE,
} from './drc_rule.js';
import { DRC_RULE_CONDITION } from './drc_rule_condition.js';
import { DRC_RULES_PARSER } from './drc_rule_parser.js';
import {
  DRC_SHOWMATCHES_PROVIDER_REGISTRY,
  DRC_TEST_PROVIDER,
  DRC_TEST_PROVIDER_REGISTRY,
} from './drc_test_provider.js';

// wxListBox's performance degrades horrifically with very large datasets.  It's not clear
// they're useful to the user anyway.
const ERROR_LIMIT = 199;
const EXTENDED_ERROR_LIMIT = 499;

const DRCE_FIRST = PCB_DRC_CODE.DRCE_FIRST;
const DRCE_LAST = PCB_DRC_CODE.DRCE_LAST;

/**
 * Cache key for own clearance lookups, combining item UUID and layer. The
 * `unordered_map` keyed by the struct is a Map keyed by `uuid:layer` (a
 * KIID is hex and dashes, so the colon cannot collide).
 */
function ownClearanceKey(aUuid: KIID, aLayer: PCB_LAYER_ID): string {
  return `${aUuid}:${aLayer}`;
}

export type DRC_VIOLATION_HANDLER = (
  aItem: DRC_ITEM,
  aPos: VECTOR2I,
  aLayer: number,
  aPathGenerator: (aMarker: PCB_MARKER) => void,
) => void;

/**
 * Batch result for clearance-related constraints to reduce per-query overhead during PNS routing.
 */
export interface DRC_CLEARANCE_BATCH {
  clearance: number;
  holeClearance: number;
  holeToHole: number;
  edgeClearance: number;
  physicalClearance: number;
}

/** The three out-parameters of `DRC_ENGINE::MatchDpSuffix`, plus its return. */
export interface DP_SUFFIX_MATCH {
  /** The C++ return value: 1 for P/+, -1 for N/-, 0 for no match. */
  polarity: number;
  /** `aComplementNet` */
  complementNet: string;
  /** `aBaseDpName` */
  baseDpName: string;
}

interface DRC_ENGINE_CONSTRAINT {
  layerTest: LSET;
  condition: DRC_RULE_CONDITION | null;
  parentRule: DRC_RULE | null;
  constraint: DRC_CONSTRAINT;
}

function isKeepoutZone(aItem: BOARD_ITEM | null, aCheckFlags: boolean): boolean {
  if (!aItem || aItem.Type() !== KICAD_T.PCB_ZONE_T) return false;

  const zone = aItem as ZONE;

  if (!zone.GetIsRuleArea()) return false;

  if (!zone.HasKeepoutParametersSet()) return false;

  if (aCheckFlags) {
    if (
      !zone.GetDoNotAllowTracks() &&
      !zone.GetDoNotAllowVias() &&
      !zone.GetDoNotAllowPads() &&
      !zone.GetDoNotAllowZoneFills() &&
      !zone.GetDoNotAllowFootprints()
    ) {
      return false;
    }
  }

  return true;
}

/** `dynamic_cast<const BOARD_CONNECTED_ITEM*>` */
function asConnected(aItem: BOARD_ITEM | null): BOARD_CONNECTED_ITEM | null {
  return aItem && aItem.IsConnected() ? (aItem as BOARD_CONNECTED_ITEM) : null;
}

/** `dynamic_cast<const PCB_TRACK*>` */
function asTrack(aItem: BOARD_ITEM): PCB_TRACK | null {
  const t = aItem.Type();

  return t === KICAD_T.PCB_TRACE_T || t === KICAD_T.PCB_ARC_T || t === KICAD_T.PCB_VIA_T
    ? (aItem as PCB_TRACK)
    : null;
}

/**
 * Design Rule Checker object that performs all the DRC tests.
 *
 * Optionally reports violations via a DRC_VIOLATION_HANDLER, user-level progress via a
 * PROGRESS_REPORTER and rule parse errors via a REPORTER, all set through various setter
 * calls.
 *
 * Note that EvalRules() has yet another optional REPORTER for reporting resolution info to
 * the user.
 */
export class DRC_ENGINE extends UNITS_PROVIDER {
  protected m_designSettings: BOARD_DESIGN_SETTINGS | null;
  protected m_board: BOARD | null;
  protected m_drawingSheet: DS_PROXY_VIEW_ITEM | null;
  protected m_schematicNetlist: NETLIST | null;

  protected m_rules: DRC_RULE[] = [];
  protected m_rulesValid: boolean;
  protected m_testProviders: DRC_TEST_PROVIDER[] = [];

  protected m_errorLimits: number[] = [];
  protected m_reportAllTrackErrors: boolean;
  protected m_testFootprints: boolean;

  // constraint -> rule -> provider
  protected m_constraintMap = new Map<DRC_CONSTRAINT_T, DRC_ENGINE_CONSTRAINT[]>();

  protected m_violationHandler: DRC_VIOLATION_HANDLER | null = null;
  protected m_logReporter: Reporter | null;
  protected m_progressReporter: PROGRESS_REPORTER | null;

  // Cache for GetOwnClearance lookups to improve rendering performance.
  // Key is (UUID, layer), value is clearance in internal units.
  protected m_ownClearanceCache = new Map<string, number>();

  // Netclass name -> clearance mapping for fast lookup in EvalRules.
  // Only written during InitEngine(), read during DRC and rendering.
  protected m_netclassClearances = new Map<string, number>();

  protected m_hasExplicitClearanceRules = false;
  protected m_hasGeometryDependentRules = false;
  protected m_hasDiffPairClearanceOverrides = false;
  protected m_explicitConstraints = new Map<DRC_CONSTRAINT_T, DRC_ENGINE_CONSTRAINT[]>();

  constructor(aBoard: BOARD | null = null, aSettings: BOARD_DESIGN_SETTINGS | null = null) {
    super(pcbIUScale, 'mm');
    this.m_designSettings = aSettings;
    this.m_board = aBoard;
    this.m_drawingSheet = null;
    this.m_schematicNetlist = null;
    this.m_rulesValid = false;
    this.m_reportAllTrackErrors = false;
    this.m_testFootprints = false;
    this.m_logReporter = null;
    this.m_progressReporter = null;

    this.m_errorLimits = new Array<number>(DRCE_LAST + 1).fill(0);

    for (let ii = DRCE_FIRST; ii <= DRCE_LAST; ++ii) this.m_errorLimits[ii] = ERROR_LIMIT;
  }

  SetBoard(aBoard: BOARD | null): void {
    this.m_board = aBoard;
  }
  GetBoard(): BOARD | null {
    return this.m_board;
  }

  SetDesignSettings(aSettings: BOARD_DESIGN_SETTINGS | null): void {
    this.m_designSettings = aSettings;
  }
  GetDesignSettings(): BOARD_DESIGN_SETTINGS | null {
    return this.m_designSettings;
  }

  SetSchematicNetlist(aNetlist: NETLIST | null): void {
    this.m_schematicNetlist = aNetlist;
  }
  GetSchematicNetlist(): NETLIST | null {
    return this.m_schematicNetlist;
  }

  SetDrawingSheet(aDrawingSheet: DS_PROXY_VIEW_ITEM | null): void {
    this.m_drawingSheet = aDrawingSheet;
  }
  GetDrawingSheet(): DS_PROXY_VIEW_ITEM | null {
    return this.m_drawingSheet;
  }

  /**
   * Set an optional DRC violation handler (receives DRC_ITEMs and positions).
   */
  SetViolationHandler(aHandler: DRC_VIOLATION_HANDLER): void {
    this.m_violationHandler = aHandler;
  }

  ClearViolationHandler(): void {
    this.m_violationHandler = null;
  }

  /**
   * Set an optional reporter for user-level progress info.
   */
  SetProgressReporter(aProgRep: PROGRESS_REPORTER | null): void {
    this.m_progressReporter = aProgRep;
  }
  GetProgressReporter(): PROGRESS_REPORTER | null {
    return this.m_progressReporter;
  }

  /*
   * Set an optional reporter for rule parse/compile/run-time errors and log-level progress
   * information.
   *
   * Note: if no log reporter is installed rule parse/compile/run-time errors are returned
   * via a thrown PARSE_ERROR exception.
   */
  SetLogReporter(aReporter: Reporter | null): void {
    this.m_logReporter = aReporter;
  }

  GetLogReporter(): Reporter | null {
    return this.m_logReporter;
  }

  private addRule(rule: DRC_RULE): void {
    this.m_rules.push(rule);
  }

  /**
   * The compiled rule of that name, or null.
   *
   * `DRC_ITEM::m_violatingRule` is a pointer in the C++ and cannot be one
   * across a worker boundary, so a violation carries the rule's NAME and the
   * engine on this side hands back its own rule (see `drc_job.ts`). Two rules
   * can share a name - a `.kicad_dru` may redefine one - and the first match
   * is the one `EvalRules` would have reported, because it walks them in the
   * same order.
   */
  RuleByName(aName: string): DRC_RULE | null {
    return this.m_rules.find((rule) => rule.m_Name === aName) ?? null;
  }

  private createImplicitRule(name: string, aImplicitSource: DRC_IMPLICIT_SOURCE): DRC_RULE {
    const rule = new DRC_RULE();

    rule.m_Name = name;
    rule.SetImplicitSource(aImplicitSource);

    this.addRule(rule);

    return rule;
  }

  private loadImplicitRules(): void {
    const bds = this.m_board!.GetDesignSettings();
    let expr: string;
    let ncName: string;

    // 1) global defaults

    let rule = this.createImplicitRule(
      'board setup constraints',
      DRC_IMPLICIT_SOURCE.BOARD_SETUP_CONSTRAINT,
    );

    const widthConstraint = new DRC_CONSTRAINT(DRC_CONSTRAINT_T.TRACK_WIDTH_CONSTRAINT);
    widthConstraint.Value().SetMin(bds.m_TrackMinWidth);
    rule.AddConstraint(widthConstraint);

    const connectionConstraint = new DRC_CONSTRAINT(DRC_CONSTRAINT_T.CONNECTION_WIDTH_CONSTRAINT);
    connectionConstraint.Value().SetMin(bds.m_MinConn);
    rule.AddConstraint(connectionConstraint);

    const drillConstraint = new DRC_CONSTRAINT(DRC_CONSTRAINT_T.HOLE_SIZE_CONSTRAINT);
    drillConstraint.Value().SetMin(bds.m_MinThroughDrill);
    rule.AddConstraint(drillConstraint);

    const annulusConstraint = new DRC_CONSTRAINT(DRC_CONSTRAINT_T.ANNULAR_WIDTH_CONSTRAINT);
    annulusConstraint.Value().SetMin(bds.m_ViasMinAnnularWidth);
    rule.AddConstraint(annulusConstraint);

    const diameterConstraint = new DRC_CONSTRAINT(DRC_CONSTRAINT_T.VIA_DIAMETER_CONSTRAINT);
    diameterConstraint.Value().SetMin(bds.m_ViasMinSize);
    rule.AddConstraint(diameterConstraint);

    const holeToHoleConstraint = new DRC_CONSTRAINT(DRC_CONSTRAINT_T.HOLE_TO_HOLE_CONSTRAINT);
    holeToHoleConstraint.Value().SetMin(bds.m_HoleToHoleMin);
    rule.AddConstraint(holeToHoleConstraint);

    rule = this.createImplicitRule(
      'board setup constraints zone fill strategy',
      DRC_IMPLICIT_SOURCE.BOARD_SETUP_CONSTRAINT,
    );
    const thermalSpokeCountConstraint = new DRC_CONSTRAINT(
      DRC_CONSTRAINT_T.MIN_RESOLVED_SPOKES_CONSTRAINT,
    );
    thermalSpokeCountConstraint.Value().SetMin(bds.m_MinResolvedSpokes);
    rule.AddConstraint(thermalSpokeCountConstraint);

    rule = this.createImplicitRule(
      'board setup constraints silk',
      DRC_IMPLICIT_SOURCE.BOARD_SETUP_CONSTRAINT,
    );
    rule.m_LayerCondition = new LSET([LAYER.F_SilkS, LAYER.B_SilkS]);
    const silkClearanceConstraint = new DRC_CONSTRAINT(DRC_CONSTRAINT_T.SILK_CLEARANCE_CONSTRAINT);
    silkClearanceConstraint.Value().SetMin(bds.m_SilkClearance);
    rule.AddConstraint(silkClearanceConstraint);

    rule = this.createImplicitRule(
      'board setup constraints silk text height',
      DRC_IMPLICIT_SOURCE.BOARD_SETUP_CONSTRAINT,
    );
    rule.m_LayerCondition = new LSET([LAYER.F_SilkS, LAYER.B_SilkS]);
    const silkTextHeightConstraint = new DRC_CONSTRAINT(DRC_CONSTRAINT_T.TEXT_HEIGHT_CONSTRAINT);
    silkTextHeightConstraint.Value().SetMin(bds.m_MinSilkTextHeight);
    rule.AddConstraint(silkTextHeightConstraint);

    rule = this.createImplicitRule(
      'board setup constraints silk text thickness',
      DRC_IMPLICIT_SOURCE.BOARD_SETUP_CONSTRAINT,
    );
    rule.m_LayerCondition = new LSET([LAYER.F_SilkS, LAYER.B_SilkS]);
    const silkTextThicknessConstraint = new DRC_CONSTRAINT(
      DRC_CONSTRAINT_T.TEXT_THICKNESS_CONSTRAINT,
    );
    silkTextThicknessConstraint.Value().SetMin(bds.m_MinSilkTextThickness);
    rule.AddConstraint(silkTextThicknessConstraint);

    rule = this.createImplicitRule(
      'board setup constraints hole',
      DRC_IMPLICIT_SOURCE.BOARD_SETUP_CONSTRAINT,
    );
    const holeClearanceConstraint = new DRC_CONSTRAINT(DRC_CONSTRAINT_T.HOLE_CLEARANCE_CONSTRAINT);
    holeClearanceConstraint.Value().SetMin(bds.m_HoleClearance);
    rule.AddConstraint(holeClearanceConstraint);

    rule = this.createImplicitRule(
      'board setup constraints edge',
      DRC_IMPLICIT_SOURCE.BOARD_SETUP_CONSTRAINT,
    );
    const edgeClearanceConstraint = new DRC_CONSTRAINT(DRC_CONSTRAINT_T.EDGE_CLEARANCE_CONSTRAINT);
    edgeClearanceConstraint.Value().SetMin(bds.m_CopperEdgeClearance);
    rule.AddConstraint(edgeClearanceConstraint);

    rule = this.createImplicitRule(
      'board setup constraints courtyard',
      DRC_IMPLICIT_SOURCE.BOARD_SETUP_CONSTRAINT,
    );
    const courtyardClearanceConstraint = new DRC_CONSTRAINT(
      DRC_CONSTRAINT_T.COURTYARD_CLEARANCE_CONSTRAINT,
    );
    // holeToHoleConstraint.Value().SetMin( 0 ): the C++ writes this to its
    // local, which AddConstraint copied; the rule's copy keeps m_HoleToHoleMin.
    // Here the rule holds the object itself, so the write is not repeated.
    rule.AddConstraint(courtyardClearanceConstraint);

    // 2a) micro-via specific defaults (new DRC doesn't treat microvias in any special way)

    const uViaRule = this.createImplicitRule(
      'board setup constraints micro-via',
      DRC_IMPLICIT_SOURCE.BOARD_SETUP_CONSTRAINT,
    );

    uViaRule.m_Condition = new DRC_RULE_CONDITION("A.Via_Type == 'Micro'");

    const uViaDrillConstraint = new DRC_CONSTRAINT(DRC_CONSTRAINT_T.HOLE_SIZE_CONSTRAINT);
    uViaDrillConstraint.Value().SetMin(bds.m_MicroViasMinDrill);
    uViaRule.AddConstraint(uViaDrillConstraint);

    const uViaDiameterConstraint = new DRC_CONSTRAINT(DRC_CONSTRAINT_T.VIA_DIAMETER_CONSTRAINT);
    uViaDiameterConstraint.Value().SetMin(bds.m_MicroViasMinSize);
    uViaRule.AddConstraint(uViaDiameterConstraint);

    // 2b) barcode-specific defaults

    const barcodeRule = this.createImplicitRule(
      'barcode visual separation default',
      DRC_IMPLICIT_SOURCE.BARCODE_DEFAULTS,
    );
    const barcodeSeparationConstraint = new DRC_CONSTRAINT(
      DRC_CONSTRAINT_T.PHYSICAL_CLEARANCE_CONSTRAINT,
    );
    barcodeSeparationConstraint.Value().SetMin(this.GetIuScale().mmToIU(1.0));
    barcodeRule.AddConstraint(barcodeSeparationConstraint);
    barcodeRule.m_Condition = new DRC_RULE_CONDITION("A.Type == 'Barcode'");

    // 3) per-netclass rules

    const netclassClearanceRules: DRC_RULE[] = [];
    const netclassItemSpecificRules: DRC_RULE[] = [];

    const makeNetclassRules = (nc: NETCLASS, _isDefault: boolean): void => {
      ncName = nc.GetName();
      ncName = ncName.replaceAll("'", "\\'");

      if (nc.HasClearance()) {
        const netclassRule = new DRC_RULE();
        netclassRule.m_Name = `netclass '${nc.GetClearanceParent()!.GetHumanReadableName()}'`;
        netclassRule.SetImplicitSource(DRC_IMPLICIT_SOURCE.NET_CLASS);

        expr = `A.hasExactNetclass('${ncName}')`;
        netclassRule.m_Condition = new DRC_RULE_CONDITION(expr);
        netclassClearanceRules.push(netclassRule);

        const constraint = new DRC_CONSTRAINT(DRC_CONSTRAINT_T.CLEARANCE_CONSTRAINT);
        constraint.Value().SetMin(nc.GetClearance());
        netclassRule.AddConstraint(constraint);

        this.m_netclassClearances.set(nc.GetName(), nc.GetClearance());
      }

      if (nc.HasTrackWidth()) {
        const netclassRule = new DRC_RULE();
        netclassRule.m_Name = `netclass '${nc.GetTrackWidthParent()!.GetHumanReadableName()}'`;
        netclassRule.SetImplicitSource(DRC_IMPLICIT_SOURCE.NET_CLASS);

        expr = `A.hasExactNetclass('${ncName}')`;
        netclassRule.m_Condition = new DRC_RULE_CONDITION(expr);
        netclassClearanceRules.push(netclassRule);

        const constraint = new DRC_CONSTRAINT(DRC_CONSTRAINT_T.TRACK_WIDTH_CONSTRAINT);
        constraint.Value().SetMin(bds.m_TrackMinWidth);
        constraint.Value().SetOpt(nc.GetTrackWidth());
        netclassRule.AddConstraint(constraint);
      }

      if (nc.HasDiffPairWidth()) {
        const netclassRule = new DRC_RULE();
        netclassRule.m_Name = `netclass '${nc.GetDiffPairWidthParent()!.GetHumanReadableName()}' (diff pair)`;
        netclassRule.SetImplicitSource(DRC_IMPLICIT_SOURCE.NET_CLASS);

        expr = `A.hasExactNetclass('${ncName}') && A.inDiffPair('*')`;
        netclassRule.m_Condition = new DRC_RULE_CONDITION(expr);
        netclassItemSpecificRules.push(netclassRule);

        const constraint = new DRC_CONSTRAINT(DRC_CONSTRAINT_T.TRACK_WIDTH_CONSTRAINT);
        constraint.Value().SetMin(bds.m_TrackMinWidth);
        constraint.Value().SetOpt(nc.GetDiffPairWidth());
        netclassRule.AddConstraint(constraint);
      }

      if (nc.HasDiffPairGap()) {
        let netclassRule = new DRC_RULE();
        netclassRule.m_Name = `netclass '${nc.GetDiffPairGapParent()!.GetHumanReadableName()}' (diff pair)`;
        netclassRule.SetImplicitSource(DRC_IMPLICIT_SOURCE.NET_CLASS);

        expr = `A.hasExactNetclass('${ncName}')`;
        netclassRule.m_Condition = new DRC_RULE_CONDITION(expr);
        netclassItemSpecificRules.push(netclassRule);

        const constraint = new DRC_CONSTRAINT(DRC_CONSTRAINT_T.DIFF_PAIR_GAP_CONSTRAINT);
        constraint.Value().SetMin(bds.m_MinClearance);
        constraint.Value().SetOpt(nc.GetDiffPairGap());
        netclassRule.AddConstraint(constraint);

        // A narrower diffpair gap overrides the netclass min clearance
        if (nc.GetDiffPairGap() < nc.GetClearance()) {
          netclassRule = new DRC_RULE();
          netclassRule.m_Name = `netclass '${nc.GetDiffPairGapParent()!.GetHumanReadableName()}' (diff pair)`;
          netclassRule.SetImplicitSource(DRC_IMPLICIT_SOURCE.NET_CLASS);

          expr = `A.hasExactNetclass('${ncName}') && AB.isCoupledDiffPair()`;
          netclassRule.m_Condition = new DRC_RULE_CONDITION(expr);
          netclassItemSpecificRules.push(netclassRule);

          const min_clearanceConstraint = new DRC_CONSTRAINT(DRC_CONSTRAINT_T.CLEARANCE_CONSTRAINT);
          min_clearanceConstraint.Value().SetMin(nc.GetDiffPairGap());
          netclassRule.AddConstraint(min_clearanceConstraint);

          this.m_hasDiffPairClearanceOverrides = true;
        }
      }

      if (nc.HasViaDiameter()) {
        const netclassRule = new DRC_RULE();
        netclassRule.m_Name = `netclass '${nc.GetViaDiameterParent()!.GetHumanReadableName()}'`;
        netclassRule.SetImplicitSource(DRC_IMPLICIT_SOURCE.NET_CLASS);

        expr = `A.hasExactNetclass('${ncName}') && A.Via_Type != 'Micro'`;
        netclassRule.m_Condition = new DRC_RULE_CONDITION(expr);
        netclassItemSpecificRules.push(netclassRule);

        const constraint = new DRC_CONSTRAINT(DRC_CONSTRAINT_T.VIA_DIAMETER_CONSTRAINT);
        constraint.Value().SetMin(bds.m_ViasMinSize);
        constraint.Value().SetOpt(nc.GetViaDiameter());
        netclassRule.AddConstraint(constraint);
      }

      if (nc.HasViaDrill()) {
        const netclassRule = new DRC_RULE();
        netclassRule.m_Name = `netclass '${nc.GetViaDrillParent()!.GetHumanReadableName()}'`;
        netclassRule.SetImplicitSource(DRC_IMPLICIT_SOURCE.NET_CLASS);

        expr = `A.hasExactNetclass('${ncName}') && A.Via_Type != 'Micro'`;
        netclassRule.m_Condition = new DRC_RULE_CONDITION(expr);
        netclassItemSpecificRules.push(netclassRule);

        const constraint = new DRC_CONSTRAINT(DRC_CONSTRAINT_T.HOLE_SIZE_CONSTRAINT);
        constraint.Value().SetMin(bds.m_MinThroughDrill);
        constraint.Value().SetOpt(nc.GetViaDrill());
        netclassRule.AddConstraint(constraint);
      }

      if (nc.HasuViaDiameter()) {
        const netclassRule = new DRC_RULE();
        netclassRule.m_Name = `netclass '${nc.GetuViaDiameterParent()!.GetHumanReadableName()}' (uvia)`;
        netclassRule.SetImplicitSource(DRC_IMPLICIT_SOURCE.NET_CLASS);

        expr = `A.hasExactNetclass('${ncName}') && A.Via_Type == 'Micro'`;
        netclassRule.m_Condition = new DRC_RULE_CONDITION(expr);
        netclassItemSpecificRules.push(netclassRule);

        const constraint = new DRC_CONSTRAINT(DRC_CONSTRAINT_T.VIA_DIAMETER_CONSTRAINT);
        constraint.Value().SetMin(bds.m_MicroViasMinSize);
        constraint.Value().SetMin(nc.GetuViaDiameter());
        netclassRule.AddConstraint(constraint);
      }

      if (nc.HasuViaDrill()) {
        const netclassRule = new DRC_RULE();
        netclassRule.m_Name = `netclass '${nc.GetuViaDrillParent()!.GetHumanReadableName()}' (uvia)`;
        netclassRule.SetImplicitSource(DRC_IMPLICIT_SOURCE.NET_CLASS);

        expr = `A.hasExactNetclass('${ncName}') && A.Via_Type == 'Micro'`;
        netclassRule.m_Condition = new DRC_RULE_CONDITION(expr);
        netclassItemSpecificRules.push(netclassRule);

        const constraint = new DRC_CONSTRAINT(DRC_CONSTRAINT_T.HOLE_SIZE_CONSTRAINT);
        constraint.Value().SetMin(bds.m_MicroViasMinDrill);
        constraint.Value().SetOpt(nc.GetuViaDrill());
        netclassRule.AddConstraint(constraint);
      }
    };

    // m_board->SynchronizeTuningProfileProperties();     -- LENGTH_DELAY_CALCULATION's tuning
    //                                                       profile sync is not ported yet
    this.m_board!.SynchronizeNetsAndNetClasses(false);
    makeNetclassRules(bds.m_NetSettings.GetDefaultNetclass(), true);

    for (const [, netclass] of bds.m_NetSettings.GetNetclasses())
      makeNetclassRules(netclass, false);

    for (const [, netclass] of bds.m_NetSettings.GetCompositeNetclasses())
      makeNetclassRules(netclass, false);

    // The netclass clearance rules have to be sorted by min clearance so the right one fires
    // if 'A' and 'B' belong to two different netclasses.
    //
    // The item-specific netclass rules are all unary, so there's no 'A' vs 'B' issue.

    netclassClearanceRules.sort(
      (lhs, rhs) => lhs.m_Constraints[0]!.m_Value.Min() - rhs.m_Constraints[0]!.m_Value.Min(),
    );

    for (const ncRule of netclassClearanceRules) this.addRule(ncRule);

    for (const ncRule of netclassItemSpecificRules) this.addRule(ncRule);

    // 4) tuning profile rules
    //
    // `if( PROJECT* project = m_board->GetProject() )` : the project file's
    // TUNING_PROFILES are not on the board here (PROJECT is not ported), so
    // this block adds nothing, as it adds nothing for a board with no project.

    // 5) keepout area rules
    const addKeepoutZoneRule = (zone: ZONE, parentFP: FOOTPRINT | null): void => {
      const name = zone.GetZoneName();

      if (name.length === 0) {
        if (parentFP) {
          rule = this.createImplicitRule(
            `keepout area of ${DescribeRef(parentFP.GetReference())}`,
            DRC_IMPLICIT_SOURCE.KEEPOUT,
          );
        } else {
          rule = this.createImplicitRule('keepout area', DRC_IMPLICIT_SOURCE.KEEPOUT);
        }
      } else {
        if (parentFP) {
          rule = this.createImplicitRule(
            `keepout area '${name}' of ${DescribeRef(parentFP.GetReference())}`,
            DRC_IMPLICIT_SOURCE.KEEPOUT,
          );
        } else {
          rule = this.createImplicitRule(`keepout area '${name}'`, DRC_IMPLICIT_SOURCE.KEEPOUT);
        }
      }

      rule.m_ImplicitItemId = zone.m_Uuid;
      rule.m_ImplicitItem = zone;

      rule.m_Condition = new DRC_RULE_CONDITION(`A.intersectsArea('${zone.m_Uuid}')`);

      rule.m_LayerCondition = zone.GetLayerSet();

      let disallowFlags = 0;

      if (zone.GetDoNotAllowTracks()) disallowFlags |= DRC_DISALLOW_T.DRC_DISALLOW_TRACKS;

      if (zone.GetDoNotAllowVias()) disallowFlags |= DRC_DISALLOW_VIAS;

      if (zone.GetDoNotAllowPads()) disallowFlags |= DRC_DISALLOW_T.DRC_DISALLOW_PADS;

      if (zone.GetDoNotAllowZoneFills()) disallowFlags |= DRC_DISALLOW_T.DRC_DISALLOW_ZONES;

      if (zone.GetDoNotAllowFootprints()) disallowFlags |= DRC_DISALLOW_T.DRC_DISALLOW_FOOTPRINTS;

      const disallowConstraint = new DRC_CONSTRAINT(DRC_CONSTRAINT_T.DISALLOW_CONSTRAINT);
      disallowConstraint.m_DisallowFlags = disallowFlags;
      rule.AddConstraint(disallowConstraint);
    };

    for (const zone of this.m_board!.Zones()) {
      if (isKeepoutZone(zone, true)) addKeepoutZoneRule(zone, null);
    }

    for (const footprint of this.m_board!.Footprints()) {
      for (const zone of footprint.Zones()) {
        if (isKeepoutZone(zone, true)) addKeepoutZoneRule(zone, footprint);
      }
    }
  }

  /**
   * Load and parse a rule set from an sexpr text.
   *
   * `loadRules( const wxFileName& aPath )` opens the project's `.kicad_dru`;
   * here the text arrives already read, with its path for the messages, and
   * `null` is a file that does not exist.
   *
   * @throws PARSE_ERROR
   */
  private loadRules(aRulesText: string | null, aPath: string): void {
    if (this.m_board && aRulesText !== null) {
      const rules: DRC_RULE[] = [];

      {
        let rulesText = '';

        const resolver = (token: OutStr): boolean => {
          return this.m_board!.ResolveTextVar(token, 0);
        };

        for (const line of aRulesText.split('\n')) {
          let str = line;
          str = this.m_board.ConvertCrossReferencesToKIIDs(str);
          str = ExpandTextVars(str, resolver);

          rulesText += `${str}\n`;
        }

        const parser = new DRC_RULES_PARSER(rulesText, aPath);
        parser.Parse(rules, this.m_logReporter);
      }

      // Copy the rules into the member variable afterwards so that if Parse() throws then
      // the possibly malformed rules won't contaminate the current ruleset.

      for (const rule of rules) this.m_rules.push(rule);
    }
  }

  private compileRules(): void {
    if (this.m_logReporter) this.m_logReporter.report('Compiling Rules');

    const error_semaphore = new ReporterSemaphore();

    for (const rule of this.m_rules) {
      let condition: DRC_RULE_CONDITION | null = null;

      if (rule.m_Condition && rule.m_Condition.GetExpression().length > 0) {
        condition = rule.m_Condition;
        condition.Compile(error_semaphore);
      }

      if (error_semaphore.HasMessageOfSeverity(RPT_SEVERITY_ERROR))
        throw new PARSE_ERROR('Parse error', rule.m_Name, rule.m_Condition!.GetExpression(), 0, 0);

      for (const constraint of rule.m_Constraints) {
        let ruleVec = this.m_constraintMap.get(constraint.m_Type);

        if (!ruleVec) {
          ruleVec = [];
          this.m_constraintMap.set(constraint.m_Type, ruleVec);
        }

        const engineConstraint: DRC_ENGINE_CONSTRAINT = {
          layerTest: rule.m_LayerCondition,
          condition,
          constraint,
          parentRule: rule,
        };

        ruleVec.push(engineConstraint);
      }
    }

    this.m_hasExplicitClearanceRules = false;
    this.m_hasGeometryDependentRules = false;
    this.m_explicitConstraints.clear();

    for (const [constraintType, ruleList] of this.m_constraintMap) {
      for (const c of ruleList) {
        if (c.parentRule && !c.parentRule.IsImplicit()) {
          let list = this.m_explicitConstraints.get(constraintType);

          if (!list) {
            list = [];
            this.m_explicitConstraints.set(constraintType, list);
          }

          list.push(c);

          if (constraintType === DRC_CONSTRAINT_T.CLEARANCE_CONSTRAINT)
            this.m_hasExplicitClearanceRules = true;

          if (
            !this.m_hasGeometryDependentRules &&
            c.condition &&
            c.condition.HasGeometryDependentFunctions()
          ) {
            this.m_hasGeometryDependentRules = true;
          }
        }
      }
    }
  }

  /** `InitEngine( const std::shared_ptr<DRC_RULE>& rule )`: a single rule, for the show-matches providers. */
  InitEngineWithRule(rule: DRC_RULE): void {
    this.m_testProviders = DRC_SHOWMATCHES_PROVIDER_REGISTRY.Instance().GetShowMatchesProviders();

    for (const provider of this.m_testProviders) {
      if (this.m_logReporter)
        this.m_logReporter.report(`Create DRC provider: '${provider.GetName()}'`);

      provider.SetDRCEngine(this);
    }

    // Existing markers may hold raw pointers to DRC_RULEs we're about to destroy.
    // Null them out so GetSeverity() falls back to the board design settings.
    if (this.m_board) {
      for (const marker of this.m_board.Markers()) {
        const drcItem = marker.GetRCItem() as DRC_ITEM | null;
        drcItem?.SetViolatingRule(null);
      }
    }

    this.m_rules = [];
    this.m_rulesValid = false;

    this.m_constraintMap.clear();

    this.m_board!.IncrementTimeStamp(); // Clear board-level caches

    this.m_rules.push(rule);
    this.compileRules();

    for (let ii = DRCE_FIRST; ii < DRCE_LAST; ++ii) this.m_errorLimits[ii] = ERROR_LIMIT;

    this.m_rulesValid = true;
  }

  /**
   * Initialize the DRC engine.
   *
   * `InitEngine( const wxFileName& aRulePath )`: the rules file is passed as
   * its text (null when there is none) and its path for messages.
   *
   * @throws PARSE_ERROR if the rules file contains errors
   */
  InitEngine(aRulesText: string | null, aRulePath = ''): void {
    this.m_testProviders = DRC_TEST_PROVIDER_REGISTRY.Instance().GetTestProviders();

    for (const provider of this.m_testProviders) {
      if (this.m_logReporter)
        this.m_logReporter.report(`Create DRC provider: '${provider.GetName()}'`);

      provider.SetDRCEngine(this);
    }

    // Existing markers may hold raw pointers to DRC_RULEs we're about to destroy.
    // Null them out so GetSeverity() falls back to the board design settings.
    if (this.m_board) {
      for (const marker of this.m_board.Markers()) {
        const drcItem = marker.GetRCItem() as DRC_ITEM | null;
        drcItem?.SetViolatingRule(null);
      }
    }

    this.m_rules = [];
    this.m_rulesValid = false;

    this.m_constraintMap.clear();
    this.m_ownClearanceCache.clear();
    this.m_netclassClearances.clear();

    this.m_hasExplicitClearanceRules = false;
    this.m_hasDiffPairClearanceOverrides = false;
    this.m_explicitConstraints.clear();

    this.m_board!.IncrementTimeStamp(); // Clear board-level caches

    try {
      // attempt to load full set of rules (implicit + user rules)
      this.loadImplicitRules();
      this.loadRules(aRulesText, aRulePath);
      this.compileRules();
    } catch (original_parse_error) {
      if (!(original_parse_error instanceof PARSE_ERROR)) throw original_parse_error;

      this.m_rules = [];

      try {
        // try again with just our implicit rules
        this.loadImplicitRules();
        this.compileRules();
      } catch (e) {
        if (!(e instanceof PARSE_ERROR)) throw e;

        console.assert(false, 'Compiling implicit rules failed.');
      }

      throw original_parse_error;
    }

    for (let ii = DRCE_FIRST; ii <= DRCE_LAST; ++ii) this.m_errorLimits[ii] = ERROR_LIMIT;

    this.m_rulesValid = true;
  }

  /**
   * Run the DRC tests.
   */
  RunTests(
    aUnits: EdaUnits,
    aReportAllTrackErrors: boolean,
    aTestFootprints: boolean,
    _aCommit: unknown = null,
  ): void {
    this.SetUserUnits(aUnits);

    this.m_reportAllTrackErrors = aReportAllTrackErrors;
    this.m_testFootprints = aTestFootprints;

    for (let ii = DRCE_FIRST; ii <= DRCE_LAST; ++ii) {
      if (this.m_designSettings!.Ignore(ii)) this.m_errorLimits[ii] = 0;
      else if (ii === PCB_DRC_CODE.DRCE_CLEARANCE || ii === PCB_DRC_CODE.DRCE_UNCONNECTED_ITEMS)
        this.m_errorLimits[ii] = EXTENDED_ERROR_LIMIT;
      else this.m_errorLimits[ii] = ERROR_LIMIT;
    }

    DRC_TEST_PROVIDER.Init();

    this.m_board!.IncrementTimeStamp(); // Invalidate all caches...

    const cacheGenerator = new DRC_CACHE_GENERATOR();
    cacheGenerator.SetDRCEngine(this);

    if (!cacheGenerator.Run())
      // ... and regenerate them.
      return;

    // Recompute component classes
    this.m_board!.GetComponentClassManager().ForceComponentClassRecalculation();

    const timestamp = this.m_board!.GetTimeStamp();

    for (const provider of this.m_testProviders) {
      if (this.m_logReporter)
        this.m_logReporter.report(`Run DRC provider: '${provider.GetName()}'`);

      if (!provider.RunTests(aUnits)) break;
    }

    // DRC tests are multi-threaded; anything that causes us to attempt to re-generate the
    // caches while DRC is running is problematic.
    console.assert(timestamp === this.m_board!.GetTimeStamp());
  }

  EvalZoneConnection(
    a: BOARD_ITEM | null,
    b: BOARD_ITEM | null,
    aLayer: PCB_LAYER_ID,
    aReporter: Reporter | null = null,
  ): DRC_CONSTRAINT {
    const REPORT = (s: string): void => {
      if (aReporter) aReporter.report(s);
    };

    const constraint = this.EvalRules(
      DRC_CONSTRAINT_T.ZONE_CONNECTION_CONSTRAINT,
      a,
      b,
      aLayer,
      aReporter,
    );

    REPORT('');
    REPORT(`Resolved zone connection type: ${PrintZoneConnection(constraint.m_ZoneConnection)}.`);

    if (constraint.m_ZoneConnection === ZONE_CONNECTION.THT_THERMAL) {
      let pad: PAD | null = null;

      if (a!.Type() === KICAD_T.PCB_PAD_T) pad = a as PAD;
      else if (b!.Type() === KICAD_T.PCB_PAD_T) pad = b as PAD;

      if (pad && pad.GetAttribute() === PAD_ATTRIB.PTH) {
        constraint.m_ZoneConnection = ZONE_CONNECTION.THERMAL;
      } else {
        REPORT(
          `Pad is not a through hole pad; connection will be: ${PrintZoneConnection(ZONE_CONNECTION.FULL)}.`,
        );
        constraint.m_ZoneConnection = ZONE_CONNECTION.FULL;
      }
    }

    return constraint;
  }

  EvalRules(
    aConstraintType: DRC_CONSTRAINT_T,
    aIn: BOARD_ITEM | null,
    bIn: BOARD_ITEM | null,
    aLayer: PCB_LAYER_ID,
    aReporter: Reporter | null = null,
  ): DRC_CONSTRAINT {
    /*
     * NOTE: all string manipulation MUST BE KEPT INSIDE the REPORT macro.  It absolutely
     * kills performance when running bulk DRC tests (where aReporter is nullptr).
     */
    const REPORT = (s: () => string): void => {
      if (aReporter) aReporter.report(s());
    };

    let a = aIn;
    let b = bIn;

    const ac = asConnected(a);
    const bc = asConnected(b);

    const a_is_non_copper = a !== null && (!a.IsOnCopperLayer() || isKeepoutZone(a, false));
    const b_is_non_copper = b !== null && (!b.IsOnCopperLayer() || isKeepoutZone(b, false));

    let pad: PAD | null = null;
    let zone: ZONE | null = null;
    let parentFootprint: FOOTPRINT | null = null;

    if (
      aConstraintType === DRC_CONSTRAINT_T.ZONE_CONNECTION_CONSTRAINT ||
      aConstraintType === DRC_CONSTRAINT_T.THERMAL_RELIEF_GAP_CONSTRAINT ||
      aConstraintType === DRC_CONSTRAINT_T.THERMAL_SPOKE_WIDTH_CONSTRAINT ||
      aConstraintType === DRC_CONSTRAINT_T.SOLDER_MASK_EXPANSION_CONSTRAINT ||
      aConstraintType === DRC_CONSTRAINT_T.SOLDER_PASTE_ABS_MARGIN_CONSTRAINT ||
      aConstraintType === DRC_CONSTRAINT_T.SOLDER_PASTE_REL_MARGIN_CONSTRAINT
    ) {
      if (a && a.Type() === KICAD_T.PCB_PAD_T) pad = a as PAD;
      else if (a && a.Type() === KICAD_T.PCB_ZONE_T) zone = a as ZONE;

      if (b && b.Type() === KICAD_T.PCB_PAD_T) pad = b as PAD;
      else if (b && b.Type() === KICAD_T.PCB_ZONE_T) zone = b as ZONE;

      if (pad) parentFootprint = pad.GetParentFootprint();
    }

    const constraint = new DRC_CONSTRAINT();
    constraint.m_Type = aConstraintType;

    const applyConstraint = (c: DRC_ENGINE_CONSTRAINT): void => {
      if (c.constraint.m_Value.HasMin()) {
        if (c.parentRule && c.parentRule.IsImplicit()) constraint.m_ImplicitMin = true;
        else constraint.m_ImplicitMin = false;

        constraint.m_Value.SetMin(c.constraint.m_Value.Min());
      }

      if (c.constraint.m_Value.HasOpt()) constraint.m_Value.SetOpt(c.constraint.m_Value.Opt());

      if (c.constraint.m_Value.HasMax()) constraint.m_Value.SetMax(c.constraint.m_Value.Max());

      switch (c.constraint.m_Type) {
        case DRC_CONSTRAINT_T.CLEARANCE_CONSTRAINT:
        case DRC_CONSTRAINT_T.COURTYARD_CLEARANCE_CONSTRAINT:
        case DRC_CONSTRAINT_T.SILK_CLEARANCE_CONSTRAINT:
        case DRC_CONSTRAINT_T.HOLE_CLEARANCE_CONSTRAINT:
        case DRC_CONSTRAINT_T.EDGE_CLEARANCE_CONSTRAINT:
        case DRC_CONSTRAINT_T.PHYSICAL_CLEARANCE_CONSTRAINT:
        case DRC_CONSTRAINT_T.PHYSICAL_HOLE_CLEARANCE_CONSTRAINT:
          if (constraint.m_Value.Min() > MAXIMUM_CLEARANCE)
            constraint.m_Value.SetMin(MAXIMUM_CLEARANCE);

          break;

        default:
          break;
      }

      // While the expectation would be to OR the disallow flags, we've already
      // masked them down to aItem's type -- so we're really only looking for a
      // boolean here.
      constraint.m_DisallowFlags = c.constraint.m_DisallowFlags;

      constraint.m_ZoneConnection = c.constraint.m_ZoneConnection;

      constraint.SetParentRule(c.constraint.GetParentRule());

      constraint.SetOptionsFromOther(c.constraint);
    };

    const footprints: [FOOTPRINT | null, FOOTPRINT | null] = [
      a ? a.GetParentFootprint() : null,
      b ? b.GetParentFootprint() : null,
    ];

    // Handle Footprint net ties, which will zero out the clearance for footprint objects
    if (
      aConstraintType === DRC_CONSTRAINT_T.CLEARANCE_CONSTRAINT && // Only zero clearance, other constraints still apply
      (!ac !== !bc || // Only apply to cases where we are comparing a connected item to a non-connected item
        // and not both connected.  Connected items of different nets still need to be checked
        // for their standard clearance value
        (footprints[0] === footprints[1] && // Unless both items are in the same footprint
          footprints[0] !== null)) && // And that footprint exists
      !a_is_non_copper && // Also, both elements need to be on copper layers
      !b_is_non_copper
    ) {
      const child_items: [BOARD_ITEM | null, BOARD_ITEM | null] = [a, b];

      // These are the items being compared against, so the order is reversed
      const alt_items: [BOARD_CONNECTED_ITEM | null, BOARD_CONNECTED_ITEM | null] = [bc, ac];

      for (let ii = 0; ii < 2; ++ii) {
        // We need both a footprint item and a connected item to check for a net tie
        if (!footprints[ii] || !alt_items[ii]) continue;

        const netcodes = footprints[ii]!.GetNetTieCache(child_items[ii]!);

        if (netcodes.has(alt_items[ii]!.GetNetCode())) {
          REPORT(() => '');
          REPORT(
            () =>
              `Net tie on ${EscapeHTML(footprints[ii]!.GetItemDescription(this, true))}; clearance: 0.`,
          );

          constraint.SetName('net tie');
          constraint.m_Value.SetMin(0);
          return constraint;
        }
      }
    }

    // Local overrides take precedence over everything *except* board min clearance
    if (
      aConstraintType === DRC_CONSTRAINT_T.CLEARANCE_CONSTRAINT ||
      aConstraintType === DRC_CONSTRAINT_T.HOLE_CLEARANCE_CONSTRAINT
    ) {
      let override_val = 0;
      let overrideA: number | undefined;
      let overrideB: number | undefined;

      if (ac && !b_is_non_copper) overrideA = ac.GetClearanceOverrides(null);

      if (bc && !a_is_non_copper) overrideB = bc.GetClearanceOverrides(null);

      if (overrideA !== undefined || overrideB !== undefined) {
        const msg: OutStr = { value: '' };

        if (overrideA !== undefined) {
          REPORT(() => '');
          REPORT(
            () =>
              `Local override on ${EscapeHTML(a!.GetItemDescription(this, true))}; clearance: ${this.MessageTextFromValue(overrideA!)}.`,
          );

          override_val = ac!.GetClearanceOverrides(msg)!;
        }

        if (overrideB !== undefined) {
          REPORT(() => '');
          REPORT(
            () =>
              `Local override on ${EscapeHTML(b!.GetItemDescription(this, true))}; clearance: ${this.MessageTextFromValue(overrideB!)}.`,
          );

          if (overrideB > override_val) override_val = bc!.GetClearanceOverrides(msg)!;
        }

        if (override_val) {
          if (aConstraintType === DRC_CONSTRAINT_T.CLEARANCE_CONSTRAINT) {
            if (override_val < this.m_designSettings!.m_MinClearance) {
              override_val = this.m_designSettings!.m_MinClearance;
              msg.value = 'board minimum';

              REPORT(() => '');
              REPORT(() => `Board minimum clearance: ${this.MessageTextFromValue(override_val)}.`);
            }
          } else {
            if (override_val < this.m_designSettings!.m_HoleClearance) {
              override_val = this.m_designSettings!.m_HoleClearance;
              msg.value = 'board minimum hole';

              REPORT(() => '');
              REPORT(
                () => `Board minimum hole clearance: ${this.MessageTextFromValue(override_val)}.`,
              );
            }
          }

          constraint.SetName(msg.value);
          constraint.m_Value.SetMin(override_val);
          return constraint;
        }
      }
    } else if (aConstraintType === DRC_CONSTRAINT_T.ZONE_CONNECTION_CONSTRAINT) {
      if (pad && pad.GetLocalZoneConnection() !== ZONE_CONNECTION.INHERITED) {
        const msg: OutStr = { value: '' };
        const override = pad.GetZoneConnectionOverrides(msg);

        REPORT(() => '');
        REPORT(
          () =>
            `Local override on ${EscapeHTML(pad!.GetItemDescription(this, true))}; zone connection: ${PrintZoneConnection(override)}.`,
        );

        constraint.SetName(msg.value);
        constraint.m_ZoneConnection = override;
        return constraint;
      }
    } else if (aConstraintType === DRC_CONSTRAINT_T.THERMAL_RELIEF_GAP_CONSTRAINT) {
      if (pad && pad.GetLocalThermalGapOverride(null) > 0) {
        const msg: OutStr = { value: '' };
        const gap_override = pad.GetLocalThermalGapOverride(msg);

        REPORT(() => '');
        REPORT(
          () =>
            `Local override on ${EscapeHTML(pad!.GetItemDescription(this, true))}; thermal relief gap: ${this.MessageTextFromValue(gap_override)}.`,
        );

        constraint.SetName(msg.value);
        constraint.m_Value.SetMin(gap_override);
        return constraint;
      }
    } else if (aConstraintType === DRC_CONSTRAINT_T.THERMAL_SPOKE_WIDTH_CONSTRAINT) {
      if (pad && pad.GetLocalSpokeWidthOverride(null) > 0) {
        const msg: OutStr = { value: '' };
        let spoke_override = pad.GetLocalSpokeWidthOverride(msg);

        REPORT(() => '');
        REPORT(
          () =>
            `Local override on ${EscapeHTML(pad!.GetItemDescription(this, true))}; thermal spoke width: ${this.MessageTextFromValue(spoke_override)}.`,
        );

        if (zone && zone.GetMinThickness() > spoke_override) {
          spoke_override = zone.GetMinThickness();

          REPORT(() => '');
          REPORT(
            () =>
              `${EscapeHTML(zone!.GetItemDescription(this, true))} min thickness: ${this.MessageTextFromValue(spoke_override)}.`,
          );
        }

        constraint.SetName(msg.value);
        constraint.m_Value.SetMin(spoke_override);
        return constraint;
      }
    } else if (aConstraintType === DRC_CONSTRAINT_T.SOLDER_MASK_EXPANSION_CONSTRAINT) {
      let override: number | undefined;
      let overrideItem: BOARD_ITEM | null = a;

      if (pad) override = pad.GetLocalSolderMaskMargin();
      else if (a!.Type() === KICAD_T.PCB_SHAPE_T)
        override = (a as PCB_SHAPE).GetLocalSolderMaskMargin();
      else {
        const track = asTrack(a!);

        if (track) override = track.GetLocalSolderMaskMargin();
      }

      if (override === undefined && pad) {
        const overrideFootprint = pad.GetParentFootprint();

        if (overrideFootprint) {
          override = overrideFootprint.GetLocalSolderMaskMargin();
          overrideItem = overrideFootprint;
        }
      }

      if (override !== undefined) {
        REPORT(() => '');
        REPORT(
          () =>
            `Local override on ${EscapeHTML(overrideItem!.GetItemDescription(this, true))}; solder mask expansion: ${this.MessageTextFromValue(override!)}.`,
        );

        constraint.m_Value.SetOpt(override);
        return constraint;
      }
    } else if (aConstraintType === DRC_CONSTRAINT_T.SOLDER_PASTE_ABS_MARGIN_CONSTRAINT) {
      let override: number | undefined;
      let overrideItem: BOARD_ITEM | null = a;

      if (pad) override = pad.GetLocalSolderPasteMargin();

      if (override === undefined && pad) {
        const overrideFootprint = pad.GetParentFootprint();

        if (overrideFootprint) {
          override = overrideFootprint.GetLocalSolderPasteMargin();
          overrideItem = overrideFootprint;
        }
      }

      if (override !== undefined) {
        REPORT(() => '');
        REPORT(
          () =>
            `Local override on ${EscapeHTML(overrideItem!.GetItemDescription(this, true))}; solder paste absolute clearance: ${this.MessageTextFromValue(override!)}.`,
        );

        constraint.m_Value.SetOpt(override ?? 0);
        return constraint;
      }
    } else if (aConstraintType === DRC_CONSTRAINT_T.SOLDER_PASTE_REL_MARGIN_CONSTRAINT) {
      let overrideRatio: number | undefined;
      let overrideItem: BOARD_ITEM | null = a;

      if (pad) overrideRatio = pad.GetLocalSolderPasteMarginRatio();

      if (overrideRatio === undefined && pad) {
        const overrideFootprint = pad.GetParentFootprint();

        if (overrideFootprint) {
          overrideRatio = overrideFootprint.GetLocalSolderPasteMarginRatio();
          overrideItem = overrideFootprint;
        }
      }

      if (overrideRatio !== undefined) {
        REPORT(() => '');
        REPORT(
          () =>
            `Local override on ${EscapeHTML(overrideItem!.GetItemDescription(this, true))}; solder paste relative clearance: ${this.MessageTextFromValue(overrideRatio! * 100.0)}.`,
        );

        constraint.m_Value.SetOpt(KiROUND((overrideRatio ?? 0) * 1000));
        return constraint;
      }
    }

    const testAssertion = (c: DRC_ENGINE_CONSTRAINT): void => {
      REPORT(() => `Checking assertion '${EscapeHTML(c.constraint.m_Test!.GetExpression())}'.`);

      if (c.constraint.m_Test!.EvaluateFor(a, b, c.constraint.m_Type, aLayer, aReporter))
        REPORT(() => 'Assertion passed.');
      else REPORT(() => EscapeHTML('--> Assertion failed. <--'));
    };

    const processConstraint = (c: DRC_ENGINE_CONSTRAINT): void => {
      const implicit = c.parentRule !== null && c.parentRule.IsImplicit();

      REPORT(() => '');

      switch (c.constraint.m_Type) {
        case DRC_CONSTRAINT_T.CLEARANCE_CONSTRAINT:
        case DRC_CONSTRAINT_T.COURTYARD_CLEARANCE_CONSTRAINT:
        case DRC_CONSTRAINT_T.SILK_CLEARANCE_CONSTRAINT:
        case DRC_CONSTRAINT_T.HOLE_CLEARANCE_CONSTRAINT:
        case DRC_CONSTRAINT_T.EDGE_CLEARANCE_CONSTRAINT:
        case DRC_CONSTRAINT_T.PHYSICAL_CLEARANCE_CONSTRAINT:
        case DRC_CONSTRAINT_T.PHYSICAL_HOLE_CLEARANCE_CONSTRAINT:
          REPORT(
            () =>
              `Checking ${EscapeHTML(c.constraint.GetName())} clearance: ${this.MessageTextFromValue(c.constraint.m_Value.Min())}.`,
          );
          break;
        case DRC_CONSTRAINT_T.CREEPAGE_CONSTRAINT:
          REPORT(
            () =>
              `Checking ${EscapeHTML(c.constraint.GetName())} creepage: ${this.MessageTextFromValue(c.constraint.m_Value.Min())}.`,
          );
          break;
        case DRC_CONSTRAINT_T.MAX_UNCOUPLED_CONSTRAINT:
          REPORT(
            () =>
              `Checking ${EscapeHTML(c.constraint.GetName())} max uncoupled length: ${this.MessageTextFromValue(c.constraint.m_Value.Max())}.`,
          );
          break;

        case DRC_CONSTRAINT_T.SKEW_CONSTRAINT:
          REPORT(
            () =>
              `Checking ${EscapeHTML(c.constraint.GetName())} max skew: ${this.MessageTextFromValue(c.constraint.m_Value.Max())}.`,
          );
          break;

        case DRC_CONSTRAINT_T.THERMAL_RELIEF_GAP_CONSTRAINT:
          REPORT(
            () =>
              `Checking ${EscapeHTML(c.constraint.GetName())} gap: ${this.MessageTextFromValue(c.constraint.m_Value.Min())}.`,
          );
          break;

        case DRC_CONSTRAINT_T.THERMAL_SPOKE_WIDTH_CONSTRAINT:
          REPORT(
            () =>
              `Checking ${EscapeHTML(c.constraint.GetName())} thermal spoke width: ${this.MessageTextFromValue(c.constraint.m_Value.Opt())}.`,
          );
          break;

        case DRC_CONSTRAINT_T.SOLDER_MASK_EXPANSION_CONSTRAINT:
          REPORT(
            () =>
              `Checking ${EscapeHTML(c.constraint.GetName())} solder mask expansion: ${this.MessageTextFromValue(c.constraint.m_Value.Opt())}.`,
          );
          break;

        case DRC_CONSTRAINT_T.SOLDER_PASTE_ABS_MARGIN_CONSTRAINT:
          REPORT(
            () =>
              `Checking ${EscapeHTML(c.constraint.GetName())} solder paste absolute clearance: ${this.MessageTextFromValue(c.constraint.m_Value.Opt())}.`,
          );
          break;

        case DRC_CONSTRAINT_T.SOLDER_PASTE_REL_MARGIN_CONSTRAINT:
          REPORT(
            () =>
              `Checking ${EscapeHTML(c.constraint.GetName())} solder paste relative clearance: ${this.MessageTextFromValue(c.constraint.m_Value.Opt())}.`,
          );
          break;

        case DRC_CONSTRAINT_T.MIN_RESOLVED_SPOKES_CONSTRAINT:
          REPORT(
            () =>
              `Checking ${EscapeHTML(c.constraint.GetName())} min spoke count: ${this.MessageTextFromUnscaledValue(c.constraint.m_Value.Min())}.`,
          );
          break;

        case DRC_CONSTRAINT_T.ZONE_CONNECTION_CONSTRAINT:
          REPORT(
            () =>
              `Checking ${EscapeHTML(c.constraint.GetName())} zone connection: ${PrintZoneConnection(c.constraint.m_ZoneConnection)}.`,
          );
          break;

        case DRC_CONSTRAINT_T.TRACK_WIDTH_CONSTRAINT:
        case DRC_CONSTRAINT_T.ANNULAR_WIDTH_CONSTRAINT:
        case DRC_CONSTRAINT_T.VIA_DIAMETER_CONSTRAINT:
        case DRC_CONSTRAINT_T.HOLE_SIZE_CONSTRAINT:
        case DRC_CONSTRAINT_T.TEXT_HEIGHT_CONSTRAINT:
        case DRC_CONSTRAINT_T.TEXT_THICKNESS_CONSTRAINT:
        case DRC_CONSTRAINT_T.DIFF_PAIR_GAP_CONSTRAINT:
        case DRC_CONSTRAINT_T.LENGTH_CONSTRAINT:
        case DRC_CONSTRAINT_T.CONNECTION_WIDTH_CONSTRAINT:
        case DRC_CONSTRAINT_T.HOLE_TO_HOLE_CONSTRAINT: {
          if (implicit) {
            switch (c.constraint.m_Type) {
              case DRC_CONSTRAINT_T.TRACK_WIDTH_CONSTRAINT:
                if (c.constraint.m_Value.HasOpt()) {
                  REPORT(
                    () =>
                      `Checking ${EscapeHTML(c.constraint.GetName())} track width: opt ${this.MessageTextFromValue(c.constraint.m_Value.Opt())}.`,
                  );
                } else if (c.constraint.m_Value.HasMin()) {
                  REPORT(
                    () =>
                      `Checking ${EscapeHTML(c.constraint.GetName())} track width: min ${this.MessageTextFromValue(c.constraint.m_Value.Min())}.`,
                  );
                }

                break;

              case DRC_CONSTRAINT_T.ANNULAR_WIDTH_CONSTRAINT:
                REPORT(
                  () =>
                    `Checking ${EscapeHTML(c.constraint.GetName())} annular width: min ${this.MessageTextFromValue(c.constraint.m_Value.Opt())}.`,
                );
                break;

              case DRC_CONSTRAINT_T.VIA_DIAMETER_CONSTRAINT:
                if (c.constraint.m_Value.HasOpt()) {
                  REPORT(
                    () =>
                      `Checking ${EscapeHTML(c.constraint.GetName())} via diameter: opt ${this.MessageTextFromValue(c.constraint.m_Value.Opt())}.`,
                  );
                } else if (c.constraint.m_Value.HasMin()) {
                  REPORT(
                    () =>
                      `Checking ${EscapeHTML(c.constraint.GetName())} via diameter: min ${this.MessageTextFromValue(c.constraint.m_Value.Min())}.`,
                  );
                }
                break;

              case DRC_CONSTRAINT_T.HOLE_SIZE_CONSTRAINT:
                if (c.constraint.m_Value.HasOpt()) {
                  REPORT(
                    () =>
                      `Checking ${EscapeHTML(c.constraint.GetName())} hole size: opt ${this.MessageTextFromValue(c.constraint.m_Value.Opt())}.`,
                  );
                } else if (c.constraint.m_Value.HasMin()) {
                  REPORT(
                    () =>
                      `Checking ${EscapeHTML(c.constraint.GetName())} hole size: min ${this.MessageTextFromValue(c.constraint.m_Value.Min())}.`,
                  );
                }

                break;

              case DRC_CONSTRAINT_T.TEXT_HEIGHT_CONSTRAINT:
              case DRC_CONSTRAINT_T.TEXT_THICKNESS_CONSTRAINT:
              case DRC_CONSTRAINT_T.CONNECTION_WIDTH_CONSTRAINT:
                REPORT(
                  () =>
                    `Checking ${EscapeHTML(c.constraint.GetName())}: min ${this.MessageTextFromValue(c.constraint.m_Value.Min())}.`,
                );
                break;

              case DRC_CONSTRAINT_T.DIFF_PAIR_GAP_CONSTRAINT:
                if (c.constraint.m_Value.HasOpt()) {
                  REPORT(
                    () =>
                      `Checking ${EscapeHTML(c.constraint.GetName())} diff pair gap: opt ${this.MessageTextFromValue(c.constraint.m_Value.Opt())}.`,
                  );
                } else if (c.constraint.m_Value.HasMin()) {
                  REPORT(
                    () =>
                      `Checking ${EscapeHTML(c.constraint.GetName())} clearance: min ${this.MessageTextFromValue(c.constraint.m_Value.Min())}.`,
                  );
                }

                break;

              case DRC_CONSTRAINT_T.HOLE_TO_HOLE_CONSTRAINT:
                REPORT(
                  () =>
                    `Checking ${EscapeHTML(c.constraint.GetName())} hole to hole: min ${this.MessageTextFromValue(c.constraint.m_Value.Min())}.`,
                );
                break;

              default:
                REPORT(() => `Checking ${EscapeHTML(c.constraint.GetName())}.`);
            }
          } else {
            REPORT(
              () =>
                `Checking ${EscapeHTML(c.constraint.GetName())}: min ${
                  c.constraint.m_Value.HasMin()
                    ? this.MessageTextFromValue(c.constraint.m_Value.Min())
                    : '<i>undefined</i>'
                }; opt ${
                  c.constraint.m_Value.HasOpt()
                    ? this.MessageTextFromValue(c.constraint.m_Value.Opt())
                    : '<i>undefined</i>'
                }; max ${
                  c.constraint.m_Value.HasMax()
                    ? this.MessageTextFromValue(c.constraint.m_Value.Max())
                    : '<i>undefined</i>'
                }.`,
            );
          }
          break;
        }

        default:
          REPORT(() => `Checking ${EscapeHTML(c.constraint.GetName())}.`);
      }

      if (c.constraint.m_Type === DRC_CONSTRAINT_T.CLEARANCE_CONSTRAINT) {
        if (a_is_non_copper || b_is_non_copper) {
          if (implicit) {
            REPORT(() => 'Netclass clearances apply only between copper items.');
          } else if (a_is_non_copper) {
            REPORT(
              () =>
                `${EscapeHTML(a!.GetItemDescription(this, true))} contains no copper.  Rule ignored.`,
            );
          } else if (b_is_non_copper) {
            REPORT(
              () =>
                `${EscapeHTML(b!.GetItemDescription(this, true))} contains no copper.  Rule ignored.`,
            );
          }

          return;
        }
      } else if (c.constraint.m_Type === DRC_CONSTRAINT_T.DISALLOW_CONSTRAINT) {
        let mask: number;

        if (a!.GetFlags() & HOLE_PROXY) {
          mask = DRC_DISALLOW_T.DRC_DISALLOW_HOLES;
        } else if (a!.Type() === KICAD_T.PCB_VIA_T) {
          const via = a as PCB_VIA;

          if (via.IsMicroVia()) mask = DRC_DISALLOW_T.DRC_DISALLOW_MICRO_VIAS;
          else if (via.IsBlindVia()) mask = DRC_DISALLOW_T.DRC_DISALLOW_BLIND_VIAS;
          else if (via.IsBuriedVia()) mask = DRC_DISALLOW_T.DRC_DISALLOW_BURIED_VIAS;
          else mask = DRC_DISALLOW_T.DRC_DISALLOW_THROUGH_VIAS;
        } else {
          switch (a!.Type()) {
            case KICAD_T.PCB_TRACE_T:
              mask = DRC_DISALLOW_T.DRC_DISALLOW_TRACKS;
              break;
            case KICAD_T.PCB_ARC_T:
              mask = DRC_DISALLOW_T.DRC_DISALLOW_TRACKS;
              break;
            case KICAD_T.PCB_PAD_T:
              mask = DRC_DISALLOW_T.DRC_DISALLOW_PADS;
              break;
            case KICAD_T.PCB_FOOTPRINT_T:
              mask = DRC_DISALLOW_T.DRC_DISALLOW_FOOTPRINTS;
              break;
            case KICAD_T.PCB_SHAPE_T:
              mask = DRC_DISALLOW_T.DRC_DISALLOW_GRAPHICS;
              break;
            case KICAD_T.PCB_BARCODE_T:
              mask = DRC_DISALLOW_T.DRC_DISALLOW_GRAPHICS;
              break;
            case KICAD_T.PCB_FIELD_T:
              mask = DRC_DISALLOW_T.DRC_DISALLOW_TEXTS;
              break;
            case KICAD_T.PCB_TEXT_T:
              mask = DRC_DISALLOW_T.DRC_DISALLOW_TEXTS;
              break;
            case KICAD_T.PCB_TEXTBOX_T:
              mask = DRC_DISALLOW_T.DRC_DISALLOW_TEXTS;
              break;
            case KICAD_T.PCB_TABLE_T:
              mask = DRC_DISALLOW_T.DRC_DISALLOW_TEXTS;
              break;

            case KICAD_T.PCB_ZONE_T:
              // Treat teardrop areas as tracks for DRC purposes
              if ((a as ZONE).IsTeardropArea()) mask = DRC_DISALLOW_T.DRC_DISALLOW_TRACKS;
              else mask = DRC_DISALLOW_T.DRC_DISALLOW_ZONES;

              break;

            case KICAD_T.PCB_LOCATE_HOLE_T:
              mask = DRC_DISALLOW_T.DRC_DISALLOW_HOLES;
              break;
            default:
              mask = 0;
              break;
          }
        }

        if ((c.constraint.m_DisallowFlags & mask) === 0) {
          if (implicit) REPORT(() => 'Keepout constraint not met.');
          else REPORT(() => 'Disallow constraint not met.');

          return;
        }

        const itemLayers = a!.GetLayerSet();

        if (a!.Type() === KICAD_T.PCB_FOOTPRINT_T) {
          const footprint = a as FOOTPRINT;

          if (!footprint.GetCourtyard(LAYER.F_CrtYd).IsEmpty())
            itemLayers.orAssign(LSET.FrontMask());

          if (!footprint.GetCourtyard(LAYER.B_CrtYd).IsEmpty())
            itemLayers.orAssign(LSET.BackMask());
        }

        if (!c.layerTest.and(itemLayers).any()) {
          if (implicit) {
            REPORT(() => 'Keepout layer(s) not matched.');
          } else if (c.parentRule) {
            REPORT(
              () =>
                `Rule layer '${EscapeHTML(c.parentRule!.m_LayerSource)}' not matched; rule ignored.`,
            );
          } else {
            REPORT(() => 'Rule layer not matched; rule ignored.');
          }

          return;
        }
      }

      if (
        (IsPcbLayer(aLayer) && !c.layerTest.test(aLayer)) ||
        this.m_board!.GetEnabledLayers().and(c.layerTest).count() === 0
      ) {
        if (implicit) {
          REPORT(() => 'Constraint layer not matched.');
        } else if (c.parentRule) {
          REPORT(
            () =>
              `Rule layer '${EscapeHTML(c.parentRule!.m_LayerSource)}' not matched; rule ignored.`,
          );
        } else {
          REPORT(() => 'Rule layer not matched; rule ignored.');
        }
      } else if (
        c.constraint.m_Type === DRC_CONSTRAINT_T.HOLE_TO_HOLE_CONSTRAINT &&
        !a!.HasDrilledHole() &&
        !b!.HasDrilledHole()
      ) {
        // Report non-drilled-holes as an implicit condition
        REPORT(() => `${a!.GetItemDescription(this, true)} is not a drilled hole; rule ignored.`);
      } else if (!c.condition || c.condition.GetExpression().length === 0) {
        if (aReporter) {
          if (implicit) {
            REPORT(() => 'Unconditional constraint applied.');
          } else if (constraint.m_Type === DRC_CONSTRAINT_T.ASSERTION_CONSTRAINT) {
            REPORT(() => 'Unconditional rule applied.');
            testAssertion(c);
          } else {
            REPORT(() => 'Unconditional rule applied; overrides previous constraints.');
          }
        }

        applyConstraint(c);
      } else {
        if (implicit) {
          // Don't report on implicit rule conditions; they're synthetic.
        } else {
          REPORT(() => `Checking rule condition '${EscapeHTML(c.condition!.GetExpression())}'.`);
        }

        if (c.condition.EvaluateFor(a, b, c.constraint.m_Type, aLayer, aReporter)) {
          if (aReporter) {
            if (implicit) {
              REPORT(() => 'Constraint applied.');
            } else if (constraint.m_Type === DRC_CONSTRAINT_T.ASSERTION_CONSTRAINT) {
              REPORT(() => 'Rule applied.');
              testAssertion(c);
            } else {
              REPORT(() => 'Rule applied; overrides previous constraints.');
            }
          }

          applyConstraint(c);
        } else {
          REPORT(() =>
            implicit
              ? 'Membership not satisfied; constraint ignored.'
              : 'Condition not satisfied; rule ignored.',
          );
        }
      }
    };

    // Fast-path for netclass clearance when no explicit or diff pair override rules exist
    if (
      aConstraintType === DRC_CONSTRAINT_T.CLEARANCE_CONSTRAINT &&
      !this.m_hasExplicitClearanceRules &&
      !this.m_hasDiffPairClearanceOverrides &&
      !aReporter &&
      !a_is_non_copper &&
      (!b || !b_is_non_copper)
    ) {
      let clearance = 0;

      // Get netclass names outside of the lock to minimize critical section
      let ncNameA = '';
      let ncNameB = '';

      if (ac) {
        const ncA = ac.GetEffectiveNetClass();

        if (ncA) ncNameA = ncA.GetName();
      }

      if (bc) {
        const ncB = bc.GetEffectiveNetClass();

        if (ncB) ncNameB = ncB.GetName();
      }

      // Look up clearances with shared lock protection
      if (ncNameA.length > 0 || ncNameB.length > 0) {
        if (ncNameA.length > 0) {
          const it = this.m_netclassClearances.get(ncNameA);

          if (it !== undefined) clearance = it;
        }

        if (ncNameB.length > 0) {
          const it = this.m_netclassClearances.get(ncNameB);

          if (it !== undefined) clearance = Math.max(clearance, it);
        }
      }

      if (clearance > 0) {
        constraint.m_Value.SetMin(clearance);
        constraint.m_ImplicitMin = true;
      }
    } else {
      const it = this.m_constraintMap.get(aConstraintType);

      if (it !== undefined) {
        for (const rule of it) processConstraint(rule);
      }
    }

    if (constraint.GetParentRule() && !constraint.GetParentRule()!.IsImplicit()) return constraint;

    // Special case for properties which can be inherited from parent footprints.  We've already
    // checked for local overrides, and there were no rules targetting the item itself, so we know
    // we're inheriting and need to see if there are any rules targetting the parent footprint.
    if (
      pad &&
      parentFootprint &&
      (aConstraintType === DRC_CONSTRAINT_T.ZONE_CONNECTION_CONSTRAINT ||
        aConstraintType === DRC_CONSTRAINT_T.THERMAL_RELIEF_GAP_CONSTRAINT ||
        aConstraintType === DRC_CONSTRAINT_T.THERMAL_SPOKE_WIDTH_CONSTRAINT ||
        aConstraintType === DRC_CONSTRAINT_T.SOLDER_MASK_EXPANSION_CONSTRAINT ||
        aConstraintType === DRC_CONSTRAINT_T.SOLDER_PASTE_ABS_MARGIN_CONSTRAINT ||
        aConstraintType === DRC_CONSTRAINT_T.SOLDER_PASTE_REL_MARGIN_CONSTRAINT)
    ) {
      REPORT(() => '');
      REPORT(
        () =>
          `Inheriting from parent: ${EscapeHTML(parentFootprint!.GetItemDescription(this, true))}.`,
      );

      if (a === pad) a = parentFootprint;
      else b = parentFootprint;

      const it = this.m_constraintMap.get(aConstraintType);

      if (it !== undefined) {
        for (const rule of it) processConstraint(rule);

        if (constraint.GetParentRule() && !constraint.GetParentRule()!.IsImplicit())
          return constraint;
      }

      // Found nothing again?  Return the defaults.
      if (aConstraintType === DRC_CONSTRAINT_T.SOLDER_MASK_EXPANSION_CONSTRAINT) {
        constraint.SetParentRule(null);
        constraint.SetName('board setup');
        constraint.m_Value.SetOpt(this.m_designSettings!.m_SolderMaskExpansion);
        return constraint;
      } else if (aConstraintType === DRC_CONSTRAINT_T.SOLDER_PASTE_ABS_MARGIN_CONSTRAINT) {
        constraint.SetParentRule(null);
        constraint.SetName('board setup');
        constraint.m_Value.SetOpt(this.m_designSettings!.m_SolderPasteMargin);
        return constraint;
      } else if (aConstraintType === DRC_CONSTRAINT_T.SOLDER_PASTE_REL_MARGIN_CONSTRAINT) {
        constraint.SetParentRule(null);
        constraint.SetName('board setup');
        constraint.m_Value.SetOpt(KiROUND(this.m_designSettings!.m_SolderPasteMarginRatio * 1000));
        return constraint;
      }
    }

    // Unfortunately implicit rules don't work for local clearances (such as zones) because
    // they have to be max'ed with netclass values (which are already implicit rules), and our
    // rule selection paradigm is "winner takes all".
    if (aConstraintType === DRC_CONSTRAINT_T.CLEARANCE_CONSTRAINT) {
      const global = constraint.m_Value.Min();
      let clearance = global;
      let needBlankLine = true;

      if (ac && ac.GetLocalClearance() !== undefined) {
        const localA = ac.GetLocalClearance()!;

        if (needBlankLine) {
          REPORT(() => '');
          needBlankLine = false;
        }

        REPORT(
          () =>
            `Local clearance on ${EscapeHTML(a!.GetItemDescription(this, true))}: ${this.MessageTextFromValue(localA)}.`,
        );

        if (localA > clearance) {
          const msg: OutStr = { value: '' };
          clearance = ac.GetLocalClearance(msg)!;
          constraint.SetParentRule(null);
          constraint.SetName(msg.value);
          constraint.m_Value.SetMin(clearance);
        }
      }

      if (bc && bc.GetLocalClearance() !== undefined) {
        const localB = bc.GetLocalClearance()!;

        if (needBlankLine) {
          REPORT(() => '');
          needBlankLine = false;
        }

        REPORT(
          () =>
            `Local clearance on ${EscapeHTML(b!.GetItemDescription(this, true))}: ${this.MessageTextFromValue(localB)}.`,
        );

        if (localB > clearance) {
          const msg: OutStr = { value: '' };
          clearance = bc.GetLocalClearance(msg)!;
          constraint.SetParentRule(null);
          constraint.SetName(msg.value);
          constraint.m_Value.SetMin(clearance);
        }
      }

      if (!a_is_non_copper && !b_is_non_copper) {
        if (needBlankLine) {
          REPORT(() => '');
          needBlankLine = false;
        }

        REPORT(
          () =>
            `Board minimum clearance: ${this.MessageTextFromValue(this.m_designSettings!.m_MinClearance)}.`,
        );

        if (clearance < this.m_designSettings!.m_MinClearance) {
          constraint.SetParentRule(null);
          constraint.SetName('board minimum');
          constraint.m_Value.SetMin(this.m_designSettings!.m_MinClearance);
        }
      }

      return constraint;
    } else if (aConstraintType === DRC_CONSTRAINT_T.DIFF_PAIR_GAP_CONSTRAINT) {
      REPORT(() => '');
      REPORT(
        () =>
          `Board minimum clearance: ${this.MessageTextFromValue(this.m_designSettings!.m_MinClearance)}.`,
      );

      if (constraint.m_Value.Min() < this.m_designSettings!.m_MinClearance) {
        constraint.SetParentRule(null);
        constraint.SetName('board minimum');
        constraint.m_Value.SetMin(this.m_designSettings!.m_MinClearance);
      }

      return constraint;
    } else if (aConstraintType === DRC_CONSTRAINT_T.ZONE_CONNECTION_CONSTRAINT) {
      if (pad && parentFootprint) {
        const local = parentFootprint.GetLocalZoneConnection();

        if (local !== ZONE_CONNECTION.INHERITED) {
          REPORT(() => '');
          REPORT(
            () =>
              `${EscapeHTML(parentFootprint!.GetItemDescription(this, true))} zone connection: ${PrintZoneConnection(local)}.`,
          );

          constraint.SetParentRule(null);
          constraint.SetName('footprint');
          constraint.m_ZoneConnection = local;
          return constraint;
        }
      }

      if (zone) {
        const local = zone.GetPadConnection();

        REPORT(() => '');
        REPORT(
          () =>
            `${EscapeHTML(zone!.GetItemDescription(this, true))} pad connection: ${PrintZoneConnection(local)}.`,
        );

        constraint.SetParentRule(null);
        constraint.SetName('zone');
        constraint.m_ZoneConnection = local;
        return constraint;
      }
    } else if (aConstraintType === DRC_CONSTRAINT_T.THERMAL_RELIEF_GAP_CONSTRAINT) {
      if (zone) {
        const local = zone.GetThermalReliefGap();

        REPORT(() => '');
        REPORT(
          () =>
            `${EscapeHTML(zone!.GetItemDescription(this, true))} thermal relief gap: ${this.MessageTextFromValue(local)}.`,
        );

        constraint.SetParentRule(null);
        constraint.SetName('zone');
        constraint.m_Value.SetMin(local);
        return constraint;
      }
    } else if (aConstraintType === DRC_CONSTRAINT_T.THERMAL_SPOKE_WIDTH_CONSTRAINT) {
      if (zone) {
        const local = zone.GetThermalReliefSpokeWidth();

        REPORT(() => '');
        REPORT(
          () =>
            `${EscapeHTML(zone!.GetItemDescription(this, true))} thermal spoke width: ${this.MessageTextFromValue(local)}.`,
        );

        constraint.SetParentRule(null);
        constraint.SetName('zone');
        constraint.m_Value.SetMin(local);
        return constraint;
      }
    }

    if (!constraint.GetParentRule()) {
      constraint.m_Type = DRC_CONSTRAINT_T.NULL_CONSTRAINT;
      constraint.m_DisallowFlags = 0;
    }

    return constraint;
  }

  /**
   * Evaluate all clearance-related constraints in a single batch call.
   * This reduces per-call overhead during interactive PNS routing.
   *
   * @param a First board item
   * @param b Second board item (may be nullptr)
   * @param aLayer Layer to evaluate constraints on
   * @return DRC_CLEARANCE_BATCH containing all clearance constraint values
   */
  EvalClearanceBatch(
    a: BOARD_ITEM | null,
    b: BOARD_ITEM | null,
    aLayer: PCB_LAYER_ID,
  ): DRC_CLEARANCE_BATCH {
    const result: DRC_CLEARANCE_BATCH = {
      clearance: 0,
      holeClearance: 0,
      holeToHole: 0,
      edgeClearance: 0,
      physicalClearance: 0,
    };
    let c: DRC_CONSTRAINT;

    c = this.EvalRules(DRC_CONSTRAINT_T.CLEARANCE_CONSTRAINT, a, b, aLayer);

    if (c.m_Value.HasMin()) result.clearance = c.m_Value.Min();

    c = this.EvalRules(DRC_CONSTRAINT_T.HOLE_CLEARANCE_CONSTRAINT, a, b, aLayer);

    if (c.m_Value.HasMin()) result.holeClearance = c.m_Value.Min();

    c = this.EvalRules(DRC_CONSTRAINT_T.HOLE_TO_HOLE_CONSTRAINT, a, b, aLayer);

    if (c.m_Value.HasMin()) result.holeToHole = c.m_Value.Min();

    c = this.EvalRules(DRC_CONSTRAINT_T.EDGE_CLEARANCE_CONSTRAINT, a, b, aLayer);

    if (c.m_Value.HasMin()) result.edgeClearance = c.m_Value.Min();

    c = this.EvalRules(DRC_CONSTRAINT_T.PHYSICAL_CLEARANCE_CONSTRAINT, a, b, aLayer);

    if (c.m_Value.HasMin()) result.physicalClearance = c.m_Value.Min();

    return result;
  }

  ProcessAssertions(
    a: BOARD_ITEM,
    aFailureHandler: (aConstraint: DRC_CONSTRAINT) => void,
    aReporter: Reporter | null = null,
  ): void {
    /*
     * NOTE: all string manipulation MUST BE KEPT INSIDE the REPORT macro.  It absolutely
     * kills performance when running bulk DRC tests (where aReporter is nullptr).
     */
    const REPORT = (s: () => string): void => {
      if (aReporter) aReporter.report(s());
    };

    const testAssertion = (c: DRC_ENGINE_CONSTRAINT): void => {
      REPORT(
        () => `Checking rule assertion '${EscapeHTML(c.constraint.m_Test!.GetExpression())}'.`,
      );

      if (c.constraint.m_Test!.EvaluateFor(a, null, c.constraint.m_Type, a.GetLayer(), aReporter)) {
        REPORT(() => 'Assertion passed.');
      } else {
        REPORT(() => EscapeHTML('--> Assertion failed. <--'));
        aFailureHandler(c.constraint);
      }
    };

    const processConstraint = (c: DRC_ENGINE_CONSTRAINT): void => {
      REPORT(() => '');
      REPORT(() => `Checking ${c.constraint.GetName()}.`);

      if (!a.GetLayerSet().and(c.layerTest).any()) {
        REPORT(
          () =>
            `Rule layer '${EscapeHTML(c.parentRule!.m_LayerSource)}' not matched; rule ignored.`,
        );
      }

      if (!c.condition || c.condition.GetExpression().length === 0) {
        REPORT(() => 'Unconditional rule applied.');
        testAssertion(c);
      } else {
        REPORT(() => `Checking rule condition '${EscapeHTML(c.condition!.GetExpression())}'.`);

        if (c.condition.EvaluateFor(a, null, c.constraint.m_Type, a.GetLayer(), aReporter)) {
          REPORT(() => 'Rule applied.');
          testAssertion(c);
        } else {
          REPORT(() => 'Condition not satisfied; rule ignored.');
        }
      }
    };

    const it = this.m_constraintMap.get(DRC_CONSTRAINT_T.ASSERTION_CONSTRAINT);

    if (it !== undefined) {
      for (let ii = 0; ii < it.length; ++ii) processConstraint(it[ii]!);
    }
  }

  IsErrorLimitExceeded(error_code: number): boolean {
    console.assert(error_code >= 0 && error_code <= DRCE_LAST);
    return this.m_errorLimits[error_code]! <= 0;
  }

  ReportViolation(
    aItem: DRC_ITEM,
    aPos: VECTOR2I,
    aMarkerLayer: number,
    aPathGenerator: (aMarker: PCB_MARKER) => void = () => {},
  ): void {
    this.m_errorLimits[aItem.GetErrorCode()]! -= 1;

    if (this.m_violationHandler) {
      this.m_violationHandler(aItem, aPos, aMarkerLayer, aPathGenerator);
    }

    if (this.m_logReporter) {
      const test = aItem.GetViolatingTest() as DRC_TEST_PROVIDER | null;
      let msg = `Test '${test ? test.GetName() : ''}': ${aItem.GetErrorMessage(false)} (code ${aItem.GetErrorCode()})`;

      const rule = aItem.GetViolatingRule();

      if (rule) msg += `, violating rule: '${rule.m_Name}'`;

      this.m_logReporter.report(msg);

      this.m_logReporter.report(`  |- violating position (${aPos.x}, ${aPos.y})`);
    }
  }

  KeepRefreshing(aWait = false): boolean {
    if (!this.m_progressReporter) return true;

    return this.m_progressReporter.KeepRefreshing(aWait);
  }

  AdvanceProgress(): void {
    if (this.m_progressReporter) this.m_progressReporter.AdvanceProgress();
  }

  SetMaxProgress(aSize: number): void {
    if (this.m_progressReporter) this.m_progressReporter.SetMaxProgress(aSize);
  }

  ReportProgress(aProgress: number): boolean {
    if (!this.m_progressReporter) return true;

    this.m_progressReporter.SetCurrentProgress(aProgress);
    return this.m_progressReporter.KeepRefreshing(false);
  }

  ReportPhase(aMessage: string): boolean {
    if (!this.m_progressReporter) return true;

    this.m_progressReporter.AdvancePhase(aMessage);
    return this.m_progressReporter.KeepRefreshing(false);
  }

  IsCancelled(): boolean {
    return this.m_progressReporter !== null && this.m_progressReporter.IsCancelled();
  }

  HasRulesForConstraintType(constraintID: DRC_CONSTRAINT_T): boolean {
    const it = this.m_constraintMap.get(constraintID);
    return it !== undefined && it.length > 0;
  }

  HasGeometryDependentRules(): boolean {
    return this.m_hasGeometryDependentRules;
  }

  GetReportAllTrackErrors(): boolean {
    return this.m_reportAllTrackErrors;
  }
  GetTestFootprints(): boolean {
    return this.m_testFootprints;
  }
  RulesValid(): boolean {
    return this.m_rulesValid;
  }

  /**
   * `QueryWorstConstraint( aRuleId, aConstraint, aUnconditionalOnly )`: the
   * out-param `aConstraint` is the returned constraint, `null` for `false`.
   */
  QueryWorstConstraint(
    aConstraintId: DRC_CONSTRAINT_T,
    aUnconditionalOnly = false,
  ): DRC_CONSTRAINT | null {
    let worst = 0;
    let aConstraint: DRC_CONSTRAINT | null = null;
    const it = this.m_constraintMap.get(aConstraintId);

    if (it !== undefined) {
      for (const c of it) {
        if (aUnconditionalOnly && c.condition) continue;

        const current = c.constraint.GetValue().Min();

        if (current > worst) {
          worst = current;
          aConstraint = c.constraint.Clone();
        }
      }
    }

    return worst > 0 ? aConstraint : null;
  }

  HasUserDefinedPhysicalConstraint(): boolean {
    for (const type of [
      DRC_CONSTRAINT_T.PHYSICAL_CLEARANCE_CONSTRAINT,
      DRC_CONSTRAINT_T.PHYSICAL_HOLE_CLEARANCE_CONSTRAINT,
    ]) {
      const it = this.m_constraintMap.get(type);

      if (it !== undefined) {
        for (const c of it) {
          if (c.condition && c.parentRule && !c.parentRule.IsImplicit()) {
            return true;
          }
        }
      }
    }

    return false;
  }

  QueryDistinctConstraints(aConstraintId: DRC_CONSTRAINT_T): Set<number> {
    const distinctMinimums = new Set<number>();
    const it = this.m_constraintMap.get(aConstraintId);

    if (it !== undefined) {
      for (const c of it) distinctMinimums.add(c.constraint.GetValue().Min());
    }

    return distinctMinimums;
  }

  GetTestProviders(): DRC_TEST_PROVIDER[] {
    return [...this.m_testProviders];
  }

  GetTestProvider(name: string): DRC_TEST_PROVIDER | null {
    for (const prov of this.m_testProviders) {
      if (name === prov.GetName()) return prov;
    }

    return null;
  }

  /**
   * Evaluate a DRC condition against all board items and return matches.
   *
   * @param aExpression Expression to evaluate
   * @param aConstraint Constraint context for expression evaluation
   * @param aReporter Reporter for compile or evaluation errors
   */
  GetItemsMatchingCondition(
    aExpression: string,
    aConstraint: DRC_CONSTRAINT_T = DRC_CONSTRAINT_T.ASSERTION_CONSTRAINT,
    aReporter: Reporter | null = null,
  ): BOARD_ITEM[] {
    const matches: BOARD_ITEM[] = [];

    if (!this.m_board) return matches;

    const condition = new DRC_RULE_CONDITION(aExpression);

    if (!condition.Compile(aReporter ? aReporter : this.m_logReporter)) {
      return matches;
    }

    // Rebuild the from-to cache so that fromTo() expressions can be evaluated.
    // This cache requires explicit rebuilding before use since it depends on the full
    // connectivity graph being available.
    {
      const connectivity = this.m_board.GetConnectivity();

      if (connectivity) {
        const ftCache = connectivity.GetFromToCache();

        if (ftCache) ftCache.Rebuild(this.m_board);
      }
    }

    for (const [, item] of this.m_board.GetItemByIdCache()) {
      // Skip items that don't have visible geometry or can't be meaningfully matched
      switch (item.Type()) {
        case KICAD_T.PCB_NETINFO_T:
        case KICAD_T.PCB_GENERATOR_T:
        case KICAD_T.PCB_GROUP_T:
          continue;

        default:
          break;
      }

      const itemLayers = item.GetLayerSet();

      if (itemLayers.none()) {
        continue;
      }

      for (const layer of itemLayers) {
        if (
          condition.EvaluateFor(
            item,
            null,
            aConstraint,
            layer,
            aReporter ? aReporter : this.m_logReporter,
          )
        ) {
          matches.push(item);
          break; // No need to check other layers
        }
      }
    }

    return matches;
  }

  GetItemsMatchingRule(aRule: DRC_RULE | null, aReporter: Reporter | null = null): BOARD_ITEM[] {
    const matches: BOARD_ITEM[] = [];

    if (!this.m_board || !aRule) return matches;

    const condition = aRule.m_Condition ? aRule.m_Condition.GetExpression() : '';
    const requiresPairwise = condition.includes('B.');
    const matchedItems = new Set<BOARD_ITEM>();

    {
      const connectivity = this.m_board.GetConnectivity();

      if (connectivity) {
        const ftCache = connectivity.GetFromToCache();

        if (ftCache) ftCache.Rebuild(this.m_board);
      }
    }

    for (const constraint of aRule.m_Constraints) {
      if (constraint.m_Type === DRC_CONSTRAINT_T.NULL_CONSTRAINT) continue;

      const domainSpec = getShowMatchDomainSpec(constraint.m_Type);
      const primaryItems = collectShowMatchCandidates(this.m_board, domainSpec.primary);
      let secondaryItems: BOARD_ITEM[] = [];

      if (domainSpec.hasSecondary)
        secondaryItems = collectShowMatchCandidates(this.m_board, domainSpec.secondary);

      if (requiresPairwise) {
        if (secondaryItems.length === 0) {
          for (let ii = 0; ii < primaryItems.length; ++ii) {
            const itemA = primaryItems[ii]!;

            for (let jj = ii + 1; jj < primaryItems.length; ++jj) {
              const itemB = primaryItems[jj]!;

              if (
                ruleMatchesPair(
                  aRule,
                  itemA,
                  itemB,
                  constraint.m_Type,
                  aReporter ? aReporter : this.m_logReporter,
                )
              ) {
                matchedItems.add(itemA);
                matchedItems.add(itemB);
              }
            }
          }
        } else {
          for (const itemA of primaryItems) {
            for (const itemB of secondaryItems) {
              if (itemA === itemB) continue;

              if (
                ruleMatchesPair(
                  aRule,
                  itemA,
                  itemB,
                  constraint.m_Type,
                  aReporter ? aReporter : this.m_logReporter,
                )
              ) {
                matchedItems.add(itemA);
                matchedItems.add(itemB);
              }
            }
          }
        }
      } else {
        for (const item of primaryItems) {
          if (
            ruleMatchesUnary(
              aRule,
              item,
              constraint.m_Type,
              aReporter ? aReporter : this.m_logReporter,
            )
          ) {
            matchedItems.add(item);
          }
        }

        if (domainSpec.hasSecondary && domainSpec.secondaryUnary) {
          for (const item of secondaryItems) {
            if (
              ruleMatchesUnary(
                aRule,
                item,
                constraint.m_Type,
                aReporter ? aReporter : this.m_logReporter,
              )
            ) {
              matchedItems.add(item);
            }
          }
        }
      }
    }

    // `matches.assign( matchedItems.begin(), matchedItems.end() )`: a std::set
    // iterates in pointer order; insertion order is the nearest thing here.
    for (const item of matchedItems) matches.push(item);

    return matches;
  }

  /**
   * Check if the given net is a diff pair, returning its polarity and complement if so.
   *
   * @param aNetName is the input net name, like DIFF_P
   * @param aComplementNet will be filled with the complement, like DIFF_N
   * @param aBaseDpName will be filled with the base name, like DIFF
   * @return 1 if the net is the P side of a pair, -1 if the N side, 0 if not a diff pair
   */
  static MatchDpSuffix(aNetName: string): DP_SUFFIX_MATCH {
    let rv = 0;
    let count = 0;
    let aComplementNet = '';
    let aBaseDpName = '';

    for (let i = aNetName.length - 1; i >= 0 && rv === 0; --i, ++count) {
      const ch = aNetName[i]!;

      if ((ch >= '0' && ch <= '9') || ch === '_') {
      } else if (ch === '+') {
        aComplementNet = '-';
        rv = 1;
      } else if (ch === '-') {
        aComplementNet = '+';
        rv = -1;
      } else if (ch === 'N') {
        aComplementNet = 'P';
        rv = -1;
      } else if (ch === 'P') {
        aComplementNet = 'N';
        rv = 1;
      } else {
        break;
      }
    }

    if (rv !== 0 && count >= 1) {
      aBaseDpName = aNetName.slice(0, aNetName.length - count);
      aComplementNet = aBaseDpName + aComplementNet + aNetName.slice(aNetName.length - (count - 1));
    }

    return { polarity: rv, complementNet: aComplementNet, baseDpName: aBaseDpName };
  }

  /** `IsNetADiffPair( aBoard, aNet, aNetP, aNetN )`: the two out-params, or null for `false`. */
  static IsNetADiffPair(aBoard: BOARD, aNet: NETINFO_ITEM): { netP: number; netN: number } | null {
    const refName = aNet.GetNetname();
    const match = DRC_ENGINE.MatchDpSuffix(refName);
    const polarity = match.polarity;

    if (polarity) {
      const coupledNetName = match.complementNet;
      const net = aBoard.FindNet(coupledNetName);

      if (!net) return null;

      if (polarity > 0) {
        return { netP: aNet.GetNetCode(), netN: net.GetNetCode() };
      } else {
        return { netP: net.GetNetCode(), netN: aNet.GetNetCode() };
      }
    }

    return null;
  }

  /**
   * Check if the given collision between a track and another item occurs during the track's entry
   * into a net-tie pad.
   */
  IsNetTieExclusion(
    aTrackNetCode: number,
    aTrackLayer: PCB_LAYER_ID,
    aCollisionPos: VECTOR2I,
    aCollidingItem: BOARD_ITEM,
  ): boolean {
    const parentFootprint = aCollidingItem.GetParentFootprint();

    if (parentFootprint && parentFootprint.IsNetTie()) {
      const epsilon = this.GetDesignSettings()!.GetDRCEpsilon();
      const padToNetTieGroupMap = parentFootprint.MapPadNumbersToNetTieGroups();

      for (const pad of parentFootprint.Pads()) {
        if (
          (padToNetTieGroupMap.get(pad.GetNumber()) ?? 0) >= 0 &&
          aTrackNetCode === pad.GetNetCode()
        ) {
          if (pad.GetEffectiveShape(aTrackLayer).Collide(aCollisionPos, epsilon)) return true;
        }
      }
    }

    return false;
  }

  /**
   * Get the cached own clearance for an item on a specific layer.
   *
   * This is used by BOARD_CONNECTED_ITEM::GetOwnClearance() to avoid re-evaluating
   * DRC rules on every paint refresh.
   *
   * @param aItem the item to get clearance for.
   * @param aLayer the layer in question.
   * @param aSource optionally reports the source as a user-readable string.
   * @return the clearance in internal units.
   */
  GetCachedOwnClearance(
    aItem: BOARD_ITEM,
    aLayer: PCB_LAYER_ID,
    aSource: OutStr | null = null,
  ): number {
    const key = ownClearanceKey(aItem.m_Uuid, aLayer);

    // Fast path: check cache with shared (read) lock
    {
      const it = this.m_ownClearanceCache.get(key);

      if (it !== undefined) {
        // Cache hit. We don't cache the source string since it's rarely requested
        // and caching it would add complexity.
        return it;
      }
    }

    // Cache miss - evaluate the constraint (outside lock to avoid blocking other threads)
    let constraintType = DRC_CONSTRAINT_T.CLEARANCE_CONSTRAINT;

    if (aItem.Type() === KICAD_T.PCB_PAD_T) {
      const pad = aItem as PAD;

      if (pad.GetAttribute() === PAD_ATTRIB.NPTH)
        constraintType = DRC_CONSTRAINT_T.HOLE_CLEARANCE_CONSTRAINT;
    }

    const constraint = this.EvalRules(constraintType, aItem, null, aLayer);

    let clearance = 0;

    if (constraint.Value().HasMin()) {
      clearance = constraint.Value().Min();

      if (aSource) aSource.value = constraint.GetName();
    }
    if (!this.m_ownClearanceCache.has(key)) this.m_ownClearanceCache.set(key, clearance);

    return clearance;
  }

  /**
   * Invalidate the clearance cache for a specific item.
   *
   * Called when item properties that could affect clearance (net, type, layer) change.
   *
   * @param aUuid the UUID of the item to invalidate.
   */
  InvalidateClearanceCache(aUuid: KIID): void {
    if (this.m_board) {
      const copperLayers = this.m_board.GetEnabledLayers().and(LSET.AllCuMask());

      for (const layer of copperLayers.Seq())
        this.m_ownClearanceCache.delete(ownClearanceKey(aUuid, layer));
    } else {
      const prefix = `${aUuid}:`;

      for (const key of [...this.m_ownClearanceCache.keys()]) {
        if (key.startsWith(prefix)) this.m_ownClearanceCache.delete(key);
      }
    }
  }

  /**
   * Clear the entire clearance cache.
   *
   * Called when DRC rules change or board design settings change.
   */
  ClearClearanceCache(): void {
    this.m_ownClearanceCache.clear();
  }

  /**
   * Initialize the clearance cache for all items on the board.
   *
   * Pre-populates the cache to avoid delays during first render. Should be called
   * after InitEngine() when a board is loaded.
   */
  InitializeClearanceCache(): void {
    if (!this.m_board) return;

    // Pre-populate the cache for all connected items to avoid delays during first render.
    // We only need to cache copper layers since clearance outlines are only drawn on copper.

    const copperLayers = this.m_board.GetEnabledLayers().and(LSET.AllCuMask());

    // Build flat list of (item, layer) pairs to process.
    const itemsToProcess: [BOARD_ITEM, PCB_LAYER_ID][] = [];

    for (const track of this.m_board.Tracks()) {
      if (track.Type() === KICAD_T.PCB_VIA_T) {
        for (const layer of track.GetLayerSet().and(copperLayers).Seq())
          itemsToProcess.push([track, layer]);
      } else {
        itemsToProcess.push([track, track.GetLayer()]);
      }
    }

    for (const footprint of this.m_board.Footprints()) {
      for (const pad of footprint.Pads()) {
        for (const layer of pad.GetLayerSet().and(copperLayers).Seq())
          itemsToProcess.push([pad, layer]);
      }
    }

    if (itemsToProcess.length === 0) return;

    // The thread pool's blocks, run one after another.
    const localCache = new Map<string, number>();

    for (const [item, layer] of itemsToProcess) {
      let constraintType = DRC_CONSTRAINT_T.CLEARANCE_CONSTRAINT;

      if (item.Type() === KICAD_T.PCB_PAD_T) {
        const pad = item as PAD;

        if (pad.GetAttribute() === PAD_ATTRIB.NPTH)
          constraintType = DRC_CONSTRAINT_T.HOLE_CLEARANCE_CONSTRAINT;
      }

      const constraint = this.EvalRules(constraintType, item, null, layer);

      let clearance = 0;

      if (constraint.Value().HasMin()) clearance = constraint.Value().Min();

      localCache.set(ownClearanceKey(item.m_Uuid, layer), clearance);
    }
    for (const [key, value] of localCache) this.m_ownClearanceCache.set(key, value);
  }
}

/**
 * The `REPORTER error_semaphore` of `compileRules`: a sink whose
 * `HasMessageOfSeverity` is the only thing read.
 */
class ReporterSemaphore implements Reporter {
  readonly lines: Reporter['lines'] = [];

  report(message: string, severity: Reporter['lines'][number]['severity'] = 0): this {
    this.lines.push({ message, severity, location: 'body' });
    return this;
  }
  reportHead(message: string, severity: Reporter['lines'][number]['severity'] = 0): this {
    this.lines.push({ message, severity, location: 'head' });
    return this;
  }
  reportTail(message: string, severity: Reporter['lines'][number]['severity'] = 0): this {
    this.lines.push({ message, severity, location: 'tail' });
    return this;
  }
  clear(): void {
    this.lines.length = 0;
  }
  hasMessage(): boolean {
    return this.lines.length > 0;
  }
  count(severityMask: number): number {
    return this.lines.filter((l) => severityMask & l.severity).length;
  }
  HasMessageOfSeverity(aSeverityMask: number): boolean {
    return this.lines.some((l) => (l.severity & aSeverityMask) !== 0);
  }
}

// ---------------------------------------------------------------------------
// The anonymous namespace of drc_engine.cpp: the show-matches domains.

enum SHOWMATCH_DOMAIN {
  ALL_ITEMS,
  COPPER_ITEMS,
  EDGE_ITEMS,
  FOOTPRINTS,
  HOLE_ITEMS,
  MASK_EXPANSION_ITEMS,
  MASK_ITEMS,
  PADS,
  PADS_AND_VIAS,
  PASTE_ITEMS,
  ROUTING_ITEMS,
  SILK_ITEMS,
  SILK_TARGET_ITEMS,
  TEXT_ITEMS,
  VIAS,
}

interface SHOWMATCH_DOMAIN_SPEC {
  primary: SHOWMATCH_DOMAIN;
  secondary: SHOWMATCH_DOMAIN;
  hasSecondary: boolean;
  secondaryUnary: boolean;
}

function spec(
  primary: SHOWMATCH_DOMAIN,
  secondary: SHOWMATCH_DOMAIN = SHOWMATCH_DOMAIN.ALL_ITEMS,
  hasSecondary = false,
  secondaryUnary = false,
): SHOWMATCH_DOMAIN_SPEC {
  return { primary, secondary, hasSecondary, secondaryUnary };
}

function isShowMatchSkippable(aItem: BOARD_ITEM): boolean {
  switch (aItem.Type()) {
    case KICAD_T.PCB_NETINFO_T:
    case KICAD_T.PCB_GENERATOR_T:
    case KICAD_T.PCB_GROUP_T:
      return true;

    default:
      return false;
  }
}

function matchesShowMatchDomain(aItem: BOARD_ITEM | null, aDomain: SHOWMATCH_DOMAIN): boolean {
  if (!aItem || isShowMatchSkippable(aItem)) return false;

  switch (aDomain) {
    case SHOWMATCH_DOMAIN.ALL_ITEMS:
      return true;

    case SHOWMATCH_DOMAIN.COPPER_ITEMS:
      return aItem.IsOnCopperLayer();

    case SHOWMATCH_DOMAIN.EDGE_ITEMS:
      if (aItem.IsOnLayer(LAYER.Edge_Cuts) || aItem.IsOnLayer(LAYER.Margin)) return true;

      if (aItem.Type() === KICAD_T.PCB_PAD_T) {
        const pad = aItem as PAD;
        return pad.GetAttribute() === PAD_ATTRIB.NPTH && pad.HasHole();
      }

      return false;

    case SHOWMATCH_DOMAIN.FOOTPRINTS:
      return aItem.Type() === KICAD_T.PCB_FOOTPRINT_T;

    case SHOWMATCH_DOMAIN.HOLE_ITEMS:
      return aItem.HasHole();

    case SHOWMATCH_DOMAIN.MASK_EXPANSION_ITEMS:
      switch (aItem.Type()) {
        case KICAD_T.PCB_PAD_T:
        case KICAD_T.PCB_TRACE_T:
        case KICAD_T.PCB_ARC_T:
        case KICAD_T.PCB_VIA_T:
        case KICAD_T.PCB_SHAPE_T:
        case KICAD_T.PCB_ZONE_T:
          return true;

        default:
          return false;
      }

    case SHOWMATCH_DOMAIN.MASK_ITEMS:
      return aItem.IsOnLayer(LAYER.F_Mask) || aItem.IsOnLayer(LAYER.B_Mask);

    case SHOWMATCH_DOMAIN.PADS:
      return aItem.Type() === KICAD_T.PCB_PAD_T;

    case SHOWMATCH_DOMAIN.PADS_AND_VIAS:
      return aItem.Type() === KICAD_T.PCB_PAD_T || aItem.Type() === KICAD_T.PCB_VIA_T;

    case SHOWMATCH_DOMAIN.PASTE_ITEMS:
      return aItem.IsOnLayer(LAYER.F_Paste) || aItem.IsOnLayer(LAYER.B_Paste);

    case SHOWMATCH_DOMAIN.ROUTING_ITEMS:
      switch (aItem.Type()) {
        case KICAD_T.PCB_TRACE_T:
        case KICAD_T.PCB_ARC_T:
        case KICAD_T.PCB_VIA_T:
        case KICAD_T.PCB_PAD_T:
          return true;

        default:
          return false;
      }

    case SHOWMATCH_DOMAIN.SILK_ITEMS:
      return aItem.IsOnLayer(LAYER.F_SilkS) || aItem.IsOnLayer(LAYER.B_SilkS);

    case SHOWMATCH_DOMAIN.SILK_TARGET_ITEMS:
      return (
        aItem.IsOnLayer(LAYER.F_SilkS) ||
        aItem.IsOnLayer(LAYER.B_SilkS) ||
        aItem.IsOnLayer(LAYER.F_Mask) ||
        aItem.IsOnLayer(LAYER.B_Mask) ||
        aItem.IsOnLayer(LAYER.F_Adhes) ||
        aItem.IsOnLayer(LAYER.B_Adhes) ||
        aItem.IsOnLayer(LAYER.F_Paste) ||
        aItem.IsOnLayer(LAYER.B_Paste) ||
        aItem.IsOnLayer(LAYER.F_CrtYd) ||
        aItem.IsOnLayer(LAYER.B_CrtYd) ||
        aItem.IsOnLayer(LAYER.F_Fab) ||
        aItem.IsOnLayer(LAYER.B_Fab) ||
        aItem.IsOnCopperLayer() ||
        aItem.IsOnLayer(LAYER.Edge_Cuts) ||
        aItem.IsOnLayer(LAYER.Margin)
      );

    case SHOWMATCH_DOMAIN.TEXT_ITEMS:
      return (
        aItem.Type() === KICAD_T.PCB_FIELD_T ||
        aItem.Type() === KICAD_T.PCB_TEXT_T ||
        aItem.Type() === KICAD_T.PCB_TEXTBOX_T ||
        aItem.Type() === KICAD_T.PCB_TABLECELL_T ||
        BaseType(aItem.Type()) === KICAD_T.PCB_DIMENSION_T
      );

    case SHOWMATCH_DOMAIN.VIAS:
      return aItem.Type() === KICAD_T.PCB_VIA_T;
  }

  return false;
}

function getShowMatchDomainSpec(aConstraint: DRC_CONSTRAINT_T): SHOWMATCH_DOMAIN_SPEC {
  switch (aConstraint) {
    case DRC_CONSTRAINT_T.CLEARANCE_CONSTRAINT:
      return spec(SHOWMATCH_DOMAIN.COPPER_ITEMS);

    case DRC_CONSTRAINT_T.EDGE_CLEARANCE_CONSTRAINT:
      return spec(SHOWMATCH_DOMAIN.COPPER_ITEMS, SHOWMATCH_DOMAIN.EDGE_ITEMS, true, true);

    case DRC_CONSTRAINT_T.HOLE_CLEARANCE_CONSTRAINT:
      return spec(SHOWMATCH_DOMAIN.HOLE_ITEMS, SHOWMATCH_DOMAIN.ALL_ITEMS, true, false);

    case DRC_CONSTRAINT_T.HOLE_TO_HOLE_CONSTRAINT:
      return spec(SHOWMATCH_DOMAIN.HOLE_ITEMS);

    case DRC_CONSTRAINT_T.COURTYARD_CLEARANCE_CONSTRAINT:
      return spec(SHOWMATCH_DOMAIN.FOOTPRINTS);

    case DRC_CONSTRAINT_T.PHYSICAL_CLEARANCE_CONSTRAINT:
    case DRC_CONSTRAINT_T.PHYSICAL_HOLE_CLEARANCE_CONSTRAINT:
    case DRC_CONSTRAINT_T.CREEPAGE_CONSTRAINT:
      return spec(SHOWMATCH_DOMAIN.ALL_ITEMS);

    case DRC_CONSTRAINT_T.SILK_CLEARANCE_CONSTRAINT:
      return spec(SHOWMATCH_DOMAIN.SILK_ITEMS, SHOWMATCH_DOMAIN.SILK_TARGET_ITEMS, true, false);

    case DRC_CONSTRAINT_T.SOLDER_MASK_SLIVER_CONSTRAINT:
      return spec(SHOWMATCH_DOMAIN.MASK_ITEMS);

    case DRC_CONSTRAINT_T.TRACK_WIDTH_CONSTRAINT:
    case DRC_CONSTRAINT_T.TRACK_ANGLE_CONSTRAINT:
    case DRC_CONSTRAINT_T.TRACK_SEGMENT_LENGTH_CONSTRAINT:
    case DRC_CONSTRAINT_T.CONNECTION_WIDTH_CONSTRAINT:
    case DRC_CONSTRAINT_T.DIFF_PAIR_GAP_CONSTRAINT:
    case DRC_CONSTRAINT_T.MAX_UNCOUPLED_CONSTRAINT:
    case DRC_CONSTRAINT_T.LENGTH_CONSTRAINT:
    case DRC_CONSTRAINT_T.SKEW_CONSTRAINT:
      return spec(SHOWMATCH_DOMAIN.ROUTING_ITEMS);

    case DRC_CONSTRAINT_T.VIA_DIAMETER_CONSTRAINT:
    case DRC_CONSTRAINT_T.VIA_COUNT_CONSTRAINT:
      return spec(SHOWMATCH_DOMAIN.VIAS);

    case DRC_CONSTRAINT_T.HOLE_SIZE_CONSTRAINT:
      return spec(SHOWMATCH_DOMAIN.HOLE_ITEMS);

    case DRC_CONSTRAINT_T.ANNULAR_WIDTH_CONSTRAINT:
      return spec(SHOWMATCH_DOMAIN.PADS_AND_VIAS);

    case DRC_CONSTRAINT_T.MIN_RESOLVED_SPOKES_CONSTRAINT:
      return spec(SHOWMATCH_DOMAIN.PADS);

    case DRC_CONSTRAINT_T.TEXT_HEIGHT_CONSTRAINT:
    case DRC_CONSTRAINT_T.TEXT_THICKNESS_CONSTRAINT:
      return spec(SHOWMATCH_DOMAIN.TEXT_ITEMS);

    case DRC_CONSTRAINT_T.SOLDER_MASK_EXPANSION_CONSTRAINT:
      return spec(SHOWMATCH_DOMAIN.MASK_EXPANSION_ITEMS);

    case DRC_CONSTRAINT_T.SOLDER_PASTE_ABS_MARGIN_CONSTRAINT:
    case DRC_CONSTRAINT_T.SOLDER_PASTE_REL_MARGIN_CONSTRAINT:
      return spec(SHOWMATCH_DOMAIN.PASTE_ITEMS);

    case DRC_CONSTRAINT_T.ASSERTION_CONSTRAINT:
    case DRC_CONSTRAINT_T.DISALLOW_CONSTRAINT:
    default:
      return spec(SHOWMATCH_DOMAIN.ALL_ITEMS);
  }
}

function collectShowMatchCandidates(aBoard: BOARD | null, aDomain: SHOWMATCH_DOMAIN): BOARD_ITEM[] {
  const items: BOARD_ITEM[] = [];

  if (!aBoard) return items;

  for (const [, item] of aBoard.GetItemByIdCache()) {
    if (matchesShowMatchDomain(item, aDomain)) items.push(item);
  }

  return items;
}

function getShowMatchLayers(aItem: BOARD_ITEM): PCB_LAYER_ID[] {
  let layers: PCB_LAYER_ID[] = [];

  switch (aItem.Type()) {
    case KICAD_T.PCB_PAD_T:
      layers = (aItem as PAD).Padstack().UniqueLayers();
      break;

    case KICAD_T.PCB_VIA_T:
      layers = (aItem as PCB_VIA).Padstack().UniqueLayers();
      break;

    default:
      for (const layer of aItem.GetLayerSet()) layers.push(layer);

      break;
  }

  if (layers.length === 0) layers.push(LAYER.UNDEFINED_LAYER);

  return layers;
}

function ruleMatchesUnary(
  aRule: DRC_RULE,
  aItem: BOARD_ITEM,
  aConstraint: DRC_CONSTRAINT_T,
  aReporter: Reporter | null,
): boolean {
  let testedLayer = false;

  for (const layer of getShowMatchLayers(aItem)) {
    if (layer !== LAYER.UNDEFINED_LAYER && !aRule.m_LayerCondition.test(layer)) continue;

    testedLayer = true;

    if (
      !aRule.m_Condition ||
      aRule.m_Condition.EvaluateFor(aItem, null, aConstraint, layer, aReporter)
    ) {
      return true;
    }
  }

  if (!testedLayer && aItem.GetLayerSet().none()) {
    return (
      !aRule.m_Condition ||
      aRule.m_Condition.EvaluateFor(aItem, null, aConstraint, LAYER.UNDEFINED_LAYER, aReporter)
    );
  }

  return false;
}

function getShowMatchPairLayers(
  aRule: DRC_RULE,
  aItemA: BOARD_ITEM,
  aItemB: BOARD_ITEM,
  aConstraint: DRC_CONSTRAINT_T,
): PCB_LAYER_ID[] {
  const layers: PCB_LAYER_ID[] = [];
  const seenLayers = new Set<number>();

  const addLayer = (aLayer: PCB_LAYER_ID): void => {
    if (aLayer !== LAYER.UNDEFINED_LAYER && !aRule.m_LayerCondition.test(aLayer)) return;

    if (!seenLayers.has(aLayer)) {
      seenLayers.add(aLayer);
      layers.push(aLayer);
    }
  };

  switch (aConstraint) {
    case DRC_CONSTRAINT_T.EDGE_CLEARANCE_CONSTRAINT:
      for (const layer of getShowMatchLayers(aItemA)) addLayer(layer);

      break;

    case DRC_CONSTRAINT_T.COURTYARD_CLEARANCE_CONSTRAINT:
      addLayer(LAYER.UNDEFINED_LAYER);
      break;

    default:
      for (const layer of getShowMatchLayers(aItemA)) addLayer(layer);

      for (const layer of getShowMatchLayers(aItemB)) addLayer(layer);

      break;
  }

  if (layers.length === 0) layers.push(LAYER.UNDEFINED_LAYER);

  return layers;
}

function ruleMatchesPair(
  aRule: DRC_RULE,
  aItemA: BOARD_ITEM,
  aItemB: BOARD_ITEM,
  aConstraint: DRC_CONSTRAINT_T,
  aReporter: Reporter | null,
): boolean {
  for (const layer of getShowMatchPairLayers(aRule, aItemA, aItemB, aConstraint)) {
    if (
      !aRule.m_Condition ||
      aRule.m_Condition.EvaluateFor(aItemA, aItemB, aConstraint, layer, aReporter)
    ) {
      return true;
    }
  }

  return false;
}
