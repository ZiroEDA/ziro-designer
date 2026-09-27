// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/text_eval/text_eval_wrapper.cpp` with its header
 * `include/text_eval/text_eval_wrapper.h`: `EXPRESSION_EVALUATOR`, the
 * `@{...}` expression evaluator every text item runs its shown text through,
 * the tokenizer that feeds the grammar (`text_eval.ts`), and
 * `NUMERIC_EVALUATOR_COMPAT`.
 *
 * Differences from the C++, all of them the platform's:
 *  - Text is a JavaScript string, not UTF-8 bytes. The tokenizer walks code
 *    points, as upstream's does after `to_utf32`; the byte searches for `@{`
 *    and braces are ASCII and land on the same characters.
 *  - The evaluator's `EDA_UNITS` is our `EdaUnits` string.
 */

import { ExpandTextVars } from '../common.js';
import type { EdaUnits } from '../eda_units.js';
import { formatG, fixed } from '../plotters/fmt.js';
import { KI_EVAL_TOKEN as TextEvalToken, Parse, ParseAlloc, ParseFree } from './text_eval.js';
import {
  DOC_PROCESSOR,
  type DOC,
  fromCharsWhole,
  MakeNumberToken,
  MakeStringToken,
  SetErrorCollector,
  type TOKEN_TYPE,
  type VariableCallback,
} from './text_eval_parser.js';
import {
  ERROR_COLLECTOR,
  MakeError,
  MakeValue,
  type Result,
  type Value,
} from './text_eval_types.js';
import { UnitRegistry } from './text_eval_units.js';

export type { VariableCallback } from './text_eval_parser.js';

// ---------------------------------------------------------------------------
// utf8_utils

/** `utf8_utils::CHARACTER_CLASSIFIER`, on code points. */
const CLASSIFIER = {
  is_whitespace(cp: number): boolean {
    return (
      cp === 0x20 ||
      cp === 0x09 ||
      cp === 0x0d ||
      cp === 0x0a ||
      cp === 0x0c ||
      cp === 0x0b ||
      cp === 0xa0 || // Non-breaking space
      (cp >= 0x2000 && cp <= 0x200a) ||
      cp === 0x2028 ||
      cp === 0x2029 ||
      cp === 0x202f ||
      cp === 0x205f ||
      cp === 0x3000
    );
  },

  is_digit(cp: number): boolean {
    return cp >= 0x30 && cp <= 0x39;
  },

  is_ascii_alpha(cp: number): boolean {
    return (cp >= 0x61 && cp <= 0x7a) || (cp >= 0x41 && cp <= 0x5a);
  },

  /** Basic Latin plus every code point above ASCII except the replacement character. */
  is_alpha(cp: number): boolean {
    return CLASSIFIER.is_ascii_alpha(cp) || (cp >= 0x80 && cp <= 0x10ffff && cp !== 0xfffd);
  },

  is_alnum(cp: number): boolean {
    return CLASSIFIER.is_alpha(cp) || CLASSIFIER.is_digit(cp);
  },
};

// Data: KiCad's SI prefix table.
const SI_PREFIXES: ReadonlyMap<number, number> = new Map([
  [0x61, 1e-18], // a
  [0x66, 1e-15], // f
  [0x70, 1e-12], // p
  [0x6e, 1e-9], // n
  [0x75, 1e-6], // u
  [0xb5, 1e-6], // µ MICRO SIGN
  [0x3bc, 1e-6], // μ GREEK SMALL LETTER MU
  [0x6d, 1e-3], // m
  [0x6b, 1e3], // k
  [0x4b, 1e3], // K
  [0x4d, 1e6], // M
  [0x47, 1e9], // G
  [0x54, 1e12], // T
  [0x50, 1e15], // P
  [0x45, 1e18], // E
]);

/** `utf8_utils::SI_PREFIX_HANDLER`. */
const SI_HANDLER = {
  is_si_prefix(cp: number): boolean {
    return SI_PREFIXES.has(cp);
  },

  get_multiplier(cp: number): number {
    return SI_PREFIXES.get(cp) ?? 1.0;
  },
};

// ---------------------------------------------------------------------------
// KIEVAL_UNIT_CONV

/** `KIEVAL_UNIT_CONV::Unit`. */
enum KievalUnit {
  Invalid,
  UM,
  MM,
  CM,
  Inch,
  Mil,
  Degrees,
  SI,
  Femtoseconds,
  Picoseconds,
  PsPerInch,
  PsPerCm,
  PsPerMm,
}

/** `KIEVAL_UNIT_CONV::parseUnit`: through the registry, folded to the evaluator's units. */
function parseKievalUnit(aUnitStr: string): KievalUnit {
  switch (UnitRegistry.parseUnit(aUnitStr)) {
    case 5: // MM
      return KievalUnit.MM;
    case 6: // CM
      return KievalUnit.CM;
    case 7: // INCH
    case 12: // INCH_QUOTE
      return KievalUnit.Inch;
    case 8: // MIL
    case 3: // THOU
      return KievalUnit.Mil;
    case 9: // UM
      return KievalUnit.UM;
    case 4: // DEG
    case 13: // DEGREE_SYMBOL
      return KievalUnit.Degrees;
    case 10: // PS
      return KievalUnit.Picoseconds;
    case 11: // FS
      return KievalUnit.Femtoseconds;
    case 2: // PS_PER_IN
      return KievalUnit.PsPerInch;
    case 1: // PS_PER_CM
      return KievalUnit.PsPerCm;
    case 0: // PS_PER_MM
      return KievalUnit.PsPerMm;
    default:
      return KievalUnit.Invalid;
  }
}

