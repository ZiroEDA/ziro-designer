// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/sch_io/kicad_sexpr/sch_io_kicad_sexpr_common.cpp`: the token and shape
 * formatters the schematic writer and the symbol library cache share (eeschema stage E3).
 */

import type { EDA_SHAPE } from '@ziroeda/common/eda_shape.js';
import { FILL_T } from '@ziroeda/common/eda_shape.js';
import { FormatInternalUnits, schIUScale } from '@ziroeda/common/eda_units.js';
import type { Color4d } from '@ziroeda/common/gal/color4d.js';
import { type KIID, niluuid } from '@ziroeda/common/kiid.js';
import { ELECTRICAL_PINTYPE, GRAPHIC_PINSHAPE, PIN_ORIENTATION } from '@ziroeda/common/pin_type.js';
import type { OUTPUTFORMATTER } from '@ziroeda/common/richio.js';
import type { STROKE_PARAMS } from '@ziroeda/common/stroke_params.js';
import { FormatDouble2Str } from '@ziroeda/common/string_utils.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import {
  ANGLE_0,
  ANGLE_180,
  ANGLE_270,
  ANGLE_90,
  type EDA_ANGLE,
} from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { LABEL_FLAG_SHAPE } from '../../sch_label.js';
import { SHEET_SIDE } from '../../sch_sheet_pin.js';

/** The parts of an `EDA_SHAPE` the formatters read (a SCH_SHAPE is one by mixin). */
type SHAPE_GEOMETRY = Pick<
  EDA_SHAPE,
  | 'GetStart'
  | 'GetEnd'
  | 'GetArcMid'
  | 'GetRadius'
  | 'GetCornerRadius'
  | 'GetBezierC1'
  | 'GetBezierC2'
  | 'GetPolyShape'
>;

/**
 * Fill token formatting helper.
 */
export function formatFill(
  aFormatter: OUTPUTFORMATTER,
  aFillMode: FILL_T,
  aFillColor: Color4d,
): void {
  let fillType: string;

  switch (aFillMode) {
    case FILL_T.FILLED_SHAPE:
      fillType = 'outline';
      break;
    case FILL_T.FILLED_WITH_BG_BODYCOLOR:
      fillType = 'background';
      break;
    case FILL_T.FILLED_WITH_COLOR:
      fillType = 'color';
      break;
    case FILL_T.HATCH:
      fillType = 'hatch';
      break;
    case FILL_T.REVERSE_HATCH:
      fillType = 'reverse_hatch';
      break;
    case FILL_T.CROSS_HATCH:
      fillType = 'cross_hatch';
      break;
    default:
      fillType = 'none';
      break;
  }

  if (
    aFillMode === FILL_T.FILLED_WITH_COLOR ||
    aFillMode === FILL_T.HATCH ||
    aFillMode === FILL_T.REVERSE_HATCH ||
    aFillMode === FILL_T.CROSS_HATCH
  ) {
    aFormatter.Print(
      `(fill (type ${fillType}) (color ${KiROUND(aFillColor.r * 255.0)} ${KiROUND(aFillColor.g * 255.0)} ${KiROUND(aFillColor.b * 255.0)} ${FormatDouble2Str(aFillColor.a)}))`,
    );
  } else {
    aFormatter.Print(`(fill (type ${fillType}))`);
  }
}

export function getPinElectricalTypeToken(aType: ELECTRICAL_PINTYPE): string {
  switch (aType) {
    case ELECTRICAL_PINTYPE.PT_INPUT:
      return 'input';
    case ELECTRICAL_PINTYPE.PT_OUTPUT:
      return 'output';
    case ELECTRICAL_PINTYPE.PT_BIDI:
      return 'bidirectional';
    case ELECTRICAL_PINTYPE.PT_TRISTATE:
      return 'tri_state';
    case ELECTRICAL_PINTYPE.PT_PASSIVE:
      return 'passive';
    case ELECTRICAL_PINTYPE.PT_NIC:
      return 'free';
    case ELECTRICAL_PINTYPE.PT_UNSPECIFIED:
      return 'unspecified';
    case ELECTRICAL_PINTYPE.PT_POWER_IN:
      return 'power_in';
    case ELECTRICAL_PINTYPE.PT_POWER_OUT:
      return 'power_out';
    case ELECTRICAL_PINTYPE.PT_OPENCOLLECTOR:
      return 'open_collector';
    case ELECTRICAL_PINTYPE.PT_OPENEMITTER:
      return 'open_emitter';
    case ELECTRICAL_PINTYPE.PT_NC:
      return 'no_connect';
    default:
      // wxFAIL_MSG( "Missing symbol library pin connection type" )
      return '';
  }
}

