// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PCB_IO_KICAD_SEXPR_PARSER`'s item readers (pcb_io_kicad_sexpr_parser.cpp
 * from :3230): one function per `parseXxx`, in the C++ order, over the
 * token reader in pcb_io_kicad_sexpr_parser.ts. Split from the class only
 * for file size; they are its methods in all but syntax, and each builds
 * the item class exactly as the C++ does — a footprint child is read in
 * footprint-relative coordinates and turned into board coordinates with
 * `Rotate( { 0, 0 }, fp->GetOrientation() )` + `Move( fp->GetPosition() )`.
 */

import { DSNLEXER, T, type Tok } from '@ziroeda/common/dsnlexer.js';
import { ParseEmbedded } from '@ziroeda/common/embedded_files.js';
import { FILL_T, SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { EDA_TEXT } from '@ziroeda/common/eda_text.js';
import { FetchUnitsFromString, pcbIUScale } from '@ziroeda/common/eda_units.js';
import { convertToNewOverbarNotation } from '@ziroeda/common/string_utils.js';
import { FUTURE_FORMAT_ERROR, IO_ERROR, PARSE_ERROR } from '@ziroeda/common/exceptions.js';
import { type KIID, kiidFromString } from '@ziroeda/common/kiid.js';
import {
  B_Cu,
  B_Fab,
  Edge_Cuts,
  F_Cu,
  F_Fab,
  IsCopperLayer,
  Margin,
  type PCB_LAYER_ID,
  UNDEFINED_LAYER,
} from '@ziroeda/common/layer_id.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import { LINE_STYLE, STROKE_PARAMS, STROKE_PARAMS_PARSER } from '@ziroeda/common/stroke_params.js';
import { FIELD_T, GetUserFieldName } from '@ziroeda/common/template_fieldnames.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { ARC_HIGH_DEF } from '@ziroeda/kimath/src/base_units.js';
import {
  ERROR_LOC,
  RECT_CHAMFER_BOTTOM_LEFT,
  RECT_CHAMFER_BOTTOM_RIGHT,
  RECT_CHAMFER_TOP_LEFT,
  RECT_CHAMFER_TOP_RIGHT,
  RECT_NO_CHAMFER,
} from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { ANGLE_0, ANGLE_45, ANGLE_90, EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { SEG } from '@ziroeda/kimath/src/geometry/seg.js';
import { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import {
  CornerStrategy,
  SHAPE_POLY_SET,
  TransformOvalToPolygon,
} from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { BOARD } from '../../board.js';
import { DEFAULT_LINE_WIDTH } from '../../board_design_settings_defaults.js';
import type { BOARD_ITEM } from '../../board_item.js';
import { ADD_MODE, type BOARD_ITEM_CONTAINER } from '../../board_item_container.js';
import { ZONE_LAYER_OVERRIDE } from '../../board_item.js';
import {
  FOOTPRINT,
  FOOTPRINT_STACKUP,
  FP_BOARD_ONLY,
  FP_DNP,
  FP_EXCLUDE_FROM_BOM,
  FP_EXCLUDE_FROM_POS_FILES,
  FP_SMD,
  FP_THROUGH_HOLE,
  type FP_UNIT_INFO,
} from '../../footprint.js';
import { NETINFO_ITEM, NETINFO_LIST } from '../../netinfo.js';
import { PAD } from '../../pad.js';
import {
  CUSTOM_SHAPE_ZONE_MODE,
  PAD_ATTRIB,
  PAD_DRILL_POST_MACHINING_MODE,
  PAD_DRILL_SHAPE,
  PAD_PROP,
  PAD_SHAPE,
  PADSTACK,
  PADSTACK_MODE,
  type PADSTACK_POST_MACHINING_PROPS,
  UNCONNECTED_LAYER_MODE,
} from '../../padstack.js';
import { BARCODE_ECC_T, BARCODE_T, PCB_BARCODE } from '../../pcb_barcode.js';
import {
  DIM_ARROW_DIRECTION,
  DIM_PRECISION,
  DIM_TEXT_BORDER,
  DIM_TEXT_POSITION,
  DIM_UNITS_FORMAT,
  DIM_UNITS_MODE,
} from '../../pcb_dimension_types.js';
import {
  PCB_DIM_ALIGNED,
  PCB_DIM_CENTER,
  PCB_DIM_LEADER,
  PCB_DIM_ORTHOGONAL,
  PCB_DIM_RADIAL,
  type PCB_DIM_ORTHOGONAL_DIR,
  PCB_DIMENSION_BASE,
} from '../../pcb_dimension.js';
import { PCB_FIELD } from '../../pcb_field.js';
import { PCB_POINT } from '../../pcb_point.js';
import { PCB_REFERENCE_IMAGE } from '../../pcb_reference_image.js';
import { PCB_SHAPE } from '../../pcb_shape.js';
import { PCB_TABLE, PCB_TABLECELL } from '../../pcb_table.js';
import { PCB_TARGET } from '../../pcb_target.js';
import { PCB_TEXT } from '../../pcb_text.js';
import { PCB_TEXTBOX } from '../../pcb_textbox.js';
import { PCB_ARC, PCB_TRACK, PCB_VIA, VIATYPE } from '../../pcb_track.js';
import { TEARDROP_TYPE } from '../../teardrop/teardrop_types.js';
import { ZONE } from '../../zone.js';
import {
  ISLAND_REMOVAL_MODE,
  PLACEMENT_SOURCE_T,
  ZONE_BORDER_DISPLAY_STYLE,
  ZONE_FILL_MODE,
  ZONE_SETTINGS,
} from '../../zone_settings.js';
import { ZONE_CONNECTION } from '../../zones.js';
import {
  LEGACY_ARC_FORMATTING,
  LEGACY_NET_TIES,
  type PCB_IO_KICAD_SEXPR_PARSER,
  SEXPR_BOARD_FILE_VERSION,
} from './pcb_io_kicad_sexpr_parser.js';

/** `const_cast<KIID&>( item->m_Uuid ) = CurStrToKIID()`. */
function setUuid(aItem: BOARD_ITEM, aUuid: KIID): void {
  (aItem as { m_Uuid: KIID }).m_Uuid = aUuid;
}

// ---------------------------------------------------------------------------
// parsePCB_SHAPE (:3230)
// ---------------------------------------------------------------------------

export function parsePCB_SHAPE(
  p: PCB_IO_KICAD_SEXPR_PARSER,
  aParent: BOARD_ITEM | null,
): PCB_SHAPE {
  let token: Tok;
  const pt: VECTOR2I = { x: 0, y: 0 };
  const stroke = new STROKE_PARAMS(0, LINE_STYLE.SOLID);
  const shape = new PCB_SHAPE(aParent);

  switch (p.CurTok()) {
    case 'gr_arc':
    case 'fp_arc':
      shape.SetShape(SHAPE_T.ARC);
      token = p.NextTok();

      if (token === 'locked') {
        shape.SetLocked(true);
        token = p.NextTok();
      }

      if (token !== T.LEFT) p.Expecting(T.LEFT);

      token = p.NextTok();

      if (p.m_requiredVersion <= LEGACY_ARC_FORMATTING) {
        // In legacy files the start keyword actually gives the arc center...
        if (token !== 'start') p.Expecting('start');

        pt.x = p.parseBoardUnits('X coordinate');
        pt.y = p.parseBoardUnits('Y coordinate');
        shape.SetCenter(pt);
        p.NeedRIGHT();
        p.NeedLEFT();
        token = p.NextTok();

        // ... and the end keyword gives the start point of the arc
        if (token !== 'end') p.Expecting('end');

        pt.x = p.parseBoardUnits('X coordinate');
        pt.y = p.parseBoardUnits('Y coordinate');
        shape.SetStart(pt);
        p.NeedRIGHT();
        p.NeedLEFT();
        token = p.NextTok();

        if (token !== 'angle') p.Expecting('angle');

        shape.SetArcAngleAndEnd(new EDA_ANGLE(p.parseDoubleNext('arc angle')), true);
        p.NeedRIGHT();
      } else {
        const arc_start: VECTOR2I = { x: 0, y: 0 };
        const arc_mid: VECTOR2I = { x: 0, y: 0 };
        const arc_end: VECTOR2I = { x: 0, y: 0 };

        if (token !== 'start') p.Expecting('start');

        arc_start.x = p.parseBoardUnits('X coordinate');
        arc_start.y = p.parseBoardUnits('Y coordinate');
        p.NeedRIGHT();
        p.NeedLEFT();
        token = p.NextTok();

        if (token !== 'mid') p.Expecting('mid');

        arc_mid.x = p.parseBoardUnits('X coordinate');
        arc_mid.y = p.parseBoardUnits('Y coordinate');
        p.NeedRIGHT();
        p.NeedLEFT();
        token = p.NextTok();

        if (token !== 'end') p.Expecting('end');

        arc_end.x = p.parseBoardUnits('X coordinate');
        arc_end.y = p.parseBoardUnits('Y coordinate');
        p.NeedRIGHT();

        shape.SetArcGeometry(arc_start, arc_mid, arc_end);
      }

      break;

    case 'gr_circle':
    case 'fp_circle':
      shape.SetShape(SHAPE_T.CIRCLE);
      token = p.NextTok();

      if (token === 'locked') {
        shape.SetLocked(true);
        token = p.NextTok();
      }

      if (token !== T.LEFT) p.Expecting(T.LEFT);

      token = p.NextTok();

      if (token !== 'center') p.Expecting('center');

      pt.x = p.parseBoardUnits('X coordinate');
      pt.y = p.parseBoardUnits('Y coordinate');
      shape.SetStart(pt);
      p.NeedRIGHT();
      p.NeedLEFT();

      token = p.NextTok();

      if (token !== 'end') p.Expecting('end');

      pt.x = p.parseBoardUnits('X coordinate');
      pt.y = p.parseBoardUnits('Y coordinate');
      shape.SetEnd(pt);
      p.NeedRIGHT();
      break;

    case 'gr_curve':
    case 'fp_curve':
      shape.SetShape(SHAPE_T.BEZIER);
      token = p.NextTok();

      if (token === 'locked') {
        shape.SetLocked(true);
        token = p.NextTok();
      }

      if (token !== T.LEFT) p.Expecting(T.LEFT);

      token = p.NextTok();

      if (token !== 'pts') p.Expecting('pts');

      shape.SetStart(p.parseXY());
      shape.SetBezierC1(p.parseXY());
      shape.SetBezierC2(p.parseXY());
      shape.SetEnd(p.parseXY());

      if (p.m_board)
        shape.RebuildBezierToSegmentsPointsList(p.m_board.GetDesignSettings().m_MaxError);
      else shape.RebuildBezierToSegmentsPointsList(ARC_HIGH_DEF);

      p.NeedRIGHT();
      break;

    case 'gr_bbox':
    case 'gr_rect':
    case 'fp_rect':
      shape.SetShape(SHAPE_T.RECTANGLE);
      token = p.NextTok();

      if (token === 'locked') {
        shape.SetLocked(true);
        token = p.NextTok();
      }

      if (token !== T.LEFT) p.Expecting(T.LEFT);

      token = p.NextTok();

      if (token !== 'start') p.Expecting('start');

      pt.x = p.parseBoardUnits('X coordinate');
      pt.y = p.parseBoardUnits('Y coordinate');
      shape.SetStart(pt);
      p.NeedRIGHT();
      p.NeedLEFT();
      token = p.NextTok();

      if (token !== 'end') p.Expecting('end');

      pt.x = p.parseBoardUnits('X coordinate');
      pt.y = p.parseBoardUnits('Y coordinate');
      shape.SetEnd(pt);

      if (aParent && aParent.Type() === KICAD_T.PCB_FOOTPRINT_T) {
        // Footprint shapes are stored in board-relative coordinates, but we want the
        // normalization to remain in footprint-relative coordinates.
      } else {
        shape.Normalize();
      }

      p.NeedRIGHT();
      break;

    case 'gr_vector':
    case 'gr_line':
    case 'fp_line':
      shape.SetShape(SHAPE_T.SEGMENT);
      token = p.NextTok();

      if (token === 'locked') {
        shape.SetLocked(true);
        token = p.NextTok();
      }

      if (token !== T.LEFT) p.Expecting(T.LEFT);

      token = p.NextTok();

      if (token !== 'start') p.Expecting('start');

      pt.x = p.parseBoardUnits('X coordinate');
      pt.y = p.parseBoardUnits('Y coordinate');
      shape.SetStart(pt);
      p.NeedRIGHT();
      p.NeedLEFT();
      token = p.NextTok();

      if (token !== 'end') p.Expecting('end');

      pt.x = p.parseBoardUnits('X coordinate');
      pt.y = p.parseBoardUnits('Y coordinate');
      shape.SetEnd(pt);
      p.NeedRIGHT();
      break;

    case 'gr_poly':
    case 'fp_poly': {
      shape.SetShape(SHAPE_T.POLY);
      shape.SetPolyPoints([]);

      const outline = shape.GetPolyShape().Outline(0);

      token = p.NextTok();

      if (token === 'locked') {
        shape.SetLocked(true);
        token = p.NextTok();
      }

      if (token !== T.LEFT) p.Expecting(T.LEFT);

      token = p.NextTok();

      if (token !== 'pts') p.Expecting('pts');

      // biome-ignore lint/suspicious/noAssignInExpressions: the C++ loop shape
      while ((token = p.NextTok()) !== T.RIGHT) p.parseOutlinePoints(outline);

      break;
    }

    default:
      if (aParent && aParent.Type() === KICAD_T.PCB_FOOTPRINT_T) {
        p.Expecting('fp_arc, fp_circle, fp_curve, fp_line, fp_poly or fp_rect');
      } else {
        p.Expecting('gr_arc, gr_circle, gr_curve, gr_vector, gr_line, gr_poly, gr_rect or gr_bbox');
      }
  }

  let foundFill = false;

  for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
    if (token !== T.LEFT) p.Expecting(T.LEFT);

    token = p.NextTok();

    switch (token) {
      case 'angle': // legacy token; ignore value
        p.parseDoubleNext('arc angle');
        p.NeedRIGHT();
        break;

      case 'layer':
        shape.SetLayer(p.parseBoardItemLayer());
        p.NeedRIGHT();
        break;

      case 'layers':
        shape.SetLayerSet(p.parseBoardItemLayersAsMask());
        break;

      case 'solder_mask_margin':
        shape.SetLocalSolderMaskMargin(p.parseBoardUnits('local solder mask margin value'));
        p.NeedRIGHT();
        break;

      case 'width': // legacy token
        stroke.SetWidth(p.parseBoardUnits('width'));
        p.NeedRIGHT();
        break;

      case 'radius':
        shape.SetCornerRadius(p.parseBoardUnits('corner radius'));
        p.NeedRIGHT();
        break;

      case 'stroke': {
        const strokeParser = new STROKE_PARAMS_PARSER(p, pcbIUScale.IU_PER_MM);

        strokeParser.ParseStroke(stroke);
        break;
      }

      case 'tstamp':
      case 'uuid':
        p.NextTok();
        setUuid(shape, p.CurStrToKIID());
        p.NeedRIGHT();
        break;

      case 'fill':
        foundFill = true;

        for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
          if (token === T.LEFT) token = p.NextTok();

          switch (token) {
            // T_yes was used to indicate filling when first introduced, so treat it like a
            // solid fill since that was the only fill available at the time.
            case 'yes':
            case 'solid':
              shape.SetFillMode(FILL_T.FILLED_SHAPE);
              break;

            case 'none':
            case 'no':
              shape.SetFillMode(FILL_T.NO_FILL);
              break;

            case 'hatch':
              shape.SetFillMode(FILL_T.HATCH);
              break;
            case 'reverse_hatch':
              shape.SetFillMode(FILL_T.REVERSE_HATCH);
              break;
            case 'cross_hatch':
              shape.SetFillMode(FILL_T.CROSS_HATCH);
              break;

            default:
              p.Expecting('yes, no, solid, none, hatch, reverse_hatch or cross_hatch');
          }
        }

        break;

      case 'status': // legacy token; ignore value
        p.parseHex();
        p.NeedRIGHT();
        break;

      // Handle "(locked)" from 5.99 development, and "(locked yes)" from modern times
      case 'locked':
        shape.SetLocked(p.parseMaybeAbsentBool(true));
        break;

      case 'net':
        p.parseNet(shape);
        break;

      default:
        p.Expecting('layer, width, fill, tstamp, uuid, locked, net, status, or solder_mask_margin');
    }
  }

  if (!foundFill) {
    // Legacy versions didn't have a filled flag but allowed some shapes to indicate they
    // should be filled by specifying a 0 stroke-width.
    if (
      stroke.GetWidth() === 0 &&
      (shape.GetShape() === SHAPE_T.RECTANGLE || shape.GetShape() === SHAPE_T.CIRCLE)
    ) {
      shape.SetFilled(true);
    } else if (shape.GetShape() === SHAPE_T.POLY && shape.GetLayer() !== Edge_Cuts) {
      // Polygons on non-Edge_Cuts layers were always filled.
      shape.SetFilled(true);
    }
  }

  // Only filled shapes may have a zero line-width.  This is not permitted in KiCad but some
  // external tools can generate invalid files.
  if (stroke.GetWidth() <= 0 && !shape.IsAnyFill()) {
    stroke.SetWidth(pcbIUScale.mmToIU(DEFAULT_LINE_WIDTH));
  }

  shape.SetStroke(stroke);

  const parentFP = shape.GetParentFootprint();

  if (parentFP) {
    shape.Rotate({ x: 0, y: 0 }, parentFP.GetOrientation());
    shape.Move(parentFP.GetPosition());
  }

  return shape;
}

// ---------------------------------------------------------------------------
// parsePCB_REFERENCE_IMAGE (:3659)
// ---------------------------------------------------------------------------

export function parsePCB_REFERENCE_IMAGE(
  p: PCB_IO_KICAD_SEXPR_PARSER,
  aParent: BOARD_ITEM | null,
): PCB_REFERENCE_IMAGE {
  let token: Tok;
  const bitmap = new PCB_REFERENCE_IMAGE(aParent);

  for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
    if (token !== T.LEFT) p.Expecting(T.LEFT);

    token = p.NextTok();

    switch (token) {
      case 'at': {
        const pos: VECTOR2I = { x: 0, y: 0 };
        pos.x = p.parseBoardUnits('X coordinate');
        pos.y = p.parseBoardUnits('Y coordinate');
        bitmap.SetPosition(pos);
        p.NeedRIGHT();
        break;
      }

      case 'layer':
        bitmap.SetLayer(p.parseBoardItemLayer());
        p.NeedRIGHT();
        break;

      case 'scale': {
        const refImage = bitmap.GetReferenceImage();
        refImage.SetImageScale(p.parseDoubleNext('image scale factor'));

        if (!isNormal(refImage.GetImageScale())) refImage.SetImageScale(1.0);

        p.NeedRIGHT();
        break;
      }
      case 'data': {
        token = p.NextTok();

        const parts: string[] = [];

        while (token !== T.RIGHT) {
          if (!DSNLEXER.IsSymbol(token)) p.Expecting('base64 image data');

          parts.push(p.CurText());
          token = p.NextTok();
        }

        const buffer = base64Decode(parts.join(''));

        const refImage = bitmap.GetReferenceImage();
        if (!refImage.ReadImageFile(buffer)) throw new IO_ERROR('Failed to read image data.');

        break;
      }

      case 'locked': {
        // This has only ever been (locked yes) format
        const locked = p.parseBool();
        bitmap.SetLocked(locked);

        p.NeedRIGHT();
        break;
      }

      case 'uuid': {
        p.NextTok();
        setUuid(bitmap, p.CurStrToKIID());
        p.NeedRIGHT();
        break;
      }

      default:
        p.Expecting('at, layer, scale, data, locked or uuid');
    }
  }

  return bitmap;
}

