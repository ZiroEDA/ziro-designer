// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/text_eval/text_eval_parser.cpp` with its header
 * `include/text_eval/text_eval_parser.h`: the `calc_parser` AST (`NODE`,
 * `DOC`), the value conversions (`VALUE_UTILS`), the date and E-series
 * helpers, and `EVAL_VISITOR` - every function an `@{...}` expression can call.
 *
 * Number to text follows `{fmt}`, not JavaScript: `fixed` is `{:.Nf}` and
 * `shortest` is `{}` (`plotters/fmt.ts`, the one implementation of each).
 * `std::pow` is `std_pow` below, because V8's `Math.pow(10, -5)` is one ulp
 * off the correctly rounded value glibc returns.
 */

import { fixed, shortest } from '../plotters/fmt.js';
import * as TEXT_EVAL_VCS from './text_eval_vcs.js';
import {
  ERROR_COLLECTOR,
  MakeError,
  MakeValue,
  type Result,
  type Value,
} from './text_eval_types.js';

// ---------------------------------------------------------------------------
// C++ numeric helpers

/** `static_cast<int>( double )`: truncation; out of range is x86's INT_MIN. */
export function toInt(aValue: number): number {
  if (!Number.isFinite(aValue) || aValue >= 2147483648 || aValue <= -2147483649) return -2147483648;

  return Math.trunc(aValue) | 0;
}

// Exact doubles: 10^k is representable for k <= 22.
const POW10: readonly number[] = Array.from({ length: 23 }, (_, k) => Number(`1e${k}`));

/**
 * `std::pow`. glibc's pow is correctly rounded; V8's is not always
 * (`Math.pow(10, -5)` is 9.999999999999999e-6), and the E-series and
 * `round()` scale by exact powers of ten, so those are computed exactly.
 */
export function std_pow(aBase: number, aExp: number): number {
  if (aBase === 10 && Number.isInteger(aExp) && Math.abs(aExp) <= 22)
    return aExp >= 0 ? POW10[aExp]! : 1 / POW10[-aExp]!;

  return aBase ** aExp;
}

/** `std::round`: half away from zero, keeping the sign of zero. */
export function std_round(aValue: number): number {
  return Math.sign(aValue) * Math.round(Math.abs(aValue)) || aValue * 0;
}

/**
 * `std::stoi`: skip leading whitespace, an optional sign, then digits up to the
 * first non-digit. Throws when there are no digits or the value overflows int.
 */
export function stoi(aStr: string): number {
  const match = /^[ \t\n\v\f\r]*([+-]?\d+)/.exec(aStr);

  if (!match) throw new Error('stoi: no conversion');

  const value = Number(match[1]);

  if (value > 2147483647 || value < -2147483648) throw new Error('stoi: out of range');

  return value;
}

/**
 * `fast_float::from_chars` over the whole string, as `VALUE_UTILS::ToDouble`
 * and the tokenizer use it: an optional minus (never a plus), a decimal or
 * `inf` / `infinity` / `nan`, and nothing after it.
 */
export function fromCharsWhole(aStr: string): number | null {
  if (/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(aStr)) return Number(aStr);

  const special = /^(-?)(inf|infinity|nan)$/i.exec(aStr);

  if (special) {
    if (special[2]!.toLowerCase() === 'nan') return Number.NaN;

    return special[1] === '-' ? -Infinity : Infinity;
  }

  return null;
}

/** `fmt::format( "{:0Nd}", n )`: zero padding after the sign. */
function padInt(aValue: number, aWidth: number): string {
  const sign = aValue < 0 ? '-' : '';
  return sign + String(Math.abs(aValue)).padStart(aWidth - sign.length, '0');
}

// ---------------------------------------------------------------------------
// TOKEN_TYPE

/** `calc_parser::TOKEN_TYPE`. `text` is the C++'s 256-byte buffer. */
export interface TOKEN_TYPE {
  text: string;
  dValue: number;
  isString: boolean;
}

const utf8 = new TextEncoder();

/**
 * What `strncpy( token.text, value, 255 )` leaves: the text up to its first
 * NUL, and at most 255 UTF-8 bytes of it. A cut through a multi-byte character
 * drops the whole character here; the C++ keeps its leading bytes.
 */
export function tokenBufferText(aValue: string): string {
  const nul = aValue.indexOf('\0');
  let text = nul >= 0 ? aValue.slice(0, nul) : aValue;

  if (text.length * 3 <= 255 || utf8.encode(text).length <= 255) return text;

  let bytes = 0;
  let out = '';

  for (const ch of text) {
    const n = utf8.encode(ch).length;

    if (bytes + n > 255) break;

    bytes += n;
    out += ch;
  }

  text = out;
  return text;
}

export function MakeStringToken(aStr: string): TOKEN_TYPE {
  return { text: tokenBufferText(aStr), dValue: 0.0, isString: true };
}

export function MakeNumberToken(aVal: number): TOKEN_TYPE {
  return { text: '', dValue: aVal, isString: false };
}

export function GetTokenString(aToken: TOKEN_TYPE): string {
  return aToken.text;
}

export function GetTokenDouble(aToken: TOKEN_TYPE): number {
  return aToken.dValue;
}

// ---------------------------------------------------------------------------
// VALUE_UTILS

