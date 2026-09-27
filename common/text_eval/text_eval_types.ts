// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/text_eval/text_eval_types.h`: the `calc_parser` value, result and
 * error types the expression evaluator passes between its tokenizer, grammar
 * and visitor.
 */

/** `calc_parser::Value` - `std::variant<double, std::string>`. */
export type Value = number | string;

/** `calc_parser::Result<T>` - a value or an error message, never both. */
export class Result<T> {
  private readonly m_hasValue: boolean;
  private readonly m_value: T | undefined;
  private readonly m_error: string;

  private constructor(aHasValue: boolean, aValue: T | undefined, aError: string) {
    this.m_hasValue = aHasValue;
    this.m_value = aValue;
    this.m_error = aError;
  }

  static Value<T>(aValue: T): Result<T> {
    return new Result<T>(true, aValue, '');
  }

  static Error<T>(aError: string): Result<T> {
    return new Result<T>(false, undefined, aError);
  }

  HasValue(): boolean {
    return this.m_hasValue;
  }

  HasError(): boolean {
    return !this.m_hasValue;
  }

  GetValue(): T {
    return this.m_value as T;
  }

  GetError(): string {
    return this.m_error;
  }
}

/** `calc_parser::MakeError<T>`. */
export function MakeError<T>(aMsg: string): Result<T> {
  return Result.Error<T>(aMsg);
}

/** `calc_parser::MakeValue<T>`. */
export function MakeValue<T>(aVal: T): Result<T> {
  return Result.Value<T>(aVal);
}

/** `calc_parser::ERROR_COLLECTOR`. */
export class ERROR_COLLECTOR {
  private m_errors: string[] = [];
  private m_warnings: string[] = [];

  AddError(aError: string): void {
    this.m_errors.push(aError);
  }

  AddWarning(aWarning: string): void {
    this.m_warnings.push(aWarning);
  }

  AddSyntaxError(aLine = -1, aColumn = -1): void {
    if (aLine >= 0 && aColumn >= 0)
      this.AddError(`Syntax error at line ${aLine}, column ${aColumn}`);
    else this.AddError('Syntax error in calculation expression');
  }

  AddParseFailure(): void {
    this.AddError('Parser failed to parse input');
  }

  HasErrors(): boolean {
    return this.m_errors.length > 0;
  }

  HasWarnings(): boolean {
    return this.m_warnings.length > 0;
  }

  GetErrors(): readonly string[] {
    return this.m_errors;
  }

  GetWarnings(): readonly string[] {
    return this.m_warnings;
  }

  GetAllMessages(): string {
    let result = '';

    for (const error of this.m_errors) result += `Error: ${error}\n`;

    for (const warning of this.m_warnings) result += `Warning: ${warning}\n`;

    return result;
  }

  Clear(): void {
    this.m_errors = [];
    this.m_warnings = [];
  }
}
