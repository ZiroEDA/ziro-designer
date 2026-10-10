// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/odbpp/odb_attribute.{h,cpp}`: ODB++ attributes - the typed attribute tags, the
 * per-file name / text tables (ATTR_MANAGER) and a record's `;id=value,…` list (ATTR_RECORD_WRITER).
 *
 * Upstream builds each attribute as a C++ type through DEFINE_*_ATTR macros; here each is a small
 * descriptor carrying the same name, kind and (for floats) digits. Names and texts are numbered
 * in first-use order; the hash maps that remember them are only looked up.
 */
import { Double2StringDigits, GenLegalEntityName, OSTREAM } from './odb_util.js';

export enum ATTR_TYPE {
  FLOAT,
  BOOLEAN,
  TEXT,
  OPTION,
  INTEGER,
}

/** One attribute value with its definition: name, kind, and the value as upstream holds it. */
export interface ODB_ATTRIBUTE {
  readonly name: string;
  readonly type: ATTR_TYPE;
  readonly value: number | boolean | string;
  readonly digits?: number;
}

const bool =
  (name: string) =>
  (v: boolean): ODB_ATTRIBUTE => ({ name, type: ATTR_TYPE.BOOLEAN, value: v });

// TextAttribute: the value goes through GenLegalEntityName when it is made.
const text =
  (name: string) =>
  (v: string): ODB_ATTRIBUTE => ({
    name,
    type: ATTR_TYPE.TEXT,
    value: GenLegalEntityName(v),
  });

const float =
  (name: string, digits: number) =>
  (v: number): ODB_ATTRIBUTE => ({
    name,
    type: ATTR_TYPE.FLOAT,
    value: v,
    digits,
  });

/** An OPTION attribute is written as its enum's integer value. */
const option =
  (name: string) =>
  (v: number): ODB_ATTRIBUTE => ({ name, type: ATTR_TYPE.OPTION, value: v });

export enum DRILL {
  PLATED,
  NON_PLATED,
  VIA,
}

export enum PAD_USAGE {
  TOEPRINT,
  VIA,
  G_FIDUCIAL,
  L_FIDUCIAL,
  TOOLING_HOLE,
  BOND_FINGER,
}

export enum PLATED_TYPE {
  STANDARD,
  PRESS_FIT,
}

export enum VIA_TYPE {
  DRILLED,
  LASER,
  PHOTO,
}

export enum COMP_MOUNT_TYPE {
  OTHER,
  MT_SMD,
  THT,
  PRESSFIT,
}

/** The attribute definitions (`namespace ODB_ATTR`). */
export const ODB_ATTR = {
  // BOOLEAN ATTRIBUTES
  SMD: bool('SMD'),
  NET_POINT: bool('NET_POINT'),
  ROUT_PLATED: bool('ROUT_PLATED'),
  MECHANICAL: bool('MECHANICAL'),
  MOUNT_HOLE: bool('MOUNT_HOLE'),
  TEAR_DROP: bool('TEAR_DROP'),
  TEST_POINT: bool('TEST_POINT'),
  // TEXT ATTRIBUTES
  STRING: text('STRING'),
  GEOMETRY: text('GEOMETRY'),
  NET_NAME: text('NET_NAME'),
  // FLOAT ATTRIBUTES
  BOARD_THICKNESS: float('BOARD_THICKNESS', 1), // 0.0~10.0
  STRING_ANGLE: float('STRING_ANGLE', 1), // 0.0~360.0
  // OPTION ATTRIBUTES
  DRILL: option('DRILL'),
  PAD_USAGE: option('PAD_USAGE'),
  PLATED_TYPE: option('PLATED_TYPE'),
  VIA_TYPE: option('VIA_TYPE'),
  COMP_MOUNT_TYPE: option('COMP_MOUNT_TYPE'),
  NO_POP: bool('NO_POP'),
};

/** `ATTR_RECORD_WRITER`: a record's attributes, `std::map<unsigned, std::string>` (by id). */
export class ATTR_RECORD_WRITER {
  readonly m_ODBattributes = new Map<number, string>();

  WriteAttributes(ost: OSTREAM): void {
    let first = true;

    ost.write(' ');

    for (const id of [...this.m_ODBattributes.keys()].sort((a, b) => a - b)) {
      const value = this.m_ODBattributes.get(id)!;
      ost.write(first ? ';' : ',');
      first = false;
      ost.write(id);

      if (value.length) ost.write('=', value);
    }
  }
}

export class ATTR_MANAGER {
  private m_attrNames = new Map<string, number>();
  private m_attrNameVec: [number, string][] = [];
  private m_attrTexts = new Map<string, number>();
  private m_attrTextVec: [number, string][] = [];

  /** `AddSystemAttribute`: `.name` (lower-cased) and the value, into the record. */
  AddSystemAttribute(r: ATTR_RECORD_WRITER, v: ODB_ATTRIBUTE): void {
    const id = this.GetAttrNameNumber(`.${v.name}`);

    // std::map::emplace: an id already set keeps its value.
    if (!r.m_ODBattributes.has(id)) r.m_ODBattributes.set(id, this.AttrValue2String(v));
  }

  AddUserDefAttribute(r: ATTR_RECORD_WRITER, v: ODB_ATTRIBUTE): void {
    const id = this.GetAttrNameNumber(v.name);

    if (!r.m_ODBattributes.has(id)) r.m_ODBattributes.set(id, this.AttrValue2String(v));
  }

  protected GetAttrNameNumber(aName: string): number {
    return this.GetTextIndex(this.m_attrNames, this.m_attrNameVec, aName.toLowerCase());
  }

  private GetAttrTextNumber(aText: string): number {
    return this.GetTextIndex(this.m_attrTexts, this.m_attrTextVec, aText.toUpperCase());
  }

  private GetTextIndex(aMap: Map<string, number>, aVec: [number, string][], aText: string): number {
    const known = aMap.get(aText);

    if (known !== undefined) return known;

    const index = aMap.size;
    aMap.set(aText, index);
    aVec.push([index, aText]);

    return index;
  }

  private AttrValue2String(a: ODB_ATTRIBUTE): string {
    switch (a.type) {
      case ATTR_TYPE.FLOAT:
        return Double2StringDigits(a.value as number, a.digits!);
      case ATTR_TYPE.BOOLEAN:
        return '';
      case ATTR_TYPE.TEXT:
        return String(this.GetAttrTextNumber(a.value as string));
      default:
        // An enum: std::to_string( static_cast<int>( v ) ).
        return String(a.value);
    }
  }

  protected WriteAttributesName(ost: OSTREAM, prefix = ''): void {
    for (const [n, name] of this.m_attrNameVec) ost.write(prefix, '@', n, ' ', name, '\n');
  }

  protected WriteAttributesText(ost: OSTREAM, prefix = ''): void {
    for (const [n, name] of this.m_attrTextVec) ost.write(prefix, '&', n, ' ', name, '\n');
  }

  /** Upstream takes a prefix and drops it: the name and text tables are written without one. */
  protected WriteAttributes(ost: OSTREAM, _prefix = ''): void {
    ost.write('\n', '#\n#Feature attribute names\n#', '\n');
    this.WriteAttributesName(ost);

    ost.write('\n', '#\n#Feature attribute text strings\n#', '\n');
    this.WriteAttributesText(ost);
  }
}
