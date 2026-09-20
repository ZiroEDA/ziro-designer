// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `qa/tests/pcbnew/test_libeval_compiler.cpp`, transcribed: the simple
 * arithmetic/unit expressions and the introspected A.<property> /
 * A.<function>() expressions over two tracks.
 */
import { describe, expect, it } from 'vitest';
import { pcbIUScale } from '@ziroeda/common/src/eda_units.js';
import { PCB_LAYER_ID } from '@ziroeda/common/src/layer_ids.js';
import { VALUE, VAR_TYPE_T } from '@ziroeda/common/src/libeval_compiler/libeval_compiler.js';
import { NETCLASS } from '@ziroeda/common/src/netclass.js';
import { PROPERTY_MANAGER } from '@ziroeda/common/src/properties/property_mgr.js';
import { BOARD } from '@ziroeda/pcbnew/board.js';
import type { BOARD_ITEM } from '@ziroeda/pcbnew/board_item.js';
import { DRC_CONSTRAINT_T } from '@ziroeda/pcbnew/drc/drc_rule.js';
import { NETINFO_ITEM } from '@ziroeda/pcbnew/netinfo.js';
import {
  PCBEXPR_COMPILER,
  PCBEXPR_CONTEXT,
  PCBEXPR_UCODE,
  PCBEXPR_UNIT_RESOLVER,
} from '@ziroeda/pcbnew/pcbexpr_evaluator.js';
import { PCB_TRACK } from '@ziroeda/pcbnew/pcb_track.js';

interface EXPR_TO_TEST {
  expression: string;
  expectError: boolean;
  expectedResult: VALUE;
}

const VAL = (v: number | string): VALUE => (typeof v === 'number' ? new VALUE(v) : new VALUE(v));

const simpleExpressions: EXPR_TO_TEST[] = [
  { expression: '10mm + 20 mm', expectError: false, expectedResult: VAL(30e6) },
  { expression: '3*(7+8)', expectError: false, expectedResult: VAL(3 * (7 + 8)) },
  { expression: '3*7+8', expectError: false, expectedResult: VAL(3 * 7 + 8) },
  { expression: '(3*7)+8', expectError: false, expectedResult: VAL(3 * 7 + 8) },
  { expression: '10mm + 20)', expectError: true, expectedResult: VAL(0) },
  { expression: '1', expectError: false, expectedResult: VAL(1) },
  { expression: '1.5', expectError: false, expectedResult: VAL(1.5) },
  { expression: '1,5', expectError: false, expectedResult: VAL(1.5) },
  { expression: '1mm', expectError: false, expectedResult: VAL(1e6) },
  // Any White-space is OK
  { expression: '   1 +     2    ', expectError: false, expectedResult: VAL(3) },
  // Decimals are OK in expressions
  { expression: '1.5 + 0.2 + 0.1', expectError: false, expectedResult: VAL(1.8) },
  // Negatives are OK
  { expression: '3 - 10', expectError: false, expectedResult: VAL(-7) },
  // Lots of operands
  { expression: '1 + 2 + 10 + 1000.05', expectError: false, expectedResult: VAL(1013.05) },
  // Operator precedence
  { expression: '1 + 2 - 4 * 20 / 2', expectError: false, expectedResult: VAL(-37) },
  // Parens
  { expression: '(1)', expectError: false, expectedResult: VAL(1) },
  // Parens affect precedence
  { expression: '-(1 + (2 - 4)) * 20.8 / 2', expectError: false, expectedResult: VAL(10.4) },
  // Unary addition is a sign, not a leading operator
  { expression: '+2 - 1', expectError: false, expectedResult: VAL(1) },
  // Ours: `%left PLUS MINUS` in grammar.lemon - subtraction associates left
  { expression: '10 - 3 - 2', expectError: false, expectedResult: VAL(5) },
  { expression: '100 / 10 / 2', expectError: false, expectedResult: VAL(5) },
];

