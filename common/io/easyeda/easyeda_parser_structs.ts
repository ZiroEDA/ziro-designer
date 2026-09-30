// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/io/easyeda/easyeda_parser_structs.cpp` / `.h`: the EasyEDA Std
 * document headers and their `from_json`.
 *
 * nlohmann's `get_to` throws `type_error` when the JSON value is not the C++
 * type it is read into (a number read as a `wxString`, a non-string in a
 * `std::map<wxString, wxString>`); `JSON_TYPE_ERROR` is that exception, and
 * every `json::exception` catch upstream catches it here.
 */

import { strtodPrefix } from '../../libc/stdlib.js';
import { ToLong } from '../../libc/stdlib.js';

/** A parsed JSON value, as `nlohmann::json` holds it. */
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

/** `j.get<wxString>()`. */
export function getString(j: JSON_VALUE | undefined, aKey = ''): string {
  if (typeof j !== 'string')
    throw new JSON_EXCEPTION(
      `[json.exception.type_error.302] type must be string, but is ${typeName(j)}${aKey ? ` (${aKey})` : ''}`,
    );

  return j;
}

/** `j.get<std::map<wxString, wxString>>()`. */
export function getStringMap(j: JSON_VALUE | undefined): Map<string, string> {
  if (!isObject(j))
    throw new JSON_EXCEPTION(
      `[json.exception.type_error.302] type must be object, but is ${typeName(j)}`,
    );

  const out = new Map<string, string>();

  for (const [k, v] of Object.entries(j)) out.set(k, getString(v, k));

  return out;
}

/** `j.get<wxArrayString>()` / `std::vector<wxString>`. */
export function getStringArray(j: JSON_VALUE | undefined): string[] {
  if (!Array.isArray(j))
    throw new JSON_EXCEPTION(
      `[json.exception.type_error.302] type must be array, but is ${typeName(j)}`,
    );

  return j.map((v) => getString(v));
}

export function typeName(j: JSON_VALUE | undefined): string {
  if (j === null || j === undefined) return 'null';
  if (Array.isArray(j)) return 'array';
  if (typeof j === 'object') return 'object';
  return typeof j;
}

/**
 * `nlohmann::json::parse( text, nullptr, false )`: the value, or null when the
 * text is not JSON (`is_discarded()`). A leading UTF-8 BOM is skipped, as
 * nlohmann's lexer does; invalid UTF-8 discards the document.
 */
export function parseJsonDiscarding(aBytes: Uint8Array): JSON_VALUE | undefined {
  let text: string;

  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(aBytes);
  } catch {
    return undefined;
  }

  try {
    return JSON.parse(text) as JSON_VALUE;
  } catch {
    return undefined;
  }
}

/** `nlohmann::json::parse( text )`: throws `parse_error` on bad input. */
export function parseJson(aText: string): JSON_VALUE {
  try {
    return JSON.parse(aText) as JSON_VALUE;
  } catch (e) {
    throw new JSON_EXCEPTION(`[json.exception.parse_error.101] ${(e as Error).message}`);
  }
}

export enum DOC_TYPE {
  UNKNOWN = 0,

  SCHEMATIC_SHEET = 1,
  SYMBOL = 2,
  PCB = 3,
  PCB_COMPONENT = 4,
  SCHEMATIC_LIST = 5,
  PCB_MODULE = 14,
}

export interface HEAD {
  docType: DOC_TYPE;

  editorVersion: string;
  title: string;
  description: string;

  x: number;
  y: number;

  c_para: Map<string, string> | undefined;
}

export interface DOCUMENT {
  docType: DOC_TYPE | undefined; // May be here or in head
  head: HEAD;

  // BBox
  // colors
  canvas: string;
  title: string;
  shape: string[];
  dataStr: JSON_VALUE | undefined;
}

export interface C_PARA {
  package: string;
  pre: string;
  Contributor: string;
  link: string;
  Model_3D: string;
}

export interface DOCUMENT_PCB {
  c_para: Map<string, string> | undefined;
  layers: string[];
  uuid: string | undefined;
  DRCRULE: Map<string, JSON_VALUE> | undefined;
}

export interface DOCUMENT_SYM {
  c_para: Map<string, string> | undefined;
}

export interface DOCUMENT_SCHEMATICS {
  schematics: DOCUMENT[] | undefined;
}

const has = (j: JSON_OBJECT, k: string): boolean => Object.hasOwn(j, k);

/** `PARSE_TO_DOUBLE( name, def )`. */
function parseToDouble(j: JSON_OBJECT, name: string, def: number, cur: number): number {
  if (!has(j, name)) return def;

  const v = j[name];

  if (typeof v === 'string') {
    // `double out = 0; str.ToCDouble( &out )`: whatever prefix converts, else 0
    const r = strtodPrefix(v, 0);
    return r === null ? 0 : r.value;
  }

  if (typeof v === 'number') return v;

  return cur;
}

export function DOC_TYPE_from_json(j: JSON_VALUE | undefined, d: DOC_TYPE): DOC_TYPE {
  if (typeof j === 'string') {
    // `int out = 0; str.ToInt( &out )`: the prefix value either way
    const r = ToLong(j);
    return r.value as DOC_TYPE;
  }

  if (typeof j === 'number') {
    // `j.get<int>()`: a floating value truncates
    return Math.trunc(j) as DOC_TYPE;
  }

  return d;
}

