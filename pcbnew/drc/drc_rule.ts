// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/drc/drc_rule.h` + `drc_rule.cpp`: DRC_RULE, DRC_CONSTRAINT and the
 * constraint kinds. The condition (`drc_rule_condition.ts`) and the parser
 * (`drc_rule_parser.ts`) are their own modules, as the C++'s are.
 *
 * The plain-object rule set the older, view-based engine reads is
 * `drc_rule_view.ts`; it goes with that engine (#636 stage 4).
 */
import { type KIID, niluuid } from '@ziroeda/common/src/kiid.js';
import { LSET } from '@ziroeda/common/src/lset.js';
import { RPT_SEVERITY_UNDEFINED, type Severity } from '@ziroeda/common/src/reporter.js';
import { MINOPTMAX } from '@ziroeda/core/src/minoptmax.js';
import type { BOARD_ITEM } from '../board_item.js';
import { ZONE_CONNECTION } from '../zones.js';
import type { DRC_RULE_CONDITION } from './drc_rule_condition.js';

export enum DRC_CONSTRAINT_T {
  NULL_CONSTRAINT = 0,
  CLEARANCE_CONSTRAINT,
  CREEPAGE_CONSTRAINT,
  HOLE_CLEARANCE_CONSTRAINT,
  HOLE_TO_HOLE_CONSTRAINT,
  EDGE_CLEARANCE_CONSTRAINT,
  HOLE_SIZE_CONSTRAINT,
  COURTYARD_CLEARANCE_CONSTRAINT,
  SILK_CLEARANCE_CONSTRAINT,
  TEXT_HEIGHT_CONSTRAINT,
  TEXT_THICKNESS_CONSTRAINT,
  TRACK_WIDTH_CONSTRAINT,
  TRACK_SEGMENT_LENGTH_CONSTRAINT,
  ANNULAR_WIDTH_CONSTRAINT,
  ZONE_CONNECTION_CONSTRAINT,
  THERMAL_RELIEF_GAP_CONSTRAINT,
  THERMAL_SPOKE_WIDTH_CONSTRAINT,
  MIN_RESOLVED_SPOKES_CONSTRAINT,
  SOLDER_MASK_EXPANSION_CONSTRAINT,
  SOLDER_PASTE_ABS_MARGIN_CONSTRAINT,
  SOLDER_PASTE_REL_MARGIN_CONSTRAINT,
  DISALLOW_CONSTRAINT,
  VIA_DIAMETER_CONSTRAINT,
  LENGTH_CONSTRAINT,
  SKEW_CONSTRAINT,
  DIFF_PAIR_GAP_CONSTRAINT,
  MAX_UNCOUPLED_CONSTRAINT,
  DIFF_PAIR_INTRA_SKEW_CONSTRAINT,
  VIA_COUNT_CONSTRAINT,
  PHYSICAL_CLEARANCE_CONSTRAINT,
  PHYSICAL_HOLE_CLEARANCE_CONSTRAINT,
  ASSERTION_CONSTRAINT,
  CONNECTION_WIDTH_CONSTRAINT,
  TRACK_ANGLE_CONSTRAINT,
  VIA_DANGLING_CONSTRAINT,
  BRIDGED_MASK_CONSTRAINT,
  SOLDER_MASK_SLIVER_CONSTRAINT,
}

export enum DRC_DISALLOW_T {
  DRC_DISALLOW_THROUGH_VIAS = 1 << 0,
  DRC_DISALLOW_MICRO_VIAS = 1 << 1,
  DRC_DISALLOW_BLIND_VIAS = 1 << 2,
  DRC_DISALLOW_BURIED_VIAS = 1 << 3,
  DRC_DISALLOW_TRACKS = 1 << 4,
  DRC_DISALLOW_PADS = 1 << 5,
  DRC_DISALLOW_ZONES = 1 << 6,
  DRC_DISALLOW_TEXTS = 1 << 7,
  DRC_DISALLOW_GRAPHICS = 1 << 8,
  DRC_DISALLOW_HOLES = 1 << 9,
  DRC_DISALLOW_FOOTPRINTS = 1 << 10,
}

export enum DRC_IMPLICIT_SOURCE {
  NONE,
  BOARD_SETUP_CONSTRAINT,
  BARCODE_DEFAULTS,
  KEEPOUT,
  NET_CLASS,
  TUNING_PROFILE,
}

export const DRC_DISALLOW_VIAS = DRC_DISALLOW_T.DRC_DISALLOW_THROUGH_VIAS;
export const DRC_DISALLOW_BB_VIAS =
  DRC_DISALLOW_T.DRC_DISALLOW_BLIND_VIAS | DRC_DISALLOW_T.DRC_DISALLOW_BURIED_VIAS;

export class DRC_RULE {
  m_Unary: boolean;
  m_ImplicitItemId: KIID;
  m_ImplicitItem: BOARD_ITEM | null;
  m_Name: string;
  m_LayerSource: string;
  m_LayerCondition: LSET;
  m_Condition: DRC_RULE_CONDITION | null;
  m_Constraints: DRC_CONSTRAINT[];
  m_Severity: Severity;

  private m_implicitSource: DRC_IMPLICIT_SOURCE;

  constructor(aName = '') {
    this.m_Unary = false;
    this.m_ImplicitItemId = niluuid;
    this.m_ImplicitItem = null;
    this.m_Name = aName;
    this.m_LayerSource = '';
    this.m_LayerCondition = LSET.AllLayersMask();
    this.m_Condition = null;
    this.m_Constraints = [];
    this.m_Severity = RPT_SEVERITY_UNDEFINED;
    this.m_implicitSource = DRC_IMPLICIT_SOURCE.NONE;
  }

  AppliesTo(_a: BOARD_ITEM, _b: BOARD_ITEM | null = null): boolean {
    return true;
  }

  AddConstraint(aConstraint: DRC_CONSTRAINT): void {
    aConstraint.SetParentRule(this);
    this.m_Constraints.push(aConstraint);
  }

  FindConstraint(aType: DRC_CONSTRAINT_T): DRC_CONSTRAINT | undefined {
    for (const c of this.m_Constraints) {
      if (c.m_Type === aType) return c;
    }

    return undefined;
  }

  IsImplicit(): boolean {
    return this.m_implicitSource !== DRC_IMPLICIT_SOURCE.NONE;
  }
  SetImplicitSource(aImplicitSource: DRC_IMPLICIT_SOURCE): void {
    this.m_implicitSource = aImplicitSource;
  }
  GetImplicitSource(): DRC_IMPLICIT_SOURCE {
    return this.m_implicitSource;
  }
}

export enum DRC_CONSTRAINT_OPTIONS {
  SKEW_WITHIN_DIFF_PAIRS = 0,
  SPACE_DOMAIN,
  TIME_DOMAIN,
  // Keep this last value - used to statically size the options bitset
  NUM_OPTIONS,
}

export class DRC_CONSTRAINT {
  static readonly OPTIONS = DRC_CONSTRAINT_OPTIONS;

  m_Type: DRC_CONSTRAINT_T;
  m_Value: MINOPTMAX;
  m_DisallowFlags: number;
  m_ZoneConnection: ZONE_CONNECTION;
  m_Test: DRC_RULE_CONDITION | null;
  m_ImplicitMin: boolean;

  private m_name: string; // For just-in-time constraints
  private m_parentRule: DRC_RULE | null; // For constraints found in rules
  private m_options: number; // Constraint-specific option bits
  // (indexed from DRC_CONSTRAINT::OPTIONS)

  constructor(aType: DRC_CONSTRAINT_T = DRC_CONSTRAINT_T.NULL_CONSTRAINT, aName = '') {
    this.m_Type = aType;
    this.m_Value = new MINOPTMAX();
    this.m_DisallowFlags = 0;
    this.m_ZoneConnection = ZONE_CONNECTION.INHERITED;
    this.m_Test = null;
    this.m_ImplicitMin = false;
    this.m_name = aName;
    this.m_parentRule = null;
    this.m_options = 0;
  }

  /** A copy, as the C++'s value semantics give (`std::optional<DRC_CONSTRAINT>`, `DRC_CONSTRAINT constraint = ...`). */
  Clone(): DRC_CONSTRAINT {
    const c = new DRC_CONSTRAINT(this.m_Type, this.m_name);
    c.m_Value = this.m_Value.Clone();
    c.m_DisallowFlags = this.m_DisallowFlags;
    c.m_ZoneConnection = this.m_ZoneConnection;
    c.m_Test = this.m_Test;
    c.m_ImplicitMin = this.m_ImplicitMin;
    c.m_parentRule = this.m_parentRule;
    c.m_options = this.m_options;
    return c;
  }

  IsNull(): boolean {
    return this.m_Type === DRC_CONSTRAINT_T.NULL_CONSTRAINT;
  }

  GetValue(): MINOPTMAX {
    return this.m_Value;
  }
  Value(): MINOPTMAX {
    return this.m_Value;
  }

  SetParentRule(aParentRule: DRC_RULE | null): void {
    this.m_parentRule = aParentRule;
  }
  GetParentRule(): DRC_RULE | null {
    return this.m_parentRule;
  }

  SetName(aName: string): void {
    this.m_name = aName;
  }

  GetName(): string {
    if (this.m_parentRule) {
      if (this.m_parentRule.IsImplicit()) return this.m_parentRule.m_Name;
      else return `rule '${this.m_parentRule.m_Name}'`;
    }

    return this.m_name;
  }

  GetSeverity(): Severity {
    if (this.m_parentRule) return this.m_parentRule.m_Severity;
    else return RPT_SEVERITY_UNDEFINED;
  }

  SetOption(option: DRC_CONSTRAINT_OPTIONS): void {
    this.m_options |= 1 << option;
  }
  ClearOption(option: DRC_CONSTRAINT_OPTIONS): void {
    this.m_options &= ~(1 << option);
  }
  GetOption(option: DRC_CONSTRAINT_OPTIONS): boolean {
    return (this.m_options & (1 << option)) !== 0;
  }
  SetOptionsFromOther(aOther: DRC_CONSTRAINT): void {
    this.m_options = aOther.m_options;
  }
}
