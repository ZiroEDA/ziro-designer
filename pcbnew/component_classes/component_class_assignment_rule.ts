// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** `pcbnew/component_classes/component_class_assignment_rule.h` + `.cpp`. */
import type { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { BOARD_ITEM } from '../board_item.js';
import type { FOOTPRINT } from '../footprint.js';

/**
 * The slice of `DRC_RULE_CONDITION` an assignment rule evaluates; the class
 * lands with the DRC engine and its rule parser (#636 stage 4).
 */
export interface DRC_RULE_CONDITION_LIKE {
  EvaluateFor(
    aItemA: BOARD_ITEM,
    aItemB: BOARD_ITEM | null,
    aConstraint: number,
    aLayer: PCB_LAYER_ID,
    aReporter: unknown,
  ): boolean;
}

/**
 * A lightweight representation of a component class assignment rule. The
 * rule is compiled from a COMPONENT_CLASS_ASSIGNMENT_DATA by the DRC rules
 * parser.
 */
export class COMPONENT_CLASS_ASSIGNMENT_RULE {
  /// The component class which will be assigned to matching footprints
  private m_componentClass: string;

  /// The DRC condition which specifies footprint matches for this component class
  private m_condition: DRC_RULE_CONDITION_LIKE | null;

  constructor(aComponentClass: string, aCondition: DRC_RULE_CONDITION_LIKE | null) {
    this.m_componentClass = aComponentClass;
    this.m_condition = aCondition;
  }

  /// Gets the component class this rule assigns
  GetComponentClass(): string {
    return this.m_componentClass;
  }

  /// Tests whether the footprint matches this rule
  Matches(aFootprint: FOOTPRINT): boolean {
    if (!this.m_condition) return true;

    return this.m_condition.EvaluateFor(aFootprint, null, 0, aFootprint.GetSide(), null);
  }
}
