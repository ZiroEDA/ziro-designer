// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/drc/drc_rule_condition.h` + `.cpp`: a rule's `(condition "...")`,
 * compiled once to PCBEXPR_UCODE and evaluated per item pair.
 */
import { type PCB_LAYER_ID, PCB_LAYER_ID as LAYER } from '@ziroeda/common/src/layer_ids.js';
import { RPT_SEVERITY_ERROR, type Reporter } from '@ziroeda/common/src/reporter.js';
import { KICAD_T } from '@ziroeda/core/src/typeinfo.js';
import type { BOARD_ITEM } from '../board_item.js';
import {
  PCBEXPR_COMPILER,
  PCBEXPR_CONTEXT,
  PCBEXPR_UCODE,
  PCBEXPR_UNIT_RESOLVER,
} from '../pcbexpr_evaluator.js';
import type { ZONE } from '../zone.js';

export class DRC_RULE_CONDITION {
  private m_expression: string;
  private m_ucode: PCBEXPR_UCODE | null;

  constructor(aExpression = '') {
    this.m_expression = aExpression;
    this.m_ucode = null;
  }

  EvaluateFor(
    aItemA: BOARD_ITEM | null,
    aItemB: BOARD_ITEM | null,
    aConstraint: number,
    aLayer: PCB_LAYER_ID,
    aReporter: Reporter | null = null,
  ): boolean {
    if (this.GetExpression().length === 0) return true;

    if (!this.m_ucode) {
      if (aReporter) aReporter.report('ERROR in expression.');

      return false;
    }

    const ctx = new PCBEXPR_CONTEXT(aConstraint, aLayer);

    if (aReporter) {
      ctx.SetErrorCallback((aMessage: string, _aOffset: number) => {
        aReporter.report(`ERROR: ${aMessage}`);
      });
    }

    const a = aItemA;
    const b = aItemB;

    // Treat teardrop areas as tracks for DRC rule matching
    if (a && a.Type() === KICAD_T.PCB_ZONE_T && (a as ZONE).IsTeardropArea())
      ctx.SetTypeOverride(a, KICAD_T.PCB_TRACE_T);

    if (b && b.Type() === KICAD_T.PCB_ZONE_T && (b as ZONE).IsTeardropArea())
      ctx.SetTypeOverride(b, KICAD_T.PCB_TRACE_T);

    ctx.SetItems(a, b);

    if (this.m_ucode.Run(ctx).AsDouble() !== 0.0) {
      return true;
    } else if (aItemB) {
      // Conditions are commutative
      ctx.SetItems(b, a);

      if (this.m_ucode.Run(ctx).AsDouble() !== 0.0) return true;
    }

    return false;
  }

  Compile(aReporter: Reporter | null, aSourceLine = 0, aSourceOffset = 0): boolean {
    const compiler = new PCBEXPR_COMPILER(new PCBEXPR_UNIT_RESOLVER());

    if (aReporter) {
      compiler.SetErrorCallback((aMessage: string, aOffset: number) => {
        const bar = aMessage.indexOf('|');
        const first = bar >= 0 ? aMessage.slice(0, bar) : aMessage;
        const rest = bar >= 0 ? aMessage.slice(bar + 1) : '';
        const msg = `ERROR: <a href='${aSourceLine}:${aSourceOffset + aOffset}'>${first}</a>${rest}`;

        aReporter.report(msg, RPT_SEVERITY_ERROR);
      });
    }

    this.m_ucode = new PCBEXPR_UCODE();

    const preflightContext = new PCBEXPR_CONTEXT(0, LAYER.F_Cu);

    const ok = compiler.Compile(this.GetExpression(), this.m_ucode, preflightContext);

    return ok;
  }

  SetExpression(aExpression: string): void {
    this.m_expression = aExpression;
  }
  GetExpression(): string {
    return this.m_expression;
  }

  HasGeometryDependentFunctions(): boolean {
    return this.m_ucode !== null && this.m_ucode.HasGeometryDependentFunctions();
  }
}
