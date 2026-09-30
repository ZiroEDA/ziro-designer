// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
// biome-ignore-all lint/suspicious/noAssignInExpressions: every `while( ( tok = NextTok() ) != T_RIGHT )` is the C++ loop shape
/**
 * `pcbnew/specctra_import_export/specctra.h` + `specctra.cpp`: the SPECCTRA
 * DSN / SES element classes, their `Format()` writers, and the `SPECCTRA_DB`
 * that reads and writes them.
 *
 * ## Tokens are their own text
 *
 * `DSN_T` is the lexer's keyword enum upstream (`specctra.keywords`); here it
 * is the keyword's text, exactly as `common/dsnlexer.ts` hands an unquoted word
 * back, so `GetTokenText( T_inch )` is the identity and `ELEM::Name()` is the
 * `type` field itself. An unset `DSN_T` (`T_NONE`) is the empty string.
 *
 * ## `friend class SPECCTRA_DB`
 *
 * TypeScript has no `friend`, so every member `SPECCTRA_DB` reaches is public.
 * Ownership (`delete`, `boost::ptr_vector`) is the garbage collector's.
 *
 * ## printf
 *
 * `%.6g` is `formatG( x, 6 )`, the glibc-exact conversion `string_utils.ts`
 * already carries; `%d` of an `int` is the number itself.
 */

import { formatG } from '@ziroeda/common/plotters/fmt.js';
import { FormatDouble2Str } from '@ziroeda/common/string_utils.js';
import { GetBuildVersion } from '@ziroeda/common/build_version.js';
import { DSNLEXER, T, type Tok } from '@ziroeda/common/dsnlexer.js';
import { OUTPUTFORMATTER, STRING_FORMATTER } from '@ziroeda/common/richio.js';

/** `DSN_T`: a keyword's text ('' is `T_NONE`). */
export type DSN_T = string;
export const T_NONE: DSN_T = '';

/** `GetTokenText( T aTok )`. */
export const GetTokenText = (aTok: DSN_T): string => aTok;

/** `%.6g`. */
export const g6 = (aValue: number): string => formatG(aValue, 6);

/** `std::string::compare`: bytewise (UTF-16 code units here; the hashes are ASCII). */
const compareStd = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** A point in the SPECCTRA DSN coordinate system, or a distance from some origin. */
export class POINT {
  constructor(
    public x = 0.0,
    public y = 0.0,
  ) {}

  equals(other: POINT): boolean {
    return this.x === other.x && this.y === other.y;
  }

  /** `operator+=`. */
  add(other: POINT): this {
    this.x += other.x;
    this.y += other.y;
    return this;
  }

  /** `operator=`. */
  assign(other: POINT): this {
    this.x = other.x;
    this.y = other.y;
    return this;
  }

  clone(): POINT {
    return new POINT(this.x, this.y);
  }

  /** Change negative zero to positive zero. */
  FixNegativeZero(): void {
    if (this.x === 0) this.x = 0.0;
    if (this.y === 0) this.y = 0.0;
  }

  /** `POINT::Format`: ` %.6g %.6g`. */
  Format(out: OUTPUTFORMATTER, nestLevel: number): void {
    out.Print(nestLevel, ` ${g6(this.x)} ${g6(this.y)}`);
  }
}

export interface PROPERTY {
  name: string;
  value: string;
}

/** `PROPERTY::Format`. */
export function FormatProperty(p: PROPERTY, out: OUTPUTFORMATTER, nestLevel: number): void {
  const quoteName = out.GetQuoteChar(p.name);
  const quoteValue = out.GetQuoteChar(p.value);

  out.Print(
    nestLevel,
    `(${quoteName}${p.name}${quoteName} ${quoteValue}${p.value}${quoteValue})\n`,
  );
}

/** A base class for any DSN element class. */
export class ELEM {
  /** `static STRING_FORMATTER sf`: avoids creating one for every compare. */
  static readonly sf = new STRING_FORMATTER();

  constructor(
    public type: DSN_T,
    public parent: ELEM | null = null,
  ) {}

  Type(): DSN_T {
    return this.type;
  }

  Name(): string {
    return GetTokenText(this.type);
  }

  /** The units for this section, from a local or parent scope. */
  GetUnits(): UNIT_RES {
    if (this.parent) return this.parent.GetUnits();

    return UNIT_RES.Default;
  }

  /** Write this object as ASCII out to an OUTPUTFORMATTER according to the SPECCTRA DSN format. */
  Format(out: OUTPUTFORMATTER, nestLevel: number): void {
    out.Print(nestLevel, `(${this.Name()}\n`);
    this.FormatContents(out, nestLevel + 1);
    out.Print(nestLevel, ')\n');
  }

  /** The contents only: `Format()` without the outer wrapper. */
  FormatContents(_out: OUTPUTFORMATTER, _nestLevel: number): void {
    // overridden in ELEM_HOLDER
  }

  SetParent(aParent: ELEM | null): void {
    this.parent = aParent;
  }

  /** A string which uniquely represents this ELEM among others of the same class. */
  makeHash(): string {
    ELEM.sf.Clear();
    this.FormatContents(ELEM.sf, 0);
    ELEM.sf.StripUseless();

    return ELEM.sf.GetString();
  }
}

/** A holder for any DSN class, including classes derived from this one. */
export class ELEM_HOLDER extends ELEM {
  kids: ELEM[] = [];

  override FormatContents(out: OUTPUTFORMATTER, nestLevel: number): void {
    for (const kid of this.kids) kid.Format(out, nestLevel);
  }

  /** The index of instance `instanceNum` of `aType`, or -1. */
  FindElem(aType: DSN_T, instanceNum = 0): number {
    let repeats = 0;

    for (let i = 0; i < this.kids.length; ++i) {
      if (this.kids[i]!.Type() !== aType) continue;

      if (repeats === instanceNum) return i;

      ++repeats;
    }

    return -1;
  }

  Length(): number {
    return this.kids.length;
  }

  Append(aElem: ELEM): void {
    this.kids.push(aElem);
  }

  Replace(aIndex: number, aElem: ELEM): ELEM {
    const old = this.kids[aIndex]!;
    this.kids[aIndex] = aElem;
    return old;
  }

  Remove(aIndex: number): ELEM {
    return this.kids.splice(aIndex, 1)[0]!;
  }

  Insert(aIndex: number, aElem: ELEM): void {
    this.kids.splice(aIndex, 0, aElem);
  }

  At(aIndex: number): ELEM {
    return this.kids[aIndex]!;
  }

  Delete(aIndex: number): void {
    this.kids.splice(aIndex, 1);
  }
}

/** A configuration record: `<parser_descriptor>`. */
export class PARSER extends ELEM {
  string_quote = '"';
  space_in_quoted_tokens = false;
  case_sensitive = false;
  wires_include_testpoint = false;
  routes_include_testpoint = false;
  routes_include_guides = false;
  routes_include_image_conductor = false;
  via_rotate_first = true;
  generated_by_freeroute = false;
  /** Pairs of strings, one pair for each constant definition. */
  constants: string[] = [];
  host_cad = "KiCad's Pcbnew";
  host_version = GetBuildVersion();

  constructor(aParent: ELEM | null) {
    super('parser', aParent);
  }

  override FormatContents(out: OUTPUTFORMATTER, nestLevel: number): void {
    out.Print(nestLevel, `(string_quote ${this.string_quote})\n`);
    out.Print(
      nestLevel,
      `(space_in_quoted_tokens ${this.space_in_quoted_tokens ? 'on' : 'off'})\n`,
    );
    out.Print(nestLevel, `(host_cad "${this.host_cad}")\n`);
    out.Print(nestLevel, `(host_version "${this.host_version}")\n`);

    for (let i = 0; i < this.constants.length; i += 2) {
      const s1 = this.constants[i]!;
      const s2 = this.constants[i + 1]!;
      const q1 = out.GetQuoteChar(s1);
      const q2 = out.GetQuoteChar(s2);

      out.Print(nestLevel, `(constant ${q1}${s1}${q1} ${q2}${s2}${q2})\n`);
    }

    if (
      this.routes_include_testpoint ||
      this.routes_include_guides ||
      this.routes_include_image_conductor
    ) {
      out.Print(
        nestLevel,
        `(routes_include${this.routes_include_testpoint ? ' testpoint' : ''}${this.routes_include_guides ? ' guides' : ''}${this.routes_include_image_conductor ? ' image_conductor' : ''})\n`,
      );
    }

    if (this.wires_include_testpoint) out.Print(nestLevel, '(wires_include testpoint)\n');

    if (!this.via_rotate_first) out.Print(nestLevel, '(via_rotate_first off)\n');

    if (this.case_sensitive)
      out.Print(nestLevel, `(case_sensitive ${this.case_sensitive ? 'on' : 'off'})\n`);
  }
}

/** Either a `unit` or a `resolution`, mutually exclusive in the grammar except within `pcb`. */
export class UNIT_RES extends ELEM {
  /** A static instance which holds the default units of `inch` and 2540000. */
  static Default: UNIT_RES;

  units: DSN_T = 'inch';
  value = 2540000;

  constructor(aParent: ELEM | null, aType: DSN_T) {
    super(aType, aParent);
  }

  GetEngUnits(): DSN_T {
    return this.units;
  }

  GetValue(): number {
    return this.value;
  }

  override Format(out: OUTPUTFORMATTER, nestLevel: number): void {
    if (this.type === 'unit')
      out.Print(nestLevel, `(${this.Name()} ${GetTokenText(this.units)})\n`);
    // resolution
    else out.Print(nestLevel, `(${this.Name()} ${GetTokenText(this.units)} ${this.value})\n`);
  }
}

UNIT_RES.Default = new UNIT_RES(null, 'resolution');

/** `<rectangle_descriptor>`. */
export class RECTANGLE extends ELEM {
  layer_id = '';
  /** one of two opposite corners */
  point0 = new POINT();
  point1 = new POINT();

  constructor(aParent: ELEM | null) {
    super('rect', aParent);
  }

  SetLayerId(aLayerId: string): void {
    this.layer_id = aLayerId;
  }

  SetCorners(aPoint0: POINT, aPoint1: POINT): void {
    this.point0 = aPoint0.clone();
    this.point0.FixNegativeZero();
    this.point1 = aPoint1.clone();
    this.point1.FixNegativeZero();
  }

  GetOrigin(): POINT {
    return this.point0;
  }

  GetEnd(): POINT {
    return this.point1;
  }

  override Format(out: OUTPUTFORMATTER, nestLevel: number): void {
    const newline = nestLevel ? '\n' : '';
    const quote = out.GetQuoteChar(this.layer_id);

    out.Print(
      nestLevel,
      `(${this.Name()} ${quote}${this.layer_id}${quote} ${g6(this.point0.x)} ${g6(this.point0.y)} ${g6(this.point1.x)} ${g6(this.point1.y)})${newline}`,
    );
  }
}

/** `<rule_descriptor>`, in string form. */
export class RULE extends ELEM {
  /** rules are saved in std::string form. */
  m_rules: string[] = [];

  constructor(aParent: ELEM | null, aType: DSN_T) {
    super(aType, aParent);
  }

  override Format(out: OUTPUTFORMATTER, nestLevel: number): void {
    out.Print(nestLevel, `(${this.Name()}`);

    let singleLine: boolean;

    if (this.m_rules.length === 1) {
      singleLine = true;
      out.Print(0, ` ${this.m_rules[0]})`);
    } else {
      out.Print(0, '\n');
      singleLine = false;

      for (const rule of this.m_rules) out.Print(nestLevel + 1, `${rule}\n`);

      out.Print(nestLevel, ')');
    }

    if (nestLevel || !singleLine) out.Print(0, '\n');
  }
}

/** `<layer_rule_descriptor>`. */
export class LAYER_RULE extends ELEM {
  m_layer_ids: string[] = [];
  m_rule: RULE | null = null;

  constructor(aParent: ELEM | null) {
    super('layer_rule', aParent);
  }

  override Format(out: OUTPUTFORMATTER, nestLevel: number): void {
    out.Print(nestLevel, `(${this.Name()}`);

    for (const layer of this.m_layer_ids) {
      const quote = out.GetQuoteChar(layer);
      out.Print(0, ` ${quote}${layer}${quote}`);
    }

    out.Print(0, '\n');

    if (this.m_rule) this.m_rule.Format(out, nestLevel + 1);

    out.Print(nestLevel, ')\n');
  }
}

/** `<path_descriptor>`, and the `polygon` and `polyline_path` that share its layout. */
export class PATH extends ELEM {
  layer_id = '';
  aperture_width = 0.0;
  points: POINT[] = [];
  aperture_type: DSN_T = 'round';

  constructor(aParent: ELEM | null, aType: DSN_T = 'path') {
    super(aType, aParent);
  }

  AppendPoint(aPoint: POINT): void {
    this.points.push(aPoint);
  }

  GetPoints(): POINT[] {
    return this.points;
  }

  SetLayerId(aLayerId: string): void {
    this.layer_id = aLayerId;
  }

  SetAperture(aWidth: number): void {
    this.aperture_width = aWidth;
  }

  override Format(out: OUTPUTFORMATTER, nestLevel: number): void {
    const newline = nestLevel ? '\n' : '';
    const quote = out.GetQuoteChar(this.layer_id);

    const RIGHTMARGIN = 70;
    let perLine = out.Print(
      nestLevel,
      `(${this.Name()} ${quote}${this.layer_id}${quote} ${g6(this.aperture_width)}`,
    );

    const wrapNest = Math.max(nestLevel + 1, 6);

    for (const pt of this.points) {
      if (perLine > RIGHTMARGIN) {
        out.Print(0, '\n');
        perLine = out.Print(wrapNest, '');
      } else {
        perLine += out.Print(0, '  ');
      }

      perLine += out.Print(0, `${g6(pt.x)} ${g6(pt.y)}`);
    }

    if (this.aperture_type === 'square') out.Print(0, '(aperture_type square)');

    out.Print(0, `)${newline}`);
  }
}

/** `<boundary_descriptor>`. */
export class BOUNDARY extends ELEM {
  // only one or the other of these two is used, not both
  paths: PATH[] = [];
  rectangle: RECTANGLE | null = null;

  constructor(aParent: ELEM | null, aType: DSN_T = 'boundary') {
    super(aType, aParent);
  }

  /** The corner coordinates, x then y, appended to `aBuffer`. */
  GetCorners(aBuffer: number[]): void {
    if (this.rectangle) {
      const o = this.rectangle.GetOrigin();
      const e = this.rectangle.GetEnd();

      aBuffer.push(o.x, o.y);
      aBuffer.push(o.x, e.y);
      aBuffer.push(e.x, e.y);
      aBuffer.push(e.x, o.y);
    } else {
      for (const path of this.paths) {
        for (const pt of path.GetPoints()) aBuffer.push(pt.x, pt.y);
      }
    }
  }

  override Format(out: OUTPUTFORMATTER, nestLevel: number): void {
    out.Print(nestLevel, `(${this.Name()}\n`);

    if (this.rectangle) this.rectangle.Format(out, nestLevel + 1);
    else {
      for (const path of this.paths) path.Format(out, nestLevel + 1);
    }

    out.Print(nestLevel, ')\n');
  }
}

/** `<circle_descriptor>`. */
export class CIRCLE extends ELEM {
  layer_id = '';
  diameter = 0.0;
  vertex = new POINT();

  constructor(aParent: ELEM | null) {
    super('circle', aParent);
  }

  override Format(out: OUTPUTFORMATTER, nestLevel: number): void {
    const newline = nestLevel ? '\n' : '';
    const quote = out.GetQuoteChar(this.layer_id);

    out.Print(nestLevel, `(${this.Name()} ${quote}${this.layer_id}${quote} ${g6(this.diameter)}`);

    if (this.vertex.x !== 0.0 || this.vertex.y !== 0.0)
      out.Print(0, ` ${g6(this.vertex.x)} ${g6(this.vertex.y)})${newline}`);
    else out.Print(0, `)${newline}`);
  }

  SetLayerId(aLayerId: string): void {
    this.layer_id = aLayerId;
  }

  SetDiameter(aDiameter: number): void {
    this.diameter = aDiameter;
  }

  SetVertex(aVertex: POINT): void {
    this.vertex = aVertex.clone();
  }
}

/** `<qarc_descriptor>`. */
export class QARC extends ELEM {
  layer_id = '';
  aperture_width = 0.0;
  vertex: [POINT, POINT, POINT] = [new POINT(), new POINT(), new POINT()];

  constructor(aParent: ELEM | null) {
    super('qarc', aParent);
  }

  override Format(out: OUTPUTFORMATTER, nestLevel: number): void {
    const newline = nestLevel ? '\n' : '';
    const quote = out.GetQuoteChar(this.layer_id);

    out.Print(
      nestLevel,
      `(${this.Name()} ${quote}${this.layer_id}${quote} ${g6(this.aperture_width)}`,
    );

    for (const pt of this.vertex) out.Print(0, `  ${g6(pt.x)} ${g6(pt.y)}`);

    out.Print(0, `)${newline}`);
  }

  SetLayerId(aLayerId: string): void {
    this.layer_id = aLayerId;
  }

  // no -0.0 on the printouts!
  SetStart(aStart: POINT): void {
    this.vertex[0] = aStart.clone();
    this.vertex[0].FixNegativeZero();
  }

  SetEnd(aEnd: POINT): void {
    this.vertex[1] = aEnd.clone();
    this.vertex[1].FixNegativeZero();
  }

  SetCenter(aCenter: POINT): void {
    this.vertex[2] = aCenter.clone();
    this.vertex[2].FixNegativeZero();
  }
}

const SHAPE_TYPES = ['rect', 'circle', 'qarc', 'path', 'polygon'];

/** `<window_descriptor>`. */
export class WINDOW extends ELEM {
  /** `<shape_descriptor>`: a rectangle, circle, polygon, path or qarc. */
  shape: ELEM | null = null;

  constructor(aParent: ELEM | null, aType: DSN_T = 'window') {
    super(aType, aParent);
  }

  SetShape(aShape: ELEM | null): void {
    this.shape = aShape;

    if (aShape) {
      if (!SHAPE_TYPES.includes(aShape.Type())) throw new Error(`bad shape type ${aShape.Type()}`);

      aShape.SetParent(this);
    }
  }

  override Format(out: OUTPUTFORMATTER, nestLevel: number): void {
    out.Print(nestLevel, `(${this.Name()} `);

    if (this.shape) this.shape.Format(out, 0);

    out.Print(0, ')\n');
  }
}

/** `<keepout_descriptor>`, `<plane_descriptor>`. */
export class KEEPOUT extends ELEM {
  m_name = '';
  m_sequence_number = -1;
  m_rules: RULE | null = null;
  m_place_rules: RULE | null = null;
  m_windows: WINDOW[] = [];
  m_shape: ELEM | null = null;

  constructor(aParent: ELEM | null, aType: DSN_T) {
    super(aType, aParent);
  }

  SetShape(aShape: ELEM | null): void {
    this.m_shape = aShape;

    if (aShape) {
      if (!SHAPE_TYPES.includes(aShape.Type())) throw new Error(`bad shape type ${aShape.Type()}`);

      aShape.SetParent(this);
    }
  }

  AddWindow(aWindow: WINDOW): void {
    aWindow.SetParent(this);
    this.m_windows.push(aWindow);
  }

