// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/microwave/microwave_footprint.cpp`: `MICROWAVE_TOOL::createFootprint`
 * (the Gap, Stub and Arc Stub footprints) and `createBaseFootprint`. C++ methods
 * of MICROWAVE_TOOL split across four .cpp files; here each is a function over
 * the tool's {@link MICROWAVE_HOST}, which `MICROWAVE_TOOL` calls.
 */
import { EDA_ANGLE, ANGLE_0, ANGLE_180 } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import { FP_EXCLUDE_FROM_BOM, FP_EXCLUDE_FROM_POS_FILES, type FOOTPRINT } from '../footprint.js';
import { PAD } from '../pad.js';
import { PAD_ATTRIB, PAD_SHAPE, PADSTACK } from '../padstack.js';
import { ADD_MODE } from '../board_item_container.js';
import { MICROWAVE_FOOTPRINT_SHAPE } from '../tools/pcb_actions.js';
import type { MICROWAVE_HOST } from './microwave_tool.js';

/** `MICROWAVE_TOOL::createFootprint`. Null when the user cancels or aborts. */
export async function createFootprint(
  aHost: MICROWAVE_HOST,
  aFootprintShape: MICROWAVE_FOOTPRINT_SHAPE,
): Promise<FOOTPRINT | null> {
  let msg: string;
  let cmp_name = '';
  let pad_count = 2;
  let angle: EDA_ANGLE = ANGLE_0;

  // Ref and value text size (O = use board default value.
  // will be set to a value depending on the footprint size, if possible
  let text_size = 0;

  // Enter the size of the gap or stub
  let gap_size = aHost.GetCurrentTrackWidth();

  switch (aFootprintShape) {
    case MICROWAVE_FOOTPRINT_SHAPE.GAP:
      msg = 'Gap Size:';
      cmp_name = 'muwave_gap';
      text_size = gap_size;
      break;

    case MICROWAVE_FOOTPRINT_SHAPE.STUB:
      msg = 'Stub Size:';
      cmp_name = 'muwave_stub';
      text_size = gap_size;
      pad_count = 2;
      break;

    case MICROWAVE_FOOTPRINT_SHAPE.STUB_ARC:
      msg = 'Arc Stub Radius Value:';
      cmp_name = 'muwave_arcstub';
      pad_count = 1;
      break;

    default:
      msg = '???';
      break;
  }

  const size = await aHost.TextEntry(
    msg,
    'Create Microwave Footprint',
    aHost.StringFromValue(gap_size),
  );

  if (size === null) return null; // canceled by user

  gap_size = aHost.ValueFromString(size);

  let abort = false;

  if (aFootprintShape === MICROWAVE_FOOTPRINT_SHAPE.STUB_ARC) {
    const text = await aHost.TextEntry('Angle in degrees:', 'Create Microwave Footprint', '0.0');

    if (text === null) return null; // canceled by user

    // wxString::ToDouble: the whole string must be a number.
    const fval = /^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$/.test(text)
      ? Number(text)
      : Number.NaN;

    if (Number.isNaN(fval)) {
      aHost.DisplayError('Incorrect number, abort');
      abort = true;
    }

    // `EDA_ANGLE( fval, DEGREES_T )` with fval left at 0 after a failed
    // ToDouble; the abort below discards it either way.
    angle = new EDA_ANGLE(Number.isNaN(fval) ? 0 : fval);

    if (angle.lt(ANGLE_0)) angle = angle.negate();

    if (angle.gt(ANGLE_180)) angle = ANGLE_180;
  }

  if (abort) return null;

  const footprint = createBaseFootprint(aHost, cmp_name, text_size, pad_count);
  const pads = footprint.Pads();
  let pad = pads[0]!;

  switch (aFootprintShape) {
    case MICROWAVE_FOOTPRINT_SHAPE.GAP: {
      //Gap :
      const offsetX = Math.trunc(-(gap_size + pad.GetSize(PADSTACK.ALL_LAYERS).x) / 2);

      pad.SetX(pad.GetPosition().x + offsetX);

      pad = pads[1]!;

      pad.SetX(pad.GetPosition().x + offsetX + gap_size + pad.GetSize(PADSTACK.ALL_LAYERS).x);
      break;
    }

    case MICROWAVE_FOOTPRINT_SHAPE.STUB: {
      //Stub :
      pad.SetNumber('1');
      const offsetY = Math.trunc(-(gap_size + pad.GetSize(PADSTACK.ALL_LAYERS).y) / 2);

      pad = pads[1]!;
      pad.SetSize(PADSTACK.ALL_LAYERS, { x: pad.GetSize(PADSTACK.ALL_LAYERS).x, y: gap_size });
      pad.SetY(pad.GetPosition().y + offsetY);
      break;
    }

    case MICROWAVE_FOOTPRINT_SHAPE.STUB_ARC: {
      // Arc Stub created by a polygonal approach:
      pad.SetShape(PADSTACK.ALL_LAYERS, PAD_SHAPE.CUSTOM);
      pad.SetAnchorPadShape(PADSTACK.ALL_LAYERS, PAD_SHAPE.RECTANGLE);

      // `int numPoints = ( angle.AsDegrees() / 5.0 ) + 3;` truncates.
      const numPoints = Math.trunc(angle.AsDegrees() / 5.0 + 3);
      const polyPoints: VECTOR2I[] = [];

      polyPoints.push({ x: 0, y: 0 });

      let theta = angle.negate().divide(2);

      for (let ii = 1; ii < numPoints - 1; ii++) {
        polyPoints.push(RotatePoint({ x: 0, y: -gap_size }, theta));

        theta = theta.add(new EDA_ANGLE(5.0));

        if (theta.gt(angle.divide(2))) theta = angle.divide(2);
      }

      // Close the polygon:
      polyPoints.push({ ...polyPoints[0]! });

      pad.AddPrimitivePoly(PADSTACK.ALL_LAYERS, polyPoints, 0, true); // add a polygonal basic shape
      break;
    }

    default:
      break;
  }

  // Update the footprint and board
  aHost.OnModify();

  return footprint;
}

