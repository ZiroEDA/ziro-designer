// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/io/easyeda/easyeda_parser_structs.cpp` / `.h`: the EasyEDA Std
 * document headers and their `from_json`.
 *
 * nlohmann's `get_to` throws `type_error` when the JSON value is not the C++
 * type it is read into (a number read as a `wxString`, a non-string in a
 * `std::map<wxString, wxString>`); `common/json_common.ts` gives those reads
 * and their `JSON_EXCEPTION`, which every `json::exception` catch here catches.
 */

import {
  isObject,
  jMap,
  jParse,
  jParseDiscarding,
  JSON_EXCEPTION,
  type JSON_OBJECT,
  type JSON_VALUE,
  jStr,
  typeName,
} from '../../json_common.js';
import { strtodPrefix, ToLong } from '../../libc/stdlib.js';

export { isObject, JSON_EXCEPTION, type JSON_VALUE };

/** `j.get<wxString>()`. */
export const getString = (j: JSON_VALUE | undefined): string => jStr(j);

/** `j.get<std::map<wxString, wxString>>()`. */
export const getStringMap = (j: JSON_VALUE | undefined): Map<string, string> => jMap(j, jStr);

/** `j.get<wxArrayString>()` / `std::vector<wxString>`. */
export function getStringArray(j: JSON_VALUE | undefined): string[] {
  if (!Array.isArray(j))
    throw new JSON_EXCEPTION(
      `[json.exception.type_error.302] type must be array, but is ${typeName(j)}`,
    );

  return j.map((v) => jStr(v));
}

/** `nlohmann::json::parse( text, nullptr, false )`: undefined when discarded. */
export const parseJsonDiscarding = jParseDiscarding;

/** `nlohmann::json::parse( text )`: throws `parse_error` on bad input. */
export const parseJson = jParse;

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