  override Format(out: OUTPUTFORMATTER, nestLevel: number): void {
    let newline = '\n';

    out.Print(nestLevel, `(${this.Name()}`);

    if (this.m_name.length) {
      const quote = out.GetQuoteChar(this.m_name);
      out.Print(0, ` ${quote}${this.m_name}${quote}`);
    } else {
      out.Print(0, ' ""'); // the zone with no name or net_code == 0
    }

    if (this.m_sequence_number !== -1) out.Print(0, ` (sequence_number ${this.m_sequence_number})`);

    if (this.m_shape) {
      out.Print(0, ' ');
      this.m_shape.Format(out, 0);
    }

    if (this.m_rules) {
      out.Print(0, newline);
      newline = '';
      this.m_rules.Format(out, nestLevel + 1);
    }

    if (this.m_place_rules) {
      out.Print(0, newline);
      newline = '';
      this.m_place_rules.Format(out, nestLevel + 1);
    }

    if (this.m_windows.length) {
      out.Print(0, newline);
      newline = '';

      for (const window of this.m_windows) window.Format(out, nestLevel + 1);

      out.Print(nestLevel, ')\n');
    } else {
      out.Print(0, ')\n');
    }
  }
}

/** `<via_descriptor>`. */
export class VIA extends ELEM {
  m_padstacks: string[] = [];
  m_spares: string[] = [];

  constructor(aParent: ELEM | null) {
    super('via', aParent);
  }

  AppendVia(aViaName: string): void {
    this.m_padstacks.push(aViaName);
  }

  override Format(out: OUTPUTFORMATTER, nestLevel: number): void {
    const RIGHTMARGIN = 80;
    let perLine = out.Print(nestLevel, `(${this.Name()}`);

    for (const padstack of this.m_padstacks) {
      if (perLine > RIGHTMARGIN) {
        out.Print(0, '\n');
        perLine = out.Print(nestLevel + 1, '');
      }

      const quote = out.GetQuoteChar(padstack);
      perLine += out.Print(0, ` ${quote}${padstack}${quote}`);
    }

    if (this.m_spares.length) {
      out.Print(0, '\n');
      perLine = out.Print(nestLevel + 1, '(spare');

      for (const spare of this.m_spares) {
        if (perLine > RIGHTMARGIN) {
          out.Print(0, '\n');
          perLine = out.Print(nestLevel + 2, '');
        }

        const quote = out.GetQuoteChar(spare);
        perLine += out.Print(0, ` ${quote}${spare}${quote}`);
      }

      out.Print(0, ')');
    }

    out.Print(0, ')\n');
  }
}

/** `<classes_descriptor>`. */
export class CLASSES extends ELEM {
  class_ids: string[] = [];

  constructor(aParent: ELEM | null) {
    super('classes', aParent);
  }

  override FormatContents(out: OUTPUTFORMATTER, nestLevel: number): void {
    for (const class_id of this.class_ids) {
      const quote = out.GetQuoteChar(class_id);
      out.Print(nestLevel, `${quote}${class_id}${quote}\n`);
    }
  }
}

/** `<class_class_descriptor>`. */
export class CLASS_CLASS extends ELEM_HOLDER {
  classes: CLASSES | null = null;

  constructor(aParent: ELEM | null, aType: DSN_T) {
    super(aType, aParent);
  }

  override FormatContents(out: OUTPUTFORMATTER, nestLevel: number): void {
    if (this.classes) this.classes.Format(out, nestLevel);

    // format the kids
    super.FormatContents(out, nestLevel);
  }
}

/** `<control_descriptor>`. */
export class CONTROL extends ELEM_HOLDER {
  via_at_smd = false;
  via_at_smd_grid_on = false;

  constructor(aParent: ELEM | null) {
    super('control', aParent);
  }

  override Format(out: OUTPUTFORMATTER, nestLevel: number): void {
    out.Print(nestLevel, `(${this.Name()}\n`);

    out.Print(nestLevel + 1, `(via_at_smd ${this.via_at_smd ? 'on' : 'off'}`);

    if (this.via_at_smd_grid_on) out.Print(0, ` grid ${this.via_at_smd_grid_on ? 'on' : 'off'}`);

    out.Print(0, ')\n');

    for (let i = 0; i < this.Length(); ++i) this.At(i).Format(out, nestLevel + 1);

    out.Print(nestLevel, ')\n');
  }
}

/** `<layer_descriptor>`. */
export class LAYER extends ELEM {
  name = '';
  /** one of: signal, power, mixed, jumper */
  layer_type: DSN_T = 'signal';
  direction: DSN_T = T_NONE;
  /** a positive integer is stored negative; a token is its text. */
  cost: number | DSN_T = -1;
  /** length | way ('' for none) */
  cost_type: DSN_T = T_NONE;
  rules: RULE | null = null;
  use_net: string[] = [];
  properties: PROPERTY[] = [];

  constructor(aParent: ELEM | null) {
    super('layer', aParent);
  }

  override Format(out: OUTPUTFORMATTER, nestLevel: number): void {
    let quote = out.GetQuoteChar(this.name);

    out.Print(nestLevel, `(${this.Name()} ${quote}${this.name}${quote}\n`);
    out.Print(nestLevel + 1, `(type ${GetTokenText(this.layer_type)})\n`);

    if (this.properties.length) {
      out.Print(nestLevel + 1, '(property\n');

      for (const property of this.properties) FormatProperty(property, out, nestLevel + 2);

      out.Print(nestLevel + 1, ')\n');
    }

    if (this.direction !== T_NONE)
      out.Print(nestLevel + 1, `(direction ${GetTokenText(this.direction)})\n`);

    if (this.rules) this.rules.Format(out, nestLevel + 1);

    if (this.cost !== -1) {
      if (typeof this.cost === 'number')
        // positive integer, stored as negative.
        out.Print(nestLevel + 1, `(cost ${-this.cost}`);
      else out.Print(nestLevel + 1, `(cost ${GetTokenText(this.cost)}`);

      if (this.cost_type !== T_NONE) out.Print(0, ` (type ${GetTokenText(this.cost_type)})`);

      out.Print(0, ')\n');
    }

    if (this.use_net.length) {
      out.Print(nestLevel + 1, '(use_net');

      for (const net of this.use_net) {
        quote = out.GetQuoteChar(net);
        out.Print(0, ` ${quote}${net}${quote}`);
      }

      out.Print(0, ')\n');
    }

    out.Print(nestLevel, ')\n');
  }
}

/** `<layer_pair_descriptor>`. */
export class SPECCTRA_LAYER_PAIR extends ELEM {
  layer_id0 = '';
  layer_id1 = '';
  layer_weight = 0.0;

  constructor(aParent: ELEM | null) {
    super('layer_pair', aParent);
  }

  override Format(out: OUTPUTFORMATTER, nestLevel: number): void {
    const quote0 = out.GetQuoteChar(this.layer_id0);
    const quote1 = out.GetQuoteChar(this.layer_id1);

    out.Print(
      nestLevel,
      `(${this.Name()} ${quote0}${this.layer_id0}${quote0} ${quote1}${this.layer_id1}${quote1} ${g6(this.layer_weight)})\n`,
    );
  }
}

/** `<layer_noise_weight_descriptor>`. */
export class LAYER_NOISE_WEIGHT extends ELEM {
  layer_pairs: SPECCTRA_LAYER_PAIR[] = [];

  constructor(aParent: ELEM | null) {
    super('layer_noise_weight', aParent);
  }

  override Format(out: OUTPUTFORMATTER, nestLevel: number): void {
    out.Print(nestLevel, `(${this.Name()}\n`);

    for (const pair of this.layer_pairs) pair.Format(out, nestLevel + 1);

    out.Print(nestLevel, ')\n');
  }
}

/** `<plane_descriptor>`: a KEEPOUT of type `plane`. */
export class COPPER_PLANE extends KEEPOUT {
  constructor(aParent: ELEM | null) {
    super(aParent, 'plane');
  }
}

/** A token-valued property, e.g. `(flip_style mirror_first)`. */
export class TOKPROP extends ELEM {
  value: DSN_T = T_NONE;

  constructor(aParent: ELEM | null, aType: DSN_T) {
    super(aType, aParent);
  }

  override Format(out: OUTPUTFORMATTER, nestLevel: number): void {
    out.Print(nestLevel, `(${this.Name()} ${GetTokenText(this.value)})\n`);
  }
}

/** A string-valued property. */
export class STRINGPROP extends ELEM {
  value = '';

  constructor(aParent: ELEM | null, aType: DSN_T) {
    super(aType, aParent);
  }

  override Format(out: OUTPUTFORMATTER, nestLevel: number): void {
    const quote = out.GetQuoteChar(this.value);

    out.Print(nestLevel, `(${this.Name()} ${quote}${this.value}${quote})\n`);
  }
}

/** `<region_descriptor>`. */
export class REGION extends ELEM_HOLDER {
  m_region_id = '';
  // mutually exclusive
  m_rectangle: RECTANGLE | null = null;
  m_polygon: PATH | null = null;
  // region_net | region_class | region_class_class are in the kids container.
  m_rules: RULE | null = null;

  constructor(aParent: ELEM | null) {
    super('region', aParent);
  }

  override FormatContents(out: OUTPUTFORMATTER, nestLevel: number): void {
    if (this.m_region_id.length) {
      const quote = out.GetQuoteChar(this.m_region_id);
      out.Print(nestLevel, `${quote}${this.m_region_id}${quote}\n`);
    }

    if (this.m_rectangle) this.m_rectangle.Format(out, nestLevel);

    if (this.m_polygon) this.m_polygon.Format(out, nestLevel);

    super.FormatContents(out, nestLevel);

    if (this.m_rules) this.m_rules.Format(out, nestLevel);
  }
}

/** `<grid_descriptor>`. */
export class GRID extends ELEM {
  /** via | wire | via_keepout | place | snap */
  m_grid_type: DSN_T = 'via';
  m_dimension = 0.0;
  /** x | y | '' for both */
  m_direction: DSN_T = T_NONE;
  m_offset = 0.0;
  m_image_type: DSN_T = T_NONE;

  constructor(aParent: ELEM | null) {
    super('grid', aParent);
  }

  override Format(out: OUTPUTFORMATTER, nestLevel: number): void {
    out.Print(
      nestLevel,
      `(${this.Name()} ${GetTokenText(this.m_grid_type)} ${g6(this.m_dimension)}`,
    );

    if (this.m_grid_type === 'place') {
      if (this.m_image_type === 'smd' || this.m_image_type === 'pin')
        out.Print(0, ` (image_type ${GetTokenText(this.m_image_type)})`);
    } else if (this.m_direction === 'x' || this.m_direction === 'y')
      out.Print(0, ` (direction ${GetTokenText(this.m_direction)})`);

    if (this.m_offset !== 0.0) out.Print(0, ` (offset ${g6(this.m_offset)})`);

    out.Print(0, ')\n');
  }
}

/** `<structure_out_descriptor>`. */
export class STRUCTURE_OUT extends ELEM {
  m_layers: LAYER[] = [];
  m_rules: RULE | null = null;

  constructor(aParent: ELEM | null) {
    super('structure_out', aParent);
  }

  override FormatContents(out: OUTPUTFORMATTER, nestLevel: number): void {
    for (const layer of this.m_layers) layer.Format(out, nestLevel);

    if (this.m_rules) this.m_rules.Format(out, nestLevel);
  }
}

/** `<structure_descriptor>`. */
export class STRUCTURE extends ELEM_HOLDER {
  m_unit: UNIT_RES | null = null;
  m_layers: LAYER[] = [];
  m_layer_noise_weight: LAYER_NOISE_WEIGHT | null = null;
  m_boundary: BOUNDARY | null = null;
  m_place_boundary: BOUNDARY | null = null;
  m_via: VIA | null = null;
  m_control: CONTROL | null = null;
  m_rules: RULE | null = null;
  m_keepouts: KEEPOUT[] = [];
  m_planes: COPPER_PLANE[] = [];
  m_regions: REGION[] = [];
  m_place_rules: RULE | null = null;
  m_grids: GRID[] = [];

  constructor(aParent: ELEM | null) {
    super('structure', aParent);
  }

  SetBOUNDARY(aBoundary: BOUNDARY | null): void {
    this.m_boundary = aBoundary;

    if (this.m_boundary) this.m_boundary.SetParent(this);
  }

  SetPlaceBOUNDARY(aBoundary: BOUNDARY | null): void {
    this.m_place_boundary = aBoundary;

    if (this.m_place_boundary) this.m_place_boundary.SetParent(this);
  }

  override FormatContents(out: OUTPUTFORMATTER, nestLevel: number): void {
    if (this.m_unit) this.m_unit.Format(out, nestLevel);

    for (const layer of this.m_layers) layer.Format(out, nestLevel);

    if (this.m_layer_noise_weight) this.m_layer_noise_weight.Format(out, nestLevel);

    if (this.m_boundary) this.m_boundary.Format(out, nestLevel);

    if (this.m_place_boundary) this.m_place_boundary.Format(out, nestLevel);

    for (const plane of this.m_planes) plane.Format(out, nestLevel);

    for (const region of this.m_regions) region.Format(out, nestLevel);

    for (const keepout of this.m_keepouts) keepout.Format(out, nestLevel);

    if (this.m_via) this.m_via.Format(out, nestLevel);

    if (this.m_control) this.m_control.Format(out, nestLevel);

    for (let i = 0; i < this.Length(); ++i) this.At(i).Format(out, nestLevel);

    if (this.m_rules) this.m_rules.Format(out, nestLevel);

    if (this.m_place_rules) this.m_place_rules.Format(out, nestLevel);

    for (const grid of this.m_grids) grid.Format(out, nestLevel);
  }

  override GetUnits(): UNIT_RES {
    if (this.m_unit) return this.m_unit;

    return super.GetUnits();
  }
}

/** `<place_descriptor>`. */
export class PLACE extends ELEM {
  /** reference designator */
  m_component_id = '';
  m_side: DSN_T = 'front';
  m_rotation = 0.0;
  m_hasVertex = false;
  m_vertex = new POINT();
  m_mirror: DSN_T = T_NONE;
  m_status: DSN_T = T_NONE;
  m_logical_part = '';
  m_place_rules: RULE | null = null;
  m_properties: PROPERTY[] = [];
  m_lock_type: DSN_T = T_NONE;
  // mutually exclusive
  m_rules: RULE | null = null;
  m_region: REGION | null = null;
  m_part_number = '';

  constructor(aParent: ELEM | null) {
    super('place', aParent);
  }

  SetVertex(aVertex: POINT): void {
    this.m_vertex = aVertex.clone();
    this.m_vertex.FixNegativeZero();
    this.m_hasVertex = true;
  }

  SetRotation(aRotation: number): void {
    this.m_rotation = aRotation;
  }

  override Format(out: OUTPUTFORMATTER, nestLevel: number): void {
    let useMultiLine: boolean;

    let quote = out.GetQuoteChar(this.m_component_id);

    if (this.m_place_rules || this.m_properties.length || this.m_rules || this.m_region) {
      useMultiLine = true;

      out.Print(nestLevel, `(${this.Name()} ${quote}${this.m_component_id}${quote}\n`);
      out.Print(nestLevel + 1, '');
    } else {
      useMultiLine = false;

      out.Print(nestLevel, `(${this.Name()} ${quote}${this.m_component_id}${quote}`);
    }

    if (this.m_hasVertex) {
      out.Print(0, ` ${FormatDouble2Str(this.m_vertex.x)} ${FormatDouble2Str(this.m_vertex.y)}`);
      out.Print(0, ` ${GetTokenText(this.m_side)}`);
      out.Print(0, ` ${FormatDouble2Str(this.m_rotation)}`);
    }

    let space = ' '; // one space, as c string.

    if (this.m_mirror !== T_NONE) {
      out.Print(0, `${space}(mirror ${GetTokenText(this.m_mirror)})`);
      space = '';
    }

    if (this.m_status !== T_NONE) {
      out.Print(0, `${space}(status ${GetTokenText(this.m_status)})`);
      space = '';
    }

    if (this.m_logical_part.length) {
      quote = out.GetQuoteChar(this.m_logical_part);
      out.Print(0, `${space}(logical_part ${quote}${this.m_logical_part}${quote})`);
      space = '';
    }

    if (useMultiLine) {
      out.Print(0, '\n');

      if (this.m_place_rules) this.m_place_rules.Format(out, nestLevel + 1);

      if (this.m_properties.length) {
        out.Print(nestLevel + 1, '(property \n');

        for (const p of this.m_properties) FormatProperty(p, out, nestLevel + 2);

        out.Print(nestLevel + 1, ')\n');
      }

      if (this.m_lock_type !== T_NONE)
        out.Print(nestLevel + 1, `(lock_type ${GetTokenText(this.m_lock_type)})\n`);

      if (this.m_rules) this.m_rules.Format(out, nestLevel + 1);

      if (this.m_region) this.m_region.Format(out, nestLevel + 1);

      if (this.m_part_number.length) {
        quote = out.GetQuoteChar(this.m_part_number);
        out.Print(nestLevel + 1, `(PN ${quote}${this.m_part_number}${quote})\n`);
      }
    } else {
      if (this.m_lock_type !== T_NONE) {
        out.Print(0, `${space}(lock_type ${GetTokenText(this.m_lock_type)})`);
        space = '';
      }

      if (this.m_part_number.length) {
        quote = out.GetQuoteChar(this.m_part_number);
        out.Print(0, `${space}(PN ${quote}${this.m_part_number}${quote})`);
      }
    }

    out.Print(0, ')\n');
  }
}

/** `<component_descriptor>`: the places sharing one image. */
export class COMPONENT extends ELEM {
  m_image_id = '';
  m_places: PLACE[] = [];

  constructor(aParent: ELEM | null) {
    super('component', aParent);
  }

  GetImageId(): string {
    return this.m_image_id;
  }

  SetImageId(aImageId: string): void {
    this.m_image_id = aImageId;
  }

  override Format(out: OUTPUTFORMATTER, nestLevel: number): void {
    const quote = out.GetQuoteChar(this.m_image_id);

    out.Print(nestLevel, `(${this.Name()} ${quote}${this.m_image_id}${quote}\n`);
    this.FormatContents(out, nestLevel + 1);
    out.Print(nestLevel, ')\n');
  }

  override FormatContents(out: OUTPUTFORMATTER, nestLevel: number): void {
    for (const place of this.m_places) place.Format(out, nestLevel);
  }
}

/** `<placement_descriptor>`. */
export class PLACEMENT extends ELEM {
  m_unit: UNIT_RES | null = null;
  m_flip_style: DSN_T = T_NONE;
  m_components: COMPONENT[] = [];

  constructor(aParent: ELEM | null) {
    super('placement', aParent);
  }

  /** The COMPONENT for `imageName`, added when it is not there yet. */
  LookupCOMPONENT(imageName: string): COMPONENT {
    for (const component of this.m_components) {
      if (component.GetImageId() === imageName) return component;
    }

    const added = new COMPONENT(this);
    this.m_components.push(added);
    added.SetImageId(imageName);

    return added;
  }

  override FormatContents(out: OUTPUTFORMATTER, nestLevel: number): void {
    if (this.m_unit) this.m_unit.Format(out, nestLevel);

    if (this.m_flip_style !== T_NONE)
      out.Print(nestLevel, `(place_control (flip_style ${GetTokenText(this.m_flip_style)}))\n`);

    for (const component of this.m_components) component.Format(out, nestLevel);
  }

