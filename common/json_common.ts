// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `include/json_common.h`: KiCad's `nlohmann::json`, as far as the importers
 * read one. A parsed value here is the plain `JSON.parse` result; the helpers
 * give it nlohmann's conversions and their failures:
 *
 *  - `get<std::string>` / implicit `wxString` of a non-string, `get<bool>` of
 *    a non-boolean, a number of a string: `type_error` (302);
 *  - `get<int>` of a floating value truncates, of a boolean is 0 / 1;
 *  - `at( i )` past an array's end, `at( key )` of a missing key:
 *    `out_of_range` (401 / 403); `at` on the wrong kind: `type_error` (304);
 *  - an object's members iterate in key order (`std::map<std::string>`, so
 *    the UTF-8 byte order, which is the code point order).
 *
 * Every one of them is a `JSON_EXCEPTION`, the `nlohmann::json::exception`
 * the importers catch.
 */

/** A parsed JSON value. */
export type JSON_VALUE =
  | null
  | boolean
  | number
  | string
  | JSON_VALUE[]
  | { [k: string]: JSON_VALUE };

export type JSON_OBJECT = { [k: string]: JSON_VALUE };

/** `nlohmann::json::exception`. */
export class JSON_EXCEPTION extends Error {
  constructor(aMessage: string) {
    super(aMessage);
    this.name = 'JSON_EXCEPTION';
  }
}

export const isObject = (j: JSON_VALUE | undefined): j is JSON_OBJECT =>
  typeof j === 'object' && j !== null && !Array.isArray(j);

export const isArray = (j: JSON_VALUE | undefined): j is JSON_VALUE[] => Array.isArray(j);

export const isString = (j: JSON_VALUE | undefined): j is string => typeof j === 'string';

/** `is_number()`: integers and floats, not booleans. */
export const isNumber = (j: JSON_VALUE | undefined): j is number => typeof j === 'number';

/** `is_number_integer()`: a JSON number written without fraction or exponent. */
export const isNumberInteger = (j: JSON_VALUE | undefined): j is number =>
  typeof j === 'number' && Number.isInteger(j);

export const isBoolean = (j: JSON_VALUE | undefined): j is boolean => typeof j === 'boolean';

export const isNull = (j: JSON_VALUE | undefined): boolean => j === null || j === undefined;

export function typeName(j: JSON_VALUE | undefined): string {
  if (j === null || j === undefined) return 'null';
  if (Array.isArray(j)) return 'array';
  if (typeof j === 'object') return 'object';
  return typeof j;
}

function typeError(aWant: string, j: JSON_VALUE | undefined): JSON_EXCEPTION {
  return new JSON_EXCEPTION(
    `[json.exception.type_error.302] type must be ${aWant}, but is ${typeName(j)}`,
  );
}

/** `j.get<std::string>()` / `wxString s = j`. */
export function jStr(j: JSON_VALUE | undefined): string {
  if (typeof j !== 'string') throw typeError('string', j);

  return j;
}

/** `j.get<double>()` / `double d = j`: a number or a boolean. */
export function jNum(j: JSON_VALUE | undefined): number {
  if (typeof j === 'number') return j;
  if (typeof j === 'boolean') return j ? 1 : 0;

  throw typeError('number', j);
}

/** `j.get<int>()` / `int i = j`: a float truncates toward zero. */
export function jInt(j: JSON_VALUE | undefined): number {
  return Math.trunc(jNum(j)) | 0;
}

/** `j.get<bool>()`: a boolean only. */
export function jBool(j: JSON_VALUE | undefined): boolean {
  if (typeof j !== 'boolean') throw typeError('boolean', j);

  return j;
}

/** `j.size()`. */
export function jSize(j: JSON_VALUE | undefined): number {
  if (j === null || j === undefined) return 0;
  if (Array.isArray(j)) return j.length;
  if (typeof j === 'object') return Object.keys(j).length;
  return 1;
}

/** `j.empty()`. */
export function jEmpty(j: JSON_VALUE | undefined): boolean {
  return jSize(j) === 0;
}

/** `j.at( i )` / `j.at( key )`. */
export function jAt(j: JSON_VALUE | undefined, aKey: number | string): JSON_VALUE {
  if (typeof aKey === 'number') {
    if (!Array.isArray(j))
      throw new JSON_EXCEPTION(
        `[json.exception.type_error.304] cannot use at() with ${typeName(j)}`,
      );

    if (aKey < 0 || aKey >= j.length)
      throw new JSON_EXCEPTION(
        `[json.exception.out_of_range.401] array index ${aKey} is out of range`,
      );

    return j[aKey]!;
  }

  if (!isObject(j))
    throw new JSON_EXCEPTION(`[json.exception.type_error.304] cannot use at() with ${typeName(j)}`);

  if (!Object.hasOwn(j, aKey))
    throw new JSON_EXCEPTION(`[json.exception.out_of_range.403] key '${aKey}' not found`);

  return j[aKey]!;
}