/** `std::isnormal`: finite, non-zero, not subnormal. */
function isNormal(aValue: number): boolean {
  return Number.isFinite(aValue) && aValue !== 0 && Math.abs(aValue) >= 2.2250738585072014e-308;
}

/** `wxBase64Decode( data )`: an invalid string decodes to what could be read. */
export function base64Decode(aText: string): Uint8Array {
  let bin: string;

  try {
    bin = atob(aText.replace(/\s+/g, ''));
  } catch {
    return new Uint8Array(0);
  }

  const out = new Uint8Array(bin.length);

  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);

  return out;
}

// ---------------------------------------------------------------------------
// parsePCB_TEXT (:3757), parsePCB_TEXT_effects (:3838)
// ---------------------------------------------------------------------------

export function parsePCB_TEXT(
  p: PCB_IO_KICAD_SEXPR_PARSER,
  aParent: BOARD_ITEM | null,
  aBaseText: PCB_TEXT | null = null,
): PCB_TEXT {
  const parentFP = aParent instanceof FOOTPRINT ? aParent : null;
  let text: PCB_TEXT;

  let token = p.NextTok();

  // If a base text is provided, we have a derived text already parsed and just need to update it
  if (aBaseText) {
    text = aBaseText;
  } else if (parentFP) {
    switch (token) {
      case 'reference':
        text = new PCB_FIELD(parentFP, FIELD_T.REFERENCE);
        break;

      case 'value':
        text = new PCB_FIELD(parentFP, FIELD_T.VALUE);
        break;

      case 'user':
        text = new PCB_TEXT(parentFP);
        break;

      default:
        throw new IO_ERROR(`Cannot handle footprint text type ${p.CurText()}`);
    }

    token = p.NextTok();
  } else {
    text = new PCB_TEXT(aParent);
  }

  // Legacy bare locked token
  if (token === 'locked') {
    text.SetLocked(true);
    token = p.NextTok();
  }

  if (!DSNLEXER.IsSymbol(token) && token !== T.NUMBER) p.Expecting('text value');

  let value = p.CurText();
  value = value.replaceAll('%V', '${VALUE}');
  value = value.replaceAll('%R', '${REFERENCE}');
  text.SetText(value);

  p.NeedLEFT();

  parsePCB_TEXT_effects(p, text, aBaseText);

  if (parentFP) {
    // Convert hidden footprint text (which is no longer supported) into a hidden field
    if (!text.IsVisible() && text.Type() === KICAD_T.PCB_TEXT_T) {
      const fieldName = GetUserFieldName(parentFP.GetFields().length, false /* !DO_TRANSLATE */);
      return new PCB_FIELD(text, FIELD_T.USER, fieldName);
    }
  } else {
    // Hidden PCB text is no longer supported
    text.SetVisible(true);
  }

  return text;
}

export function parsePCB_TEXT_effects(
  p: PCB_IO_KICAD_SEXPR_PARSER,
  aText: PCB_TEXT,
  aBaseText: PCB_TEXT | null = null,
): void {
  const parent = aText.GetParent();
  const parentFP = parent instanceof FOOTPRINT ? parent : null;
  let hasAngle = false; // Old files do not have a angle specified.
  // in this case it is 0 expected to be 0
  let hasPos = false;

  // By default, texts in footprints have a locked rotation (i.e. rot = -90 ... 90 deg)
  if (parentFP) aText.SetKeepUpright(true);

  for (let token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
    if (token === T.LEFT) token = p.NextTok();

    switch (token) {
      case 'at': {
        const pt: VECTOR2I = { x: 0, y: 0 };

        hasPos = true;
        pt.x = p.parseBoardUnits('X coordinate');
        pt.y = p.parseBoardUnits('Y coordinate');
        aText.SetTextPos(pt);
        token = p.NextTok();

        if (p.CurTok() === T.NUMBER) {
          aText.SetTextAngle(new EDA_ANGLE(p.parseDouble()));
          hasAngle = true;
          token = p.NextTok();
        }

        // Legacy location of this token; presence implies true
        if (parentFP && p.CurTok() === 'unlocked') {
          aText.SetKeepUpright(false);
          token = p.NextTok();
        }

        if (token !== T.RIGHT) p.Expecting(T.RIGHT);

        break;
      }

      case 'layer':
        aText.SetLayer(p.parseBoardItemLayer());

        token = p.NextTok();

        if (token === 'knockout') {
          aText.SetIsKnockout(true);
          token = p.NextTok();
        }

        if (token !== T.RIGHT) p.Expecting(T.RIGHT);

        break;

      case 'tstamp':
      case 'uuid':
        p.NextTok();
        setUuid(aText, p.CurStrToKIID());
        p.NeedRIGHT();
        break;

      case 'hide': {
        // In older files, the hide token appears bare, and indicates hide==true.
        // In newer files, it will be an explicit bool in a list like (hide yes)
        const hide = p.parseMaybeAbsentBool(true);

        if (parentFP) aText.SetVisible(!hide);
        else p.Expecting('layer, effects, locked, render_cache, uuid or tstamp');

        break;
      }

      case 'locked':
        // Newer list-enclosed locked
        aText.SetLocked(p.parseBool());
        p.NeedRIGHT();
        break;

      // Confusingly, "unlocked" is not the opposite of "locked", but refers to "keep upright"
      case 'unlocked':
        if (parentFP) aText.SetKeepUpright(!p.parseBool());
        else p.Expecting('layer, effects, locked, render_cache or tstamp');

        p.NeedRIGHT();
        break;

      case 'effects':
        p.parseEDA_TEXT(aText as unknown as EDA_TEXT);
        break;

      case 'render_cache':
        p.parseRenderCache(aText as unknown as EDA_TEXT);
        break;

      default:
        if (parentFP) p.Expecting('layer, hide, effects, locked, render_cache or tstamp');
        else p.Expecting('layer, effects, locked, render_cache or tstamp');
    }
  }

  // If there is no orientation defined, then it is the default value of 0 degrees.
  if (!hasAngle) aText.SetTextAngle(ANGLE_0);

  if (parentFP && !(aBaseText instanceof PCB_DIMENSION_BASE)) {
    // make PCB_TEXT rotation relative to the parent footprint.
    // It was read as absolute rotation from file
    // Note: this is not rue for PCB_DIMENSION items that use the board
    // coordinates
    aText.SetTextAngle(aText.GetTextAngle().sub(parentFP.GetOrientation()));

    // Move and rotate the text to its board coordinates
    aText.Rotate({ x: 0, y: 0 }, parentFP.GetOrientation());

    // Only move offset from parent position if we read a position from the file.
    // These positions are relative to the parent footprint. If we don't have a position
    // then the text defaults to the parent position and moving again will double it.
    if (hasPos) aText.Move(parentFP.GetPosition());
  }
}

// ---------------------------------------------------------------------------
// parsePCB_BARCODE (:3979)
// ---------------------------------------------------------------------------

export function parsePCB_BARCODE(
  p: PCB_IO_KICAD_SEXPR_PARSER,
  aParent: BOARD_ITEM | null,
): PCB_BARCODE {
  const barcode = new PCB_BARCODE(aParent);

  for (let token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
    if (token !== T.LEFT) p.Expecting(T.LEFT);

    token = p.NextTok();

    switch (token) {
      case 'at': {
        const pos: VECTOR2I = { x: 0, y: 0 };
        pos.x = p.parseBoardUnits('X coordinate');
        pos.y = p.parseBoardUnits('Y coordinate');
        barcode.SetPosition(pos);
        token = p.NextTok();

        if (p.CurTok() === T.NUMBER) barcode.SetOrientation(p.parseDouble());

        p.NeedRIGHT();
        break;
      }

      case 'layer':
        barcode.SetLayer(p.parseBoardItemLayer());
        p.NeedRIGHT();
        break;

      case 'size': {
        const w = p.parseBoardUnits('barcode width');
        const h = p.parseBoardUnits('barcode height');
        barcode.SetWidth(w);
        barcode.SetHeight(h);
        p.NeedRIGHT();
        break;
      }

      case 'text':
        if (p.NextTok() !== T.STRING) p.Expecting(T.STRING);

        barcode.SetText(p.CurText());
        p.NeedRIGHT();
        break;

      case 'text_height': {
        const h = p.parseBoardUnits('barcode text height');
        barcode.SetTextSize(h);
        p.NeedRIGHT();
        break;
      }

      case 'type':
        p.NeedSYMBOL();
        {
          const kind = p.CurText();
          if (kind === 'code39') barcode.SetKind(BARCODE_T.CODE_39);
          else if (kind === 'code128') barcode.SetKind(BARCODE_T.CODE_128);
          else if (kind === 'datamatrix' || kind === 'data_matrix')
            barcode.SetKind(BARCODE_T.DATA_MATRIX);
          else if (kind === 'qr' || kind === 'qrcode') barcode.SetKind(BARCODE_T.QR_CODE);
          else if (kind === 'microqr' || kind === 'micro_qr')
            barcode.SetKind(BARCODE_T.MICRO_QR_CODE);
          else p.Expecting('barcode type');
        }
        p.NeedRIGHT();
        break;

      case 'ecc_level':
        p.NeedSYMBOL();
        {
          const ecc = p.CurText();
          if (ecc === 'L' || ecc === 'l') barcode.SetErrorCorrection(BARCODE_ECC_T.L);
          else if (ecc === 'M' || ecc === 'm') barcode.SetErrorCorrection(BARCODE_ECC_T.M);
          else if (ecc === 'Q' || ecc === 'q') barcode.SetErrorCorrection(BARCODE_ECC_T.Q);
          else if (ecc === 'H' || ecc === 'h') barcode.SetErrorCorrection(BARCODE_ECC_T.H);
          else p.Expecting('ecc level');
        }
        p.NeedRIGHT();
        break;

      case 'locked':
        barcode.SetLocked(p.parseMaybeAbsentBool(true));
        break;

      case 'tstamp':
      case 'uuid':
        p.NextTok();
        setUuid(barcode, p.CurStrToKIID());
        p.NeedRIGHT();
        break;

      case 'hide':
        barcode.SetShowText(!p.parseBool());
        p.NeedRIGHT();
        break;

      case 'knockout':
        barcode.SetIsKnockout(p.parseBool());
        p.NeedRIGHT();
        break;

      case 'margins': {
        const marginX = p.parseBoardUnits('margin X');
        const marginY = p.parseBoardUnits('margin Y');
        barcode.SetMargin({ x: marginX, y: marginY });
        p.NeedRIGHT();
        break;
      }

      default:
        p.Expecting(
          'at, layer, size, text, text_height, type, ecc_level, locked, hide, knockout, margins or uuid',
        );
    }
  }

  barcode.AssembleBarcode();

  return barcode;
}

// ---------------------------------------------------------------------------
// parsePCB_TEXTBOX (:4122), parsePCB_TABLECELL (:4135), parseTextBoxContent (:4148)
// ---------------------------------------------------------------------------

export function parsePCB_TEXTBOX(
  p: PCB_IO_KICAD_SEXPR_PARSER,
  aParent: BOARD_ITEM | null,
): PCB_TEXTBOX {
  const textbox = new PCB_TEXTBOX(aParent);

  parseTextBoxContent(p, textbox);

  return textbox;
}

export function parsePCB_TABLECELL(
  p: PCB_IO_KICAD_SEXPR_PARSER,
  aParent: BOARD_ITEM | null,
): PCB_TABLECELL {
  const cell = new PCB_TABLECELL(aParent);

  parseTextBoxContent(p, cell);

  return cell;
}

export function parseTextBoxContent(p: PCB_IO_KICAD_SEXPR_PARSER, aTextBox: PCB_TEXTBOX): void {
  const stroke = new STROKE_PARAMS(-1, LINE_STYLE.SOLID);
  let foundMargins = false;

  let token = p.NextTok();

  // Legacy locked
  if (token === 'locked') {
    aTextBox.SetLocked(true);
    token = p.NextTok();
  }

  if (!DSNLEXER.IsSymbol(token) && token !== T.NUMBER) p.Expecting('text value');

  aTextBox.SetText(p.CurText());

  for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
    if (token !== T.LEFT) p.Expecting(T.LEFT);

    token = p.NextTok();

    switch (token) {
      case 'locked':
        aTextBox.SetLocked(p.parseMaybeAbsentBool(true));
        break;

      case 'start': {
        let x = p.parseBoardUnits('X coordinate');
        let y = p.parseBoardUnits('Y coordinate');
        aTextBox.SetStart({ x, y });
        p.NeedRIGHT();

        p.NeedLEFT();
        token = p.NextTok();

        if (token !== 'end') p.Expecting('end');

        x = p.parseBoardUnits('X coordinate');
        y = p.parseBoardUnits('Y coordinate');
        aTextBox.SetEnd({ x, y });
        p.NeedRIGHT();
        break;
      }

      case 'pts': {
        aTextBox.SetShape(SHAPE_T.POLY);
        aTextBox.GetPolyShape().RemoveAllContours();
        aTextBox.GetPolyShape().NewOutline();

        // biome-ignore lint/suspicious/noAssignInExpressions: the C++ loop shape
        while ((token = p.NextTok()) !== T.RIGHT)
          p.parseOutlinePoints(aTextBox.GetPolyShape().Outline(0));

        break;
      }

      case 'angle':
        // Set the angle of the text only, the coordinates of the box (a polygon) are
        // already at the right position, and must not be rotated
        EDA_TEXT.prototype.SetTextAngle.call(
          aTextBox as unknown as EDA_TEXT,
          new EDA_ANGLE(p.parseDoubleNext('text box angle')),
        );
        p.NeedRIGHT();
        break;

      case 'stroke': {
        const strokeParser = new STROKE_PARAMS_PARSER(p, pcbIUScale.IU_PER_MM);

        strokeParser.ParseStroke(stroke);
        break;
      }

      case 'border':
        aTextBox.SetBorderEnabled(p.parseBool());
        p.NeedRIGHT();
        break;

      case 'margins': {
        const { left, top, right, bottom } = p.parseMargins();
        aTextBox.SetMarginLeft(left);
        aTextBox.SetMarginTop(top);
        aTextBox.SetMarginRight(right);
        aTextBox.SetMarginBottom(bottom);
        foundMargins = true;
        p.NeedRIGHT();
        break;
      }

      case 'layer':
        aTextBox.SetLayer(p.parseBoardItemLayer());
        p.NeedRIGHT();
        break;

      case 'knockout':
        if (aTextBox instanceof PCB_TABLECELL) {
          p.Expecting(
            'locked, start, pts, angle, width, margins, layer, effects, span, render_cache, uuid or tstamp',
          );
        } else {
          aTextBox.SetIsKnockout(p.parseBool());
        }

        p.NeedRIGHT();
        break;

      case 'span':
        if (aTextBox instanceof PCB_TABLECELL) {
          aTextBox.SetColSpan(p.parseInt('column span'));
          aTextBox.SetRowSpan(p.parseInt('row span'));
        } else {
          p.Expecting(
            'locked, start, pts, angle, width, stroke, border, margins, knockout, layer, effects, render_cache, uuid or tstamp',
          );
        }

        p.NeedRIGHT();
        break;

      case 'tstamp':
      case 'uuid':
        p.NextTok();
        setUuid(aTextBox, p.CurStrToKIID());
        p.NeedRIGHT();
        break;

      case 'effects':
        p.parseEDA_TEXT(aTextBox as unknown as EDA_TEXT);
        break;

      case 'render_cache':
        p.parseRenderCache(aTextBox as unknown as EDA_TEXT);
        break;

      default:
        if (aTextBox instanceof PCB_TABLECELL) {
          p.Expecting(
            'locked, start, pts, angle, width, margins, layer, effects, span, render_cache, uuid or tstamp',
          );
        } else {
          p.Expecting(
            'locked, start, pts, angle, width, stroke, border, margins, knockout,layer, effects, render_cache, uuid or tstamp',
          );
        }
    }
  }

  aTextBox.SetStroke(stroke);

  if (p.m_requiredVersion < 20230825)
    // compat, we move to an explicit flag
    aTextBox.SetBorderEnabled(stroke.GetWidth() >= 0);

  if (!foundMargins) {
    const margin = aTextBox.GetLegacyTextMargin();
    aTextBox.SetMarginLeft(margin);
    aTextBox.SetMarginTop(margin);
    aTextBox.SetMarginRight(margin);
    aTextBox.SetMarginBottom(margin);
  }

  const parentFP = aTextBox.GetParentFootprint();

  if (parentFP) {
    aTextBox.Rotate({ x: 0, y: 0 }, parentFP.GetOrientation());
    aTextBox.Move(parentFP.GetPosition());
  }
}