  override GetUnits(): UNIT_RES {
    if (this.m_unit) return this.m_unit;

    return super.GetUnits();
  }
}

/** `<shape_descriptor>` of a padstack or image: a WINDOW with a `connect` and windows of its own. */
export class SHAPE extends WINDOW {
  m_connect: DSN_T = 'on';
  m_windows: WINDOW[] = [];

  constructor(aParent: ELEM | null, aType: DSN_T = 'shape') {
    super(aParent, aType);
  }

  SetConnect(aConnect: DSN_T): void {
    this.m_connect = aConnect;
  }

  override Format(out: OUTPUTFORMATTER, nestLevel: number): void {
    out.Print(nestLevel, `(${this.Name()} `);

    if (this.shape) this.shape.Format(out, 0);

    if (this.m_connect === 'off') out.Print(0, `(connect ${GetTokenText(this.m_connect)})`);

    if (this.m_windows.length) {
      out.Print(0, '\n');

      for (const window of this.m_windows) window.Format(out, nestLevel + 1);

      out.Print(nestLevel, ')\n');
    } else {
      out.Print(0, ')\n');
    }
  }
}

/** `<pin_descriptor>`. */
export class PIN extends ELEM {
  m_padstack_id = '';
  m_rotation = 0.0;
  m_isRotated = false;
  m_pin_id = '';
  m_vertex = new POINT();
  /** KiCad netcode */
  m_kiNetCode = 0;

  constructor(aParent: ELEM | null) {
    super('pin', aParent);
  }

  SetRotation(aRotation: number): void {
    this.m_rotation = aRotation;
    this.m_isRotated = aRotation !== 0.0;
  }

  SetVertex(aPoint: POINT): void {
    this.m_vertex = aPoint.clone();
    this.m_vertex.FixNegativeZero();
  }

  override Format(out: OUTPUTFORMATTER, nestLevel: number): void {
    let quote = out.GetQuoteChar(this.m_padstack_id);

    if (this.m_isRotated)
      out.Print(
        nestLevel,
        `(pin ${quote}${this.m_padstack_id}${quote} (rotate ${g6(this.m_rotation)})`,
      );
    else out.Print(nestLevel, `(pin ${quote}${this.m_padstack_id}${quote}`);

    quote = out.GetQuoteChar(this.m_pin_id);
    out.Print(
      0,
      ` ${quote}${this.m_pin_id}${quote} ${g6(this.m_vertex.x)} ${g6(this.m_vertex.y)})\n`,
    );
  }
}

/** `<image_descriptor>`. */
export class IMAGE extends ELEM_HOLDER {
  /** a hash string used by Compare(), not Format()ed/exported. */
  m_hash = '';
  m_image_id = '';
  m_side: DSN_T = 'both';
  m_unit: UNIT_RES | null = null;
  // The grammar spec says only one outline is supported, but the kids list holds them.
  m_pins: PIN[] = [];
  m_rules: RULE | null = null;
  m_place_rules: RULE | null = null;
  m_keepouts: KEEPOUT[] = [];
  /** no. times this image_id is duplicated */
  m_duplicated = 0;

  constructor(aParent: ELEM | null) {
    super('image', aParent);
  }

  /** Compare two images by content, `IMAGE::Compare`, in specctra.cpp. */
  static Compare(lhs: IMAGE, rhs: IMAGE): number {
    if (!lhs.m_hash.length) lhs.m_hash = lhs.makeHash();

    if (!rhs.m_hash.length) rhs.m_hash = rhs.makeHash();

    return compareStd(lhs.m_hash, rhs.m_hash);
  }

  GetImageId(): string {
    if (this.m_duplicated) return `${this.m_image_id}::${this.m_duplicated}`;

    return this.m_image_id;
  }

  override Format(out: OUTPUTFORMATTER, nestLevel: number): void {
    const imageId = this.GetImageId();
    const quote = out.GetQuoteChar(imageId);

    out.Print(nestLevel, `(${this.Name()} ${quote}${imageId}${quote}`);
    this.FormatContents(out, nestLevel + 1);
    out.Print(nestLevel, ')\n');
  }

  // this is here for makeHash()
  override FormatContents(out: OUTPUTFORMATTER, nestLevel: number): void {
    if (this.m_side !== 'both') out.Print(0, ` (side ${GetTokenText(this.m_side)})`);

    out.Print(0, '\n');

    if (this.m_unit) this.m_unit.Format(out, nestLevel);

    // format the kids, which in this class are the shapes
    super.FormatContents(out, nestLevel);

    for (const pin of this.m_pins) pin.Format(out, nestLevel);

    if (this.m_rules) this.m_rules.Format(out, nestLevel);

    if (this.m_place_rules) this.m_place_rules.Format(out, nestLevel);

    for (const keepout of this.m_keepouts) keepout.Format(out, nestLevel);
  }

  override GetUnits(): UNIT_RES {
    if (this.m_unit) return this.m_unit;

    return super.GetUnits();
  }
}

/** `<padstack_descriptor>`. */
export class PADSTACK extends ELEM_HOLDER {
  /** a hash string used by Compare(), not Format()ed/exported. */
  m_hash = '';
  m_padstack_id = '';
  m_unit: UNIT_RES | null = null;
  // The shapes are stored in the kids list
  m_rotate: DSN_T = 'on';
  m_absolute: DSN_T = 'off';
  m_attach: DSN_T = 'off';
  m_via_id = '';
  m_rules: RULE | null = null;

  constructor() {
    super('padstack', null);
  }

  GetPadstackId(): string {
    return this.m_padstack_id;
  }

  /** `PADSTACK::Compare`: by content. */
  static Compare(lhs: PADSTACK, rhs: PADSTACK): number {
    if (!lhs.m_hash.length) lhs.m_hash = lhs.makeHash();

    if (!rhs.m_hash.length) rhs.m_hash = rhs.makeHash();

    const result = compareStd(lhs.m_hash, rhs.m_hash);

    if (result) return result;

    // Via names hold the drill diameters, so we have to include those to discern
    // between two vias with same copper size but with different drill sizes.
    return compareStd(lhs.m_padstack_id, rhs.m_padstack_id);
  }

  SetPadstackId(aPadstackId: string): void {
    this.m_padstack_id = aPadstackId;
  }

  override Format(out: OUTPUTFORMATTER, nestLevel: number): void {
    const quote = out.GetQuoteChar(this.m_padstack_id);

    out.Print(nestLevel, `(${this.Name()} ${quote}${this.m_padstack_id}${quote}\n`);
    this.FormatContents(out, nestLevel + 1);
    out.Print(nestLevel, ')\n');
  }

  // this factored out for use by Compare()
  override FormatContents(out: OUTPUTFORMATTER, nestLevel: number): void {
    if (this.m_unit) this.m_unit.Format(out, nestLevel);

    // format the kids, which in this class are the shapes
    super.FormatContents(out, nestLevel);

    out.Print(nestLevel, '');

    // spec for <attach_descriptor> says default is on, so
    // print the off condition to override this.
    if (this.m_attach === 'off') {
      out.Print(0, '(attach off)');
    } else if (this.m_attach === 'on') {
      const quote = out.GetQuoteChar(this.m_via_id);
      out.Print(0, `(attach on (use_via ${quote}${this.m_via_id}${quote}))`);
    }

    if (this.m_rotate === 'off') out.Print(0, `(rotate ${GetTokenText(this.m_rotate)})`); // print the non-default

    if (this.m_absolute === 'on') out.Print(0, `(absolute ${GetTokenText(this.m_absolute)})`); // print the non-default

    out.Print(0, '\n');

    if (this.m_rules) this.m_rules.Format(out, nestLevel);
  }

  override GetUnits(): UNIT_RES {
    if (this.m_unit) return this.m_unit;

    return super.GetUnits();
  }
}

/** `<library_descriptor>`. */
export class LIBRARY extends ELEM {
  m_unit: UNIT_RES | null = null;
  m_images: IMAGE[] = [];
  /** all except vias, which are in 'vias' */
  m_padstacks: PADSTACK[] = [];
  m_vias: PADSTACK[] = [];

  constructor(aParent: ELEM | null, aType: DSN_T = 'library') {
    super(aType, aParent);
  }

  AddPadstack(aPadstack: PADSTACK): void {
    aPadstack.SetParent(this);
    this.m_padstacks.push(aPadstack);
  }

  /**
   * The index of the image whose contents match `aImage`, or -1. When there is
   * no match, a unique name is generated for it (`m_duplicated`).
   */
  FindIMAGE(aImage: IMAGE): number {
    for (let i = 0; i < this.m_images.length; ++i) {
      if (IMAGE.Compare(aImage, this.m_images[i]!) === 0) return i;
    }

    // There is no match to the IMAGE contents, but now generate a unique name for it.
    let dups = 1;

    for (const image of this.m_images) {
      if (image.m_image_id === aImage.m_image_id) aImage.m_duplicated = dups++;
    }

    return -1;
  }

  AppendIMAGE(aImage: IMAGE): void {
    aImage.SetParent(this);
    this.m_images.push(aImage);
  }

  /** The matching image, or `aImage` itself after appending it. */
  LookupIMAGE(aImage: IMAGE): IMAGE {
    const ndx = this.FindIMAGE(aImage);

    if (ndx === -1) {
      this.AppendIMAGE(aImage);
      return aImage;
    }

    return this.m_images[ndx]!;
  }

  FindVia(aVia: PADSTACK): number {
    for (let i = 0; i < this.m_vias.length; ++i) {
      if (PADSTACK.Compare(aVia, this.m_vias[i]!) === 0) return i;
    }

    return -1;
  }

  AppendVia(aVia: PADSTACK): void {
    aVia.SetParent(this);
    this.m_vias.push(aVia);
  }

  AppendPADSTACK(aPadstack: PADSTACK): void {
    aPadstack.SetParent(this);
    this.m_padstacks.push(aPadstack);
  }

  LookupVia(aVia: PADSTACK): PADSTACK {
    const ndx = this.FindVia(aVia);

    if (ndx === -1) {
      this.AppendVia(aVia);
      return aVia;
    }

    return this.m_vias[ndx]!;
  }

  FindPADSTACK(aPadstackId: string): PADSTACK | null {
    for (const padstack of this.m_padstacks) {
      if (padstack.GetPadstackId() === aPadstackId) return padstack;
    }

    return null;
  }

  override FormatContents(out: OUTPUTFORMATTER, nestLevel: number): void {
    if (this.m_unit) this.m_unit.Format(out, nestLevel);

    for (const image of this.m_images) image.Format(out, nestLevel);

    for (const padstack of this.m_padstacks) padstack.Format(out, nestLevel);

    for (const via of this.m_vias) via.Format(out, nestLevel);
  }

  override GetUnits(): UNIT_RES {
    if (this.m_unit) return this.m_unit;

    return super.GetUnits();
  }
}

/** A `<pin_reference>`: `component-pin`. */
export class PIN_REF extends ELEM {
  component_id = '';
  pin_id = '';

  constructor(aParent: ELEM | null) {
    super('pin', aParent);
  }

  /** Like Format() but is not virtual. Returns the number of characters output. */
  FormatIt(out: OUTPUTFORMATTER, nestLevel: number): number {
    // only print the newline if there is a nest level, and make
    // the quotes unconditional on this one.
    const newline = nestLevel ? '\n' : '';

    const cquote = out.GetQuoteChar(this.component_id);
    const pquote = out.GetQuoteChar(this.pin_id);

    return out.Print(
      nestLevel,
      `${cquote}${this.component_id}${cquote}-${pquote}${this.pin_id}${pquote}${newline}`,
    );
  }
}

/** `<fromto_descriptor>`. */
export class FROMTO extends ELEM {
  m_fromText = '';
  m_toText = '';
  m_fromto_type: DSN_T = T_NONE;
  m_net_id = '';
  m_rules: RULE | null = null;
  m_layer_rules: LAYER_RULE[] = [];

  constructor(aParent: ELEM | null) {
    super('fromto', aParent);
  }

  override Format(out: OUTPUTFORMATTER, nestLevel: number): void {
    // no quoting on these two, the lexer preserved the quotes on input
    out.Print(nestLevel, `(${this.Name()} ${this.m_fromText} ${this.m_toText} `);

    if (this.m_fromto_type !== T_NONE) out.Print(0, `(type ${GetTokenText(this.m_fromto_type)})`);

    if (this.m_net_id.length) {
      const quote = out.GetQuoteChar(this.m_net_id);
      out.Print(0, `(net ${quote}${this.m_net_id}${quote})`);
    }

    let singleLine = true;

    if (this.m_rules || this.m_layer_rules.length) {
      out.Print(0, '\n');
      singleLine = false;
    }

    if (this.m_rules) this.m_rules.Format(out, nestLevel + 1);

    for (const layer_rule of this.m_layer_rules) layer_rule.Format(out, nestLevel + 1);

    out.Print(singleLine ? 0 : nestLevel, ')');

    if (nestLevel || !singleLine) out.Print(0, '\n');
  }
}

/** `<comp_order_descriptor>`. */
export class COMP_ORDER extends ELEM {
  m_placement_ids: string[] = [];

  constructor(aParent: ELEM | null) {
    super('comp_order', aParent);
  }

  override Format(out: OUTPUTFORMATTER, nestLevel: number): void {
    out.Print(nestLevel, `(${this.Name()}`);

    for (const placement_id of this.m_placement_ids) {
      const quote = out.GetQuoteChar(placement_id);
      out.Print(0, ` ${quote}${placement_id}${quote}`);
    }

    out.Print(0, ')');

    if (nestLevel) out.Print(0, '\n');
  }
}

/** `<net_descriptor>`. */
export class NET extends ELEM {
  m_net_id = '';
  m_unassigned = false;
  /** `T_NONE` (`DSN_NONE`, -1) when unset. */
  m_net_number = -1;
  /** pins | order, type of field 'pins' below */
  m_pins_type: DSN_T = 'pins';
  m_pins: PIN_REF[] = [];
  m_expose: PIN_REF[] = [];
  m_noexpose: PIN_REF[] = [];
  m_source: PIN_REF[] = [];
  m_load: PIN_REF[] = [];
  m_terminator: PIN_REF[] = [];
  /** fix | normal */
  m_type: DSN_T = T_NONE;
  /** power | ground */
  m_supply: DSN_T = T_NONE;
  m_rules: RULE | null = null;
  m_layer_rules: LAYER_RULE[] = [];
  m_fromtos: FROMTO[] = [];
  m_comp_order: COMP_ORDER | null = null;

  constructor(aParent: ELEM | null) {
    super('net', aParent);
  }

  /** The index of the first pin of component `aComponent`, or -1. */
  FindPIN_REF(aComponent: string): number {
    for (let i = 0; i < this.m_pins.length; ++i) {
      if (aComponent === this.m_pins[i]!.component_id) return i;
    }

    return -1;
  }

  override Format(out: OUTPUTFORMATTER, nestLevel: number): void {
    const quote = out.GetQuoteChar(this.m_net_id);
    let space = ' ';

    out.Print(nestLevel, `(${this.Name()} ${quote}${this.m_net_id}${quote}`);

    if (this.m_unassigned) {
      out.Print(0, `${space}(unassigned)`);
      space = ''; // only needed one space
    }

    if (this.m_net_number !== -1) out.Print(0, `${space}(net_number ${this.m_net_number})`);

    out.Print(0, '\n');

    if (this.m_pins.length) {
      const RIGHTMARGIN = 80;
      let perLine = out.Print(nestLevel + 1, `(${GetTokenText(this.m_pins_type)}`);

      for (const pin of this.m_pins) {
        if (perLine > RIGHTMARGIN) {
          out.Print(0, '\n');
          perLine = out.Print(nestLevel + 2, '');
        } else {
          perLine += out.Print(0, ' ');
        }

        perLine += pin.FormatIt(out, 0);
      }

      out.Print(0, ')\n');
    }

    if (this.m_comp_order) this.m_comp_order.Format(out, nestLevel + 1);

    if (this.m_type !== T_NONE) out.Print(nestLevel + 1, `(type ${GetTokenText(this.m_type)})\n`);

    if (this.m_rules) this.m_rules.Format(out, nestLevel + 1);

    for (const layer_rule of this.m_layer_rules) layer_rule.Format(out, nestLevel + 1);

    for (const from_to of this.m_fromtos) from_to.Format(out, nestLevel + 1);

    out.Print(nestLevel, ')\n');
  }
}

/** `<topology_descriptor>`. */
export class TOPOLOGY extends ELEM {
  m_fromtos: FROMTO[] = [];
  m_comp_orders: COMP_ORDER[] = [];

  constructor(aParent: ELEM | null) {
    super('topology', aParent);
  }

  override FormatContents(out: OUTPUTFORMATTER, nestLevel: number): void {
    for (const from_to of this.m_fromtos) from_to.Format(out, nestLevel);

    for (const comp_order of this.m_comp_orders) comp_order.Format(out, nestLevel);
  }
}

/** `<class_descriptor>`. */
export class CLASS extends ELEM {
  m_class_id = '';
  /** the nets in this class */
  m_net_ids: string[] = [];
  /** circuit descriptor list */
  m_circuit: string[] = [];
  m_rules: RULE | null = null;
  m_layer_rules: LAYER_RULE[] = [];
  m_topology: TOPOLOGY | null = null;

  constructor(aParent: ELEM | null) {
    super('class', aParent);
  }

  override Format(out: OUTPUTFORMATTER, nestLevel: number): void {
    let quote = out.GetQuoteChar(this.m_class_id);

    let perLine = out.Print(nestLevel, `(${this.Name()} ${quote}${this.m_class_id}${quote}`);

    const RIGHTMARGIN = 72;

    for (const net_id of this.m_net_ids) {
      let space = ' ';

      if (perLine > RIGHTMARGIN) {
        out.Print(0, '\n');
        perLine = out.Print(nestLevel + 1, '');
        space = ''; // no space at first net_id of the line
      }

      // Allegro PCB Router (Specctra) doesn't like empty net names
      if (net_id.length === 0) continue;

      quote = out.GetQuoteChar(net_id);
      perLine += out.Print(0, `${space}${quote}${net_id}${quote}`);
    }

    let newLine = false;

    if (this.m_circuit.length || this.m_rules || this.m_layer_rules.length || this.m_topology) {
      out.Print(0, '\n');
      newLine = true;
    }

    if (this.m_circuit.length) {
      out.Print(nestLevel + 1, '(circuit\n');

      for (const circuit of this.m_circuit) out.Print(nestLevel + 2, `${circuit}\n`);

      out.Print(nestLevel + 1, ')\n');
    }

    if (this.m_rules) this.m_rules.Format(out, nestLevel + 1);

    for (const layer_rule of this.m_layer_rules) layer_rule.Format(out, nestLevel + 1);

    if (this.m_topology) this.m_topology.Format(out, nestLevel + 1);

    out.Print(newLine ? nestLevel : 0, ')\n');
  }
}

/** `<network_descriptor>`. */
export class NETWORK extends ELEM {
  m_nets: NET[] = [];
  m_classes: CLASS[] = [];

  constructor(aParent: ELEM | null) {
    super('network', aParent);
  }

  override FormatContents(out: OUTPUTFORMATTER, nestLevel: number): void {
    for (const net of this.m_nets) net.Format(out, nestLevel);

    for (const c of this.m_classes) c.Format(out, nestLevel);
  }
}

