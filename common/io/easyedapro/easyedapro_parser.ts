// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/io/easyedapro/easyedapro_parser.cpp` / `.h`: the EasyEDA (JLCEDA)
 * Pro document records — one JSON array per line of an `.epcb` / `.efoo` /
 * `.esch` — and the project file's entries, each with its `from_json`.
 */

import {
  isBoolean,
  isNumber,
  isNumberInteger,
  isObject,
  isString,
  jAt,
  jBool,
  jContains,
  jInt,
  jNum,
  jStr,
  jValue,
  jValues,
  JSON_EXCEPTION,
  type JSON_VALUE,
  sortedKeys,
} from '../../json_common.js';
import { AnyMapToStringMap } from './easyedapro_import_utils.js';

export const IMPORT_POURED = true;
export const IMPORT_POURED_ECOP = false;

export enum SYMBOL_TYPE {
  NORMAL = 2,
  POWER_PORT = 18,
  NETPORT = 19,
  SHEET_SYMBOL = 20,
  SHORT = 22,
}

export enum FOOTPRINT_TYPE {
  NORMAL = 4,
}

interface VEC2 {
  x: number;
  y: number;
}

export interface SCH_ATTR {
  id: string;
  parentId: string;
  key: string;
  value: string;
  keyVisible: boolean;
  valVisible: boolean;
  position: VEC2 | undefined;
  rotation: number;
  fontStyle: string;
}

export interface PCB_ATTR {
  id: string;
  layer: number;
  parentId: string;
  textOrigin: number;
  position: VEC2;
  key: string;
  value: string;
  keyVisible: boolean;
  valVisible: boolean;
  fontName: string;
  height: number;
  strokeWidth: number;
  rotation: number;
  inverted: number;
}

export interface SCH_COMPONENT {
  id: string;
  name: string;
  position: VEC2;
  rotation: number;
  mirror: boolean;
  customProps: JSON_VALUE;
  unk1: number;
  unk2: number;
}

export interface SCH_WIRE {
  id: string;
  geometry: number[][];
  lineStyle: string;
  unk1: number;
}

export interface SYM_PIN {
  id: string;
  position: VEC2;
  length: number;
  rotation: number;
  inverted: boolean;
}

export interface SYM_HEAD {
  origin: VEC2;
  version: string;
  maxId: number;
  symbolType: SYMBOL_TYPE;
}

export interface PRJ_SHEET {
  id: number;
  name: string;
  uuid: string;
}

export interface PRJ_SCHEMATIC {
  name: string;
  sheets: PRJ_SHEET[];
}

export interface PRJ_BOARD {
  schematic: string;
  pcb: string;
}

export interface PRJ_SYMBOL {
  source: string;
  desc: string;
  tags: JSON_VALUE;
  custom_tags: JSON_VALUE;
  title: string;
  version: string;
  type: SYMBOL_TYPE;
}

export interface PRJ_FOOTPRINT {
  source: string;
  desc: string;
  tags: JSON_VALUE;
  custom_tags: JSON_VALUE;
  title: string;
  version: string;
  type: FOOTPRINT_TYPE;
}

export interface PRJ_DEVICE {
  source: string;
  description: string;
  tags: JSON_VALUE;
  custom_tags: JSON_VALUE;
  title: string;
  version: string;
  attributes: Map<string, string>;
}

export interface BLOB {
  objectId: string;
  url: string;
}

export interface POURED {
  pouredId: string;
  parentId: string;
  unki: number;
  isPoly: boolean;
  polyData: JSON_VALUE;
}

/** `bool b = j.get<int>()` or `j.get<bool>()`, whichever the value is. */
function visible(j: JSON_VALUE, cur: boolean): boolean {
  if (isNumber(j)) return jInt(j) !== 0;
  if (isBoolean(j)) return j;
  return cur;
}

export function SCH_ATTR_from_json(j: JSON_VALUE): SCH_ATTR {
  const d: SCH_ATTR = {
    id: jStr(jAt(j, 1)),
    parentId: jStr(jAt(j, 2)),
    key: jStr(jAt(j, 3)),
    value: '',
    keyVisible: false,
    valVisible: false,
    position: undefined,
    rotation: 0,
    fontStyle: '',
  };

  if (isString(jAt(j, 4))) d.value = jStr(jAt(j, 4));

  d.keyVisible = visible(jAt(j, 5), d.keyVisible);
  d.valVisible = visible(jAt(j, 6), d.valVisible);

  if (isNumber(jAt(j, 7)) && isNumber(jAt(j, 8)))
    d.position = { x: jNum(jAt(j, 7)), y: jNum(jAt(j, 8)) };

  if (isNumber(jAt(j, 9))) d.rotation = jNum(jAt(j, 9));

  if (isString(jAt(j, 10))) d.fontStyle = jStr(jAt(j, 10));

  return d;
}

