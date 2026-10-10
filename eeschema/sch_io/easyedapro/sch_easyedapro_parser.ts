// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/sch_io/easyedapro/sch_easyedapro_parser.cpp` / `.h`:
 * `SCH_EASYEDAPRO_PARSER`, EasyEDA (JLCEDA) Pro `.esym` / `.esch` documents -
 * one JSON array per line - into live SCH_* items.
 *
 * `ScaleSize` is `KiROUND( schIUScale.MilsToIU( aValue * 10 ) )` and `MilsToIU`
 * takes an `int`, so `aValue * 10` is truncated first, as in the Std parser.
 *
 * Every `std::map` the C++ walks is walked here in its key order (code point for
 * strings, numeric for the unit ids): the order items are created in decides
 * the order pins and fields are added, which the save writes.
 *
 * Embedded SVG (`OBJ` with image/svg+xml) goes through SVG_IMPORT_PLUGIN into
 * GRAPHICS_IMPORTER_LIB_SYMBOL / GRAPHICS_IMPORTER_SCH upstream; ours of those
 * still build plain records, not live SCH_* items, so the image is reported and
 * left out (see sch_io/easyeda for the same gap).
 */
import {
  type BLOB,
  type SCH_ATTR,
  SCH_ATTR_from_json,
  SCH_COMPONENT_from_json,
  type SCH_COMPONENT,
  SCH_WIRE_from_json,
  type SCH_WIRE,
  type SYM_HEAD,
  SYM_HEAD_from_json,
  type SYM_PIN,
  SYM_PIN_from_json,
  SYMBOL_TYPE,
} from '@ziroeda/common/io/easyedapro/easyedapro_parser.js';
import {
  AnyMapToStringMap,
  ToKiCadLibID,
} from '@ziroeda/common/io/easyedapro/easyedapro_import_utils.js';
import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { schIUScale } from '@ziroeda/common/eda_units.js';
import { FONT } from '@ziroeda/common/font/font.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/font/text_attributes.js';
import { colorFromString } from '@ziroeda/common/gal/color4d.js';
import {
  codePointCompare,
  isArray,
  isNull,
  isNumber,
  isString,
  jAt,
  jMap,
  jNum,
  jInt,
  jStr,
  type JSON_VALUE,
} from '@ziroeda/common/json_common.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { ELECTRICAL_PINTYPE, PIN_ORIENTATION } from '@ziroeda/common/pin_type.js';
import { RPT_SEVERITY_WARNING, type Reporter } from '@ziroeda/common/reporter.js';
import { LINE_STYLE } from '@ziroeda/common/stroke_params.js';
import { UnescapeHTML, wxSplit } from '@ziroeda/common/string_utils.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { base64ToBytes } from '@ziroeda/common/drawing_sheet/ds_bitmap.js';
import { WX_IMAGE } from '@ziroeda/common/wx/wx_image.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { ANGLE_HORIZONTAL, ANGLE_VERTICAL } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { Vec2, VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { ConvertImageToLibShapes } from '../../gfx_import_utils.js';
import { LIB_SYMBOL } from '../../lib_symbol.js';
import { SCH_BITMAP } from '../../sch_bitmap.js';
import { SCH_FIELD } from '../../sch_field.js';
import type { SCH_ITEM } from '../../sch_item.js';
import { LABEL_FLAG_SHAPE, SCH_GLOBALLABEL, SCH_LABEL, SPIN_STYLE } from '../../sch_label.js';
import { SCH_LINE } from '../../sch_line.js';
import { SCH_NO_CONNECT } from '../../sch_no_connect.js';
import { SCH_PIN } from '../../sch_pin.js';
import { SCH_SHAPE } from '../../sch_shape.js';
import type { SCH_SHEET } from '../../sch_sheet.js';
import { SCH_SYMBOL } from '../../sch_symbol.js';
import { SCH_TEXT } from '../../sch_text.js';
import type { SCHEMATIC } from '../../schematic.js';
import { SYMBOL_ORIENTATION_T } from '../../symbol.js';

// clang-format off
const c_attributesWhitelist: readonly string[] = [
  'Value',
  'Datasheet',
  'Manufacturer Part',
  'Manufacturer',
  'BOM_Manufacturer Part',
  'BOM_Manufacturer',
  'Supplier Part',
  'Supplier',
  'BOM_Supplier Part',
  'BOM_Supplier',
  'LCSC Part Name',
];
// clang-format on

export interface PIN_INFO {
  pin: SYM_PIN;
  number: string;
  name: string;
}

export interface SYM_INFO {
  head: SYM_HEAD;
  pins: PIN_INFO[];
  libSymbol: LIB_SYMBOL | null;
  symbolAttr: SCH_ATTR | undefined;
  partUnits: Map<string, number>;
}

/** A text item ApplyFontStyle / ApplyAttrToField handle: a field, a text, a label. */
type TEXT_ITEM = SCH_FIELD | SCH_TEXT;

/** A shape ApplyLineStyle handles. */
type STROKED_ITEM = SCH_SHAPE | SCH_LINE;

/** `std::map<wxString, T>` filled in any order and walked in key order. */
function sortedEntries<T>(m: ReadonlyMap<string, T>): [string, T][] {
  return [...m.entries()].sort((a, b) => codePointCompare(a[0], b[0]));
}

/** `wxString::BeforeFirst`: the whole string when @a c is absent. */
function beforeFirst(s: string, c: string): string {
  const i = s.indexOf(c);
  return i < 0 ? s : s.slice(0, i);
}

/** `wxString::AfterFirst`: empty when @a c is absent. */
function afterFirst(s: string, c: string): string {
  const i = s.indexOf(c);
  return i < 0 ? '' : s.slice(i + 1);
}

/** `wxString::AfterLast`: the whole string when @a c is absent. */
function afterLast(s: string, c: string): string {
  const i = s.lastIndexOf(c);
  return i < 0 ? s : s.slice(i + 1);
}

/** `VECTOR2I( VECTOR2D )`: already whole after ScalePos, truncated like the C++ cast. */
const toI = (v: Vec2): VECTOR2I => ({ x: Math.trunc(v.x), y: Math.trunc(v.y) });

/** `wxString::size()`: UTF-32 characters (wchar_t on Linux). */
const wxLength = (s: string): number => [...s].length;