/** `j[ i ]` on a const json: no bounds check upstream (undefined behaviour); `null` here. */
export function jIndex(j: JSON_VALUE | undefined, i: number): JSON_VALUE {
  return Array.isArray(j) ? (j[i] ?? null) : null;
}

/** `j.contains( key )`: false for anything but an object. */
export function jContains(j: JSON_VALUE | undefined, aKey: string): boolean {
  return isObject(j) && Object.hasOwn(j, aKey);
}

/** Code point order, `std::string`'s `operator<` over UTF-8. */
export function codePointCompare(a: string, b: string): number {
  const n = Math.min(a.length, b.length);

  for (let i = 0; i < n; i++) {
    const ca = a.codePointAt(i)!;
    const cb = b.codePointAt(i)!;

    if (ca !== cb) return ca < cb ? -1 : 1;

    if (ca > 0xffff) i++;
  }

  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}

/** An object's keys in `std::map` order. */
export function sortedKeys(j: JSON_OBJECT): string[] {
  return Object.keys(j).sort(codePointCompare);
}

/** `for( const json& v : j )`: an array's elements, an object's values (key order), a scalar itself. */
export function jValues(j: JSON_VALUE | undefined): JSON_VALUE[] {
  if (j === null || j === undefined) return [];
  if (Array.isArray(j)) return j;
  if (typeof j === 'object') return sortedKeys(j).map((k) => j[k]!);
  return [j];
}

/** `j.items()`: key / value pairs; an array's keys are its indices. */
export function jItems(j: JSON_VALUE | undefined): [string, JSON_VALUE][] {
  if (j === null || j === undefined) return [];
  if (Array.isArray(j)) return j.map((v, i) => [String(i), v]);
  if (typeof j === 'object') return sortedKeys(j).map((k) => [k, j[k]!]);
  return [['', j]];
}

/** `j.value( key, default )`: the member converted as the default's type, else the default. */
export function jValue<T>(
  j: JSON_VALUE | undefined,
  aKey: string,
  aDefault: T,
  aConv: (v: JSON_VALUE) => T,
): T {
  if (!isObject(j))
    throw new JSON_EXCEPTION(
      `[json.exception.type_error.306] cannot use value() with ${typeName(j)}`,
    );

  return Object.hasOwn(j, aKey) ? aConv(j[aKey]!) : aDefault;
}

/** `std::map<std::string, T> m = j`, in key order. */
export function jMap<T>(j: JSON_VALUE | undefined, aConv: (v: JSON_VALUE) => T): Map<string, T> {
  if (!isObject(j)) throw typeError('object', j);

  const out = new Map<string, T>();

  for (const k of sortedKeys(j)) out.set(k, aConv(j[k]!));

  return out;
}

/** `std::set<int> s = j`. */
export function jIntSet(j: JSON_VALUE | undefined): Set<number> {
  if (!Array.isArray(j)) throw typeError('array', j);

  return new Set(j.map(jInt));
}

/** `j == "text"`: equal only when j is that string. */
export function jEq(j: JSON_VALUE | undefined, aText: string): boolean {
  return typeof j === 'string' && j === aText;
}

/**
 * `nlohmann::json::parse( text )`: throws `parse_error`. JSON.parse is the
 * same grammar; a leading UTF-8 BOM, which nlohmann skips, is skipped.
 */
export function jParse(aText: string): JSON_VALUE {
  const text = aText.charCodeAt(0) === 0xfeff ? aText.slice(1) : aText;

  try {
    return JSON.parse(text) as JSON_VALUE;
  } catch (e) {
    throw new JSON_EXCEPTION(`[json.exception.parse_error.101] ${(e as Error).message}`);
  }
}

/**
 * `nlohmann::json::parse( bytes, nullptr, false )`: the value, or `undefined`
 * when the input is not JSON (`is_discarded()`), invalid UTF-8 included.
 */
export function jParseDiscarding(aBytes: Uint8Array): JSON_VALUE | undefined {
  let text: string;

  try {
    text = new TextDecoder('utf-8', { fatal: true }) /* a leading BOM is consumed */
      .decode(aBytes);
  } catch {
    return undefined;
  }

  try {
    return JSON.parse(text) as JSON_VALUE;
  } catch {
    return undefined;
  }
}