// ---------------------------------------------------------------------------
// KIEVAL_TEXT_TOKENIZER

const enum TOKENIZER_CONTEXT {
  TEXT, // Regular text content - alphabetic should be TEXT tokens
  EXPRESSION, // Inside @{...} or ${...} - alphabetic should be IDENTIFIER tokens
}

const cpString = (aCps: number[]) => String.fromCodePoint(...aCps);

/** `KIEVAL_TEXT_TOKENIZER`. */
class KIEVAL_TEXT_TOKENIZER {
  private readonly m_text: number[];
  private m_pos = 0;
  private m_line = 1;
  private m_column = 1;
  private m_context = TOKENIZER_CONTEXT.TEXT;
  private m_braceNestingLevel = 0; // Track nesting level of expressions
  private readonly m_errorCollector: ERROR_COLLECTOR | null;
  private readonly m_defaultUnits: EdaUnits;

  constructor(
    aInput: string,
    aErrorCollector: ERROR_COLLECTOR | null = null,
    aDefaultUnits: EdaUnits = 'mm',
  ) {
    this.m_errorCollector = aErrorCollector;
    this.m_defaultUnits = aDefaultUnits;
    this.m_text = Array.from(aInput, (ch) => ch.codePointAt(0)!);
  }

  private current_char(): number {
    return this.m_pos < this.m_text.length ? this.m_text[this.m_pos]! : 0;
  }

  private peek_char(aOffset = 1): number {
    const peekPos = this.m_pos + aOffset;
    return peekPos < this.m_text.length ? this.m_text[peekPos]! : 0;
  }

  private advance_position(aCount = 1): void {
    for (let i = 0; i < aCount && this.m_pos < this.m_text.length; ++i) {
      if (this.m_text[this.m_pos] === 0x0a) {
        ++this.m_line;
        this.m_column = 1;
      } else {
        ++this.m_column;
      }

      ++this.m_pos;
    }
  }

  private skip_whitespace(): void {
    while (this.m_pos < this.m_text.length && CLASSIFIER.is_whitespace(this.current_char()))
      this.advance_position();
  }

  private add_error(aMessage: string): void {
    this.m_errorCollector?.AddError(`Line ${this.m_line}, Column ${this.m_column}: ${aMessage}`);
  }

  private parse_string_literal(aQuoteChar: number): TOKEN_TYPE {
    this.advance_position(); // Skip opening quote

    const content: number[] = [];

    while (this.m_pos < this.m_text.length && this.current_char() !== aQuoteChar) {
      const c = this.current_char();

      if (c === 0x5c /* \ */ && this.m_pos + 1 < this.m_text.length) {
        const escaped = this.peek_char();
        this.advance_position(2);

        switch (escaped) {
          case 0x6e: // n
            content.push(0x0a);
            break;
          case 0x74: // t
            content.push(0x09);
            break;
          case 0x72: // r
            content.push(0x0d);
            break;
          case 0x5c: // \
            content.push(0x5c);
            break;
          case 0x22: // "
            content.push(0x22);
            break;
          case 0x27: // '
            content.push(0x27);
            break;
          case 0x30: // 0
            content.push(0);
            break;
          case 0x78: {
            // Hexadecimal escape \xHH
            let hex = '';

            for (let i = 0; i < 2 && this.m_pos < this.m_text.length; ++i) {
              const hexChar = this.current_char();

              if (
                (hexChar >= 0x30 && hexChar <= 0x39) ||
                (hexChar >= 0x41 && hexChar <= 0x46) ||
                (hexChar >= 0x61 && hexChar <= 0x66)
              ) {
                hex += String.fromCodePoint(hexChar);
                this.advance_position();
              } else {
                break;
              }
            }

            if (hex !== '') content.push(Number.parseInt(hex, 16));
            else content.push(0x5c, 0x78);

            break;
          }
          default:
            content.push(0x5c, escaped);
            break;
        }
      } else if (c === 0x0a) {
        this.add_error('Unterminated string literal');
        break;
      } else {
        content.push(c);
        this.advance_position();
      }
    }

    if (this.m_pos < this.m_text.length && this.current_char() === aQuoteChar)
      this.advance_position(); // Skip closing quote
    else this.add_error('Missing closing quote in string literal');

    return MakeStringToken(cpString(content));
  }

  /** The run of unit characters (letters, `"` and `'`) starting at `aPos`. */
  private unitRunAt(aPos: number): number[] {
    const potentialUnit: number[] = [];
    let tempPos = aPos;

    while (tempPos < this.m_text.length) {
      const unitChar = this.m_text[tempPos]!;

      if (CLASSIFIER.is_alpha(unitChar) || unitChar === 0x22 || unitChar === 0x27) {
        potentialUnit.push(unitChar);
        tempPos++;
      } else {
        break;
      }
    }

    return potentialUnit;
  }