export function PCB_ATTR_from_json(j: JSON_VALUE): PCB_ATTR {
  const d: PCB_ATTR = {
    id: jStr(jAt(j, 1)),
    layer: 0,
    parentId: jStr(jAt(j, 3)),
    textOrigin: 0,
    position: { x: 0, y: 0 },
    key: '',
    value: '',
    keyVisible: false,
    valVisible: false,
    fontName: '',
    height: 0,
    strokeWidth: 0,
    rotation: 0,
    inverted: 0,
  };

  d.layer = jInt(jAt(j, 4));

  if (isNumber(jAt(j, 5)) && isNumber(jAt(j, 6)))
    d.position = { x: jNum(jAt(j, 5)), y: jNum(jAt(j, 6)) };

  d.key = jStr(jAt(j, 7));

  const v = jAt(j, 8);

  if (isString(v)) d.value = v;
  else if (isNumberInteger(v)) d.value += String(jInt(v)); // `d.value << j.get<int>()`

  d.keyVisible = visible(jAt(j, 9), d.keyVisible);
  d.valVisible = visible(jAt(j, 10), d.valVisible);

  if (isString(jAt(j, 11))) d.fontName = jStr(jAt(j, 11));

  if (isNumber(jAt(j, 12))) d.height = jNum(jAt(j, 12));

  if (isNumber(jAt(j, 13))) d.strokeWidth = jNum(jAt(j, 13));

  if (isNumber(jAt(j, 16))) d.textOrigin = jInt(jAt(j, 16));

  if (isNumber(jAt(j, 17))) d.rotation = jNum(jAt(j, 17));

  if (isNumber(jAt(j, 18))) d.inverted = jInt(jAt(j, 18));

  return d;
}

export function SCH_COMPONENT_from_json(j: JSON_VALUE): SCH_COMPONENT {
  const d: SCH_COMPONENT = {
    id: jStr(jAt(j, 1)),
    name: jStr(jAt(j, 2)),
    position: { x: 0, y: 0 },
    rotation: 0,
    mirror: false,
    customProps: null,
    unk1: 0,
    unk2: 0,
  };

  if (isNumber(jAt(j, 3)) && isNumber(jAt(j, 4)))
    d.position = { x: jNum(jAt(j, 3)), y: jNum(jAt(j, 4)) };

  if (isNumber(jAt(j, 5))) d.rotation = jNum(jAt(j, 5));

  if (isNumber(jAt(j, 6))) d.mirror = jInt(jAt(j, 6)) !== 0;

  if (isNumber(jAt(j, 6))) d.unk1 = jInt(jAt(j, 6));

  if (isObject(jAt(j, 7))) d.customProps = jAt(j, 7);

  if (isNumber(jAt(j, 8))) d.unk2 = jInt(jAt(j, 8));

  return d;
}

export function SCH_WIRE_from_json(j: JSON_VALUE): SCH_WIRE {
  const geometry = jValues(jAt(j, 2)).map((row) => {
    if (!Array.isArray(row)) return [jNum(row)];
    return row.map(jNum);
  });

  const d: SCH_WIRE = { id: jStr(jAt(j, 1)), geometry, lineStyle: '', unk1: 0 };

  if (isString(jAt(j, 3))) d.lineStyle = jStr(jAt(j, 3));

  return d;
}

export function SYM_PIN_from_json(j: JSON_VALUE): SYM_PIN {
  const d: SYM_PIN = {
    id: jStr(jAt(j, 1)),
    position: { x: 0, y: 0 },
    length: 0,
    rotation: 0,
    inverted: false,
  };

  if (isNumber(jAt(j, 4)) && isNumber(jAt(j, 5)))
    d.position = { x: jNum(jAt(j, 4)), y: jNum(jAt(j, 5)) };

  if (isNumber(jAt(j, 6))) d.length = jNum(jAt(j, 6));

  if (isNumber(jAt(j, 7))) d.rotation = jNum(jAt(j, 7));

  if (isNumber(jAt(j, 9))) d.inverted = jInt(jAt(j, 9)) === 2;

  return d;
}

export function SYM_HEAD_from_json(j: JSON_VALUE): SYM_HEAD {
  const d: SYM_HEAD = {
    origin: { x: 0, y: 0 },
    version: '',
    maxId: 0,
    symbolType: SYMBOL_TYPE.NORMAL,
  };

  if (!isObject(jAt(j, 1))) return d;

  const config = jAt(j, 1);

  // `config.value( "originX", 0 )`: the default is an int, so the value is read as one
  d.origin.x = jValue(config, 'originX', 0, jInt);
  d.origin.y = jValue(config, 'originY', 0, jInt);
  d.maxId = jValue(config, 'maxId', 0, jInt);
  d.version = jValue(config, 'version', '', jStr);
  d.symbolType = jValue(config, 'symbolType', SYMBOL_TYPE.NORMAL, (v) => jInt(v) as SYMBOL_TYPE);

  return d;
}