// ---------------------------------------------------------------------------
// parsePCB_TABLE (:4333)
// ---------------------------------------------------------------------------

export function parsePCB_TABLE(
  p: PCB_IO_KICAD_SEXPR_PARSER,
  aParent: BOARD_ITEM | null,
): PCB_TABLE {
  let token: Tok;
  const borderStroke = new STROKE_PARAMS(-1, LINE_STYLE.SOLID);
  const separatorsStroke = new STROKE_PARAMS(-1, LINE_STYLE.SOLID);
  const table = new PCB_TABLE(aParent, -1);

  for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
    if (token !== T.LEFT) p.Expecting(T.LEFT);

    token = p.NextTok();

    switch (token) {
      case 'column_count':
        table.SetColCount(p.parseInt('column count'));
        p.NeedRIGHT();
        break;

      case 'uuid':
        p.NextTok();
        setUuid(table, p.CurStrToKIID());
        p.NeedRIGHT();
        break;

      case 'locked':
        table.SetLocked(p.parseBool());
        p.NeedRIGHT();
        break;

      case 'angle': // legacy token no longer used
        p.NeedRIGHT();
        break;

      case 'layer':
        table.SetLayer(p.parseBoardItemLayer());
        p.NeedRIGHT();
        break;

      case 'column_widths': {
        let col = 0;

        // biome-ignore lint/suspicious/noAssignInExpressions: the C++ loop shape
        while ((token = p.NextTok()) !== T.RIGHT) table.SetColWidth(col++, p.parseBoardUnitsCur());

        break;
      }

      case 'row_heights': {
        let row = 0;

        // biome-ignore lint/suspicious/noAssignInExpressions: the C++ loop shape
        while ((token = p.NextTok()) !== T.RIGHT) table.SetRowHeight(row++, p.parseBoardUnitsCur());

        break;
      }

      case 'cells':
        for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
          if (token !== T.LEFT) p.Expecting(T.LEFT);

          token = p.NextTok();

          if (token !== 'table_cell') p.Expecting('table_cell');

          table.AddCell(parsePCB_TABLECELL(p, table));
        }

        break;

      case 'border':
        for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
          if (token !== T.LEFT) p.Expecting(T.LEFT);

          token = p.NextTok();

          switch (token) {
            case 'external':
              table.SetStrokeExternal(p.parseBool());
              p.NeedRIGHT();
              break;

            case 'header':
              table.SetStrokeHeaderSeparator(p.parseBool());
              p.NeedRIGHT();
              break;

            case 'stroke': {
              const strokeParser = new STROKE_PARAMS_PARSER(p, pcbIUScale.IU_PER_MM);

              strokeParser.ParseStroke(borderStroke);

              table.SetBorderStroke(borderStroke);
              break;
            }

            default:
              p.Expecting('external, header or stroke');
              break;
          }
        }

        break;

      case 'separators':
        for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
          if (token !== T.LEFT) p.Expecting(T.LEFT);

          token = p.NextTok();

          switch (token) {
            case 'rows':
              table.SetStrokeRows(p.parseBool());
              p.NeedRIGHT();
              break;

            case 'cols':
              table.SetStrokeColumns(p.parseBool());
              p.NeedRIGHT();
              break;

            case 'stroke': {
              const strokeParser = new STROKE_PARAMS_PARSER(p, pcbIUScale.IU_PER_MM);

              strokeParser.ParseStroke(separatorsStroke);

              table.SetSeparatorsStroke(separatorsStroke);
              break;
            }

            default:
              p.Expecting('rows, cols, or stroke');
              break;
          }
        }

        break;

      default:
        p.Expecting('columns, layer, col_widths, row_heights, border, separators, header or cells');
    }
  }

  return table;
}

// ---------------------------------------------------------------------------
// parseDIMENSION (:4503)
// ---------------------------------------------------------------------------

export function parseDIMENSION(
  p: PCB_IO_KICAD_SEXPR_PARSER,
  aParent: BOARD_ITEM | null,
): PCB_DIMENSION_BASE {
  let token: Tok;
  let locked = false;
  let dim: PCB_DIMENSION_BASE | null = null;

  token = p.NextTok();

  // Free 'locked' token from 6.0/7.0 formats
  if (token === 'locked') {
    locked = true;
    token = p.NextTok();
  }

  // skip value that used to be saved
  if (token !== T.LEFT) p.NeedLEFT();

  token = p.NextTok();

  let isLegacyDimension = false;
  let isStyleKnown = false;

  // Old format
  if (token === 'width') {
    isLegacyDimension = true;
    dim = new PCB_DIM_ALIGNED(aParent);
    dim.SetLineThickness(p.parseBoardUnits('dimension width value'));
    p.NeedRIGHT();
  } else {
    if (token !== 'type') p.Expecting('type');

    switch (p.NextTok()) {
      case 'aligned':
        dim = new PCB_DIM_ALIGNED(aParent);
        break;
      case 'orthogonal':
        dim = new PCB_DIM_ORTHOGONAL(aParent);
        break;
      case 'leader':
        dim = new PCB_DIM_LEADER(aParent);
        break;
      case 'center':
        dim = new PCB_DIM_CENTER(aParent);
        break;
      case 'radial':
        dim = new PCB_DIM_RADIAL(aParent);
        break;
      default:
        // wxFAIL_MSG( "Cannot parse unknown dimension type" ): the C++ then dereferences a
        // null dim; a parse error is the honest equivalent.
        p.throwParse(`Cannot parse unknown dimension type ${p.CurText()}`);
    }

    p.NeedRIGHT();

    // Before parsing further, set default properites for old KiCad file
    // versions that didnt have these properties:
    dim.SetArrowDirection(DIM_ARROW_DIRECTION.OUTWARD);
  }

  for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
    if (token !== T.LEFT) p.Expecting(T.LEFT);

    token = p.NextTok();

    switch (token) {
      case 'layer':
        dim.SetLayer(p.parseBoardItemLayer());
        p.NeedRIGHT();
        break;

      case 'tstamp':
      case 'uuid':
        p.NextTok();
        setUuid(dim, p.CurStrToKIID());
        p.NeedRIGHT();
        break;

      case 'gr_text': {
        // In old pcb files, when parsing the text we do not yet know
        // if the text is kept aligned or not, and its DIM_TEXT_POSITION option.
        // Leave the text not aligned for now to read the text angle, and no
        // constraint for DIM_TEXT_POSITION in this case.
        // It will be set aligned (or not) later
        const is_aligned = dim.GetKeepTextAligned();
        const t_dim_pos = dim.GetTextPositionMode();

        if (!isStyleKnown) {
          dim.SetTextPositionMode(DIM_TEXT_POSITION.MANUAL);
          dim.SetKeepTextAligned(false);
        }

        parsePCB_TEXT(p, p.m_board, dim);

        if (isLegacyDimension) {
          const fetched = FetchUnitsFromString(dim.GetText());

          if (fetched === null) dim.SetAutoUnits(true); //Not determined => use automatic units

          dim.SetUnits(fetched ?? 'mm');
        }

        if (!isStyleKnown) {
          dim.SetKeepTextAligned(is_aligned);
          dim.SetTextPositionMode(t_dim_pos);
        }
        break;
      }

      // New format: feature points
      case 'pts': {
        let point = p.parseXY();
        dim.SetStart(point);
        point = p.parseXY();
        dim.SetEnd(point);

        p.NeedRIGHT();
        break;
      }

      case 'height': {
        const height = p.parseBoardUnits('dimension height value');
        p.NeedRIGHT();

        if (
          dim.Type() === KICAD_T.PCB_DIM_ORTHOGONAL_T ||
          dim.Type() === KICAD_T.PCB_DIM_ALIGNED_T
        ) {
          const aligned = dim as PCB_DIM_ALIGNED;
          aligned.SetHeight(height);
        }

        break;
      }

      case 'leader_length': {
        const length = p.parseBoardUnits('leader length value');
        p.NeedRIGHT();

        if (dim.Type() === KICAD_T.PCB_DIM_RADIAL_T) {
          const radial = dim as PCB_DIM_RADIAL;
          radial.SetLeaderLength(length);
        }

        break;
      }

      case 'orientation': {
        let orientation = p.parseInt('orthogonal dimension orientation');
        p.NeedRIGHT();

        if (dim.Type() === KICAD_T.PCB_DIM_ORTHOGONAL_T) {
          const ortho = dim as PCB_DIM_ORTHOGONAL;
          orientation = Math.min(Math.max(orientation, 0), 1);
          ortho.SetOrientation(orientation as PCB_DIM_ORTHOGONAL_DIR);
        }

        break;
      }

      case 'format': {
        for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
          switch (token) {
            case T.LEFT:
              continue;

            case 'prefix':
              p.NeedSYMBOLorNUMBER();
              dim.SetPrefix(p.CurText());
              p.NeedRIGHT();
              break;

            case 'suffix':
              p.NeedSYMBOLorNUMBER();
              dim.SetSuffix(p.CurText());
              p.NeedRIGHT();
              break;

            case 'units': {
              let mode = p.parseInt('dimension units mode');
              mode = Math.max(0, Math.min(4, mode));
              dim.SetUnitsMode(mode as DIM_UNITS_MODE);
              p.NeedRIGHT();
              break;
            }

            case 'units_format': {
              let format = p.parseInt('dimension units format');
              format = Math.min(Math.max(format, 0), 3);
              dim.SetUnitsFormat(format as DIM_UNITS_FORMAT);
              p.NeedRIGHT();
              break;
            }

            case 'precision':
              dim.SetPrecision(p.parseInt('dimension precision') as DIM_PRECISION);
              p.NeedRIGHT();
              break;

            case 'override_value':
              p.NeedSYMBOLorNUMBER();
              dim.SetOverrideTextEnabled(true);
              dim.SetOverrideText(p.CurText());
              p.NeedRIGHT();
              break;

            case 'suppress_zeroes':
              dim.SetSuppressZeroes(p.parseMaybeAbsentBool(true));
              break;

            default:
              // std::cerr << "Unknown format token: " …
              p.Expecting(
                'prefix, suffix, units, units_format, precision, override_value, suppress_zeroes',
              );
          }
        }
        break;
      }

      case 'style': {
        isStyleKnown = true;

        // new format: default to keep text aligned off unless token is present
        dim.SetKeepTextAligned(false);

        for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
          switch (token) {
            case T.LEFT:
              continue;

            case 'thickness':
              dim.SetLineThickness(p.parseBoardUnits('extension line thickness value'));
              p.NeedRIGHT();
              break;

            case 'arrow_direction': {
              token = p.NextTok();

              if (token === 'inward') dim.ChangeArrowDirection(DIM_ARROW_DIRECTION.INWARD);
              else if (token === 'outward') dim.ChangeArrowDirection(DIM_ARROW_DIRECTION.OUTWARD);
              else p.Expecting('inward or outward');

              p.NeedRIGHT();
              break;
            }
            case 'arrow_length':
              dim.SetArrowLength(p.parseBoardUnits('arrow length value'));
              p.NeedRIGHT();
              break;

            case 'text_position_mode': {
              let mode = p.parseInt('text position mode');
              mode = Math.max(0, Math.min(3, mode));
              dim.SetTextPositionMode(mode as DIM_TEXT_POSITION);
              p.NeedRIGHT();
              break;
            }

            case 'extension_height': {
              if (!(dim instanceof PCB_DIM_ALIGNED)) p.throwParse('Invalid extension_height token');

              dim.SetExtensionHeight(p.parseBoardUnits('extension height value'));
              p.NeedRIGHT();
              break;
            }

            case 'extension_offset':
              dim.SetExtensionOffset(p.parseBoardUnits('extension offset value'));
              p.NeedRIGHT();
              break;

            case 'keep_text_aligned':
              dim.SetKeepTextAligned(p.parseMaybeAbsentBool(true));
              break;

            case 'text_frame': {
              if (dim.Type() !== KICAD_T.PCB_DIM_LEADER_T) p.throwParse('Invalid text_frame token');

              const leader = dim as PCB_DIM_LEADER;

              let textFrame = p.parseInt('text frame mode');
              textFrame = Math.min(Math.max(textFrame, 0), 3);
              leader.SetTextBorder(textFrame as DIM_TEXT_BORDER);
              p.NeedRIGHT();
              break;
            }

            default:
              p.Expecting(
                'thickness, arrow_length, arrow_direction, text_position_mode, extension_height, extension_offset',
              );
          }
        }

        break;
      }

      // Old format: feature1 stores a feature line.  We only care about the origin.
      case 'feature1': {
        p.NeedLEFT();
        token = p.NextTok();

        if (token !== 'pts') p.Expecting('pts');

        const point = p.parseXY();
        dim.SetStart(point);

        p.parseXY(); // Ignore second point
        p.NeedRIGHT();
        p.NeedRIGHT();
        break;
      }

      // Old format: feature2 stores a feature line.  We only care about the end point.
      case 'feature2': {
        p.NeedLEFT();
        token = p.NextTok();

        if (token !== 'pts') p.Expecting('pts');

        const point = p.parseXY();
        dim.SetEnd(point);

        p.parseXY(); // Ignore second point

        p.NeedRIGHT();
        p.NeedRIGHT();
        break;
      }

      case 'crossbar': {
        p.NeedLEFT();
        token = p.NextTok();

        if (token === 'pts') {
          // If we have a crossbar, we know we're an old aligned dim
          const aligned = dim as PCB_DIM_ALIGNED;

          // Old style: calculate height from crossbar
          const point1 = p.parseXY();
          const point2 = p.parseXY();
          aligned.UpdateHeight(point2, point1); // Yes, backwards intentionally
          p.NeedRIGHT();
        }

        p.NeedRIGHT();
        break;
      }

      // Arrow: no longer saved; no-op
      case 'arrow1a':
      case 'arrow1b':
      case 'arrow2a':
      case 'arrow2b':
        p.NeedLEFT();
        token = p.NextTok();

        if (token !== 'pts') p.Expecting('pts');

        p.parseXY();
        p.parseXY();
        p.NeedRIGHT();
        p.NeedRIGHT();
        break;

      // Handle (locked yes) from modern times
      case 'locked': {
        // Unsure if we ever wrote out (locked) for dimensions, so use maybeAbsent just in case
        const isLocked = p.parseMaybeAbsentBool(true);
        dim.SetLocked(isLocked);
        break;
      }

      default:
        p.Expecting(
          'layer, tstamp, uuid, gr_text, feature1, feature2, crossbar, arrow1a, arrow1b, arrow2a, or arrow2b',
        );
    }
  }

  if (locked) dim.SetLocked(true);

  dim.Update();

  return dim;
}

// ---------------------------------------------------------------------------
// parseFOOTPRINT (:4971), parseFOOTPRINT_unchecked (:4987)
// ---------------------------------------------------------------------------

export function parseFOOTPRINT(
  p: PCB_IO_KICAD_SEXPR_PARSER,
  aInitialComments: string[] | null = null,
): FOOTPRINT {
  try {
    return parseFOOTPRINT_unchecked(p, aInitialComments);
  } catch (parse_error) {
    if (parse_error instanceof PARSE_ERROR && p.IsTooRecent())
      throw new FUTURE_FORMAT_ERROR(parse_error, p.GetRequiredVersion());

    throw parse_error;
  }
}