/** `wxString::ToCDouble`: the whole string, or the value left as it was. */
function ToCDouble(s: string): number | null {
  if (!/^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return null;
  return Number(s);
}

function ConvertStrokeStyle(aStyle: number): LINE_STYLE {
  if (aStyle === 0) return LINE_STYLE.SOLID;
  else if (aStyle === 1) return LINE_STYLE.DASH;
  else if (aStyle === 2) return LINE_STYLE.DOT;
  else if (aStyle === 3) return LINE_STYLE.DASHDOT;

  return LINE_STYLE.DEFAULT;
}

/** `VECTOR2D( line.at( i ), line.at( j ) )`. */
const vecAt = (line: JSON_VALUE, i: number, j: number): Vec2 => ({
  x: jNum(jAt(line, i)),
  y: jNum(jAt(line, j)),
});

/** `std::vector<double> points = line.at( i )`. */
function doublesAt(line: JSON_VALUE, i: number): number[] {
  const v = jAt(line, i);
  if (!isArray(v)) throw new IO_ERROR(`[json.exception.type_error.302] type must be array`);
  return v.map((x) => jNum(x));
}

export class SCH_EASYEDAPRO_PARSER {
  protected m_schematic: SCHEMATIC | null;

  /** Where the importer says what it could not do (upstream: wxLog). */
  m_reporter: Reporter | null = null;

  constructor(aSchematic: SCHEMATIC | null, _aProgressReporter: unknown) {
    this.m_schematic = aSchematic;
  }

  static Convert(aValue: string): number {
    const value = ToCDouble(aValue);

    if (value === null) throw new IO_ERROR(`Failed to parse value: '${aValue}'`);

    return value;
  }

  static ScaleSize(aValue: number): number {
    // `MilsToIU( int mils )`: the double is narrowed to int on the way in.
    return KiROUND(schIUScale.milsToIU(Math.trunc(aValue * 10)));
  }

  static ScaleSizeV(aValue: Vec2): Vec2 {
    return {
      x: SCH_EASYEDAPRO_PARSER.ScaleSize(aValue.x),
      y: SCH_EASYEDAPRO_PARSER.ScaleSize(aValue.y),
    };
  }

  static ScalePos(aValue: Vec2): Vec2 {
    return {
      x: SCH_EASYEDAPRO_PARSER.ScaleSize(aValue.x),
      y: -SCH_EASYEDAPRO_PARSER.ScaleSize(aValue.y),
    };
  }

  static ScalePosSym(aValue: Vec2): Vec2 {
    return {
      x: SCH_EASYEDAPRO_PARSER.ScaleSize(aValue.x),
      y: -SCH_EASYEDAPRO_PARSER.ScaleSize(aValue.y),
    };
  }

  SizeToKi(aValue: string): number {
    return SCH_EASYEDAPRO_PARSER.ScaleSize(SCH_EASYEDAPRO_PARSER.Convert(aValue));
  }

  protected ApplyFontStyle(
    fontStyles: ReadonlyMap<string, JSON_VALUE>,
    text: TEXT_ITEM,
    styleStr: string,
  ): void {
    const style = fontStyles.get(styleStr);

    if (style === undefined) return;

    if (!isArray(style)) return;

    if (style.length < 12) return;

    if (isString(style[3])) text.SetTextColor(colorFromString(style[3]));

    if (isString(style[4])) {
      const fontname = style[4];

      // JLCEDA Pro V3 export to format version V1 specifies Arial explicitly instead of null for default font
      if (fontname !== 'Arial' && fontname.toLowerCase() !== 'default')
        text.SetFont(FONT.GetFont(fontname));
    }

    if (isNumber(style[5])) {
      const size = style[5] * 0.62;
      text.SetTextSize({
        x: SCH_EASYEDAPRO_PARSER.ScaleSize(size),
        y: SCH_EASYEDAPRO_PARSER.ScaleSize(size),
      });
    }

    if (isNumber(style[10])) {
      const valign = jInt(style[10]);

      if (!text.GetText().includes('\n')) {
        if (valign === 0) text.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP);
        else if (valign === 1) text.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER);
        else if (valign === 2) text.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM);
      } else {
        text.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP);
        // TODO: align by first line
      }
    } else {
      text.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM);
    }

    if (isNumber(style[11])) {
      const halign = jInt(style[11]);

      if (halign === 0) text.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT);
      else if (halign === 1) text.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER);
      else if (halign === 2) text.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT);
    } else {
      text.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT);
    }
  }

  protected ApplyLineStyle(
    lineStyles: ReadonlyMap<string, JSON_VALUE>,
    shape: STROKED_ITEM,
    styleStr: string,
  ): void {
    const style = lineStyles.get(styleStr);

    if (style === undefined) return;

    if (!isArray(style)) return;

    if (style.length < 6) return;

    const stroke = shape.GetStroke();

    if (isString(style[2])) {
      const colorStr = style[2];

      if (colorStr !== '' && colorStr.startsWith('#')) stroke.SetColor(colorFromString(colorStr));
    }

    if (isNumber(style[3])) {
      const dashStyle = jInt(style[3]);
      stroke.SetLineStyle(ConvertStrokeStyle(dashStyle));
    }

    if (isNumber(style[5])) {
      const thickness = style[5];
      stroke.SetWidth(SCH_EASYEDAPRO_PARSER.ScaleSize(thickness));
    }

    shape.SetStroke(stroke);
  }

  protected ResolveFieldVariables(
    aInput: string,
    aDeviceAttributes: ReadonlyMap<string, string>,
  ): string {
    // Indexed by UTF-32 character, as wxString is on Linux.
    let inputText = [...aInput];
    let resolvedText = '';
    let variableCount = 0;

    // Resolve variables
    // ={Variable1}text{Variable2}
    do {
      if (!(inputText[0] === '=' && inputText[1] === '{')) return inputText.join('');

      resolvedText = '';
      variableCount = 0;

      for (let i = 1; i < inputText.length; ) {
        let c = inputText[i++]!;

        if (c === '{') {
          let varName = '';
          let endFound = false;

          while (i < inputText.length) {
            c = inputText[i++]!;

            if (c === '}') {
              endFound = true;
              break;
            }

            varName += c;
          }

          if (!endFound) return inputText.join('');

          const varValue = aDeviceAttributes.get(varName) ?? `{${varName}!}`;

          resolvedText += varValue;
          variableCount++;
        } else {
          resolvedText += c;
        }
      }
      inputText = [...resolvedText];
    } while (variableCount > 0);

    return resolvedText;
  }

  protected ApplyAttrToField(
    fontStyles: ReadonlyMap<string, JSON_VALUE>,
    field: SCH_FIELD,
    aAttr: SCH_ATTR,
    aIsSym: boolean,
    _aToSym: boolean,
    aDeviceAttributes: ReadonlyMap<string, string> = new Map(),
    aParent: SCH_SYMBOL | null = null,
  ): void {
    const text = field;

    text.SetText(this.ResolveFieldVariables(aAttr.value, aDeviceAttributes));
    text.SetVisible(aAttr.keyVisible || aAttr.valVisible);

    field.SetNameShown(aAttr.keyVisible);

    if (aAttr.position) {
      field.SetPosition(
        toI(
          !aIsSym
            ? SCH_EASYEDAPRO_PARSER.ScalePos(aAttr.position)
            : SCH_EASYEDAPRO_PARSER.ScalePosSym(aAttr.position),
        ),
      );
    }

    this.ApplyFontStyle(fontStyles, text, aAttr.fontStyle);

    const negV = () => text.SetVertJustify(-text.GetVertJustify() as GR_TEXT_V_ALIGN_T);
    const negH = () => text.SetHorizJustify(-text.GetHorizJustify() as GR_TEXT_H_ALIGN_T);

    const parent = aParent;
    if (parent && parent.Type() === KICAD_T.SCH_SYMBOL_T) {
      const orient = parent.GetOrientation();
      const O = SYMBOL_ORIENTATION_T;

      if (orient === O.SYM_ORIENT_180) {
        negV();
        negH();
      } else if (orient === O.SYM_MIRROR_X + O.SYM_ORIENT_0) {
        negV();
      } else if (orient === O.SYM_MIRROR_Y + O.SYM_ORIENT_0) {
        negH();
      } else if (orient === O.SYM_MIRROR_Y + O.SYM_ORIENT_180) {
        text.SetHorizJustify(text.GetHorizJustify());
      } else if (orient === O.SYM_ORIENT_90) {
        text.SetTextAngle(ANGLE_VERTICAL);
        negV();
        negH();
      }
      if (orient === O.SYM_ORIENT_270) {
        text.SetTextAngle(ANGLE_VERTICAL);
      } else if (orient === O.SYM_MIRROR_X + O.SYM_ORIENT_90) {
        text.SetTextAngle(ANGLE_VERTICAL);
        negV();
        negH();
      } else if (orient === O.SYM_MIRROR_X + O.SYM_ORIENT_270) {
        text.SetTextAngle(ANGLE_VERTICAL);
        negV();
      } else if (orient === O.SYM_MIRROR_Y + O.SYM_ORIENT_90) {
        text.SetTextAngle(ANGLE_VERTICAL);
        negH();
      } else if (orient === O.SYM_MIRROR_Y + O.SYM_ORIENT_270) {
        text.SetHorizJustify(text.GetHorizJustify());
      }

      if (aAttr.rotation === 90) {
        if (text.GetTextAngle().equals(ANGLE_HORIZONTAL)) text.SetTextAngle(ANGLE_VERTICAL);
        else text.SetTextAngle(ANGLE_HORIZONTAL);

        if (orient === O.SYM_ORIENT_90) {
          negV();
          negH();
        }
        if (orient === O.SYM_ORIENT_270) {
          negV();
          negH();
        } else if (orient === O.SYM_MIRROR_X + O.SYM_ORIENT_90) {
          negV();
        }
      }
    }
  }

  /**
   * `OBJ`'s image: `[mimeType, base64]` from a `data:` URL (`data:<mime>;...,<data>`),
   * or from the string form, or nothing.
   */
  private static dataUrl(aUrl: string): { mimeType: string; data: string } {
    let mimeType = '';
    const paramsArr = wxSplit(beforeFirst(afterFirst(aUrl, ':'), ','), ';', '');
    const data = afterFirst(aUrl, ',');

    if (paramsArr.length > 0) mimeType = paramsArr[0]!;

    return { mimeType, data };
  }

  ParseSymbol(
    aLines: readonly JSON_VALUE[],
    aDeviceAttributes: ReadonlyMap<string, string>,
  ): SYM_INFO {
    const symInfo: SYM_INFO = {
      // `SYM_HEAD`'s member defaults.
      head: { origin: { x: 0, y: 0 }, version: '', maxId: 0, symbolType: SYMBOL_TYPE.NORMAL },
      pins: [],
      libSymbol: null,
      symbolAttr: undefined,
      partUnits: new Map(),
    };

    const ksymbol = new LIB_SYMBOL('');

    const lineStyles = new Map<string, JSON_VALUE>();
    const fontStyles = new Map<string, JSON_VALUE>();
    const partUnits = new Map<string, number>();

    const unitAttributes = new Map<number, Map<string, SCH_ATTR>>();
    const unitParentedLines = new Map<number, Map<string, JSON_VALUE[]>>();

    // `std::map::operator[]`: the entry, made empty on first ask.
    const unitAttrs = (u: number): Map<string, SCH_ATTR> => {
      let m = unitAttributes.get(u);
      if (!m) {
        m = new Map();
        unitAttributes.set(u, m);
      }
      return m;
    };
    const unitParented = (u: number, id: string): JSON_VALUE[] => {
      let m = unitParentedLines.get(u);
      if (!m) {
        m = new Map();
        unitParentedLines.set(u, m);
      }
      let v = m.get(id);
      if (!v) {
        v = [];
        m.set(id, v);
      }
      return v;
    };

    let totalUnits = 0;

    for (const line of aLines) {
      const type = jStr(jAt(line, 0));

      if (type === 'LINESTYLE') lineStyles.set(jStr(jAt(line, 1)), line);
      else if (type === 'FONTSTYLE') fontStyles.set(jStr(jAt(line, 1)), line);
      else if (type === 'PART') partUnits.set(jStr(jAt(line, 1)), ++totalUnits);
    }

    symInfo.partUnits = partUnits;
    ksymbol.SetUnitCount(totalUnits, false);

    let currentUnit = 1;

    for (const line of aLines) {
      const type = jStr(jAt(line, 0));

      if (type === 'PART') {
        const u = partUnits.get(jStr(jAt(line, 1)));
        if (u === undefined) throw new IO_ERROR('map::at');
        currentUnit = u;
      } else if (type === 'RECT') {
        const start = vecAt(line, 2, 3);
        const end = vecAt(line, 4, 5);
        const styleStr = jStr(jAt(line, 9));

        const rect = new SCH_SHAPE(SHAPE_T.RECTANGLE, SCH_LAYER_ID.LAYER_DEVICE);

        rect.SetStart(toI(SCH_EASYEDAPRO_PARSER.ScalePosSym(start)));
        rect.SetEnd(toI(SCH_EASYEDAPRO_PARSER.ScalePosSym(end)));

        rect.SetUnit(currentUnit);
        this.ApplyLineStyle(lineStyles, rect, styleStr);

        ksymbol.AddDrawItem(rect);
      } else if (type === 'CIRCLE') {
        const center = vecAt(line, 2, 3);
        const radius = jNum(jAt(line, 4));
        const styleStr = jStr(jAt(line, 5));

        const circle = new SCH_SHAPE(SHAPE_T.CIRCLE, SCH_LAYER_ID.LAYER_DEVICE);

        circle.SetCenter(toI(SCH_EASYEDAPRO_PARSER.ScalePosSym(center)));
        const c = circle.GetCenter();
        circle.SetEnd({ x: c.x + SCH_EASYEDAPRO_PARSER.ScaleSize(radius), y: c.y });

        circle.SetUnit(currentUnit);
        this.ApplyLineStyle(lineStyles, circle, styleStr);

        ksymbol.AddDrawItem(circle);
      } else if (type === 'ARC') {
        const start = vecAt(line, 2, 3);
        const mid = vecAt(line, 4, 5);
        const end = vecAt(line, 6, 7);
        const styleStr = jStr(jAt(line, 8));

        const kstart = SCH_EASYEDAPRO_PARSER.ScalePosSym(start);
        const kmid = SCH_EASYEDAPRO_PARSER.ScalePosSym(mid);
        const kend = SCH_EASYEDAPRO_PARSER.ScalePosSym(end);

        const shape = new SCH_SHAPE(SHAPE_T.ARC, SCH_LAYER_ID.LAYER_DEVICE);

        shape.SetArcGeometry(toI(kstart), toI(kmid), toI(kend));

        shape.SetUnit(currentUnit);
        this.ApplyLineStyle(lineStyles, shape, styleStr);

        ksymbol.AddDrawItem(shape);
      } else if (type === 'BEZIER') {
        const points = doublesAt(line, 2);
        const styleStr = jStr(jAt(line, 3));

        const shape = new SCH_SHAPE(SHAPE_T.BEZIER, SCH_LAYER_ID.LAYER_DEVICE);

        for (let i = 1; i < points.length; i += 2) {
          const pt = toI(SCH_EASYEDAPRO_PARSER.ScalePosSym({ x: points[i - 1]!, y: points[i]! }));

          switch (i) {
            case 1:
              shape.SetStart(pt);
              break;
            case 3:
              shape.SetBezierC1(pt);
              break;
            case 5:
              shape.SetBezierC2(pt);
              break;
            case 7:
              shape.SetEnd(pt);
              break;
          }
        }

        shape.SetUnit(currentUnit);
        this.ApplyLineStyle(lineStyles, shape, styleStr);

        ksymbol.AddDrawItem(shape);
      } else if (type === 'POLY') {
        const points = doublesAt(line, 2);
        const styleStr = jStr(jAt(line, 4));

        const shape = new SCH_SHAPE(SHAPE_T.POLY, SCH_LAYER_ID.LAYER_DEVICE);

        for (let i = 1; i < points.length; i += 2)
          shape.AddPoint(
            toI(SCH_EASYEDAPRO_PARSER.ScalePosSym({ x: points[i - 1]!, y: points[i]! })),
          );

        shape.SetUnit(currentUnit);
        this.ApplyLineStyle(lineStyles, shape, styleStr);

        ksymbol.AddDrawItem(shape);
      } else if (type === 'TEXT') {
        const pos = vecAt(line, 2, 3);
        const angle = isNumber(jAt(line, 4)) ? jNum(jAt(line, 4)) : 0.0;
        const textStr = jStr(jAt(line, 5));
        const fontStyleStr = jStr(jAt(line, 6));

        const text = new SCH_TEXT(
          toI(SCH_EASYEDAPRO_PARSER.ScalePosSym(pos)),
          UnescapeHTML(textStr),
          SCH_LAYER_ID.LAYER_DEVICE,
        );

        text.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT);
        text.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP);
        text.SetTextAngleDegrees(angle);

        text.SetUnit(currentUnit);
        this.ApplyFontStyle(fontStyles, text, fontStyleStr);

        ksymbol.AddDrawItem(text);
      } else if (type === 'OBJ') {
        let start: Vec2 = { x: 0, y: 0 };
        let size: Vec2 = { x: 0, y: 0 };
        let mimeType = '';
        let data = '';
        let upsideDown = 0;

        if (isNumber(jAt(line, 3))) {
          start = vecAt(line, 3, 4);
          size = vecAt(line, 5, 6);
          upsideDown = jInt(jAt(line, 8));

          const imageUrl = jStr(jAt(line, 9));

          if (beforeFirst(imageUrl, ':') === 'data') {
            ({ mimeType, data } = SCH_EASYEDAPRO_PARSER.dataUrl(imageUrl));
          }
        } else if (isString(jAt(line, 3))) {
          mimeType = beforeFirst(jStr(jAt(line, 3)), ';');

          start = vecAt(line, 4, 5);
          size = vecAt(line, 6, 7);
          data = jStr(jAt(line, 9));
        }

        if (mimeType === '' || data === '') continue;

        const buf = base64ToBytes(data);

        if (mimeType === 'image/svg+xml') {
          void upsideDown;
          this.m_reporter?.Report(
            'An embedded SVG image in a symbol was not imported.',
            RPT_SEVERITY_WARNING,
          );
        } else {
          const img = new WX_IMAGE();
          if (img.LoadFile(buf)) {
            const dimMul = img.GetWidth() * img.GetHeight();
            const maxPixels = 30000;

            if (dimMul > maxPixels) {
              const scale = Math.sqrt(maxPixels / dimMul);
              img.Rescale(Math.trunc(img.GetWidth() * scale), Math.trunc(img.GetHeight() * scale));
            }

            const pixelScale: Vec2 = {
              x: SCH_EASYEDAPRO_PARSER.ScaleSize(size.x) / img.GetWidth(),
              y: SCH_EASYEDAPRO_PARSER.ScaleSize(size.y) / img.GetHeight(),
            };

            // TODO: rotation
            ConvertImageToLibShapes(
              ksymbol,
              0,
              img,
              pixelScale,
              SCH_EASYEDAPRO_PARSER.ScalePosSym(start),
            );
          }
        }
      } else if (type === 'HEAD') {
        symInfo.head = SYM_HEAD_from_json(line);
      } else if (type === 'PIN') {
        const pinId = jStr(jAt(line, 1));
        unitParented(currentUnit, pinId).push(line);
      } else if (type === 'ATTR') {
        const parentId = jStr(jAt(line, 2));

        if (parentId === '') {
          const attr = SCH_ATTR_from_json(line);
          // `std::map::emplace`: the first of a key stays.
          const m = unitAttrs(currentUnit);
          if (!m.has(attr.key)) m.set(attr.key, attr);
        } else {
          unitParented(currentUnit, parentId).push(line);
        }
      }
    }

    if (
      symInfo.head.symbolType === SYMBOL_TYPE.POWER_PORT ||
      symInfo.head.symbolType === SYMBOL_TYPE.NETPORT
    ) {
      ksymbol.SetGlobalPower();
      ksymbol.GetReferenceField().SetText('#PWR');
      ksymbol.GetReferenceField().SetVisible(false);
      ksymbol.SetKeyWords('power-flag');
      ksymbol.SetShowPinNames(false);
      ksymbol.SetShowPinNumbers(false);

      const globalNetAttr = unitAttrs(1).get('Global Net Name');

      if (globalNetAttr) {
        this.ApplyAttrToField(fontStyles, ksymbol.GetValueField(), globalNetAttr, true, true);

        const globalNetname = globalNetAttr.value;

        if (globalNetname !== '') {
          ksymbol.SetDescription(
            `Power symbol creates a global label with name '${globalNetname}'`,
          );
        }
      }
    } else {
      const designatorAttr = unitAttrs(1).get('Designator');

      if (designatorAttr && designatorAttr.value !== '') {
        let symbolPrefix = designatorAttr.value;

        if (symbolPrefix.endsWith('?')) symbolPrefix = symbolPrefix.slice(0, -1);

        ksymbol.GetReferenceField().SetText(symbolPrefix);
      }

      for (const attrName of c_attributesWhitelist) {
        const valOpt = aDeviceAttributes.get(attrName);

        if (valOpt !== undefined) {
          if (valOpt === '') continue;

          let fd = ksymbol.FindFieldCaseInsensitive(attrName);

          if (!fd) {
            fd = new SCH_FIELD(ksymbol, FIELD_T.USER, attrName);
            ksymbol.AddField(fd);
          }

          const value = valOpt.replaceAll('℃', '°C'); // ℃ -> °C

          fd.SetText(value);
          fd.SetVisible(false);
        }
      }
    }

    const unitIds = [...unitParentedLines.keys()].sort((a, b) => a - b);

    for (const unitId of unitIds) {
      for (const [, lines] of sortedEntries(unitParentedLines.get(unitId)!)) {
        let epin: SYM_PIN | undefined;
        const pinAttributes = new Map<string, SCH_ATTR>();

        for (const line of lines) {
          const type = jStr(jAt(line, 0));

          if (type === 'ATTR') {
            const attr = SCH_ATTR_from_json(line);
            if (!pinAttributes.has(attr.key)) pinAttributes.set(attr.key, attr);
          } else if (type === 'PIN') {
            epin = SYM_PIN_from_json(line);
          }
        }

        if (!epin) continue;

        const pinInfo: PIN_INFO = { pin: epin, number: '', name: '' };

        const pin = new SCH_PIN(ksymbol);

        pin.SetUnit(unitId);

        pin.SetLength(SCH_EASYEDAPRO_PARSER.ScaleSize(epin.length));
        pin.SetPosition(toI(SCH_EASYEDAPRO_PARSER.ScalePosSym(epin.position)));

        let orient = PIN_ORIENTATION.PIN_RIGHT;

        if (epin.rotation === 0) orient = PIN_ORIENTATION.PIN_RIGHT;
        if (epin.rotation === 90) orient = PIN_ORIENTATION.PIN_UP;
        if (epin.rotation === 180) orient = PIN_ORIENTATION.PIN_LEFT;
        if (epin.rotation === 270) orient = PIN_ORIENTATION.PIN_DOWN;

        pin.SetOrientation(orient);

        if (symInfo.head.symbolType === SYMBOL_TYPE.POWER_PORT) {
          pin.SetName(ksymbol.GetName());
          //pin->SetVisible( false );
        } else {
          let pinNameAttr = pinAttributes.get('Pin Name'); // JLCEDA V3

          if (!pinNameAttr) pinNameAttr = pinAttributes.get('NAME'); // EasyEDA V2

          if (pinNameAttr) {
            pin.SetName(pinNameAttr.value);
            pinInfo.name = pinNameAttr.value;

            if (!pinNameAttr.valVisible) pin.SetNameTextSize(schIUScale.milsToIU(1));
          }
        }

        let pinNumAttr = pinAttributes.get('Pin Number'); // JLCEDA V3

        if (!pinNumAttr) pinNumAttr = pinAttributes.get('NUMBER'); // EasyEDA V2

        if (pinNumAttr) {
          pin.SetNumber(pinNumAttr.value);
          pinInfo.number = pinNumAttr.value;

          if (!pinNumAttr.valVisible) pin.SetNumberTextSize(schIUScale.milsToIU(1));
        }

        if (symInfo.head.symbolType === SYMBOL_TYPE.POWER_PORT) {
          pin.SetType(ELECTRICAL_PINTYPE.PT_POWER_IN);
        } else {
          const pinTypeAttr = pinAttributes.get('Pin Type');

          if (pinTypeAttr) {
            if (pinTypeAttr.value === 'IN') pin.SetType(ELECTRICAL_PINTYPE.PT_INPUT);
            if (pinTypeAttr.value === 'OUT') pin.SetType(ELECTRICAL_PINTYPE.PT_OUTPUT);
            if (pinTypeAttr.value === 'BI') pin.SetType(ELECTRICAL_PINTYPE.PT_BIDI);
          }
        }

        if (pinAttributes.has('NO_CONNECT')) pin.SetType(ELECTRICAL_PINTYPE.PT_NC);

        const numLen = wxLength(pin.GetNumber());

        // `GetLength() / GetNumber().size()`: int over size_t, an unsigned division.
        if (pin.GetNumberTextSize() * numLen > pin.GetLength())
          pin.SetNumberTextSize(Math.trunc(pin.GetLength() / numLen));

        symInfo.pins.push(pinInfo);
        ksymbol.AddDrawItem(pin);
      }
    }

    symInfo.symbolAttr = unitAttrs(1).get('Symbol'); // TODO: per-unit

    symInfo.libSymbol = ksymbol;

    return symInfo;
  }

  ParseSchematic(
    aSchematic: SCHEMATIC,
    aRootSheet: SCH_SHEET,
    aProject: JSON_VALUE,
    aSymbolMap: Map<string, SYM_INFO>,
    aBlobMap: ReadonlyMap<string, BLOB>,
    aLines: readonly JSON_VALUE[],
    aLibName: string,
  ): void {
    const createdItems: SCH_ITEM[] = [];

    const parentedLines = new Map<string, JSON_VALUE[]>();

    const lineStyles = new Map<string, JSON_VALUE>();
    const fontStyles = new Map<string, JSON_VALUE>();

    const parented = (id: string): JSON_VALUE[] => {
      let v = parentedLines.get(id);
      if (!v) {
        v = [];
        parentedLines.set(id, v);
      }
      return v;
    };

    for (const line of aLines) {
      const type = jStr(jAt(line, 0));

      if (type === 'LINESTYLE') lineStyles.set(jStr(jAt(line, 1)), line);
      else if (type === 'FONTSTYLE') fontStyles.set(jStr(jAt(line, 1)), line);
    }

    for (const line of aLines) {
      const type = jStr(jAt(line, 0));

      if (type === 'RECT') {
        const start = vecAt(line, 2, 3);
        const end = vecAt(line, 4, 5);
        const styleStr = jStr(jAt(line, 9));

        const rect = new SCH_SHAPE(SHAPE_T.RECTANGLE);

        rect.SetStart(toI(SCH_EASYEDAPRO_PARSER.ScalePos(start)));
        rect.SetEnd(toI(SCH_EASYEDAPRO_PARSER.ScalePos(end)));

        this.ApplyLineStyle(lineStyles, rect, styleStr);

        createdItems.push(rect);
      } else if (type === 'CIRCLE') {
        const center = vecAt(line, 2, 3);
        const radius = jNum(jAt(line, 4));
        const styleStr = jStr(jAt(line, 5));

        const circle = new SCH_SHAPE(SHAPE_T.CIRCLE);

        circle.SetCenter(toI(SCH_EASYEDAPRO_PARSER.ScalePos(center)));
        const c = circle.GetCenter();
        circle.SetEnd({ x: c.x + SCH_EASYEDAPRO_PARSER.ScaleSize(radius), y: c.y });

        this.ApplyLineStyle(lineStyles, circle, styleStr);

        createdItems.push(circle);
      } else if (type === 'POLY') {
        const points = doublesAt(line, 2);
        const styleStr = jStr(jAt(line, 4));

        const chain = new SHAPE_LINE_CHAIN();

        for (let i = 1; i < points.length; i += 2)
          chain.Append(toI(SCH_EASYEDAPRO_PARSER.ScalePos({ x: points[i - 1]!, y: points[i]! })));

        for (let segId = 0; segId < chain.SegmentCount(); segId++) {
          const seg = chain.CSegment(segId);

          const schLine = new SCH_LINE(seg.A, SCH_LAYER_ID.LAYER_NOTES);
          schLine.SetEndPoint(seg.B);

          this.ApplyLineStyle(lineStyles, schLine, styleStr);

          createdItems.push(schLine);
        }
      } else if (type === 'TEXT') {
        const pos = vecAt(line, 2, 3);
        const angle = isNumber(jAt(line, 4)) ? jNum(jAt(line, 4)) : 0.0;
        const textStr = jStr(jAt(line, 5));
        const fontStyleStr = jStr(jAt(line, 6));

        const text = new SCH_TEXT(toI(SCH_EASYEDAPRO_PARSER.ScalePos(pos)), UnescapeHTML(textStr));

        text.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT);
        text.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP);

        text.SetTextAngleDegrees(angle);

        this.ApplyFontStyle(fontStyles, text, fontStyleStr);

        createdItems.push(text);
      } else if (type === 'OBJ') {
        let start: Vec2 = { x: 0, y: 0 };
        let size: Vec2 = { x: 0, y: 0 };
        let mimeType = '';
        let base64Data = '';
        let angle = 0;
        let flipped = 0;

        if (isNumber(jAt(line, 3))) {
          start = vecAt(line, 3, 4);
          size = vecAt(line, 5, 6);
          angle = jNum(jAt(line, 7));
          flipped = jInt(jAt(line, 8));

          const imageUrl = jStr(jAt(line, 9));

          if (beforeFirst(imageUrl, ':') === 'data') {
            ({ mimeType, data: base64Data } = SCH_EASYEDAPRO_PARSER.dataUrl(imageUrl));
          } else if (beforeFirst(imageUrl, ':') === 'blob') {
            const objectId = afterLast(imageUrl, ':');

            const blob = aBlobMap.get(objectId);

            if (blob) {
              const blobUrl = blob.url;

              if (beforeFirst(blobUrl, ':') === 'data') {
                ({ mimeType, data: base64Data } = SCH_EASYEDAPRO_PARSER.dataUrl(blobUrl));
              }
            }
          }
        } else if (isString(jAt(line, 3))) {
          mimeType = beforeFirst(jStr(jAt(line, 3)), ';');

          start = vecAt(line, 4, 5);
          size = vecAt(line, 6, 7);
          angle = jNum(jAt(line, 8));
          base64Data = jStr(jAt(line, 9));
        }

        const kstart = SCH_EASYEDAPRO_PARSER.ScalePos(start);
        const ksize = SCH_EASYEDAPRO_PARSER.ScaleSizeV(size);

        if (mimeType === '' || base64Data === '') continue;

        const buf = base64ToBytes(base64Data);

        if (mimeType === 'image/svg+xml') {
          this.m_reporter?.Report(
            'An embedded SVG image on the schematic was not imported.',
            RPT_SEVERITY_WARNING,
          );
        } else {
          const bitmap = new SCH_BITMAP();
          const refImage = bitmap.GetReferenceImage();

          if (refImage.ReadImageFile(buf)) {
            const kcenter: Vec2 = { x: kstart.x + ksize.x / 2, y: kstart.y + ksize.y / 2 };

            const scaleFactor = SCH_EASYEDAPRO_PARSER.ScaleSize(size.x) / refImage.GetSize().x;
            refImage.SetImageScale(scaleFactor);
            bitmap.SetPosition(toI(kcenter));

            for (let i = angle; i > 0; i -= 90) bitmap.Rotate(toI(kstart), false);

            if (flipped) bitmap.MirrorHorizontally(toI(kstart).x);

            createdItems.push(bitmap);
          }
        }
      }
      if (type === 'WIRE') {
        const wireId = jStr(jAt(line, 1));
        parented(wireId).push(line);
      } else if (type === 'COMPONENT') {
        const compId = jStr(jAt(line, 1));
        parented(compId).push(line);
      } else if (type === 'ATTR') {
        const compId = jStr(jAt(line, 2));
        parented(compId).push(line);
      }
    }

    for (const [parentId, lines] of sortedEntries(parentedLines)) {
      let component: SCH_COMPONENT | undefined;
      let wire: SCH_WIRE | undefined;
      const attributes = new Map<string, SCH_ATTR>();

      for (const line of lines) {
        const t = jAt(line, 0);

        if (t === 'COMPONENT') {
          component = SCH_COMPONENT_from_json(line);
        } else if (t === 'WIRE') {
          wire = SCH_WIRE_from_json(line);
        } else if (t === 'ATTR') {
          const attr = SCH_ATTR_from_json(line);
          if (!attributes.has(attr.key)) attributes.set(attr.key, attr);
        }
      }

      if (component) {
        const deviceAttr = attributes.get('Device');
        const symbolAttr = attributes.get('Symbol');

        if (!deviceAttr) continue;

        const prjCompAttrs = AnyMapToStringMap(
          jMap(jAt(jAt(jAt(aProject, 'devices'), deviceAttr.value), 'attributes'), (v) => v),
        );

        // Merge attributes, giving priority to schematic attributes over project attributes
        const mergedAttrValues = new Map<string, string>();

        for (const [key, value] of prjCompAttrs) mergedAttrValues.set(key, value);

        for (const [key, attr] of attributes) mergedAttrValues.set(key, attr.value);

        let symbolId: string;

        if (symbolAttr && symbolAttr.value !== '') symbolId = symbolAttr.value;
        else {
          const s = prjCompAttrs.get('Symbol');
          if (s === undefined) throw new IO_ERROR('map::at');
          symbolId = s;
        }

        const esymInfo = aSymbolMap.get(symbolId);
        if (!esymInfo) {
          this.m_reporter?.Report(
            `Symbol of '${component.name}' with uuid '${symbolId}' not found.`,
            RPT_SEVERITY_WARNING,
          );
          continue;
        }

        const newLibSymbol = LIB_SYMBOL.copyOf(esymInfo.libSymbol!);

        const unitName = component.name;

        const libId = ToKiCadLibID(aLibName, newLibSymbol.GetLibId().GetLibItemName());

        // `esymInfo.partUnits[unitName]`: operator[] makes a missing name unit 0.
        let unit = esymInfo.partUnits.get(unitName);
        if (unit === undefined) {
          unit = 0;
          esymInfo.partUnits.set(unitName, unit);
        }

        const schSym = new SCH_SYMBOL(newLibSymbol, libId, aSchematic.CurrentSheet(), unit);

        schSym.SetFootprintFieldText(newLibSymbol.GetFootprint());

        for (let i = component.rotation; i > 0; i -= 90) schSym.Rotate({ x: 0, y: 0 }, true);

        if (component.mirror) schSym.MirrorHorizontally(0);

        schSym.SetPosition(toI(SCH_EASYEDAPRO_PARSER.ScalePos(component.position)));

        if (esymInfo.head.symbolType === SYMBOL_TYPE.POWER_PORT) {
          const valueField = schSym.GetField(FIELD_T.VALUE)!;

          const globalNetNameAttr = attributes.get('Global Net Name');
          const globalNetNameFromProject = prjCompAttrs.get('Global Net Name') ?? '';
          let globalNetName = '';

          // 1. Pick from schematic attr
          // 2. Pick from project.json
          // 3. Pick from symbol
          if (globalNetNameAttr && globalNetNameAttr.value !== '') {
            globalNetName = globalNetNameAttr.value;

            this.ApplyAttrToField(
              fontStyles,
              schSym.GetField(FIELD_T.VALUE)!,
              globalNetNameAttr,
              false,
              true,
              mergedAttrValues,
              schSym,
            );
          } else if (globalNetNameFromProject !== '') {
            globalNetName = globalNetNameFromProject;

            valueField.SetText(this.ResolveFieldVariables(globalNetName, mergedAttrValues));
          } else {
            valueField.SetText(newLibSymbol.GetValueField().GetText());
          }

          for (const pin of schSym.GetAllLibPins()) pin.SetName(globalNetName);

          schSym.SetRef(aSchematic.CurrentSheet(), '#PWR?');
          schSym.GetField(FIELD_T.REFERENCE)!.SetVisible(false);
        } else if (esymInfo.head.symbolType === SYMBOL_TYPE.NETPORT) {
          const nameAttr = attributes.get('Name');

          let netName: string;

          if (nameAttr && nameAttr.value !== '') netName = nameAttr.value;
          else {
            const n = prjCompAttrs.get('Name');
            if (n === undefined) throw new IO_ERROR('map::at');
            netName = n;
          }

          const label = new SCH_GLOBALLABEL(
            toI(SCH_EASYEDAPRO_PARSER.ScalePos(component.position)),
            netName,
          );

          const pins = schSym.GetPins(aSchematic.CurrentSheet());

          if (pins.length > 0) {
            switch (pins[0]!.GetType()) {
              case ELECTRICAL_PINTYPE.PT_INPUT:
                label.SetShape(LABEL_FLAG_SHAPE.L_INPUT);
                break;
              case ELECTRICAL_PINTYPE.PT_OUTPUT:
                label.SetShape(LABEL_FLAG_SHAPE.L_OUTPUT);
                break;
              case ELECTRICAL_PINTYPE.PT_BIDI:
                label.SetShape(LABEL_FLAG_SHAPE.L_BIDI);
                break;
              default:
                break;
            }
          }

          const bbox = schSym.GetBodyAndPinsBoundingBox();
          const sp = schSym.GetPosition();
          bbox.Offset({ x: -sp.x, y: -sp.y });
          const bboxCenter = bbox.GetCenter();

          let spin = new SPIN_STYLE(SPIN_STYLE.LEFT);

          if (Math.abs(bboxCenter.x) >= Math.abs(bboxCenter.y)) {
            if (bboxCenter.x >= 0) spin = new SPIN_STYLE(SPIN_STYLE.RIGHT);
            else spin = new SPIN_STYLE(SPIN_STYLE.LEFT);
          } else {
            if (bboxCenter.y >= 0) spin = new SPIN_STYLE(SPIN_STYLE.BOTTOM);
            else spin = new SPIN_STYLE(SPIN_STYLE.UP);
          }

          label.SetSpinStyle(spin);

          if (nameAttr) {
            // `fontStyles[nameAttr->fontStyle]`: operator[] yields null for a missing style.
            const style = fontStyles.get(nameAttr.fontStyle) ?? null;

            if (!isNull(style) && isNumber(jAt(style, 5))) {
              const size = jNum(jAt(style, 5)) * 0.62;
              label.SetTextSize({
                x: SCH_EASYEDAPRO_PARSER.ScaleSize(size),
                y: SCH_EASYEDAPRO_PARSER.ScaleSize(size),
              });
            }
          }

          createdItems.push(label);

          continue;
        } else {
          for (const attrKey of c_attributesWhitelist) {
            const valOpt = mergedAttrValues.get(attrKey);

            if (valOpt !== undefined) {
              if (valOpt === '') continue;

              let text = schSym.FindFieldCaseInsensitive(attrKey);

              if (!text) text = schSym.AddField(new SCH_FIELD(schSym, FIELD_T.USER, attrKey));

              const value = valOpt.replaceAll('℃', '°C'); // ℃ -> °C

              text.SetText(value);
              text.SetVisible(false);
            }
          }

          const nameAttr = attributes.get('Name');
          const valueAttr = attributes.get('Value');

          if (valueAttr && valueAttr.value === '')
            valueAttr.value = prjCompAttrs.get('Value') ?? '';

          if (nameAttr && nameAttr.value === '') nameAttr.value = prjCompAttrs.get('Name') ?? '';

          let targetValueAttr: SCH_ATTR | undefined;

          if (valueAttr && valueAttr.value !== '' && valueAttr.valVisible)
            targetValueAttr = valueAttr;
          else if (nameAttr && nameAttr.value !== '' && nameAttr.valVisible)
            targetValueAttr = nameAttr;
          else if (valueAttr && valueAttr.value !== '') targetValueAttr = valueAttr;
          else if (nameAttr && nameAttr.value !== '') targetValueAttr = nameAttr;

          if (targetValueAttr) {
            this.ApplyAttrToField(
              fontStyles,
              schSym.GetField(FIELD_T.VALUE)!,
              targetValueAttr,
              false,
              true,
              mergedAttrValues,
              schSym,
            );
          }

          const descrAttr = attributes.get('Description');

          if (descrAttr) {
            this.ApplyAttrToField(
              fontStyles,
              schSym.GetField(FIELD_T.DESCRIPTION)!,
              descrAttr,
              false,
              true,
              mergedAttrValues,
              schSym,
            );
          }

          const designatorAttr = attributes.get('Designator');

          if (designatorAttr) {
            this.ApplyAttrToField(
              fontStyles,
              schSym.GetField(FIELD_T.REFERENCE)!,
              designatorAttr,
              false,
              true,
              mergedAttrValues,
              schSym,
            );

            schSym.SetRef(aSchematic.CurrentSheet(), designatorAttr.value);
          }

          for (const [attrKey, attr] of sortedEntries(attributes)) {
            if (
              attrKey === 'Name' ||
              attrKey === 'Value' ||
              attrKey === 'Global Net Name' ||
              attrKey === 'Designator' ||
              attrKey === 'Description' ||
              attrKey === 'Device' ||
              attrKey === 'Footprint' ||
              attrKey === 'Symbol' ||
              attrKey === 'Unique ID'
            ) {
              continue;
            }

            if (attr.value === '') continue;

            let text = schSym.FindFieldCaseInsensitive(attrKey);

            if (!text) text = schSym.AddField(new SCH_FIELD(schSym, FIELD_T.USER, attrKey));

            text.SetPosition(schSym.GetPosition());

            this.ApplyAttrToField(fontStyles, text, attr, false, true, mergedAttrValues, schSym);
          }
        }

        for (const pinInfo of esymInfo.pins) {
          const pinKey = parentId + pinInfo.pin.id;
          const pinLines = parentedLines.get(pinKey);

          if (!pinLines) continue;

          for (const pinLine of pinLines) {
            if (jAt(pinLine, 0) !== 'ATTR') continue;

            const attr = SCH_ATTR_from_json(pinLine);

            if (attr.key !== 'NO_CONNECT') continue;

            for (const schPin of schSym.GetPinsByNumber(pinInfo.number)) {
              const pos = schSym.GetPinPhysicalPosition(schPin.GetLibPin());

              const noConn = new SCH_NO_CONNECT(pos);

              createdItems.push(noConn);
            }
          }
        }

        createdItems.push(schSym);
      } // Not component
      else {
        const wireLines: SHAPE_LINE_CHAIN[] = [];

        if (wire) {
          for (const ptArr of wire.geometry) {
            const chain = new SHAPE_LINE_CHAIN();

            for (let i = 1; i < ptArr.length; i += 2)
              chain.Append(toI(SCH_EASYEDAPRO_PARSER.ScalePos({ x: ptArr[i - 1]!, y: ptArr[i]! })));

            if (chain.PointCount() < 2) continue;

            wireLines.push(chain);

            for (let segId = 0; segId < chain.SegmentCount(); segId++) {
              const seg = chain.CSegment(segId);

              const schLine = new SCH_LINE(seg.A, SCH_LAYER_ID.LAYER_WIRE);
              schLine.SetEndPoint(seg.B);

              createdItems.push(schLine);
            }
          }
        }

        const netAttr = attributes.get('NET');

        if (netAttr) {
          if (!netAttr.valVisible || netAttr.value === '') continue;

          const kpos = toI(SCH_EASYEDAPRO_PARSER.ScalePos(netAttr.position!));
          let nearestPos = kpos;
          let min_dist_sq = Number.MAX_VALUE;

          for (const chain of wireLines) {
            const nearestPt = chain.NearestPoint(kpos, false);
            const dx = nearestPt.x - kpos.x;
            const dy = nearestPt.y - kpos.y;
            const dist_sq = dx * dx + dy * dy;

            if (dist_sq < min_dist_sq) {
              min_dist_sq = dist_sq;
              nearestPos = nearestPt;
            }
          }

          const label = new SCH_LABEL();

          label.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT);
          label.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM);

          for (let i = netAttr.rotation; i > 0; i -= 90) label.Rotate90(true);

          label.SetPosition(nearestPos);
          label.SetText(netAttr.value);

          this.ApplyFontStyle(fontStyles, label, netAttr.fontStyle);

          createdItems.push(label);
        }
      }
    }

    // Adjust page to content
    const sheetBBox = new BOX2I();

    for (const ptr of createdItems) {
      if (ptr.Type() === KICAD_T.SCH_SYMBOL_T)
        sheetBBox.Merge((ptr as unknown as SCH_SYMBOL).GetBodyAndPinsBoundingBox());
      else sheetBBox.Merge(ptr.GetBoundingBox());
    }

    const screen = aRootSheet.GetScreen()!;
    const pageInfo = screen.GetPageSettings();

    const alignGrid = schIUScale.milsToIU(50);

    const offset = { x: -sheetBBox.GetLeft(), y: -sheetBBox.GetTop() };
    offset.x = KiROUND(offset.x / alignGrid) * alignGrid;
    offset.y = KiROUND(offset.y / alignGrid) * alignGrid;

    pageInfo.SetWidthMils(schIUScale.iuToMils(sheetBBox.GetWidth()));
    pageInfo.SetHeightMils(schIUScale.iuToMils(sheetBBox.GetHeight()));

    screen.SetPageSettings(pageInfo);

    for (const ptr of createdItems) {
      ptr.Move(toI(offset));
      screen.Append(ptr);
    }
  }
}
