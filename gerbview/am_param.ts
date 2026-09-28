// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `gerbview/am_param.h` + `.cpp`: one parameter of an aperture macro
 * primitive — an immediate value (`3.5`), a deferred one (`$2`, set by the
 * `%ADD` that instantiates the macro) or an arithmetic expression of both
 * (`$2/2+1`), stored as a small program of operands and operators and
 * evaluated with the usual precedence by `Evaluate` (evaluate.ts).
 *
 *     %AMRECTHERM*
 *     $4=$3/2*    parameter $4 is half value of parameter $3
 *     21,1,$1-$3,$2-$3,0-$1/2-$4,0-$2/2-$4,0*
 */
import type { APERTURE_MACRO } from './aperture_macro.js';
import { Evaluate } from './evaluate.js';
import { type CHAR_PTR, NUL } from './libc.js';
import { ReadDouble, ReadInt } from './rs274_read_XY_and_IJ_coordinates.js';

/**
 * `parm_item_type`: the instructions of the stack machine a parameter is
 * compiled to.
 */
export enum parm_item_type {
  NOP,
  PUSHVALUE,
  PUSHPARM,
  ADD,
  SUB,
  MUL,
  DIV,
  OPEN_PAR,
  CLOSE_PAR,
  POPVALUE,
}

/**
 * `AM_PARAM_EVAL`: a value or an arithmetic operator of the expression
 * `Evaluate` reduces. Only ADD, SUB, MUL, DIV, OPEN_PAR, CLOSE_PAR mean
 * anything when calculating a value; NOP carries a number.
 */
export class AM_PARAM_EVAL {
  private m_type: parm_item_type;
  /** The value, for a numerical value; used only when m_type == NOP. */
  private m_dvalue: number;

  /** `AM_PARAM_EVAL( parm_item_type )` or `AM_PARAM_EVAL( double )`. */
  constructor(a: parm_item_type | { value: number }) {
    if (typeof a === 'number') {
      this.m_type = a;
      this.m_dvalue = 0.0;
    } else {
      this.m_type = parm_item_type.NOP;
      this.m_dvalue = a.value;
    }
  }

  GetType(): parm_item_type {
    return this.m_type;
  }

  IsOperator(): boolean {
    return this.m_type !== parm_item_type.NOP;
  }

  GetValue(): number {
    return this.m_dvalue;
  }

  GetOperator(): parm_item_type {
    return this.m_type;
  }

  GetPriority(): number {
    return AM_PARAM_EVAL.GetPriority(this.GetOperator());
  }

  static GetPriority(aType: parm_item_type): number {
    switch (aType) {
      case parm_item_type.ADD:
      case parm_item_type.SUB:
        return 1;

      case parm_item_type.MUL:
      case parm_item_type.DIV:
        return 2;

      case parm_item_type.OPEN_PAR:
      case parm_item_type.CLOSE_PAR:
        return 3;

      default:
        break;
    }

    return 0;
  }
}

/** `AM_PARAM_EVAL_STACK`. */
export type AM_PARAM_EVAL_STACK = AM_PARAM_EVAL[];

/**
 * `AM_PARAM_ITEM`: an operand or operator of an AM_PARAM. An immediate value
 * is `m_dvalue`; a deferred one is `m_ivalue`, the index `n` of `$n`.
 */
export class AM_PARAM_ITEM {
  private m_type: parm_item_type;
  /** The value, for PUSHVALUE type item. */
  private m_dvalue: number;
  /** The integer value, for PUSHPARM type item. */
  private m_ivalue: number;

  /**
   * `AM_PARAM_ITEM( type, double )` for a PUSHVALUE, `AM_PARAM_ITEM( type,
   * int )` for everything else — C++ picks by the argument's type, so the
   * operand kind says which one was called.
   */
  constructor(aType: parm_item_type, aValue: number, aIsInt: boolean) {
    this.m_type = aType;

    if (aIsInt) {
      this.m_dvalue = 0.0;
      this.m_ivalue = aValue;
    } else {
      this.m_dvalue = aValue;
      this.m_ivalue = 0;
    }
  }

  SetValue(aValue: number): void {
    this.m_dvalue = aValue;
  }

  GetValue(): number {
    return this.m_dvalue;
  }

  GetType(): parm_item_type {
    return this.m_type;
  }

  /** `(unsigned) m_ivalue`. */
  GetIndex(): number {
    return this.m_ivalue >>> 0;
  }

  IsOperator(): boolean {
    return (
      this.m_type === parm_item_type.ADD ||
      this.m_type === parm_item_type.SUB ||
      this.m_type === parm_item_type.MUL ||
      this.m_type === parm_item_type.DIV
    );
  }

  IsOperand(): boolean {
    return this.m_type === parm_item_type.PUSHVALUE || this.m_type === parm_item_type.PUSHPARM;
  }

  IsDefered(): boolean {
    return this.m_type === parm_item_type.PUSHPARM;
  }
}

/**
 * `AM_PARAM`: a parameter of an aperture macro primitive, as an expression of
 * immediate and deferred values.
 */
export class AM_PARAM {
  /**
   * Has meaning to define a parameter local to an aperture macro: the `n` of a
   * definition like `$n = ...`.
   */
  private m_index: number;
  /**
   * The operands and operators; for `$3/2` there are 3 items: 3 (PUSHPARM),
   * / (DIV), 2 (PUSHVALUE).
   */
  private m_paramStack: AM_PARAM_ITEM[] = [];

  constructor() {
    this.m_index = -1;
  }

