// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `MARGIN_OFFSET_BINDER` (`include/widgets/margin_offset_binder.h`,
 * `common/widgets/margin_offset_binder.cpp`): one text field for an absolute
 * offset AND a percentage ratio together - "-2mm + 1%", "0.5mm", "-10%" - the
 * way KiCad 10 enters a solder paste clearance. The final clearance is
 * `offset + ratio * pad size`.
 *
 * As `UNIT_BINDER` here, the class is the binder's engine over the control's
 * text; the field that draws it passes its text in (`onTextChanged`) and
 * shows `GetText()`. Kill focus parses and reformats.
 *
 * `m_eval` is `NUMERIC_EVALUATOR( m_units )`; the lemon one is not ported and
 * KiCad's `NUMERIC_EVALUATOR_COMPAT` stands in, as in `TEXT_CTRL_EVAL`.
 */

import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import {
  DoubleValueFromStringIn,
  type EdaIuScale,
  type EdaUnits,
  stringFromValue,
} from '../eda_units.js';
import { formatG } from '../string_utils.js';
import { NUMERIC_EVALUATOR_COMPAT } from '../text_eval/text_eval_wrapper.js';

/** `std::optional` over the two halves. */
export interface MarginOffset {
  /** The absolute offset in IU, or undefined when none was entered. */
  offset: number | undefined;
  /** The ratio as a fraction (-0.05 for -5%), or undefined. */
  ratio: number | undefined;
}

/** `wxString::ToDouble`: the whole string must be a number. */
function toDouble(s: string): number | undefined {
  if (s.trim() === '') return undefined;
  const v = Number(s);
  return Number.isFinite(v) ? v : undefined;
}

/**
 * `MARGIN_OFFSET_BINDER::parseInput`: split into terms at every `+` / `-` that
 * follows a term, then sum the `%` terms into the ratio and the rest, read in
 * `aUnits` unless they carry their own unit, into the offset. Returns null
 * when the text has neither (the C++ `false`).
 */
export function parseMarginOffset(
  aInput: string,
  aIuScale: EdaIuScale,
  aUnits: EdaUnits,
): MarginOffset | null {
  const input = aInput.trim();

  if (input === '') return { offset: undefined, ratio: undefined };

  // First, normalize the input by adding spaces around operators
  let normalized = '';
  let lastWasOperator = true; // Start as true to handle leading negative

  for (const ch of input) {
    if ((ch === '+' || ch === '-') && !lastWasOperator) {
      // This is an operator between terms
      normalized += ` ${ch} `;
      lastWasOperator = true;
    } else {
      normalized += ch;
      lastWasOperator = ch === '+' || ch === '-';
    }
  }

  // Split into terms
  const terms = normalized
    .split(' ')
    .map((t) => t.trim())
    .filter((t) => t !== '');

  // Process each term
  let totalOffset = 0.0;
  let totalRatio = 0.0;
  let hasOffset = false;
  let hasRatio = false;
  let sign = 1.0;

  for (const term of terms) {
    if (term === '+') {
      sign = 1.0;
      continue;
    }
    if (term === '-') {
      sign = -1.0;
      continue;
    }

    // Check if this term is a percentage
    if (term.endsWith('%')) {
      const value = toDouble(term.slice(0, -1).trim());

      if (value !== undefined) {
        totalRatio += (sign * value) / 100.0;
        hasRatio = true;
      }
    } else {
      // Try to parse as a distance value using the evaluator
      const evaluator = new NUMERIC_EVALUATOR_COMPAT(aUnits);

      if (evaluator.Process(term) && toDouble(evaluator.Result()) !== undefined) {
        // Convert from user units to internal units
        const iuValue = KiROUND(DoubleValueFromStringIn(aIuScale, aUnits, term));
        totalOffset += sign * iuValue;
        hasOffset = true;
      }
    }

    sign = 1.0; // Reset sign for next term
  }

  if (!hasOffset && !hasRatio) return null;

  return {
    // static_cast<int>: truncation toward zero.
    offset: hasOffset ? Math.trunc(totalOffset) : undefined,
    ratio: hasRatio ? totalRatio : undefined,
  };
}