export function PRJ_SHEET_from_json(j: JSON_VALUE): PRJ_SHEET {
  return {
    name: jValue(j, 'name', '', jStr),
    uuid: jValue(j, 'uuid', '', jStr),
    id: jValue(j, 'id', 0, jInt),
  };
}

export function PRJ_SCHEMATIC_from_json(j: JSON_VALUE): PRJ_SCHEMATIC {
  return {
    name: jValue(j, 'name', '', jStr),
    sheets: jValue(j, 'sheets', [] as PRJ_SHEET[], (v) => {
      if (!Array.isArray(v))
        throw new JSON_EXCEPTION('[json.exception.type_error.302] type must be array');
      return v.map(PRJ_SHEET_from_json);
    }),
  };
}

export function PRJ_BOARD_from_json(j: JSON_VALUE): PRJ_BOARD {
  return { schematic: jValue(j, 'schematic', '', jStr), pcb: jValue(j, 'pcb', '', jStr) };
}

interface PRJ_ITEM_COMMON {
  source: string;
  desc: string;
  tags: JSON_VALUE;
  custom_tags: JSON_VALUE;
  title: string;
  version: string;
}

function commonFromJson(j: JSON_VALUE): PRJ_ITEM_COMMON {
  const d: PRJ_ITEM_COMMON = {
    source: '',
    desc: '',
    tags: null,
    custom_tags: null,
    title: '',
    version: '',
  };

  if (isString(jAt(j, 'source'))) d.source = jStr(jAt(j, 'source'));

  if (jContains(j, 'desc')) d.desc = jStr(jAt(j, 'desc'));
  else if (jContains(j, 'description')) d.desc = jStr(jAt(j, 'description'));

  if (jContains(j, 'display_title')) d.title = jStr(jAt(j, 'display_title'));
  else if (jContains(j, 'title')) d.title = jStr(jAt(j, 'title'));

  if (isString(jAt(j, 'version'))) d.version = jStr(jAt(j, 'version'));

  if (jContains(j, 'tags') && isObject(jAt(j, 'tags'))) d.tags = jAt(j, 'tags');

  if (jContains(j, 'custom_tags') && isObject(jAt(j, 'custom_tags')))
    d.custom_tags = jAt(j, 'custom_tags');

  return d;
}

export function PRJ_SYMBOL_from_json(j: JSON_VALUE): PRJ_SYMBOL {
  const c = commonFromJson(j);
  const d: PRJ_SYMBOL = { ...c, type: SYMBOL_TYPE.NORMAL };

  if (isNumber(jAt(j, 'type'))) d.type = jInt(jAt(j, 'type')) as SYMBOL_TYPE;

  return d;
}

export function PRJ_FOOTPRINT_from_json(j: JSON_VALUE): PRJ_FOOTPRINT {
  const c = commonFromJson(j);
  const d: PRJ_FOOTPRINT = { ...c, type: FOOTPRINT_TYPE.NORMAL };

  if (isNumber(jAt(j, 'type'))) d.type = jInt(jAt(j, 'type')) as FOOTPRINT_TYPE;

  return d;
}

export function PRJ_DEVICE_from_json(j: JSON_VALUE): PRJ_DEVICE {
  // the same members as the others, but `desc` lands in `description` and there is no type
  const d: PRJ_DEVICE = { ...renameDesc(commonFromJson(j)), attributes: new Map() };

  if (isObject(jAt(j, 'attributes'))) {
    const attrs = jAt(j, 'attributes') as { [k: string]: JSON_VALUE };
    const m = new Map<string, JSON_VALUE>();

    for (const k of sortedKeys(attrs)) m.set(k, attrs[k]!);

    d.attributes = AnyMapToStringMap(m);
  }

  return d;
}

function renameDesc(c: PRJ_ITEM_COMMON): Omit<PRJ_DEVICE, 'attributes'> {
  const { desc, ...rest } = c;
  return { ...rest, description: desc };
}

export function BLOB_from_json(j: JSON_VALUE): BLOB {
  return { objectId: jStr(jAt(j, 1)), url: jStr(jAt(j, 3)) };
}

export function POURED_from_json(j: JSON_VALUE): POURED {
  return {
    pouredId: jStr(jAt(j, 1)),
    parentId: jStr(jAt(j, 2)),
    unki: jInt(jAt(j, 3)),
    isPoly: jBool(jAt(j, 4)),
    polyData: jAt(j, 5),
  };
}