/** `<connect_descriptor>`: not completed upstream. */
export class CONNECT extends ELEM {
  constructor(aParent: ELEM | null) {
    super('connect', aParent);
  }
}

/** `<wire_shape_descriptor>`. */
export class WIRE extends ELEM {
  /** a rectangle, circle, polygon, path or qarc */
  m_shape: ELEM | null = null;
  m_net_id = '';
  m_turret = -1;
  m_wire_type: DSN_T = T_NONE;
  m_attr: DSN_T = T_NONE;
  m_shield = '';
  m_windows: WINDOW[] = [];
  m_connect: CONNECT | null = null;
  m_supply = false;

  constructor(aParent: ELEM | null) {
    super('wire', aParent);
  }

  SetShape(aShape: ELEM | null): void {
    this.m_shape = aShape;

    if (aShape) {
      if (!SHAPE_TYPES.includes(aShape.Type())) throw new Error(`bad shape type ${aShape.Type()}`);

      aShape.SetParent(this);
    }
  }

  override Format(out: OUTPUTFORMATTER, nestLevel: number): void {
    out.Print(nestLevel, `(${this.Name()} `);

    if (this.m_shape) this.m_shape.Format(out, 0);

    if (this.m_net_id.length) {
      const quote = out.GetQuoteChar(this.m_net_id);
      out.Print(0, `(net ${quote}${this.m_net_id}${quote})`);
    }

    if (this.m_turret >= 0) out.Print(0, `(turrent ${this.m_turret})`);

    if (this.m_wire_type !== T_NONE) out.Print(0, `(type ${GetTokenText(this.m_wire_type)})`);

    if (this.m_attr !== T_NONE) out.Print(0, `(attr ${GetTokenText(this.m_attr)})`);

    if (this.m_shield.length) {
      const quote = out.GetQuoteChar(this.m_shield);
      out.Print(0, `(shield ${quote}${this.m_shield}${quote})`);
    }

    if (this.m_windows.length) {
      out.Print(0, '\n');

      for (const window of this.m_windows) window.Format(out, nestLevel + 1);
    }

    if (this.m_connect) this.m_connect.Format(out, 0);

    if (this.m_supply) out.Print(0, '(supply)');

    out.Print(0, ')\n');
  }
}

/** A via in a wiring or routing: `<wire_via_descriptor>`. */
export class WIRE_VIA extends ELEM {
  m_padstack_id = '';
  m_vertexes: POINT[] = [];
  m_net_id = '';
  m_via_number = -1;
  m_via_type: DSN_T = T_NONE;
  m_attr: DSN_T = T_NONE;
  m_virtual_pin_name = '';
  m_contact_layers: string[] = [];
  m_supply = false;

  constructor(aParent: ELEM | null) {
    super('via', aParent);
  }

  GetPadstackId(): string {
    return this.m_padstack_id;
  }

  override Format(out: OUTPUTFORMATTER, nestLevel: number): void {
    let quote = out.GetQuoteChar(this.m_padstack_id);

    const RIGHTMARGIN = 80;
    let perLine = out.Print(nestLevel, `(${this.Name()} ${quote}${this.m_padstack_id}${quote}`);

    const wrap = (): void => {
      if (perLine > RIGHTMARGIN) {
        out.Print(0, '\n');
        perLine = out.Print(nestLevel + 1, '');
      }
    };

    for (const pt of this.m_vertexes) {
      if (perLine > RIGHTMARGIN) {
        out.Print(0, '\n');
        perLine = out.Print(nestLevel + 1, '');
      } else {
        perLine += out.Print(0, '  ');
      }

      perLine += out.Print(0, `${g6(pt.x)} ${g6(pt.y)}`);
    }

    if (
      this.m_net_id.length ||
      this.m_via_number !== -1 ||
      this.m_via_type !== T_NONE ||
      this.m_attr !== T_NONE ||
      this.m_supply
    )
      out.Print(0, ' ');

    if (this.m_net_id.length) {
      wrap();
      quote = out.GetQuoteChar(this.m_net_id);
      perLine += out.Print(0, `(net ${quote}${this.m_net_id}${quote})`);
    }

    if (this.m_via_number !== -1) {
      wrap();
      perLine += out.Print(0, `(via_number ${this.m_via_number})`);
    }

    if (this.m_via_type !== T_NONE) {
      wrap();
      perLine += out.Print(0, `(type ${GetTokenText(this.m_via_type)})`);
    }

    if (this.m_attr !== T_NONE) {
      wrap();

      if (this.m_attr === 'virtual_pin') {
        quote = out.GetQuoteChar(this.m_virtual_pin_name);
        perLine += out.Print(0, `(attr virtual_pin ${quote}${this.m_virtual_pin_name}${quote})`);
      } else {
        perLine += out.Print(0, `(attr ${GetTokenText(this.m_attr)})`);
      }
    }

    if (this.m_supply) {
      wrap();
      perLine += out.Print(0, '(supply)');
    }

    if (this.m_contact_layers.length) {
      out.Print(0, '\n');
      out.Print(nestLevel + 1, '(contact\n');

      for (const contact_layer of this.m_contact_layers) {
        quote = out.GetQuoteChar(contact_layer);
        out.Print(nestLevel + 2, `${quote}${contact_layer}${quote}\n`);
      }

      out.Print(nestLevel + 1, '))\n');
    } else {
      out.Print(0, ')\n');
    }
  }
}

/** `<wiring_descriptor>`. */
export class WIRING extends ELEM {
  unit: UNIT_RES | null = null;
  wires: WIRE[] = [];
  wire_vias: WIRE_VIA[] = [];

  constructor(aParent: ELEM | null) {
    super('wiring', aParent);
  }

  override FormatContents(out: OUTPUTFORMATTER, nestLevel: number): void {
    if (this.unit) this.unit.Format(out, nestLevel);

    for (const wire of this.wires) wire.Format(out, nestLevel);

    for (const wire_via of this.wire_vias) wire_via.Format(out, nestLevel);
  }

  override GetUnits(): UNIT_RES {
    if (this.unit) return this.unit;

    return super.GetUnits();
  }
}

/** `<pcb_descriptor>`, the root of a DSN file. */
export class PCB extends ELEM {
  m_pcbname = '';
  m_parser: PARSER | null = null;
  m_resolution: UNIT_RES | null = null;
  m_unit: UNIT_RES | null = null;
  m_structure: STRUCTURE | null = null;
  m_placement: PLACEMENT | null = null;
  m_library: LIBRARY | null = null;
  m_network: NETWORK | null = null;
  m_wiring: WIRING | null = null;

  constructor(aParent: ELEM | null = null) {
    super('pcb', aParent);
  }

  override Format(out: OUTPUTFORMATTER, nestLevel: number): void {
    const quote = out.GetQuoteChar(this.m_pcbname);

    out.Print(nestLevel, `(${this.Name()} ${quote}${this.m_pcbname}${quote}\n`);

    if (this.m_parser) this.m_parser.Format(out, nestLevel + 1);

    if (this.m_resolution) this.m_resolution.Format(out, nestLevel + 1);

    if (this.m_unit) this.m_unit.Format(out, nestLevel + 1);

    if (this.m_structure) this.m_structure.Format(out, nestLevel + 1);

    if (this.m_placement) this.m_placement.Format(out, nestLevel + 1);

    if (this.m_library) this.m_library.Format(out, nestLevel + 1);

    if (this.m_network) this.m_network.Format(out, nestLevel + 1);

    if (this.m_wiring) this.m_wiring.Format(out, nestLevel + 1);

    out.Print(nestLevel, ')\n');
  }

  override GetUnits(): UNIT_RES {
    if (this.m_unit) return this.m_unit;

    if (this.m_resolution) return this.m_resolution.GetUnits();

    return super.GetUnits();
  }
}