  private parse_number(): TOKEN_TYPE {
    let numberText = '';
    let multiplier = 1.0;

    // Parse integer part
    while (this.m_pos < this.m_text.length && CLASSIFIER.is_digit(this.current_char())) {
      numberText += String.fromCodePoint(this.current_char());
      this.advance_position();
    }

    // Handle decimal point, SI prefix, or unit suffix
    if (this.m_pos < this.m_text.length) {
      const c = this.current_char();

      // Only treat comma as decimal separator in text context, not expression context
      // This prevents comma from interfering with function argument separation
      if (c === 0x2e || (c === 0x2c && this.m_context !== TOKENIZER_CONTEXT.EXPRESSION)) {
        numberText += '.';
        this.advance_position();
      } else if (this.m_context === TOKENIZER_CONTEXT.EXPRESSION && CLASSIFIER.is_alpha(c)) {
        // In expression context, check for unit first before SI prefix (unit strings are longer)
        const potentialUnit = this.unitRunAt(this.m_pos);

        if (potentialUnit.length > 0) {
          if (parseKievalUnit(cpString(potentialUnit)) !== KievalUnit.Invalid) {
            // This is a valid unit - don't treat the first character as SI prefix
            // The unit parsing will happen later
          } else if (SI_HANDLER.is_si_prefix(c)) {
            // Not a valid unit, so treat as SI prefix
            multiplier = SI_HANDLER.get_multiplier(c);
            this.advance_position();
          }
        } else if (SI_HANDLER.is_si_prefix(c)) {
          multiplier = SI_HANDLER.get_multiplier(c);
          this.advance_position();
        }
      } else if (SI_HANDLER.is_si_prefix(c)) {
        // In text context, treat as SI prefix
        multiplier = SI_HANDLER.get_multiplier(c);
        this.advance_position();
      }
    }

    // Parse fractional part
    while (this.m_pos < this.m_text.length && CLASSIFIER.is_digit(this.current_char())) {
      numberText += String.fromCodePoint(this.current_char());
      this.advance_position();
    }

    // Check for scientific notation (e.g., 1e-3, 3.5E6)
    if (this.m_pos < this.m_text.length) {
      const c = this.current_char();

      if (c === 0x65 || c === 0x45) {
        // Look ahead to see if this is scientific notation (followed by +, -, or digit)
        const tempPos = this.m_pos + 1;
        let isScientific = false;

        if (tempPos < this.m_text.length) {
          const next = this.m_text[tempPos]!;

          if (next === 0x2b || next === 0x2d || CLASSIFIER.is_digit(next)) isScientific = true;
        }

        if (isScientific) {
          numberText += String.fromCodePoint(c); // Add 'e' or 'E'
          this.advance_position();

          // Optional sign
          if (
            this.m_pos < this.m_text.length &&
            (this.current_char() === 0x2b || this.current_char() === 0x2d)
          ) {
            numberText += String.fromCodePoint(this.current_char());
            this.advance_position();
          }

          // Exponent digits (required)
          if (this.m_pos < this.m_text.length && CLASSIFIER.is_digit(this.current_char())) {
            while (this.m_pos < this.m_text.length && CLASSIFIER.is_digit(this.current_char())) {
              numberText += String.fromCodePoint(this.current_char());
              this.advance_position();
            }
          } else {
            // Invalid scientific notation - will fail in conversion
            this.add_error('Invalid scientific notation: missing exponent digits');
          }
        }
      }
    }

    // Check for SI prefix after fractional part (for numbers like 0.3M)
    if (this.m_pos < this.m_text.length && multiplier === 1.0) {
      const c = this.current_char();

      if (this.m_context === TOKENIZER_CONTEXT.EXPRESSION && CLASSIFIER.is_alpha(c)) {
        // Look ahead to check for unit vs SI prefix
        const potentialUnit = this.unitRunAt(this.m_pos);

        if (potentialUnit.length > 0) {
          if (
            parseKievalUnit(cpString(potentialUnit)) === KievalUnit.Invalid &&
            SI_HANDLER.is_si_prefix(c)
          ) {
            // Not a valid unit, so treat as SI prefix
            multiplier = SI_HANDLER.get_multiplier(c);
            this.advance_position();
          }
        }
      } else if (SI_HANDLER.is_si_prefix(c)) {
        // In text context, treat as SI prefix
        multiplier = SI_HANDLER.get_multiplier(c);
        this.advance_position();
      }
    }

    // Convert to double safely
    let value = 0.0;

    if (numberText !== '' && numberText !== '.') {
      const parsed = fromCharsWhole(numberText);

      if (parsed === null) {
        this.add_error(`Invalid number format: Cannot convert '${numberText}' to number`);
        value = 0.0;
      } else {
        value = parsed * multiplier;

        if (!Number.isFinite(value)) {
          this.add_error('Number out of range');
          value = 0.0;
        }
      }
    }

    // Look for unit suffix
    if (this.m_pos < this.m_text.length && this.m_context === TOKENIZER_CONTEXT.EXPRESSION) {
      // Skip any whitespace between number and unit
      const whitespaceStart = this.m_pos;

      while (this.m_pos < this.m_text.length && CLASSIFIER.is_whitespace(this.current_char()))
        this.advance_position();

      // Parse potential unit suffix
      const unitText: number[] = [];

      while (this.m_pos < this.m_text.length) {
        const c = this.current_char();

        // Unit characters: letters, quotes for inches
        if (CLASSIFIER.is_alpha(c) || c === 0x22 || c === 0x27) {
          unitText.push(c);
          this.advance_position();
        } else {
          break;
        }
      }

      if (unitText.length > 0 && parseKievalUnit(cpString(unitText)) !== KievalUnit.Invalid) {
        // Successfully parsed unit - convert value to default units
        value = UnitRegistry.convertToEdaUnits(value, cpString(unitText), this.m_defaultUnits);
      } else {
        // Not a valid unit (or none) - backtrack to before the whitespace. Only
        // the position moves back, as upstream; line and column do not.
        this.m_pos = whitespaceStart;
      }
    }

    return MakeNumberToken(value);
  }

  private parse_identifier(): TOKEN_TYPE {
    const identifier: number[] = [];

    while (
      this.m_pos < this.m_text.length &&
      (CLASSIFIER.is_alnum(this.current_char()) || this.current_char() === 0x5f)
    ) {
      identifier.push(this.current_char());
      this.advance_position();
    }

    return MakeStringToken(cpString(identifier));
  }

