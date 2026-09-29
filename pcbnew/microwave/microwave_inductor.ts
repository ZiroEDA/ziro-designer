// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/microwave/microwave_inductor.cpp`: the S-shaped coil generator
 * (`gen_arc`, `BuildCornersList_S_Shape`), `MICROWAVE_TOOL::createInductorBetween`
 * and `createMicrowaveInductor`. Integer arithmetic is the C++'s: every `int`
 * division is `Math.trunc`, every `int x = <double>` a truncation, and the two
 * KiROUNDs are KiROUNDs.
 */
import { ANGLE_90, ANGLE_180, EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { GetArcToSegmentCount } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import { EuclideanNormI, type VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import { ARC_HIGH_DEF } from '@ziroeda/common/eda_units.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import { STROKE_PARAMS, LINE_STYLE } from '@ziroeda/common/stroke_params.js';
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { FOOTPRINT_NAME_VALIDATOR } from '@ziroeda/common/validators.js';
import { FP_EXCLUDE_FROM_BOM, FP_EXCLUDE_FROM_POS_FILES, type FOOTPRINT } from '../footprint.js';
import { PAD } from '../pad.js';
import { PAD_ATTRIB, PAD_SHAPE, PADSTACK } from '../padstack.js';
import { PCB_SHAPE } from '../pcb_shape.js';
import type { MICROWAVE_HOST, MICROWAVE_INDUCTOR_PATTERN } from './microwave_tool.js';

/**
 * `gen_arc`: an arc approximated by lines. Pushes the points after aStartPoint.
 * @param aBuffer where the points go
 * @param aStartPoint starting point of arc
 * @param aCenter arc centre
 * @param a_ArcAngle arc length
 */
export function gen_arc(
  aBuffer: VECTOR2I[],
  aStartPoint: VECTOR2I,
  aCenter: VECTOR2I,
  a_ArcAngle: EDA_ANGLE,
): void {
  const first_point = { x: aStartPoint.x - aCenter.x, y: aStartPoint.y - aCenter.y };
  const radius = Math.hypot(first_point.x, first_point.y);
  // `GetArcToSegmentCount( int aRadius, ... )`: the double truncates.
  const seg_count = GetArcToSegmentCount(Math.trunc(radius), ARC_HIGH_DEF, a_ArcAngle);

  const increment_angle = a_ArcAngle.AsRadians() / seg_count;

  // Creates nb_seg point to approximate arc by segments:
  for (let ii = 1; ii <= seg_count; ii++) {
    const rot_angle = increment_angle * ii;
    const fcos = Math.cos(rot_angle);
    const fsin = Math.sin(rot_angle);

    // Rotate current point:
    const currpt = {
      x: KiROUND(first_point.x * fcos + first_point.y * fsin),
      y: KiROUND(first_point.y * fcos - first_point.x * fsin),
    };

    aBuffer.push({ x: aCenter.x + currpt.x, y: aCenter.y + currpt.y });
  }
}

export enum INDUCTOR_S_SHAPE_RESULT {
  OK, /// S-shape constructed
  TOO_LONG, /// Requested length too long
  TOO_SHORT, /// Requested length too small
  NO_REPR, /// Requested length can't be represented
}

/**
 * `BuildCornersList_S_Shape`: create a path like a S-shaped coil.
 * @param aBuffer a buffer where to store points (ends of segments)
 * @param aStartPoint starting point of the path
 * @param aEndPoint ending point of the path
 * @param aLength full length of the path
 * @param aWidth segment width
 */
export function BuildCornersList_S_Shape(
  aBuffer: VECTOR2I[],
  aStartPoint: VECTOR2I,
  aEndPoint: VECTOR2I,
  aLength: number,
  aWidth: number,
): INDUCTOR_S_SHAPE_RESULT {
  // This scale factor adjusts the arc length to handle the arc to segment
  // approximation: a trace using segments is shorter than the corresponding arc.
  const ADJUST_SIZE = 0.988;

  let pt: VECTOR2I = { x: aEndPoint.x - aStartPoint.x, y: aEndPoint.y - aStartPoint.y };
  let angle = EDA_ANGLE.fromVector(pt);
  const min_len = EuclideanNormI(pt);
  let segm_len = 0; // length of segments
  let full_len: number; // full len of shape (sum of length of all segments + arcs)

  angle = angle.negate();

  /*
   * Note: calculations are made for a vertical coil (more easy calculations)
   * and after points are rotated to their actual position
   * So the main direction is the Y axis.
   * the 2 stubs are on the Y axis
   * the others segments are parallel to the X axis.
   */

  // Calculate the size of area (for a vertical shape)
  const size = { x: Math.trunc(min_len / 2), y: min_len };

  // Choose a reasonable starting value for the radius of the arcs.
  let radius = Math.min(aWidth * 5, Math.trunc(size.x / 4));

  let segm_count: number; // number of full len segments
  // the half size segments (first and last segment) are not counted here
  let stubs_len = 0; // length of first or last segment (half size of others segments)

  for (segm_count = 0; ; segm_count++) {
    stubs_len = Math.trunc((size.y - radius * 2 * (segm_count + 2)) / 2);

    if (stubs_len < Math.trunc(size.y / 10)) {
      // Reduce radius.
      stubs_len = Math.trunc(size.y / 10);
      radius = Math.trunc((size.y - 2 * stubs_len) / (2 * (segm_count + 2)));

      if (radius < aWidth) {
        // Radius too small.
        // Unable to create line: Requested length value is too large for room
        return INDUCTOR_S_SHAPE_RESULT.TOO_LONG;
      }
    }

    segm_len = size.x - radius * 2;
    full_len = 2 * stubs_len; // Length of coil connections.
    full_len += segm_len * segm_count; // Length of full length segments.
    full_len += KiROUND((segm_count + 2) * Math.PI * ADJUST_SIZE * radius); // Ard arcs len
    full_len += segm_len - 2 * radius; // Length of first and last segments
    // (half size segments len = segm_len/2 - radius).

    if (full_len >= aLength) break;
  }

  // Adjust len by adjusting segm_len:
  const delta_size = full_len - aLength;

  // reduce len of the segm_count segments + 2 half size segments (= 1 full size segment)
  segm_len -= Math.trunc(delta_size / (segm_count + 1));

  // at this point, it could still be that the requested length is too
  // short (because 4 quarter-circles are too long)
  // to fix this is a relatively complex numerical problem which probably
  // needs a refactor in this area. For now, just reject these cases:
  {
    const min_total_length = Math.trunc(2 * stubs_len + 2 * Math.PI * ADJUST_SIZE * radius);

    if (min_total_length > aLength) {
      // we can't express this inductor with 90-deg arcs of this radius
      return INDUCTOR_S_SHAPE_RESULT.TOO_SHORT;
    }
  }

  if (segm_len - 2 * radius < 0) {
    // we can't represent this exact requested length with this number
    // of segments (using the current algorithm). This stems from when
    // you add a segment, you also add another half-circle, so there's a
    // little bit of "dead" space.
    return INDUCTOR_S_SHAPE_RESULT.NO_REPR;
  }

  // Generate first line (the first stub) and first arc (90 deg arc)
  pt = { ...aStartPoint };
  aBuffer.push({ ...pt });
  pt.y += stubs_len;
  aBuffer.push({ ...pt });

  let centre = { ...pt };
  centre.x -= radius;
  gen_arc(aBuffer, pt, centre, ANGLE_90.negate());
  pt = { ...aBuffer[aBuffer.length - 1]! };

  const half_size_seg_len = Math.trunc(segm_len / 2) - radius;

  if (half_size_seg_len) {
    pt.x -= half_size_seg_len;
    aBuffer.push({ ...pt });
  }

  // Create shape.
  let sign = 1;
  segm_count += 1; // increase segm_count to create the last half_size segment

  for (let ii = 0; ii < segm_count; ii++) {
    if (ii & 1) {
      // odd order arcs are greater than 0
      sign = -1;
    } else {
      sign = 1;
    }

    centre = { ...pt };
    centre.y += radius;
    gen_arc(aBuffer, pt, centre, ANGLE_180.multiply(sign));
    pt = { ...aBuffer[aBuffer.length - 1]! };
    pt.x += segm_len * sign;
    aBuffer.push({ ...pt });
  }

  // The last point is false:
  // it is the end of a full size segment, but must be
  // the end of the second half_size segment. Change it.
  sign *= -1;
  aBuffer[aBuffer.length - 1]!.x = aStartPoint.x + radius * sign;

  // create last arc
  pt = { ...aBuffer[aBuffer.length - 1]! };
  centre = { ...pt };
  centre.y += radius;
  gen_arc(aBuffer, pt, centre, ANGLE_90.multiply(sign));

  // Rotate point
  angle = angle.add(ANGLE_90);

  for (let jj = 0; jj < aBuffer.length; jj++)
    aBuffer[jj] = RotatePoint(aBuffer[jj]!, aStartPoint, angle);

  // push last point (end point)
  aBuffer.push({ ...aEndPoint });

  return INDUCTOR_S_SHAPE_RESULT.OK;
}

/**
 * `MICROWAVE_TOOL::createInductorBetween`: the footprint, or null (with the
 * error shown when there is one). The C++ then selects it and commits it as
 * "Add Microwave Inductor"; that half is the host's `AddInductor`.
 */
export async function createInductorBetween(
  aHost: MICROWAVE_HOST,
  aStart: VECTOR2I,
  aEnd: VECTOR2I,
): Promise<void> {
  const pattern: MICROWAVE_INDUCTOR_PATTERN = {
    m_Width: aHost.GetCurrentTrackWidth(),
    m_Start: { x: aStart.x, y: aStart.y },
    m_End: { x: aEnd.x, y: aEnd.y },
    m_Length: 0,
  };

  const result = await createMicrowaveInductor(aHost, pattern);

  // on any error, report if we can
  if (!result.footprint || result.errorMessage !== '') {
    if (result.errorMessage !== '') aHost.ShowInfoBarError(result.errorMessage);
  } else {
    // at this point, we can save the footprint
    aHost.AddInductor(result.footprint);
  }
}

/** `MICROWAVE_TOOL::createMicrowaveInductor`; `aErrorMessage` is `errorMessage`. */
export async function createMicrowaveInductor(
  aHost: MICROWAVE_HOST,
  aInductorPattern: MICROWAVE_INDUCTOR_PATTERN,
): Promise<{ footprint: FOOTPRINT | null; errorMessage: string }> {
  const pt = {
    x: aInductorPattern.m_End.x - aInductorPattern.m_Start.x,
    y: aInductorPattern.m_End.y - aInductorPattern.m_Start.y,
  };
  const min_len = EuclideanNormI(pt);
  aInductorPattern.m_Length = min_len;

  // Enter the desired length.
  const length = await aHost.TextEntry(
    'Length of track:',
    'Create Microwave Footprint',
    aHost.StringFromValue(aInductorPattern.m_Length),
  );

  if (length === null) return { footprint: null, errorMessage: '' }; // canceled by user

  aInductorPattern.m_Length = aHost.ValueFromString(length);

  // Control values (ii = minimum length)
  if (aInductorPattern.m_Length < min_len)
    return { footprint: null, errorMessage: 'Requested length < minimum length' };

  // Calculate the elements.
  const buffer: VECTOR2I[] = [];
  const res = BuildCornersList_S_Shape(
    buffer,
    aInductorPattern.m_Start,
    aInductorPattern.m_End,
    aInductorPattern.m_Length,
    aInductorPattern.m_Width,
  );

  switch (res) {
    case INDUCTOR_S_SHAPE_RESULT.TOO_LONG:
      return { footprint: null, errorMessage: 'Requested length too large' };
    case INDUCTOR_S_SHAPE_RESULT.TOO_SHORT:
      return { footprint: null, errorMessage: 'Requested length too small' };
    case INDUCTOR_S_SHAPE_RESULT.NO_REPR:
      return { footprint: null, errorMessage: "Requested length can't be represented" };
    case INDUCTOR_S_SHAPE_RESULT.OK:
      break;
  }

  // Generate footprint. the value is also used as footprint name.
  const msg = await aHost.TextEntry(
    'Component value:',
    'Create Microwave Footprint',
    'L',
    new FOOTPRINT_NAME_VALIDATOR(),
  );

  if (msg === null || msg === '') return { footprint: null, errorMessage: '' }; //  Aborted by user

  const footprint = aHost.CreateNewFootprint(msg, '');

  footprint.SetFPID(new LIB_ID('', 'mw_inductor'));
  footprint.SetAttributes(FP_EXCLUDE_FROM_POS_FILES | FP_EXCLUDE_FROM_BOM);
  footprint.ClearFlags();
  footprint.SetPosition(aInductorPattern.m_End);

  // Generate segments
  for (let jj = 1; jj < buffer.length; jj++) {
    const seg = new PCB_SHAPE(footprint, SHAPE_T.SEGMENT);
    seg.SetStart(buffer[jj - 1]!);
    seg.SetEnd(buffer[jj]!);
    seg.SetStroke(new STROKE_PARAMS(aInductorPattern.m_Width, LINE_STYLE.SOLID));
    seg.SetLayer(footprint.GetLayer());
    footprint.Add(seg);
  }

  // Place a pad on each end of coil.
  let pad = new PAD(footprint);

  footprint.Add(pad);

  pad.SetNumber('1');
  pad.SetPosition(aInductorPattern.m_End);

  pad.SetSize(PADSTACK.ALL_LAYERS, { x: aInductorPattern.m_Width, y: aInductorPattern.m_Width });

  pad.SetLayerSet(new LSET([footprint.GetLayer()]));
  pad.SetAttribute(PAD_ATTRIB.SMD);
  pad.SetShape(PADSTACK.ALL_LAYERS, PAD_SHAPE.CIRCLE);

  const newpad = PAD.copyOfPad(pad);
  newpad.ResetUuidDirect();

  footprint.Add(newpad);

  pad = newpad;
  pad.SetNumber('2');
  pad.SetPosition(aInductorPattern.m_Start);

  // Modify text positions.
  const refPos = {
    x: Math.trunc((aInductorPattern.m_Start.x + aInductorPattern.m_End.x) / 2),
    y: Math.trunc((aInductorPattern.m_Start.y + aInductorPattern.m_End.y) / 2),
  };

  const valPos = { ...refPos };

  refPos.y -= footprint.Reference().GetTextSize().y;
  footprint.Reference().SetPosition(refPos);
  valPos.y += footprint.Value().GetTextSize().y;
  footprint.Value().SetPosition(valPos);

  return { footprint, errorMessage: '' };
}