/** `calc_parser::VALUE_UTILS`. */
export const VALUE_UTILS = {
  /** Convert Value to double (for arithmetic operations). */
  ToDouble(aVal: Value): Result<number> {
    if (typeof aVal === 'number') return MakeValue(aVal);

    const value = fromCharsWhole(aVal);

    if (value === null) return MakeError<number>(`Cannot convert '${aVal}' to number`);

    return MakeValue(value);
  },

  /** Convert Value to string (for display/concatenation). */
  ToString(aVal: Value): string {
    if (typeof aVal === 'string') return aVal;

    const num = aVal;

    // Smart number formatting with tolerance for floating-point precision
    const tolerance = 1e-10;
    const rounded = std_round(num);

    // If the number is very close to a whole number, treat it as such
    if (Math.abs(num - rounded) < tolerance && Math.abs(rounded) < 1e15) return fixed(rounded, 0);

    return shortest(num);
  },

  /**
   * The first byte of the string, or a space. A byte above 0x7F is a UTF-8
   * lead byte, which `wxUniChar( char )` cannot convert and reads as `?`.
   */
  ToChar(aVal: Value): string {
    const str = VALUE_UTILS.ToString(aVal);

    if (str === '') return ' ';

    return str.charCodeAt(0) < 0x80 ? str[0]! : '?';
  },

  /** Check if Value represents a "truthy" value for conditionals. */
  IsTruthy(aVal: Value): boolean {
    if (typeof aVal === 'number') return aVal !== 0.0;

    return aVal !== '';
  },

  /** Arithmetic operation with type coercion. */
  ArithmeticOp(aLeft: Value, aRight: Value, aOp: BinOp): Result<Value> {
    const leftNum = VALUE_UTILS.ToDouble(aLeft);
    const rightNum = VALUE_UTILS.ToDouble(aRight);

    if (!leftNum.HasValue()) return MakeError<Value>(leftNum.GetError());
    if (!rightNum.HasValue()) return MakeError<Value>(rightNum.GetError());

    const leftVal = leftNum.GetValue();
    const rightVal = rightNum.GetValue();

    switch (aOp) {
      case '+':
        return MakeValue<Value>(leftVal + rightVal);
      case '-':
        return MakeValue<Value>(leftVal - rightVal);
      case '*':
        return MakeValue<Value>(leftVal * rightVal);
      case '/':
        if (rightVal === 0.0) return MakeError<Value>('Division by zero');
        return MakeValue<Value>(leftVal / rightVal);
      case '%':
        if (rightVal === 0.0) return MakeError<Value>('Modulo by zero');
        return MakeValue<Value>(leftVal % rightVal); // std::fmod
      case '^':
        return MakeValue<Value>(std_pow(leftVal, rightVal));
      case '<':
        return MakeValue<Value>(leftVal < rightVal ? 1.0 : 0.0);
      case '>':
        return MakeValue<Value>(leftVal > rightVal ? 1.0 : 0.0);
      case 1:
        return MakeValue<Value>(leftVal <= rightVal ? 1.0 : 0.0); // <=
      case 2:
        return MakeValue<Value>(leftVal >= rightVal ? 1.0 : 0.0); // >=
      case 3:
        return MakeValue<Value>(leftVal === rightVal ? 1.0 : 0.0); // ==
      case 4:
        return MakeValue<Value>(leftVal !== rightVal ? 1.0 : 0.0); // !=
      default:
        return MakeError<Value>('Unknown operator');
    }
  },

  /** String concatenation (special case of '+' for strings). */
  ConcatStrings(aLeft: Value, aRight: Value): Value {
    return VALUE_UTILS.ToString(aLeft) + VALUE_UTILS.ToString(aRight);
  },
};

// ---------------------------------------------------------------------------
// AST

/** `NodeType`. */
export enum NodeType {
  Text,
  Calc,
  Var,
  Number,
  String,
  BinOp,
  Function,
}

/**
 * `BIN_OP_DATA::op`, a `char`: the operator's own character, or 1-4 for
 * `<=`, `>=`, `==`, `!=` as the grammar spells them; `=` marks a Calc.
 */
export type BinOp = '+' | '-' | '*' | '/' | '%' | '^' | '<' | '>' | '=' | 1 | 2 | 3 | 4;

/** `BIN_OP_DATA`. */
export interface BIN_OP_DATA {
  left: NODE;
  right: NODE | null;
  op: BinOp;
}

/** `FUNC_DATA`. */
export interface FUNC_DATA {
  name: string;
  args: NODE[];
}

/** `calc_parser::NODE`. */
export class NODE {
  type: NodeType;
  data: string | number | BIN_OP_DATA | FUNC_DATA;

  private constructor(aType: NodeType, aData: string | number | BIN_OP_DATA | FUNC_DATA) {
    this.type = aType;
    this.data = aData;
  }

  static CreateText(aText: string): NODE {
    return new NODE(NodeType.Text, aText);
  }

  static CreateCalc(aExpr: NODE): NODE {
    return new NODE(NodeType.Calc, { left: aExpr, op: '=', right: null });
  }

  static CreateVar(aName: string): NODE {
    return new NODE(NodeType.Var, aName);
  }

  static CreateNumber(aValue: number): NODE {
    return new NODE(NodeType.Number, aValue);
  }

  static CreateString(aValue: string): NODE {
    return new NODE(NodeType.String, aValue);
  }

  static CreateBinOp(aLeft: NODE, aOp: BinOp, aRight: NODE): NODE {
    return new NODE(NodeType.BinOp, { left: aLeft, op: aOp, right: aRight });
  }

  static CreateFunction(aName: string, aArgs: NODE[]): NODE {
    return new NODE(NodeType.Function, { name: aName, args: aArgs });
  }

  Accept(aVisitor: EVAL_VISITOR): Result<Value> {
    return aVisitor.Visit(this);
  }
}

/** `calc_parser::DOC`. */
export class DOC {
  nodes: NODE[] = [];
  errors = new ERROR_COLLECTOR();

  AddNode(aNode: NODE): void {
    this.nodes.push(aNode);
  }

  HasErrors(): boolean {
    return this.errors.HasErrors();
  }

  GetErrors(): readonly string[] {
    return this.errors.GetErrors();
  }

  GetErrorSummary(): string {
    return this.errors.GetAllMessages();
  }

