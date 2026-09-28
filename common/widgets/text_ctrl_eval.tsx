// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `TEXT_CTRL_EVAL` (`include/widgets/text_ctrl_eval.h`,
 * `common/widgets/text_ctrl_eval.cpp`): a `wxTextCtrl` that evaluates the
 * arithmetic typed into it when it loses the focus, so "3*4" reads back as 12.
 * KiCad uses it for unitless numbers: array counts, pad corner ratios, the 3D
 * model's scale, rotation and offset.
 *
 * - kill focus: `evaluate()` - if `m_eval.Process( GetValue() )` succeeds the
 *   text becomes `m_eval.Result()`, else it is left as typed; or, with
 *   `SetCustomEval`, that callback instead.
 * - set focus: `m_eval.OriginalText()`, when there is one, is put back.
 * - Enter: evaluate, then post `wxID_OK` to the parent (`onEnter`).
 *
 * `m_eval` is a `NUMERIC_EVALUATOR( EDA_UNITS::UNSCALED )`. The lemon one in
 * `common/libeval` is not ported; KiCad's own `NUMERIC_EVALUATOR_COMPAT`
 * (text_eval_wrapper.cpp), which has the same interface over the newer
 * expression evaluator, stands in for it.
 */

import { type CSSProperties, type JSX, useRef } from 'react';
import { NUMERIC_EVALUATOR_COMPAT } from '../text_eval/text_eval_wrapper.js';

/** `TEXT_CTRL_EVAL::evaluate()` on a string: the result, or the text as typed. */
export function textCtrlEvaluate(aValue: string): string {
  const eval_ = new NUMERIC_EVALUATOR_COMPAT('unscaled');

  if (eval_.Process(aValue)) return eval_.Result();

  return aValue;
}

export interface TextCtrlEvalProps {
  /** `GetValue()`. */
  value: string;
  /** `SetValue()` and `wxEVT_TEXT`: typing, and evaluation writing back. */
  onChange: (aValue: string) => void;
  /** `wxEVT_TEXT_ENTER`: after evaluating, the dialog's OK. */
  onEnter?: () => void;
  /** `SetCustomEval()`: replaces `evaluate()` on focus loss. */
  customEval?: (aValue: string) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
  /** Layout only. */
  style?: CSSProperties;
  ariaLabel?: string;
}

export function TextCtrlEval({
  value,
  onChange,
  onEnter,
  customEval,
  disabled,
  id,
  className,
  style,
  ariaLabel,
}: TextCtrlEvalProps): JSX.Element {
  const m_eval = useRef(new NUMERIC_EVALUATOR_COMPAT('unscaled'));

  const evaluate = (): void => {
    if (m_eval.current.Process(value)) {
      // TEXT_CTRL_EVAL::SetValue: wxTextCtrl::SetValue, then m_eval.Clear().
      onChange(m_eval.current.Result());
      m_eval.current.Clear();
    }
  };

  return (
    <input
      id={id}
      type="text"
      className={className}
      style={style}
      aria-label={ariaLabel}
      disabled={disabled}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onFocus={() => {
        // onTextFocusGet
        const oldStr = m_eval.current.OriginalText();
        if (oldStr.length) onChange(oldStr);
      }}
      onBlur={() => {
        // onTextFocusLost
        if (customEval) customEval(value);
        else evaluate();
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter') return;
        // onTextEnter: evaluate, then accept the changes and close the dialog.
        e.preventDefault();
        evaluate();
        onEnter?.();
      }}
    />
  );
}
