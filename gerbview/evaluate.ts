// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `gerbview/evaluate.cpp`: `Evaluate( AM_PARAM_EVAL_STACK& )`, the arithmetic
 * of an aperture macro parameter, with precedence.
 *
 * This is KiCad's one-pass reduction, not a general shunting-yard: an operator
 * is applied as soon as the one after it has a lower-or-equal priority, and
 * only ONE level is reduced per value read; what is left is then folded left
 * to right. For the expressions real macros use the result is the textbook
 * one, but it is the algorithm, not the textbook, that is ported — an
 * expression the two disagree on is evaluated the way GerbView evaluates it.
 */
import { AM_PARAM_EVAL, parm_item_type } from './am_param.js';

/** `OP_CODE`: an operator and its priority. */
class OP_CODE {
  m_Optype: parm_item_type;
  m_Priority: number;

  /** `OP_CODE( AM_PARAM_EVAL& )` or `OP_CODE( parm_item_type )` (priority 0). */
  constructor(a: AM_PARAM_EVAL | parm_item_type) {
    if (typeof a === 'number') {
      this.m_Optype = a;
      this.m_Priority = 0;
    } else {
      this.m_Optype = a.GetOperator();
      this.m_Priority = a.GetPriority();
    }
  }
}

/**
 * Evaluate a basic arithmetic expression (infix notation) with precedence.
 * The expression is a sequence of numbers and operators `+ - x / ( )`.
 */
export function Evaluate(aExp: AM_PARAM_EVAL[]): number {
  let result = 0.0;

  const values: number[] = []; // the current list of values
  const optype: OP_CODE[] = []; // the list of arith operators

  let curr_value = 0.0;
  let extra_priority = 0;

  for (let ii = 0; ii < aExp.length; ii++) {
    const prm = aExp[ii] as AM_PARAM_EVAL;

    if (prm.IsOperator()) {
      if (prm.GetOperator() === parm_item_type.OPEN_PAR) {
        extra_priority += AM_PARAM_EVAL.GetPriority(parm_item_type.OPEN_PAR);
      } else if (prm.GetOperator() === parm_item_type.CLOSE_PAR) {
        extra_priority -= AM_PARAM_EVAL.GetPriority(parm_item_type.CLOSE_PAR);
      } else {
        optype.push(new OP_CODE(prm));
        (optype[optype.length - 1] as OP_CODE).m_Priority += extra_priority;
      }
    } else {
      // we have a value:
      values.push(prm.GetValue());

      if (optype.length < 2) continue;

      const previous_optype = optype[optype.length - 2] as OP_CODE;

      if ((optype[optype.length - 1] as OP_CODE).m_Priority > previous_optype.m_Priority) {
        let op1 = 0.0;

        const op2 = values.pop() as number;

        if (values.length) op1 = values.pop() as number;

        switch ((optype[optype.length - 1] as OP_CODE).m_Optype) {
          case parm_item_type.ADD:
            values.push(op1 + op2);
            break;

          case parm_item_type.SUB:
            values.push(op1 - op2);
            break;

          case parm_item_type.MUL:
            values.push(op1 * op2);
            break;

          case parm_item_type.DIV:
            values.push(op1 / op2);
            break;

          default:
            break;
        }

        optype.pop();
      }
    }
  }

  // Now all operators have the same priority, or those having the higher priority
  // are before others, calculate the final result by combining initial values and/or
  // replaced values.
  if (values.length > optype.length)
    // If there are n values, the number of operator is n-1 or n if the first
    // item of the expression to evaluate is + or - (like -$1/2)
    // If the number of operator is n-1 the first value is just copied to result
    optype.unshift(new OP_CODE(parm_item_type.POPVALUE));

  // wxASSERT( values.size() == optype.size() );

  for (let idx = 0; idx < values.length; idx++) {
    curr_value = values[idx] as number;

    // `optype[idx]` past its end is undefined behaviour upstream (the assert
    // above is compiled out); read as no operator, which leaves the result.
    switch (optype[idx]?.m_Optype) {
      case parm_item_type.POPVALUE:
        result = curr_value;
        break;

      case parm_item_type.ADD:
        result += curr_value;
        break;

      case parm_item_type.SUB:
        result -= curr_value;
        break;

      case parm_item_type.MUL:
        result *= curr_value;
        break;

      case parm_item_type.DIV:
        result /= curr_value;
        break;

      default:
        break;
    }
  }

  return result;
}
