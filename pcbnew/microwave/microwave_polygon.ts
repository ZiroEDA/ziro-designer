// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/microwave/microwave_polygon.cpp`: `MWAVE_POLYGONAL_SHAPE_DLG`'s
 * shape-description-file reader and `MICROWAVE_TOOL::createPolygonShape`.
 *
 * The dialog is inside this .cpp upstream, so its logic is here
 * ({@link MWAVE_POLYGONAL_SHAPE_DLG}) and its layout is `microwave_polygon_ui.tsx`.
 * It only edits the values the C++ keeps in file-scope statics (`g_PolyShapeType`,
 * `g_ShapeSize`, the two scale factors, the point list); the statics live here,
 * as they do upstream, and `createPolygonShape` reads them after the dialog
 * returns.
 *
 * One upstream quirk is kept: the dialog's Size X / Y fields are transferred
 * into `g_ShapeSize`, and `createPolygonShape` then overwrites `g_ShapeSize`
 * from the *scale* factors, so editing the fields changes nothing; only the file
 * (or the previous call's scale, since the statics persist) sets the size.
 */
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { STROKE_PARAMS, LINE_STYLE } from '@ziroeda/common/stroke_params.js';
import type { FOOTPRINT } from '../footprint.js';
import { PCB_SHAPE } from '../pcb_shape.js';
import { ADD_MODE } from '../board_item_container.js';
import { createBaseFootprint } from './microwave_footprint.js';
import type { MICROWAVE_HOST } from './microwave_tool.js';

/** `g_PolyShapeType`: the dialog's `wxRadioBox` selection. */
export enum MWAVE_POLY_SHAPE_TYPE {
  NORMAL = 0,
  SYMMETRICAL = 1,
  MIRRORED = 2,
}

/** The statics of microwave_polygon.cpp. */
export const g_PolyEdges: { x: number; y: number }[] = [];
export const g_MwaveShape = { scaleX: 0, scaleY: 0, type: MWAVE_POLY_SHAPE_TYPE.NORMAL as number };

/** `g_ShapeSize`: written by the dialog's TransferDataFromWindow, then overwritten. */
export const g_ShapeSize = { x: 0, y: 0 };

/**
 * `MWAVE_POLYGONAL_SHAPE_DLG` (microwave_polygon.cpp:60-243), the logic half.
 * The window is `microwave_polygon_ui.tsx`.
 */
export class MWAVE_POLYGONAL_SHAPE_DLG {
  /** The Size X and Y fields, in IU (`m_sizeX` / `m_sizeY`). */
  m_sizeX = 0;
  m_sizeY = 0;
  /** `m_shapeOptionCtrl->GetSelection()`. */
  m_shapeOptionCtrl: MWAVE_POLY_SHAPE_TYPE = MWAVE_POLY_SHAPE_TYPE.NORMAL;

  constructor() {
    g_PolyEdges.length = 0;
  }

  /** `OnCancelClick`. */
  OnCancelClick(): void {
    g_PolyEdges.length = 0;
  }

  /** `TransferDataFromWindow`. */
  TransferDataFromWindow(): boolean {
    g_ShapeSize.x = this.m_sizeX;
    g_ShapeSize.y = this.m_sizeY;
    g_MwaveShape.type = this.m_shapeOptionCtrl;

    return true;
  }

  /**
   * `ReadDataShapeDescr`, once the file is chosen and read: the two size
   * fields are set to `(int) g_ShapeScaleX` and `(int) g_ShapeScaleY`.
   */
  ReadDataShapeDescr(aFileText: string): void {
    const { scaleX, scaleY } = ReadDataShapeDescr(aFileText);

    this.m_sizeX = Math.trunc(scaleX);
    this.m_sizeY = Math.trunc(scaleY);
  }
}

/** Integer negation: `-x` of an `int` 0 is 0, where a JS `-0` is not `+0`. */
const iNeg = (v: number): number => 0 - v;

/** `strncasecmp( a, b, n ) == 0`. */
const startsWithNoCase = (a: string | undefined, b: string, n: number): boolean =>
  a !== undefined && a.slice(0, n).toLowerCase() === b.slice(0, n).toLowerCase();

/** `atof`: the longest numeric prefix, 0 when there is none. */
const atof = (s: string | undefined): number => {
  const m = /^\s*[-+]?(\d+\.?\d*([eE][-+]?\d+)?|\.\d+([eE][-+]?\d+)?)/.exec(s ?? '');
  return m ? Number(m[0]) : 0;
};

/** `strtok( line, delims )` then `strtok( nullptr, delims2 )`. */
function tok(
  line: string,
  delims1: string,
  delims2: string,
): [string | undefined, string | undefined] {
  const isDelim = (c: string, d: string): boolean => d.includes(c);
  let i = 0;

  while (i < line.length && isDelim(line[i]!, delims1)) i++;

  if (i >= line.length) return [undefined, undefined];

  let j = i;

  while (j < line.length && !isDelim(line[j]!, delims1)) j++;

  const p1 = line.slice(i, j);
  let k = j + 1; // strtok overwrote the delimiter with NUL

  while (k < line.length && isDelim(line[k]!, delims2)) k++;

  if (j >= line.length || k >= line.length) return [p1, undefined];

  let e = k;

  while (e < line.length && !isDelim(line[e]!, delims2)) e++;

  return [p1, line.slice(k, e)];
}

/**
 * `MWAVE_POLYGONAL_SHAPE_DLG::ReadDataShapeDescr`'s parser:
 *
 *     Unit=MM
 *     XScale=271.501
 *     YScale=1.00133
 *     $COORD
 *     0                      0.6112600148417837
 *     ...
 *     $ENDCOORD
 *
 * Each `$COORD` line is an X Y pair in normalised units. Sets `g_PolyEdges` and
 * the two scale factors (already multiplied by the unit), and returns them.
 * Lines FILTER_READER drops: empty ones and those starting with `#`.
 */
export function ReadDataShapeDescr(aText: string): { scaleX: number; scaleY: number } {
  g_PolyEdges.length = 0;

  let unitconv = pcbIUScale.IU_PER_MM;
  let scaleX = 1.0;
  let scaleY = 1.0;

  const lines = aText.split(/(?<=\n)/).filter((l) => l !== '' && !'#\n\r'.includes(l[0]!));
  let idx = 0;
  const next = (): string | undefined => lines[idx++];

  for (let raw = next(); raw !== undefined; raw = next()) {
    let Line = raw;
    let [param1, param2] = tok(Line, ' =\n\r', ' \t\n\r');

    if (startsWithNoCase(param1, 'Unit', 4)) {
      if (startsWithNoCase(param2, 'inch', 4)) unitconv = pcbIUScale.IU_PER_MILS * 1000;

      if (startsWithNoCase(param2, 'mm', 2)) unitconv = pcbIUScale.IU_PER_MM;
    }

    if (startsWithNoCase(param1, '$ENDCOORD', 8)) break;

    if (startsWithNoCase(param1, '$COORD', 6)) {
      for (let inner = next(); inner !== undefined; inner = next()) {
        Line = inner;
        [param1, param2] = tok(Line, ' \t\n\r', ' \t\n\r');

        if (startsWithNoCase(param1, '$ENDCOORD', 8)) break;

        g_PolyEdges.push({ x: atof(param1), y: atof(param2) });
      }
    }

    // `Line` was cut at its first delimiter by strtok, so only the keyword is left.
    const keyword = Line.split(/[ =\t\n\r]/, 1)[0]!;

    if (startsWithNoCase(keyword, 'XScale', 6)) scaleX = atof(param2);

    if (startsWithNoCase(keyword, 'YScale', 6)) scaleY = atof(param2);
  }

  scaleX *= unitconv;
  scaleY *= unitconv;

  g_MwaveShape.scaleX = scaleX;
  g_MwaveShape.scaleY = scaleY;

  return { scaleX, scaleY };
}

/** `MICROWAVE_TOOL::createPolygonShape`. */
export async function createPolygonShape(aHost: MICROWAVE_HOST): Promise<FOOTPRINT | null> {
  const ok = await aHost.PolygonShapeDialog();

  if (!ok) {
    g_PolyEdges.length = 0;
    return null;
  }

  if (g_MwaveShape.type === MWAVE_POLY_SHAPE_TYPE.MIRRORED)
    g_MwaveShape.scaleY = -g_MwaveShape.scaleY;

  const g_ShapeSize = { x: KiROUND(g_MwaveShape.scaleX), y: KiROUND(g_MwaveShape.scaleY) };

  if (g_ShapeSize.x === 0 || g_ShapeSize.y === 0) {
    aHost.ShowInfoBarError('Shape has a null size.');
    return null;
  }

  if (g_PolyEdges.length === 0) {
    aHost.ShowInfoBarError('Shape has no points.');
    return null;
  }

  const cmp_name = 'muwave_polygon';
  const pad_count = 2;

  // Create a footprint with 2 pads, orientation = 0, pos 0
  const footprint = createBaseFootprint(aHost, cmp_name, 0, pad_count);

  // We try to place the footprint anchor to the middle of the shape len
  const offset: VECTOR2I = { x: Math.trunc(-g_ShapeSize.x / 2), y: 0 };

  const pads = footprint.Pads();

  pads[0]!.SetX(offset.x);
  pads[1]!.SetX(offset.x + g_ShapeSize.x);

  // Add a polygonal edge (corners will be added later) on copper layer
  const shape = new PCB_SHAPE(footprint, SHAPE_T.POLY);
  shape.SetFilled(true);
  shape.SetLayer(PCB_LAYER_ID.F_Cu);

  footprint.Add(shape, ADD_MODE.INSERT);

  // Get the corner buffer of the polygonal edge
  const polyPoints: VECTOR2I[] = [];

  // Init start point coord:
  polyPoints.push({ x: offset.x, y: 0 });

  let last_coordinate: VECTOR2I = { x: 0, y: 0 };

  for (const pt of g_PolyEdges) {
    // Copy points
    last_coordinate = {
      x: KiROUND(pt.x * g_MwaveShape.scaleX) + offset.x,
      y: iNeg(KiROUND(pt.y * g_MwaveShape.scaleY)) + offset.y,
    };
    polyPoints.push(last_coordinate);
  }

  // finish the polygonal shape
  if (last_coordinate.y !== 0) polyPoints.push({ x: last_coordinate.x, y: 0 });

  switch (g_MwaveShape.type) {
    case MWAVE_POLY_SHAPE_TYPE.NORMAL: // shape from file
    case MWAVE_POLY_SHAPE_TYPE.MIRRORED: // shape from file, mirrored (the mirror is already done)
      break;

    case MWAVE_POLY_SHAPE_TYPE.SYMMETRICAL: // Symmetric shape: add the symmetric (mirrored) shape
      for (let ndx = polyPoints.length - 1; ndx >= 0; --ndx) {
        const pt = { ...polyPoints[ndx]! };
        pt.y = iNeg(pt.y); // mirror about X axis
        polyPoints.push(pt);
      }

      break;
  }

  shape.SetPolyPoints(polyPoints);

  // Set the polygon outline thickness to 0, only the polygonal shape is filled
  // without extra thickness.
  shape.SetStroke(new STROKE_PARAMS(0, LINE_STYLE.SOLID));
  g_PolyEdges.length = 0;

  aHost.OnModify();
  return footprint;
}