  private parse_text_content(): TOKEN_TYPE {
    const text: number[] = [];

    while (this.m_pos < this.m_text.length) {
      const current = this.current_char();
      const next = this.peek_char();

      // Stop at special sequences
      if ((current === 0x40 || current === 0x24) && next === 0x7b) break;

      text.push(current);
      this.advance_position();
    }

    return MakeStringToken(cpString(text));
  }

  get_next_token(aTokenValue: { value: TOKEN_TYPE }): TextEvalToken {
    aTokenValue.value = MakeNumberToken(0.0);

    if (this.m_pos >= this.m_text.length) return TextEvalToken.ENDS;

    // Only skip whitespace in expression context
    if (this.m_context === TOKENIZER_CONTEXT.EXPRESSION) {
      this.skip_whitespace();

      if (this.m_pos >= this.m_text.length) return TextEvalToken.ENDS;
    }

    const current = this.current_char();
    const next = this.peek_char();

    // Multi-character tokens that switch to expression context
    if (current === 0x40 && next === 0x7b) {
      this.advance_position(2);
      this.m_context = TOKENIZER_CONTEXT.EXPRESSION;
      this.m_braceNestingLevel++;
      aTokenValue.value = MakeStringToken('@{');
      return TextEvalToken.AT_OPEN;
    }

    if (current === 0x24 && next === 0x7b) {
      this.advance_position(2);
      this.m_context = TOKENIZER_CONTEXT.EXPRESSION;
      this.m_braceNestingLevel++;
      aTokenValue.value = MakeStringToken('${');
      return TextEvalToken.DOLLAR_OPEN;
    }

    // Handle closing brace specially to manage context correctly
    if (current === 0x7d) {
      this.advance_position();
      this.m_braceNestingLevel--;

      if (this.m_braceNestingLevel <= 0) {
        this.m_braceNestingLevel = 0; // Clamp to zero
        this.m_context = TOKENIZER_CONTEXT.TEXT; // Switch back to text context only when fully unnested
      }

      aTokenValue.value = MakeStringToken('}');
      return TextEvalToken.CLOSE_BRACE;
    }

    // Multi-character comparison operators
    if (next === 0x3d /* = */) {
      const op =
        current === 0x3c
          ? TextEvalToken.LE
          : current === 0x3e
            ? TextEvalToken.GE
            : current === 0x3d
              ? TextEvalToken.EQ
              : current === 0x21
                ? TextEvalToken.NE
                : null;

      if (op !== null) {
        this.advance_position(2);
        aTokenValue.value = MakeStringToken(`${String.fromCodePoint(current)}=`);
        return op;
      }
    }

    // Single character tokens (only in expression context)
    if (this.m_context === TOKENIZER_CONTEXT.EXPRESSION) {
      const single = SINGLE_CHAR_TOKENS.get(current);

      if (single !== undefined) {
        this.advance_position();
        aTokenValue.value = MakeStringToken(String.fromCodePoint(current));
        return single;
      }
    }

    // Complex tokens
    if (current === 0x22 || current === 0x27) {
      aTokenValue.value = this.parse_string_literal(current);
      return TextEvalToken.STRING;
    }

    if (CLASSIFIER.is_digit(current) || (current === 0x2e && CLASSIFIER.is_digit(next))) {
      aTokenValue.value = this.parse_number();
      return TextEvalToken.NUMBER;
    }

    // Context-aware handling of alphabetic content
    if (CLASSIFIER.is_alpha(current) || current === 0x5f) {
      if (this.m_context === TOKENIZER_CONTEXT.EXPRESSION) {
        // In expression context, alphabetic content is an identifier
        aTokenValue.value = this.parse_identifier();
        return TextEvalToken.IDENTIFIER;
      }

      // In text context, alphabetic content is part of regular text
      aTokenValue.value = this.parse_text_content();
      return TextEvalToken.TEXT;
    }

    // Default to text content
    aTokenValue.value = this.parse_text_content();
    return aTokenValue.value.text === '' ? TextEvalToken.ENDS : TextEvalToken.TEXT;
  }

  has_more_tokens(): boolean {
    return this.m_pos < this.m_text.length;
  }

  get_line(): number {
    return this.m_line;
  }

  get_column(): number {
    return this.m_column;
  }
}

const SINGLE_CHAR_TOKENS: ReadonlyMap<number, TextEvalToken> = new Map([
  [0x28, TextEvalToken.LPAREN],
  [0x29, TextEvalToken.RPAREN],
  [0x2b, TextEvalToken.PLUS],
  [0x2d, TextEvalToken.MINUS],
  [0x2a, TextEvalToken.MULTIPLY],
  [0x2f, TextEvalToken.DIVIDE],
  [0x25, TextEvalToken.MODULO],
  [0x5e, TextEvalToken.POWER],
  [0x2c, TextEvalToken.COMMA],
  [0x3c, TextEvalToken.LT],
  [0x3e, TextEvalToken.GT],
]);

// ---------------------------------------------------------------------------
// EXPRESSION_EVALUATOR

/**
 * `wxString::FromDouble( v )`: `%g`. A value `%g` prints with an exponent
 * then fails the unit check that sent it here, as upstream.
 */
function fromDouble(aValue: number): string {
  return formatG(aValue);
}

type NumVars = ReadonlyMap<string, number>;
type StrVars = ReadonlyMap<string, string>;