function parseFOOTPRINT_unchecked(
  p: PCB_IO_KICAD_SEXPR_PARSER,
  aInitialComments: string[] | null,
): FOOTPRINT {
  let name: string;
  const pt: VECTOR2I = { x: 0, y: 0 };
  let token: Tok;
  const fpid = new LIB_ID();
  let attributes = 0;

  const footprint = new FOOTPRINT(p.m_board);

  footprint.SetInitialComments(aInitialComments);

  if (p.m_board)
    footprint.SetStaticComponentClass(p.m_board.GetComponentClassManager().GetNoneComponentClass());

  token = p.NextTok();

  if (!DSNLEXER.IsSymbol(token) && token !== T.NUMBER) p.Expecting('symbol|number');

  name = p.CurText();

  if (name !== '' && fpid.Parse(name, true) >= 0) {
    throw new IO_ERROR(
      `Invalid footprint ID in\nfile: ${p.CurSource()}\nline: ${p.CurLineNumber()}\noffset: ${p.CurOffset()}.`,
    );
  }

  const checkVersion = (): void => {
    if (p.m_requiredVersion > SEXPR_BOARD_FILE_VERSION) {
      throw new FUTURE_FORMAT_ERROR(`${p.m_requiredVersion}`, p.m_generatorVersion);
    }
  };

  for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
    if (token === T.LEFT) token = p.NextTok();

    switch (token) {
      case 'version': {
        // Theoretically a footprint nested in a PCB could declare its own version, though
        // as of writing this comment we don't do that. Just in case, take the greater
        // version.
        const this_version = p.parseInt('version');
        p.NeedRIGHT();
        p.raiseRequiredVersion(this_version);
        footprint.SetFileFormatVersionAtLoad(this_version);
        break;
      }

      case 'generator':
        // We currently ignore the generator when parsing. It is included in the file for manual
        // indication of where the footprint came from.
        p.NeedSYMBOL();
        p.NeedRIGHT();
        break;

      case 'generator_version': {
        p.NeedSYMBOL();
        p.m_generatorVersion = p.CurText();
        p.NeedRIGHT();

        // If the format includes a generator version, by this point we have enough info to
        // do the version check here
        checkVersion();

        break;
      }

      case 'locked':
        footprint.SetLocked(p.parseMaybeAbsentBool(true));
        break;

      case 'placed':
        footprint.SetIsPlaced(p.parseMaybeAbsentBool(true));
        break;

      case 'layer': {
        // Footprints can be only on the front side or the back side.
        // but because we can find some stupid layer in file, ensure a
        // acceptable layer is set for the footprint
        const layer = p.parseBoardItemLayer();
        footprint.SetLayer(layer === B_Cu ? B_Cu : F_Cu);
        p.NeedRIGHT();
        break;
      }

      case 'stackup': {
        parseFootprintStackup(p, footprint);
        break;
      }

      case 'tedit':
        p.parseHex();
        p.NeedRIGHT();
        break;

      case 'tstamp':
      case 'uuid':
        p.NextTok();
        setUuid(footprint, p.CurStrToKIID());
        p.NeedRIGHT();
        break;

      case 'at':
        pt.x = p.parseBoardUnits('X coordinate');
        pt.y = p.parseBoardUnits('Y coordinate');
        footprint.SetPosition(pt);
        token = p.NextTok();

        if (token === T.NUMBER) {
          footprint.SetOrientation(new EDA_ANGLE(p.parseDouble()));
          p.NeedRIGHT();
        } else if (token !== T.RIGHT) {
          p.Expecting(T.RIGHT);
        }

        break;

      case 'descr':
        p.NeedSYMBOLorNUMBER(); // some symbols can be 0508, so a number is also a symbol here
        footprint.SetLibDescription(p.CurText());
        p.NeedRIGHT();
        break;

      case 'tags':
        p.NeedSYMBOLorNUMBER(); // some symbols can be 0508, so a number is also a symbol here
        footprint.SetKeywords(p.CurText());
        p.NeedRIGHT();
        break;

      case 'property': {
        p.NeedSYMBOL();
        const pName = p.CurText();
        p.NeedSYMBOL();
        const pValue = p.CurText();

        // Prior to PCB fields, we used to use properties for special values instead of
        // using (keyword_example "value")
        if (p.m_requiredVersion < 20230620) {
          // Skip legacy non-field properties sent from symbols that should not be kept
          // in footprints.
          if (pName === 'ki_keywords' || pName === 'ki_locked') {
            p.NeedRIGHT();
            break;
          }

          // Description from symbol (not the fooprint library description stored in (descr) )
          // used to be stored as a reserved key value
          if (pName === 'ki_description') {
            footprint.GetField(FIELD_T.DESCRIPTION).SetText(pValue);
            p.NeedRIGHT();
            break;
          }

          // Sheet file and name used to be stored as properties invisible to the user
          if (pName === 'Sheetfile' || pName === 'Sheet file') {
            footprint.SetSheetfile(pValue);
            p.NeedRIGHT();
            break;
          }

          if (pName === 'Sheetname' || pName === 'Sheet name') {
            footprint.SetSheetname(pValue);
            p.NeedRIGHT();
            break;
          }
        }

        let field: PCB_FIELD;

        // 8.0.0rc3 had a bug where these properties were mistakenly added to the footprint as
        // fields, this will remove them as fields but still correctly set the footprint filters
        if (pName === 'ki_fp_filters') {
          footprint.SetFilters(pValue);

          // Use the text effect parsing function because it will handle ki_fp_filters as a
          // property with no text effects, but will also handle parsing the text effects.
          // We just drop the effects if they're present.
          field = new PCB_FIELD(footprint, FIELD_T.USER);
        } else if (pName === 'Footprint') {
          // Until V9, footprints had a Footprint field that usually (but not always)
          // duplicated the footprint's LIB_ID.  In V9 this was removed.  Parse it
          // like any other, but don't add it to anything.
          field = new PCB_FIELD(footprint, FIELD_T.FOOTPRINT);
        } else if (footprint.HasField(pName)) {
          field = footprint.GetField(pName)!;
          field.SetText(pValue);
        } else {
          field = new PCB_FIELD(footprint, FIELD_T.USER, pName);
          footprint.Add(field);

          field.SetText(pValue);
          field.SetLayer(footprint.GetLayer() === F_Cu ? F_Fab : B_Fab);

          if (p.m_board)
            // can be null when reading a lib
            field.StyleFromSettings(p.m_board.GetDesignSettings(), true);
        }

        // Hide the field by default if it is a legacy field that did not have
        // text effects applied, since hide is a negative effect
        if (p.m_requiredVersion < 20230620) field.SetVisible(false);
        else field.SetVisible(true);

        parsePCB_TEXT_effects(p, field);
        break;
      }

      case 'path':
        p.NeedSYMBOLorNUMBER(); // Paths can be numerical so a number is also a symbol here
        footprint.SetPath(kiidPathFromString(p.CurText()));
        p.NeedRIGHT();
        break;

      case 'sheetname':
        p.NeedSYMBOL();
        footprint.SetSheetname(p.CurText());
        p.NeedRIGHT();
        break;

      case 'sheetfile':
        p.NeedSYMBOL();
        footprint.SetSheetfile(p.CurText());
        p.NeedRIGHT();
        break;

      case 'units': {
        const unitInfos: FP_UNIT_INFO[] = [];

        // (units (unit (name "A") (pins "1" "2" ...)) ...)
        for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
          if (token === T.LEFT) token = p.NextTok();

          if (token === 'unit') {
            const info: FP_UNIT_INFO = { m_unitName: '', m_pins: [] };

            for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
              if (token === T.LEFT) token = p.NextTok();

              if (token === 'name') {
                p.NeedSYMBOLorNUMBER();
                info.m_unitName = p.CurText();
                p.NeedRIGHT();
              } else if (token === 'pins') {
                // Parse a flat list of quoted numbers or symbols until ')'
                for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
                  if (token === T.STRING || token === T.NUMBER) {
                    info.m_pins.push(p.CurText());
                  } else {
                    p.Expecting('pin number');
                  }
                }
              } else {
                // Unknown sub-token inside unit; skip its list if any
                p.skipCurrent();
              }
            }

            unitInfos.push(info);
          } else {
            // Unknown entry under units; skip
            p.skipCurrent();
          }
        }

        if (unitInfos.length > 0) footprint.SetUnitInfo(unitInfos);

        break;
      }

      case 'autoplace_cost90':
      case 'autoplace_cost180':
        p.parseInt('legacy auto-place cost');
        p.NeedRIGHT();
        break;

      case 'private_layers': {
        const privateLayers = new LSET();

        for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
          const it = p.m_layerIndices.get(p.CurText());

          if (it !== undefined) privateLayers.set(it);
          else p.Expecting('layer name');
        }

        if (p.m_requiredVersion < 20220427) {
          privateLayers.set(Edge_Cuts, false);
          privateLayers.set(Margin, false);
        }

        footprint.SetPrivateLayers(privateLayers);
        break;
      }

      case 'net_tie_pad_groups':
        for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok())
          footprint.AddNetTiePadGroup(p.CurText());

        break;

      case 'duplicate_pad_numbers_are_jumpers':
        footprint.SetDuplicatePadNumbersAreJumpers(p.parseBool());
        p.NeedRIGHT();
        break;

      case 'jumper_pad_groups': {
        // This should only be formatted if there is at least one group
        const groups = footprint.JumperPadGroups();
        let currentGroup: Set<string> | null = null;

        for (token = p.NextTok(); currentGroup || token !== T.RIGHT; token = p.NextTok()) {
          switch (token) {
            case T.LEFT:
              currentGroup = new Set<string>();
              groups.push(currentGroup);
              break;

            case T.STRING:
              if (currentGroup) currentGroup.add(p.CurText());

              break;

            case T.RIGHT:
              currentGroup = null;
              break;

            default:
              p.Expecting('list of pad names');
          }
        }

        break;
      }

      case 'solder_mask_margin':
        footprint.SetLocalSolderMaskMargin(p.parseBoardUnits('local solder mask margin value'));
        p.NeedRIGHT();

        // In pre-9.0 files "0" meant inherit.
        if (p.m_requiredVersion <= 20240201 && footprint.GetLocalSolderMaskMargin() === 0)
          footprint.SetLocalSolderMaskMargin(undefined);

        break;

      case 'solder_paste_margin':
        footprint.SetLocalSolderPasteMargin(p.parseBoardUnits('local solder paste margin value'));
        p.NeedRIGHT();

        // In pre-9.0 files "0" meant inherit.
        if (p.m_requiredVersion <= 20240201 && footprint.GetLocalSolderPasteMargin() === 0)
          footprint.SetLocalSolderPasteMargin(undefined);

        break;

      case 'solder_paste_ratio': // legacy token
      case 'solder_paste_margin_ratio':
        footprint.SetLocalSolderPasteMarginRatio(
          p.parseDoubleNext('local solder paste margin ratio value'),
        );
        p.NeedRIGHT();

        // In pre-9.0 files "0" meant inherit.
        if (p.m_requiredVersion <= 20240201 && footprint.GetLocalSolderPasteMarginRatio() === 0)
          footprint.SetLocalSolderPasteMarginRatio(undefined);

        break;

      case 'clearance':
        footprint.SetLocalClearance(p.parseBoardUnits('local clearance value'));
        p.NeedRIGHT();

        // In pre-9.0 files "0" meant inherit.
        if (p.m_requiredVersion <= 20240201 && footprint.GetLocalClearance() === 0)
          footprint.SetLocalClearance(undefined);

        break;

      case 'zone_connect':
        footprint.SetLocalZoneConnection(p.parseInt('zone connection value') as ZONE_CONNECTION);
        p.NeedRIGHT();
        break;

      case 'thermal_width':
      case 'thermal_gap':
        // Interestingly, these have never been exposed in the GUI
        p.parseBoardUnits(token);
        p.NeedRIGHT();
        break;

      case 'attr':
        for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
          switch (token) {
            case 'virtual': // legacy token prior to version 20200826
              attributes |= FP_EXCLUDE_FROM_POS_FILES | FP_EXCLUDE_FROM_BOM;
              break;

            case 'through_hole':
              attributes |= FP_THROUGH_HOLE;
              break;

            case 'smd':
              attributes |= FP_SMD;
              break;

            case 'board_only':
              attributes |= FP_BOARD_ONLY;
              break;

            case 'exclude_from_pos_files':
              attributes |= FP_EXCLUDE_FROM_POS_FILES;
              break;

            case 'exclude_from_bom':
              attributes |= FP_EXCLUDE_FROM_BOM;
              break;

            case 'allow_missing_courtyard':
              footprint.SetAllowMissingCourtyard(true);
              break;

            case 'dnp':
              attributes |= FP_DNP;
              break;

            case 'allow_soldermask_bridges':
              footprint.SetAllowSolderMaskBridges(true);
              break;

            default:
              p.Expecting(
                'through_hole, smd, virtual, board_only, exclude_from_pos_files, exclude_from_bom or allow_solder_mask_bridges',
              );
          }
        }
        footprint.SetAttributes(attributes);
        break;

      case 'fp_text': {
        const text = parsePCB_TEXT(p, footprint);

        if (text instanceof PCB_FIELD) {
          const field = text;

          switch (field.GetId()) {
            case FIELD_T.REFERENCE:
              footprint.Reference().assignPcbField(new PCB_FIELD(text, FIELD_T.REFERENCE));
              setUuid(footprint.Reference(), text.m_Uuid);
              break;

            case FIELD_T.VALUE:
              footprint.Value().assignPcbField(new PCB_FIELD(text, FIELD_T.VALUE));
              setUuid(footprint.Value(), text.m_Uuid);
              break;

            default:
              // Fields other than reference and value aren't treated specially,
              // and can be created if the fp_text was hidden on the board,
              // so just add those to the footprint as normal.
              footprint.Add(text, ADD_MODE.APPEND, true);
              break;
          }
        } else {
          footprint.Add(text, ADD_MODE.APPEND, true);
        }

        break;
      }

      case 'fp_text_box': {
        const textbox = parsePCB_TEXTBOX(p, footprint);
        footprint.Add(textbox, ADD_MODE.APPEND, true);
        break;
      }

      case 'table': {
        const table = parsePCB_TABLE(p, footprint);
        footprint.Add(table, ADD_MODE.APPEND, true);
        break;
      }

      case 'fp_arc':
      case 'fp_circle':
      case 'fp_curve':
      case 'fp_rect':
      case 'fp_line':
      case 'fp_poly': {
        const shape = parsePCB_SHAPE(p, footprint);
        footprint.Add(shape, ADD_MODE.APPEND, true);
        break;
      }

      case 'image': {
        const image = parsePCB_REFERENCE_IMAGE(p, footprint);
        footprint.Add(image, ADD_MODE.APPEND, true);
        break;
      }

      case 'barcode': {
        const barcode = parsePCB_BARCODE(p, footprint);
        footprint.Add(barcode, ADD_MODE.APPEND, true);
        break;
      }

      case 'dimension': {
        const dimension = parseDIMENSION(p, footprint);
        footprint.Add(dimension, ADD_MODE.APPEND, true);
        break;
      }

      case 'pad': {
        const pad = parsePAD(p, footprint);
        footprint.Add(pad, ADD_MODE.APPEND, true);
        break;
      }

      case 'model': {
        const model = p.parse3DModel();
        footprint.Add3DModel(model);
        break;
      }

      case 'zone': {
        const zone = parseZONE(p, footprint);

        if (zone.GetNumCorners() === 0) {
          break;
        }

        footprint.Add(zone, ADD_MODE.APPEND, true);
        break;
      }

      case 'group':
        p.parseGROUP(footprint);
        break;

      case 'point': {
        const point = parsePCB_POINT(p);
        footprint.Add(point, ADD_MODE.APPEND, true);
        break;
      }
      case 'embedded_fonts': {
        footprint.GetEmbeddedFiles().SetAreFontsEmbedded(p.parseBool());
        p.NeedRIGHT();
        break;
      }

      case 'embedded_files': {
        try {
          ParseEmbedded(p, footprint.GetEmbeddedFiles());
        } catch (e) {
          if (e instanceof PARSE_ERROR) p.m_parseWarnings.push(e.message);
          else throw e;
        }

        // SyncLineReaderWith( embeddedFilesParser ): the embedded parser set the bar rule
        p.SetKnowsBar(p.m_requiredVersion >= 20240706);
        break;
      }

      case 'component_classes': {
        const componentClassNames = new Set<string>();

        // biome-ignore lint/suspicious/noAssignInExpressions: the C++ loop shape
        while ((token = p.NextTok()) !== T.RIGHT) {
          if (token !== T.LEFT) p.Expecting(T.LEFT);

          // biome-ignore lint/suspicious/noAssignInExpressions: the C++ loop shape
          if ((token = p.NextTok()) !== 'class') p.Expecting('class');

          p.NeedSYMBOLorNUMBER();
          componentClassNames.add(p.CurText());
          p.NeedRIGHT();
        }

        footprint.SetTransientComponentClassNames(componentClassNames);

        if (p.m_board) footprint.ResolveComponentClassNames(p.m_board, componentClassNames);

        break;
      }

      case 'variant':
        p.parseFootprintVariant(footprint);
        break;

      default:
        p.Expecting(
          'at, descr, locked, placed, tedit, tstamp, uuid, variant, ' +
            'autoplace_cost90, autoplace_cost180, attr, clearance, ' +
            'embedded_files, fp_arc, fp_circle, fp_curve, fp_line, fp_poly, ' +
            'fp_rect, fp_text, pad, group, generator, model, path, solder_mask_margin, ' +
            'solder_paste_margin, solder_paste_margin_ratio, tags, thermal_gap, ' +
            'version, zone, zone_connect, or component_classes',
        );
    }
  }

  footprint.FixUpPadsForBoard(p.m_board);

  // In legacy files the lack of attributes indicated a through-hole component which was by
  // default excluded from pos files.  However there was a hack to look for SMD pads and
  // consider those "mislabeled through-hole components" and therefore include them in place
  // files.  We probably don't want to get into that game so we'll just include them by
  // default and let the user change it if required.
  if (p.m_requiredVersion < 20200826 && attributes === 0) attributes |= FP_THROUGH_HOLE;

  if (p.m_requiredVersion <= LEGACY_NET_TIES) {
    if (footprint.GetKeywords().startsWith('net tie')) {
      let padGroup = '';

      for (const pad of footprint.Pads()) {
        if (padGroup !== '') padGroup += ', ';

        padGroup += pad.GetNumber();
      }

      if (padGroup !== '') footprint.AddNetTiePadGroup(padGroup);
    }
  }

  footprint.SetAttributes(attributes);

  footprint.SetFPID(fpid);

  return footprint;
}