/**
 * `MARGIN_OFFSET_BINDER::formatValue`: the offset if it is non-zero, then the
 * ratio as `%.4g%%` if it is, joined with " + " or " - ".
 */
export function formatMarginOffset(
  aValue: MarginOffset,
  aIuScale: EdaIuScale,
  aUnits: EdaUnits,
): string {
  let result = '';

  // Format offset value
  if (aValue.offset !== undefined && aValue.offset !== 0)
    result = stringFromValue(aIuScale, aUnits, aValue.offset);

  // Format ratio value
  if (aValue.ratio !== undefined && Math.abs(aValue.ratio) > 1e-9) {
    const percent = aValue.ratio * 100.0;

    if (result !== '') {
      // Add the ratio with appropriate sign
      if (percent >= 0) result += ` + ${formatG(percent, 4)}%`;
      else result += ` - ${formatG(-percent, 4)}%`;
    } else {
      result = `${formatG(percent, 4)}%`;
    }
  }

  return result;
}

export class MARGIN_OFFSET_BINDER {
  private m_iuScale: EdaIuScale;
  private m_units: EdaUnits;
  /** The control's text. */
  private m_text = '';
  private m_cachedOffset: number | undefined = undefined;
  private m_cachedRatio: number | undefined = undefined;
  private m_needsParsing = true;

  constructor(aIuScale: EdaIuScale, aUnits: EdaUnits) {
    this.m_iuScale = aIuScale;
    this.m_units = aUnits;
  }

  /** `getTextValue()`: what the control shows. */
  GetText(): string {
    return this.m_text;
  }

  SetOffsetValue(aValue: number | undefined): void {
    this.m_cachedOffset = aValue;
    this.m_needsParsing = false;
    this.setTextValue(this.formatValue());
  }

  SetRatioValue(aRatio: number | undefined): void {
    this.m_cachedRatio = aRatio;
    this.m_needsParsing = false;
    this.setTextValue(this.formatValue());
  }

  GetOffsetValue(): number | undefined {
    this.parseIfNeeded();
    return this.m_cachedOffset;
  }

  GetRatioValue(): number | undefined {
    this.parseIfNeeded();
    return this.m_cachedRatio;
  }

  /** Return true if the control holds no value (ie: empty string). */
  IsNull(): boolean {
    return this.m_text.trim() === '';
  }

  /** `onTextChanged`: the user edited the text; re-arm the parse. */
  onTextChanged(aText: string): void {
    this.m_text = aText;
    this.m_needsParsing = true;
  }

  /** `onKillFocus`: parse and reformat the value on focus loss. */
  onKillFocus(): void {
    const parsed = parseMarginOffset(this.m_text, this.m_iuScale, this.m_units);

    if (parsed) {
      this.m_cachedOffset = parsed.offset;
      this.m_cachedRatio = parsed.ratio;
      this.m_needsParsing = false;
      this.setTextValue(this.formatValue());
    }
  }

  /** `onUnitsChanged`: keep the values, reformat in the new units. */
  onUnitsChanged(aUnits: EdaUnits, aIuScale: EdaIuScale = this.m_iuScale): void {
    const offset = this.GetOffsetValue();
    const ratio = this.GetRatioValue();
    this.m_units = aUnits;
    this.m_iuScale = aIuScale;
    this.setTextValue(formatMarginOffset({ offset, ratio }, this.m_iuScale, this.m_units));
  }

  private parseIfNeeded(): void {
    if (!this.m_needsParsing) return;

    // parseInput clears both on the way in, even when it then fails.
    const parsed = parseMarginOffset(this.m_text, this.m_iuScale, this.m_units);
    this.m_cachedOffset = parsed?.offset;
    this.m_cachedRatio = parsed?.ratio;
    this.m_needsParsing = false;
  }

  private formatValue(): string {
    return formatMarginOffset(
      { offset: this.m_cachedOffset, ratio: this.m_cachedRatio },
      this.m_iuScale,
      this.m_units,
    );
  }

  private setTextValue(aValue: string): void {
    this.m_text = aValue;
  }
}