const introspectionExpressions: EXPR_TO_TEST[] = [
  {
    expression: "A.type == 'Pad' && B.type == 'Pad' && (A.existsOnLayer('F.Cu'))",
    expectError: false,
    expectedResult: VAL(0.0),
  },
  { expression: 'A.Width > B.Width', expectError: false, expectedResult: VAL(0.0) },
  {
    expression: 'A.Width + B.Width',
    expectError: false,
    expectedResult: VAL(pcbIUScale.milsToIU(10) + pcbIUScale.milsToIU(20)),
  },
  { expression: 'A.Netclass', expectError: false, expectedResult: VAL('HV_LINE') },
  {
    expression:
      "(A.Netclass == 'HV_LINE') && (B.netclass == 'otherClass') && (B.netclass != 'F.Cu')",
    expectError: false,
    expectedResult: VAL(1.0),
  },
  { expression: 'A.Netclass + 1.0', expectError: false, expectedResult: VAL(1.0) },
  { expression: "A.hasNetclass('HV_LINE')", expectError: false, expectedResult: VAL(1.0) },
  { expression: "A.hasNetclass('HV_*')", expectError: false, expectedResult: VAL(1.0) },
  {
    expression: "A.type == 'Track' && B.type == 'Track' && A.layer == 'F.Cu'",
    expectError: false,
    expectedResult: VAL(1.0),
  },
  {
    expression: "(A.type == 'Track') && (B.type == 'Track') && (A.layer == 'F.Cu')",
    expectError: false,
    expectedResult: VAL(1.0),
  },
  { expression: "A.type == 'Via' && A.isMicroVia()", expectError: false, expectedResult: VAL(0.0) },
];

function testEvalExpr(
  expr: string,
  expectedResult: VALUE,
  expectError = false,
  itemA: BOARD_ITEM | null = null,
  itemB: BOARD_ITEM | null = null,
): void {
  const compiler = new PCBEXPR_COMPILER(new PCBEXPR_UNIT_RESOLVER());
  const ucode = new PCBEXPR_UCODE();
  const context = new PCBEXPR_CONTEXT(
    DRC_CONSTRAINT_T.NULL_CONSTRAINT,
    PCB_LAYER_ID.UNDEFINED_LAYER,
  );
  const preflightContext = new PCBEXPR_CONTEXT(
    DRC_CONSTRAINT_T.NULL_CONSTRAINT,
    PCB_LAYER_ID.UNDEFINED_LAYER,
  );

  context.SetItems(itemA, itemB);

  const error = !compiler.Compile(expr, ucode, preflightContext);

  expect(
    error,
    `${expr}: ${compiler.GetError().message} (code pos: ${compiler.GetError().srcPos})`,
  ).toBe(expectError);

  if (error) return;

  const result = ucode.Run(context);

  expect(result.EqualTo(context, expectedResult), expr).toBe(true);

  if (expectedResult.GetType() === VAR_TYPE_T.VT_NUMERIC) {
    expect(result.AsDouble(), expr).toBe(expectedResult.AsDouble());
  } else {
    expect(result.AsString(), expr).toBe(expectedResult.AsString());
  }
}

describe('Libeval_Compiler', () => {
  for (const expr of simpleExpressions) {
    it(`SimpleExpressions: ${expr.expression}`, () => {
      testEvalExpr(expr.expression, expr.expectedResult, expr.expectError);
    });
  }

  it('IntrospectedProperties', () => {
    const propMgr = PROPERTY_MANAGER.Instance();
    propMgr.Rebuild();

    const brd = new BOARD();

    const netclass1 = new NETCLASS('HV_LINE');
    const netclass2 = new NETCLASS('otherClass');

    const net1info = new NETINFO_ITEM(brd, 'net1', 1);
    const net2info = new NETINFO_ITEM(brd, 'net2', 2);

    net1info.SetNetClass(netclass1);
    net2info.SetNetClass(netclass2);

    const trackA = new PCB_TRACK(brd);
    const trackB = new PCB_TRACK(brd);

    trackA.SetNet(net1info);
    trackB.SetNet(net2info);

    trackB.SetLayer(PCB_LAYER_ID.F_Cu);

    trackA.SetWidth(pcbIUScale.milsToIU(10));
    trackB.SetWidth(pcbIUScale.milsToIU(20));

    for (const expr of introspectionExpressions) {
      testEvalExpr(expr.expression, expr.expectedResult, expr.expectError, trackA, trackB);
    }
  });
});