/** `KIID_PATH( const wxString& aString )` (common/kiid.cpp:310). */
function kiidPathFromString(aString: string): KIID[] {
  const path: KIID[] = [];

  for (const pathStep of aString.split('/')) {
    if (pathStep !== '') path.push(kiidFromString(pathStep));
  }

  return path;
}

function parseFootprintStackup(p: PCB_IO_KICAD_SEXPR_PARSER, aFootprint: FOOTPRINT): void {
  // If we have a stackup list at all, we must be in custom layer mode
  const stackupMode = FOOTPRINT_STACKUP.CUSTOM_LAYERS;
  const layers = new LSET();

  for (let token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
    if (p.CurTok() !== T.LEFT) p.Expecting(T.LEFT);

    token = p.NextTok();

    switch (token) {
      case 'layer': {
        p.NeedSYMBOLorNUMBER();

        const it = p.m_layerIndices.get(p.CurText());
        if (it === undefined) {
          p.Expecting('layer name');
        } else {
          layers.set(it);
        }

        p.NeedRIGHT();
        break;
      }
      default: {
        p.Expecting('layer');
        break;
      }
    }
  }

  // Check that the copper layers are sensible and contiguous
  const gotCuLayers = new LSET(layers).and(LSET.AllCuMask());

  // Remove this check when we support odd copper layer stackups
  if (gotCuLayers.count() % 2 !== 0) {
    throw new IO_ERROR(
      `Invalid stackup in footprint: odd number of copper layers (${gotCuLayers.count()}).`,
    );
  }

  const expectedCuLayers = LSET.AllCuMask(gotCuLayers.count());
  if (!gotCuLayers.equals(expectedCuLayers)) {
    throw new IO_ERROR('Invalid stackup in footprint: copper layers are not contiguous.');
  }

  if (new LSET(layers).and(LSET.AllTechMask()).count() > 0) {
    throw new IO_ERROR(
      'Invalid stackup in footprint: technology layers are implicit in footprints and should not be specified in the stackup.',
    );
  }

  // Set the mode first, so that the layer count is unlocked if needed
  aFootprint.SetStackupMode(stackupMode);
  aFootprint.SetStackupLayers(layers);
}

// ---------------------------------------------------------------------------
// parsePAD (:5786), parsePAD_option (:6489), parsePostMachining (:6554), parsePadstack (:6607)
// ---------------------------------------------------------------------------

export function parsePAD(p: PCB_IO_KICAD_SEXPR_PARSER, aParent: FOOTPRINT | null): PAD {
  const sz: VECTOR2I = { x: 0, y: 0 };
  const pt: VECTOR2I = { x: 0, y: 0 };
  let foundNet = false;
  let foundNetcode = false;

  const pad = new PAD(aParent);

  p.NeedSYMBOLorNUMBER();
  pad.SetNumber(p.CurText());

  let token = p.NextTok();

  switch (token) {
    case 'thru_hole':
      pad.SetAttribute(PAD_ATTRIB.PTH);

      // The drill token is usually missing if 0 drill size is specified.
      // Emulate it using 1 nm drill size to avoid errors.
      // Drill size cannot be set to 0 in newer versions.
      pad.SetDrillSize({ x: 1, y: 1 });
      break;

    case 'smd':
      pad.SetAttribute(PAD_ATTRIB.SMD);

      // Default PAD object is thru hole with drill.
      // SMD pads have no hole
      pad.SetDrillSize({ x: 0, y: 0 });
      break;

    case 'connect':
      pad.SetAttribute(PAD_ATTRIB.CONN);

      // Default PAD object is thru hole with drill.
      // CONN pads have no hole
      pad.SetDrillSize({ x: 0, y: 0 });
      break;

    case 'np_thru_hole':
      pad.SetAttribute(PAD_ATTRIB.NPTH);
      break;

    default:
      p.Expecting('thru_hole, smd, connect, or np_thru_hole');
  }

  token = p.NextTok();

  switch (token) {
    case 'circle':
      pad.SetShape(PADSTACK.ALL_LAYERS, PAD_SHAPE.CIRCLE);
      break;

    case 'rect':
      pad.SetShape(PADSTACK.ALL_LAYERS, PAD_SHAPE.RECTANGLE);
      break;

    case 'oval':
      pad.SetShape(PADSTACK.ALL_LAYERS, PAD_SHAPE.OVAL);
      break;

    case 'trapezoid':
      pad.SetShape(PADSTACK.ALL_LAYERS, PAD_SHAPE.TRAPEZOID);
      break;

    case 'roundrect':
      // Note: the shape can be PAD_SHAPE::ROUNDRECT or PAD_SHAPE::CHAMFERED_RECT
      // (if chamfer parameters are found later in pad descr.)
      pad.SetShape(PADSTACK.ALL_LAYERS, PAD_SHAPE.ROUNDRECT);
      break;

    case 'custom':
      pad.SetShape(PADSTACK.ALL_LAYERS, PAD_SHAPE.CUSTOM);
      break;

    default:
      p.Expecting('circle, rectangle, roundrect, oval, trapezoid or custom');
  }

  let thermalBrAngleOverride: EDA_ANGLE | null = null;

  for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
    if (token === 'locked') {
      // Pad locking is now a session preference
      token = p.NextTok();
    }

    if (token !== T.LEFT) p.Expecting(T.LEFT);

    token = p.NextTok();

    switch (token) {
      case 'size':
        sz.x = p.parseBoardUnits('width value');
        sz.y = p.parseBoardUnits('height value');
        pad.SetSize(PADSTACK.ALL_LAYERS, sz);
        p.NeedRIGHT();
        break;

      case 'at':
        pt.x = p.parseBoardUnits('X coordinate');
        pt.y = p.parseBoardUnits('Y coordinate');
        pad.SetFPRelativePosition(pt);
        token = p.NextTok();

        if (token === T.NUMBER) {
          pad.SetOrientation(new EDA_ANGLE(p.parseDouble()));
          p.NeedRIGHT();
        } else if (token !== T.RIGHT) {
          p.Expecting(') or angle value');
        }

        break;

      case 'rect_delta': {
        const delta: VECTOR2I = { x: 0, y: 0 };
        delta.x = p.parseBoardUnits('rectangle delta width');
        delta.y = p.parseBoardUnits('rectangle delta height');
        pad.SetDelta(PADSTACK.ALL_LAYERS, delta);
        p.NeedRIGHT();
        break;
      }

      case 'drill': {
        let haveWidth = false;
        const drillSize = { ...pad.GetDrillSize() };

        for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
          if (token === T.LEFT) token = p.NextTok();

          switch (token) {
            case 'oval':
              pad.SetDrillShape(PAD_DRILL_SHAPE.OBLONG);
              break;

            case T.NUMBER: {
              if (!haveWidth) {
                drillSize.x = p.parseBoardUnitsCur();

                // If height is not defined the width and height are the same.
                drillSize.y = drillSize.x;
                haveWidth = true;
              } else {
                drillSize.y = p.parseBoardUnitsCur();
              }

              break;
            }

            case 'offset':
              pt.x = p.parseBoardUnits('drill offset x');
              pt.y = p.parseBoardUnits('drill offset y');
              pad.SetOffset(PADSTACK.ALL_LAYERS, pt);
              p.NeedRIGHT();
              break;

            default:
              p.Expecting('oval, size, or offset');
          }
        }

        // This fixes a bug caused by setting the default PAD drill size to a value other
        // than 0 used to fix a bunch of debug assertions even though it is defined as a
        // through hole pad.  Wouldn't a though hole pad with no drill be a surface mount
        // pad (or a conn pad which is a smd pad with no solder paste)?
        if (pad.GetAttribute() !== PAD_ATTRIB.SMD && pad.GetAttribute() !== PAD_ATTRIB.CONN)
          pad.SetDrillSize(drillSize);
        else pad.SetDrillSize({ x: 0, y: 0 });

        break;
      }

      case 'backdrill': {
        // Parse: (backdrill (size ...) (layers start end))
        const secondary = pad.Padstack().SecondaryDrill();

        for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
          if (token !== T.LEFT) p.Expecting(T.LEFT);

          token = p.NextTok();

          switch (token) {
            case 'size': {
              const size = p.parseBoardUnits('backdrill size');
              secondary.size = { x: size, y: size };
              p.NeedRIGHT();
              break;
            }

            case 'layers': {
              p.NextTok();
              secondary.start = p.lookUpLayerCur();
              p.NextTok();
              secondary.end = p.lookUpLayerCur();
              p.NeedRIGHT();
              break;
            }

            default:
              p.Expecting('size or layers');
          }
        }

        break;
      }

      case 'tertiary_drill': {
        // Parse: (tertiary_drill (size ...) (layers start end))
        const tertiary = pad.Padstack().TertiaryDrill();

        for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
          if (token !== T.LEFT) p.Expecting(T.LEFT);

          token = p.NextTok();

          switch (token) {
            case 'size': {
              const size = p.parseBoardUnits('tertiary drill size');
              tertiary.size = { x: size, y: size };
              p.NeedRIGHT();
              break;
            }

            case 'layers': {
              p.NextTok();
              tertiary.start = p.lookUpLayerCur();
              p.NextTok();
              tertiary.end = p.lookUpLayerCur();
              p.NeedRIGHT();
              break;
            }

            default:
              p.Expecting('size or layers');
          }
        }

        break;
      }

      case 'layers': {
        const layerMask = p.parseBoardItemLayersAsMask();

        pad.SetLayerSet(layerMask);
        break;
      }

      case 'net':
        foundNet = true;

        token = p.NextTok();

        // Legacy files (pre-10.0) will have a netcode written before the netname.  This netcode
        // is authoratative (though may be mapped by getNetCode() to prevent collisions).
        if (DSNLEXER.IsNumber(token)) {
          if (
            !pad.SetNetCode(p.getNetCode(Number.parseInt(p.CurText(), 10)), /* aNoAssert */ true)
          ) {
            // wxLogTrace( traceKicadPcbPlugin, "Invalid net ID in file …" )
          } else {
            foundNetcode = true;
          }

          token = p.NextTok();
        }

        if (!DSNLEXER.IsSymbol(token)) {
          p.Expecting('net name');
        }

        if (p.m_board) {
          let netName = p.CurText();

          // Convert overbar syntax from `~...~` to `~{...}`.  These were left out of the
          // first merge so the version is a bit later.
          if (p.m_requiredVersion < 20210606) netName = convertToNewOverbarNotation(netName);

          if (foundNetcode) {
            if (netName !== p.m_board.FindNet(pad.GetNetCode())!.GetNetname()) {
              pad.SetNetCode(NETINFO_LIST.ORPHANED, /* aNoAssert */ true);
              // wxLogTrace( traceKicadPcbPlugin, "Net name doesn't match ID in file …" )
            }
          } else {
            let netinfo = p.m_board.FindNet(netName);

            if (!netinfo) {
              netinfo = new NETINFO_ITEM(p.m_board, netName);
              p.m_board.Add(netinfo, ADD_MODE.INSERT, true);
            }

            pad.SetNet(netinfo);
          }
        }

        p.NeedRIGHT();
        break;

      case 'pinfunction':
        p.NeedSYMBOLorNUMBER();
        pad.SetPinFunction(p.CurText());
        p.NeedRIGHT();
        break;

      case 'pintype':
        p.NeedSYMBOLorNUMBER();
        pad.SetPinType(p.CurText());
        p.NeedRIGHT();
        break;

      case 'die_length':
        pad.SetPadToDieLength(p.parseBoardUnits('die_length'));
        p.NeedRIGHT();
        break;

      case 'die_delay': {
        if (p.m_requiredVersion <= 20250926) pad.SetPadToDieDelay(p.parseBoardUnits('die_delay'));
        else pad.SetPadToDieDelay(p.parseBoardUnits('die_delay', 'time'));

        p.NeedRIGHT();
        break;
      }

      case 'solder_mask_margin':
        pad.SetLocalSolderMaskMargin(p.parseBoardUnits('local solder mask margin value'));
        p.NeedRIGHT();

        // In pre-9.0 files "0" meant inherit.
        if (p.m_requiredVersion <= 20240201 && pad.GetLocalSolderMaskMargin() === 0)
          pad.SetLocalSolderMaskMargin(undefined);

        break;

      case 'solder_paste_margin':
        pad.SetLocalSolderPasteMargin(p.parseBoardUnits('local solder paste margin value'));
        p.NeedRIGHT();

        // In pre-9.0 files "0" meant inherit.
        if (p.m_requiredVersion <= 20240201 && pad.GetLocalSolderPasteMargin() === 0)
          pad.SetLocalSolderPasteMargin(undefined);

        break;

      case 'solder_paste_margin_ratio':
        pad.SetLocalSolderPasteMarginRatio(
          p.parseDoubleNext('local solder paste margin ratio value'),
        );
        p.NeedRIGHT();

        // In pre-9.0 files "0" meant inherit.
        if (p.m_requiredVersion <= 20240201 && pad.GetLocalSolderPasteMarginRatio() === 0)
          pad.SetLocalSolderPasteMarginRatio(undefined);

        break;

      case 'clearance':
        pad.SetLocalClearance(p.parseBoardUnits('local clearance value'));
        p.NeedRIGHT();

        // In pre-9.0 files "0" meant inherit.
        if (p.m_requiredVersion <= 20240201 && pad.GetLocalClearance() === 0)
          pad.SetLocalClearance(undefined);

        break;

      case 'teardrops':
        p.parseTEARDROP_PARAMETERS(pad.GetTeardropParams());
        break;

      case 'zone_connect':
        pad.SetLocalZoneConnection(p.parseInt('zone connection value') as ZONE_CONNECTION);
        p.NeedRIGHT();
        break;

      case 'thermal_width': // legacy token
      case 'thermal_bridge_width':
        pad.SetLocalThermalSpokeWidthOverride(p.parseBoardUnits(token));
        p.NeedRIGHT();
        break;

      case 'thermal_bridge_angle':
        thermalBrAngleOverride = new EDA_ANGLE(p.parseDoubleNext('thermal spoke angle'));
        p.NeedRIGHT();
        break;

      case 'thermal_gap':
        pad.SetThermalGap(p.parseBoardUnits('thermal relief gap value'));
        p.NeedRIGHT();
        break;

      case 'roundrect_rratio':
        pad.SetRoundRectRadiusRatio(
          PADSTACK.ALL_LAYERS,
          p.parseDoubleNext('roundrect radius ratio'),
        );
        p.NeedRIGHT();
        break;

      case 'chamfer_ratio':
        pad.SetChamferRectRatio(PADSTACK.ALL_LAYERS, p.parseDoubleNext('chamfer ratio'));

        if (pad.GetChamferRectRatio(PADSTACK.ALL_LAYERS) > 0)
          pad.SetShape(PADSTACK.ALL_LAYERS, PAD_SHAPE.CHAMFERED_RECT);

        p.NeedRIGHT();
        break;

      case 'chamfer': {
        let chamfers = 0;
        let end_list = false;

        while (!end_list) {
          token = p.NextTok();

          switch (token) {
            case 'top_left':
              chamfers |= RECT_CHAMFER_TOP_LEFT;
              break;

            case 'top_right':
              chamfers |= RECT_CHAMFER_TOP_RIGHT;
              break;

            case 'bottom_left':
              chamfers |= RECT_CHAMFER_BOTTOM_LEFT;
              break;

            case 'bottom_right':
              chamfers |= RECT_CHAMFER_BOTTOM_RIGHT;
              break;

            case T.RIGHT:
              pad.SetChamferPositions(PADSTACK.ALL_LAYERS, chamfers);
              end_list = true;
              break;

            default:
              p.Expecting(
                'chamfer_top_left chamfer_top_right chamfer_bottom_left or chamfer_bottom_right',
              );
          }
        }

        if (pad.GetChamferPositions(PADSTACK.ALL_LAYERS) !== RECT_NO_CHAMFER)
          pad.SetShape(PADSTACK.ALL_LAYERS, PAD_SHAPE.CHAMFERED_RECT);

        break;
      }

      case 'property':
        while (token !== T.RIGHT) {
          token = p.NextTok();

          switch (token) {
            case 'pad_prop_bga':
              pad.SetProperty(PAD_PROP.BGA);
              break;
            case 'pad_prop_fiducial_glob':
              pad.SetProperty(PAD_PROP.FIDUCIAL_GLBL);
              break;
            case 'pad_prop_fiducial_loc':
              pad.SetProperty(PAD_PROP.FIDUCIAL_LOCAL);
              break;
            case 'pad_prop_testpoint':
              pad.SetProperty(PAD_PROP.TESTPOINT);
              break;
            case 'pad_prop_castellated':
              pad.SetProperty(PAD_PROP.CASTELLATED);
              break;
            case 'pad_prop_heatsink':
              pad.SetProperty(PAD_PROP.HEATSINK);
              break;
            case 'pad_prop_mechanical':
              pad.SetProperty(PAD_PROP.MECHANICAL);
              break;
            case 'pad_prop_pressfit':
              pad.SetProperty(PAD_PROP.PRESSFIT);
              break;
            case 'none':
              pad.SetProperty(PAD_PROP.NONE);
              break;
            case T.RIGHT:
              break;

            default:
              // Currently: skip unknown property
              break;
          }
        }

        break;

      case 'options':
        parsePAD_option(p, pad);
        break;

      case 'padstack':
        parsePadstack(p, pad);
        break;

      case 'primitives':
        for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
          if (token === T.LEFT) token = p.NextTok();

          switch (token) {
            case 'gr_arc':
            case 'gr_line':
            case 'gr_circle':
            case 'gr_rect':
            case 'gr_poly':
            case 'gr_curve':
              pad.AddPrimitive(PADSTACK.ALL_LAYERS, parsePCB_SHAPE(p, null));
              break;

            case 'gr_bbox': {
              const numberBox = parsePCB_SHAPE(p, null);
              numberBox.SetIsProxyItem();
              pad.AddPrimitive(PADSTACK.ALL_LAYERS, numberBox);
              break;
            }

            case 'gr_vector': {
              const spokeTemplate = parsePCB_SHAPE(p, null);
              spokeTemplate.SetIsProxyItem();
              pad.AddPrimitive(PADSTACK.ALL_LAYERS, spokeTemplate);
              break;
            }

            default:
              p.Expecting('gr_line, gr_arc, gr_circle, gr_curve, gr_rect, gr_bbox or gr_poly');
              break;
          }
        }

        break;

      case 'remove_unused_layers': {
        const remove = p.parseMaybeAbsentBool(true);
        pad.SetRemoveUnconnected(remove);
        break;
      }

      case 'keep_end_layers': {
        const keep = p.parseMaybeAbsentBool(true);
        pad.SetKeepTopBottom(keep);
        break;
      }

      case 'tenting': {
        const [front, back] = p.parseFrontBackOptBool(true);
        pad.Padstack().FrontOuterLayers().has_solder_mask = front;
        pad.Padstack().BackOuterLayers().has_solder_mask = back;
        break;
      }

      case 'zone_layer_connections': {
        const cuLayers = new LSET(pad.GetLayerSet()).and(LSET.AllCuMask());

        for (const layer of cuLayers.Seq())
          pad.SetZoneLayerOverride(layer, ZONE_LAYER_OVERRIDE.ZLO_FORCE_NO_ZONE_CONNECTION);

        for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
          const layer = p.lookUpLayerCur();

          if (!IsCopperLayer(layer)) p.Expecting('copper layer name');

          pad.SetZoneLayerOverride(layer, ZONE_LAYER_OVERRIDE.ZLO_FORCE_FLASHED);
        }

        break;
      }

      // Continue to process "(locked)" format which was output during 5.99 development
      case 'locked':
        // Pad locking is now a session preference
        p.parseMaybeAbsentBool(true);
        break;

      case 'tstamp':
      case 'uuid':
        p.NextTok();
        setUuid(pad, p.CurStrToKIID());
        p.NeedRIGHT();
        break;

      case 'front_post_machining':
        parsePostMachining(p, pad.Padstack().FrontPostMachining());
        break;

      case 'back_post_machining':
        parsePostMachining(p, pad.Padstack().BackPostMachining());
        break;

      default:
        p.Expecting(
          'at, locked, drill, layers, net, die_length, roundrect_rratio, ' +
            'solder_mask_margin, solder_paste_margin, solder_paste_margin_ratio, uuid, ' +
            'clearance, tstamp, primitives, remove_unused_layers, keep_end_layers, ' +
            'pinfunction, pintype, zone_connect, thermal_width, thermal_gap, padstack, ' +
            'teardrops, front_post_machining, or back_post_machining',
        );
    }
  }

  if (!foundNet) {
    // Make sure default netclass is correctly assigned to pads that don't define a net.
    pad.SetNetCode(0, /* aNoAssert */ true);
  }

  if (thermalBrAngleOverride) {
    pad.SetThermalSpokeAngle(thermalBrAngleOverride);
  } else {
    // This is here because custom pad anchor shape isn't known before reading (options
    if (pad.GetShape(PADSTACK.ALL_LAYERS) === PAD_SHAPE.CIRCLE) {
      pad.SetThermalSpokeAngle(ANGLE_45);
    } else if (
      pad.GetShape(PADSTACK.ALL_LAYERS) === PAD_SHAPE.CUSTOM &&
      pad.GetAnchorPadShape(PADSTACK.ALL_LAYERS) === PAD_SHAPE.CIRCLE
    ) {
      if (p.m_requiredVersion <= 20211014)
        // 6.0
        pad.SetThermalSpokeAngle(ANGLE_90);
      else pad.SetThermalSpokeAngle(ANGLE_45);
    } else {
      pad.SetThermalSpokeAngle(ANGLE_90);
    }
  }

  if (!pad.CanHaveNumber()) {
    // At some point it was possible to assign a number to aperture pads so we need to clean
    // those out here.
    pad.SetNumber('');
  }

  // Zero-sized pads are likely algorithmically unsafe.
  if (pad.GetSizeX() <= 0 || pad.GetSizeY() <= 0) {
    pad.SetSize(PADSTACK.ALL_LAYERS, {
      x: pcbIUScale.mmToIU(0.001),
      y: pcbIUScale.mmToIU(0.001),
    });

    p.m_parseWarnings.push(
      `Invalid zero-sized pad pinned to 1µm in\nfile: ${p.CurSource()}\nline: ${p.CurLineNumber()}\noffset: ${p.CurOffset()}`,
    );
  }

  return pad;
}