  GetNodes(): readonly NODE[] {
    return this.nodes;
  }
}

/**
 * `calc_parser::g_errorCollector`: where the grammar's `%syntax_error` and
 * `%parse_failure` report. `thread_local` upstream; a worker is a thread here.
 */
export let g_errorCollector: ERROR_COLLECTOR | null = null;

export function SetErrorCollector(aCollector: ERROR_COLLECTOR | null): void {
  g_errorCollector = aCollector;
}

// ---------------------------------------------------------------------------
// DATE_UTILS

const epochYear = 1970;
const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const monthNames = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const monthAbbrev = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const weekdayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function isLeapYear(aYear: number): boolean {
  return (aYear % 4 === 0 && aYear % 100 !== 0) || aYear % 400 === 0;
}

function daysInYear(aYear: number): number {
  return isLeapYear(aYear) ? 366 : 365;
}

function daysInMonthForYear(aMonth: number, aYear: number): number {
  if (aMonth === 2 && isLeapYear(aYear)) return 29;

  // Out of range is undefined behaviour upstream (an unchecked std::array
  // read, reachable only from an 8-digit date with a month above 12).
  return daysInMonth[aMonth - 1] ?? 0;
}

/** `calc_parser::DATE_UTILS`. */
export const DATE_UTILS = {
  DaysToYmd(aDaysSinceEpoch: number): [number, number, number] {
    let year = epochYear;
    let remainingDays = aDaysSinceEpoch;

    if (remainingDays >= 0) {
      while (remainingDays >= daysInYear(year)) {
        remainingDays -= daysInYear(year);
        year++;
      }
    } else {
      while (remainingDays < 0) {
        year--;
        remainingDays += daysInYear(year);
      }
    }

    let month = 1;

    while (month <= 12 && remainingDays >= daysInMonthForYear(month, year)) {
      remainingDays -= daysInMonthForYear(month, year);
      month++;
    }

    const day = remainingDays + 1;
    return [year, month, day];
  },

  YmdToDays(aYear: number, aMonth: number, aDay: number): number {
    let totalDays = 0;

    if (aYear >= epochYear) {
      for (let y = epochYear; y < aYear; ++y) totalDays += daysInYear(y);
    } else {
      for (let y = aYear; y < epochYear; ++y) totalDays -= daysInYear(y);
    }

    for (let m = 1; m < aMonth; ++m) totalDays += daysInMonthForYear(m, aYear);

    totalDays += aDay - 1;
    return totalDays;
  },

  ParseDate(aDateStr: string): number | null {
    let parts: number[] = [];

    let separator = '';
    let isCjkFormat = false;

    // Check for CJK date formats first (Chinese, Korean, or mixed)
    const hasChineseYear = aDateStr.includes('年');
    const hasChineseMonth = aDateStr.includes('月');
    const hasChineseDay = aDateStr.includes('日');
    const hasKoreanYear = aDateStr.includes('년');
    const hasKoreanMonth = aDateStr.includes('월');
    const hasKoreanDay = aDateStr.includes('일');

    if (
      (hasChineseYear || hasKoreanYear) &&
      (hasChineseMonth || hasKoreanMonth) &&
      (hasChineseDay || hasKoreanDay)
    ) {
      isCjkFormat = true;

      const yearPos = hasChineseYear ? aDateStr.indexOf('年') : aDateStr.indexOf('년');
      const monthPos = hasChineseMonth ? aDateStr.indexOf('月') : aDateStr.indexOf('월');
      const dayPos = hasChineseDay ? aDateStr.indexOf('日') : aDateStr.indexOf('일');

      // Upstream skips 3 UTF-8 bytes per marker; each is one UTF-16 unit here.
      // A negative length is std::string::substr's npos-clamped "to the end".
      const substr = (aPos: number, aLen: number) =>
        aLen < 0 ? aDateStr.slice(aPos) : aDateStr.slice(aPos, aPos + aLen);

      try {
        const year = stoi(aDateStr.slice(0, yearPos));
        const month = stoi(substr(yearPos + 1, monthPos - yearPos - 1));
        const day = stoi(substr(monthPos + 1, dayPos - monthPos - 1));

        parts = [year, month, day];
      } catch {
        return null;
      }
    } else if (aDateStr.includes('-')) separator = '-';
    else if (aDateStr.includes('/')) separator = '/';
    else if (aDateStr.includes('.')) separator = '.';

    if (separator) {
      // std::getline: no token after a trailing separator.
      const tokens = aDateStr.split(separator);

      if (tokens.length > 1 && tokens[tokens.length - 1] === '') tokens.pop();

      for (const token of tokens) {
        try {
          parts.push(stoi(token));
        } catch {
          return null;
        }
      }
    } else if (!isCjkFormat && utf8.encode(aDateStr).length === 8) {
      // std::string::length() counts UTF-8 bytes: '2024年02月' is 12, not 8.
      try {
        const dateNum = stoi(aDateStr);
        const year = Math.trunc(dateNum / 10000);
        const month = Math.trunc(dateNum / 100) % 100;
        const day = dateNum % 100;
        return DATE_UTILS.YmdToDays(year, month, day);
      } catch {
        return null;
      }
    } else if (!isCjkFormat) {
      return null;
    }

    if (parts.length === 0 || parts.length > 3) return null;

    let year: number;
    let month: number;
    let day: number;

    if (parts.length === 1) {
      year = parts[0]!;
      month = 1;
      day = 1;
    } else if (parts.length === 2) {
      year = parts[0]!;
      month = parts[1]!;
      day = 1;
    } else if (isCjkFormat) {
      year = parts[0]!;
      month = parts[1]!;
      day = parts[2]!;
    } else if (separator === '/' && parts[0]! <= 12 && parts[1]! <= 31) {
      month = parts[0]!;
      day = parts[1]!;
      year = parts[2]!;
    } else if (separator === '/' && parts[1]! <= 12) {
      day = parts[0]!;
      month = parts[1]!;
      year = parts[2]!;
    } else {
      year = parts[0]!;
      month = parts[1]!;
      day = parts[2]!;
    }

    if (month < 1 || month > 12) return null;
    if (day < 1 || day > daysInMonthForYear(month, year)) return null;

    return DATE_UTILS.YmdToDays(year, month, day);
  },

  FormatDate(aDaysSinceEpoch: number, aFormat: string): string {
    const [year, month, day] = DATE_UTILS.DaysToYmd(aDaysSinceEpoch);

    if (aFormat === 'ISO' || aFormat === 'iso')
      return `${padInt(year, 4)}-${padInt(month, 2)}-${padInt(day, 2)}`;
    if (aFormat === 'US' || aFormat === 'us')
      return `${padInt(month, 2)}/${padInt(day, 2)}/${padInt(year, 4)}`;
    if (aFormat === 'EU' || aFormat === 'european')
      return `${padInt(day, 2)}/${padInt(month, 2)}/${padInt(year, 4)}`;
    if (aFormat === 'long') return `${monthNames[month - 1]} ${day}, ${year}`;
    if (aFormat === 'short') return `${monthAbbrev[month - 1]} ${day}, ${year}`;
    if (
      aFormat === 'Chinese' ||
      aFormat === 'chinese' ||
      aFormat === 'CN' ||
      aFormat === 'cn' ||
      aFormat === '中文'
    )
      return `${year}年${padInt(month, 2)}月${padInt(day, 2)}日`;
    if (
      aFormat === 'Japanese' ||
      aFormat === 'japanese' ||
      aFormat === 'JP' ||
      aFormat === 'jp' ||
      aFormat === '日本語'
    )
      return `${year}年${padInt(month, 2)}月${padInt(day, 2)}日`;
    if (
      aFormat === 'Korean' ||
      aFormat === 'korean' ||
      aFormat === 'KR' ||
      aFormat === 'kr' ||
      aFormat === '한국어'
    )
      return `${year}년 ${padInt(month, 2)}월 ${padInt(day, 2)}일`;

    return `${padInt(year, 4)}-${padInt(month, 2)}-${padInt(day, 2)}`;
  },

  GetWeekdayName(aDaysSinceEpoch: number): string {
    let weekday = (aDaysSinceEpoch + 3) % 7; // +3 because epoch was Thursday (Monday = 0)

    if (weekday < 0) weekday += 7;

    return weekdayNames[weekday]!;
  },

  /** `time_t / ( 24 * 3600 )`: integer division of whole seconds. */
  GetCurrentDays(): number {
    return Math.trunc(Math.trunc(Date.now() / 1000) / (24 * 3600));
  },

  GetCurrentTimestamp(): number {
    return Math.trunc(Date.now() / 1000);
  },

  /** `localtime_r`: the browser's local time zone is the machine's. */
  FormatTime(aSecondsSinceEpoch: number, aFormat: string): string {
    const tm = new Date(Math.trunc(aSecondsSinceEpoch) * 1000);

    const hour = tm.getHours();
    const min = tm.getMinutes();
    const sec = tm.getSeconds();

    if (aFormat === '24h' || aFormat === 'ISO' || aFormat === 'iso')
      return `${padInt(hour, 2)}:${padInt(min, 2)}:${padInt(sec, 2)}`;

    if (aFormat === '12h') {
      const ampm = hour >= 12 ? 'PM' : 'AM';
      let hour12 = hour % 12;

      if (hour12 === 0) hour12 = 12;

      return `${hour12}:${padInt(min, 2)}:${padInt(sec, 2)} ${ampm}`;
    }

    if (aFormat === 'HH_MM_SS' || aFormat === 'filename')
      return `${padInt(hour, 2)}h${padInt(min, 2)}m${padInt(sec, 2)}s`;

    if (aFormat === 'short') return `${padInt(hour, 2)}:${padInt(min, 2)}`;

    return `${padInt(hour, 2)}:${padInt(min, 2)}:${padInt(sec, 2)}`;
  },
};

