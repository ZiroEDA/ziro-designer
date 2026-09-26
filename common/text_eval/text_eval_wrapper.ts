// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `text_eval/text_eval_wrapper.h`: `EXPRESSION_EVALUATOR`, the `@{...}`
 * expression evaluator every text item runs its shown text through.
 *
 * NOT PORTED: the evaluator is `common/text_eval/` (a ~3800-line parser and
 * function library). Until it is, `Evaluate` returns its input unchanged,
 * which is what `text_vars.ts` has always done with `@{...}`. The class
 * exists so `EDA_TEXT::EvaluateText` and `GRTextWidth` are written against
 * the real name and the port drops in without touching their callers.
 */

export class EXPRESSION_EVALUATOR {
  /**
   * Evaluate all expressions in the input text and return the result.
   * Expressions are `@{...}` sequences; anything else passes through.
   */
  Evaluate(aInput: string): string {
    return aInput;
  }
}