/** `strftime( "%b %d %H : %M : %S %Y" )` on a local time. */
function formatSpecctraTime(aTime: Date): string {
  const months = [
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
  const p2 = (n: number): string => String(n).padStart(2, '0');

  return `${months[aTime.getMonth()]} ${p2(aTime.getDate())} ${p2(aTime.getHours())} : ${p2(aTime.getMinutes())} : ${p2(aTime.getSeconds())} ${aTime.getFullYear()}`;
}

/** `<ancestor_file_descriptor>`. */
export class ANCESTOR extends ELEM {
  filename = '';
  comment = '';
  time_stamp = new Date();

  constructor(aParent: ELEM | null) {
    super('ancestor', aParent);
  }

  override Format(out: OUTPUTFORMATTER, nestLevel: number): void {
    // format the time first to temp
    const temp = formatSpecctraTime(this.time_stamp);

    // filename may be empty, so quote it just in case.
    out.Print(nestLevel, `(${this.Name()} "${this.filename}" (created_time ${temp})\n`);

    if (this.comment.length) {
      const quote = out.GetQuoteChar(this.comment);
      out.Print(nestLevel + 1, `(comment ${quote}${this.comment}${quote})\n`);
    }

    out.Print(nestLevel, ')\n');
  }
}

/** `<history_descriptor>`. */
export class HISTORY extends ELEM {
  ancestors: ANCESTOR[] = [];
  time_stamp = new Date();
  comments: string[] = [];

  constructor(aParent: ELEM | null) {
    super('history', aParent);
  }

  override FormatContents(out: OUTPUTFORMATTER, nestLevel: number): void {
    for (const ancestor of this.ancestors) ancestor.Format(out, nestLevel);

    // format the time first to temp
    const temp = formatSpecctraTime(this.time_stamp);

    out.Print(nestLevel, `(self (created_time ${temp})\n`);

    for (const comment of this.comments) {
      const quote = out.GetQuoteChar(comment);
      out.Print(nestLevel + 1, `(comment ${quote}${comment}${quote})\n`);
    }

    out.Print(nestLevel, ')\n');
  }
}

/** `<supply_pin_descriptor>`. */
export class SUPPLY_PIN extends ELEM {
  pin_refs: PIN_REF[] = [];
  net_id = '';

  constructor(aParent: ELEM | null) {
    super('supply_pin', aParent);
  }

  override Format(out: OUTPUTFORMATTER, nestLevel: number): void {
    const singleLine = this.pin_refs.length <= 1;

    out.Print(nestLevel, `(${this.Name()}`);

    if (singleLine) {
      out.Print(0, ' ');
      this.pin_refs[0]!.Format(out, 0);
    } else {
      for (const pin_ref of this.pin_refs) pin_ref.FormatIt(out, nestLevel + 1);
    }

    if (this.net_id.length) {
      const newline = singleLine ? '' : '\n';
      const quote = out.GetQuoteChar(this.net_id);

      out.Print(singleLine ? 0 : nestLevel + 1, ` (net ${quote}${this.net_id}${quote})${newline}`);
    }

    out.Print(singleLine ? 0 : nestLevel, ')\n');
  }
}

/** `<net_out_descriptor>`. */
export class NET_OUT extends ELEM {
  net_id = '';
  net_number = -1;
  rules: RULE | null = null;
  wires: WIRE[] = [];
  wire_vias: WIRE_VIA[] = [];
  supply_pins: SUPPLY_PIN[] = [];

  constructor(aParent: ELEM | null) {
    super('net_out', aParent);
  }

  override Format(out: OUTPUTFORMATTER, nestLevel: number): void {
    const quote = out.GetQuoteChar(this.net_id);

    // cannot use Type() here, it is net_out and we need "(net "
    out.Print(nestLevel, `(net ${quote}${this.net_id}${quote}\n`);

    if (this.net_number >= 0) out.Print(nestLevel + 1, `(net_number ${this.net_number})\n`);

    if (this.rules) this.rules.Format(out, nestLevel + 1);

    for (const wire of this.wires) wire.Format(out, nestLevel + 1);

    for (const wire_via of this.wire_vias) wire_via.Format(out, nestLevel + 1);

    for (const supply_pin of this.supply_pins) supply_pin.Format(out, nestLevel + 1);

    out.Print(nestLevel, ')\n');
  }
}

/** `<route_descriptor>`. */
export class ROUTE extends ELEM {
  resolution: UNIT_RES | null = null;
  parser: PARSER | null = null;
  structure_out: STRUCTURE_OUT | null = null;
  library: LIBRARY | null = null;
  net_outs: NET_OUT[] = [];

  constructor(aParent: ELEM | null) {
    super('route', aParent);
  }

  override GetUnits(): UNIT_RES {
    if (this.resolution) return this.resolution;

    return super.GetUnits();
  }

  override FormatContents(out: OUTPUTFORMATTER, nestLevel: number): void {
    if (this.resolution) this.resolution.Format(out, nestLevel);

    if (this.parser) this.parser.Format(out, nestLevel);

    if (this.structure_out) this.structure_out.Format(out, nestLevel);

    if (this.library) this.library.Format(out, nestLevel);

    if (this.net_outs.length) {
      out.Print(nestLevel, '(network_out\n');

      for (const net_out of this.net_outs) net_out.Format(out, nestLevel + 1);

      out.Print(nestLevel, ')\n');
    }
  }
}

/** `PIN_PAIR`: a was/is pair of pin references. */
export class PIN_PAIR {
  was: PIN_REF;
  is: PIN_REF;

  constructor(aParent: ELEM | null = null) {
    this.was = new PIN_REF(aParent);
    this.is = new PIN_REF(aParent);
  }
}

/** `<was_is_descriptor>`. */
export class WAS_IS extends ELEM {
  pin_pairs: PIN_PAIR[] = [];

  constructor(aParent: ELEM | null) {
    super('was_is', aParent);
  }

  override FormatContents(out: OUTPUTFORMATTER, nestLevel: number): void {
    for (const pin_pair of this.pin_pairs) {
      out.Print(nestLevel, '(pins ');
      pin_pair.was.Format(out, 0);
      out.Print(0, ' ');
      pin_pair.is.Format(out, 0);
      out.Print(0, ')\n');
    }
  }
}

/** `<session_file_descriptor>`, the root of a SES file. */
export class SESSION extends ELEM {
  session_id = '';
  base_design = '';
  history: HISTORY | null = null;
  structure: STRUCTURE | null = null;
  placement: PLACEMENT | null = null;
  was_is: WAS_IS | null = null;
  route: ROUTE | null = null;

  constructor(aParent: ELEM | null = null) {
    super('session', aParent);
  }

  override Format(out: OUTPUTFORMATTER, nestLevel: number): void {
    const quote = out.GetQuoteChar(this.session_id);

    out.Print(nestLevel, `(${this.Name()} ${quote}${this.session_id}${quote}\n`);
    out.Print(nestLevel + 1, `(base_design "${this.base_design}")\n`);

    if (this.history) this.history.Format(out, nestLevel + 1);

    if (this.structure) this.structure.Format(out, nestLevel + 1);

    if (this.placement) this.placement.Format(out, nestLevel + 1);

    if (this.was_is) this.was_is.Format(out, nestLevel + 1);

    if (this.route) this.route.Format(out, nestLevel + 1);

    out.Print(nestLevel, ')\n');
  }
}

/**
 * `specctra.keywords`: the keyword table `SPECCTRA_LEXER` is built from. The
 * lookup is case-insensitive (`KEYWORD_MAP` uses `iequal_to`), so `(PN ...)`
 * and `(pn ...)` are the same token; an unquoted word that is not in this
 * table is an arbitrary symbol and keeps its case.
 */
export const SPECCTRA_KEYWORDS: ReadonlySet<string> = new Set([
  'absolute',
  'added',
  'add_group',
  'add_pins',
  'allow_antenna',
  'allow_redundant_wiring',
  'amp',
  'ancestor',
  'antipad',
  'aperture_type',
  'array',
  'attach',
  'attr',
  'average_pair_length',
  'back',
  'base_design',
  'bbv_ctr2ctr',
  'bend_keepout',
  'bond',
  'both',
  'bottom',
  'bottom_layer_sel',
  'boundary',
  'brickpat',
  'bundle',
  'bus',
  'bypass',
  'capacitance_resolution',
  'capacitor',
  'case_sensitive',
  'cct1',
  'cct1a',
  'center_center',
  'checking_trim_by_pin',
  'circ',
  'circle',
  'circuit',
  'class',
  'class_class',
  'classes',
  'clear',
  'clearance',
  'cluster',
  'cm',
  'color',
  'colors',
  'comment',
  'comp',
  'comp_edge_center',
  'comp_order',
  'component',
  'composite',
  'conductance_resolution',
  'conductor',
  'conflict',
  'connect',
  'constant',
  'contact',
  'control',
  'corner',
  'corners',
  'cost',
  'created_time',
  'cross',
  'crosstalk_model',
  'current_resolution',
  'deleted',
  'deleted_keepout',
  'delta',
  'diagonal',
  'direction',
  'directory',
  'discrete',
  'effective_via_length',
  'elongate_keepout',
  'exclude',
  'expose',
  'extra_image_directory',
  'family',
  'family_family',
  'family_family_spacing',
  'fanout',
  'farad',
  'file',
  'fit',
  'fix',
  'flip_style',
  'floor_plan',
  'footprint',
  'forbidden',
  'force_to_terminal_point',
  'forgotten',
  'free',
  'fromto',
  'front',
  'front_only',
  'gap',
  'gate',
  'gates',
  'generated_by_freeroute',
  'global',
  'grid',
  'group',
  'group_set',
  'guide',
  'hard',
  'height',
  'high',
  'history',
  'horizontal',
  'host_cad',
  'host_version',
  'image',
  'image_conductor',
  'image_image',
  'image_image_spacing',
  'image_outline_clearance',
  'image_set',
  'image_type',
  'inch',
  'include',
  'include_pins_in_crosstalk',
  'inductance_resolution',
  'insert',
  'instcnfg',
  'inter_layer_clearance',
  'jumper',
  'junction_type',
  'keepout',
  'kg',
  'kohm',
  'large',
  'large_large',
  'layer',
  'layer_depth',
  'layer_noise_weight',
  'layer_pair',
  'layer_rule',
  'length',
  'length_amplitude',
  'length_factor',
  'length_gap',
  'library',
  'library_out',
  'limit',
  'limit_bends',
  'limit_crossing',
  'limit_vias',
  'limit_way',
  'linear',
  'linear_interpolation',
  'load',
  'lock_type',
  'logical_part',
  'logical_part_mapping',
  'low',
  'match_fromto_delay',
  'match_fromto_length',
  'match_group_delay',
  'match_group_length',
  'match_net_delay',
  'match_net_length',
  'max_delay',
  'max_len',
  'max_length',
  'max_noise',
  'max_restricted_layer_length',
  'max_stagger',
  'max_stub',
  'max_total_delay',
  'max_total_length',
  'max_total_vias',
  'medium',
  'mhenry',
  'mho',
  'microvia',
  'mid_driven',
  'mil',
  'min_gap',
  'mirror',
  'mirror_first',
  'mixed',
  'mm',
  'negative_diagonal',
  'net',
  'net_number',
  'net_out',
  'net_pin_changes',
  'nets',
  'network',
  'network_out',
  'no',
  'noexpose',
  'noise_accumulation',
  'noise_calculation',
  'normal',
  'object_type',
  'off',
  'off_grid',
  'offset',
  'on',
  'open',
  'opposite_side',
  'order',
  'orthogonal',
  'outline',
  'overlap',
  'pad',
  'pad_pad',
  'padstack',
  'pair',
  'parallel',
  'parallel_noise',
  'parallel_segment',
  'parser',
  'part_library',
  'path',
  'pcb',
  'permit_orient',
  'permit_side',
  'physical',
  'physical_part_mapping',
  'piggyback',
  'pin',
  'pin_allow',
  'pin_cap_via',
  'pin_via_cap',
  'pin_width_taper',
  'pins',
  'pintype',
  'place',
  'place_boundary',
  'place_control',
  'place_keepout',
  'place_rule',
  'placement',
  'plan',
  'plane',
  'pn',
  'point',
  'polyline_path',
  'polygon',
  'position',
  'positive_diagonal',
  'power',
  'power_dissipation',
  'power_fanout',
  'prefix',
  'primary',
  'priority',
  'property',
  'protect',
  'qarc',
  'quarter',
  'radius',
  'ratio',
  'ratio_tolerance',
  'rect',
  'reduced',
  'region',
  'region_class',
  'region_class_class',
  'region_net',
  'relative_delay',
  'relative_group_delay',
  'relative_group_length',
  'relative_length',
  'reorder',
  'reroute_order_viols',
  'resistance_resolution',
  'resistor',
  'resolution',
  'restricted_layer_length_factor',
  'room',
  'rotate',
  'rotate_first',
  'round',
  'roundoff_rotation',
  'route',
  'route_to_fanout_only',
  'routes',
  'routes_include',
  'rule',
  'same_net_checking',
  'sample_window',
  'saturation_length',
  'sec',
  'secondary',
  'self',
  'sequence_number',
  'session',
  'set_color',
  'set_pattern',
  'shape',
  'shield',
  'shield_gap',
  'shield_loop',
  'shield_tie_down_interval',
  'shield_width',
  'side',
  'signal',
  'site',
  'small',
  'smd',
  'snap',
  'snap_angle',
  'soft',
  'source',
  'space_in_quoted_tokens',
  'spacing',
  'spare',
  'spiral_via',
  'square',
  'stack_via',
  'stack_via_depth',
  'standard',
  'starburst',
  'status',
  'structure',
  'structure_out',
  'subgate',
  'subgates',
  'substituted',
  'such',
  'suffix',
  'super_placement',
  'supply',
  'supply_pin',
  'swapping',
  'switch_window',
  'system',
  'tandem_noise',
  'tandem_segment',
  'tandem_shield_overhang',
  'terminal',
  'terminator',
  'term_only',
  'test',
  'test_points',
  'testpoint',
  'threshold',
  'time_length_factor',
  'time_resolution',
  'tjunction',
  'tolerance',
  'top',
  'topology',
  'total',
  'track_id',
  'turret',
  'type',
  'um',
  'unassigned',
  'unconnects',
  'unit',
  'up',
  'use_array',
  'use_layer',
  'use_net',
  'use_via',
  'value',
  'vertical',
  'via',
  'via_array_template',
  'via_at_smd',
  'via_keepout',
  'via_number',
  'via_rotate_first',
  'via_site',
  'via_size',
  'virtual_pin',
  'volt',
  'voltage_resolution',
  'was_is',
  'way',
  'weight',
  'width',
  'window',
  'wire',
  'wire_keepout',
  'wires',
  'wires_include',
  'wiring',
  'write_resolution',
  'x               # test cmake script with indent and comment',
  'xy',
  'y',
]);

/** `atoi`: the leading integer of a token's text, 0 when there is none. */
const atoi = (aText: string): number => {
  const v = Number.parseInt(aText, 10);
  return Number.isNaN(v) ? 0 : v;
};

/** The `(x, y)` value type tokens have to be compared against. */
const isSymbolTok = (aTok: Tok): boolean => DSNLEXER.IsSymbol(aTok);

/**
 * `SPECCTRA_DB`: reads a DSN or SES file into the element classes above, and
 * builds them from a BOARD (`specctra_export.ts`) or applies a session to one
 * (`specctra_import.ts`).
 */
export class SPECCTRA_DB {
  m_pcb: PCB | null = null;
  m_session: SESSION | null = null;
  m_filename = '';
  m_quote_char = '"';
  m_footprintsAreFlipped = false;
  m_layerIds: string[] = [];
  /** maps BOARD layer number to PCB layer numbers */
  m_kicadLayer2pcb = new Map<number, number>();
  /** maps PCB layer number to BOARD layer numbers */
  m_pcbLayer2kicad = new Map<number, number>();
  m_routeResolution: UNIT_RES | null = null;
  m_top_via_layer = 0;
  m_bot_via_layer = 0;

  /** The lexer of the file being read (`SPECCTRA_LEXER`, which the C++ class derives from). */
  protected lex: DSNLEXER = new DSNLEXER('');

  constructor() {
    this.lex.SetSpecctraMode(true);
    this.lex.SetKeywords(SPECCTRA_KEYWORDS);
  }

  SetPCB(aPcb: PCB | null): void {
    this.m_pcb = aPcb;
  }

  GetPCB(): PCB | null {
    return this.m_pcb;
  }

  SetSESSION(aSession: SESSION | null): void {
    this.m_session = aSession;
  }

  GetSESSION(): SESSION | null {
    return this.m_session;
  }

  // ----- the lexer, as the C++ class inherits it -------------------------------

  protected NextTok(): Tok {
    return this.lex.NextTok();
  }

  protected CurTok(): Tok {
    return this.lex.CurTok();
  }

  protected PrevTok(): Tok {
    return this.lex.PrevTok();
  }

  protected CurText(): string {
    return this.lex.CurText();
  }

  protected NeedSYMBOL(): Tok {
    return this.lex.NeedSYMBOL();
  }

  protected NeedSYMBOLorNUMBER(): Tok {
    return this.lex.NeedSYMBOLorNUMBER();
  }

  protected NeedRIGHT(): void {
    this.lex.NeedRIGHT();
  }

  protected Expecting(aWhat: Tok): never {
    return this.lex.Expecting(aWhat);
  }

  protected Unexpected(aWhat?: Tok): never {
    return this.lex.Unexpected(aWhat);
  }

  protected parseDouble(): number {
    return this.lex.parseDouble();
  }

  // ----- the two file readers -------------------------------------------------

  /** `LoadPCB`: reads a DSN file's text. */
  LoadPCB(aText: string, aFilename = 'string'): void {
    this.lex = new DSNLEXER(aText, aFilename);
    this.lex.SetSpecctraMode(true);
    this.lex.SetKeywords(SPECCTRA_KEYWORDS);

    if (this.NextTok() !== T.LEFT) this.Expecting(T.LEFT);

    if (this.NextTok() !== 'pcb') this.Expecting('pcb');

    this.SetPCB(new PCB());

    this.doPCB(this.m_pcb!);
  }

  /** `LoadSESSION`: reads a SES file's text. */
  LoadSESSION(aText: string, aFilename = 'string'): void {
    this.lex = new DSNLEXER(aText, aFilename);
    this.lex.SetSpecctraMode(true);
    this.lex.SetKeywords(SPECCTRA_KEYWORDS);

    if (this.NextTok() !== T.LEFT) this.Expecting(T.LEFT);

    if (this.NextTok() !== 'session') this.Expecting('session');

    this.SetSESSION(new SESSION());

    this.doSESSION(this.m_session!);
  }

  findLayerName(aLayerName: string): number {
    for (let i = 0; i < this.m_layerIds.length; ++i) {
      if (aLayerName === this.m_layerIds[i]) return i;
    }

    return -1;
  }

  /** `<pin_reference>::=<component_id>-<pin_id>`. */
  readCOMPnPIN(): { component_id: string; pin_id: string } {
    const pin_def = '<pin_reference>::=<component_id>-<pin_id>';

    if (!isSymbolTok(this.CurTok())) this.Expecting(pin_def);

    // case for:  A12-14, i.e. no wrapping quotes.  This should be a single
    // token, so split it.
    if (this.CurTok() !== T.STRING) {
      const toktext = this.CurText();
      const dash = toktext.indexOf('-');

      if (dash < 0) this.Expecting(pin_def);

      return { component_id: toktext.slice(0, dash), pin_id: toktext.slice(dash + 1) };
    }

    // quoted string:  "U12"-"14" or "U12"-14,  3 tokens in either case
    const component_id = this.CurText();

    if (this.NextTok() !== T.DASH) this.Expecting(pin_def);

    this.NextTok(); // accept anything after the dash.

    return { component_id, pin_id: this.CurText() };
  }

  /** `<month> <day> <hour> : <minute> : <second> <year>`, or with the time as one token. */
  readTIME(): Date {
    const time_toks =
      '<month> <day> <hour> : <minute> : <second> <year> or <month> <day> <hour>:<minute>:<second> <year>';
    const months = [
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

    let hour = 0;
    let min = 0;
    let sec = 0;

    this.NeedSYMBOL(); // month

    const ptok = this.CurText();
    let mon = 0; // remains if we don't find a month match.

    for (let m = 0; m < months.length; ++m) {
      if (months[m]!.toLowerCase() === ptok.toLowerCase()) {
        mon = m;
        break;
      }
    }

    let tok = this.NextTok(); // day

    if (tok !== T.NUMBER) this.Expecting(time_toks);

    const mday = atoi(this.CurText());

    tok = this.NextTok(); // hour or H:M:S

    if (tok === T.NUMBER) {
      hour = atoi(this.CurText());

      // : colon
      this.NeedSYMBOL();

      if (this.CurText() !== ':') this.Expecting(time_toks);

      tok = this.NextTok(); // minute

      if (tok !== T.NUMBER) this.Expecting(time_toks);

      min = atoi(this.CurText());

      // : colon
      this.NeedSYMBOL();

      if (this.CurText() !== ':') this.Expecting(time_toks);

      tok = this.NextTok(); // second

      if (tok !== T.NUMBER) this.Expecting(time_toks);

      sec = atoi(this.CurText());
    } else if (isSymbolTok(tok)) {
      const arr = this.CurText().split(':');

      if (arr.length !== 3) this.Expecting(time_toks);

      hour = atoi(arr[0]!);
      min = atoi(arr[1]!);
      sec = atoi(arr[2]!);
    }

    tok = this.NextTok(); // year

    if (tok !== T.NUMBER) this.Expecting(time_toks);

    const year = atoi(this.CurText());

    return new Date(year, mon, mday, hour, min, sec);
  }

  /**
   * The keyword `tok` is a `T_*` value: a string (which every unquoted word is
   * here). A structural token is negative upstream and is not a keyword.
   */
  private keyword(aTok: Tok): aTok is string {
    return typeof aTok === 'string';
  }

  doPCB(growth: PCB): void {
    /*  <design_descriptor >::=
        (pcb <pcb_id >
          [<parser_descriptor> ]
          [<resolution_descriptor> ]
          [<unit_descriptor> ]
          [<structure_descriptor> | <file_descriptor> ]
          [<placement_descriptor> | <file_descriptor> ]
          [<library_descriptor> | <file_descriptor> ]
          [<network_descriptor> | <file_descriptor> ]
          [<wiring_descriptor> ]
          ...
        )
    */
    let tok: Tok;

    this.NeedSYMBOL();
    growth.m_pcbname = this.CurText();

    while ((tok = this.NextTok()) !== T.RIGHT) {
      if (tok !== T.LEFT) this.Expecting(T.LEFT);

      tok = this.NextTok();

      switch (tok) {
        case 'parser':
          if (growth.m_parser) this.Unexpected(tok);
          growth.m_parser = new PARSER(growth);
          this.doPARSER(growth.m_parser);
          break;

        case 'unit':
          if (growth.m_unit) this.Unexpected(tok);
          growth.m_unit = new UNIT_RES(growth, tok);
          this.doUNIT(growth.m_unit);
          break;

        case 'resolution':
          if (growth.m_resolution) this.Unexpected(tok);
          growth.m_resolution = new UNIT_RES(growth, tok);
          this.doRESOLUTION(growth.m_resolution);
          break;

        case 'structure':
          if (growth.m_structure) this.Unexpected(tok);
          growth.m_structure = new STRUCTURE(growth);
          this.doSTRUCTURE(growth.m_structure);
          break;

        case 'placement':
          if (growth.m_placement) this.Unexpected(tok);
          growth.m_placement = new PLACEMENT(growth);
          this.doPLACEMENT(growth.m_placement);
          break;

        case 'library':
          if (growth.m_library) this.Unexpected(tok);
          growth.m_library = new LIBRARY(growth);
          this.doLIBRARY(growth.m_library);
          break;

        case 'network':
          if (growth.m_network) this.Unexpected(tok);
          growth.m_network = new NETWORK(growth);
          this.doNETWORK(growth.m_network);
          break;

        case 'wiring':
          if (growth.m_wiring) this.Unexpected(tok);
          growth.m_wiring = new WIRING(growth);
          this.doWIRING(growth.m_wiring);
          break;

        default:
          this.Unexpected(this.CurText());
      }
    }

    tok = this.NextTok();

    if (tok !== T.EOF) this.Expecting(T.EOF);
  }

  doPARSER(growth: PARSER): void {
    let tok: Tok;

    while ((tok = this.NextTok()) !== T.RIGHT) {
      if (tok !== T.LEFT) this.Expecting(T.LEFT);

      tok = this.NextTok();

      switch (tok) {
        case T.STRING_QUOTE:
          tok = this.NextTok();

          if (tok !== T.QUOTE_DEF) this.Expecting(T.QUOTE_DEF);

          this.lex.SetStringDelimiter(this.CurText()[0]!);
          growth.string_quote = this.CurText()[0]!;
          this.m_quote_char = this.CurText();

          this.NeedRIGHT();
          break;

        case 'space_in_quoted_tokens':
          tok = this.NextTok();

          if (tok !== 'on' && tok !== 'off') this.Expecting('on|off');

          this.lex.SetSpaceInQuotedTokens(tok === 'on');
          growth.space_in_quoted_tokens = tok === 'on';
          this.NeedRIGHT();
          break;

        case 'host_cad':
          this.NeedSYMBOL();
          growth.host_cad = this.CurText();
          this.NeedRIGHT();
          break;

        case 'host_version':
          this.NeedSYMBOLorNUMBER();
          growth.host_version = this.CurText();
          this.NeedRIGHT();
          break;

        case 'constant': {
          this.NeedSYMBOLorNUMBER();
          const const1 = this.CurText();
          this.NeedSYMBOLorNUMBER();
          const const2 = this.CurText();
          this.NeedRIGHT();
          growth.constants.push(const1);
          growth.constants.push(const2);
          break;
        }

        case 'write_resolution': // [(writee_resolution {<character> <positive_integer >})]
          while ((tok = this.NextTok()) !== T.RIGHT) {
            if (!this.keyword(tok)) this.Expecting(T.SYMBOL);

            tok = this.NextTok();

            if (tok !== T.NUMBER) this.Expecting(T.NUMBER);

            // @todo
          }
          break;

        case 'routes_include': // [(routes_include {[testpoint | guides | image_conductor]})]
          while ((tok = this.NextTok()) !== T.RIGHT) {
            switch (tok) {
              case 'testpoint':
                growth.routes_include_testpoint = true;
                break;

              case 'guide':
                growth.routes_include_guides = true;
                break;

              case 'image_conductor':
                growth.routes_include_image_conductor = true;
                break;

              default:
                this.Expecting('testpoint|guides|image_conductor');
            }
          }
          break;

        case 'wires_include': // [(wires_include testpoint)]
          tok = this.NextTok();

          if (tok !== 'testpoint') this.Expecting('testpoint');

          growth.routes_include_testpoint = true;
          this.NeedRIGHT();
          break;

        case 'case_sensitive':
          tok = this.NextTok();

          if (tok !== 'on' && tok !== 'off') this.Expecting('on|off');

          growth.case_sensitive = tok === 'on';
          this.NeedRIGHT();
          break;

        case 'via_rotate_first': // [(via_rotate_first [on | off])]
          tok = this.NextTok();

          if (tok !== 'on' && tok !== 'off') this.Expecting('on|off');

          growth.via_rotate_first = tok === 'on';
          this.NeedRIGHT();
          break;

        case 'generated_by_freeroute':
          growth.generated_by_freeroute = true;
          this.NeedRIGHT();
          break;

        default:
          this.Unexpected(this.CurText());
      }
    }
  }

  doRESOLUTION(growth: UNIT_RES): void {
    this.NextTok();

    const str = this.CurText().toLowerCase();

    if (str === 'inch') growth.units = 'inch';
    else if (str === 'mil') growth.units = 'mil';
    else if (str === 'cm') growth.units = 'cm';
    else if (str === 'mm') growth.units = 'mm';
    else if (str === 'um') growth.units = 'um';
    else this.Expecting('inch|mil|cm|mm|um');

    const tok = this.NextTok();

    if (tok !== T.NUMBER) this.Expecting(T.NUMBER);

    growth.value = atoi(this.CurText());

    this.NeedRIGHT();
  }

  doUNIT(growth: UNIT_RES): void {
    const tok = this.NextTok();

    switch (tok) {
      case 'inch':
      case 'mil':
      case 'cm':
      case 'mm':
      case 'um':
        growth.units = tok;
        break;

      default:
        this.Expecting('inch|mil|cm|mm|um');
    }

    this.NeedRIGHT();
  }

  doSPECCTRA_LAYER_PAIR(growth: SPECCTRA_LAYER_PAIR): void {
    this.NeedSYMBOL();
    growth.layer_id0 = this.CurText();

    this.NeedSYMBOL();
    growth.layer_id1 = this.CurText();

    if (this.NextTok() !== T.NUMBER) this.Expecting(T.NUMBER);

    growth.layer_weight = this.parseDouble();

    this.NeedRIGHT();
  }

  doLAYER_NOISE_WEIGHT(growth: LAYER_NOISE_WEIGHT): void {
    let tok: Tok;

    while ((tok = this.NextTok()) !== T.RIGHT) {
      if (tok !== T.LEFT) this.Expecting(T.LEFT);

      if (this.NextTok() !== 'layer_pair') this.Expecting('layer_pair');

      const layer_pair = new SPECCTRA_LAYER_PAIR(growth);
      growth.layer_pairs.push(layer_pair);
      this.doSPECCTRA_LAYER_PAIR(layer_pair);
    }
  }

  doSTRUCTURE(growth: STRUCTURE): void {
    let tok: Tok;

    while ((tok = this.NextTok()) !== T.RIGHT) {
      if (tok !== T.LEFT) this.Expecting(T.LEFT);

      tok = this.NextTok();

      // `goto L_place` in the C++: a second `boundary` is the place_boundary.
      let placeBoundary = false;

      switch (tok) {
        case 'unit':
          if (growth.m_unit) this.Unexpected(tok);
          growth.m_unit = new UNIT_RES(growth, tok);
          this.doUNIT(growth.m_unit);
          break;

        case 'resolution':
          if (growth.m_unit) this.Unexpected(tok);
          growth.m_unit = new UNIT_RES(growth, tok);
          this.doRESOLUTION(growth.m_unit);
          break;

        case 'layer_noise_weight':
          if (growth.m_layer_noise_weight) this.Unexpected(tok);
          growth.m_layer_noise_weight = new LAYER_NOISE_WEIGHT(growth);
          this.doLAYER_NOISE_WEIGHT(growth.m_layer_noise_weight);
          break;

        case 'place_boundary':
          placeBoundary = true;
          break;

        case 'boundary':
          if (growth.m_boundary) {
            if (growth.m_place_boundary) this.Unexpected(tok);

            placeBoundary = true;
            break;
          }

          growth.m_boundary = new BOUNDARY(growth);
          this.doBOUNDARY(growth.m_boundary);
          break;

        case 'plane': {
          const plane = new COPPER_PLANE(growth);
          growth.m_planes.push(plane);
          this.doKEEPOUT(plane);
          break;
        }

        case 'region': {
          const region = new REGION(growth);
          growth.m_regions.push(region);
          this.doREGION(region);
          break;
        }

        case 'snap_angle': {
          const stringprop = new STRINGPROP(growth, 'snap_angle');
          growth.Append(stringprop);
          this.doSTRINGPROP(stringprop);
          break;
        }

        case 'via':
          if (growth.m_via) this.Unexpected(tok);
          growth.m_via = new VIA(growth);
          this.doVIA(growth.m_via);
          break;

        case 'control':
          if (growth.m_control) this.Unexpected(tok);
          growth.m_control = new CONTROL(growth);
          this.doCONTROL(growth.m_control);
          break;

        case 'layer': {
          const layer = new LAYER(growth);
          growth.m_layers.push(layer);
          this.doLAYER(layer);
          break;
        }

        case 'rule':
          if (growth.m_rules) this.Unexpected(tok);
          growth.m_rules = new RULE(growth, 'rule');
          this.doRULE(growth.m_rules);
          break;

        case 'place_rule':
          if (growth.m_place_rules) this.Unexpected(tok);
          growth.m_place_rules = new RULE(growth, 'place_rule');
          this.doRULE(growth.m_place_rules);
          break;

        case 'keepout':
        case 'place_keepout':
        case 'via_keepout':
        case 'wire_keepout':
        case 'bend_keepout':
        case 'elongate_keepout': {
          const keepout = new KEEPOUT(growth, tok);
          growth.m_keepouts.push(keepout);
          this.doKEEPOUT(keepout);
          break;
        }

        case 'grid': {
          const grid = new GRID(growth);
          growth.m_grids.push(grid);
          this.doGRID(grid);
          break;
        }

        default:
          this.Unexpected(this.CurText());
      }

      if (placeBoundary) {
        if (growth.m_place_boundary) this.Unexpected(tok);

        growth.m_place_boundary = new BOUNDARY(growth, 'place_boundary');
        this.doBOUNDARY(growth.m_place_boundary);
      }
    }
  }

  doSTRUCTURE_OUT(growth: STRUCTURE_OUT): void {
    let tok = this.NextTok();

    while (tok !== T.RIGHT) {
      if (tok !== T.LEFT) this.Expecting(T.LEFT);

      tok = this.NextTok();

      switch (tok) {
        case 'layer': {
          const layer = new LAYER(growth);
          growth.m_layers.push(layer);
          this.doLAYER(layer);
          break;
        }

        case 'rule':
          if (growth.m_rules) this.Unexpected(tok);
          growth.m_rules = new RULE(growth, 'rule');
          this.doRULE(growth.m_rules);
          break;

        default:
          this.Unexpected(this.CurText());
      }

      tok = this.NextTok();
    }
  }

  /** Shared by KEEPOUT and WINDOW-like holders: a shape keyword starts the shape. */
  private readShapeInto(
    aOwner: ELEM,
    aTok: DSN_T,
    aHasShape: () => boolean,
    aSet: (aShape: ELEM) => void,
  ): boolean {
    let tok: DSN_T = aTok;

    switch (tok) {
      case 'rect': {
        if (aHasShape()) this.Unexpected(tok);
        const r = new RECTANGLE(aOwner);
        aSet(r);
        this.doRECTANGLE(r);
        return true;
      }

      case 'circle': {
        if (aHasShape()) this.Unexpected(tok);
        const c = new CIRCLE(aOwner);
        aSet(c);
        this.doCIRCLE(c);
        return true;
      }

      // biome-ignore lint/suspicious/noFallthroughSwitchClause: KI_FALLTHROUGH in the C++
      case 'polyline_path':
        tok = 'path';
      // fallthrough
      case 'path':
      case 'polygon': {
        if (aHasShape()) this.Unexpected(tok);
        const p = new PATH(aOwner, tok);
        aSet(p);
        this.doPATH(p);
        return true;
      }

      case 'qarc': {
        if (aHasShape()) this.Unexpected(tok);
        const q = new QARC(aOwner);
        aSet(q);
        this.doQARC(q);
        return true;
      }

      default:
        return false;
    }
  }

  doKEEPOUT(growth: KEEPOUT): void {
    let tok = this.NextTok();

    if (isSymbolTok(tok)) {
      growth.m_name = this.CurText();
      tok = this.NextTok();
    }

    if (tok !== T.LEFT) this.Expecting(T.LEFT);

    while (tok !== T.RIGHT) {
      if (tok !== T.LEFT) this.Expecting(T.LEFT);

      tok = this.NextTok();

      if (
        this.keyword(tok) &&
        this.readShapeInto(
          growth,
          tok,
          () => growth.m_shape !== null,
          (s) => {
            growth.m_shape = s;
          },
        )
      ) {
        tok = this.NextTok();
        continue;
      }

      switch (tok) {
        case 'sequence_number':
          if (this.NextTok() !== T.NUMBER) this.Expecting(T.NUMBER);

          growth.m_sequence_number = atoi(this.CurText());
          this.NeedRIGHT();
          break;

        case 'rule':
          if (growth.m_rules) this.Unexpected(tok);
          growth.m_rules = new RULE(growth, 'rule');
          this.doRULE(growth.m_rules);
          break;

        case 'place_rule':
          if (growth.m_place_rules) this.Unexpected(tok);
          growth.m_place_rules = new RULE(growth, 'place_rule');
          this.doRULE(growth.m_place_rules);
          break;

        case 'window': {
          const window = new WINDOW(growth);
          growth.m_windows.push(window);
          this.doWINDOW(window);
          break;
        }

        default:
          this.Unexpected(this.CurText());
      }

      tok = this.NextTok();
    }
  }

  doCONNECT(_growth: CONNECT): void {
    let tok = this.NextTok();

    while (tok !== T.RIGHT) {
      if (tok !== T.LEFT) this.Expecting(T.LEFT);

      tok = this.NextTok();

      switch (tok) {
        case 'terminal':
          // since we do not use the terminal information, simply toss it.
          while ((tok = this.NextTok()) !== T.RIGHT && tok !== T.EOF);
          break;

        default:
          this.Unexpected(this.CurText());
      }

      tok = this.NextTok();
    }
  }

  doWINDOW(growth: WINDOW): void {
    let tok = this.NextTok();

    while (tok !== T.RIGHT) {
      if (tok !== T.LEFT) this.Expecting(T.LEFT);

      tok = this.NextTok();

      if (
        !this.keyword(tok) ||
        !this.readShapeInto(
          growth,
          tok,
          () => growth.shape !== null,
          (s) => {
            growth.shape = s;
          },
        )
      )
        this.Unexpected(this.CurText());

      tok = this.NextTok();
    }
  }

  doBOUNDARY(growth: BOUNDARY): void {
    let tok = this.NextTok();

    if (tok !== T.LEFT) this.Expecting(T.LEFT);

    tok = this.NextTok();

    if (tok === 'rect') {
      if (growth.paths.length) this.Unexpected('rect when path already encountered');

      growth.rectangle = new RECTANGLE(growth);
      this.doRECTANGLE(growth.rectangle);

      this.NeedRIGHT();
    } else if (tok === 'path') {
      if (growth.rectangle) this.Unexpected('path when rect already encountered');

      for (;;) {
        if (tok !== 'path') this.Expecting('path');

        const path = new PATH(growth, 'path');
        growth.paths.push(path);

        this.doPATH(path);

        tok = this.NextTok();

        if (tok === T.RIGHT) break;

        if (tok !== T.LEFT) this.Expecting(T.LEFT);

        tok = this.NextTok();
      }
    } else {
      this.Expecting('rect|path');
    }
  }

  doPATH(growth: PATH): void {
    let tok = this.NextTok();

    if (!isSymbolTok(tok) && tok !== T.NUMBER)
      // a layer name can be like a number like +12
      this.Expecting('layer_id');

    growth.layer_id = this.CurText();

    if (this.NextTok() !== T.NUMBER) this.Expecting('aperture_width');

    growth.aperture_width = this.parseDouble();

    const ptTemp = new POINT();

    tok = this.NextTok();

    do {
      if (tok !== T.NUMBER) this.Expecting(T.NUMBER);

      ptTemp.x = this.parseDouble();

      if (this.NextTok() !== T.NUMBER) this.Expecting(T.NUMBER);

      ptTemp.y = this.parseDouble();

      growth.points.push(ptTemp.clone());
    } while ((tok = this.NextTok()) !== T.RIGHT && tok !== T.LEFT);

    if (tok === T.LEFT) {
      if (this.NextTok() !== 'aperture_type') this.Expecting('aperture_type');

      tok = this.NextTok();

      if (tok !== 'round' && tok !== 'square') this.Expecting('round|square');

      growth.aperture_type = tok;

      this.NeedRIGHT();
    }
  }

  doRECTANGLE(growth: RECTANGLE): void {
    this.NeedSYMBOL();
    growth.layer_id = this.CurText();

    if (this.NextTok() !== T.NUMBER) this.Expecting(T.NUMBER);
    growth.point0.x = this.parseDouble();

    if (this.NextTok() !== T.NUMBER) this.Expecting(T.NUMBER);
    growth.point0.y = this.parseDouble();

    if (this.NextTok() !== T.NUMBER) this.Expecting(T.NUMBER);
    growth.point1.x = this.parseDouble();

    if (this.NextTok() !== T.NUMBER) this.Expecting(T.NUMBER);
    growth.point1.y = this.parseDouble();

    this.NeedRIGHT();
  }

  doCIRCLE(growth: CIRCLE): void {
    this.NeedSYMBOLorNUMBER();
    growth.layer_id = this.CurText();

    if (this.NextTok() !== T.NUMBER) this.Expecting(T.NUMBER);
    growth.diameter = this.parseDouble();

    let tok = this.NextTok();

    if (tok === T.NUMBER) {
      growth.vertex.x = this.parseDouble();

      if (this.NextTok() !== T.NUMBER) this.Expecting(T.NUMBER);
      growth.vertex.y = this.parseDouble();

      tok = this.NextTok();
    }

    if (tok !== T.RIGHT) this.Expecting(T.RIGHT);
  }

  doQARC(growth: QARC): void {
    this.NeedSYMBOL();
    growth.layer_id = this.CurText();

    if (this.NextTok() !== T.NUMBER) this.Expecting(T.NUMBER);
    growth.aperture_width = this.parseDouble();

    for (let i = 0; i < 3; ++i) {
      if (this.NextTok() !== T.NUMBER) this.Expecting(T.NUMBER);
      growth.vertex[i]!.x = this.parseDouble();

      if (this.NextTok() !== T.NUMBER) this.Expecting(T.NUMBER);
      growth.vertex[i]!.y = this.parseDouble();
    }

    this.NeedRIGHT();
  }

  doSTRINGPROP(growth: STRINGPROP): void {
    this.NeedSYMBOL();
    growth.value = this.CurText();
    this.NeedRIGHT();
  }

  doTOKPROP(growth: TOKPROP): void {
    const tok = this.NextTok();

    if (!this.keyword(tok)) this.Unexpected(this.CurText());

    growth.value = tok as string;
    this.NeedRIGHT();
  }

  doVIA(growth: VIA): void {
    let tok: Tok;

    while ((tok = this.NextTok()) !== T.RIGHT) {
      if (tok === T.LEFT) {
        if (this.NextTok() !== 'spare') this.Expecting('spare');

        while ((tok = this.NextTok()) !== T.RIGHT) {
          if (!isSymbolTok(tok)) this.Expecting(T.SYMBOL);

          growth.m_spares.push(this.CurText());
        }
      } else if (isSymbolTok(tok)) {
        growth.m_padstacks.push(this.CurText());
      } else {
        this.Unexpected(this.CurText());
      }
    }
  }

  doCONTROL(growth: CONTROL): void {
    let tok: Tok;

    while ((tok = this.NextTok()) !== T.RIGHT) {
      if (tok !== T.LEFT) this.Expecting(T.LEFT);

      tok = this.NextTok();

      switch (tok) {
        case 'via_at_smd':
          tok = this.NextTok();

          if (tok !== 'on' && tok !== 'off') this.Expecting('on|off');

          growth.via_at_smd = tok === 'on';
          this.NeedRIGHT();
          break;

        case 'off_grid':
        case 'route_to_fanout_only':
        case 'force_to_terminal_point':
        case 'same_net_checking':
        case 'checking_trim_by_pin':
        case 'noise_calculation':
        case 'noise_accumulation':
        case 'include_pins_in_crosstalk':
        case 'bbv_ctr2ctr':
        case 'average_pair_length':
        case 'crosstalk_model':
        case 'roundoff_rotation':
        case 'microvia':
        case 'reroute_order_viols': {
          const tokprop = new TOKPROP(growth, tok);
          growth.Append(tokprop);
          this.doTOKPROP(tokprop);
          break;
        }

        default:
          this.Unexpected(this.CurText());
      }
    }
  }

  doPROPERTIES(growth: PROPERTY[]): void {
    let tok: Tok;

    while ((tok = this.NextTok()) !== T.RIGHT) {
      if (tok !== T.LEFT) this.Expecting(T.LEFT);

      const property: PROPERTY = { name: '', value: '' };

      this.NeedSYMBOLorNUMBER();
      property.name = this.CurText();

      this.NeedSYMBOLorNUMBER();
      property.value = this.CurText();

      growth.push(property);

      this.NeedRIGHT();
    }
  }

  doLAYER(growth: LAYER): void {
    let tok = this.NextTok();

    if (!isSymbolTok(tok)) this.Expecting(T.SYMBOL);

    growth.name = this.CurText();

    while ((tok = this.NextTok()) !== T.RIGHT) {
      if (tok !== T.LEFT) this.Expecting(T.LEFT);

      tok = this.NextTok();

      switch (tok) {
        case 'type':
          tok = this.NextTok();

          if (tok !== 'signal' && tok !== 'power' && tok !== 'mixed' && tok !== 'jumper')
            this.Expecting('signal|power|mixed|jumper');

          growth.layer_type = tok;

          if (this.NextTok() !== T.RIGHT) this.Expecting(T.RIGHT);
          break;

        case 'rule':
          growth.rules = new RULE(growth, 'rule');
          this.doRULE(growth.rules);
          break;

        case 'property':
          this.doPROPERTIES(growth.properties);
          break;

        case 'direction':
          tok = this.NextTok();

          switch (tok) {
            case 'horizontal':
            case 'vertical':
            case 'orthogonal':
            case 'positive_diagonal':
            case 'negative_diagonal':
            case 'diagonal':
            case 'off':
              growth.direction = tok;
              break;

            default:
              // the spec has an example show an abbreviation of the "horizontal" keyword.  Ouch.
              if (this.CurText() === 'hori') {
                growth.direction = 'horizontal';
                break;
              }

              if (this.CurText() === 'vert') {
                growth.direction = 'vertical';
                break;
              }

              this.Expecting(
                'horizontal|vertical|orthogonal|positive_diagonal|negative_diagonal|diagonal|off',
              );
          }

          if (this.NextTok() !== T.RIGHT) this.Expecting(T.RIGHT);
          break;

        case 'cost':
          tok = this.NextTok();

          switch (tok) {
            case 'forbidden':
            case 'high':
            case 'medium':
            case 'low':
            case 'free':
              growth.cost = tok;
              break;

            case T.NUMBER:
              // store as negative so we can differentiate between a token and a number.
              growth.cost = -atoi(this.CurText());
              break;

            default:
              this.Expecting('forbidden|high|medium|low|free|<positive_integer>|-1');
          }

          tok = this.NextTok();

          if (tok === T.LEFT) {
            if (this.NextTok() !== 'type') this.Unexpected(this.CurText());

            tok = this.NextTok();

            if (tok !== 'length' && tok !== 'way') this.Expecting('length|way');

            growth.cost_type = tok;

            if (this.NextTok() !== T.RIGHT) this.Expecting(T.RIGHT);

            tok = this.NextTok();
          }

          if (tok !== T.RIGHT) this.Expecting(T.RIGHT);
          break;

        case 'use_net':
          while ((tok = this.NextTok()) !== T.RIGHT) {
            if (!isSymbolTok(tok)) this.Expecting(T.SYMBOL);

            growth.use_net.push(this.CurText());
          }
          break;

        default:
          this.Unexpected(this.CurText());
      }
    }
  }

  doRULE(growth: RULE): void {
    let builder = '';
    let bracketNesting = 1; // we already saw the opening T.LEFT
    let tok: Tok = T.NONE;

    while (bracketNesting !== 0 && tok !== T.EOF) {
      tok = this.NextTok();

      if (tok === T.LEFT) ++bracketNesting;
      else if (tok === T.RIGHT) --bracketNesting;

      if (bracketNesting >= 1) {
        if (this.PrevTok() !== T.LEFT && tok !== T.RIGHT && (tok !== T.LEFT || bracketNesting > 2))
          builder += ' ';

        if (tok === T.STRING) builder += this.m_quote_char;

        builder += this.CurText();

        if (tok === T.STRING) builder += this.m_quote_char;
      }

      // When the nested rule is closed with a T.RIGHT and we are back down
      // to bracketNesting == 1, (inside the <rule_descriptor> but outside
      // the last rule).  Then save the last rule and clear the string builder.
      if (bracketNesting === 1) {
        growth.m_rules.push(builder);
        builder = '';
      }
    }

    if (tok === T.EOF) this.Unexpected(T.EOF);
  }

  doREGION(growth: REGION): void {
    let tok = this.NextTok();

    if (isSymbolTok(tok)) {
      growth.m_region_id = this.CurText();
      tok = this.NextTok();
    }

    for (;;) {
      if (tok !== T.LEFT) this.Expecting(T.LEFT);

      tok = this.NextTok();

      switch (tok) {
        case 'rect':
          if (growth.m_rectangle) this.Unexpected(tok);
          growth.m_rectangle = new RECTANGLE(growth);
          this.doRECTANGLE(growth.m_rectangle);
          break;

        case 'polygon':
          if (growth.m_polygon) this.Unexpected(tok);
          growth.m_polygon = new PATH(growth, 'polygon');
          this.doPATH(growth.m_polygon);
          break;

        case 'region_net':
        case 'region_class': {
          const stringprop = new STRINGPROP(growth, tok);
          growth.Append(stringprop);
          this.doSTRINGPROP(stringprop);
          break;
        }

        case 'region_class_class': {
          const class_class = new CLASS_CLASS(growth, tok);
          growth.Append(class_class);
          this.doCLASS_CLASS(class_class);
          break;
        }

        case 'rule':
          if (growth.m_rules) this.Unexpected(tok);
          growth.m_rules = new RULE(growth, 'rule');
          this.doRULE(growth.m_rules);
          break;

        default:
          this.Unexpected(this.CurText());
      }

      tok = this.NextTok();

      if (tok === T.RIGHT) {
        if (!growth.m_rules) this.Expecting('rule');

        break;
      }
    }
  }

  doCLASS_CLASS(growth: CLASS_CLASS): void {
    let tok = this.NextTok();

    if (tok !== T.LEFT) this.Expecting(T.LEFT);

    while ((tok = this.NextTok()) !== T.RIGHT) {
      switch (tok) {
        case 'classes':
          if (growth.classes) this.Unexpected(tok);
          growth.classes = new CLASSES(growth);
          this.doCLASSES(growth.classes);
          break;

        case 'rule': {
          // only class_class takes a rule
          if (growth.Type() === 'region_class_class') this.Unexpected(tok);

          const rule = new RULE(growth, 'rule');
          growth.Append(rule);
          this.doRULE(rule);
          break;
        }

        case 'layer_rule': {
          // only class_class takes a layer_rule
          if (growth.Type() === 'region_class_class') this.Unexpected(tok);

          const layer_rule = new LAYER_RULE(growth);
          growth.Append(layer_rule);
          this.doLAYER_RULE(layer_rule);
          break;
        }

        default:
          this.Unexpected(tok);
      }
    }
  }

  doCLASSES(growth: CLASSES): void {
    let tok = this.NextTok();

    // require at least 2 class_ids
    if (!isSymbolTok(tok)) this.Expecting('class_id');

    growth.class_ids.push(this.CurText());

    do {
      tok = this.NextTok();

      if (!isSymbolTok(tok)) this.Expecting('class_id');

      growth.class_ids.push(this.CurText());
    } while ((tok = this.NextTok()) !== T.RIGHT);
  }

  doGRID(growth: GRID): void {
    let tok = this.NextTok();

    switch (tok) {
      case 'via':
      case 'wire':
      case 'via_keepout':
      case 'snap':
      case 'place':
        growth.m_grid_type = tok;

        if (this.NextTok() !== T.NUMBER) this.Expecting(T.NUMBER);

        growth.m_dimension = this.parseDouble();

        tok = this.NextTok();

        if (tok === T.LEFT) {
          while ((tok = this.NextTok()) !== T.RIGHT) {
            if (tok === 'direction') {
              if (growth.m_grid_type === 'place') this.Unexpected(tok);

              tok = this.NextTok();

              if (tok !== 'x' && tok !== 'y') this.Unexpected(this.CurText());

              growth.m_direction = tok;

              if (this.NextTok() !== T.RIGHT) this.Expecting(T.RIGHT);
            } else if (tok === 'offset') {
              if (growth.m_grid_type === 'place') this.Unexpected(tok);

              if (this.NextTok() !== T.NUMBER) this.Expecting(T.NUMBER);

              growth.m_offset = this.parseDouble();

              if (this.NextTok() !== T.RIGHT) this.Expecting(T.RIGHT);
            } else if (tok === 'image_type') {
              if (growth.m_grid_type !== 'place') this.Unexpected(tok);

              tok = this.NextTok();

              if (tok !== 'smd' && tok !== 'pin') this.Unexpected(this.CurText());

              growth.m_image_type = tok;

              if (this.NextTok() !== T.RIGHT) this.Expecting(T.RIGHT);
            }
          }
        }
        break;

      default:
        this.Unexpected(tok);
    }
  }

  doLAYER_RULE(growth: LAYER_RULE): void {
    let tok: Tok;

    this.NeedSYMBOL();

    do {
      growth.m_layer_ids.push(this.CurText());
    } while (isSymbolTok((tok = this.NextTok())));

    if (tok !== T.LEFT) this.Expecting(T.LEFT);

    if (this.NextTok() !== 'rule') this.Expecting('rule');

    growth.m_rule = new RULE(growth, 'rule');
    this.doRULE(growth.m_rule);

    this.NeedRIGHT();
  }

  doPLACE(growth: PLACE): void {
    let tok = this.NextTok();

    if (!isSymbolTok(tok)) this.Expecting('component_id');

    growth.m_component_id = this.CurText();

    tok = this.NextTok();

    if (tok === T.NUMBER) {
      const point = new POINT();

      point.x = this.parseDouble();

      if (this.NextTok() !== T.NUMBER) this.Expecting(T.NUMBER);

      point.y = this.parseDouble();

      growth.SetVertex(point);

      tok = this.NextTok();

      if (tok !== 'front' && tok !== 'back') this.Expecting('front|back');

      growth.m_side = tok;

      if (this.NextTok() !== T.NUMBER) this.Expecting('rotation');

      growth.SetRotation(this.parseDouble());
    }

    while ((tok = this.NextTok()) !== T.RIGHT) {
      if (tok !== T.LEFT) this.Expecting(T.LEFT);

      tok = this.NextTok();

      switch (tok) {
        case 'mirror':
          tok = this.NextTok();

          if (tok === 'x' || tok === 'y' || tok === 'xy' || tok === 'off') growth.m_mirror = tok;
          else this.Expecting('x|y|xy|off');
          break;

        case 'status':
          tok = this.NextTok();

          if (tok === 'added' || tok === 'deleted' || tok === 'substituted') growth.m_status = tok;
          else this.Expecting('added|deleted|substituted');
          break;

        case 'logical_part':
          if (growth.m_logical_part.length) this.Unexpected(tok);

          tok = this.NextTok();

          if (!isSymbolTok(tok)) this.Expecting('logical_part_id');

          growth.m_logical_part = this.CurText();
          break;

        case 'place_rule':
          if (growth.m_place_rules) this.Unexpected(tok);

          growth.m_place_rules = new RULE(growth, 'place_rule');
          this.doRULE(growth.m_place_rules);
          break;

        case 'property':
          if (growth.m_properties.length) this.Unexpected(tok);

          this.doPROPERTIES(growth.m_properties);
          break;

        case 'lock_type':
          tok = this.NextTok();

          if (tok === 'position' || tok === 'gate' || tok === 'subgate' || tok === 'pin')
            growth.m_lock_type = tok;
          else this.Expecting('position|gate|subgate|pin');
          break;

        case 'rule':
          if (growth.m_rules || growth.m_region) this.Unexpected(tok);

          growth.m_rules = new RULE(growth, 'rule');
          this.doRULE(growth.m_rules);
          break;

        case 'region':
          if (growth.m_rules || growth.m_region) this.Unexpected(tok);

          growth.m_region = new REGION(growth);
          this.doREGION(growth.m_region);
          break;

        case 'pn':
          if (growth.m_part_number.length) this.Unexpected(tok);

          this.NeedSYMBOLorNUMBER();
          growth.m_part_number = this.CurText();
          this.NeedRIGHT();
          break;

        default:
          this.Unexpected(tok);
      }
    }
  }

  doCOMPONENT(growth: COMPONENT): void {
    let tok = this.NextTok();

    if (!isSymbolTok(tok) && tok !== T.NUMBER) this.Expecting('image_id');

    growth.m_image_id = this.CurText();

    while ((tok = this.NextTok()) !== T.RIGHT) {
      if (tok !== T.LEFT) this.Expecting(T.LEFT);

      tok = this.NextTok();

      switch (tok) {
        case 'place': {
          const place = new PLACE(growth);
          growth.m_places.push(place);
          this.doPLACE(place);
          break;
        }

        default:
          this.Unexpected(tok);
      }
    }
  }

  doPLACEMENT(growth: PLACEMENT): void {
    let tok: Tok;

    while ((tok = this.NextTok()) !== T.RIGHT) {
      if (tok === T.EOF) this.Unexpected(T.EOF);

      if (tok !== T.LEFT) this.Expecting(T.LEFT);

      tok = this.NextTok();

      switch (tok) {
        case 'unit':
        case 'resolution':
          growth.m_unit = new UNIT_RES(growth, tok);

          if (tok === 'resolution') this.doRESOLUTION(growth.m_unit);
          else this.doUNIT(growth.m_unit);
          break;

        case 'place_control':
          this.NeedRIGHT();
          tok = this.NextTok();

          if (tok !== 'flip_style') this.Expecting('flip_style');

          tok = this.NextTok();

          if (tok === 'mirror_first' || tok === 'rotate_first') growth.m_flip_style = tok;
          else this.Expecting('mirror_first|rotate_first');

          this.NeedRIGHT();
          this.NeedRIGHT();
          break;

        case 'component': {
          const component = new COMPONENT(growth);
          growth.m_components.push(component);
          this.doCOMPONENT(component);
          break;
        }

        default:
          this.Unexpected(tok);
      }
    }
  }

  doPADSTACK(growth: PADSTACK): void {
    let tok = this.NextTok();

    // m_padstack_id may be a number
    if (!isSymbolTok(tok) && tok !== T.NUMBER) this.Expecting('m_padstack_id');

    growth.m_padstack_id = this.CurText();

    while ((tok = this.NextTok()) !== T.RIGHT) {
      if (tok !== T.LEFT) this.Expecting(T.LEFT);

      tok = this.NextTok();

      switch (tok) {
        case 'unit':
          if (growth.m_unit) this.Unexpected(tok);

          growth.m_unit = new UNIT_RES(growth, tok);
          this.doUNIT(growth.m_unit);
          break;

        case 'rotate':
          tok = this.NextTok();

          if (tok !== 'on' && tok !== 'off') this.Expecting('on|off');

          growth.m_rotate = tok;
          this.NeedRIGHT();
          break;

        case 'absolute':
          tok = this.NextTok();

          if (tok !== 'on' && tok !== 'off') this.Expecting('on|off');

          growth.m_absolute = tok;
          this.NeedRIGHT();
          break;

        case 'shape': {
          const shape = new SHAPE(growth);
          growth.Append(shape);
          this.doSHAPE(shape);
          break;
        }

        case 'attach':
          tok = this.NextTok();

          if (tok !== 'off' && tok !== 'on') this.Expecting('off|on');

          growth.m_attach = tok;

          tok = this.NextTok();

          if (tok === T.LEFT) {
            if (this.NextTok() !== 'use_via') this.Expecting('use_via');

            this.NeedSYMBOL();
            growth.m_via_id = this.CurText();

            this.NeedRIGHT();
            this.NeedRIGHT();
          }
          break;

        case 'via_site': // not supported
          break;

        case 'rule':
          if (growth.m_rules) this.Unexpected(tok);

          growth.m_rules = new RULE(growth, 'rule');
          this.doRULE(growth.m_rules);
          break;

        default:
          this.Unexpected(this.CurText());
      }
    }
  }

  doSHAPE(growth: SHAPE): void {
    let tok: Tok;

    while ((tok = this.NextTok()) !== T.RIGHT) {
      if (tok !== T.LEFT) this.Expecting(T.LEFT);

      tok = this.NextTok();

      switch (tok) {
        // biome-ignore lint/suspicious/noFallthroughSwitchClause: KI_FALLTHROUGH in the C++
        case 'polyline_path':
          tok = 'path';
        // fallthrough
        case 'rect':
        case 'circle':
        case 'path':
        case 'polygon':
        case 'qarc':
          if (growth.shape) this.Unexpected(tok);
          break;

        default:
          // the example in the spec uses "circ" instead of "circle".  Bad!
          if (this.CurText() === 'circ') {
            tok = 'circle';

            if (growth.shape) this.Unexpected(tok);
          }
      }

      switch (tok) {
        case 'rect':
          growth.shape = new RECTANGLE(growth);
          this.doRECTANGLE(growth.shape as RECTANGLE);
          break;

        case 'circle':
          growth.shape = new CIRCLE(growth);
          this.doCIRCLE(growth.shape as CIRCLE);
          break;

        case 'path':
        case 'polygon':
          growth.shape = new PATH(growth, tok);
          this.doPATH(growth.shape as PATH);
          break;

        case 'qarc':
          growth.shape = new QARC(growth);
          this.doQARC(growth.shape as QARC);
          break;

        case 'connect':
          tok = this.NextTok();

          if (tok !== 'on' && tok !== 'off') this.Expecting('on|off');

          growth.m_connect = tok;
          this.NeedRIGHT();
          break;

        case 'window': {
          const window = new WINDOW(growth);
          growth.m_windows.push(window);
          this.doWINDOW(window);
          break;
        }

        default:
          this.Unexpected(this.CurText());
      }
    }
  }

  doIMAGE(growth: IMAGE): void {
    let tok = this.NextTok();

    if (!isSymbolTok(tok) && tok !== T.NUMBER) this.Expecting('image_id');

    growth.m_image_id = this.CurText();

    while ((tok = this.NextTok()) !== T.RIGHT) {
      if (tok !== T.LEFT) this.Expecting(T.LEFT);

      tok = this.NextTok();

      switch (tok) {
        case 'unit':
          if (growth.m_unit) this.Unexpected(tok);

          growth.m_unit = new UNIT_RES(growth, tok);
          this.doUNIT(growth.m_unit);
          break;

        case 'side':
          tok = this.NextTok();

          if (tok !== 'front' && tok !== 'back' && tok !== 'both')
            this.Expecting('front|back|both');

          growth.m_side = tok;
          this.NeedRIGHT();
          break;

        case 'outline': {
          const outline = new SHAPE(growth, 'outline'); // use SHAPE for outline
          growth.Append(outline);
          this.doSHAPE(outline);
          break;
        }

        case 'pin': {
          const pin = new PIN(growth);
          growth.m_pins.push(pin);
          this.doPIN(pin);
          break;
        }

        case 'rule':
          if (growth.m_rules) this.Unexpected(tok);

          growth.m_rules = new RULE(growth, tok);
          this.doRULE(growth.m_rules);
          break;

        case 'place_rule':
          if (growth.m_place_rules) this.Unexpected(tok);

          growth.m_place_rules = new RULE(growth, tok);
          this.doRULE(growth.m_place_rules);
          break;

        case 'keepout':
        case 'place_keepout':
        case 'via_keepout':
        case 'wire_keepout':
        case 'bend_keepout':
        case 'elongate_keepout': {
          const keepout = new KEEPOUT(growth, tok);
          growth.m_keepouts.push(keepout);
          this.doKEEPOUT(keepout);
          break;
        }

        default:
          this.Unexpected(this.CurText());
      }
    }
  }

  doPIN(growth: PIN): void {
    let tok = this.NextTok();

    // a m_padstack_id may be a number
    if (!isSymbolTok(tok) && tok !== T.NUMBER) this.Expecting('m_padstack_id');

    growth.m_padstack_id = this.CurText();

    while ((tok = this.NextTok()) !== T.RIGHT) {
      if (tok === T.LEFT) {
        tok = this.NextTok();

        if (tok !== 'rotate') this.Expecting('rotate');

        if (this.NextTok() !== T.NUMBER) this.Expecting(T.NUMBER);

        growth.SetRotation(this.parseDouble());

        this.NeedRIGHT();
      } else {
        if (!isSymbolTok(tok) && tok !== T.NUMBER) this.Expecting('pin_id');

        growth.m_pin_id = this.CurText();

        if (this.NextTok() !== T.NUMBER) this.Expecting(T.NUMBER);

        growth.m_vertex.x = this.parseDouble();

        if (this.NextTok() !== T.NUMBER) this.Expecting(T.NUMBER);

        growth.m_vertex.y = this.parseDouble();
      }
    }
  }

  doLIBRARY(growth: LIBRARY): void {
    let tok: Tok;

    while ((tok = this.NextTok()) !== T.RIGHT) {
      if (tok !== T.LEFT) this.Expecting(T.LEFT);

      tok = this.NextTok();

      switch (tok) {
        case 'unit':
          if (growth.m_unit) this.Unexpected(tok);

          growth.m_unit = new UNIT_RES(growth, tok);
          this.doUNIT(growth.m_unit);
          break;

        case 'padstack': {
          const padstack = new PADSTACK();
          growth.AddPadstack(padstack);
          this.doPADSTACK(padstack);
          break;
        }

        case 'image': {
          const image = new IMAGE(growth);
          growth.m_images.push(image);
          this.doIMAGE(image);
          break;
        }

        default:
          this.Unexpected(this.CurText());
      }
    }
  }

  doNET(growth: NET): void {
    let tok = this.NextTok();
    let pin_refs: PIN_REF[];

    if (!isSymbolTok(tok)) this.Expecting('net_id');

    growth.m_net_id = this.CurText();

    while ((tok = this.NextTok()) !== T.RIGHT) {
      if (tok !== T.LEFT) this.Expecting(T.LEFT);

      tok = this.NextTok();

      let pinList = false;

      switch (tok) {
        case 'unassigned':
          growth.m_unassigned = true;
          this.NeedRIGHT();
          break;

        case 'net_number':
          if (this.NextTok() !== T.NUMBER) this.Expecting(T.NUMBER);

          growth.m_net_number = atoi(this.CurText());
          this.NeedRIGHT();
          break;

        case 'pins':
        case 'order':
          growth.m_pins_type = tok;
          pin_refs = growth.m_pins;
          pinList = true;
          break;

        case 'expose':
          pin_refs = growth.m_expose;
          pinList = true;
          break;

        case 'noexpose':
          pin_refs = growth.m_noexpose;
          pinList = true;
          break;

        case 'source':
          pin_refs = growth.m_source;
          pinList = true;
          break;

        case 'load':
          pin_refs = growth.m_load;
          pinList = true;
          break;

        case 'terminator':
          pin_refs = growth.m_terminator;
          pinList = true;
          break;

        case 'comp_order':
          if (growth.m_comp_order) this.Unexpected(tok);

          growth.m_comp_order = new COMP_ORDER(growth);
          this.doCOMP_ORDER(growth.m_comp_order);
          break;

        case 'type':
          tok = this.NextTok();

          if (tok !== 'fix' && tok !== 'normal') this.Expecting('fix|normal');

          // Upstream assigns this to ELEM::type (`growth->type = tok`), not to m_type.
          growth.type = tok;
          this.NeedRIGHT();
          break;

        case 'circuit':
          break;

        case 'rule':
          if (growth.m_rules) this.Unexpected(tok);

          growth.m_rules = new RULE(growth, 'rule');
          this.doRULE(growth.m_rules);
          break;

        case 'layer_rule': {
          const layer_rule = new LAYER_RULE(growth);
          growth.m_layer_rules.push(layer_rule);
          this.doLAYER_RULE(layer_rule);
          break;
        }

        case 'fromto': {
          const fromto = new FROMTO(growth);
          growth.m_fromtos.push(fromto);
          this.doFROMTO(fromto);
          break;
        }

        default:
          this.Unexpected(this.CurText());
      }

      if (pinList) {
        while ((tok = this.NextTok()) !== T.RIGHT) {
          const pin_ref = new PIN_REF(growth);
          pin_refs!.push(pin_ref);

          const ref = this.readCOMPnPIN();
          pin_ref.component_id = ref.component_id;
          pin_ref.pin_id = ref.pin_id;
        }
      }
    }
  }

  doTOPOLOGY(growth: TOPOLOGY): void {
    let tok: Tok;

    while ((tok = this.NextTok()) !== T.RIGHT) {
      if (tok !== T.LEFT) this.Expecting(T.LEFT);

      tok = this.NextTok();

      switch (tok) {
        case 'fromto': {
          const fromto = new FROMTO(growth);
          growth.m_fromtos.push(fromto);
          this.doFROMTO(fromto);
          break;
        }

        case 'comp_order': {
          const comp_order = new COMP_ORDER(growth);
          growth.m_comp_orders.push(comp_order);
          this.doCOMP_ORDER(comp_order);
          break;
        }

        default:
          this.Unexpected(this.CurText());
      }
    }
  }

  doCLASS(growth: CLASS): void {
    let tok: Tok;

    this.NeedSYMBOL();
    growth.m_class_id = this.CurText();

    // do net_ids, do not support <composite_name_list>s at this time
    while (isSymbolTok((tok = this.NextTok()))) growth.m_net_ids.push(this.CurText());

    while (tok !== T.RIGHT) {
      if (tok !== T.LEFT) this.Expecting(T.LEFT);

      tok = this.NextTok();

      switch (tok) {
        case 'rule':
          if (growth.m_rules) this.Unexpected(tok);

          growth.m_rules = new RULE(growth, 'rule');
          this.doRULE(growth.m_rules);
          break;

        case 'layer_rule': {
          const layer_rule = new LAYER_RULE(growth);
          growth.m_layer_rules.push(layer_rule);
          this.doLAYER_RULE(layer_rule);
          break;
        }

        case 'topology':
          if (growth.m_topology) this.Unexpected(tok);

          growth.m_topology = new TOPOLOGY(growth);
          this.doTOPOLOGY(growth.m_topology);
          break;

        case 'circuit': {
          // handle all the circuit_descriptor here as strings
          let builder = '';
          let bracketNesting = 1; // we already saw the opening T.LEFT
          tok = T.NONE;

          while (bracketNesting !== 0 && tok !== T.EOF) {
            tok = this.NextTok();

            if (tok === T.LEFT) ++bracketNesting;
            else if (tok === T.RIGHT) --bracketNesting;

            if (bracketNesting >= 1) {
              const previousTok = this.PrevTok();

              if (previousTok !== T.LEFT && previousTok !== 'circuit' && tok !== T.RIGHT)
                builder += ' ';

              if (tok === T.STRING) builder += this.m_quote_char;

              builder += this.CurText();

              if (tok === T.STRING) builder += this.m_quote_char;
            }

            // When the nested rule is closed with a T.RIGHT and we are back down
            // to bracketNesting == 0, then save the builder and break;
            if (bracketNesting === 0) {
              growth.m_circuit.push(builder);
              break;
            }
          }

          if (tok === T.EOF) this.Unexpected(T.EOF);

          break;
        }

        default:
          this.Unexpected(this.CurText());
      }

      tok = this.NextTok();
    }
  }

  doNETWORK(growth: NETWORK): void {
    let tok: Tok;

    while ((tok = this.NextTok()) !== T.RIGHT) {
      if (tok !== T.LEFT) this.Expecting(T.LEFT);

      tok = this.NextTok();

      switch (tok) {
        case 'net': {
          const net = new NET(growth);
          growth.m_nets.push(net);
          this.doNET(net);
          break;
        }

        case 'class': {
          const myclass = new CLASS(growth);
          growth.m_classes.push(myclass);
          this.doCLASS(myclass);
          break;
        }

        default:
          this.Unexpected(this.CurText());
      }
    }
  }

  doCOMP_ORDER(growth: COMP_ORDER): void {
    let tok: Tok;

    while (isSymbolTok((tok = this.NextTok()))) growth.m_placement_ids.push(this.CurText());

    if (tok !== T.RIGHT) this.Expecting(T.RIGHT);
  }

  doFROMTO(growth: FROMTO): void {
    let tok: Tok;

    // read the first two grammar items in as 2 single tokens, i.e. do not
    // split apart the <pin_reference>s into 3 separate tokens.  Do this by
    // turning off the string delimiter in the lexer.
    const old = this.lex.SetStringDelimiter('\0');

    if (!isSymbolTok(this.NextTok())) {
      this.lex.SetStringDelimiter(old);
      this.Expecting(T.SYMBOL);
    }

    growth.m_fromText = this.CurText();

    if (!isSymbolTok(this.NextTok())) {
      this.lex.SetStringDelimiter(old);
      this.Expecting(T.SYMBOL);
    }

    growth.m_toText = this.CurText();

    this.lex.SetStringDelimiter(old);

    while ((tok = this.NextTok()) !== T.RIGHT) {
      if (tok !== T.LEFT) this.Expecting(T.LEFT);

      tok = this.NextTok();

      switch (tok) {
        case 'type':
          tok = this.NextTok();

          if (tok !== 'fix' && tok !== 'normal' && tok !== 'soft')
            this.Expecting('fix|normal|soft');

          growth.m_fromto_type = tok;
          this.NeedRIGHT();
          break;

        case 'rule':
          if (growth.m_rules) this.Unexpected(tok);

          growth.m_rules = new RULE(growth, 'rule');
          this.doRULE(growth.m_rules);
          break;

        case 'layer_rule': {
          const layer_rule = new LAYER_RULE(growth);
          growth.m_layer_rules.push(layer_rule);
          this.doLAYER_RULE(layer_rule);
          break;
        }

        case 'net':
          if (growth.m_net_id.length) this.Unexpected(tok);

          this.NeedSYMBOL();
          growth.m_net_id = this.CurText();
          this.NeedRIGHT();
          break;

        // circuit descriptor not supported at this time

        default:
          this.Unexpected(this.CurText());
      }
    }
  }

  doWIRE(growth: WIRE): void {
    let tok: Tok;

    while ((tok = this.NextTok()) !== T.RIGHT) {
      if (tok !== T.LEFT) this.Expecting(T.LEFT);

      tok = this.NextTok();

      if (
        this.keyword(tok) &&
        this.readShapeInto(
          growth,
          tok,
          () => growth.m_shape !== null,
          (s) => {
            growth.m_shape = s;
          },
        )
      )
        continue;

      switch (tok) {
        case 'net':
          this.NeedSYMBOLorNUMBER();
          growth.m_net_id = this.CurText();
          this.NeedRIGHT();
          break;

        case 'turret':
          if (this.NextTok() !== T.NUMBER) this.Expecting(T.NUMBER);

          growth.m_turret = atoi(this.CurText());
          this.NeedRIGHT();
          break;

        case 'type':
          tok = this.NextTok();

          if (tok !== 'fix' && tok !== 'route' && tok !== 'normal' && tok !== 'protect')
            this.Expecting('fix|route|normal|protect');

          growth.m_wire_type = tok;
          this.NeedRIGHT();
          break;

        case 'attr':
          tok = this.NextTok();

          if (tok !== 'test' && tok !== 'fanout' && tok !== 'bus' && tok !== 'jumper')
            this.Expecting('test|fanout|bus|jumper');

          growth.m_attr = tok;
          this.NeedRIGHT();
          break;

        case 'shield':
          this.NeedSYMBOL();
          growth.m_shield = this.CurText();
          this.NeedRIGHT();
          break;

        case 'window': {
          const window = new WINDOW(growth);
          growth.m_windows.push(window);
          this.doWINDOW(window);
          break;
        }

        case 'connect':
          if (growth.m_connect) this.Unexpected(tok);

          growth.m_connect = new CONNECT(growth);
          this.doCONNECT(growth.m_connect);
          break;

        case 'supply':
          growth.m_supply = true;
          this.NeedRIGHT();
          break;

        default:
          this.Unexpected(this.CurText());
      }
    }
  }

  doWIRE_VIA(growth: WIRE_VIA): void {
    let tok: Tok;
    const point = new POINT();

    this.NeedSYMBOL();
    growth.m_padstack_id = this.CurText();

    while ((tok = this.NextTok()) === T.NUMBER) {
      point.x = this.parseDouble();

      if (this.NextTok() !== T.NUMBER) this.Expecting('vertex.y');

      point.y = this.parseDouble();

      growth.m_vertexes.push(point.clone());
    }

    while (tok !== T.RIGHT) {
      if (tok !== T.LEFT) this.Expecting(T.LEFT);

      tok = this.NextTok();

      switch (tok) {
        case 'net':
          this.NeedSYMBOL();
          growth.m_net_id = this.CurText();
          this.NeedRIGHT();
          break;

        case 'via_number':
          if (this.NextTok() !== T.NUMBER) this.Expecting('<via#>');

          growth.m_via_number = atoi(this.CurText());
          this.NeedRIGHT();
          break;

        case 'type':
          tok = this.NextTok();

          if (tok !== 'fix' && tok !== 'route' && tok !== 'normal' && tok !== 'protect')
            this.Expecting('fix|route|normal|protect');

          growth.m_via_type = tok;
          this.NeedRIGHT();
          break;

        case 'attr':
          tok = this.NextTok();

          if (tok !== 'test' && tok !== 'fanout' && tok !== 'jumper' && tok !== 'virtual_pin')
            this.Expecting('test|fanout|jumper|virtual_pin');

          growth.m_attr = tok;

          if (tok === 'virtual_pin') {
            this.NeedSYMBOL();
            growth.m_virtual_pin_name = this.CurText();
          }

          this.NeedRIGHT();
          break;

        case 'contact':
          this.NeedSYMBOL();

          tok = T.SYMBOL;

          while (isSymbolTok(tok)) {
            growth.m_contact_layers.push(this.CurText());
            tok = this.NextTok();
          }

          if (tok !== T.RIGHT) this.Expecting(T.RIGHT);
          break;

        case 'supply':
          growth.m_supply = true;
          this.NeedRIGHT();
          break;

        default:
          this.Unexpected(this.CurText());
      }

      tok = this.NextTok();
    }
  }

  doWIRING(growth: WIRING): void {
    let tok: Tok;

    while ((tok = this.NextTok()) !== T.RIGHT) {
      if (tok !== T.LEFT) this.Expecting(T.LEFT);

      tok = this.NextTok();

      switch (tok) {
        case 'unit':
          if (growth.unit) this.Unexpected(tok);

          growth.unit = new UNIT_RES(growth, tok);
          this.doUNIT(growth.unit);
          break;

        case 'resolution':
          if (growth.unit) this.Unexpected(tok);

          growth.unit = new UNIT_RES(growth, tok);
          this.doRESOLUTION(growth.unit);
          break;

        case 'wire': {
          const wire = new WIRE(growth);
          growth.wires.push(wire);
          this.doWIRE(wire);
          break;
        }

        case 'via': {
          const wire_via = new WIRE_VIA(growth);
          growth.wire_vias.push(wire_via);
          this.doWIRE_VIA(wire_via);
          break;
        }

        default:
          this.Unexpected(this.CurText());
      }
    }
  }

  doANCESTOR(growth: ANCESTOR): void {
    let tok: Tok;

    this.NeedSYMBOL();
    growth.filename = this.CurText();

    while ((tok = this.NextTok()) !== T.RIGHT) {
      if (tok !== T.LEFT) this.Expecting(T.LEFT);

      tok = this.NextTok();

      switch (tok) {
        case 'created_time':
          growth.time_stamp = this.readTIME();
          this.NeedRIGHT();
          break;

        case 'comment':
          this.NeedSYMBOL();
          growth.comment = this.CurText();
          this.NeedRIGHT();
          break;

        default:
          this.Unexpected(this.CurText());
      }
    }
  }

  doHISTORY(growth: HISTORY): void {
    let tok: Tok;

    while ((tok = this.NextTok()) !== T.RIGHT) {
      if (tok !== T.LEFT) this.Expecting(T.LEFT);

      tok = this.NextTok();

      switch (tok) {
        case 'ancestor': {
          const ancestor = new ANCESTOR(growth);
          growth.ancestors.push(ancestor);
          this.doANCESTOR(ancestor);
          break;
        }

        case 'self':
          while ((tok = this.NextTok()) !== T.RIGHT) {
            if (tok !== T.LEFT) this.Expecting(T.LEFT);

            tok = this.NextTok();

            switch (tok) {
              case 'created_time':
                growth.time_stamp = this.readTIME();
                this.NeedRIGHT();
                break;

              case 'comment':
                this.NeedSYMBOL();
                growth.comments.push(this.CurText());
                this.NeedRIGHT();
                break;

              default:
                this.Unexpected(this.CurText());
            }
          }
          break;

        default:
          this.Unexpected(this.CurText());
      }
    }
  }

  doSESSION(growth: SESSION): void {
    let tok: Tok;

    // The path can be defined by multiple tokens if there are spaces in it (e.g. by TopoR).
    this.NeedSYMBOL();

    let fullPath = this.CurText();

    while ((tok = this.NextTok()) !== T.LEFT) fullPath += ` ${this.CurText()}`;

    growth.session_id = fullPath;

    do {
      if (tok !== T.LEFT) this.Expecting(T.LEFT);

      tok = this.NextTok();

      switch (tok) {
        case 'base_design':
          this.NeedSYMBOL();
          growth.base_design = this.CurText();
          this.NeedRIGHT();
          break;

        case 'history':
          if (growth.history) this.Unexpected(tok);

          growth.history = new HISTORY(growth);
          this.doHISTORY(growth.history);
          break;

        case 'structure':
          if (growth.structure) this.Unexpected(tok);

          growth.structure = new STRUCTURE(growth);
          this.doSTRUCTURE(growth.structure);
          break;

        case 'placement':
          if (growth.placement) this.Unexpected(tok);

          growth.placement = new PLACEMENT(growth);
          this.doPLACEMENT(growth.placement);
          break;

        case 'was_is':
          if (growth.was_is) this.Unexpected(tok);

          growth.was_is = new WAS_IS(growth);
          this.doWAS_IS(growth.was_is);
          break;

        case 'routes':
          if (growth.route) this.Unexpected(tok);

          growth.route = new ROUTE(growth);
          this.doROUTE(growth.route);
          break;

        default:
          this.Unexpected(this.CurText());
      }
    } while ((tok = this.NextTok()) !== T.RIGHT);
  }

  doWAS_IS(growth: WAS_IS): void {
    let tok: Tok;

    // none of the pins is ok too
    while ((tok = this.NextTok()) !== T.RIGHT) {
      if (tok !== T.LEFT) this.Expecting(T.LEFT);

      tok = this.NextTok();

      switch (tok) {
        case 'pins': {
          const pin_pair = new PIN_PAIR(growth);
          growth.pin_pairs.push(pin_pair);

          this.NeedSYMBOL(); // readCOMPnPIN() expects 1st token to have been read
          const was = this.readCOMPnPIN();
          pin_pair.was.component_id = was.component_id;
          pin_pair.was.pin_id = was.pin_id;

          this.NeedSYMBOL(); // readCOMPnPIN() expects 1st token to have been read
          const is = this.readCOMPnPIN();
          pin_pair.is.component_id = is.component_id;
          pin_pair.is.pin_id = is.pin_id;

          this.NeedRIGHT();
          break;
        }

        default:
          this.Unexpected(this.CurText());
      }
    }
  }

  doROUTE(growth: ROUTE): void {
    let tok: Tok;

    while ((tok = this.NextTok()) !== T.RIGHT) {
      if (tok !== T.LEFT) this.Expecting(T.LEFT);

      tok = this.NextTok();

      switch (tok) {
        case 'resolution':
          if (growth.resolution) this.Unexpected(tok);

          growth.resolution = new UNIT_RES(growth, tok);
          this.doRESOLUTION(growth.resolution);
          break;

        case 'parser':
          // Electra 2.9.1 emits two (parser ) elements in a row; the second replaces the first.
          growth.parser = new PARSER(growth);
          this.doPARSER(growth.parser);
          break;

        case 'structure_out':
          if (growth.structure_out) this.Unexpected(tok);

          growth.structure_out = new STRUCTURE_OUT(growth);
          this.doSTRUCTURE_OUT(growth.structure_out);
          break;

        case 'library_out':
          if (growth.library) this.Unexpected(tok);

          growth.library = new LIBRARY(growth, tok);
          this.doLIBRARY(growth.library);
          break;

        case 'network_out':
          while ((tok = this.NextTok()) !== T.RIGHT) {
            if (tok !== T.LEFT) this.Expecting(T.LEFT);

            tok = this.NextTok();

            // it is class NET_OUT, but token 'net' in Freerouting
            // Allegro PCB Router (Specctra) uses capitalized "Net"
            if (tok !== 'net') this.Unexpected(this.CurText());

            const net_out = new NET_OUT(growth);
            growth.net_outs.push(net_out);
            this.doNET_OUT(net_out);
          }
          break;

        case 'test_points':
          while ((tok = this.NextTok()) !== T.RIGHT) {
            // TODO: Not supported yet
            this.Unexpected(this.CurText());
          }
          break;

        default:
          this.Unexpected(this.CurText());
      }
    }
  }

  doNET_OUT(growth: NET_OUT): void {
    let tok: Tok;

    this.NeedSYMBOLorNUMBER();
    growth.net_id = this.CurText();

    while ((tok = this.NextTok()) !== T.RIGHT) {
      if (tok !== T.LEFT) this.Expecting(T.LEFT);

      tok = this.NextTok();

      switch (tok) {
        case 'net_number':
          tok = this.NextTok();

          if (tok !== T.NUMBER) this.Expecting(T.NUMBER);

          growth.net_number = atoi(this.CurText());
          this.NeedRIGHT();
          break;

        case 'rule':
          if (growth.rules) this.Unexpected(tok);

          growth.rules = new RULE(growth, tok);
          this.doRULE(growth.rules);
          break;

        case 'wire': {
          const wire = new WIRE(growth);
          growth.wires.push(wire);
          this.doWIRE(wire);
          break;
        }

        case 'via': {
          const wire_via = new WIRE_VIA(growth);
          growth.wire_vias.push(wire_via);
          this.doWIRE_VIA(wire_via);
          break;
        }

        case 'supply_pin': {
          const supply_pin = new SUPPLY_PIN(growth);
          growth.supply_pins.push(supply_pin);
          this.doSUPPLY_PIN(supply_pin);
          break;
        }

        default:
          this.Unexpected(this.CurText());
      }
    }
  }

  doSUPPLY_PIN(growth: SUPPLY_PIN): void {
    let tok: Tok;

    this.NeedSYMBOL();
    growth.net_id = this.CurText();

    while ((tok = this.NextTok()) !== T.RIGHT) {
      if (isSymbolTok(tok)) {
        const pin_ref = new PIN_REF(growth);
        growth.pin_refs.push(pin_ref);

        const ref = this.readCOMPnPIN();
        pin_ref.component_id = ref.component_id;
        pin_ref.pin_id = ref.pin_id;
      } else if (tok === T.LEFT) {
        tok = this.NextTok();

        if (tok !== 'net') this.Expecting('net');

        growth.net_id = this.CurText();
        this.NeedRIGHT();
      } else this.Unexpected(this.CurText());
    }
  }

  /** `ExportPCB`: the DSN text (`m_quote_char[0]` is the quote character). */
  ExportPCB(aNameChange = false, aFilename = ''): string | null {
    if (!this.m_pcb) return null;

    const formatter = new STRING_FORMATTER(this.m_quote_char[0]);

    if (aNameChange) this.m_pcb.m_pcbname = aFilename;

    this.m_pcb.Format(formatter, 0);

    return formatter.GetString();
  }

  /** `ExportSESSION`: the SES text. */
  ExportSESSION(): string | null {
    if (!this.m_session) return null;

    const formatter = new STRING_FORMATTER(this.m_quote_char[0]);

    this.m_session.Format(formatter, 0);

    return formatter.GetString();
  }

  /** `SPECCTRA_DB::MakePCB`. */
  static MakePCB(): PCB {
    const pcb = new PCB();

    pcb.m_parser = new PARSER(pcb);
    pcb.m_resolution = new UNIT_RES(pcb, 'resolution');
    pcb.m_unit = new UNIT_RES(pcb, 'unit');

    pcb.m_structure = new STRUCTURE(pcb);
    pcb.m_structure.m_boundary = new BOUNDARY(pcb.m_structure);
    pcb.m_structure.m_via = new VIA(pcb.m_structure);
    pcb.m_structure.m_rules = new RULE(pcb.m_structure, 'rule');

    pcb.m_placement = new PLACEMENT(pcb);
    pcb.m_library = new LIBRARY(pcb);
    pcb.m_network = new NETWORK(pcb);
    pcb.m_wiring = new WIRING(pcb);

    return pcb;
  }
}