// ---------------------------------------------------------------------------
// ESERIES_UTILS

// Data: KiCad's E24 and E192 tables, 100-999 decade.
const s_e24 = [
  100, 110, 120, 130, 150, 160, 180, 200, 220, 240, 270, 300, 330, 360, 390, 430, 470, 510, 560,
  620, 680, 750, 820, 910,
];

const s_e192 = [
  100, 101, 102, 104, 105, 106, 107, 109, 110, 111, 113, 114, 115, 117, 118, 120, 121, 123, 124,
  126, 127, 129, 130, 132, 133, 135, 137, 138, 140, 142, 143, 145, 147, 149, 150, 152, 154, 156,
  158, 160, 162, 164, 165, 167, 169, 172, 174, 176, 178, 180, 182, 184, 187, 189, 191, 193, 196,
  198, 200, 203, 205, 208, 210, 213, 215, 218, 221, 223, 226, 229, 232, 234, 237, 240, 243, 246,
  249, 252, 255, 258, 261, 264, 267, 271, 274, 277, 280, 284, 287, 291, 294, 298, 301, 305, 309,
  312, 316, 320, 324, 328, 332, 336, 340, 344, 348, 352, 357, 361, 365, 370, 374, 379, 383, 388,
  392, 397, 402, 407, 412, 417, 422, 427, 432, 437, 442, 448, 453, 459, 464, 470, 475, 481, 487,
  493, 499, 505, 511, 517, 523, 530, 536, 542, 549, 556, 562, 569, 576, 583, 590, 597, 604, 612,
  619, 626, 634, 642, 649, 657, 665, 673, 681, 690, 698, 706, 715, 723, 732, 741, 750, 759, 768,
  777, 787, 796, 806, 816, 825, 835, 845, 856, 866, 876, 887, 898, 909, 920, 931, 942, 953, 965,
  976, 988,
];