export function HEAD_from_json(j: JSON_VALUE | undefined): HEAD {
  if (!isObject(j))
    throw new JSON_EXCEPTION(
      `[json.exception.type_error.302] type must be object, but is ${typeName(j)}`,
    );

  const d: HEAD = {
    docType: DOC_TYPE.UNKNOWN,
    editorVersion: '',
    title: '',
    description: '',
    x: 0,
    y: 0,
    c_para: undefined,
  };

  if (has(j, 'docType')) d.docType = DOC_TYPE_from_json(j.docType, d.docType);

  if (has(j, 'editorVersion')) d.editorVersion = getString(j.editorVersion);
  if (has(j, 'title')) d.title = getString(j.title);
  if (has(j, 'description')) d.description = getString(j.description);

  if (has(j, 'c_para') && isObject(j.c_para)) d.c_para = getStringMap(j.c_para);

  d.x = parseToDouble(j, 'x', 0, d.x);
  d.y = parseToDouble(j, 'y', 0, d.y);

  return d;
}

export function DOCUMENT_from_json(j: JSON_VALUE | undefined): DOCUMENT {
  if (!isObject(j))
    throw new JSON_EXCEPTION(
      `[json.exception.type_error.302] type must be object, but is ${typeName(j)}`,
    );

  const d: DOCUMENT = {
    docType: undefined,
    head: HEAD_from_json({}),
    canvas: '',
    title: '',
    shape: [],
    dataStr: undefined,
  };

  if (has(j, 'docType')) d.docType = DOC_TYPE_from_json(j.docType, DOC_TYPE.UNKNOWN);
  if (has(j, 'head')) d.head = HEAD_from_json(j.head);

  if (has(j, 'canvas')) d.canvas = getString(j.canvas);
  if (has(j, 'title')) d.title = getString(j.title);
  if (has(j, 'shape')) d.shape = getStringArray(j.shape);
  if (has(j, 'dataStr')) d.dataStr = j.dataStr;

  return d;
}

export function DOCUMENT_PCB_from_json(j: JSON_VALUE | undefined): DOCUMENT_PCB {
  if (!isObject(j))
    throw new JSON_EXCEPTION(
      `[json.exception.type_error.302] type must be object, but is ${typeName(j)}`,
    );

  const d: DOCUMENT_PCB = { c_para: undefined, layers: [], uuid: undefined, DRCRULE: undefined };

  if (has(j, 'c_para')) d.c_para = getStringMap(j.c_para);

  // `j.at( "layers" )`: out_of_range when absent
  if (!has(j, 'layers'))
    throw new JSON_EXCEPTION("[json.exception.out_of_range.403] key 'layers' not found");

  d.layers = getStringArray(j.layers);

  if (has(j, 'DRCRULE') && isObject(j.DRCRULE)) d.DRCRULE = new Map(Object.entries(j.DRCRULE));

  return d;
}

export function DOCUMENT_SYM_from_json(j: JSON_VALUE | undefined): DOCUMENT_SYM {
  if (!isObject(j))
    throw new JSON_EXCEPTION(
      `[json.exception.type_error.302] type must be object, but is ${typeName(j)}`,
    );

  return { c_para: has(j, 'c_para') ? getStringMap(j.c_para) : undefined };
}

export function DOCUMENT_SCHEMATICS_from_json(j: JSON_VALUE | undefined): DOCUMENT_SCHEMATICS {
  if (!isObject(j))
    throw new JSON_EXCEPTION(
      `[json.exception.type_error.302] type must be object, but is ${typeName(j)}`,
    );

  if (!has(j, 'schematics')) return { schematics: undefined };

  const s = j.schematics;

  if (!Array.isArray(s))
    throw new JSON_EXCEPTION(
      `[json.exception.type_error.302] type must be array, but is ${typeName(s)}`,
    );

  return { schematics: s.map((x) => DOCUMENT_from_json(x)) };
}

export function C_PARA_from_json(j: JSON_VALUE | undefined): C_PARA {
  if (!isObject(j))
    throw new JSON_EXCEPTION(
      `[json.exception.type_error.302] type must be object, but is ${typeName(j)}`,
    );

  const d: C_PARA = { package: '', pre: '', Contributor: '', link: '', Model_3D: '' };

  if (has(j, 'package')) d.package = getString(j.package);
  if (has(j, 'pre')) d.pre = getString(j.pre);
  if (has(j, 'Contributor')) d.Contributor = getString(j.Contributor);
  if (has(j, 'link')) d.link = getString(j.link);
  if (has(j, 'Model_3D')) d.Model_3D = getString(j.Model_3D);

  return d;
}

export enum POWER_FLAG_STYLE {
  UNKNOWN = -1,

  CIRCLE = 0,
  ARROW = 1,
  BAR = 2,
  WAVE = 3,
  POWER_GROUND = 4,
  SIGNAL_GROUND = 5,
  EARTH = 6,
  GOST_ARROW = 7,
  GOST_POWER_GROUND = 8,
  GOST_EARTH = 9,
  GOST_BAR = 10,
}