const EMPTY_NUM: NumVars = new Map();
const EMPTY_STR: StrVars = new Map();

/**
 * High-level wrapper for evaluating expressions with `@{expression}` syntax
 * and `${variable}` references.
 *
 * The C++ overloads its constructor on `( bool )`, `( EDA_UNITS, bool )`,
 * `( VariableCallback, bool )` and `( EDA_UNITS, VariableCallback, bool )`;
 * here the arguments are read by type in the same orders. `Clone()` is the
 * copy constructor.
 */
export class EXPRESSION_EVALUATOR {
  private m_variables = new Map<string, Value>();
  private m_lastErrors: ERROR_COLLECTOR | null = new ERROR_COLLECTOR();
  private m_clearVariablesOnEvaluate = false;
  private m_customCallback: VariableCallback | null = null;
  private m_useCustomCallback = false;
  private m_defaultUnits: EdaUnits = 'mm';

  constructor(
    aFirst?: boolean | EdaUnits | VariableCallback,
    aSecond?: boolean | VariableCallback,
    aThird?: boolean,
  ) {
    let args: unknown[] = [aFirst, aSecond, aThird];

    if (typeof args[0] === 'string') {
      this.m_defaultUnits = args[0] as EdaUnits;
      args = args.slice(1);
    }

    if (typeof args[0] === 'function') {
      this.m_customCallback = args[0] as VariableCallback;
      this.m_useCustomCallback = true;
      args = args.slice(1);
    }

    this.m_clearVariablesOnEvaluate = args[0] === true;
  }

  /** The copy constructor: variables and settings, and the last errors (not warnings). */
  Clone(): EXPRESSION_EVALUATOR {
    const copy = new EXPRESSION_EVALUATOR(this.m_clearVariablesOnEvaluate);
    copy.m_variables = new Map(this.m_variables);
    copy.m_customCallback = this.m_customCallback;
    copy.m_useCustomCallback = this.m_useCustomCallback;
    copy.m_defaultUnits = this.m_defaultUnits;

    if (this.m_lastErrors) {
      for (const error of this.m_lastErrors.GetErrors()) copy.m_lastErrors!.AddError(error);
    }

    return copy;
  }

  SetVariableCallback(aCallback: VariableCallback | null): void {
    this.m_customCallback = aCallback;
    this.m_useCustomCallback = true;
  }

  ClearVariableCallback(): void {
    this.m_customCallback = null;
    this.m_useCustomCallback = false;
  }

  HasVariableCallback(): boolean {
    return this.m_useCustomCallback && this.m_customCallback !== null;
  }

  SetDefaultUnits(aUnits: EdaUnits): void {
    this.m_defaultUnits = aUnits;
  }

  GetDefaultUnits(): EdaUnits {
    return this.m_defaultUnits;
  }

  /** `SetVariable( name, double )` and `SetVariable( name, wxString )`. */
  SetVariable(aName: string, aValue: number | string): void {
    this.m_variables.set(aName, aValue);
  }

  RemoveVariable(aName: string): boolean {
    return this.m_variables.delete(aName);
  }

  ClearVariables(): void {
    this.m_variables.clear();
  }

  HasVariable(aName: string): boolean {
    return this.m_variables.has(aName);
  }

  GetVariable(aName: string): string {
    const value = this.m_variables.get(aName);

    if (value === undefined) return '';

    if (typeof value === 'number') {
      // Smart formatting - whole numbers don't need decimal places
      if (value === Math.floor(value) && Math.abs(value) < 1e15) return fixed(value, 0);

      return formatG(value);
    }

    return value;
  }

  /** In `std::unordered_map` order upstream, which is unspecified; insertion order here. */
  GetVariableNames(): string[] {
    return [...this.m_variables.keys()];
  }

  SetVariables(aVariables: ReadonlyMap<string, number | string>): void {
    for (const [name, value] of aVariables) this.SetVariable(name, value);
  }

  /**
   * Evaluate all `@{...}` expressions in the input, with optional temporary
   * numeric and string variables that are not stored.
   */
  Evaluate(
    aInput: string,
    aTempNumericVars: NumVars = EMPTY_NUM,
    aTempStringVars: StrVars = EMPTY_STR,
  ): string {
    // Clear previous errors
    this.ClearErrors();

    // Expand ${variable} patterns that are OUTSIDE of @{} expressions
    const input = this.expandVariablesOutsideExpressions(aInput, aTempNumericVars, aTempStringVars);

    // Create combined callback for all variable sources
    const combinedCallback = this.createCombinedCallback(aTempNumericVars, aTempStringVars);

    // Evaluate using parser
    const [result, hadErrors] = this.evaluateWithParser(input, combinedCallback);

    // Update error state if evaluation had errors
    if (hadErrors) {
      if (!this.m_lastErrors) this.m_lastErrors = new ERROR_COLLECTOR();

      this.m_lastErrors.AddError('Evaluation failed');
    }

    // Clear variables if requested
    if (this.m_clearVariablesOnEvaluate) this.ClearVariables();

    return result;
  }

  HasErrors(): boolean {
    return this.m_lastErrors?.HasErrors() ?? false;
  }

  GetErrorCount(): number {
    return this.m_lastErrors?.GetErrors().length ?? 0;
  }

  GetErrorSummary(): string {
    return this.m_lastErrors?.GetAllMessages() ?? '';
  }

  GetErrors(): string[] {
    return [...(this.m_lastErrors?.GetErrors() ?? [])];
  }

  ClearErrors(): void {
    this.m_lastErrors?.Clear();
  }

  SetClearVariablesOnEvaluate(aEnable: boolean): void {
    this.m_clearVariablesOnEvaluate = aEnable;
  }