function parseSeriesString(aSeries: string): number {
  if (aSeries === 'E3' || aSeries === 'e3') return 3;
  if (aSeries === 'E6' || aSeries === 'e6') return 6;
  if (aSeries === 'E12' || aSeries === 'e12') return 12;
  if (aSeries === 'E24' || aSeries === 'e24') return 24;
  if (aSeries === 'E48' || aSeries === 'e48') return 48;
  if (aSeries === 'E96' || aSeries === 'e96') return 96;
  if (aSeries === 'E192' || aSeries === 'e192') return 192;

  return -1; // Invalid series
}

function getSeriesValue(aSeries: number, aIndex: number): number {
  // E1, E3, E6, E12, E24 are derived from E24
  if (aSeries <= 24) return s_e24[aIndex * (24 / aSeries)]!;

  // E48, E96, E192 are derived from E192
  return s_e192[aIndex * (192 / aSeries)]!;
}

/** The value scaled into the 100-999 decade, and that decade. */
function normalise(aValue: number): { decade: number; normalized: number } {
  const logValue = Math.log10(aValue);
  const decade = Math.floor(logValue);
  const scaledValue = aValue / std_pow(10.0, decade);
  return { decade, normalized: scaledValue * 100.0 };
}

/** `calc_parser::ESERIES_UTILS`. */
export const ESERIES_UTILS = {
  FindNearest(aValue: number, aSeries: string): number | null {
    const series = parseSeriesString(aSeries);

    if (series < 0) return null;
    if (aValue <= 0.0) return null;

    const { decade, normalized } = normalise(aValue);
    let minDiff = Number.MAX_VALUE;
    let nearest = 100;

    for (let i = 0; i < series; ++i) {
      const val = getSeriesValue(series, i);
      const diff = Math.abs(normalized - val);

      if (diff < minDiff) {
        minDiff = diff;
        nearest = val;
      }
    }

    return (nearest / 100.0) * std_pow(10.0, decade);
  },

  FindUp(aValue: number, aSeries: string): number | null {
    const series = parseSeriesString(aSeries);

    if (series < 0) return null;
    if (aValue <= 0.0) return null;

    const { decade, normalized } = normalise(aValue);

    for (let i = 0; i < series; ++i) {
      const val = getSeriesValue(series, i);

      if (val > normalized) return (val / 100.0) * std_pow(10.0, decade);
    }

    // Wrap to next decade
    const firstVal = getSeriesValue(series, 0);
    return (firstVal / 100.0) * std_pow(10.0, decade + 1);
  },

  FindDown(aValue: number, aSeries: string): number | null {
    const series = parseSeriesString(aSeries);

    if (series < 0) return null;
    if (aValue <= 0.0) return null;

    const { decade, normalized } = normalise(aValue);

    for (let i = series - 1; i >= 0; --i) {
      const val = getSeriesValue(series, i);

      if (val < normalized) return (val / 100.0) * std_pow(10.0, decade);
    }

    // Wrap to previous decade
    const lastVal = getSeriesValue(series, series - 1);
    return (lastVal / 100.0) * std_pow(10.0, decade - 1);
  },
};

// ---------------------------------------------------------------------------
// EVAL_VISITOR

/** `EVAL_VISITOR::VariableCallback`. */
export type VariableCallback = (aVariableName: string) => Result<Value>;

/** `fmt::format( "{:.{}f}", value, decimals )`: fmt throws on a negative precision. */
function fmtFixed(aValue: number, aDecimals: number): string {
  if (aDecimals < 0) throw new Error('negative precision');

  return fixed(aValue, aDecimals);
}

/** `std::toupper` / `std::tolower` under the C locale: ASCII only, byte by byte. */
function asciiUpper(aStr: string): string {
  return aStr.replace(/[a-z]+/g, (m) => m.toUpperCase());
}

function asciiLower(aStr: string): string {
  return aStr.replace(/[A-Z]+/g, (m) => m.toLowerCase());
}

/** `wxString::BeforeFirst`: the whole string when the character is absent. */
function beforeFirst(aStr: string, aCh: string): string {
  const i = aStr.indexOf(aCh);
  return i < 0 ? aStr : aStr.slice(0, i);
}

/** `wxString::BeforeLast`: empty when the character is absent. */
function beforeLast(aStr: string, aCh: string): string {
  const i = aStr.lastIndexOf(aCh);
  return i < 0 ? '' : aStr.slice(0, i);
}

/** `wxString::AfterFirst`: empty when the character is absent. */
function afterFirst(aStr: string, aCh: string): string {
  const i = aStr.indexOf(aCh);
  return i < 0 ? '' : aStr.slice(i + 1);
}

/** `wxString::AfterLast`: the whole string when the character is absent. */
function afterLast(aStr: string, aCh: string): string {
  const i = aStr.lastIndexOf(aCh);
  return i < 0 ? aStr : aStr.slice(i + 1);
}

/** `calc_parser::EVAL_VISITOR`. */
export class EVAL_VISITOR {
  private readonly m_variableCallback: VariableCallback | null;
  readonly m_errors: ERROR_COLLECTOR;

  constructor(aVariableCallback: VariableCallback | null, aErrorCollector: ERROR_COLLECTOR) {
    this.m_variableCallback = aVariableCallback;
    this.m_errors = aErrorCollector;
  }

