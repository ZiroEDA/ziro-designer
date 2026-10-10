// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/sch_io/easyeda/sch_easyeda_parser.cpp` / `.h`: `SCH_EASYEDA_PARSER`,
 * EasyEDA (JLCEDA) Std schematic shapes into live SCH_* items.
 *
 * Arithmetic is C++'s, conversion for conversion. Where the C++ builds a
 * `VECTOR2I` from doubles (`VECTOR2I( Convert( a ), Convert( b ) )`) the
 * coordinates are truncated toward zero before anything else touches them;
 * where it keeps a `VECTOR2D` they are not. `ScaleSize` is
 * `KiROUND( schIUScale.MilsToIU( aValue * 10 ) )` and `MilsToIU` takes an
 * `int`, so `aValue * 10` is truncated first.
 */
import { EASYEDA_PARSER_BASE } from '@ziroeda/common/io/easyeda/easyeda_parser_base.js';
import { POWER_FLAG_STYLE } from '@ziroeda/common/io/easyeda/easyeda_parser_structs.js';
import { FILL_T, SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { schIUScale } from '@ziroeda/common/eda_units.js';
import { ENDPOINT, STARTPOINT } from '@ziroeda/common/eda_item_flags.js';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { FONT } from '@ziroeda/common/font/font.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/font/text_attributes.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { ELECTRICAL_PINTYPE, PIN_ORIENTATION } from '@ziroeda/common/pin_type.js';
import { RPT_SEVERITY_WARNING, type Reporter } from '@ziroeda/common/reporter.js';
import { LINE_STYLE, STROKE_PARAMS } from '@ziroeda/common/stroke_params.js';
import {
  ESCAPE_CONTEXT,
  EscapeString,
  UnescapeHTML,
  wxSplit,
} from '@ziroeda/common/string_utils.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { base64ToBytes } from '@ziroeda/common/drawing_sheet/ds_bitmap.js';
import { WX_IMAGE } from '@ziroeda/common/wx/wx_image.js';
import { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import { ResizeD, type Vec2, type VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { ConvertImageToLibShapes } from '../../gfx_import_utils.js';
import { LIB_SYMBOL } from '../../lib_symbol.js';
import { SCH_BITMAP } from '../../sch_bitmap.js';
import { SCH_FIELD } from '../../sch_field.js';
import type { SCH_ITEM } from '../../sch_item.js';
import { SCH_JUNCTION } from '../../sch_junction.js';
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

/** `wxSplit( s, c, '\0' )`. */
const split = (s: string, c: string): string[] => wxSplit(s, c, '');

/** `wxArrayString[i]`, '' past the end (the C++ indexes without a check). */
const at = (a: readonly string[], i: number): string => a[i] ?? '';

/** `VECTOR2I( double, double )`: each coordinate converted to int, truncating. */
const V2I = (x: number, y: number): VECTOR2I => ({ x: Math.trunc(x), y: Math.trunc(y) });

/** `MilsToIU( int )` on a constant. */
const mils = (v: number): number => schIUScale.milsToIU(v);

/** `std::map::find` / `get_opt` on a parameter map. */
const get_opt = (m: ReadonlyMap<string, string>, k: string): string | undefined => m.get(k);

/**
 * `RegexMatchAll`: every match, each the whole match and its groups, taking
 * the next match from where the last one ended.
 */
function RegexMatchAll(aRegex: RegExp, aString: string): string[][] {
  const allMatches: string[][] = [];
  const re = new RegExp(
    aRegex.source,
    aRegex.flags.includes('g') ? aRegex.flags : `${aRegex.flags}g`,
  );

  for (const m of aString.matchAll(re)) allMatches.push([...m].map((g) => g ?? ''));

  return allMatches;
}

/** `wxString::ToCDouble`: the whole string, or the value left as it was. */
function ToCDouble(s: string): number | null {
  const t = s.trim();
  if (t === '' || !/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return null;
  return Number(t);
}

/**
 * EasyEDA image transformations are in the form of:
 *
 * scale(1,-1) translate(-555,1025) rotate(270,425,-785)
 *
 * Order of operations is from end to start, similar to CSS.
 */
function ParseImageTransform(transformData: string): [string, number[]][] {
  const transformRegex = /(rotate|translate|scale)\(([\w\s,.-]*)\)/i;
  const allMatches = RegexMatchAll(transformRegex, transformData);

  const transformCmds: [string, number[]][] = [];

  for (let cmdId = allMatches.length - 1; cmdId >= 0; cmdId--) {
    const groups = allMatches[cmdId]!;

    if (groups.length !== 3) continue;

    const cmdName = groups[1]!.trim().toLowerCase();
    const cmdArgsStr = groups[2]!;

    const cmdParts = split(cmdArgsStr, ',');
    const cmdArgs: number[] = [];

    for (const cmdPart of cmdParts) {
      let arg = 0;
      const v = ToCDouble(cmdPart);
      if (v !== null) arg = v;

      cmdArgs.push(arg);
    }

    transformCmds.push([cmdName, cmdArgs]);
  }

  return transformCmds;
}

function EasyEdaToKiCadLibID(aLibName: string, aLibReference: string): LIB_ID {
  const libReference = EscapeString(aLibReference, ESCAPE_CONTEXT.CTX_LIBID);

  const key = aLibName !== '' ? `${aLibName}:${libReference}` : libReference;

  const libId = new LIB_ID();
  libId.Parse(key, true);

  return libId;
}

function ConvertStrokeStyle(aStyle: string): LINE_STYLE {
  if (aStyle === '0') return LINE_STYLE.SOLID;
  else if (aStyle === '1') return LINE_STYLE.DASH;
  else if (aStyle === '2') return LINE_STYLE.DOT;

  return LINE_STYLE.DEFAULT;
}

function ConvertElecType(aType: string): ELECTRICAL_PINTYPE {
  if (aType === '0') return ELECTRICAL_PINTYPE.PT_UNSPECIFIED;
  else if (aType === '1') return ELECTRICAL_PINTYPE.PT_INPUT;
  else if (aType === '2') return ELECTRICAL_PINTYPE.PT_OUTPUT;
  else if (aType === '3') return ELECTRICAL_PINTYPE.PT_BIDI;
  else if (aType === '4') return ELECTRICAL_PINTYPE.PT_PASSIVE;

  return ELECTRICAL_PINTYPE.PT_UNSPECIFIED;
}

/** `SCH_SHAPE( SHAPE_T::POLY, LAYER_DEVICE )` with a 10 mil solid stroke and these points. */
function polyline(aPoints: readonly VECTOR2I[], aWidthMils = 10): SCH_SHAPE {
  const line = new SCH_SHAPE(SHAPE_T.POLY, SCH_LAYER_ID.LAYER_DEVICE);
  line.SetStroke(new STROKE_PARAMS(mils(aWidthMils), LINE_STYLE.SOLID));
  for (const p of aPoints) line.AddPoint(p);
  return line;
}

const P = (x: number, y: number): VECTOR2I => ({ x: mils(x), y: mils(y) });

export function HelperGeneratePowerPortGraphics(
  aKsymbol: LIB_SYMBOL,
  aStyle: POWER_FLAG_STYLE,
  aReporter: Reporter | null,
): VECTOR2I {
  if (aStyle === POWER_FLAG_STYLE.CIRCLE || aStyle === POWER_FLAG_STYLE.ARROW) {
    aKsymbol.AddDrawItem(
      polyline([
        { x: 0, y: 0 },
        { x: 0, y: mils(50) },
      ]),
      false,
    );

    if (aStyle === POWER_FLAG_STYLE.CIRCLE) {
      const circle = new SCH_SHAPE(SHAPE_T.CIRCLE, SCH_LAYER_ID.LAYER_DEVICE);
      circle.SetStroke(new STROKE_PARAMS(mils(5), LINE_STYLE.SOLID));
      circle.SetPosition({ x: mils(0), y: mils(75) });
      const pos = circle.GetPosition();
      circle.SetEnd({ x: pos.x + mils(25), y: pos.y });
      aKsymbol.AddDrawItem(circle, false);
    } else {
      aKsymbol.AddDrawItem(polyline([P(-25, 50), P(25, 50), P(0, 100), P(-25, 50)]), false);
    }

    return { x: 0, y: mils(150) };
  } else if (aStyle === POWER_FLAG_STYLE.WAVE) {
    aKsymbol.AddDrawItem(
      polyline([
        { x: 0, y: 0 },
        { x: 0, y: mils(72) },
      ]),
      false,
    );

    const bezier = new SCH_SHAPE(SHAPE_T.BEZIER, SCH_LAYER_ID.LAYER_DEVICE);
    bezier.SetStroke(new STROKE_PARAMS(mils(5), LINE_STYLE.SOLID));
    bezier.SetStart(P(30, 50));
    bezier.SetBezierC1(P(30, 87));
    bezier.SetBezierC2(P(-30, 63));
    bezier.SetEnd(P(-30, 100));
    aKsymbol.AddDrawItem(bezier, false);

    return { x: 0, y: mils(150) };
  } else if (
    aStyle === POWER_FLAG_STYLE.POWER_GROUND ||
    aStyle === POWER_FLAG_STYLE.SIGNAL_GROUND ||
    aStyle === POWER_FLAG_STYLE.EARTH ||
    aStyle === POWER_FLAG_STYLE.GOST_ARROW
  ) {
    aKsymbol.AddDrawItem(
      polyline([
        { x: 0, y: 0 },
        { x: 0, y: mils(100) },
      ]),
      false,
    );

    if (aStyle === POWER_FLAG_STYLE.POWER_GROUND) {
      aKsymbol.AddDrawItem(polyline([P(-100, 100), P(100, 100)]), false);
      aKsymbol.AddDrawItem(polyline([P(-70, 120), P(70, 120)]), false);
      aKsymbol.AddDrawItem(polyline([P(-40, 140), P(40, 140)]), false);
      aKsymbol.AddDrawItem(polyline([P(-10, 160), P(10, 160)]), false);
    } else if (aStyle === POWER_FLAG_STYLE.SIGNAL_GROUND) {
      aKsymbol.AddDrawItem(polyline([P(-100, 100), P(100, 100), P(0, 160), P(-100, 100)]), false);
    } else if (aStyle === POWER_FLAG_STYLE.EARTH) {
      aKsymbol.AddDrawItem(polyline([P(-150, 200), P(-100, 100), P(100, 100), P(50, 200)]), false);
      aKsymbol.AddDrawItem(polyline([P(0, 100), P(-50, 200)]), false);
    } // POWER_FLAG_STYLE::GOST_ARROW
    else {
      aKsymbol.AddDrawItem(polyline([P(-25, 50), P(0, 100), P(25, 50)]), false);

      return { x: 0, y: mils(150) }; // special case
    }

    return { x: 0, y: mils(250) };
  } else if (
    aStyle === POWER_FLAG_STYLE.GOST_POWER_GROUND ||
    aStyle === POWER_FLAG_STYLE.GOST_EARTH
  ) {
    aKsymbol.AddDrawItem(
      polyline([
        { x: 0, y: 0 },
        { x: 0, y: mils(160) },
      ]),
      false,
    );
    aKsymbol.AddDrawItem(polyline([P(-100, 160), P(100, 160)]), false);
    aKsymbol.AddDrawItem(polyline([P(-60, 200), P(60, 200)]), false);
    aKsymbol.AddDrawItem(polyline([P(-20, 240), P(20, 240)]), false);

    if (aStyle === POWER_FLAG_STYLE.GOST_POWER_GROUND) return { x: 0, y: mils(-300) };

    const circle = new SCH_SHAPE(SHAPE_T.CIRCLE, SCH_LAYER_ID.LAYER_DEVICE);
    circle.SetStroke(new STROKE_PARAMS(mils(10), LINE_STYLE.SOLID));
    circle.SetPosition({ x: mils(0), y: mils(160) });
    const pos = circle.GetPosition();
    circle.SetEnd({ x: pos.x + mils(120), y: pos.y });
    aKsymbol.AddDrawItem(circle, false);

    return { x: 0, y: mils(350) };
  } else if (aStyle === POWER_FLAG_STYLE.GOST_BAR) {
    aKsymbol.AddDrawItem(
      polyline([
        { x: 0, y: 0 },
        { x: 0, y: mils(200) },
      ]),
      false,
    );
    aKsymbol.AddDrawItem(polyline([P(-100, 200), P(100, 200)]), false);

    return { x: 0, y: mils(250) };
  } else {
    if (aStyle !== POWER_FLAG_STYLE.BAR) {
      aReporter?.Report(
        "Power Port with unknown style imported as 'Bar' type.",
        RPT_SEVERITY_WARNING,
      );
    }

    aKsymbol.AddDrawItem(
      polyline([
        { x: 0, y: 0 },
        { x: 0, y: mils(100) },
      ]),
      false,
    );
    aKsymbol.AddDrawItem(polyline([P(-50, 100), P(50, 100)]), false);

    return { x: 0, y: mils(150) };
  }
}

/** The fill a shape takes from its stroke and fill colours (`fillColor != "none"`). */
function setFill(aShape: SCH_SHAPE, aFillColor: string, aStrokeColor: string): void {
  if (aFillColor !== 'none') {
    aShape.SetFilled(true);

    if (aFillColor === aStrokeColor) aShape.SetFillMode(FILL_T.FILLED_SHAPE);
    else aShape.SetFillMode(FILL_T.FILLED_WITH_BG_BODYCOLOR);
  }
}

export class SCH_EASYEDA_PARSER extends EASYEDA_PARSER_BASE {
  private m_schematic: SCHEMATIC | null;
  /** Where the import's warnings go (upstream's `LOAD_INFO_REPORTER` / the plugin's reporter). */
  m_reporter: Reporter | null = null;

  constructor(aSchematic: SCHEMATIC | null, _aProgressReporter: unknown = null) {
    super();
    this.m_schematic = aSchematic;
  }

  override ScaleSize(aValue: number): number {
    // `MilsToIU( int mils )`: the double is narrowed to int on the way in.
    return KiROUND(schIUScale.milsToIU(Math.trunc(aValue * 10)));
  }

  RelPosSym(aVec: Vec2): Vec2 {
    return { x: this.RelPosX(aVec.x), y: this.RelPosY(aVec.y) };
  }

  MakePowerSymbol(aFlagTypename: string, aNetname: string): [LIB_SYMBOL, boolean] {
    const ksymbol = new LIB_SYMBOL('');

    this.m_relOrigin = { x: 0, y: 0 };

    const libId = EasyEdaToKiCadLibID('', aNetname);

    ksymbol.SetGlobalPower();
    ksymbol.SetLibId(libId);
    ksymbol.SetName(aNetname);
    ksymbol.GetReferenceField().SetText('#PWR');
    ksymbol.GetReferenceField().SetVisible(false);
    ksymbol.GetValueField().SetText(aNetname);
    ksymbol.GetValueField().SetVisible(true);
    ksymbol.SetDescription(`Power symbol creates a global label with name '${aNetname}'`);
    ksymbol.SetKeyWords('power-flag');
    ksymbol.SetShowPinNames(false);
    ksymbol.SetShowPinNumbers(false);

    const pin = new SCH_PIN(ksymbol);

    pin.SetName(aNetname);
    pin.SetNumber('1');
    pin.SetOrientation(PIN_ORIENTATION.PIN_DOWN);
    pin.SetType(ELECTRICAL_PINTYPE.PT_POWER_IN);
    pin.SetLength(0);

    ksymbol.AddDrawItem(pin);

    let flagStyle = POWER_FLAG_STYLE.POWER_GROUND;

    let flip = false;

    if (aFlagTypename === 'part_netLabel_gnD') {
      flagStyle = POWER_FLAG_STYLE.POWER_GROUND;
    } else if (aFlagTypename === 'part_netLabel_GNd') {
      flagStyle = POWER_FLAG_STYLE.SIGNAL_GROUND;
    } else if (aFlagTypename === 'part_netLabel_gNd') {
      flagStyle = POWER_FLAG_STYLE.BAR;
    } else if (aFlagTypename === 'part_netLabel_GnD') {
      flagStyle = POWER_FLAG_STYLE.EARTH;
    } else if (aFlagTypename === 'part_netLabel_VCC') {
      flagStyle = POWER_FLAG_STYLE.BAR;
      flip = true;
    } else if (aFlagTypename === 'part_netLabel_+5V') {
      flagStyle = POWER_FLAG_STYLE.BAR;
      flip = true;
    } else if (aFlagTypename === 'part_netLabel_VEE') {
      flagStyle = POWER_FLAG_STYLE.BAR;
    } else if (aFlagTypename === 'part_netLabel_-5V') {
      flagStyle = POWER_FLAG_STYLE.BAR;
    } else if (aFlagTypename === 'part_netLabel_Bar') {
      flagStyle = POWER_FLAG_STYLE.CIRCLE;
      flip = true;
    }

    const valueFieldPos = HelperGeneratePowerPortGraphics(ksymbol, flagStyle, null);
    ksymbol.GetValueField().SetPosition(valueFieldPos);

    return [ksymbol, flip];
  }

  ParseSymbolShapes(
    aSymbol: LIB_SYMBOL,
    _paramMap: ReadonlyMap<string, string>,
    aShapes: readonly string[],
  ): void {
    for (const shapeStr of aShapes) {
      const arr = split(shapeStr, '~');

      const elType = at(arr, 0);
      if (elType === 'PL' || elType === 'PG') {
        const ptArr = split(at(arr, 1), ' ');
        const strokeColor = at(arr, 2);
        const lineWidth = this.Convert(at(arr, 3));
        const strokeStyle = ConvertStrokeStyle(at(arr, 4));
        const fillColor = at(arr, 5).toLowerCase();

        const chain = new SHAPE_LINE_CHAIN();

        for (let i = 1; i < ptArr.length; i += 2) {
          chain.Append(
            V2I(...this.relPosSymXY(V2I(this.Convert(ptArr[i - 1]!), this.Convert(ptArr[i]!)))),
          );
        }

        const line = new SCH_SHAPE(SHAPE_T.POLY, SCH_LAYER_ID.LAYER_DEVICE);

        if (elType === 'PG') chain.SetClosed(true);

        if (chain.PointCount() < 2) continue;

        for (let i = 0; i < chain.PointCount(); i++) line.AddPoint(chain.CPoint(i));

        if (chain.IsClosed()) line.AddPoint(chain.CPoint(0));

        line.SetUnit(0);
        line.SetStroke(new STROKE_PARAMS(this.ScaleSize(lineWidth), strokeStyle));

        setFill(line, fillColor, strokeColor);

        aSymbol.AddDrawItem(line);
      } else if (elType === 'PT') {
        // Freedraw
        const pointsData = at(arr, 1);
        const strokeColor = at(arr, 2);
        const lineWidth = this.Convert(at(arr, 3));
        const strokeStyle = ConvertStrokeStyle(at(arr, 4));
        const fillColor = at(arr, 5).toLowerCase();

        const lineChains = this.ParseLineChains(pointsData, mils(10), false);

        for (const outline of lineChains) {
          const shape = new SCH_SHAPE(SHAPE_T.POLY, SCH_LAYER_ID.LAYER_DEVICE);

          if (outline.IsClosed()) outline.Append(outline.CPoint(0), true);

          for (const pt of outline.CPoints()) shape.AddPoint(pt);

          shape.SetUnit(0);
          shape.SetStroke(new STROKE_PARAMS(this.ScaleSize(lineWidth), strokeStyle));

          setFill(shape, fillColor, strokeColor);

          aSymbol.AddDrawItem(shape);
        }
      } else if (elType === 'Pimage') {
        const start: Vec2 = { x: this.Convert(at(arr, 6)), y: this.Convert(at(arr, 7)) };
        const size: Vec2 = { x: this.Convert(at(arr, 8)), y: this.Convert(at(arr, 9)) };
        const imageUrl = at(arr, 10);

        if (beforeFirst(imageUrl, ':') === 'data') {
          const paramsArr = split(beforeFirst(afterFirst(imageUrl, ':'), ','), ';');

          const data = afterFirst(imageUrl, ',');

          if (paramsArr.length > 0) {
            const mimeType = paramsArr[0]!;
            const buf = base64ToBytes(data);

            if (mimeType === 'image/svg+xml') {
              // GRAPHICS_IMPORTER_LIB_SYMBOL here builds plain-data records, not live SCH_*
              // items, and a record-to-live conversion is the bridge this port refuses. Until
              // import_gfx is on the live classes, the image is reported and left out.
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
                  img.Rescale(
                    Math.trunc(img.GetWidth() * scale),
                    Math.trunc(img.GetHeight() * scale),
                  );
                }

                const pixelScale: Vec2 = {
                  x: this.ScaleSize(size.x) / img.GetWidth(),
                  y: this.ScaleSize(size.y) / img.GetHeight(),
                };

                ConvertImageToLibShapes(aSymbol, 0, img, pixelScale, this.RelPosSym(start));
              }
            }
          }
        }
      } else if (elType === 'A') {
        const data = at(arr, 1);
        const strokeColor = at(arr, 3);
        const lineWidth = this.Convert(at(arr, 4));
        const strokeStyle = ConvertStrokeStyle(at(arr, 5));
        const fillColor = at(arr, 6).toLowerCase();

        const chains = this.ParseLineChains(data, mils(10), false);

        const transform = (aVec: VECTOR2I): VECTOR2I => ({ x: aVec.x, y: aVec.y });

        for (const chain of chains) {
          for (let i = 0; i <= chain.PointCount() && i !== -1; i = chain.NextShape(i)) {
            if (chain.IsArcStart(i)) {
              const arc = chain.Arc(chain.ArcIndex(i));

              const shape = new SCH_SHAPE(SHAPE_T.ARC, SCH_LAYER_ID.LAYER_DEVICE);

              shape.SetArcGeometry(
                transform(arc.GetP0()),
                transform(arc.GetArcMid()),
                transform(arc.GetP1()),
              );

              shape.SetUnit(0);
              shape.SetStroke(new STROKE_PARAMS(this.ScaleSize(lineWidth), strokeStyle));

              setFill(shape, fillColor, strokeColor);

              aSymbol.AddDrawItem(shape);
            } else {
              const seg = chain.CSegment(i);

              const shape = new SCH_SHAPE(SHAPE_T.POLY, SCH_LAYER_ID.LAYER_DEVICE);

              shape.AddPoint(transform(seg.A));
              shape.AddPoint(transform(seg.B));

              shape.SetUnit(0);
              shape.SetStroke(new STROKE_PARAMS(this.ScaleSize(lineWidth), strokeStyle));

              aSymbol.AddDrawItem(shape);
            }
          }
        }
      } else if (elType === 'R') {
        const start: Vec2 = { x: this.Convert(at(arr, 1)), y: this.Convert(at(arr, 2)) };

        const size: Vec2 = { x: this.Convert(at(arr, 5)), y: this.Convert(at(arr, 6)) };
        const strokeColor = at(arr, 7);
        const lineWidth = this.Convert(at(arr, 8));
        const strokeStyle = ConvertStrokeStyle(at(arr, 9));
        const fillColor = at(arr, 10).toLowerCase();

        //if( cr.x == 0 )
        {
          const rect = new SCH_SHAPE(SHAPE_T.RECTANGLE, SCH_LAYER_ID.LAYER_DEVICE);

          rect.SetStart(toI(this.RelPosSym(start)));
          rect.SetEnd(toI(this.RelPosSym({ x: start.x + size.x, y: start.y + size.y })));

          rect.SetUnit(0);
          rect.SetStroke(new STROKE_PARAMS(this.ScaleSize(lineWidth), strokeStyle));

          setFill(rect, fillColor, strokeColor);

          aSymbol.AddDrawItem(rect);
        }
        // TODO: rounded rectangles
      } else if (elType === 'E') {
        const circle = new SCH_SHAPE(SHAPE_T.CIRCLE, SCH_LAYER_ID.LAYER_DEVICE);

        const center: Vec2 = { x: this.Convert(at(arr, 1)), y: this.Convert(at(arr, 2)) };
        const radius: Vec2 = { x: this.Convert(at(arr, 3)), y: this.Convert(at(arr, 4)) }; // TODO: corner radius
        const strokeColor = at(arr, 5);
        const lineWidth = this.Convert(at(arr, 6));
        const strokeStyle = ConvertStrokeStyle(at(arr, 7));
        const fillColor = at(arr, 8).toLowerCase();

        circle.SetCenter(toI(this.RelPosSym(center)));
        // `center + VECTOR2I( radius.x, 0 )`: the radius truncated to int first.
        circle.SetEnd(toI(this.RelPosSym({ x: center.x + Math.trunc(radius.x), y: center.y })));

        circle.SetUnit(0);
        circle.SetStroke(new STROKE_PARAMS(this.ScaleSize(lineWidth), strokeStyle));

        setFill(circle, fillColor, strokeColor);

        aSymbol.AddDrawItem(circle);
      } else if (elType === 'P') {
        const sepShapeStr = shapeStr.replaceAll('^^', '\n');

        const segments = split(sepShapeStr, '\n');
        const mainParts = split(at(segments, 0), '~');
        const pinDotParts = split(at(segments, 1), '~');
        const pinPathColorParts = split(at(segments, 2), '~');
        const pinNameParts = split(at(segments, 3), '~');
        const pinNumParts = split(at(segments, 4), '~');

        const elecType = ConvertElecType(at(mainParts, 2));
        const pinNumber = at(mainParts, 3);
        const pinPos: Vec2 = {
          x: this.Convert(at(mainParts, 4)),
          y: this.Convert(at(mainParts, 5)),
        };

        void pinDotParts; // `pinDotPos` is read upstream and not used

        const nameVisible = at(pinNameParts, 0) !== '0';
        const pinName = at(pinNameParts, 4);

        const numVisible = at(pinNumParts, 0) !== '0';

        const startPoint = { x: 0, y: 0 };
        let vertical = false;
        let pinLen = 0;

        // M360,290h10 or M 420 300 h -5
        const lineData = at(pinPathColorParts, 0);
        const regex = /^M\s*([-\d.]+)[,\s]([-\d.]+)\s*([h|v])\s*([-\d.]+)\s*$/;
        const m = regex.exec(lineData);

        if (m) {
          startPoint.x = this.Convert(m[1]!);
          startPoint.y = this.Convert(m[2]!);

          vertical = m[3]!.includes('v');
          pinLen = this.Convert(m[4]!);
        }

        let pinRotation = 0;

        if (!vertical) {
          if (startPoint.x === pinPos.x && pinLen < 0) pinRotation = 180;
          else if (startPoint.x === pinPos.x && pinLen > 0) pinRotation = 0;
          else if (startPoint.x !== pinPos.x && pinLen < 0) pinRotation = 0;
          else if (startPoint.x !== pinPos.x && pinLen > 0) pinRotation = 180;
        } else {
          if (startPoint.y === pinPos.y && pinLen < 0) pinRotation = 90;
          else if (startPoint.y === pinPos.y && pinLen > 0) pinRotation = 270;
          else if (startPoint.y !== pinPos.y && pinLen < 0) pinRotation = 270;
          else if (startPoint.y !== pinPos.y && pinLen > 0) pinRotation = 90;
        }

        let orient = PIN_ORIENTATION.PIN_RIGHT;

        if (pinRotation === 0) orient = PIN_ORIENTATION.PIN_RIGHT;
        else if (pinRotation === 90) orient = PIN_ORIENTATION.PIN_UP;
        else if (pinRotation === 180) orient = PIN_ORIENTATION.PIN_LEFT;
        else if (pinRotation === 270) orient = PIN_ORIENTATION.PIN_DOWN;

        const pinUnit = 0;
        // `int kPinLen = ScaleSize( ... )`: ScaleSize is already whole.
        const kPinLen = Math.trunc(this.ScaleSize(Math.abs(pinLen)));

        if (segments.length > 5) {
          const dotParts = split(at(segments, 5), '~');
          const clockParts = split(at(segments, 6), '~');

          if (dotParts.length === 3 && clockParts.length === 2) {
            if (dotParts[0] === '1') {
              const dotPos: Vec2 = { x: this.Convert(dotParts[1]!), y: this.Convert(dotParts[2]!) };

              const circle = new SCH_SHAPE(SHAPE_T.CIRCLE, SCH_LAYER_ID.LAYER_DEVICE);

              circle.SetCenter(toI(this.RelPosSym(dotPos)));
              const along = ResizeD(
                { x: dotPos.x - pinPos.x, y: dotPos.y - pinPos.y },
                Math.abs(pinLen),
              );
              circle.SetEnd(toI(this.RelPosSym({ x: pinPos.x + along.x, y: pinPos.y + along.y })));

              circle.SetUnit(0);

              aSymbol.AddDrawItem(circle);
            }

            if (clockParts[0] === '1') {
              const lineChains = this.ParseLineChains(clockParts[1]!, mils(10), false);

              for (const outline of lineChains) {
                const shape = new SCH_SHAPE(SHAPE_T.POLY, SCH_LAYER_ID.LAYER_DEVICE);

                if (outline.IsClosed()) outline.Append(outline.CPoint(0), true);

                for (const pt of outline.CPoints()) shape.AddPoint(pt);

                shape.SetUnit(0);

                aSymbol.AddDrawItem(shape);
              }
            }
          }
        }

        const pin = new SCH_PIN(aSymbol);

        pin.SetName(pinName);
        pin.SetNumber(pinNumber);
        pin.SetOrientation(orient);
        pin.SetType(elecType);
        pin.SetLength(kPinLen);
        pin.SetPosition(toI(this.RelPosSym(pinPos)));
        pin.SetUnit(pinUnit);

        // `pin->GetNumberTextSize() * int( pinNumber.size() ) > kPinLen`; the size is the
        // UTF-16 length, as wxString::size() counts on Linux only for BMP text.
        if (pin.GetNumberTextSize() * pinNumber.length > kPinLen)
          pin.SetNumberTextSize(Math.trunc(kPinLen / pinNumber.length));

        if (!nameVisible) pin.SetNameTextSize(mils(1));

        if (!numVisible) pin.SetNumberTextSize(mils(1));

        aSymbol.AddDrawItem(pin);
      } else if (elType === 'T') {
        const textType = at(arr, 1);
        const pos: Vec2 = { x: this.Convert(at(arr, 2)), y: this.Convert(at(arr, 3)) };
        const angle = Math.trunc(this.Convert(at(arr, 4)));
        const fontname = at(arr, 6);
        const fontSize = at(arr, 7);
        const baselineAlign = at(arr, 10);
        let textStr = at(arr, 12);
        const visible = at(arr, 13) !== '0';

        textStr = textStr.replaceAll('\\n', '\n');
        textStr = UnescapeHTML(textStr);

        const halignStr = at(arr, 14); // Empty, start, middle, end, inherit

        let added = false;
        let textItem: SCH_FIELD | SCH_TEXT;

        if (textType === 'P') {
          textItem = aSymbol.GetReferenceField();
          textItem.SetTextPos(toI(this.RelPosSym(pos)));
          textItem.SetText(textStr);
        } else if (textType === 'N') {
          textItem = aSymbol.GetValueField();
          textItem.SetTextPos(toI(this.RelPosSym(pos)));
          textItem.SetText(textStr);
        } else {
          textItem = new SCH_TEXT(toI(this.RelPosSym(pos)), textStr, SCH_LAYER_ID.LAYER_DEVICE);
          added = true;
        }

        // `( 360 - angle ) % 360` on ints: C++'s % keeps the dividend's sign, as JS's does.
        textItem.SetTextAngleDegrees((360 - angle) % 360);
        textItem.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP);

        if (halignStr === 'middle')
          textItem.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER);
        else if (halignStr === 'end')
          textItem.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT);
        else textItem.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT);

        textItem.SetFont(FONT.GetFont(fontname));
        textItem.SetVisible(visible);

        let ptSize = 7;

        if (fontSize !== '') {
          if (fontSize.endsWith('pt')) ptSize = this.Convert(beforeFirst(fontSize, 'p'));
          else if (isNumber(fontSize)) ptSize = this.Convert(fontSize);
        }

        let ktextSize = this.ScaleSize(ptSize);

        if (textStr.includes('\n')) ktextSize *= 0.8;
        else ktextSize *= 0.95;

        textItem.SetTextSize(V2I(ktextSize, ktextSize));

        this.TransformTextToBaseline(textItem, baselineAlign);

        if (added) aSymbol.AddDrawItem(textItem as SCH_TEXT);
      }
    }
  }

  ParseSymbol(
    aOrigin: Vec2,
    aParams: ReadonlyMap<string, string>,
    aShapes: readonly string[],
  ): LIB_SYMBOL {
    const ksymbol = new LIB_SYMBOL('');

    this.m_relOrigin = { x: aOrigin.x, y: aOrigin.y };

    const symbolName = get_opt(aParams, 'name') ?? get_opt(aParams, 'spiceSymbolName') ?? 'Unknown';
    const symbolPrefix = get_opt(aParams, 'pre') ?? get_opt(aParams, 'spicePre') ?? '';

    const libId = EasyEdaToKiCadLibID('', symbolName);

    ksymbol.SetLibId(libId);
    ksymbol.SetName(symbolName);

    ksymbol.GetReferenceField().SetText(symbolPrefix);
    ksymbol.GetValueField().SetText(symbolName);

    for (const attrName of c_attributesWhitelist) {
      let srcName = attrName;

      if (srcName === 'Datasheet') srcName = 'link';

      const valOpt = get_opt(aParams, srcName);

      if (valOpt !== undefined) {
        if (valOpt === '') continue;

        let fd = ksymbol.FindFieldCaseInsensitive(attrName);

        if (!fd) {
          fd = new SCH_FIELD(ksymbol, FIELD_T.USER, attrName);
          ksymbol.AddField(fd);
        }

        fd.SetText(valOpt);
        fd.SetVisible(false);
      }
    }

    this.ParseSymbolShapes(ksymbol, aParams, aShapes);

    return ksymbol;
  }

  ParseSchematic(
    aSchematic: SCHEMATIC,
    aRootSheet: SCH_SHEET,
    _aFileName: string,
    aShapes: readonly string[],
  ): void {
    const loadedSymbols = new Map<string, LIB_SYMBOL>();
    const namesCounter = new Map<string, number>();
    const createdItems: SCH_ITEM[] = [];

    for (const shapIn of aShapes) {
      const shap = shapIn.replaceAll('#@$', '\n');
      const parts = split(shap, '\n');

      if (parts.length < 1) continue;

      const arr = split(parts[0]!, '~');

      if (arr.length < 1) continue;

      const rootType = arr[0]!;

      if (rootType === 'LIB') {
        if (arr.length < 4) continue;

        const origin: Vec2 = { x: this.Convert(arr[1]!), y: this.Convert(arr[2]!) };

        let symbolName = `Unknown_${arr[1]}_${arr[2]}`;

        const paramParts = split(arr[3]!, '`');

        const paramMap = new Map<string, string>();

        for (let i = 1; i < paramParts.length; i += 2) {
          const key = paramParts[i - 1]!;
          const value = paramParts[i]!;

          if (key === 'spiceSymbolName' && value !== '') symbolName = value;

          paramMap.set(key, value);
        }

        const serial = namesCounter.get(symbolName) ?? 0;

        const counterKey = symbolName;

        if (serial > 0) symbolName = `${symbolName}_${serial}`;

        namesCounter.set(counterKey, serial + 1);

        paramMap.set('spiceSymbolName', symbolName);

        parts.shift();

        const pcbOrigin = this.m_relOrigin;

        const sym = this.ParseSymbol(origin, paramMap, parts);
        // `std::map::emplace`: a name already there keeps its first symbol.
        if (!loadedSymbols.has(symbolName)) loadedSymbols.set(symbolName, sym);

        const referenceStr = sym.GetReferenceField().GetText();

        this.m_relOrigin = pcbOrigin;
        const libId = EasyEdaToKiCadLibID('', symbolName);

        const schSym = new SCH_SYMBOL(sym, libId, aSchematic.CurrentSheet(), 0);

        schSym.SetPosition(toI(this.RelPos(origin)));
        schSym.SetRef(aSchematic.CurrentSheet(), referenceStr);

        createdItems.push(schSym);
      } else if (rootType === 'F') {
        const sepShapeStr = parts[0]!.replaceAll('^^', '\n');

        const segments = split(sepShapeStr, '\n');
        const valueParts = split(at(segments, 2), '~');

        const flagTypename = at(arr, 1);
        const pos: Vec2 = { x: this.Convert(at(arr, 2)), y: this.Convert(at(arr, 3)) };
        const angle = this.Convert(at(arr, 4));

        const netnameValue = at(valueParts, 0);
        const valuePos: Vec2 = {
          x: this.Convert(at(valueParts, 2)),
          y: this.Convert(at(valueParts, 3)),
        };
        const textAngle = this.Convert(at(valueParts, 4));
        const halignStr = at(valueParts, 5);
        const valueFontname = at(valueParts, 7);
        const valueFontsize = at(valueParts, 8);

        if (flagTypename === 'part_netLabel_netPort') {
          const label = new SCH_GLOBALLABEL(toI(this.RelPos(pos)), netnameValue);

          let spin = new SPIN_STYLE(SPIN_STYLE.LEFT);

          for (let i = angle; i > 0; i -= 90) spin = spin.RotateCCW();

          // If the shape was mirrored, we can't rely on angle value to determine direction.
          if (segments.length > 3) {
            const shapeParts = split(segments[3]!, '~');
            if (shapeParts[0] === 'PL') {
              const ptArr = split(at(shapeParts, 1), ' ');

              const chain = new SHAPE_LINE_CHAIN();

              for (let i = 1; i < ptArr.length; i += 2) {
                chain.Append(
                  toI(this.RelPos(V2I(this.Convert(ptArr[i - 1]!), this.Convert(ptArr[i]!)))),
                );
              }

              const rel = toI(this.RelPos(pos));
              chain.Move({ x: -rel.x, y: -rel.y });

              const shapeCenter = chain.Centre();

              if (Math.abs(shapeCenter.x) >= Math.abs(shapeCenter.y)) {
                if (shapeCenter.x >= 0) spin = new SPIN_STYLE(SPIN_STYLE.RIGHT);
                else spin = new SPIN_STYLE(SPIN_STYLE.LEFT);
              } else {
                if (shapeCenter.y >= 0) spin = new SPIN_STYLE(SPIN_STYLE.BOTTOM);
                else spin = new SPIN_STYLE(SPIN_STYLE.UP);
              }
            }
          }

          label.SetSpinStyle(spin);
          label.SetShape(LABEL_FLAG_SHAPE.L_INPUT);

          createdItems.push(label);
        } else {
          const [pwrLibSym, flip] = this.MakePowerSymbol(flagTypename, netnameValue);

          const libId = EasyEdaToKiCadLibID('', netnameValue);

          const schSym = new SCH_SYMBOL(pwrLibSym, libId, aSchematic.CurrentSheet(), 0);

          if (flip) schSym.SetOrientation(SYMBOL_ORIENTATION_T.SYM_MIRROR_X);

          if (angle === 0) {
            // nothing
          } else if (angle === 90) {
            schSym.SetOrientation(SYMBOL_ORIENTATION_T.SYM_ROTATE_COUNTERCLOCKWISE);
          }
          if (angle === 180) {
            schSym.SetOrientation(SYMBOL_ORIENTATION_T.SYM_ROTATE_COUNTERCLOCKWISE);
            schSym.SetOrientation(SYMBOL_ORIENTATION_T.SYM_ROTATE_COUNTERCLOCKWISE);
          }
          if (angle === 270) {
            schSym.SetOrientation(SYMBOL_ORIENTATION_T.SYM_ROTATE_CLOCKWISE);
          }

          schSym.SetPosition(toI(this.RelPos(pos)));

          const valField = schSym.GetField(FIELD_T.VALUE)!;

          valField.SetPosition(toI(this.RelPos(valuePos)));
          valField.SetTextAngleDegrees(textAngle - angle);

          if (!flip) valField.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM);
          else valField.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP);

          if (halignStr === 'middle')
            valField.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER);
          else if (halignStr === 'end')
            valField.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT);
          else valField.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT);

          if (flip && (angle === 90 || angle === 270)) {
            if (valField.GetVertJustify() === GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM)
              valField.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP);
            else if (valField.GetVertJustify() === GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP)
              valField.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM);

            if (valField.GetHorizJustify() === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT)
              valField.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT);
            else if (valField.GetHorizJustify() === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT)
              valField.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT);

            if (flagTypename === 'part_netLabel_Bar')
              // "Circle"
              valField.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER);
          }

          if (angle === 0 && flagTypename === 'part_netLabel_Bar')
            // "Circle"
            valField.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM);

          valField.SetFont(FONT.GetFont(valueFontname));

          let ptSize = 7;

          if (valueFontsize.endsWith('pt')) ptSize = this.Convert(beforeFirst(valueFontsize, 'p'));

          let ktextSize = this.ScaleSize(ptSize);

          if (netnameValue.includes('\n')) ktextSize *= 0.8;
          else ktextSize *= 0.95;

          valField.SetTextSize(V2I(ktextSize, ktextSize));

          createdItems.push(schSym);
        }
      } else if (rootType === 'W') {
        const ptArr = split(at(arr, 1), ' ');

        const chain = new SHAPE_LINE_CHAIN();

        for (let i = 1; i < ptArr.length; i += 2)
          chain.Append(V2I(this.RelPosX(ptArr[i - 1]!), this.RelPosY(ptArr[i]!)));

        for (let segId = 0; segId < chain.SegmentCount(); segId++) {
          const seg = chain.CSegment(segId);

          const line = new SCH_LINE(seg.A, SCH_LAYER_ID.LAYER_WIRE);
          line.SetEndPoint(seg.B);

          createdItems.push(line);
        }
      } else if (rootType === 'N') {
        const pos: Vec2 = { x: this.Convert(at(arr, 1)), y: this.Convert(at(arr, 2)) };
        const angle = this.Convert(at(arr, 3));
        const netname = at(arr, 5);
        const halignStr = at(arr, 7);

        const label = new SCH_LABEL(toI(this.RelPos(pos)), netname);

        if (halignStr === 'middle') label.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER);
        else if (halignStr === 'end')
          label.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT);
        else label.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT);

        // `for( int left = angle; ... )`: the angle narrowed to int.
        for (let left = Math.trunc(angle); left > 0; left -= 90) label.Rotate90(false);

        createdItems.push(label);
      } else if (rootType === 'O') {
        const pos: Vec2 = { x: this.Convert(at(arr, 1)), y: this.Convert(at(arr, 2)) };

        const noConn = new SCH_NO_CONNECT(toI(this.RelPos(pos)));

        createdItems.push(noConn);
      } else if (rootType === 'J') {
        const pos: Vec2 = { x: this.Convert(at(arr, 1)), y: this.Convert(at(arr, 2)) };

        const junction = new SCH_JUNCTION(toI(this.RelPos(pos)) /*, ScaleSizeUnit( dia )*/);

        createdItems.push(junction);
      } else if (rootType === 'T') {
        const pos: Vec2 = { x: this.Convert(at(arr, 2)), y: this.Convert(at(arr, 3)) };
        const angle = Math.trunc(this.Convert(at(arr, 4)));
        const fontname = at(arr, 6);
        const fontSize = at(arr, 7);
        const baselineAlign = at(arr, 10);
        let textStr = at(arr, 12);

        textStr = textStr.replaceAll('\\n', '\n');
        textStr = UnescapeHTML(textStr);

        const halignStr = at(arr, 14); // Empty, start, middle, end, inherit

        const textItem = new SCH_TEXT(toI(this.RelPos(pos)), textStr);

        textItem.SetTextAngleDegrees((360 - angle) % 360);
        textItem.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP);

        if (halignStr === 'middle')
          textItem.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER);
        else if (halignStr === 'end')
          textItem.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT);
        else textItem.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT);

        textItem.SetFont(FONT.GetFont(fontname));

        let ptSize = 7;

        if (fontSize.endsWith('pt')) ptSize = this.Convert(beforeFirst(fontSize, 'p'));

        let ktextSize = this.ScaleSize(ptSize);

        if (textStr.includes('\n')) ktextSize *= 0.8;
        else ktextSize *= 0.95;

        textItem.SetTextSize(V2I(ktextSize, ktextSize));

        this.TransformTextToBaseline(textItem, baselineAlign);

        createdItems.push(textItem);
      } else if (rootType === 'R') {
        const start: Vec2 = { x: this.Convert(at(arr, 1)), y: this.Convert(at(arr, 2)) };

        const size: Vec2 = { x: this.Convert(at(arr, 5)), y: this.Convert(at(arr, 6)) };
        const strokeColor = at(arr, 7);
        const lineWidth = this.Convert(at(arr, 8));
        const strokeStyle = ConvertStrokeStyle(at(arr, 9));
        const fillColor = at(arr, 10).toLowerCase();

        //if( cr.x == 0 )
        {
          const rect = new SCH_SHAPE(SHAPE_T.RECTANGLE);

          rect.SetStart(toI(this.RelPos(start)));
          rect.SetEnd(toI(this.RelPos({ x: start.x + size.x, y: start.y + size.y })));

          rect.SetStroke(new STROKE_PARAMS(this.ScaleSize(lineWidth), strokeStyle));

          setFill(rect, fillColor, strokeColor);

          createdItems.push(rect);
        }
      } else if (rootType === 'I') {
        const start: Vec2 = { x: this.Convert(at(arr, 1)), y: this.Convert(at(arr, 2)) };
        const size: Vec2 = { x: this.Convert(at(arr, 3)), y: this.Convert(at(arr, 4)) };
        const imageUrl = at(arr, 6);
        const transformData = at(arr, 9);

        const kstart = this.RelPos(start);
        const ksize = this.ScalePos(size);

        const transformCmds = ParseImageTransform(transformData);

        const applyTransform = (aSchItem: SCH_ITEM): void => {
          for (const [name, args] of transformCmds) {
            if (name === 'rotate') {
              if (args.length !== 3) continue;

              const cmdAngle = 360 - args[0]!;
              const cmdAround: Vec2 = { x: args[1]!, y: args[2]! };

              for (let i = cmdAngle; i > 0; i -= 90) {
                if (aSchItem.Type() === KICAD_T.SCH_LINE_T) {
                  // Lines need special handling for some reason
                  aSchItem.SetFlags(STARTPOINT);
                  aSchItem.Rotate(toI(this.RelPos(cmdAround)), false);
                  aSchItem.ClearFlags(STARTPOINT);

                  aSchItem.SetFlags(ENDPOINT);
                  aSchItem.Rotate(toI(this.RelPos(cmdAround)), false);
                  aSchItem.ClearFlags(ENDPOINT);
                } else {
                  aSchItem.Rotate(toI(this.RelPos(cmdAround)), false);
                }
              }
            } else if (name === 'translate') {
              if (args.length !== 2) continue;

              const cmdOffset: Vec2 = { x: args[0]!, y: args[1]! };
              aSchItem.Move(toI(this.ScalePos(cmdOffset)));
            } else if (name === 'scale') {
              if (args.length !== 2) continue;

              const cmdScaleX = args[0]!;
              const cmdScaleY = args[1]!;

              // Lines need special handling for some reason
              if (aSchItem.Type() === KICAD_T.SCH_LINE_T) aSchItem.SetFlags(STARTPOINT | ENDPOINT);

              if (cmdScaleX < 0 && cmdScaleY > 0) {
                aSchItem.MirrorHorizontally(0);
              } else if (cmdScaleX > 0 && cmdScaleY < 0) {
                aSchItem.MirrorVertically(0);
              } else if (cmdScaleX < 0 && cmdScaleY < 0) {
                aSchItem.MirrorHorizontally(0);
                aSchItem.MirrorVertically(0);
              }

              if (aSchItem.Type() === KICAD_T.SCH_LINE_T)
                aSchItem.ClearFlags(STARTPOINT | ENDPOINT);
            }
          }
        };

        if (beforeFirst(imageUrl, ':') === 'data') {
          const paramsArr = split(beforeFirst(afterFirst(imageUrl, ':'), ','), ';');

          const data = afterFirst(imageUrl, ',');

          if (paramsArr.length > 0) {
            const mimeType = paramsArr[0]!;
            const buf = base64ToBytes(data);

            if (mimeType === 'image/svg+xml') {
              // As for a symbol's image: GRAPHICS_IMPORTER_SCH is records here, not live items.
              void applyTransform;
              this.m_reporter?.Report(
                'An embedded SVG image on the schematic was not imported.',
                RPT_SEVERITY_WARNING,
              );
            } else {
              const bitmap = new SCH_BITMAP();
              const refImage = bitmap.GetReferenceImage();

              if (refImage.ReadImageFile(buf)) {
                const kcenter: Vec2 = { x: kstart.x + ksize.x / 2, y: kstart.y + ksize.y / 2 };

                const scaleFactor = this.ScaleSize(size.x) / refImage.GetSize().x;
                refImage.SetImageScale(scaleFactor);
                bitmap.SetPosition(toI(kcenter));

                applyTransform(bitmap);

                createdItems.push(bitmap);
              }
            }
          }
        }
      }
    }

    const sheetBBox = new BOX2I();

    for (const ptr of createdItems)
      if (ptr.Type() === KICAD_T.SCH_SYMBOL_T)
        sheetBBox.Merge((ptr as unknown as SCH_SYMBOL).GetBodyBoundingBox());

    const screen = aRootSheet.GetScreen()!;
    const pageInfo = screen.GetPageSettings();

    const alignGrid = mils(50);

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

    void loadedSymbols;
    void this.m_schematic;
  }

  /** `RelPosSym( VECTOR2I )`'s two coordinates. */
  private relPosSymXY(aVec: VECTOR2I): [number, number] {
    return [this.RelPosX(aVec.x), this.RelPosY(aVec.y)];
  }
}

/**
 * `VECTOR2<int>( const VECTOR2<double>& )`: a `VECTOR2D` handed to a setter that takes a
 * `VECTOR2I`. The values here come out of `ScaleSize`, already whole; a fraction is truncated.
 */
function toI(v: Vec2): VECTOR2I {
  return { x: Math.trunc(v.x), y: Math.trunc(v.y) };
}

/** `wxString::BeforeFirst( c )`. */
function beforeFirst(s: string, c: string): string {
  const i = s.indexOf(c);
  return i < 0 ? s : s.slice(0, i);
}

/** `wxString::AfterFirst( c )`. */
function afterFirst(s: string, c: string): string {
  const i = s.indexOf(c);
  return i < 0 ? '' : s.slice(i + 1);
}

/** `wxString::IsNumber()`: an optional sign then digits only. */
function isNumber(s: string): boolean {
  return /^[-+]?\d+$/.test(s);
}

export type { EDA_ITEM };