function parsePAD_option(p: PCB_IO_KICAD_SEXPR_PARSER, aPad: PAD): boolean {
  // Parse only the (option ...) inside a pad description
  for (let token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
    if (token !== T.LEFT) p.Expecting(T.LEFT);

    token = p.NextTok();

    switch (token) {
      case 'anchor':
        token = p.NextTok();
        // Custom shaped pads have a "anchor pad", which is the reference for connection calculations.
        // Because this is an anchor, only the 2 very basic shapes are managed: circle and rect.
        switch (token) {
          case 'circle':
            aPad.SetAnchorPadShape(PADSTACK.ALL_LAYERS, PAD_SHAPE.CIRCLE);
            break;

          case 'rect':
            aPad.SetAnchorPadShape(PADSTACK.ALL_LAYERS, PAD_SHAPE.RECTANGLE);
            break;

          default:
            p.Expecting('circle or rect');
            break;
        }
        p.NeedRIGHT();
        break;

      case 'clearance':
        token = p.NextTok();
        // Custom shaped pads have a clearance area that is the pad shape (like usual pads) or the
        // convex hull of the pad shape.
        switch (token) {
          case 'outline':
            aPad.SetCustomShapeInZoneOpt(CUSTOM_SHAPE_ZONE_MODE.OUTLINE);
            break;

          case 'convexhull':
            aPad.SetCustomShapeInZoneOpt(CUSTOM_SHAPE_ZONE_MODE.CONVEXHULL);
            break;

          default:
            p.Expecting('outline or convexhull');
            break;
        }

        p.NeedRIGHT();
        break;

      default:
        p.Expecting('anchor or clearance');
        break;
    }
  }

  return true;
}

export function parsePostMachining(
  p: PCB_IO_KICAD_SEXPR_PARSER,
  aProps: PADSTACK_POST_MACHINING_PROPS,
): void {
  // Parse: (front_post_machining counterbore (size ...) (depth ...) (angle ...))
  // or:    (back_post_machining countersink (size ...) (depth ...) (angle ...))
  // The mode token (counterbore/countersink) comes first
  let token = p.NextTok();

  switch (token) {
    case 'counterbore':
      aProps.mode = PAD_DRILL_POST_MACHINING_MODE.COUNTERBORE;
      break;

    case 'countersink':
      aProps.mode = PAD_DRILL_POST_MACHINING_MODE.COUNTERSINK;
      break;

    default:
      p.Expecting('counterbore or countersink');
  }

  // Parse optional properties
  for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
    if (token !== T.LEFT) p.Expecting(T.LEFT);

    token = p.NextTok();

    switch (token) {
      case 'size':
        aProps.size = p.parseBoardUnits('post machining size');
        p.NeedRIGHT();
        break;

      case 'depth':
        aProps.depth = p.parseBoardUnits('post machining depth');
        p.NeedRIGHT();
        break;

      case 'angle':
        aProps.angle = KiROUND(p.parseDoubleNext('post machining angle') * 10.0);
        p.NeedRIGHT();
        break;

      default:
        p.Expecting('size, depth, or angle');
    }
  }
}

function parsePadstack(p: PCB_IO_KICAD_SEXPR_PARSER, aPad: PAD): void {
  const padstack = aPad.Padstack();

  for (let token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
    if (token !== T.LEFT) p.Expecting(T.LEFT);

    token = p.NextTok();

    switch (token) {
      case 'mode':
        token = p.NextTok();

        switch (token) {
          case 'front_inner_back':
            padstack.SetMode(PADSTACK_MODE.FRONT_INNER_BACK);
            break;

          case 'custom':
            padstack.SetMode(PADSTACK_MODE.CUSTOM);
            break;

          default:
            p.Expecting('front_inner_back or custom');
        }

        p.NeedRIGHT();
        break;

      case 'layer': {
        p.NextTok();
        let curLayer: PCB_LAYER_ID = UNDEFINED_LAYER;

        if (p.CurText() === 'Inner') {
          if (padstack.Mode() !== PADSTACK_MODE.FRONT_INNER_BACK) {
            throw new IO_ERROR(
              `Invalid padstack layer in\nfile: ${p.CurSource()}\nline: ${p.CurLineNumber()}\noffset: ${p.CurOffset()}.`,
            );
          }

          curLayer = PADSTACK.INNER_LAYERS;
        } else {
          curLayer = p.lookUpLayerCur();
        }

        if (!IsCopperLayer(curLayer)) {
          throw new IO_ERROR(
            `Invalid padstack layer '${p.CurText()}' in file '${p.CurSource()}' at line ${p.CurLineNumber()}, offset ${p.CurOffset()}.`,
          );
        }

        // Reset layer properties to default that are omitted when default in the formatter
        aPad.SetOffset(curLayer, { x: 0, y: 0 });
        aPad.SetDelta(curLayer, { x: 0, y: 0 });

        for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
          if (token !== T.LEFT) p.Expecting(T.LEFT);

          token = p.NextTok();

          switch (token) {
            case 'shape':
              token = p.NextTok();

              switch (token) {
                case 'circle':
                  aPad.SetShape(curLayer, PAD_SHAPE.CIRCLE);
                  break;

                case 'rect':
                  aPad.SetShape(curLayer, PAD_SHAPE.RECTANGLE);
                  break;

                case 'oval':
                  aPad.SetShape(curLayer, PAD_SHAPE.OVAL);
                  break;

                case 'trapezoid':
                  aPad.SetShape(curLayer, PAD_SHAPE.TRAPEZOID);
                  break;

                case 'roundrect':
                  // Note: the shape can be PAD_SHAPE::ROUNDRECT or PAD_SHAPE::CHAMFERED_RECT
                  // (if chamfer parameters are found later in pad descr.)
                  aPad.SetShape(curLayer, PAD_SHAPE.ROUNDRECT);
                  break;

                case 'custom':
                  aPad.SetShape(curLayer, PAD_SHAPE.CUSTOM);
                  break;

                default:
                  p.Expecting('circle, rectangle, roundrect, oval, trapezoid or custom');
              }

              p.NeedRIGHT();
              break;

            case 'size': {
              const sz: VECTOR2I = { x: 0, y: 0 };
              sz.x = p.parseBoardUnits('width value');
              sz.y = p.parseBoardUnits('height value');
              aPad.SetSize(curLayer, sz);
              p.NeedRIGHT();
              break;
            }

            case 'offset': {
              const pt: VECTOR2I = { x: 0, y: 0 };
              pt.x = p.parseBoardUnits('drill offset x');
              pt.y = p.parseBoardUnits('drill offset y');
              aPad.SetOffset(curLayer, pt);
              p.NeedRIGHT();
              break;
            }

            case 'rect_delta': {
              const delta: VECTOR2I = { x: 0, y: 0 };
              delta.x = p.parseBoardUnits('rectangle delta width');
              delta.y = p.parseBoardUnits('rectangle delta height');
              aPad.SetDelta(curLayer, delta);
              p.NeedRIGHT();
              break;
            }

            case 'roundrect_rratio':
              aPad.SetRoundRectRadiusRatio(curLayer, p.parseDoubleNext('roundrect radius ratio'));
              p.NeedRIGHT();
              break;

            case 'chamfer_ratio': {
              const ratio = p.parseDoubleNext('chamfer ratio');
              aPad.SetChamferRectRatio(curLayer, ratio);

              if (ratio > 0) aPad.SetShape(curLayer, PAD_SHAPE.CHAMFERED_RECT);

              p.NeedRIGHT();
              break;
            }

            case 'chamfer': {
              let chamfers = 0;
              let end_list = false;

              while (!end_list) {
                token = p.NextTok();

                switch (token) {
                  case 'top_left':
                    chamfers |= RECT_CHAMFER_TOP_LEFT;
                    break;

                  case 'top_right':
                    chamfers |= RECT_CHAMFER_TOP_RIGHT;
                    break;

                  case 'bottom_left':
                    chamfers |= RECT_CHAMFER_BOTTOM_LEFT;
                    break;

                  case 'bottom_right':
                    chamfers |= RECT_CHAMFER_BOTTOM_RIGHT;
                    break;

                  case T.RIGHT:
                    aPad.SetChamferPositions(curLayer, chamfers);
                    end_list = true;
                    break;

                  default:
                    p.Expecting(
                      'chamfer_top_left chamfer_top_right chamfer_bottom_left or chamfer_bottom_right',
                    );
                }
              }

              if (end_list && chamfers !== RECT_NO_CHAMFER)
                aPad.SetShape(curLayer, PAD_SHAPE.CHAMFERED_RECT);

              break;
            }

            case 'thermal_bridge_width':
              padstack.SetThermalSpokeWidth(
                p.parseBoardUnits('thermal relief spoke width'),
                curLayer,
              );
              p.NeedRIGHT();
              break;

            case 'thermal_gap':
              padstack.SetThermalGap(p.parseBoardUnits('thermal relief gap value'), curLayer);
              p.NeedRIGHT();
              break;

            case 'thermal_bridge_angle':
              padstack.SetThermalSpokeAngle(
                new EDA_ANGLE(p.parseDoubleNext('thermal spoke angle')),
              );
              p.NeedRIGHT();
              break;

            case 'zone_connect':
              padstack.SetZoneConnection(
                enumCastZoneConnection(p.parseInt('zone connection value')),
                curLayer,
              );
              p.NeedRIGHT();
              break;

            case 'clearance':
              padstack.SetClearance(p.parseBoardUnits('local clearance value'), curLayer);
              p.NeedRIGHT();
              break;

            case 'tenting': {
              const [front, back] = p.parseFrontBackOptBool(true);
              padstack.FrontOuterLayers().has_solder_mask = front;
              padstack.BackOuterLayers().has_solder_mask = back;
              break;
            }

            // TODO: refactor parsePAD_options to work on padstacks too
            case 'options': {
              for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
                if (token !== T.LEFT) p.Expecting(T.LEFT);

                token = p.NextTok();

                switch (token) {
                  case 'anchor':
                    token = p.NextTok();
                    // Custom shaped pads have a "anchor pad", which is the reference
                    // for connection calculations.
                    // Because this is an anchor, only the 2 very basic shapes are managed:
                    // circle and rect.
                    switch (token) {
                      case 'circle':
                        padstack.SetAnchorShape(PAD_SHAPE.CIRCLE, curLayer);
                        break;

                      case 'rect':
                        padstack.SetAnchorShape(PAD_SHAPE.RECTANGLE, curLayer);
                        break;

                      default:
                        // Currently, because pad options is a moving target
                        // just skip unknown keywords
                        break;
                    }
                    p.NeedRIGHT();
                    break;

                  case 'clearance':
                    token = p.NextTok();
                    // TODO: m_customShapeInZoneMode is not per-layer at the moment
                    p.NeedRIGHT();
                    break;

                  default:
                    // Currently, because pad options is a moving target
                    // just skip unknown keywords
                    // biome-ignore lint/suspicious/noAssignInExpressions: the C++ loop shape
                    while ((token = p.NextTok()) !== T.RIGHT) {
                      // skip
                    }

                    break;
                }
              }

              break;
            }

            // TODO: deduplicate with non-padstack parser
            case 'primitives':
              for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
                if (token === T.LEFT) token = p.NextTok();

                switch (token) {
                  case 'gr_arc':
                  case 'gr_line':
                  case 'gr_circle':
                  case 'gr_rect':
                  case 'gr_poly':
                  case 'gr_curve':
                    padstack.AddPrimitive(parsePCB_SHAPE(p, null), curLayer);
                    break;

                  case 'gr_bbox': {
                    const numberBox = parsePCB_SHAPE(p, null);
                    numberBox.SetIsProxyItem();
                    padstack.AddPrimitive(numberBox, curLayer);
                    break;
                  }

                  case 'gr_vector': {
                    const spokeTemplate = parsePCB_SHAPE(p, null);
                    spokeTemplate.SetIsProxyItem();
                    padstack.AddPrimitive(spokeTemplate, curLayer);
                    break;
                  }

                  default:
                    p.Expecting(
                      'gr_line, gr_arc, gr_circle, gr_curve, gr_rect, gr_bbox or gr_poly',
                    );
                    break;
                }
              }

              break;

            default:
              // Not strict-parsing padstack layers yet
              continue;
          }
        }

        break;
      }

      default:
        p.Expecting('mode or layer');
        break;
    }
  }
}

/** `magic_enum::enum_cast<ZONE_CONNECTION>( int )`: the value when it names an enumerator. */
function enumCastZoneConnection(aValue: number): ZONE_CONNECTION | undefined {
  return Object.values(ZONE_CONNECTION).includes(aValue) ? (aValue as ZONE_CONNECTION) : undefined;
}