export function getPinShapeToken(aShape: GRAPHIC_PINSHAPE): string {
  switch (aShape) {
    case GRAPHIC_PINSHAPE.LINE:
      return 'line';
    case GRAPHIC_PINSHAPE.INVERTED:
      return 'inverted';
    case GRAPHIC_PINSHAPE.CLOCK:
      return 'clock';
    case GRAPHIC_PINSHAPE.INVERTED_CLOCK:
      return 'inverted_clock';
    case GRAPHIC_PINSHAPE.INPUT_LOW:
      return 'input_low';
    case GRAPHIC_PINSHAPE.CLOCK_LOW:
      return 'clock_low';
    case GRAPHIC_PINSHAPE.OUTPUT_LOW:
      return 'output_low';
    case GRAPHIC_PINSHAPE.FALLING_EDGE_CLOCK:
      return 'edge_clock_high';
    case GRAPHIC_PINSHAPE.NONLOGIC:
      return 'non_logic';
    default:
      // wxFAIL_MSG( "Missing symbol library pin shape type" )
      return '';
  }
}

export function getPinAngle(aOrientation: PIN_ORIENTATION): EDA_ANGLE {
  switch (aOrientation) {
    case PIN_ORIENTATION.PIN_RIGHT:
      return ANGLE_0;
    case PIN_ORIENTATION.PIN_LEFT:
      return ANGLE_180;
    case PIN_ORIENTATION.PIN_UP:
      return ANGLE_90;
    case PIN_ORIENTATION.PIN_DOWN:
      return ANGLE_270;
    default:
      // wxFAIL_MSG( "Missing symbol library pin orientation type" )
      return ANGLE_0;
  }
}

export function getSheetPinShapeToken(aShape: LABEL_FLAG_SHAPE): string {
  switch (aShape) {
    case LABEL_FLAG_SHAPE.L_INPUT:
      return 'input';
    case LABEL_FLAG_SHAPE.L_OUTPUT:
      return 'output';
    case LABEL_FLAG_SHAPE.L_BIDI:
      return 'bidirectional';
    case LABEL_FLAG_SHAPE.L_TRISTATE:
      return 'tri_state';
    case LABEL_FLAG_SHAPE.L_UNSPECIFIED:
      return 'passive';
    case LABEL_FLAG_SHAPE.F_DOT:
      return 'dot';
    case LABEL_FLAG_SHAPE.F_ROUND:
      return 'round';
    case LABEL_FLAG_SHAPE.F_DIAMOND:
      return 'diamond';
    case LABEL_FLAG_SHAPE.F_RECTANGLE:
      return 'rectangle';
    default:
      // wxFAIL
      return 'passive';
  }
}

export function getSheetPinAngle(aSide: SHEET_SIDE): EDA_ANGLE {
  switch (aSide) {
    case SHEET_SIDE.UNDEFINED:
    case SHEET_SIDE.LEFT:
      return ANGLE_180;
    case SHEET_SIDE.RIGHT:
      return ANGLE_0;
    case SHEET_SIDE.TOP:
      return ANGLE_90;
    case SHEET_SIDE.BOTTOM:
      return ANGLE_270;
    default:
      // wxFAIL
      return ANGLE_0;
  }
}

export function getTextTypeToken(aType: KICAD_T): string {
  switch (aType) {
    case KICAD_T.SCH_TEXT_T:
      return 'text';
    case KICAD_T.SCH_LABEL_T:
      return 'label';
    case KICAD_T.SCH_GLOBAL_LABEL_T:
      return 'global_label';
    case KICAD_T.SCH_HIER_LABEL_T:
      return 'hierarchical_label';
    case KICAD_T.SCH_DIRECTIVE_LABEL_T:
      return 'netclass_flag';
    default:
      // wxFAIL
      return 'text';
  }
}

/** `formatIU( const int& aValue )`, or `formatIU( const VECTOR2I& aPt, bool aInvertY )`. */
export function formatIU(aValue: number | VECTOR2I, aInvertY = false): string {
  if (typeof aValue === 'number') return FormatInternalUnits(schIUScale, aValue);

  const y = aInvertY ? -aValue.y : aValue.y;

  return `${FormatInternalUnits(schIUScale, aValue.x)} ${FormatInternalUnits(schIUScale, y)}`;
}

/** The `(uuid …)` a shape carries in a schematic, not in a library (nil there). */
function formatShapeUuid(aFormatter: OUTPUTFORMATTER, aUuid: KIID): void {
  if (aUuid !== niluuid) aFormatter.Print(`(uuid ${aFormatter.Quotew(aUuid)})`);
}