/** `MICROWAVE_TOOL::createBaseFootprint`. */
export function createBaseFootprint(
  aHost: MICROWAVE_HOST,
  aValue: string,
  aTextSize: number,
  aPadCount: number,
): FOOTPRINT {
  const footprint = aHost.CreateNewFootprint(aValue, '');

  footprint.SetAttributes(FP_EXCLUDE_FROM_POS_FILES | FP_EXCLUDE_FROM_BOM);

  if (aTextSize > 0) {
    footprint.Reference().SetTextSize({ x: aTextSize, y: aTextSize });
    footprint.Reference().SetTextThickness(Math.trunc(aTextSize / 5));
    footprint.Value().SetTextSize({ x: aTextSize, y: aTextSize });
    footprint.Value().SetTextThickness(Math.trunc(aTextSize / 5));
  }

  // Create 2 pads used in gaps and stubs.  The gap is between these 2 pads
  // the stub is the pad 2
  let pad_num = 1;

  while (aPadCount--) {
    const pad = new PAD(footprint);

    footprint.Add(pad, ADD_MODE.INSERT);

    const tw = aHost.GetCurrentTrackWidth();
    pad.SetSize(PADSTACK.ALL_LAYERS, { x: tw, y: tw });

    pad.SetPosition(footprint.GetPosition());
    pad.SetShape(PADSTACK.ALL_LAYERS, PAD_SHAPE.RECTANGLE);
    pad.SetAttribute(PAD_ATTRIB.SMD);
    pad.SetLayerSet(new LSET([PCB_LAYER_ID.F_Cu]));

    pad.SetNumber(String(pad_num));
    pad_num++;
  }

  return footprint;
}