  GetClearVariablesOnEvaluate(): boolean {
    return this.m_clearVariablesOnEvaluate;
  }

  /** Test if an expression can be parsed without evaluating it. */
  TestExpression(aExpression: string): boolean {
    // Create a test input with the expression wrapped in @{}
    const testInput = `@{${aExpression}}`;

    // Create a minimal callback that returns errors for all variables
    const testCallback: VariableCallback = () =>
      MakeError<Value>('Test mode - no variables available');

    this.evaluateWithParser(testInput, testCallback);

    // Check if there were parsing errors (ignore evaluation errors for undefined variables)
    if (this.m_lastErrors) {
      for (const error of this.m_lastErrors.GetErrors()) {
        if (error.includes('Syntax error') || error.includes('Parser failed')) return false; // Found syntax error
      }
    }

    return true; // No syntax errors found
  }

  CountExpressions(aInput: string): number {
    let count = 0;
    let pos = 0;

    for (;;) {
      pos = aInput.indexOf('@{', pos);

      if (pos === -1) break;

      count++;
      pos += 2; // Move past "@{"
    }

    return count;
  }

  ExtractExpressions(aInput: string): string[] {
    const expressions: string[] = [];
    let pos = 0;

    for (;;) {
      pos = aInput.indexOf('@{', pos);

      if (pos === -1) break;

      const start = pos + 2; // Skip "@{"
      const end = aInput.indexOf('}', start);

      if (end === -1) break; // No closing brace found

      expressions.push(aInput.slice(start, end));
      pos = end + 1;
    }

    return expressions;
  }

  private expandVariablesOutsideExpressions(
    aInput: string,
    aTempNumericVars: NumVars,
    aTempStringVars: StrVars,
  ): string {
    let result = aInput;
    let pos = 0;

    // Track positions of @{} expressions to avoid substituting inside them
    const expressionRanges: [number, number][] = [];

    // Find all @{} expression ranges
    for (;;) {
      pos = result.indexOf('@{', pos);

      if (pos === -1) break;

      const start = pos;
      let braceCount = 1;
      let searchPos = start + 2; // Skip "@{"

      // Find matching closing brace
      while (searchPos < result.length && braceCount > 0) {
        if (result[searchPos] === '{') braceCount++;
        else if (result[searchPos] === '}') braceCount--;

        searchPos++;
      }

      if (braceCount === 0) expressionRanges.push([start, searchPos]); // searchPos is after '}'

      pos = searchPos;
    }

    // Now find and replace ${variable} patterns that are NOT inside @{} expressions
    pos = 0;

    for (;;) {
      pos = result.indexOf('${', pos);

      if (pos === -1) break;

      // Check if this ${} is inside any @{} expression. The ranges were taken
      // before any replacement, as upstream, so they drift once one is made.
      const at = pos;
      const insideExpression = expressionRanges.some(
        ([first, second]) => at >= first && at < second,
      );

      if (insideExpression) {
        // Special case: if this variable is immediately followed by unit text,
        // we should expand it to allow proper unit parsing
        const closePos = result.indexOf('}', pos + 2);

        if (closePos === -1) {
          pos += 2; // Invalid pattern, skip
          continue;
        }

        const afterBrace = closePos + 1;
        let followedByUnit = false;

        if (afterBrace < result.length) {
          for (const unit of UnitRegistry.getAllUnitStrings()) {
            if (
              afterBrace + unit.length <= result.length &&
              result.substr(afterBrace, unit.length) === unit
            ) {
              followedByUnit = true;
              break;
            }
          }
        }

        if (!followedByUnit) {
          pos += 2; // Skip this ${} since it's inside an expression and not followed by units
          continue;
        }
        // If followed by units, continue with variable expansion below
      }

      // Find the closing brace
      const closePos = result.indexOf('}', pos + 2);

      if (closePos === -1) {
        pos += 2; // Invalid ${} pattern, skip
        continue;
      }

      // Extract variable name
      const varName = result.slice(pos + 2, closePos);
      let replacement = '';
      let found = false;

      // Check temporary string variables first
      const tempString = aTempStringVars.get(varName);

      if (tempString !== undefined) {
        replacement = tempString;
        found = true;
      } else {
        // Check temporary numeric variables
        const tempNumber = aTempNumericVars.get(varName);

        if (tempNumber !== undefined) {
          replacement = fromDouble(tempNumber);
          found = true;
        } else {
          // Check instance variables
          const value = this.m_variables.get(varName);

          if (typeof value === 'string') {
            replacement = value;
            found = true;
          } else if (typeof value === 'number') {
            replacement = fromDouble(value);
            found = true;
          }
        }
      }

      if (found) {
        // Replace ${variable} with its value
        result = result.slice(0, pos) + replacement + result.slice(closePos + 1);
        pos += replacement.length;
      } else {
        // Variable not found, record error but leave ${variable} unchanged
        if (!this.m_lastErrors) this.m_lastErrors = new ERROR_COLLECTOR();

        this.m_lastErrors.AddError(`Undefined variable: ${varName}`);
        pos = closePos + 1;
      }
    }

    return result;
  }