  /** `operator()( const NODE& )`. */
  Visit(aNode: NODE): Result<Value> {
    switch (aNode.type) {
      case NodeType.Number:
        return MakeValue<Value>(aNode.data as number);

      case NodeType.String:
        return MakeValue<Value>(aNode.data as string);

      case NodeType.Var: {
        const varName = aNode.data as string;

        // Use callback to resolve variable
        if (this.m_variableCallback) return this.m_variableCallback(varName);

        return MakeError<Value>(`No variable resolver configured for: ${varName}`);
      }

      case NodeType.BinOp: {
        const binop = aNode.data as BIN_OP_DATA;
        const leftResult = binop.left.Accept(this);

        if (!leftResult.HasValue()) return leftResult;

        const rightResult = binop.right ? binop.right.Accept(this) : MakeValue<Value>(0.0);

        if (!rightResult.HasValue()) return rightResult;

        const leftVal = leftResult.GetValue();
        const rightVal = rightResult.GetValue();

        // Special handling for string concatenation with +
        if (binop.op === '+') {
          // If either operand is a string, concatenate
          if (typeof leftVal === 'string' || typeof rightVal === 'string')
            return MakeValue<Value>(VALUE_UTILS.ConcatStrings(leftVal, rightVal));
        }

        // Special handling for string comparisons with == and !=
        if (binop.op === 3 || binop.op === 4) {
          // If both operands are strings, do string comparison
          if (typeof leftVal === 'string' && typeof rightVal === 'string') {
            const equal = leftVal === rightVal;
            const result = binop.op === 3 ? (equal ? 1.0 : 0.0) : equal ? 0.0 : 1.0;
            return MakeValue<Value>(result);
          }
        }

        // Otherwise, perform arithmetic
        return VALUE_UTILS.ArithmeticOp(leftVal, rightVal, binop.op);
      }

      case NodeType.Function:
        return this.evaluateFunction(aNode.data as FUNC_DATA);

      default:
        return MakeError<Value>('Cannot evaluate this node type');
    }
  }