  /**
   * `PushOperator( type, double )` / `PushOperator( type, int = 0 )`: add an
   * operator or operand. `aValue` is a PUSHVALUE's double or a PUSHPARM's int;
   * `aIsDouble` says which overload the C++ resolved to.
   */
  PushOperator(aType: parm_item_type, aValue = 0, aIsDouble = false): void {
    this.m_paramStack.push(new AM_PARAM_ITEM(aType, aValue, !aIsDouble));
  }

  /**
   * The value of this parameter for the D_CODE that instantiated
   * `aApertureMacro`: deferred values resolved against the macro's local
   * parameters, then the expression evaluated with precedence.
   */
  GetValueFromMacro(aApertureMacro: APERTURE_MACRO | null): number {
    let curr_value = 0.0;
    let op_code: parm_item_type;

    const ops: AM_PARAM_EVAL_STACK = [];

    for (let ii = 0; ii < this.m_paramStack.length; ii++) {
      const item = this.m_paramStack[ii] as AM_PARAM_ITEM;

      switch (item.GetType()) {
        case parm_item_type.ADD:
        case parm_item_type.SUB:
        case parm_item_type.MUL:
        case parm_item_type.DIV: // just an operator for next parameter value
        case parm_item_type.OPEN_PAR:
        case parm_item_type.CLOSE_PAR: // Priority modifiers: store in stack
          op_code = item.GetType();
          ops.push(new AM_PARAM_EVAL(op_code));
          break;

        case parm_item_type.PUSHPARM:
          // a defered value: get the actual parameter from the aperture macro
          if (aApertureMacro) {
            // should be always true here
            // Get the actual value
            curr_value = aApertureMacro.GetLocalParamValue(item.GetIndex());
          }
          // else: wxFAIL_MSG( "AM_PARAM::GetValue(): NULL param aApertureMacro" ),
          // and curr_value keeps the previous operand's value.

          ops.push(new AM_PARAM_EVAL({ value: curr_value }));
          break;

        case parm_item_type.PUSHVALUE: // a value is on the stack:
          curr_value = item.GetValue();
          ops.push(new AM_PARAM_EVAL({ value: curr_value }));
          break;

        default:
          // wxFAIL_MSG( "AM_PARAM::GetValue(): unexpected prm type %d" )
          break;
      }
    }

    return Evaluate(ops);
  }

  /**
   * True if the value is immediate, i.e. no deferred value is used in its
   * definition.
   */
  IsImmediate(): boolean {
    let is_immediate = true;

    for (let ii = 0; ii < this.m_paramStack.length; ii++) {
      if ((this.m_paramStack[ii] as AM_PARAM_ITEM).IsDefered()) {
        // a defered value is found in operand list,
        // so the parameter is not immediate
        is_immediate = false;
        break;
      }
    }

    return is_immediate;
  }

  /** `(unsigned) m_index`. */
  GetIndex(): number {
    return this.m_index >>> 0;
  }

  SetIndex(aIndex: number): void {
    this.m_index = aIndex;
  }

  /**
   * Read one aperture macro parameter: a number, a reference `$1`, or an
   * expression of both like `$1+3` or `$2x2`. "Note minus sign is not always
   * an operator. It can be the sign of a value." Parameters are separated by
   * a comma or finished by `*`.
   *
   * @return true if a param is read.
   */
  ReadParamFromAmDef(aText: CHAR_PTR): boolean {
    let found = false;
    let ivalue: number;
    let dvalue: number;
    let end = false;

    while (!end) {
      switch (aText.c()) {
        case ',':
          aText.inc();

          if (!found)
            // happens when a string starts by ',' before any param
            break; // just skip this separator

          // KI_FALLTHROUGH
          end = true;
          break;

        case '\n':
        case '\r':
        case NUL: // EOL
        case '*': // Terminator in a gerber command
          end = true;
          break;

        case ' ':
          aText.inc();
          break;

        case '$':
          // defered value defined later, in ADD command which define defered parameters
          aText.inc();
          ivalue = ReadInt(aText, false);

          if (this.m_index < 1) this.SetIndex(ivalue);

          this.PushOperator(parm_item_type.PUSHPARM, ivalue);
          found = true;
          break;

        case '/':
          this.PushOperator(parm_item_type.DIV);
          aText.inc();
          break;

        case '(': // Open a block to evaluate an expression between '(' and ')'
          this.PushOperator(parm_item_type.OPEN_PAR);
          aText.inc();
          break;

        case ')': // close a block between '(' and ')'
          this.PushOperator(parm_item_type.CLOSE_PAR);
          aText.inc();
          break;

        case 'x':
        case 'X':
          this.PushOperator(parm_item_type.MUL);
          aText.inc();
          break;

        case '-':
        case '+':
          // Test if this is an operator between 2 params, or the sign of a value
          if (
            this.m_paramStack.length > 0 &&
            !(this.m_paramStack[this.m_paramStack.length - 1] as AM_PARAM_ITEM).IsOperator()
          ) {
            // Seems an operator
            this.PushOperator(aText.c() === '+' ? parm_item_type.ADD : parm_item_type.SUB);
            aText.inc();
          } else {
            // seems the sign of a value
            dvalue = ReadDouble(aText, false);
            this.PushOperator(parm_item_type.PUSHVALUE, dvalue, true);
            found = true;
          }
          break;

        case '=': // A local definition found like $4=$3/2
          // At this point, one defered parameter is expected to be read.
          // this parameter value (the index) is stored in m_index.
          // The list of items is cleared
          aText.inc();
          this.m_paramStack = [];
          found = false;
          break;

        default:
          dvalue = ReadDouble(aText, false);
          this.PushOperator(parm_item_type.PUSHVALUE, dvalue, true);
          found = true;
          break;
      }
    }

    return found;
  }
}

/** `AM_PARAMS`. */
export type AM_PARAMS = AM_PARAM[];