// ---------------------------------------------------------------------------
// parseARC (:7210), parsePCB_TRACK (:7312), parsePCB_VIA (:7407), parseViastack (:7766)
// ---------------------------------------------------------------------------

export function parseARC(p: PCB_IO_KICAD_SEXPR_PARSER): PCB_ARC | null {
  const pt: VECTOR2I = { x: 0, y: 0 };
  let token: Tok;

  const arc = new PCB_ARC(p.m_board);

  for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
    // Legacy locked
    if (token === 'locked') {
      arc.SetLocked(true);
      token = p.NextTok();
    }

    if (token !== T.LEFT) p.Expecting(T.LEFT);

    token = p.NextTok();

    switch (token) {
      case 'start':
        pt.x = p.parseBoardUnits('start x');
        pt.y = p.parseBoardUnits('start y');
        arc.SetStart(pt);
        p.NeedRIGHT();
        break;

      case 'mid':
        pt.x = p.parseBoardUnits('mid x');
        pt.y = p.parseBoardUnits('mid y');
        arc.SetMid(pt);
        p.NeedRIGHT();
        break;

      case 'end':
        pt.x = p.parseBoardUnits('end x');
        pt.y = p.parseBoardUnits('end y');
        arc.SetEnd(pt);
        p.NeedRIGHT();
        break;

      case 'width':
        arc.SetWidth(p.parseBoardUnits('width'));
        p.NeedRIGHT();
        break;

      case 'layer':
        arc.SetLayer(p.parseBoardItemLayer());
        p.NeedRIGHT();
        break;

      case 'layers':
        arc.SetLayerSet(p.parseLayersForCuItemWithSoldermask());
        break;

      case 'solder_mask_margin':
        arc.SetLocalSolderMaskMargin(p.parseBoardUnits('local solder mask margin value'));
        p.NeedRIGHT();
        break;

      case 'net':
        p.parseNet(arc);
        break;

      case 'tstamp':
      case 'uuid':
        p.NextTok();
        setUuid(arc, p.CurStrToKIID());
        p.NeedRIGHT();
        break;

      // We continue to parse the status field but it is no longer written
      case 'status':
        p.parseHex();
        p.NeedRIGHT();
        break;

      case 'locked':
        arc.SetLocked(p.parseMaybeAbsentBool(true));
        break;

      default:
        p.Expecting(
          'start, mid, end, width, layer, solder_mask_margin, net, tstamp, uuid or status',
        );
    }
  }

  if (!IsCopperLayer(arc.GetLayer())) {
    // No point in asserting; these usually come from hand-edited boards
    return null;
  }

  return arc;
}

export function parsePCB_TRACK(p: PCB_IO_KICAD_SEXPR_PARSER): PCB_TRACK | null {
  const pt: VECTOR2I = { x: 0, y: 0 };
  let token: Tok;

  const track = new PCB_TRACK(p.m_board);

  for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
    // Legacy locked flag
    if (token === 'locked') {
      track.SetLocked(true);
      token = p.NextTok();
    }

    if (token !== T.LEFT) p.Expecting(T.LEFT);

    token = p.NextTok();

    switch (token) {
      case 'start':
        pt.x = p.parseBoardUnits('start x');
        pt.y = p.parseBoardUnits('start y');
        track.SetStart(pt);
        p.NeedRIGHT();
        break;

      case 'end':
        pt.x = p.parseBoardUnits('end x');
        pt.y = p.parseBoardUnits('end y');
        track.SetEnd(pt);
        p.NeedRIGHT();
        break;

      case 'width':
        track.SetWidth(p.parseBoardUnits('width'));
        p.NeedRIGHT();
        break;

      case 'layer':
        track.SetLayer(p.parseBoardItemLayer());
        p.NeedRIGHT();
        break;

      case 'layers':
        track.SetLayerSet(p.parseLayersForCuItemWithSoldermask());
        break;

      case 'solder_mask_margin':
        track.SetLocalSolderMaskMargin(p.parseBoardUnits('local solder mask margin value'));
        p.NeedRIGHT();
        break;

      case 'net':
        p.parseNet(track);
        break;

      case 'tstamp':
      case 'uuid':
        p.NextTok();
        setUuid(track, p.CurStrToKIID());
        p.NeedRIGHT();
        break;

      // We continue to parse the status field but it is no longer written
      case 'status':
        p.parseHex();
        p.NeedRIGHT();
        break;

      case 'locked':
        track.SetLocked(p.parseMaybeAbsentBool(true));
        break;

      default:
        p.Expecting('start, end, width, layer, solder_mask_margin, net, tstamp, uuid or locked');
    }
  }

  if (!IsCopperLayer(track.GetLayer())) {
    // No point in asserting; these usually come from hand-edited boards
    return null;
  }

  return track;
}

export function parsePCB_VIA(p: PCB_IO_KICAD_SEXPR_PARSER): PCB_VIA {
  const pt: VECTOR2I = { x: 0, y: 0 };
  let token: Tok;

  const via = new PCB_VIA(p.m_board);

  // File format default is no-token == no-feature.
  via.Padstack().SetUnconnectedLayerMode(UNCONNECTED_LAYER_MODE.KEEP_ALL);

  // Versions before 10.0 had no protection features other than tenting, so those features must
  // be interpreted as OFF in legacy boards, not as unspecified (aka: inherit from board stackup)
  if (p.m_requiredVersion < 20250228) {
    via.Padstack().FrontOuterLayers().has_covering = false;
    via.Padstack().BackOuterLayers().has_covering = false;
    via.Padstack().FrontOuterLayers().has_plugging = false;
    via.Padstack().BackOuterLayers().has_plugging = false;
    via.Padstack().Drill().is_filled = false;
    via.Padstack().Drill().is_capped = false;
  }

  for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
    // Legacy locked
    if (token === 'locked') {
      via.SetLocked(true);
      token = p.NextTok();
    }

    if (token === T.LEFT) token = p.NextTok();

    switch (token) {
      case 'blind':
        via.SetViaType(VIATYPE.BLIND);
        break;

      case 'buried':
        via.SetViaType(VIATYPE.BURIED);
        break;

      case 'micro':
        via.SetViaType(VIATYPE.MICROVIA);
        break;

      case 'at':
        pt.x = p.parseBoardUnits('start x');
        pt.y = p.parseBoardUnits('start y');
        via.SetStart(pt);
        via.SetEnd(pt);
        p.NeedRIGHT();
        break;

      case 'size':
        via.SetWidth(PADSTACK.ALL_LAYERS, p.parseBoardUnits('via width'));
        p.NeedRIGHT();
        break;

      case 'drill':
        via.SetDrill(p.parseBoardUnits('drill diameter'));
        p.NeedRIGHT();
        break;

      case 'layers': {
        p.NextTok();
        const layer1 = p.lookUpLayerCur();
        p.NextTok();
        const layer2 = p.lookUpLayerCur();
        via.SetLayerPair(layer1, layer2);

        if (layer1 === UNDEFINED_LAYER || layer2 === UNDEFINED_LAYER) p.Expecting('layer name');

        p.NeedRIGHT();
        break;
      }

      case 'net':
        p.parseNet(via);
        break;

      case 'remove_unused_layers':
        if (p.parseMaybeAbsentBool(true)) via.SetRemoveUnconnected(true);

        break;

      case 'keep_end_layers':
        if (p.parseMaybeAbsentBool(true)) via.SetKeepStartEnd(true);

        break;

      case 'start_end_only':
        if (p.parseMaybeAbsentBool(true))
          via.Padstack().SetUnconnectedLayerMode(UNCONNECTED_LAYER_MODE.START_END_ONLY);

        break;

      case 'zone_layer_connections': {
        // Ensure only copper layers are stored int ZoneLayerOverride array
        const cuLayers = new LSET(via.GetLayerSet()).and(LSET.AllCuMask());

        for (const layer of cuLayers.Seq())
          via.SetZoneLayerOverride(layer, ZONE_LAYER_OVERRIDE.ZLO_FORCE_NO_ZONE_CONNECTION);

        for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
          const layer = p.lookUpLayerCur();

          if (!IsCopperLayer(layer)) p.Expecting('copper layer name');

          via.SetZoneLayerOverride(layer, ZONE_LAYER_OVERRIDE.ZLO_FORCE_FLASHED);
        }

        break;
      }

      case 'padstack':
        parseViastack(p, via);
        break;

      case 'teardrops':
        p.parseTEARDROP_PARAMETERS(via.GetTeardropParams());
        break;

      case 'tenting': {
        const [front, back] = p.parseFrontBackOptBool(true);
        via.Padstack().FrontOuterLayers().has_solder_mask = front;
        via.Padstack().BackOuterLayers().has_solder_mask = back;
        break;
      }

      case 'covering': {
        const [front, back] = p.parseFrontBackOptBool();
        via.Padstack().FrontOuterLayers().has_covering = front;
        via.Padstack().BackOuterLayers().has_covering = back;
        break;
      }

      case 'plugging': {
        const [front, back] = p.parseFrontBackOptBool();
        via.Padstack().FrontOuterLayers().has_plugging = front;
        via.Padstack().BackOuterLayers().has_plugging = back;
        break;
      }

      case 'filling':
        via.Padstack().Drill().is_filled = p.parseOptBool();
        p.NeedRIGHT();
        break;

      case 'capping':
        via.Padstack().Drill().is_capped = p.parseOptBool();
        p.NeedRIGHT();
        break;

      case 'tstamp':
      case 'uuid':
        p.NextTok();
        setUuid(via, p.CurStrToKIID());
        p.NeedRIGHT();
        break;

      // We continue to parse the status field but it is no longer written
      case 'status':
        p.parseHex();
        p.NeedRIGHT();
        break;

      case 'locked':
        via.SetLocked(p.parseMaybeAbsentBool(true));
        break;

      case 'free':
        via.SetIsFree(p.parseMaybeAbsentBool(true));
        break;

      case 'backdrill': {
        // Parse: (backdrill (size ...) (layers start end))
        const secondary = via.Padstack().SecondaryDrill();

        for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
          if (token !== T.LEFT) p.Expecting(T.LEFT);

          token = p.NextTok();

          switch (token) {
            case 'size': {
              const size = p.parseBoardUnits('backdrill size');
              secondary.size = { x: size, y: size };
              p.NeedRIGHT();
              break;
            }

            case 'layers': {
              p.NextTok();
              secondary.start = p.lookUpLayerCur();
              p.NextTok();
              secondary.end = p.lookUpLayerCur();
              p.NeedRIGHT();
              break;
            }

            default:
              p.Expecting('size or layers');
          }
        }

        break;
      }

      case 'tertiary_drill': {
        // Parse: (tertiary_drill (size ...) (layers start end))
        const tertiary = via.Padstack().TertiaryDrill();

        for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
          if (token !== T.LEFT) p.Expecting(T.LEFT);

          token = p.NextTok();

          switch (token) {
            case 'size': {
              const size = p.parseBoardUnits('tertiary drill size');
              tertiary.size = { x: size, y: size };
              p.NeedRIGHT();
              break;
            }

            case 'layers': {
              p.NextTok();
              tertiary.start = p.lookUpLayerCur();
              p.NextTok();
              tertiary.end = p.lookUpLayerCur();
              p.NeedRIGHT();
              break;
            }

            default:
              p.Expecting('size or layers');
          }
        }

        break;
      }

      case 'front_post_machining':
        parsePostMachining(p, via.Padstack().FrontPostMachining());
        break;

      case 'back_post_machining':
        parsePostMachining(p, via.Padstack().BackPostMachining());
        break;

      default:
        p.Expecting(
          'blind, micro, at, size, drill, layers, net, free, tstamp, uuid, status, ' +
            'teardrops, backdrill, tertiary_drill, front_post_machining, or ' +
            'back_post_machining',
        );
    }
  }

  return via;
}

function parseViastack(p: PCB_IO_KICAD_SEXPR_PARSER, aVia: PCB_VIA): void {
  const padstack = aVia.Padstack();

  for (let token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
    if (token !== T.LEFT) p.Expecting(T.LEFT);

    token = p.NextTok();

    switch (token) {
      case 'mode':
        token = p.NextTok();

        switch (token) {
          case 'front_inner_back':
            padstack.SetMode(PADSTACK_MODE.FRONT_INNER_BACK);
            break;

          case 'custom':
            padstack.SetMode(PADSTACK_MODE.CUSTOM);
            break;

          default:
            p.Expecting('front_inner_back or custom');
        }

        p.NeedRIGHT();
        break;

      case 'layer': {
        p.NextTok();
        let curLayer: PCB_LAYER_ID = UNDEFINED_LAYER;

        if (p.CurText() === 'Inner') {
          if (padstack.Mode() !== PADSTACK_MODE.FRONT_INNER_BACK) {
            throw new IO_ERROR(
              `Invalid padstack layer in\nfile: ${p.CurSource()}\nline: ${p.CurLineNumber()}\noffset: ${p.CurOffset()}.`,
            );
          }

          curLayer = PADSTACK.INNER_LAYERS;
        } else {
          curLayer = p.lookUpLayerCur();
        }

        if (!IsCopperLayer(curLayer)) {
          throw new IO_ERROR(
            `Invalid padstack layer '${p.CurText()}' in file '${p.CurSource()}' at line ${p.CurLineNumber()}, offset ${p.CurOffset()}.`,
          );
        }

        for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
          if (token !== T.LEFT) p.Expecting(T.LEFT);

          token = p.NextTok();

          switch (token) {
            case 'size': {
              const diameter = p.parseBoardUnits('via width');
              padstack.SetSize({ x: diameter, y: diameter }, curLayer);
              p.NeedRIGHT();
              break;
            }

            default:
              // Currently only supporting custom via diameter per layer, not other properties
              p.Expecting('size');
          }
        }

        break;
      }

      default:
        p.Expecting('mode or layer');
        break;
    }
  }
}

// ---------------------------------------------------------------------------
// parseZONE (:7863)
// ---------------------------------------------------------------------------