  private evaluateFunction(aFunc: FUNC_DATA): Result<Value> {
    const name = aFunc.name;
    const args = aFunc.args;

    // Zero-argument functions
    if (args.length === 0) {
      if (name === 'today') return MakeValue<Value>(DATE_UTILS.GetCurrentDays());
      if (name === 'now') return MakeValue<Value>(DATE_UTILS.GetCurrentTimestamp());
      if (name === 'random') return MakeValue<Value>(Math.random());
    }

    // Evaluate arguments to mixed types
    const argValues: Value[] = [];

    for (const arg of args) {
      const result = arg.Accept(this);

      if (!result.HasValue()) return result;

      argValues.push(result.GetValue());
    }

    const argc = argValues.length;
    const toDouble = (aIndex: number) => VALUE_UTILS.ToDouble(argValues[aIndex]!);
    const argString = (aIndex: number) => VALUE_UTILS.ToString(argValues[aIndex]!);

    // String formatting functions (return strings!)
    if ((name === 'format' || name === 'fixed') && argc >= 1) {
      const numResult = toDouble(0);

      if (!numResult.HasValue()) return MakeError<Value>(numResult.GetError());

      let decimals = 2;

      if (argc > 1) {
        const decResult = toDouble(1);

        if (decResult.HasValue()) decimals = toInt(decResult.GetValue());
      }

      return MakeValue<Value>(fmtFixed(numResult.GetValue(), decimals));
    }

    if (name === 'currency' && argc >= 1) {
      const numResult = toDouble(0);

      if (!numResult.HasValue()) return MakeError<Value>(numResult.GetError());

      const symbol = argc > 1 ? argString(1) : '$';

      return MakeValue<Value>(`${symbol}${fmtFixed(numResult.GetValue(), 2)}`);
    }

    // Date formatting functions (return strings!)
    if (name === 'dateformat' && argc >= 1) {
      const dateResult = toDouble(0);

      if (!dateResult.HasValue()) return MakeError<Value>(dateResult.GetError());

      const days = toInt(dateResult.GetValue());
      const format = argc > 1 ? argString(1) : 'ISO';

      return MakeValue<Value>(DATE_UTILS.FormatDate(days, format));
    }

    if (name === 'datestring' && argc === 1) {
      const dateStr = argString(0);
      const daysResult = DATE_UTILS.ParseDate(dateStr);

      if (daysResult === null) return MakeError<Value>(`Invalid date format: ${dateStr}`);

      return MakeValue<Value>(daysResult);
    }

    if (name === 'weekdayname' && argc === 1) {
      const dateResult = toDouble(0);

      if (!dateResult.HasValue()) return MakeError<Value>(dateResult.GetError());

      return MakeValue<Value>(DATE_UTILS.GetWeekdayName(toInt(dateResult.GetValue())));
    }

    if (name === 'timeformat' && argc >= 1) {
      const timeResult = toDouble(0);

      if (!timeResult.HasValue()) return MakeError<Value>(timeResult.GetError());

      const format = argc > 1 ? argString(1) : 'ISO';

      return MakeValue<Value>(DATE_UTILS.FormatTime(timeResult.GetValue(), format));
    }

    // VCS functions (return strings!)
    // Empty results from the VCS layer mean "not in a repository" or "no data available"
    const vcsResult = (aResult: string) => (aResult === '' ? '<unknown>' : aResult);

    /** An optional numeric flag argument, read only when it converts. */
    const flagArg = (aIndex: number): boolean | null => {
      const r = toDouble(aIndex);
      return r.HasValue() ? r.GetValue() !== 0.0 : null;
    };

    if (name === 'vcsidentifier' && argc <= 1) {
      let length = 40; // Full identifier by default

      if (argc === 1) {
        const lenResult = toDouble(0);

        if (lenResult.HasValue()) length = toInt(lenResult.GetValue());
      }

      return MakeValue<Value>(vcsResult(TEXT_EVAL_VCS.GetCommitHash('.', length)));
    }

    if (name === 'vcsnearestlabel' && argc <= 2) {
      const match = argc >= 1 ? argString(0) : '';
      const anyTags = argc >= 2 ? (flagArg(1) ?? false) : false;

      return MakeValue<Value>(vcsResult(TEXT_EVAL_VCS.GetNearestTag(match, anyTags)));
    }

    if (name === 'vcslabeldistance' && argc <= 2) {
      const match = argc >= 1 ? argString(0) : '';
      const anyTags = argc >= 2 ? (flagArg(1) ?? false) : false;

      return MakeValue<Value>(String(TEXT_EVAL_VCS.GetDistanceFromTag(match, anyTags)));
    }

    if (name === 'vcsdirty' && argc <= 1) {
      const includeUntracked = argc === 1 ? (flagArg(0) ?? false) : false;

      return MakeValue<Value>(TEXT_EVAL_VCS.IsDirty(includeUntracked) ? '1' : '0');
    }

    if (name === 'vcsdirtysuffix' && argc <= 2) {
      const suffix = argc >= 1 ? argString(0) : '-dirty';
      const includeUntracked = argc >= 2 ? (flagArg(1) ?? false) : false;

      return MakeValue<Value>(TEXT_EVAL_VCS.IsDirty(includeUntracked) ? suffix : '');
    }

    if (name === 'vcsauthor' && argc === 0)
      return MakeValue<Value>(vcsResult(TEXT_EVAL_VCS.GetAuthor('.')));

    if (name === 'vcsauthoremail' && argc === 0)
      return MakeValue<Value>(vcsResult(TEXT_EVAL_VCS.GetAuthorEmail('.')));

    if (name === 'vcscommitter' && argc === 0)
      return MakeValue<Value>(vcsResult(TEXT_EVAL_VCS.GetCommitter('.')));

    if (name === 'vcscommitteremail' && argc === 0)
      return MakeValue<Value>(vcsResult(TEXT_EVAL_VCS.GetCommitterEmail('.')));

    if (name === 'vcsbranch' && argc === 0)
      return MakeValue<Value>(vcsResult(TEXT_EVAL_VCS.GetBranch()));

    if (name === 'vcscommitdate' && argc <= 1) {
      const format = argc === 1 ? argString(0) : 'ISO';
      const timestamp = TEXT_EVAL_VCS.GetCommitTimestamp('.');

      if (timestamp === 0) return MakeValue<Value>(vcsResult(''));

      return MakeValue<Value>(
        DATE_UTILS.FormatDate(toInt(Math.trunc(timestamp / (24 * 3600))), format),
      );
    }

    // VCS file functions (file-specific versions)
    if (name === 'vcsfileidentifier' && argc >= 1 && argc <= 2) {
      const filePath = argString(0);
      let length = 40;

      if (argc === 2) {
        const lenResult = toDouble(1);

        if (lenResult.HasValue()) length = toInt(lenResult.GetValue());
      }

      return MakeValue<Value>(vcsResult(TEXT_EVAL_VCS.GetCommitHash(filePath, length)));
    }

    if (name === 'vcsfileauthor' && argc === 1)
      return MakeValue<Value>(vcsResult(TEXT_EVAL_VCS.GetAuthor(argString(0))));

    if (name === 'vcsfileauthoremail' && argc === 1)
      return MakeValue<Value>(vcsResult(TEXT_EVAL_VCS.GetAuthorEmail(argString(0))));

    if (name === 'vcsfilecommitter' && argc === 1)
      return MakeValue<Value>(vcsResult(TEXT_EVAL_VCS.GetCommitter(argString(0))));

    if (name === 'vcsfilecommitteremail' && argc === 1)
      return MakeValue<Value>(vcsResult(TEXT_EVAL_VCS.GetCommitterEmail(argString(0))));

    if (name === 'vcsfilecommitdate' && argc >= 1 && argc <= 2) {
      const filePath = argString(0);
      const format = argc === 2 ? argString(1) : 'ISO';
      const timestamp = TEXT_EVAL_VCS.GetCommitTimestamp(filePath);

      if (timestamp === 0) return MakeValue<Value>(vcsResult(''));

      return MakeValue<Value>(
        DATE_UTILS.FormatDate(toInt(Math.trunc(timestamp / (24 * 3600))), format),
      );
    }

    // String functions (return strings!)
    if (name === 'upper' && argc === 1) return MakeValue<Value>(asciiUpper(argString(0)));

    if (name === 'lower' && argc === 1) return MakeValue<Value>(asciiLower(argString(0)));

    if (name === 'concat' && argc >= 2) {
      let result = '';

      for (const val of argValues) result += VALUE_UTILS.ToString(val);

      return MakeValue<Value>(result);
    }

    if (name === 'beforefirst' && argc === 2)
      return MakeValue<Value>(beforeFirst(argString(0), VALUE_UTILS.ToChar(argValues[1]!)));

    if (name === 'beforelast' && argc === 2)
      return MakeValue<Value>(beforeLast(argString(0), VALUE_UTILS.ToChar(argValues[1]!)));

    if (name === 'afterfirst' && argc === 2)
      return MakeValue<Value>(afterFirst(argString(0), VALUE_UTILS.ToChar(argValues[1]!)));

    if (name === 'afterlast' && argc === 2)
      return MakeValue<Value>(afterLast(argString(0), VALUE_UTILS.ToChar(argValues[1]!)));

    // Conditional functions (handle mixed types)
    if (name === 'if' && argc === 3) {
      // Convert only the condition to a number
      const conditionResult = toDouble(0);

      if (!conditionResult.HasValue()) return MakeError<Value>(conditionResult.GetError());

      const condition = conditionResult.GetValue() !== 0.0;
      return MakeValue<Value>(condition ? argValues[1]! : argValues[2]!);
    }

    // E-series functions (handle value as number, series as string)
    if ((name === 'enearest' || name === 'eup' || name === 'edown') && argc >= 1 && argc <= 2) {
      const valueResult = toDouble(0);

      if (!valueResult.HasValue()) return MakeError<Value>(valueResult.GetError());

      const value = valueResult.GetValue();
      const series = argc > 1 ? argString(1) : 'E24';
      let result: number | null = null;

      if (name === 'enearest') result = ESERIES_UTILS.FindNearest(value, series);
      else if (name === 'eup') result = ESERIES_UTILS.FindUp(value, series);
      else if (name === 'edown') result = ESERIES_UTILS.FindDown(value, series);

      if (result === null) return MakeError<Value>(`Invalid E-series: ${series}`);

      return MakeValue<Value>(result);
    }

    // Mathematical functions (return numbers) - convert args to doubles first
    const numArgs: number[] = [];

    for (const val of argValues) {
      const numResult = VALUE_UTILS.ToDouble(val);

      if (!numResult.HasValue()) return MakeError<Value>(numResult.GetError());

      numArgs.push(numResult.GetValue());
    }

    const sumOf = () => numArgs.reduce((a, b) => a + b, 0.0);

    if (name === 'abs' && argc === 1) return MakeValue<Value>(Math.abs(numArgs[0]!));

    if (name === 'sum' && argc >= 1) return MakeValue<Value>(sumOf());

    if (name === 'round' && argc >= 1) {
      const value = numArgs[0]!;
      const precision = argc > 1 ? toInt(numArgs[1]!) : 0;
      const multiplier = std_pow(10.0, precision);
      return MakeValue<Value>(std_round(value * multiplier) / multiplier);
    }

    if (name === 'sqrt' && argc === 1) {
      if (numArgs[0]! < 0) return MakeError<Value>('Square root of negative number');

      return MakeValue<Value>(Math.sqrt(numArgs[0]!));
    }

    if (name === 'pow' && argc === 2) return MakeValue<Value>(std_pow(numArgs[0]!, numArgs[1]!));

    if (name === 'floor' && argc === 1) return MakeValue<Value>(Math.floor(numArgs[0]!));

    if (name === 'ceil' && argc === 1) return MakeValue<Value>(Math.ceil(numArgs[0]!));

    // std::min_element / max_element: the first of equals, and NaN never compares.
    if (name === 'min' && argc >= 1)
      return MakeValue<Value>(numArgs.reduce((best, v) => (v < best ? v : best)));

    if (name === 'max' && argc >= 1)
      return MakeValue<Value>(numArgs.reduce((best, v) => (best < v ? v : best)));

    if (name === 'avg' && argc >= 1) return MakeValue<Value>(sumOf() / argc);

    if (name === 'shunt' && argc === 2) {
      const r1 = numArgs[0]!;
      const r2 = numArgs[1]!;
      const sum = r1 + r2;

      // Calculate parallel resistance: (r1*r2)/(r1+r2)
      // If sum is not positive, return 0.0 (handles edge cases like shunt(0,0))
      if (sum > 0.0) return MakeValue<Value>((r1 * r2) / sum);

      return MakeValue<Value>(0.0);
    }

    if (name === 'db' && argc === 1) {
      // Power ratio to dB: 10*log10(ratio)
      if (numArgs[0]! <= 0.0) return MakeError<Value>('db() argument must be positive');

      return MakeValue<Value>(10.0 * Math.log10(numArgs[0]!));
    }

    if (name === 'dbv' && argc === 1) {
      // Voltage/current ratio to dB: 20*log10(ratio)
      if (numArgs[0]! <= 0.0) return MakeError<Value>('dbv() argument must be positive');

      return MakeValue<Value>(20.0 * Math.log10(numArgs[0]!));
    }

    // dB to power ratio: 10^(dB/10)
    if (name === 'fromdb' && argc === 1) return MakeValue<Value>(std_pow(10.0, numArgs[0]! / 10.0));

    // dB to voltage/current ratio: 10^(dB/20)
    if (name === 'fromdbv' && argc === 1)
      return MakeValue<Value>(std_pow(10.0, numArgs[0]! / 20.0));

    return MakeError<Value>(`Unknown function: ${name} with ${argc} arguments`);
  }
}

