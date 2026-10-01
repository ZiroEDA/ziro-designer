// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/easyedapro/pcb_io_easyedapro_parser.cpp` / `.h`: EasyEDA
 * (JLCEDA) Pro board and footprint documents — JSON arrays, one per line —
 * built into a BOARD and its FOOTPRINTs.
 *
 * The C++ reads each line through nlohmann's conversions, which throw on a
 * value of the wrong type; `common/json_common.ts` gives the same reads and
 * the same `JSON_EXCEPTION`s.
 */

import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import { FONT } from '@ziroeda/common/font/font.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/font/text_attributes.js';
import { ToKiCadLibID } from '@ziroeda/common/io/easyedapro/easyedapro_import_utils.js';
import {
  type BLOB,
  IMPORT_POURED,
  PCB_ATTR_from_json,
  PRJ_DEVICE_from_json,
  type POURED,
  POURED_from_json,
} from '@ziroeda/common/io/easyedapro/easyedapro_parser.js';
import {
  isArray,
  isNull,
  isNumber,
  isObject,
  isString,
  jAt,
  jContains,
  jEmpty,
  jInt,
  jIntSet,
  jItems,
  jMap,
  jNum,
  type JSON_VALUE,
  jSize,
  jStr,
  jValue,
  jValues,
} from '@ziroeda/common/json_common.js';
import {
  B_Cu,
  B_Fab,
  B_Mask,
  B_Paste,
  B_SilkS,
  Cmts_User,
  Dwgs_User,
  Eco2_User,
  Edge_Cuts,
  F_CrtYd,
  F_Cu,
  F_Fab,
  F_Mask,
  F_Paste,
  F_SilkS,
  In1_Cu,
  IsBackLayer,
  type PCB_LAYER_ID,
  User_1,
  User_4,
  User_5,
  User_6,
  User_7,
} from '@ziroeda/common/layer_id.js';
import { strtodPrefix, ToCDoubleOk } from '@ziroeda/common/libc/stdlib.js';
import { LSET } from '@ziroeda/common/lset.js';
import { ESCAPE_CONTEXT, EscapeString, formatG, wxSplit } from '@ziroeda/common/string_utils.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { ARC_HIGH_DEF } from '@ziroeda/kimath/src/base_units.js';
import { BezierPoly } from '@ziroeda/kimath/src/bezier_curves.js';
import {
  ERROR_LOC,
  transformCircleToPolygonSet,
  transformOvalToPolygon,
  transformRoundChamferedRectToPolygon,
} from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { FLIP_DIRECTION, MIRRORVAL } from '@ziroeda/kimath/src/core/mirror.js';
import { ANGLE_0, ANGLE_90, EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { SHAPE_ARC } from '@ziroeda/kimath/src/geometry/shape_arc.js';
import { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { CornerStrategy, SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { SHAPE_RECT } from '@ziroeda/kimath/src/geometry/shape_rect.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { hypot, tan } from '@ziroeda/kimath/src/math/libm.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import {
  Perpendicular,
  ResizeD,
  type Vec2,
  type VECTOR2I,
} from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePointD } from '@ziroeda/kimath/src/trigo.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { BOARD } from '../../board.js';
import { ADD_MODE } from '../../board_item_container.js';
import { DEFAULT_COURTYARD_WIDTH } from '../../board_design_settings_defaults.js';
import { ConnectBoardShapes } from '../../fix_board_shape.js';
import { FOOTPRINT, FP_3DMODEL } from '../../footprint.js';
import { NETINFO_ITEM } from '../../netinfo_item.js';
import { PAD } from '../../pad.js';
import { PAD_ATTRIB, PAD_DRILL_SHAPE, PAD_SHAPE, PADSTACK } from '../../padstack.js';
import { PCB_FIELD } from '../../pcb_field.js';
import { PCB_GROUP } from '../../pcb_group.js';
import { PCB_REFERENCE_IMAGE } from '../../pcb_reference_image.js';
import { PCB_SHAPE } from '../../pcb_shape.js';
import { PCB_TEXT } from '../../pcb_text.js';
import { PCB_ARC, PCB_TRACK, PCB_VIA } from '../../pcb_track.js';
import { TEARDROP_TYPE } from '../../teardrop/teardrop_parameters.js';
import { ZONE } from '../../zone.js';

const QUERY_MODEL_UUID_KEY = 'JLC_3DModel_Q';
const MODEL_SIZE_KEY = 'JLC_3D_Size';

const SHAPE_JOIN_DISTANCE = pcbIUScale.mmToIU(1.5);

const INT_MAX = 2147483647;

/** `std::map<wxString, std::unique_ptr<FOOTPRINT>>`. */
export type FOOTPRINT_MAP = Map<string, FOOTPRINT>;

/** `std::multimap<wxString, POURED>`: entries per key, in insertion order. */
export type POURED_MAP = Map<string, POURED[]>;

/** `VECTOR2I( const VECTOR2D& )`: KiROUND per component. */
function toI(p: Vec2): VECTOR2I {
  return { x: KiROUND(p.x), y: KiROUND(p.y) };
}

/** `DEG2RAD( deg )`. */
const DEG2RAD = (deg: number): number => (deg * Math.PI) / 180.0;

/** `VECTOR2D::EuclideanNorm()`: std::hypot. */
const norm = (v: Vec2): number => hypot(v.x, v.y);

/** `mid + delta.Perpendicular().Resize( cdist )`, the arc centre every ARC reader computes. */
function arcCenter(aStart: Vec2, aEnd: Vec2, aAngle: number): Vec2 {
  const delta = { x: aEnd.x - aStart.x, y: aEnd.y - aStart.y };
  const mid = { x: aStart.x + delta.x / 2, y: aStart.y + delta.y / 2 };

  const ha = aAngle / 2;
  const hd = norm(delta) / 2;
  const cdist = hd / tan(DEG2RAD(ha));
  const perp = ResizeD(Perpendicular(delta), cdist);

  return { x: mid.x + perp.x, y: mid.y + perp.y };
}

/** Two numbers of a line: `VECTOR2D( j.at( a ), j.at( b ) )`. */
function vec(j: JSON_VALUE, a: number, b: number): Vec2 {
  return { x: jNum(jAt(j, a)), y: jNum(jAt(j, b)) };
}

/** `wxString::Trim()`: trailing blanks off. */
function trimRight(s: string): string {
  return s.replace(/[ \t\n\v\f\r]+$/, '');
}

/** `wxArrayString[i]`, '' past the end (undefined behaviour upstream). */
const at = (a: readonly string[], i: number): string => a[i] ?? '';

function AlignText(text: PCB_TEXT, align: number): void {
  const V = GR_TEXT_V_ALIGN_T;
  const H = GR_TEXT_H_ALIGN_T;

  switch (align) {
    case 1:
      text.SetVertJustify(V.GR_TEXT_V_ALIGN_TOP);
      text.SetHorizJustify(H.GR_TEXT_H_ALIGN_LEFT);
      break;
    case 2:
      text.SetVertJustify(V.GR_TEXT_V_ALIGN_CENTER);
      text.SetHorizJustify(H.GR_TEXT_H_ALIGN_LEFT);
      break;
    case 3:
      text.SetVertJustify(V.GR_TEXT_V_ALIGN_BOTTOM);
      text.SetHorizJustify(H.GR_TEXT_H_ALIGN_LEFT);
      break;

    case 4:
      text.SetVertJustify(V.GR_TEXT_V_ALIGN_TOP);
      text.SetHorizJustify(H.GR_TEXT_H_ALIGN_CENTER);
      break;
    case 5:
      text.SetVertJustify(V.GR_TEXT_V_ALIGN_CENTER);
      text.SetHorizJustify(H.GR_TEXT_H_ALIGN_CENTER);
      break;
    case 6:
      text.SetVertJustify(V.GR_TEXT_V_ALIGN_BOTTOM);
      text.SetHorizJustify(H.GR_TEXT_H_ALIGN_CENTER);
      break;

    case 7:
      text.SetVertJustify(V.GR_TEXT_V_ALIGN_TOP);
      text.SetHorizJustify(H.GR_TEXT_H_ALIGN_RIGHT);
      break;
    case 8:
      text.SetVertJustify(V.GR_TEXT_V_ALIGN_CENTER);
      text.SetHorizJustify(H.GR_TEXT_H_ALIGN_RIGHT);
      break;
    case 9:
      text.SetVertJustify(V.GR_TEXT_V_ALIGN_BOTTOM);
      text.SetHorizJustify(H.GR_TEXT_H_ALIGN_RIGHT);
      break;
  }
}

/** A chain's points appended the way `aBuffer.Append( x, y )` does, then closed. */
function appendClosed(aChain: SHAPE_LINE_CHAIN, aPoints: readonly VECTOR2I[]): void {
  for (const p of aPoints) aChain.Append(p.x, p.y);

  aChain.SetClosed(true);
}

export class PCB_IO_EASYEDAPRO_PARSER {
  private m_board: BOARD | null;

  constructor(aBoard: BOARD | null, _aProgressReporter: unknown = null) {
    this.m_board = aBoard;
  }

  /** `ScaleSize( T )`: `KiROUND( v * 25400.0 / 500.0 ) * 500`. */
  static ScaleSize(aValue: number): number {
    return KiROUND((aValue * 25400.0) / 500.0) * 500;
  }

  static ScaleSizeV(aValue: Vec2): Vec2 {
    return {
      x: PCB_IO_EASYEDAPRO_PARSER.ScaleSize(aValue.x),
      y: PCB_IO_EASYEDAPRO_PARSER.ScaleSize(aValue.y),
    };
  }

  /** `ScalePos( VECTOR2<T> )`: y flipped. */
  static ScalePos(aValue: Vec2): Vec2 {
    return {
      x: PCB_IO_EASYEDAPRO_PARSER.ScaleSize(aValue.x),
      y: -PCB_IO_EASYEDAPRO_PARSER.ScaleSize(aValue.y),
    };
  }

  static Convert(aValue: string): number {
    if (!ToCDoubleOk(aValue)) throw new IO_ERROR(`Failed to parse value: '${aValue}'`);

    return strtodPrefix(aValue, 0)!.value;
  }

  LayerToKi(aLayer: number): PCB_LAYER_ID {
    switch (aLayer) {
      case 1:
        return F_Cu;
      case 2:
        return B_Cu;
      case 3:
        return F_SilkS;
      case 4:
        return B_SilkS;
      case 5:
        return F_Mask;
      case 6:
        return B_Mask;
      case 7:
        return F_Paste;
      case 8:
        return B_Paste;
      case 9:
        return F_Fab;
      case 10:
        return B_Fab;
      case 11:
        return Edge_Cuts;
      case 12:
        return Edge_Cuts; // Multi
      case 13:
        return Dwgs_User;
      case 14:
        return Eco2_User;

      case 48:
        return F_Fab; // Component shape layer
      case 49:
        return F_Fab; // Component marking

      case 53:
        return User_4; // 3D shell outline
      case 54:
        return User_5; // 3D shell top
      case 55:
        return User_6; // 3D shell bot
      case 56:
        return User_7; // Drill drawing

      default:
        // case 15 … case 44: In1_Cu … In30_Cu
        if (aLayer >= 15 && aLayer <= 44) return (In1_Cu + 2 * (aLayer - 15)) as PCB_LAYER_ID;

        break;
    }

    return User_1;
  }

  private fillFootprintModelInfo(
    footprint: FOOTPRINT,
    modelUuid: string,
    modelTitle: string,
    modelTransform: string,
  ): void {
    const S = PCB_IO_EASYEDAPRO_PARSER.ScaleSize;
    const C = PCB_IO_EASYEDAPRO_PARSER.Convert;

    // TODO: make this path configurable?
    const easyedaModelDir = 'EASYEDA_MODELS';
    const kicadModelPrefix = `\${KIPRJMOD}/${easyedaModelDir}/`;

    const kmodelOffset = { x: 0, y: 0, z: 0 };
    const kmodelRotation = { x: 0, y: 0, z: 0 };

    if (modelUuid !== '' && !footprint.GetField(QUERY_MODEL_UUID_KEY)) {
      const field = new PCB_FIELD(footprint, FIELD_T.USER, QUERY_MODEL_UUID_KEY);
      field.SetLayer(Cmts_User);
      field.SetVisible(false);
      field.SetText(modelUuid);
      footprint.Add(field);
    }

    if (modelTransform !== '' && !footprint.GetField(MODEL_SIZE_KEY)) {
      const arr = wxSplit(modelTransform, ',', '');

      const fitXmm = pcbIUScale.iuToMM(S(C(at(arr, 0))));
      const fitYmm = pcbIUScale.iuToMM(S(C(at(arr, 1))));

      if (fitXmm > 0.0 && fitYmm > 0.0) {
        const field = new PCB_FIELD(footprint, FIELD_T.USER, MODEL_SIZE_KEY);
        field.SetLayer(Cmts_User);
        field.SetVisible(false);
        field.SetText(`${formatG(fitXmm, 6)} ${formatG(fitYmm, 6)}`);
        footprint.Add(field);
      }

      kmodelRotation.z = -C(at(arr, 3));
      kmodelRotation.x = -C(at(arr, 4));
      kmodelRotation.y = -C(at(arr, 5));

      kmodelOffset.x = pcbIUScale.iuToMM(S(C(at(arr, 6))));
      kmodelOffset.y = pcbIUScale.iuToMM(S(C(at(arr, 7))));
      kmodelOffset.z = pcbIUScale.iuToMM(S(C(at(arr, 8))));
    }

    if (modelTitle !== '' && footprint.Models().length === 0) {
      const model = new FP_3DMODEL();
      model.m_Filename = `${kicadModelPrefix}${EscapeString(modelTitle, ESCAPE_CONTEXT.CTX_FILENAME)}.step`;
      model.m_Offset = kmodelOffset;
      model.m_Rotation = kmodelRotation;
      footprint.Models().push(model);
    }
  }

  ParsePoly(
    aContainer: BOARD | FOOTPRINT | null,
    polyData: JSON_VALUE,
    aClosed: boolean,
    aInFill: boolean,
  ): PCB_SHAPE[] {
    const P = PCB_IO_EASYEDAPRO_PARSER.ScalePos;
    const results: PCB_SHAPE[] = [];

    let prevPt: Vec2 = { x: 0, y: 0 };

    for (let i = 0; i < jSize(polyData); i++) {
      const val = jAt(polyData, i);

      if (isString(val)) {
        const str = val;

        if (str === 'CIRCLE') {
          const center = { x: jNum(jAt(polyData, ++i)), y: jNum(jAt(polyData, ++i)) };
          const r = jNum(jAt(polyData, ++i));

          const shape = new PCB_SHAPE(aContainer, SHAPE_T.CIRCLE);

          shape.SetCenter(toI(P(center)));
          shape.SetEnd(toI(P({ x: center.x + r, y: center.y })));
          shape.SetFilled(aClosed);

          results.push(shape);
        } else if (str === 'R') {
          const start = { x: jNum(jAt(polyData, ++i)), y: jNum(jAt(polyData, ++i)) };
          const size = { x: jNum(jAt(polyData, ++i)), y: -jNum(jAt(polyData, ++i)) };
          const angle = jNum(jAt(polyData, ++i));
          const cr = i + 1 < jSize(polyData) ? jNum(jAt(polyData, ++i)) : 0;

          const rot = (shape: PCB_SHAPE): void => shape.Rotate(toI(P(start)), new EDA_ANGLE(angle));

          if (cr === 0) {
            const shape = new PCB_SHAPE(aContainer, SHAPE_T.RECTANGLE);

            shape.SetStart(toI(P(start)));
            shape.SetEnd(toI(P({ x: start.x + size.x, y: start.y + size.y })));
            shape.SetFilled(aClosed);
            rot(shape);

            results.push(shape);
          } else {
            const end = { x: start.x + size.x, y: start.y + size.y };

            const addSegment = (aStart: Vec2, aEnd: Vec2): void => {
              const shape = new PCB_SHAPE(aContainer, SHAPE_T.SEGMENT);

              shape.SetStart(toI(P(aStart)));
              shape.SetEnd(toI(P(aEnd)));
              shape.SetFilled(aClosed);
              rot(shape);

              results.push(shape);
            };

            const addArc = (aStart: Vec2, aEnd: Vec2, center: Vec2): void => {
              const shape = new PCB_SHAPE(aContainer, SHAPE_T.ARC);

              shape.SetStart(toI(P(aStart)));
              shape.SetEnd(toI(P(aEnd)));
              shape.SetCenter(toI(P(center)));
              shape.SetFilled(aClosed);
              rot(shape);

              results.push(shape);
            };

            addSegment({ x: start.x + cr, y: start.y }, { x: end.x - cr, y: start.y });
            addSegment({ x: end.x, y: start.y - cr }, { x: end.x, y: end.y + cr });
            addSegment({ x: start.x + cr, y: end.y }, { x: end.x - cr, y: end.y });
            addSegment({ x: start.x, y: start.y - cr }, { x: start.x, y: end.y + cr });

            addArc(
              { x: end.x - cr, y: start.y },
              { x: end.x, y: start.y - cr },
              { x: end.x - cr, y: start.y - cr },
            );

            addArc(
              { x: end.x, y: end.y + cr },
              { x: end.x - cr, y: end.y },
              { x: end.x - cr, y: end.y + cr },
            );

            addArc(
              { x: start.x + cr, y: end.y },
              { x: start.x, y: end.y + cr },
              { x: start.x + cr, y: end.y + cr },
            );

            addArc(
              { x: start.x, y: start.y - cr },
              { x: start.x + cr, y: start.y },
              { x: start.x + cr, y: start.y - cr },
            );
          }
        } else if (str === 'ARC' || str === 'CARC') {
          const angle = jNum(jAt(polyData, ++i)) / (aInFill ? 10 : 1);
          const end = { x: jNum(jAt(polyData, ++i)), y: jNum(jAt(polyData, ++i)) };

          const shape = new PCB_SHAPE(aContainer, SHAPE_T.ARC);

          if (angle < 0) {
            shape.SetStart(toI(P(prevPt)));
            shape.SetEnd(toI(P(end)));
          } else {
            shape.SetStart(toI(P(end)));
            shape.SetEnd(toI(P(prevPt)));
          }

          shape.SetCenter(toI(P(arcCenter(prevPt, end, angle))));

          shape.SetFilled(aClosed);

          results.push(shape);

          prevPt = end;
        } else if (str === 'L') {
          const chain = new SHAPE_LINE_CHAIN();
          chain.Append(toI(P(prevPt)));

          while (i < jSize(polyData) - 2 && isNumber(jAt(polyData, i + 1))) {
            const pt = { x: jNum(jAt(polyData, ++i)), y: jNum(jAt(polyData, ++i)) };

            chain.Append(toI(P(pt)));

            prevPt = pt;
          }

          if (aClosed) {
            const shape = new PCB_SHAPE(aContainer, SHAPE_T.POLY);

            if (chain.PointCount() > 2) {
              chain.SetClosed(true);
              shape.SetFilled(true);
              shape.SetPolyShape(new SHAPE_POLY_SET(chain));

              results.push(shape);
            }
          } else {
            for (let s = 0; s < chain.SegmentCount(); s++) {
              const seg = chain.Segment(s);

              const shape = new PCB_SHAPE(aContainer, SHAPE_T.SEGMENT);

              shape.SetStart(seg.A);
              shape.SetEnd(seg.B);

              results.push(shape);
            }
          }
        }
      } else if (isNumber(val)) {
        prevPt = { x: jNum(jAt(polyData, i)), y: jNum(jAt(polyData, ++i)) };
      }
    }

    return results;
  }

  ParseContour(
    polyData: JSON_VALUE,
    aInFill: boolean,
    aMaxError: number = SHAPE_ARC.DefaultAccuracyForPCB(),
  ): SHAPE_LINE_CHAIN {
    const P = PCB_IO_EASYEDAPRO_PARSER.ScalePos;
    const S = PCB_IO_EASYEDAPRO_PARSER.ScaleSize;

    const result = new SHAPE_LINE_CHAIN();
    let prevPt: Vec2 = { x: 0, y: 0 };

    for (let i = 0; i < jSize(polyData); i++) {
      const val = jAt(polyData, i);

      if (isString(val)) {
        const str = val;

        if (str === 'CIRCLE') {
          const center = { x: jNum(jAt(polyData, ++i)), y: jNum(jAt(polyData, ++i)) };
          const r = jNum(jAt(polyData, ++i));

          // TransformCircleToPolygon( SHAPE_LINE_CHAIN&, … ): the SHAPE_POLY_SET form's
          // corners without its closing repeat, appended, then closed
          const pts = transformCircleToPolygonSet(
            toI(P(center)),
            Math.trunc(S(r)),
            aMaxError,
            ERROR_LOC.ERROR_INSIDE,
          );
          appendClosed(result, pts.slice(0, -1));
        } else if (str === 'R') {
          const start = { x: jNum(jAt(polyData, ++i)), y: jNum(jAt(polyData, ++i)) };
          const size = { x: jNum(jAt(polyData, ++i)), y: jNum(jAt(polyData, ++i)) };
          const angle = jNum(jAt(polyData, ++i));
          const cr = i + 1 < jSize(polyData) ? jNum(jAt(polyData, ++i)) : 0;

          const kstart = P(start);
          const ksize = PCB_IO_EASYEDAPRO_PARSER.ScaleSizeV(size);
          const kcenter0 = { x: kstart.x + ksize.x / 2, y: kstart.y + ksize.y / 2 };
          // RotatePoint( VECTOR2D&, … ) on doubles
          const kcenter = rotateD(kcenter0, kstart, new EDA_ANGLE(angle));

          const pts = transformRoundChamferedRectToPolygon(
            toI(kcenter),
            toI(ksize),
            new EDA_ANGLE(angle),
            Math.trunc(S(cr)),
            0,
            0,
            0,
            aMaxError,
            ERROR_LOC.ERROR_INSIDE,
          );

          // poly.NewOutline(); poly.Append( … ) per corner; result.Append( poly.Outline( 0 ) )
          const outline = new SHAPE_LINE_CHAIN();
          for (const p of pts) outline.Append(p.x, p.y);
          outline.SetClosed(true);

          result.Append(outline);
        } else if (str === 'ARC' || str === 'CARC') {
          let angle = jNum(jAt(polyData, ++i));

          if (aInFill)
            // In .epcb fills, the angle is 10x for some reason
            angle /= 10;

          const end = { x: jNum(jAt(polyData, ++i)), y: jNum(jAt(polyData, ++i)) };

          const arcStart = prevPt;
          const arcEnd = end;

          const center = arcCenter(prevPt, end, angle);

          const sarc = new SHAPE_ARC();
          sarc.ConstructFromStartEndCenter(
            toI(P(arcStart)),
            toI(P(arcEnd)),
            toI(P(center)),
            angle >= 0,
            0,
          );

          result.Append(sarc, aMaxError);

          prevPt = end;
        } else if (str === 'C') {
          const pt1 = { x: jNum(jAt(polyData, ++i)), y: jNum(jAt(polyData, ++i)) };
          const pt2 = { x: jNum(jAt(polyData, ++i)), y: jNum(jAt(polyData, ++i)) };
          const pt3 = { x: jNum(jAt(polyData, ++i)), y: jNum(jAt(polyData, ++i)) };

          const ctrlPoints = [toI(P(prevPt)), toI(P(pt1)), toI(P(pt2)), toI(P(pt3))];
          const converter = new BezierPoly(ctrlPoints);

          const bezierPoints = converter.getPoly(aMaxError);

          // `result.Append( bezierPoints )`: through the implicit SHAPE_LINE_CHAIN
          result.Append(new SHAPE_LINE_CHAIN(bezierPoints));

          prevPt = pt3;
        } else if (str === 'L') {
          result.Append(toI(P(prevPt)));

          while (i < jSize(polyData) - 2 && isNumber(jAt(polyData, i + 1))) {
            const pt = { x: jNum(jAt(polyData, ++i)), y: jNum(jAt(polyData, ++i)) };

            result.Append(toI(P(pt)));

            prevPt = pt;
          }
        }
      } else if (isNumber(val)) {
        prevPt = { x: jNum(jAt(polyData, i)), y: jNum(jAt(polyData, ++i)) };
      }
    }

    return result;
  }

  private getNet(aBoard: BOARD | null, aNetName: string): NETINFO_ITEM | null {
    if (!aBoard || aNetName === '') return null;

    let net = aBoard.FindNet(aNetName);

    if (!net) {
      net = new NETINFO_ITEM(aBoard, aNetName, aBoard.GetNetCount() + 1);
      aBoard.Add(net);
    }

    return net;
  }

  private createPAD(aFootprint: FOOTPRINT, line: JSON_VALUE): PAD {
    const S = PCB_IO_EASYEDAPRO_PARSER.ScaleSize;

    jStr(jAt(line, 1)); // uuid

    jStr(jAt(line, 3)); // netname
    const layer = jInt(jAt(line, 4));
    const klayer = this.LayerToKi(layer);

    const padNumber = jStr(jAt(line, 5));

    const center = vec(line, 6, 7);

    const orientation = jNum(jAt(line, 8));

    const padHole = jAt(line, 9);
    const padShape = jAt(line, 10);

    const pad = new PAD(aFootprint);

    pad.SetNumber(padNumber);
    pad.SetPosition(toI(PCB_IO_EASYEDAPRO_PARSER.ScalePos(center)));
    pad.SetOrientationDegrees(orientation);

    // Check if this pad has a real drill hole
    // JLCEDA may use ["ROUND",0,0] to indicate SMD pads
    let hasHole = false;

    if (!isNull(padHole) && !jEmpty(padHole)) {
      const holeShape = jStr(jAt(padHole, 0));

      if (holeShape === 'ROUND' || holeShape === 'SLOT') {
        const drill = { x: jNum(jAt(padHole, 1)), y: jNum(jAt(padHole, 2)) };

        // Only treat as PTH if hole size is non-zero
        if (drill.x > 0 || drill.y > 0) {
          hasHole = true;

          let drill_dir = 0;

          if (isNumber(jAt(line, 14))) drill_dir = jNum(jAt(line, 14));

          const deg = new EDA_ANGLE(drill_dir).Normalize90().AsDegrees();

          if (Math.abs(deg) >= 45) [drill.x, drill.y] = [drill.y, drill.x]; // KiCad doesn't support arbitrary hole direction

          if (holeShape === 'SLOT') pad.SetDrillShape(PAD_DRILL_SHAPE.OBLONG);

          pad.SetDrillSize(toI(PCB_IO_EASYEDAPRO_PARSER.ScaleSizeV(drill)));
          pad.SetLayerSet(PAD.PTHMask());
          pad.SetAttribute(PAD_ATTRIB.PTH);
        }
      }
    }

    // If no valid hole, this is an SMD pad
    if (!hasHole) {
      if (klayer === F_Cu) pad.SetLayerSet(PAD.SMDMask());
      else if (klayer === B_Cu) pad.SetLayerSet(PAD.SMDMask().FlipStandardLayers());

      pad.SetAttribute(PAD_ATTRIB.SMD);
    }

    const padSh = jStr(jAt(padShape, 0));

    if (padSh === 'RECT') {
      const size = { x: jNum(jAt(padShape, 1)), y: jNum(jAt(padShape, 2)) };
      const cr_p = jSize(padShape) > 3 ? jNum(jAt(padShape, 3)) : 0;

      pad.SetSize(PADSTACK.ALL_LAYERS, toI(PCB_IO_EASYEDAPRO_PARSER.ScaleSizeV(size)));

      if (cr_p === 0) {
        pad.SetShape(PADSTACK.ALL_LAYERS, PAD_SHAPE.RECTANGLE);
      } else {
        pad.SetShape(PADSTACK.ALL_LAYERS, PAD_SHAPE.ROUNDRECT);
        pad.SetRoundRectRadiusRatio(PADSTACK.ALL_LAYERS, cr_p / 100);
      }
    } else if (padSh === 'ELLIPSE') {
      const size = { x: jNum(jAt(padShape, 1)), y: jNum(jAt(padShape, 2)) };

      pad.SetSize(PADSTACK.ALL_LAYERS, toI(PCB_IO_EASYEDAPRO_PARSER.ScaleSizeV(size)));
      pad.SetShape(PADSTACK.ALL_LAYERS, PAD_SHAPE.CIRCLE);
    } else if (padSh === 'OVAL') {
      const size = { x: jNum(jAt(padShape, 1)), y: jNum(jAt(padShape, 2)) };

      pad.SetSize(PADSTACK.ALL_LAYERS, toI(PCB_IO_EASYEDAPRO_PARSER.ScaleSizeV(size)));
      pad.SetShape(PADSTACK.ALL_LAYERS, PAD_SHAPE.OVAL);
    } else if (padSh === 'POLY' || padSh === 'POLYGON') {
      pad.SetShape(PADSTACK.ALL_LAYERS, PAD_SHAPE.CUSTOM);
      pad.SetAnchorPadShape(PADSTACK.ALL_LAYERS, PAD_SHAPE.CIRCLE);
      pad.SetSize(PADSTACK.ALL_LAYERS, { x: 1, y: 1 });

      const polyData = jAt(padShape, 1);

      const results = this.ParsePoly(aFootprint, polyData, true, false);

      for (const shape of results) {
        shape.SetLayer(klayer);
        shape.SetWidth(0);

        const pos = pad.GetPosition();
        shape.Move({ x: -pos.x, y: -pos.y });

        pad.AddPrimitive(PADSTACK.ALL_LAYERS, shape);
      }
    }

    void S;

    pad.SetThermalSpokeAngle(ANGLE_90);

    return pad;
  }

  ParseFootprint(aProject: JSON_VALUE, aFpUuid: string, aLines: readonly JSON_VALUE[]): FOOTPRINT {
    const S = PCB_IO_EASYEDAPRO_PARSER.ScaleSize;
    const footprint = new FOOTPRINT(this.m_board);

    const defaultTextSize = { x: pcbIUScale.mmToIU(1.0), y: pcbIUScale.mmToIU(1.0) };
    const defaultTextThickness = pcbIUScale.mmToIU(0.15);

    for (const field of footprint.GetFields()) {
      field.SetTextSize(defaultTextSize);
      field.SetTextThickness(defaultTextThickness);
    }

    for (const line of aLines) {
      if (jSize(line) === 0) continue;

      const type = jStr(jAt(line, 0));

      if (type === 'POLY' || type === 'PAD' || type === 'FILL' || type === 'ATTR') {
        jStr(jAt(line, 1)); // uuid

        jStr(jAt(line, 3)); // netname
        const layer = jInt(jAt(line, 4));
        const klayer = this.LayerToKi(layer);

        if (type === 'POLY') {
          const thickness = jNum(jAt(line, 5));
          const polyData = jAt(line, 6);

          const results = this.ParsePoly(footprint, polyData, false, false);

          for (const shape of results) {
            shape.SetLayer(klayer);
            shape.SetWidth(S(thickness));

            footprint.Add(shape, ADD_MODE.APPEND);
          }
        } else if (type === 'PAD') {
          const pad = this.createPAD(footprint, line);

          footprint.Add(pad, ADD_MODE.APPEND);
        } else if (type === 'FILL') {
          const fillLayer = jInt(jAt(line, 4));
          const fillKlayer = this.LayerToKi(fillLayer);

          let polyDataList = jAt(line, 7);

          if (!isNull(polyDataList) && !jEmpty(polyDataList)) {
            if (!isArray(jAt(polyDataList, 0))) polyDataList = [polyDataList];

            const contours: SHAPE_LINE_CHAIN[] = [];

            for (const polyData of jValues(polyDataList)) {
              const contour = this.ParseContour(polyData, false);
              contour.SetClosed(true);

              contours.push(contour);
            }

            const polySet = new SHAPE_POLY_SET();

            for (const contour of contours) polySet.AddOutline(contour);

            polySet.RebuildHolesFromContours();

            let group: PCB_GROUP | null = null;

            if (polySet.OutlineCount() > 1) group = new PCB_GROUP(footprint);

            for (const poly of polySet.CPolygons()) {
              const shape = new PCB_SHAPE(footprint, SHAPE_T.POLY);

              shape.SetFilled(true);
              shape.SetPolyShape(new SHAPE_POLY_SET(poly));
              shape.SetLayer(fillKlayer);
              shape.SetWidth(0);

              if (group) group.AddItem(shape);

              footprint.Add(shape, ADD_MODE.APPEND);
            }

            if (group) footprint.Add(group, ADD_MODE.APPEND);
          }
        } else if (type === 'ATTR') {
          const attr = PCB_ATTR_from_json(line);

          if (attr.key === 'Designator') footprint.GetField(FIELD_T.REFERENCE).SetText(attr.value);
        }
      } else if (type === 'REGION') {
        jStr(jAt(line, 1)); // uuid

        const layer = jInt(jAt(line, 3));
        const klayer = this.LayerToKi(layer);

        const flags = jIntSet(jAt(line, 5));
        const polyDataList = jAt(line, 6);

        for (const polyData of jValues(polyDataList)) {
          const polySet = new SHAPE_POLY_SET();

          const results = this.ParsePoly(null, polyData, true, false);

          for (const shape of results) {
            shape.SetFilled(true);
            shape.TransformShapeToPolygon(
              polySet,
              klayer,
              0,
              ARC_HIGH_DEF,
              ERROR_LOC.ERROR_INSIDE,
              true,
            );
          }

          polySet.Simplify();

          const zone = new ZONE(footprint);

          this.setRegionFlags(zone, flags);

          zone.SetLayer(klayer);
          zone.Outline().Append(polySet);

          footprint.Add(zone, ADD_MODE.APPEND);
        }
      }
    }

    if (isObject(aProject) && jContains(aProject, 'devices')) {
      // std::map<wxString, PRJ_DEVICE>: every device converted, in key order
      const devicesMap = jMap(jAt(aProject, 'devices'), PRJ_DEVICE_from_json);
      let compAttrs = new Map<string, string>();

      for (const [, devData] of devicesMap) {
        const fp = devData.attributes.get('Footprint');

        if (fp !== undefined && fp === aFpUuid) {
          compAttrs = devData.attributes;
          break;
        }
      }

      const modelUuid = compAttrs.get('3D Model') ?? '';
      const modelTitle = compAttrs.get('3D Model Title') ?? modelUuid;
      const modelTransform = compAttrs.get('3D Model Transform') ?? '';

      this.fillFootprintModelInfo(footprint, modelUuid, modelTitle, modelTransform);
    }

    // Heal board outlines
    const edgeShapes: PCB_SHAPE[] = [];

    for (const item of footprint.GraphicalItems()) {
      if (item.IsOnLayer(Edge_Cuts) && item.Type() === KICAD_T.PCB_SHAPE_T)
        edgeShapes.push(item as PCB_SHAPE);
    }

    ConnectBoardShapes(edgeShapes, SHAPE_JOIN_DISTANCE);

    // EasyEDA footprints don't have courtyard, so build a box ourselves
    if (!footprint.IsOnLayer(F_CrtYd)) {
      const bbox = footprint.GetLayerBoundingBox(
        new LSET([F_Cu, F_Fab, F_Paste, F_Mask, Edge_Cuts]),
      );
      bbox.Inflate(pcbIUScale.mmToIU(0.25)); // Default courtyard clearance

      const shape = new PCB_SHAPE(footprint, SHAPE_T.RECTANGLE);

      shape.SetWidth(pcbIUScale.mmToIU(DEFAULT_COURTYARD_WIDTH));
      shape.SetLayer(F_CrtYd);
      shape.SetStart(bbox.GetOrigin());
      shape.SetEnd(bbox.GetEnd());

      footprint.Add(shape, ADD_MODE.APPEND);
    }

    let hasFabRef = false;

    for (const item of footprint.GraphicalItems()) {
      if (item.Type() === KICAD_T.PCB_TEXT_T && item.IsOnLayer(F_Fab)) {
        if ((item as PCB_TEXT).GetText() === '${REFERENCE}') {
          hasFabRef = true;
          break;
        }
      }
    }

    if (!hasFabRef) {
      // Add reference text field on F_Fab
      const c_refTextSize = pcbIUScale.mmToIU(0.5); // KLC min Fab text size
      const c_refTextThickness = pcbIUScale.mmToIU(0.1); // Decent text thickness
      const refText = new PCB_TEXT(footprint);

      refText.SetLayer(F_Fab);
      refText.SetTextSize({ x: c_refTextSize, y: c_refTextSize });
      refText.SetTextThickness(c_refTextThickness);
      refText.SetText('${REFERENCE}');

      footprint.Add(refText, ADD_MODE.APPEND);
    }

    return footprint;
  }

  /** The keepout flags a `REGION` carries, as both REGION readers set them. */
  private setRegionFlags(zone: ZONE, flags: ReadonlySet<number>): void {
    zone.SetIsRuleArea(true);
    zone.SetDoNotAllowFootprints(flags.has(2));
    zone.SetDoNotAllowZoneFills(flags.has(7) || flags.has(6) || flags.has(8));
    zone.SetDoNotAllowPads(flags.has(7));
    zone.SetDoNotAllowTracks(flags.has(7) || flags.has(5));
    zone.SetDoNotAllowVias(flags.has(7));
  }

  ParseBoard(
    aBoard: BOARD,
    aProject: JSON_VALUE,
    aFootprintMap: FOOTPRINT_MAP,
    aBlobMap: ReadonlyMap<string, BLOB>,
    aPouredMap: POURED_MAP,
    aLines: readonly JSON_VALUE[],
    _aFpLibName: string,
  ): void {
    const S = PCB_IO_EASYEDAPRO_PARSER.ScaleSize;
    const P = PCB_IO_EASYEDAPRO_PARSER.ScalePos;

    const componentLines = new Map<string, JSON_VALUE[]>();

    const boardPouredMap: POURED_MAP = new Map([...aPouredMap].map(([k, v]) => [k, [...v]]));
    const poursToFill = new Map<string, ZONE>();

    const bds = aBoard.GetDesignSettings();

    const pushComponentLine = (compId: string, line: JSON_VALUE): void => {
      const list = componentLines.get(compId);
      if (list) list.push(line);
      else componentLines.set(compId, [line]);
    };

    for (const line of aLines) {
      if (jSize(line) === 0) continue;

      const type = jStr(jAt(line, 0));

      if (type === 'LAYER') {
        const layer = jInt(jAt(line, 1));
        const klayer = this.LayerToKi(layer);

        jStr(jAt(line, 2)); // layerType
        const layerName = jStr(jAt(line, 3));
        const layerFlag = jInt(jAt(line, 4));

        if (layerFlag !== 0) {
          const blayers = new LSET(aBoard.GetEnabledLayers());
          blayers.set(klayer);
          aBoard.SetEnabledLayers(blayers);
          aBoard.SetLayerName(klayer, layerName);
        }
      } else if (type === 'NET') {
        const netname = jStr(jAt(line, 1));

        aBoard.Add(new NETINFO_ITEM(aBoard, netname, aBoard.GetNetCount() + 1), ADD_MODE.APPEND);
      } else if (type === 'RULE') {
        const ruleType = jStr(jAt(line, 1));
        jStr(jAt(line, 2)); // ruleName
        const isDefault = jInt(jAt(line, 3));
        const ruleData = jAt(line, 4);

        if (ruleType === '3' && isDefault) {
          // Track width
          jStr(jAt(ruleData, 0)); // units

          if (isNumber(jAt(ruleData, 1))) {
            // ["RULE","3","trackWidth",1,["mil",5,10,100]]
            const minVal = jNum(jAt(ruleData, 1));

            bds.m_TrackMinWidth = S(minVal);
          } else {
            // ["RULE","3","trackWidth",1,["mil",{"1":[10,10,150]}]]
            const table = jAt(ruleData, 1);

            for (const [, arr] of jItems(table)) {
              const minVal = jNum(jAt(arr, 0));

              bds.m_TrackMinWidth = S(minVal);
            }
          }
        } else if (ruleType === '1' && isDefault) {
          jStr(jAt(ruleData, 0)); // units
          const table = jAt(ruleData, 1);
          let minVal = INT_MAX;

          if (isArray(table) && !jEmpty(table) && isArray(jAt(table, 0))) {
            // ["RULE","1","safeClearance",1,["mil",[[6],[6,6],…,[11.8,…]]]]
            for (const arr of jValues(table)) {
              for (const v of jValues(arr)) {
                const val = jInt(v);

                if (val !== 0 && val < minVal) minVal = val;
              }
            }
          } else if (isObject(table)) {
            // ["RULE","1","safeClearance",1,["mil",{"1":[[8,8,6,…],…]}]]
            for (const [, arr] of jItems(table)) {
              for (const subarr of jValues(arr)) {
                for (const v of jValues(subarr)) {
                  const val = jInt(v);

                  if (val !== 0 && val < minVal) minVal = val;
                }
              }
            }
          }

          bds.m_MinClearance = S(minVal);
        }
      } else if (type === 'POURED') {
        if (!isString(jAt(line, 2))) continue; // Unknown type of POURED

        const poured = POURED_from_json(line);
        const list = boardPouredMap.get(poured.parentId);
        if (list) list.push(poured);
        else boardPouredMap.set(poured.parentId, [poured]);
      } else if (
        type === 'VIA' ||
        type === 'LINE' ||
        type === 'ARC' ||
        type === 'POLY' ||
        type === 'FILL' ||
        type === 'POUR'
      ) {
        const uuid = jStr(jAt(line, 1));

        const netname = jStr(jAt(line, 3));

        if (type === 'VIA') {
          const center = vec(line, 5, 6);

          const drill = jNum(jAt(line, 7));
          const dia = jNum(jAt(line, 8));

          const via = new PCB_VIA(aBoard);

          via.SetPosition(toI(P(center)));
          via.SetDrill(S(drill));
          via.SetWidth(PADSTACK.ALL_LAYERS, S(dia));

          via.SetNet(this.getNet(aBoard, netname));

          aBoard.Add(via, ADD_MODE.APPEND);
        } else if (type === 'LINE') {
          const layer = jInt(jAt(line, 4));
          const klayer = this.LayerToKi(layer);

          const start = vec(line, 5, 6);
          const end = vec(line, 7, 8);

          const width = jNum(jAt(line, 9));

          const track = new PCB_TRACK(aBoard);

          track.SetLayer(klayer);
          track.SetStart(toI(P(start)));
          track.SetEnd(toI(P(end)));
          track.SetWidth(S(width));

          track.SetNet(this.getNet(aBoard, netname));

          aBoard.Add(track, ADD_MODE.APPEND);
        } else if (type === 'ARC') {
          const layer = jInt(jAt(line, 4));
          const klayer = this.LayerToKi(layer);

          const start = vec(line, 5, 6);
          const end = vec(line, 7, 8);

          const angle = jNum(jAt(line, 9));
          const width = jNum(jAt(line, 10));

          const center = arcCenter(start, end, angle);

          const sarc = new SHAPE_ARC();
          // the width argument is an int: the raw width narrowed
          sarc.ConstructFromStartEndCenter(
            toI(P(start)),
            toI(P(end)),
            toI(P(center)),
            angle >= 0,
            Math.trunc(width),
          );

          const arc = new PCB_ARC(aBoard, sarc);
          arc.SetWidth(S(width));

          arc.SetLayer(klayer);
          arc.SetNet(this.getNet(aBoard, netname));

          aBoard.Add(arc, ADD_MODE.APPEND);
        } else if (type === 'FILL') {
          const layer = jInt(jAt(line, 4));
          const klayer = this.LayerToKi(layer);

          let polyDataList = jAt(line, 7);

          if (!isArray(jAt(polyDataList, 0))) polyDataList = [polyDataList];

          const contours: SHAPE_LINE_CHAIN[] = [];

          for (const polyData of jValues(polyDataList)) {
            const contour = this.ParseContour(polyData, true);
            contour.SetClosed(true);

            contours.push(contour);
          }

          const zoneFillPoly = new SHAPE_POLY_SET();

          for (const contour of contours) zoneFillPoly.AddOutline(contour);

          zoneFillPoly.RebuildHolesFromContours();
          zoneFillPoly.Fracture();

          const zone = new ZONE(aBoard);

          zone.SetNet(this.getNet(aBoard, netname));
          zone.SetLayer(klayer);
          zone.Outline().Append(new SHAPE_POLY_SET(new SHAPE_RECT(zoneFillPoly.BBox()).Outline()));
          zone.SetFilledPolysList(klayer, zoneFillPoly);
          zone.SetAssignedPriority(500);
          zone.SetIsFilled(true);
          zone.SetNeedRefill(false);

          zone.SetLocalClearance(bds.m_MinClearance);
          zone.SetMinThickness(bds.m_TrackMinWidth);

          aBoard.Add(zone, ADD_MODE.APPEND);
        } else if (type === 'POLY') {
          const layer = jInt(jAt(line, 4));
          const klayer = this.LayerToKi(layer);

          const thickness = jNum(jAt(line, 5));
          const polyData = jAt(line, 6);

          const results = this.ParsePoly(aBoard, polyData, false, false);

          for (const shape of results) {
            shape.SetLayer(klayer);
            shape.SetWidth(S(thickness));

            aBoard.Add(shape, ADD_MODE.APPEND);
          }
        } else if (type === 'POUR') {
          const layer = jInt(jAt(line, 4));
          const klayer = this.LayerToKi(layer);

          jStr(jAt(line, 6)); // pourname
          const fillOrder = jInt(jAt(line, 7));
          const polyDataList = jAt(line, 8);

          const zone = new ZONE(aBoard);

          zone.SetNet(this.getNet(aBoard, netname));
          zone.SetLayer(klayer);
          zone.SetAssignedPriority(500 - fillOrder);
          zone.SetLocalClearance(bds.m_MinClearance);
          zone.SetMinThickness(bds.m_TrackMinWidth);

          for (const polyData of jValues(polyDataList)) {
            const contour = this.ParseContour(polyData, false);
            contour.SetClosed(true);

            zone.Outline().Append(new SHAPE_POLY_SET(contour));
          }

          // std::map::emplace: the first zone of a uuid stays
          if (!poursToFill.has(uuid)) poursToFill.set(uuid, zone);

          aBoard.Add(zone, ADD_MODE.APPEND);
        }
      } else if (type === 'TEARDROP') {
        jStr(jAt(line, 1)); // uuid
        const netname = jStr(jAt(line, 2));
        const layer = jInt(jAt(line, 3));
        const klayer = this.LayerToKi(layer);

        const polyData = jAt(line, 4);

        const contour = this.ParseContour(polyData, false);
        contour.SetClosed(true);

        const zone = new ZONE(aBoard);

        zone.SetNet(this.getNet(aBoard, netname));
        zone.SetLayer(klayer);
        zone.Outline().Append(new SHAPE_POLY_SET(contour));
        zone.SetFilledPolysList(klayer, new SHAPE_POLY_SET(contour));
        zone.SetNeedRefill(false);
        zone.SetIsFilled(true);

        zone.SetAssignedPriority(600);
        zone.SetLocalClearance(0);
        zone.SetMinThickness(0);
        zone.SetTeardropAreaType(TEARDROP_TYPE.TD_UNSPECIFIED);

        aBoard.Add(zone, ADD_MODE.APPEND);
      } else if (type === 'REGION') {
        jStr(jAt(line, 1)); // uuid

        const layer = jInt(jAt(line, 3));
        const klayer = this.LayerToKi(layer);

        const flags = jIntSet(jAt(line, 5));
        const polyDataList = jAt(line, 6);

        for (const polyData of jValues(polyDataList)) {
          const contour = this.ParseContour(polyData, false);
          contour.SetClosed(true);

          const zone = new ZONE(aBoard);

          this.setRegionFlags(zone, flags);

          zone.SetLayer(klayer);
          zone.Outline().Append(new SHAPE_POLY_SET(contour));

          aBoard.Add(zone, ADD_MODE.APPEND);
        }
      } else if (type === 'PAD') {
        const netname = jStr(jAt(line, 3));

        const footprint = new FOOTPRINT(aBoard);
        const pad = this.createPAD(footprint, line);

        pad.SetNet(this.getNet(aBoard, netname));

        const pos = pad.GetPosition();
        const orient = pad.GetOrientation();

        pad.SetPosition({ x: 0, y: 0 });
        pad.SetOrientation(ANGLE_0);

        footprint.Add(pad, ADD_MODE.APPEND);
        footprint.SetPosition(pos);
        footprint.SetOrientation(orient);

        const fpName = `Pad_${jStr(jAt(line, 1))}`;
        const fpID = ToKiCadLibID('', fpName);

        footprint.SetFPID(fpID);
        footprint.Reference().SetVisible(true);
        footprint.Value().SetVisible(true);
        footprint.AutoPositionFields();

        aBoard.Add(footprint, ADD_MODE.APPEND);
      } else if (type === 'IMAGE') {
        jStr(jAt(line, 1)); // uuid

        const layer = jInt(jAt(line, 3));
        const klayer = this.LayerToKi(layer);

        const start = vec(line, 4, 5);
        const size = vec(line, 6, 7);

        const angle = jNum(jAt(line, 8)); // from top left corner
        const mirror = jInt(jAt(line, 9));
        const polyDataList = jAt(line, 10);

        const bbox = new BOX2I();
        const contours: SHAPE_LINE_CHAIN[] = [];

        for (const polyData of jValues(polyDataList)) {
          const contour = this.ParseContour(polyData, false);
          contour.SetClosed(true);

          contours.push(contour);

          bbox.Merge(contour.BBox());
        }

        const scale = {
          x: S(size.x) / bbox.GetSize().x,
          y: S(size.y) / bbox.GetSize().y,
        };

        const polySet = new SHAPE_POLY_SET();

        for (const contour of contours) {
          for (let i = 0; i < contour.PointCount(); i++) {
            const pt = contour.CPoint(i);
            // VECTOR2I( double, double ): each product truncated to int
            contour.SetPoint(i, { x: Math.trunc(pt.x * scale.x), y: Math.trunc(pt.y * scale.y) });
          }

          polySet.AddOutline(contour);
        }

        polySet.RebuildHolesFromContours();

        let group: PCB_GROUP | null = null;

        if (polySet.OutlineCount() > 1) group = new PCB_GROUP(aBoard);

        const polyBBox = polySet.BBox();

        for (const poly of polySet.CPolygons()) {
          const shape = new PCB_SHAPE(aBoard, SHAPE_T.POLY);

          shape.SetFilled(true);
          shape.SetPolyShape(new SHAPE_POLY_SET(poly));
          shape.SetLayer(klayer);
          shape.SetWidth(0);

          const sp = P(start);
          const origin = polyBBox.GetOrigin();
          shape.Move(toI({ x: sp.x - origin.x, y: sp.y - origin.y }));
          shape.Rotate(toI(sp), new EDA_ANGLE(angle));

          if (IsBackLayer(klayer) !== (mirror !== 0)) {
            const flipDirection = IsBackLayer(klayer)
              ? FLIP_DIRECTION.TOP_BOTTOM
              : FLIP_DIRECTION.LEFT_RIGHT;
            shape.Mirror(toI(sp), flipDirection);
          }

          if (group) group.AddItem(shape);

          aBoard.Add(shape, ADD_MODE.APPEND);
        }

        if (group) aBoard.Add(group, ADD_MODE.APPEND);
      } else if (type === 'OBJ') {
        this.parseObj(aBoard, line, aBlobMap);
      } else if (type === 'STRING') {
        jStr(jAt(line, 1)); // uuid

        const layer = jInt(jAt(line, 3));
        const klayer = this.LayerToKi(layer);

        const location = vec(line, 4, 5);
        const string = jStr(jAt(line, 6));
        const font = jStr(jAt(line, 7));

        const height = jNum(jAt(line, 8));
        const strokew = jNum(jAt(line, 9));

        const align = jInt(jAt(line, 12));
        const angle = jNum(jAt(line, 13));
        const inverted = jInt(jAt(line, 14));
        const mirror = jInt(jAt(line, 16));

        const text = new PCB_TEXT(aBoard);

        text.SetText(string);
        text.SetLayer(klayer);
        text.SetPosition(toI(P(location)));
        text.SetIsKnockout(inverted !== 0);
        text.SetTextThickness(S(strokew));
        text.SetTextSize(toI({ x: S(height * 0.6), y: S(height * 0.7) }));

        if (font !== 'default') {
          text.SetFont(FONT.GetFont(font));
          //text->SetupRenderCache( text->GetShownText(), text->GetFont(), EDA_ANGLE( angle, DEGREES_T ) );

          //text->AddRenderCacheGlyph();
          // TODO: import geometry cache
        }

        AlignText(text, align);

        if (IsBackLayer(klayer) !== (mirror !== 0)) {
          text.SetMirrored(true);
          text.SetTextAngleDegrees(-angle);
        } else {
          text.SetTextAngleDegrees(angle);
        }

        aBoard.Add(text, ADD_MODE.APPEND);
      } else if (type === 'COMPONENT') {
        pushComponentLine(jStr(jAt(line, 1)), line);
      } else if (type === 'ATTR') {
        pushComponentLine(jStr(jAt(line, 3)), line);
      } else if (type === 'PAD_NET') {
        pushComponentLine(jStr(jAt(line, 1)), line);
      }
    }

    for (const compId of [...componentLines.keys()].sort(wxLess)) {
      const lines = componentLines.get(compId)!;

      let deviceId = '';
      let fpIdOverride = '';
      let fpDesignator = '';
      let localCompAttribs = new Map<string, string>();

      for (const line of lines) {
        if (jSize(line) === 0) continue;

        const type = jStr(jAt(line, 0));

        if (type === 'COMPONENT') {
          localCompAttribs = jMap(jAt(line, 7), jStr);
        } else if (type === 'ATTR') {
          const attr = PCB_ATTR_from_json(line);

          if (attr.key === 'Device') deviceId = attr.value;
          else if (attr.key === 'Footprint') fpIdOverride = attr.value;
          else if (attr.key === 'Designator') fpDesignator = attr.value;
        }
      }

      if (deviceId === '') continue;

      const compAttrs = jAt(jAt(jAt(aProject, 'devices'), deviceId), 'attributes');

      let fpId: string;

      if (fpIdOverride !== '') fpId = fpIdOverride;
      else fpId = jStr(jAt(compAttrs, 'Footprint'));

      const footprintOrig = aFootprintMap.get(fpId);

      if (footprintOrig === undefined) {
        this.m_logError?.(`Footprint of '${fpDesignator}' with uuid '${fpId}' not found.`);
        continue;
      }

      const footprint = footprintOrig.Clone() as FOOTPRINT;

      let modelUuid: string;
      let modelTitle: string;
      let modelTransform: string;

      const lu = localCompAttribs.get('3D Model');
      modelUuid = lu !== undefined ? lu : jValue(compAttrs, '3D Model', '', jStr);

      const lt = localCompAttribs.get('3D Model Title');
      modelTitle = trimRight(
        lt !== undefined ? lt : jValue(compAttrs, '3D Model Title', modelUuid, jStr),
      );

      const lx = localCompAttribs.get('3D Model Transform');
      modelTransform = lx !== undefined ? lx : jValue(compAttrs, '3D Model Transform', '', jStr);

      this.fillFootprintModelInfo(footprint, modelUuid, modelTitle, modelTransform);

      footprint.SetParent(aBoard);

      for (const line of lines) {
        if (jSize(line) === 0) continue;

        const type = jStr(jAt(line, 0));

        if (type === 'COMPONENT') {
          const layer = jInt(jAt(line, 3));
          const klayer = this.LayerToKi(layer);

          const center = vec(line, 4, 5);

          const orient = jNum(jAt(line, 6));
          //std::map<wxString, wxString> props = line.at( 7 );

          if (klayer === B_Cu) footprint.Flip(footprint.GetPosition(), FLIP_DIRECTION.TOP_BOTTOM);

          footprint.SetOrientationDegrees(orient);
          footprint.SetPosition(toI(P(center)));
        } else if (type === 'ATTR') {
          const attr = PCB_ATTR_from_json(line);

          const klayer = this.LayerToKi(attr.layer);

          if (attr.key === 'Designator') {
            const field = footprint.GetField(FIELD_T.REFERENCE);

            if (attr.fontName !== 'default') field.SetFont(FONT.GetFont(attr.fontName));

            if (attr.valVisible && attr.keyVisible) {
              field.SetText(`${attr.key}:${attr.value}`);
            } else if (attr.keyVisible) {
              field.SetText(attr.key);
            } else {
              field.SetVisible(false);
              field.SetText(attr.value);
            }

            field.SetLayer(klayer);
            field.SetPosition(toI(P(attr.position)));
            field.SetTextAngleDegrees(footprint.IsFlipped() ? -attr.rotation : attr.rotation);
            field.SetIsKnockout(attr.inverted !== 0);
            field.SetTextThickness(S(attr.strokeWidth));
            field.SetTextSize(toI({ x: S(attr.height * 0.55), y: S(attr.height * 0.6) }));

            AlignText(field, attr.textOrigin);
          }
        } else if (type === 'PAD_NET') {
          const padNumber = jStr(jAt(line, 2));
          const padNet = jStr(jAt(line, 3));

          const pad = footprint.FindPadByNumber(padNumber);

          if (pad) {
            pad.SetNet(this.getNet(aBoard, padNet));
          } else {
            // Not a pad
          }
        }
      }

      aBoard.Add(footprint, ADD_MODE.APPEND);
    }

    // Set zone fills
    if (IMPORT_POURED) {
      for (const uuid of [...poursToFill.keys()].sort(wxLess)) {
        this.fillPour(poursToFill.get(uuid)!, boardPouredMap.get(uuid) ?? []);
      }
    }

    // Heal board outlines
    const shapes: PCB_SHAPE[] = [];

    for (const item of aBoard.Drawings()) {
      if (!item.IsOnLayer(Edge_Cuts)) continue;

      if (item.Type() === KICAD_T.PCB_SHAPE_T) shapes.push(item as PCB_SHAPE);
    }

    ConnectBoardShapes(shapes, SHAPE_JOIN_DISTANCE);

    // Center the board
    const outlineBbox = aBoard.ComputeBoundingBox(true, true);
    const pageInfo = aBoard.GetPageSettings();

    // `GetWidthMils() / 2`: an int halved as an int
    const pageCenter = {
      x: pcbIUScale.milsToIU(Math.trunc(pageInfo.GetWidthMils() / 2)),
      y: pcbIUScale.milsToIU(Math.trunc(pageInfo.GetHeightMils() / 2)),
    };

    const bc = outlineBbox.GetCenter();
    const offset = { x: pageCenter.x - bc.x, y: pageCenter.y - bc.y };

    const alignGrid = pcbIUScale.mmToIU(10);
    offset.x = KiROUND(offset.x / alignGrid) * alignGrid;
    offset.y = KiROUND(offset.y / alignGrid) * alignGrid;

    aBoard.Move(offset);
    bds.SetAuxOrigin(offset);
  }

  /** `wxLogError` sink; the plugin points it at its reporter. */
  m_logError: ((aMessage: string) => void) | null = null;

  /** The `IMPORT_POURED` block for one pour: its POURED records into a fill. */
  private fillPour(zone: ZONE, poureds: readonly POURED[]): void {
    const fillPolySet = new SHAPE_POLY_SET();
    const thermalSpokes = new SHAPE_POLY_SET();

    for (const poured of poureds) {
      const thisPoly = new SHAPE_POLY_SET();

      for (let dataId = 0; dataId < jSize(poured.polyData); dataId++) {
        const fillData = jAt(poured.polyData, dataId);
        const ptScale = 10;

        const contour = this.ParseContour(fillData, false, Math.trunc(ARC_HIGH_DEF / ptScale));

        // Scale the fill
        for (let i = 0; i < contour.PointCount(); i++) {
          const p = contour.GetPoint(i);
          contour.SetPoint(i, { x: p.x * ptScale, y: p.y * ptScale });
        }

        if (poured.isPoly) {
          contour.SetClosed(true);

          // The contour can be self-intersecting
          const simple = new SHAPE_POLY_SET(contour);
          simple.Simplify();

          if (dataId === 0) thisPoly.Append(simple);
          else thisPoly.BooleanSubtract(simple);
        } else {
          const thermalWidth = pcbIUScale.mmToIU(0.2); // Generic

          for (let segId = 0; segId < contour.SegmentCount(); segId++) {
            const seg = contour.CSegment(segId);

            for (const poly of transformOvalToPolygon(
              seg.A,
              seg.B,
              thermalWidth,
              ARC_HIGH_DEF,
              ERROR_LOC.ERROR_INSIDE,
            )) {
              // each polygon: its outline, then any holes
              poly.forEach((ring, ri) => {
                const chain = new SHAPE_LINE_CHAIN();
                for (const p of ring) chain.Append(p.x, p.y);
                chain.SetClosed(true);
                if (ri === 0) thermalSpokes.AddOutline(chain);
                else thermalSpokes.AddHole(chain);
              });
            }
          }
        }
      }

      fillPolySet.Append(thisPoly);
    }

    if (!fillPolySet.IsEmpty()) {
      fillPolySet.Simplify();

      const strokeWidth = pcbIUScale.milsToIU(8); // Seems to be 8 mils

      fillPolySet.Inflate(
        Math.trunc(strokeWidth / 2),
        CornerStrategy.ROUND_ALL_CORNERS,
        ARC_HIGH_DEF,
        false,
      );

      fillPolySet.BooleanAdd(thermalSpokes);

      fillPolySet.Fracture();

      zone.SetFilledPolysList(zone.GetFirstLayer(), fillPolySet);
      zone.SetNeedRefill(false);
      zone.SetIsFilled(true);
    }
  }

  /** The `OBJ` record: an embedded bitmap, placed as a PCB_REFERENCE_IMAGE. */
  private parseObj(aBoard: BOARD, line: JSON_VALUE, aBlobMap: ReadonlyMap<string, BLOB>): void {
    const S = PCB_IO_EASYEDAPRO_PARSER.ScaleSize;

    let mimeType = '';
    let base64Data = '';

    if (!isNumber(jAt(line, 3))) return;

    const layer = jInt(jAt(line, 3));
    const klayer = this.LayerToKi(layer);

    const start = vec(line, 5, 6);
    const size = vec(line, 7, 8);
    const angle = jNum(jAt(line, 9));
    const flipped = jInt(jAt(line, 10));

    const imageUrl = jStr(jAt(line, 11));

    if (beforeFirst(imageUrl, ':') === 'blob') {
      const objectId = imageUrl.substring(imageUrl.lastIndexOf(':') + 1);

      const blob = aBlobMap.get(objectId);

      if (blob !== undefined) {
        const blobUrl = blob.url;

        if (beforeFirst(blobUrl, ':') === 'data') {
          const afterColon = afterFirst(blobUrl, ':');
          const paramsArr = wxSplit(beforeFirst(afterColon, ','), ';', '');

          base64Data = afterFirst(blobUrl, ',');

          if (paramsArr.length > 0) mimeType = paramsArr[0]!;
        }
      }
    }

    const kstart = PCB_IO_EASYEDAPRO_PARSER.ScalePos(start);
    const ksize = PCB_IO_EASYEDAPRO_PARSER.ScaleSizeV(size);

    if (mimeType === '' || base64Data === '') return;

    const buf = base64Decode(base64Data);

    if (mimeType === 'image/svg+xml') {
      // Not yet supported by EasyEDA
    } else {
      const kcenter = { x: kstart.x + ksize.x / 2, y: kstart.y + ksize.y / 2 };

      const bitmap = new PCB_REFERENCE_IMAGE(aBoard, toI(kcenter), klayer);
      const refImage = bitmap.GetReferenceImage();

      if (refImage.ReadImageFile(buf)) {
        const scaleFactor = S(size.x) / refImage.GetSize().x;
        refImage.SetImageScale(scaleFactor);

        // TODO: support non-90-deg angles
        bitmap.Rotate(toI(kstart), new EDA_ANGLE(angle));

        if (flipped) {
          const x = MIRRORVAL(bitmap.GetPosition().x, KiROUND(kstart.x));
          bitmap.SetPosition({ x, y: bitmap.GetPosition().y });

          refImage.MutableImage().Mirror(FLIP_DIRECTION.LEFT_RIGHT);
        }

        aBoard.Add(bitmap, ADD_MODE.APPEND);
      }
    }
  }
}

/** `std::map< wxString, … >` order: wxString::compare, UTF-32 code units. */
function wxLess(a: string, b: string): number {
  const n = Math.min(a.length, b.length);

  for (let i = 0; i < n; i++) {
    const ca = a.codePointAt(i)!;
    const cb = b.codePointAt(i)!;

    if (ca !== cb) return ca < cb ? -1 : 1;

    if (ca > 0xffff) i++;
  }

  return a.length - b.length;
}

function beforeFirst(s: string, c: string): string {
  const i = s.indexOf(c);
  return i < 0 ? s : s.substring(0, i);
}

function afterFirst(s: string, c: string): string {
  const i = s.indexOf(c);
  return i < 0 ? '' : s.substring(i + 1);
}

/** `wxBase64Decode( s )` (strict): the bytes, or an empty buffer when the text is not base64. */
function base64Decode(s: string): Uint8Array {
  try {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return new Uint8Array();
  }
}

/** `RotatePoint( VECTOR2D&, const VECTOR2D& aCentre, EDA_ANGLE )`. */
function rotateD(p: Vec2, c: Vec2, a: EDA_ANGLE): Vec2 {
  const r = RotatePointD({ x: p.x - c.x, y: p.y - c.y }, a);
  return { x: r.x + c.x, y: r.y + c.y };
}