export function parseZONE(
  p: PCB_IO_KICAD_SEXPR_PARSER,
  aParent: BOARD_ITEM_CONTAINER | null,
): ZONE {
  let hatchStyle = ZONE_BORDER_DISPLAY_STYLE.NO_HATCH;

  let hatchPitch = ZONE.GetDefaultHatchPitch();
  let token: Tok;
  let tmp: number;
  let legacyNetnameFromFile = ''; // the (non-authoratative) zone net name found in a legacy file

  // bigger scope since each filled_polygon is concatenated in here
  const pts = new Map<PCB_LAYER_ID, SHAPE_POLY_SET>();
  const legacySegs = new Map<PCB_LAYER_ID, SEG[]>();
  let filledLayer: PCB_LAYER_ID;
  let addedFilledPolygons = false;

  // This hasn't been supported since V6 or so, but we only stopped writing out the token
  // in V10.
  let isStrokedFill = p.m_requiredVersion < 20250210;

  const zone = new ZONE(aParent);

  zone.SetAssignedPriority(0);

  // This is the default for board files:
  zone.SetIslandRemovalMode(ISLAND_REMOVAL_MODE.ALWAYS);

  for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
    // legacy locked
    if (token === 'locked') {
      zone.SetLocked(true);
      token = p.NextTok();
    }

    if (token === T.LEFT) token = p.NextTok();

    switch (token) {
      case 'net':
        p.parseNet(zone);
        break;

      case 'net_name':
        p.NeedSYMBOLorNUMBER();
        legacyNetnameFromFile = p.CurText();
        p.NeedRIGHT();
        break;

      case 'layer': // keyword for zones that are on only one layer
        zone.SetLayer(p.parseBoardItemLayer());
        p.NeedRIGHT();
        break;

      case 'layers': // keyword for zones that can live on a set of layers
        zone.SetLayerSet(p.parseBoardItemLayersAsMask());
        break;

      case 'property':
        p.parseZoneLayerProperty(zone.LayerProperties());
        break;

      case 'tstamp':
      case 'uuid':
        p.NextTok();
        setUuid(zone, p.CurStrToKIID());
        p.NeedRIGHT();
        break;

      case 'hatch':
        token = p.NextTok();

        if (token !== 'none' && token !== 'edge' && token !== 'full')
          p.Expecting('none, edge, or full');

        switch (token) {
          default:
          case 'none':
            hatchStyle = ZONE_BORDER_DISPLAY_STYLE.NO_HATCH;
            break;
          case 'edge':
            hatchStyle = ZONE_BORDER_DISPLAY_STYLE.DIAGONAL_EDGE;
            break;
          case 'full':
            hatchStyle = ZONE_BORDER_DISPLAY_STYLE.DIAGONAL_FULL;
            break;
        }

        hatchPitch = p.parseBoardUnits('hatch pitch');
        p.NeedRIGHT();
        break;

      case 'priority':
        zone.SetAssignedPriority(p.parseInt('zone priority'));
        p.NeedRIGHT();
        break;

      case 'connect_pads':
        for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
          if (token === T.LEFT) token = p.NextTok();

          switch (token) {
            case 'yes':
              zone.SetPadConnection(ZONE_CONNECTION.FULL);
              break;

            case 'no':
              zone.SetPadConnection(ZONE_CONNECTION.NONE);
              break;

            case 'thru_hole_only':
              zone.SetPadConnection(ZONE_CONNECTION.THT_THERMAL);
              break;

            case 'clearance':
              zone.SetLocalClearance(p.parseBoardUnits('zone clearance'));
              p.NeedRIGHT();
              break;

            default:
              p.Expecting('yes, no, or clearance');
          }
        }

        break;

      case 'min_thickness':
        zone.SetMinThickness(p.parseBoardUnits('min_thickness'));
        p.NeedRIGHT();
        break;

      case 'filled_areas_thickness':
        // A new zone fill strategy was added in v6, so we need to know if we're parsing
        // a zone that was filled before that. Note that the change was implemented as
        // a new parameter, so we need to check for the  presence of filled_areas_thickness
        // instead of just its value.

        if (!p.parseBool()) isStrokedFill = false;

        p.NeedRIGHT();
        break;

      case 'fill':
        for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
          if (token === T.LEFT) token = p.NextTok();

          switch (token) {
            case 'yes':
              zone.SetIsFilled(true);
              break;

            case 'mode':
              token = p.NextTok();

              if (token !== 'segment' && token !== 'hatch' && token !== 'polygon')
                p.Expecting('segment, hatch or polygon');

              switch (token) {
                case 'hatch':
                  zone.SetFillMode(ZONE_FILL_MODE.HATCH_PATTERN);
                  break;

                case 'segment': // deprecated, convert to polygons
                case 'polygon':
                default:
                  zone.SetFillMode(ZONE_FILL_MODE.POLYGONS);
                  break;
              }

              p.NeedRIGHT();
              break;

            case 'hatch_thickness':
              zone.SetHatchThickness(p.parseBoardUnits('hatch_thickness'));
              p.NeedRIGHT();
              break;

            case 'hatch_gap':
              zone.SetHatchGap(p.parseBoardUnits('hatch_gap'));
              p.NeedRIGHT();
              break;

            case 'hatch_orientation': {
              const orientation = new EDA_ANGLE(p.parseDoubleNext('hatch_orientation'));
              zone.SetHatchOrientation(orientation);
              p.NeedRIGHT();
              break;
            }

            case 'hatch_smoothing_level':
              zone.SetHatchSmoothingLevel(p.parseDoubleNext('hatch_smoothing_level'));
              p.NeedRIGHT();
              break;

            case 'hatch_smoothing_value':
              zone.SetHatchSmoothingValue(p.parseDoubleNext('hatch_smoothing_value'));
              p.NeedRIGHT();
              break;

            case 'hatch_border_algorithm':
              token = p.NextTok();

              if (token !== 'hatch_thickness' && token !== 'min_thickness')
                p.Expecting('hatch_thickness or min_thickness');

              zone.SetHatchBorderAlgorithm(token === 'hatch_thickness' ? 1 : 0);
              p.NeedRIGHT();
              break;

            case 'hatch_min_hole_area':
              zone.SetHatchHoleMinArea(p.parseDoubleNext('hatch_min_hole_area'));
              p.NeedRIGHT();
              break;

            case 'arc_segments':
              p.parseInt('arc segment count');
              p.NeedRIGHT();
              break;

            case 'thermal_gap':
              zone.SetThermalReliefGap(p.parseBoardUnits('thermal_gap'));
              p.NeedRIGHT();
              break;

            case 'thermal_bridge_width':
              zone.SetThermalReliefSpokeWidth(p.parseBoardUnits('thermal_bridge_width'));
              p.NeedRIGHT();
              break;

            case 'smoothing':
              switch (p.NextTok()) {
                case 'none':
                  zone.SetCornerSmoothingType(ZONE_SETTINGS.SMOOTHING_NONE);
                  break;

                case 'chamfer':
                  if (!zone.GetIsRuleArea())
                    // smoothing has meaning only for filled zones
                    zone.SetCornerSmoothingType(ZONE_SETTINGS.SMOOTHING_CHAMFER);

                  break;

                case 'fillet':
                  if (!zone.GetIsRuleArea())
                    // smoothing has meaning only for filled zones
                    zone.SetCornerSmoothingType(ZONE_SETTINGS.SMOOTHING_FILLET);

                  break;

                default:
                  p.Expecting('none, chamfer, or fillet');
              }

              p.NeedRIGHT();
              break;

            case 'radius':
              tmp = p.parseBoardUnits('corner radius');

              if (!zone.GetIsRuleArea())
                // smoothing has meaning only for filled zones
                zone.SetCornerRadius(tmp);

              p.NeedRIGHT();
              break;

            case 'island_removal_mode':
              tmp = p.parseInt('island_removal_mode');

              if (tmp >= 0 && tmp <= 2) zone.SetIslandRemovalMode(tmp as ISLAND_REMOVAL_MODE);

              p.NeedRIGHT();
              break;

            case 'island_area_min': {
              const area = p.parseBoardUnits('island_area_min');
              zone.SetMinIslandArea(area * pcbIUScale.IU_PER_MM);
              p.NeedRIGHT();
              break;
            }

            default:
              p.Expecting(
                'mode, arc_segments, thermal_gap, thermal_bridge_width, ' +
                  'hatch_thickness, hatch_gap, hatch_orientation, ' +
                  'hatch_smoothing_level, hatch_smoothing_value, ' +
                  'hatch_border_algorithm, hatch_min_hole_area, smoothing, radius, ' +
                  'island_removal_mode, or island_area_min',
              );
          }
        }

        break;

      case 'placement':
        zone.SetIsRuleArea(true);

        for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
          if (token === T.LEFT) token = p.NextTok();

          switch (token) {
            case 'sheetname': {
              zone.SetPlacementAreaSourceType(PLACEMENT_SOURCE_T.SHEETNAME);
              p.NeedSYMBOL();
              zone.SetPlacementAreaSource(p.CurText());
              break;
            }
            case 'component_class': {
              zone.SetPlacementAreaSourceType(PLACEMENT_SOURCE_T.COMPONENT_CLASS);
              p.NeedSYMBOL();
              zone.SetPlacementAreaSource(p.CurText());
              break;
            }
            case 'group': {
              zone.SetPlacementAreaSourceType(PLACEMENT_SOURCE_T.GROUP_PLACEMENT);
              p.NeedSYMBOL();
              zone.SetPlacementAreaSource(p.CurText());
              break;
            }
            case 'enabled': {
              token = p.NextTok();

              if (token === 'yes') zone.SetPlacementAreaEnabled(true);
              else if (token === 'no') zone.SetPlacementAreaEnabled(false);
              else p.Expecting('yes or no');

              break;
            }
            default: {
              p.Expecting('enabled, sheetname, component_class, or group');
              break;
            }
          }

          p.NeedRIGHT();
        }

        break;

      case 'keepout':
        // "keepout" now means rule area, but the file token stays the same
        zone.SetIsRuleArea(true);

        // Initialize these two because their tokens won't appear in older files:
        zone.SetDoNotAllowPads(false);
        zone.SetDoNotAllowFootprints(false);

        for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
          if (token === T.LEFT) token = p.NextTok();

          switch (token) {
            case 'tracks':
              token = p.NextTok();

              if (token !== 'allowed' && token !== 'not_allowed')
                p.Expecting('allowed or not_allowed');

              zone.SetDoNotAllowTracks(token === 'not_allowed');
              break;

            case 'vias':
              token = p.NextTok();

              if (token !== 'allowed' && token !== 'not_allowed')
                p.Expecting('allowed or not_allowed');

              zone.SetDoNotAllowVias(token === 'not_allowed');
              break;

            case 'copperpour':
              token = p.NextTok();

              if (token !== 'allowed' && token !== 'not_allowed')
                p.Expecting('allowed or not_allowed');

              zone.SetDoNotAllowZoneFills(token === 'not_allowed');
              break;

            case 'pads':
              token = p.NextTok();

              if (token !== 'allowed' && token !== 'not_allowed')
                p.Expecting('allowed or not_allowed');

              zone.SetDoNotAllowPads(token === 'not_allowed');
              break;

            case 'footprints':
              token = p.NextTok();

              if (token !== 'allowed' && token !== 'not_allowed')
                p.Expecting('allowed or not_allowed');

              zone.SetDoNotAllowFootprints(token === 'not_allowed');
              break;

            default:
              p.Expecting('tracks, vias or copperpour');
          }

          p.NeedRIGHT();
        }

        break;

      case 'polygon': {
        const outline = new SHAPE_LINE_CHAIN();

        p.NeedLEFT();
        token = p.NextTok();

        if (token !== 'pts') p.Expecting('pts');

        for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok())
          p.parseOutlinePoints(outline);

        p.NeedRIGHT();

        outline.SetClosed(true);

        if (outline.PointCount() === 0) break;

        // Remark: The first polygon is the main outline.
        // Others are holes inside the main outline.
        zone.AddPolygon(outline);
        break;
      }

      case 'filled_polygon': {
        // "(filled_polygon (pts"
        p.NeedLEFT();
        token = p.NextTok();

        if (token === 'layer') {
          filledLayer = p.parseBoardItemLayer();
          p.NeedRIGHT();
          token = p.NextTok();

          if (token !== T.LEFT) p.Expecting(T.LEFT);

          token = p.NextTok();
        } else {
          // for legacy, single-layer zones
          filledLayer = zone.GetFirstLayer();
        }

        let island = false;

        if (token === 'island') {
          island = p.parseMaybeAbsentBool(true);
          p.NeedLEFT();
          token = p.NextTok();
        }

        if (token !== 'pts') p.Expecting('pts');

        if (!pts.has(filledLayer)) pts.set(filledLayer, new SHAPE_POLY_SET());

        const poly = pts.get(filledLayer)!;

        const idx = poly.NewOutline();
        const chain = poly.Outline(idx);

        if (island) zone.SetIsIsland(filledLayer, idx);

        for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok())
          p.parseOutlinePoints(chain);

        p.NeedRIGHT();

        addedFilledPolygons ||= !poly.IsEmpty();
        break;
      }

      case 'fill_segments': {
        // Legacy segment fill

        for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
          if (token !== T.LEFT) p.Expecting(T.LEFT);

          token = p.NextTok();

          if (token !== 'pts') p.Expecting('pts');

          // Legacy zones only had one layer
          filledLayer = zone.GetFirstLayer();

          const fillSegment = { A: p.parseXY(), B: p.parseXY() } as SEG;

          let segs = legacySegs.get(filledLayer);

          if (!segs) {
            segs = [];
            legacySegs.set(filledLayer, segs);
          }

          segs.push(fillSegment);

          p.NeedRIGHT();
        }

        break;
      }

      case 'name':
        p.NextTok();
        zone.SetZoneName(p.CurText());
        p.NeedRIGHT();
        break;

      case 'attr':
        for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
          if (token === T.LEFT) token = p.NextTok();

          switch (token) {
            case 'teardrop':
              for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
                if (token === T.LEFT) token = p.NextTok();

                switch (token) {
                  case 'type':
                    token = p.NextTok();

                    if (token === 'padvia') zone.SetTeardropAreaType(TEARDROP_TYPE.TD_VIAPAD);
                    else if (token === 'track_end')
                      zone.SetTeardropAreaType(TEARDROP_TYPE.TD_TRACKEND);
                    else p.Expecting('padvia or track_end');

                    p.NeedRIGHT();
                    break;

                  default:
                    p.Expecting('type');
                }
              }

              break;

            default:
              p.Expecting('teardrop');
          }
        }
        break;

      case 'locked':
        zone.SetLocked(p.parseBool());
        p.NeedRIGHT();
        break;

      default:
        p.Expecting(
          'net, layer/layers, tstamp, hatch, priority, connect_pads, min_thickness, ' +
            'fill, polygon, filled_polygon, fill_segments, attr, locked, uuid, or name',
        );
    }
  }

  if (zone.GetNumCorners() > 2) {
    if (!zone.IsOnCopperLayer()) {
      //zone->SetFillMode( ZONE_FILL_MODE::POLYGONS );
      zone.SetNetCode(NETINFO_LIST.UNCONNECTED);
    }

    // Set hatch here, after outlines corners are read
    zone.SetBorderDisplayStyle(hatchStyle, hatchPitch, true);
  }

  if (addedFilledPolygons) {
    if (isStrokedFill && !zone.GetIsRuleArea()) {
      if (p.m_showLegacy5ZoneWarning) {
        p.m_parseWarnings.push(
          'Legacy zone fill strategy is not supported anymore.\nZone fills will be converted on best-effort basis.',
        );

        p.m_showLegacy5ZoneWarning = false;
      }

      if (zone.GetMinThickness() > 0) {
        for (const [, polyset] of pts) {
          polyset.InflateWithLinkedHoles(
            Math.trunc(zone.GetMinThickness() / 2),
            CornerStrategy.ROUND_ALL_CORNERS,
            Math.trunc(ARC_HIGH_DEF / 2),
          );
        }
      }
    }

    for (const [layer, polyset] of pts) zone.SetFilledPolysList(layer, polyset);

    zone.CalculateFilledArea();
  } else if (legacySegs.size > 0) {
    // No polygons, just segment fill?
    // Note RFB: This code might be removed if turns out this never existed for sexpr file
    // format or otherwise we should add a test case to the qa folder

    if (p.m_showLegacySegmentZoneWarning) {
      p.m_parseWarnings.push(
        'The legacy segment zone fill mode is no longer supported.\nZone fills will be converted on a best-effort basis.',
      );

      p.m_showLegacySegmentZoneWarning = false;
    }

    for (const [layer, segments] of legacySegs) {
      let layerFill = new SHAPE_POLY_SET();

      if (zone.HasFilledPolysForLayer(layer)) layerFill = new SHAPE_POLY_SET(zone.GetFill(layer)!);

      for (const seg of segments) {
        const segPolygon = new SHAPE_POLY_SET();

        TransformOvalToPolygon(
          segPolygon,
          seg.A,
          seg.B,
          zone.GetMinThickness(),
          ARC_HIGH_DEF,
          ERROR_LOC.ERROR_OUTSIDE,
        );

        layerFill.BooleanAdd(segPolygon);
      }

      zone.SetFilledPolysList(layer, layerFill);
      zone.CalculateFilledArea();
    }
  }

  // Ensure keepout and non copper zones do not have a net
  // (which have no sense for these zones)
  // the netcode 0 is used for these zones
  const zone_has_net = zone.IsOnCopperLayer() && !zone.GetIsRuleArea();

  if (!zone_has_net) zone.SetNetCode(NETINFO_LIST.UNCONNECTED);

  // In legacy files, ensure the zone net name is valid, and matches the net code
  if (legacyNetnameFromFile !== '' && zone.GetNetname() !== legacyNetnameFromFile) {
    // Can happens which old boards, with nonexistent nets ...
    // or after being edited by hand
    // We try to fix the mismatch.
    const board = p.m_board!;
    let net = board.FindNet(legacyNetnameFromFile);

    if (net) {
      // An existing net has the same net name. use it for the zone
      zone.SetNetCode(net.GetNetCode());
    } else {
      // Not existing net: add a new net to keep track of the zone netname
      const newnetcode = board.GetNetCount();
      net = new NETINFO_ITEM(board, legacyNetnameFromFile, newnetcode);
      board.Add(net, ADD_MODE.INSERT, true);

      // Store the new code mapping
      p.pushValueIntoMap(newnetcode, net.GetNetCode());

      // and update the zone netcode
      zone.SetNetCode(net.GetNetCode());
    }
  }

  if (zone.IsTeardropArea() && p.m_requiredVersion < 20230517) p.m_board!.SetLegacyTeardrops(true);

  // Clear flags used in zone edition:
  zone.SetNeedRefill(false);

  return zone;
}

// ---------------------------------------------------------------------------
// parsePCB_POINT (:8582), parsePCB_TARGET (:8632)
// ---------------------------------------------------------------------------

export function parsePCB_POINT(p: PCB_IO_KICAD_SEXPR_PARSER): PCB_POINT {
  const point = new PCB_POINT(null);

  for (let token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
    if (token === T.LEFT) token = p.NextTok();

    switch (token) {
      case 'at': {
        const pt: VECTOR2I = { x: 0, y: 0 };
        pt.x = p.parseBoardUnits('point x position');
        pt.y = p.parseBoardUnits('point y position');
        point.SetPosition(pt);
        p.NeedRIGHT();
        break;
      }
      case 'size': {
        point.SetSize(p.parseBoardUnits('point size'));
        p.NeedRIGHT();
        break;
      }
      case 'layer': {
        point.SetLayer(p.parseBoardItemLayer());
        p.NeedRIGHT();
        break;
      }
      case 'uuid': {
        p.NextTok();
        setUuid(point, p.CurStrToKIID());
        p.NeedRIGHT();
        break;
      }
      default:
        p.Expecting('at, size, layer or uuid');
    }
  }

  return point;
}

export function parsePCB_TARGET(p: PCB_IO_KICAD_SEXPR_PARSER): PCB_TARGET {
  const pt: VECTOR2I = { x: 0, y: 0 };
  let token: Tok;

  const target = new PCB_TARGET(null);

  for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
    if (token === T.LEFT) token = p.NextTok();

    switch (token) {
      case 'x':
        target.SetShape(1);
        break;

      case 'plus':
        target.SetShape(0);
        break;

      case 'at':
        pt.x = p.parseBoardUnits('target x position');
        pt.y = p.parseBoardUnits('target y position');
        target.SetPosition(pt);
        p.NeedRIGHT();
        break;

      case 'size':
        target.SetSize(p.parseBoardUnits('target size'));
        p.NeedRIGHT();
        break;

      case 'width':
        target.SetWidth(p.parseBoardUnits('target thickness'));
        p.NeedRIGHT();
        break;

      case 'layer':
        target.SetLayer(p.parseBoardItemLayer());
        p.NeedRIGHT();
        break;

      case 'tstamp':
      case 'uuid':
        p.NextTok();
        setUuid(target, p.CurStrToKIID());
        p.NeedRIGHT();
        break;

      default:
        p.Expecting('x, plus, at, size, width, layer, uuid, or tstamp');
    }
  }

  return target;
}