  private createCombinedCallback(
    aTempNumericVars: NumVars,
    aTempStringVars: StrVars,
  ): VariableCallback {
    return (aVarName: string): Result<Value> => {
      // Priority 1: Custom callback (if set)
      if (this.m_useCustomCallback && this.m_customCallback) {
        const customResult = this.m_customCallback(aVarName);

        if (customResult.HasValue()) return customResult;

        // If custom callback returned an error, continue to fallback options
      }

      // Priority 2: Temporary string variables
      const tempString = aTempStringVars.get(aVarName);

      if (tempString !== undefined) return MakeValue<Value>(tempString);

      // Priority 3: Temporary numeric variables
      const tempNumber = aTempNumericVars.get(aVarName);

      if (tempNumber !== undefined) return MakeValue<Value>(tempNumber);

      // Priority 4: Stored variables
      const stored = this.m_variables.get(aVarName);

      if (stored !== undefined) return MakeValue<Value>(stored);

      // Priority 5: Use KiCad's ExpandTextVars for system/project variables.
      // Both resolvers answer false, so ExpandTextVars leaves `${name}` as it
      // was and this never resolves anything - upstream's behaviour, kept.
      const testString = `\${${aVarName}}`;
      let wasResolved = false;

      ExpandTextVars(testString, () => {
        wasResolved = true;
        return false; // Don't replace, just detect
      });

      if (wasResolved) {
        const resolvedValue = ExpandTextVars(testString, () => false);

        // Check if it was actually resolved (not still ${varname})
        if (resolvedValue !== testString) {
          // Try to parse as number first
          const numValue = fromCharsWhole(resolvedValue);

          if (numValue !== null) return MakeValue<Value>(numValue);

          // Not a number, return as string
          return MakeValue<Value>(resolvedValue);
        }
      }

      // Priority 6: If custom callback was tried and failed, return its error
      if (this.m_useCustomCallback && this.m_customCallback) return this.m_customCallback(aVarName); // Return the original error

      // No variable found anywhere
      return MakeError<Value>(`Undefined variable: ${aVarName}`);
    };
  }

  private evaluateWithParser(
    aInput: string,
    aVariableCallback: VariableCallback,
  ): [string, boolean] {
    try {
      // Try partial error recovery first
      const [partialResult, partialHadErrors] = this.evaluateWithPartialErrorRecovery(
        aInput,
        aVariableCallback,
      );

      // If partial recovery made any progress (result differs from input), use it
      if (partialResult !== aInput) return [partialResult, partialHadErrors];

      // If no progress was made, try original full parsing approach as fallback
      return this.evaluateWithFullParser(aInput, aVariableCallback);
    } catch (e) {
      this.m_lastErrors?.AddError(`Exception: ${e instanceof Error ? e.message : String(e)}`);
      return [aInput, true];
    }
  }

  private evaluateWithPartialErrorRecovery(
    aInput: string,
    aVariableCallback: VariableCallback,
  ): [string, boolean] {
    let result = aInput;
    let hadAnyErrors = false;
    let pos = 0;

    const expressionRanges: [number, number][] = [];

    // Find all expression ranges
    for (;;) {
      pos = result.indexOf('@{', pos);

      if (pos === -1) break;

      const start = pos;
      const exprStart = pos + 2; // Skip "@{"
      let braceCount = 1;
      let searchPos = exprStart;

      // Find matching closing brace, handling nested braces
      while (searchPos < result.length && braceCount > 0) {
        if (result[searchPos] === '{') braceCount++;
        else if (result[searchPos] === '}') braceCount--;

        searchPos++;
      }

      if (braceCount === 0) {
        const end = searchPos; // Position after the '}'
        expressionRanges.push([start, end]);
        pos = end;
      } else {
        pos = exprStart; // Skip this malformed expression
      }
    }

    // Process expressions from right to left to avoid position shifts
    for (let i = expressionRanges.length - 1; i >= 0; --i) {
      const [start, end] = expressionRanges[i]!;
      const fullExpr = result.slice(start, end);
      const innerExpr = result.slice(start + 2, end - 1); // Remove @{ and }

      try {
        // Create a simple expression for evaluation
        const testExpr = `@{${innerExpr}}`;

        // A temporary error collector captures errors for this specific expression
        let oldErrors = this.m_lastErrors;
        this.m_lastErrors = new ERROR_COLLECTOR();

        // Use the full parser for this single expression
        let evalResult: string;
        let evalHadErrors: boolean;

        try {
          [evalResult, evalHadErrors] = this.evaluateWithFullParser(testExpr, aVariableCallback);
        } catch (e) {
          this.m_lastErrors = oldErrors;
          throw e;
        }

        if (!evalHadErrors) {
          // Successful evaluation, replace in result
          result = result.slice(0, start) + evalResult + result.slice(end);
        } else {
          // Expression failed - add a specific error for this expression
          hadAnyErrors = true;

          if (!oldErrors) oldErrors = new ERROR_COLLECTOR();

          oldErrors.AddError(`Failed to evaluate expression: ${fullExpr}`);
        }

        // Restore the main error collector
        this.m_lastErrors = oldErrors;
      } catch {
        // Report exception as an error for this expression
        if (!this.m_lastErrors) this.m_lastErrors = new ERROR_COLLECTOR();

        this.m_lastErrors.AddError(`Exception in expression: ${fullExpr}`);
        hadAnyErrors = true;
      }
    }

    return [result, hadAnyErrors];
  }