// ---------------------------------------------------------------------------
// DOC_PROCESSOR

/** `calc_parser::DOC_PROCESSOR`. */
export const DOC_PROCESSOR = {
  /** Process document using callback for variable resolution: `[result, hadErrors]`. */
  Process(aDoc: DOC, aVariableCallback: VariableCallback | null): [string, boolean] {
    let result = '';
    const localErrors = new ERROR_COLLECTOR();
    const evaluator = new EVAL_VISITOR(aVariableCallback, localErrors);
    let hadErrors = aDoc.HasErrors();

    for (const node of aDoc.GetNodes()) {
      switch (node.type) {
        case NodeType.Text:
          result += node.data as string;
          break;

        case NodeType.Calc: {
          const calcData = node.data as BIN_OP_DATA;
          const evalResult = calcData.left.Accept(evaluator);

          if (evalResult.HasValue()) result += VALUE_UTILS.ToString(evalResult.GetValue());
          else {
            // Don't add error formatting to result - errors go to error vector only
            // The higher level will return original input unchanged if there are errors
            hadErrors = true;
          }
          break;
        }

        default:
          result += '[Unknown node type]';
          hadErrors = true;
          break;
      }
    }

    return [result, hadErrors || localErrors.HasErrors()];
  },

  /** Process document with detailed error reporting: `[result, errors, hadErrors]`. */
  ProcessWithDetails(
    aDoc: DOC,
    aVariableCallback: VariableCallback | null,
  ): [string, readonly string[], boolean] {
    const [result, hadErrors] = DOC_PROCESSOR.Process(aDoc, aVariableCallback);
    return [result, aDoc.GetErrors(), hadErrors];
  },
};