export function formatArc(
  aFormatter: OUTPUTFORMATTER,
  aArc: SHAPE_GEOMETRY,
  aIsPrivate: boolean,
  aStroke: STROKE_PARAMS,
  aFillMode: FILL_T,
  aFillColor: Color4d,
  aInvertY: boolean,
  aUuid: KIID = niluuid,
): void {
  aFormatter.Print(
    `(arc ${aIsPrivate ? 'private' : ''} (start ${formatIU(aArc.GetStart(), aInvertY)}) (mid ${formatIU(aArc.GetArcMid(), aInvertY)}) (end ${formatIU(aArc.GetEnd(), aInvertY)})`,
  );

  aStroke.Format(aFormatter, schIUScale);
  formatFill(aFormatter, aFillMode, aFillColor);
  formatShapeUuid(aFormatter, aUuid);

  aFormatter.Print(')');
}

export function formatCircle(
  aFormatter: OUTPUTFORMATTER,
  aCircle: SHAPE_GEOMETRY,
  aIsPrivate: boolean,
  aStroke: STROKE_PARAMS,
  aFillMode: FILL_T,
  aFillColor: Color4d,
  aInvertY: boolean,
  aUuid: KIID = niluuid,
): void {
  aFormatter.Print(
    `(circle ${aIsPrivate ? 'private' : ''} (center ${formatIU(aCircle.GetStart(), aInvertY)}) (radius ${formatIU(aCircle.GetRadius())})`,
  );

  aStroke.Format(aFormatter, schIUScale);
  formatFill(aFormatter, aFillMode, aFillColor);
  formatShapeUuid(aFormatter, aUuid);

  aFormatter.Print(')');
}

export function formatRect(
  aFormatter: OUTPUTFORMATTER,
  aRect: SHAPE_GEOMETRY,
  aIsPrivate: boolean,
  aStroke: STROKE_PARAMS,
  aFillMode: FILL_T,
  aFillColor: Color4d,
  aInvertY: boolean,
  aUuid: KIID = niluuid,
): void {
  aFormatter.Print(
    `(rectangle ${aIsPrivate ? 'private' : ''} (start ${formatIU(aRect.GetStart(), aInvertY)}) (end ${formatIU(aRect.GetEnd(), aInvertY)})`,
  );

  if (aRect.GetCornerRadius() > 0)
    aFormatter.Print(`(radius ${formatIU(aRect.GetCornerRadius())})`);

  aStroke.Format(aFormatter, schIUScale);
  formatFill(aFormatter, aFillMode, aFillColor);
  formatShapeUuid(aFormatter, aUuid);

  aFormatter.Print(')');
}

export function formatBezier(
  aFormatter: OUTPUTFORMATTER,
  aBezier: SHAPE_GEOMETRY,
  aIsPrivate: boolean,
  aStroke: STROKE_PARAMS,
  aFillMode: FILL_T,
  aFillColor: Color4d,
  aInvertY: boolean,
  aUuid: KIID = niluuid,
): void {
  aFormatter.Print(`(bezier ${aIsPrivate ? 'private' : ''} (pts `);

  for (const pt of [
    aBezier.GetStart(),
    aBezier.GetBezierC1(),
    aBezier.GetBezierC2(),
    aBezier.GetEnd(),
  ]) {
    aFormatter.Print(`(xy ${formatIU(pt, aInvertY)})`);
  }

  aFormatter.Print(')'); // Closes pts token

  aStroke.Format(aFormatter, schIUScale);
  formatFill(aFormatter, aFillMode, aFillColor);
  formatShapeUuid(aFormatter, aUuid);

  aFormatter.Print(')');
}

export function formatPoly(
  aFormatter: OUTPUTFORMATTER,
  aPolyLine: SHAPE_GEOMETRY,
  aIsPrivate: boolean,
  aStroke: STROKE_PARAMS,
  aFillMode: FILL_T,
  aFillColor: Color4d,
  aInvertY: boolean,
  aUuid: KIID = niluuid,
): void {
  aFormatter.Print(`(polyline ${aIsPrivate ? 'private' : ''} (pts `);

  const aPolySet = aPolyLine.GetPolyShape();

  if (aPolySet.OutlineCount() !== 0) {
    for (const pt of aPolySet.Outline(0).CPoints())
      aFormatter.Print(`(xy ${formatIU(pt, aInvertY)})`);
  }
  // else wxFAIL_MSG( "Polyline has no outlines" )

  aFormatter.Print(')'); // Closes pts token

  aStroke.Format(aFormatter, schIUScale);
  formatFill(aFormatter, aFillMode, aFillColor);
  formatShapeUuid(aFormatter, aUuid);

  aFormatter.Print(')');
}