  private evaluateWithFullParser(
    aInput: string,
    aVariableCallback: VariableCallback,
  ): [string, boolean] {
    if (aInput === '') return ['', false];

    try {
      // Clear previous errors
      this.m_lastErrors?.Clear();

      // Set up error collector
      SetErrorCollector(this.m_lastErrors);

      // Create tokenizer with default units
      const tokenizer = new KIEVAL_TEXT_TOKENIZER(aInput, this.m_lastErrors, this.m_defaultUnits);
      const parser = ParseAlloc();

      // Parse document
      const document: { value: DOC | null } = { value: null };
      const tokenValue: { value: TOKEN_TYPE } = { value: MakeNumberToken(0.0) };
      let tokenType: TextEvalToken;

      try {
        do {
          tokenType = tokenizer.get_next_token(tokenValue);

          // Send token to parser
          Parse(parser, tokenType, tokenValue.value, document);

          // Early exit on errors
          if (this.m_lastErrors?.HasErrors()) break;
        } while (tokenType !== TextEvalToken.ENDS && tokenizer.has_more_tokens());

        // Finalize parsing
        if (!this.m_lastErrors?.HasErrors())
          Parse(parser, TextEvalToken.ENDS, MakeNumberToken(0.0), document);
      } finally {
        ParseFree(parser);
      }

      // Process document if parsing succeeded
      if (document.value && !this.m_lastErrors?.HasErrors()) {
        const [result, hadErrors] = DOC_PROCESSOR.Process(document.value, aVariableCallback);

        // If processing had any evaluation errors, return original input unchanged
        // This preserves the original expression syntax while still reporting errors
        if (hadErrors) return [aInput, true];

        return [result, hadErrors];
      }

      // Return original on error
      return [aInput, true];
    } catch (e) {
      this.m_lastErrors?.AddError(`Exception: ${e instanceof Error ? e.message : String(e)}`);
      return [aInput, true];
    } finally {
      // RAII guard for error collector cleanup
      SetErrorCollector(null);
    }
  }
}

// ---------------------------------------------------------------------------
// NUMERIC_EVALUATOR_COMPAT

/** `wxIsalnum` on one UTF-16 unit. */
function isAlnum(aCh: string): boolean {
  return /[\p{L}\p{N}]/u.test(aCh);
}

/**
 * `NUMERIC_EVALUATOR_COMPAT`: `NUMERIC_EVALUATOR`'s interface over
 * `EXPRESSION_EVALUATOR` - the input is one bare expression, and a failure
 * reads `NaN`.
 */
export class NUMERIC_EVALUATOR_COMPAT {
  private readonly m_evaluator: EXPRESSION_EVALUATOR;
  private m_lastInput = '';
  private m_lastResult = '';
  private m_lastValid = false;

  constructor(aUnits: EdaUnits) {
    this.m_evaluator = new EXPRESSION_EVALUATOR(aUnits);
  }

  Clear(): void {
    this.m_lastInput = '';
    this.m_lastResult = '';
    this.m_lastValid = false;
    this.m_evaluator.ClearErrors();
  }

  SetDefaultUnits(aUnits: EdaUnits): void {
    this.m_evaluator.SetDefaultUnits(aUnits);
  }

  /** No-op: EXPRESSION_EVALUATOR handles locale properly internally. */
  LocaleChanged(): void {}

  IsValid(): boolean {
    return this.m_lastValid;
  }

  Result(): string {
    return this.m_lastResult;
  }

  Process(aString: string): boolean {
    this.m_lastInput = aString;
    this.m_evaluator.ClearErrors();

    // Convert bare variable names to ${variable} syntax for compatibility
    let processedExpression = aString;

    // Sort variable names by length (longest first) to avoid partial replacements
    const varNames = this.m_evaluator.GetVariableNames().sort((a, b) => b.length - a.length);

    // Replace bare variable names with ${variable} syntax
    for (const varName of varNames) {
      const replacement = `\${${varName}}`;
      let pos = 0;

      for (;;) {
        pos = processedExpression.indexOf(varName, pos);

        if (pos === -1) break;

        // Check if this is a whole word (not part of another identifier)
        let isWholeWord = true;

        if (pos > 0) {
          const before = processedExpression[pos - 1]!;

          if (isAlnum(before) || before === '_' || before === '$') isWholeWord = false;
        }

        if (isWholeWord && pos + varName.length < processedExpression.length) {
          const after = processedExpression[pos + varName.length]!;

          if (isAlnum(after) || after === '_') isWholeWord = false;
        }

        if (isWholeWord) {
          processedExpression =
            processedExpression.slice(0, pos) +
            replacement +
            processedExpression.slice(pos + varName.length);
          pos += replacement.length;
        } else {
          pos += varName.length;
        }
      }
    }

    // Wrap the processed expression in @{...} syntax for EXPRESSION_EVALUATOR
    const wrappedExpression = `@{${processedExpression}}`;

    this.m_lastResult = this.m_evaluator.Evaluate(wrappedExpression);
    this.m_lastValid = !this.m_evaluator.HasErrors();

    // If the result is exactly the wrapped expression, it wasn't evaluated
    if (this.m_lastResult === wrappedExpression) {
      this.m_lastValid = false;
      this.m_lastResult = 'NaN';
    }

    // If there were errors, set result to "NaN" to match NUMERIC_EVALUATOR behavior
    if (!this.m_lastValid) {
      this.m_lastResult = 'NaN';
      return false;
    }

    return true;
  }

  OriginalText(): string {
    return this.m_lastInput;
  }

  SetVar(aString: string, aValue: number): void {
    this.m_evaluator.SetVariable(aString, aValue);
  }

  GetVar(aString: string): number {
    if (!this.m_evaluator.HasVariable(aString)) return 0.0;

    // wxString::ToDouble: the whole text must convert.
    const value = Number(this.m_evaluator.GetVariable(aString));
    return Number.isNaN(value) ? 0.0 : value;
  }

  RemoveVar(aString: string): void {
    this.m_evaluator.RemoveVariable(aString);
  }

  ClearVar(): void {
    this.m_evaluator.ClearVariables();
  }
}
