// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * GRAPHICS_IMPORTER_PCBNEW, the half of graphics import that knows about
 * boards. Counterpart: pcbnew/import_gfx/graphics_importer_pcbnew.{h,cpp},
 * plus `GRAPHICS_IMPORTER::setupSplineOrLine` from
 * common/import_gfx/graphics_importer.cpp, which only this side calls.
 *
 * Everything arriving here is millimetres in the source drawing's frame, and
 * everything leaving is a board item - a `PCB_SHAPE` or a `PCB_TEXT` - in
 * internal units. The whole
 * conversion is `MapCoordinate`, and its order matters: scale, then *add the
 * offset*, then multiply by the mm-to-IU factor. The offset is therefore in
 * millimetres of the already-scaled drawing, not of the file — halve the import
 * scale and the same offset still lands the drawing in the same place.
 *
 * Widths take a different route. `MapLineWidth` averages the X and Y scale
 * factors, because a stroke has no direction to be scaled along, and truncates
 * rather than rounding — a C++ `int(double)` cast, kept as `Math.trunc`.
 *
 * The stroke width carries a three-way meaning that is easy to flatten and must
 * not be:
 *
 *   -1        no stroke at all; the shape is fill-only. Becomes width 0.
 *   <= 0      no width in the file; use the importer's default line width.
 *   > 0       a width in millimetres.
 *
 * Upstream's comment explains the first case: -1 was Eeschema's "no stroke"
 * and never Pcbnew's, but the parsers do not know which program they are
 * feeding, so Pcbnew has to translate it.
 *
 * The fill colour every `Add…` receives is ignored, as upstream ignores it; the
 * stroke keeps the parser's colour in its `STROKE_PARAMS`.
 */

import {
  GRAPHICS_IMPORTER,
  type IMPORTED_STROKE,
  COLOR4D_UNSPECIFIED,
  setupSplineOrLine,
} from '@ziroeda/common/import_gfx/graphics_importer.js';
import { STROKE_PARAMS } from '@ziroeda/common/stroke_params.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { ARC_HIGH_DEF, pcbIUScale } from '@ziroeda/common/eda_units.js';
import type { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/eda_text.js';
import { EDA_ANGLE, EDA_ANGLE_T } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import { EuclideanNormI, type Vec2, type VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePointD } from '@ziroeda/kimath/src/trigo.js';
import type { Color4d } from '@ziroeda/common/gal/color4d.js';
import type { BOARD_ITEM } from '../board_item.js';
import type { BOARD_ITEM_CONTAINER } from '../board_item_container.js';
import { PCB_SHAPE } from '../pcb_shape.js';
import { PCB_TEXT } from '../pcb_text.js';

/**
 * The layer a source-format layer maps to, or `null` for "do not import".
 *
 * KiCad has two sentinels here, `UNDEFINED_LAYER` and `UNSELECTED_LAYER`, and
 * every test in this file treats them identically — neither is importable and
 * both fall back to the default layer. They collapse to one `null`.
 */
export type LayerMapTarget = PCB_LAYER_ID | null;

/**
 * `GRAPHICS_IMPORTER_PCBNEW` (graphics_importer_pcbnew.cpp): every `Add…`
 * builds the board item KiCad builds — a `PCB_SHAPE` or a `PCB_TEXT` whose
 * parent is `m_parent` — and hands it to `addItem`.
 */
export class GRAPHICS_IMPORTER_PCBNEW extends GRAPHICS_IMPORTER<BOARD_ITEM> {
  /** Target layer for the imported shapes. */
  protected m_layer: PCB_LAYER_ID = PCB_LAYER_ID.Dwgs_User;
  protected m_defaultLayer: PCB_LAYER_ID = PCB_LAYER_ID.Dwgs_User;
  protected m_useLayerMap = false;
  protected m_layerMap = new Map<string, LayerMapTarget>();
  private m_parent: BOARD_ITEM_CONTAINER | null;

  constructor(aParent: BOARD_ITEM_CONTAINER | null) {
    super();
    this.m_parent = aParent;
    this.m_millimeterToIu = pcbIUScale.mmToIU(1.0);
  }

  /** Note that this also moves the *default*: the two are set together. */
  SetLayer(aLayer: PCB_LAYER_ID): void {
    this.m_layer = aLayer;
    this.m_defaultLayer = aLayer;
  }

  GetLayer(): PCB_LAYER_ID {
    return this.m_layer;
  }

  SetLayerMap(aLayerMap: Map<string, LayerMapTarget>): void {
    this.m_layerMap = new Map(aLayerMap);
    this.m_useLayerMap = true;
  }

  ClearLayerMap(): void {
    this.m_layerMap = new Map();
    this.m_useLayerMap = false;
  }

  /** With no layer map every source layer is importable, mapped or not. */
  override CanImportSourceLayer(aSourceLayer: string): boolean {
    if (!this.m_useLayerMap) return true;

    const it = this.m_layerMap.get(aSourceLayer);

    return it !== undefined && it !== null;
  }

  /**
   * The current layer is reset to the default *first*, so a source layer that
   * is absent from the map — or mapped to nothing — falls back rather than
   * inheriting whatever the previous shape used.
   */
  override SetCurrentSourceLayer(aSourceLayer: string): void {
    this.m_layer = this.m_defaultLayer;

    if (!this.m_useLayerMap) return;

    const it = this.m_layerMap.get(aSourceLayer);

    if (it !== undefined && it !== null) this.m_layer = it;
  }

  /** Source millimetres to board internal units: scale, offset, then units. */
  MapCoordinate(aCoordinate: Vec2): VECTOR2I {
    const scale = this.GetScale();
    const offset = this.GetImportOffsetMM();
    const factor = this.GetMillimeterToIuFactor();

    return {
      x: KiROUND((aCoordinate.x * scale.x + offset.x) * factor),
      y: KiROUND((aCoordinate.y * scale.y + offset.y) * factor),
    };
  }

  /** A width of zero or less means "the importer's default", in mm. */
  MapLineWidth(aLineWidth: number): number {
    const factor = this.ImportScalingFactor();
    const scale = (factor.x + factor.y) * 0.5;

    if (aLineWidth <= 0.0) return Math.trunc(this.GetLineWidthMM() * scale);

    // aLineWidth is in mm:
    return Math.trunc(aLineWidth * scale);
  }

  MapStrokeParams(aStroke: IMPORTED_STROKE): STROKE_PARAMS {
    // Historicaly -1 meant no-stroke in Eeschema, but this has never been the case for
    // PCBNew.  (The importer, which doesn't know which program it's creating content for,
    // also uses -1 for no-stroke.)
    const width = aStroke.GetWidth() === -1 ? 0 : this.MapLineWidth(aStroke.GetWidth());

    return new STROKE_PARAMS(width, aStroke.GetPlotStyle(), aStroke.GetColor());
  }

  AddLine(aStart: Vec2, aEnd: Vec2, aStroke: IMPORTED_STROKE): void {
    const line = new PCB_SHAPE(this.m_parent);
    line.SetShape(SHAPE_T.SEGMENT);
    line.SetLayer(this.GetLayer());
    line.SetStroke(this.MapStrokeParams(aStroke));
    line.SetStart(this.MapCoordinate(aStart));
    line.SetEnd(this.MapCoordinate(aEnd));

    // Skip 0 len lines:
    const start = line.GetStart();
    const end = line.GetEnd();

    if (start.x === end.x && start.y === end.y) return;

    this.addItem(line);
  }

  AddCircle(
    aCenter: Vec2,
    aRadius: number,
    aStroke: IMPORTED_STROKE,
    aFilled: boolean,
    // biome-ignore lint/correctness/noUnusedFunctionParameters: upstream ignores it too
    aFillColor: Color4d = COLOR4D_UNSPECIFIED,
  ): void {
    const circle = new PCB_SHAPE(this.m_parent);
    circle.SetShape(SHAPE_T.CIRCLE);
    circle.SetFilled(aFilled);
    circle.SetLayer(this.GetLayer());
    circle.SetStroke(this.MapStrokeParams(aStroke));
    circle.SetStart(this.MapCoordinate(aCenter));
    circle.SetEnd(this.MapCoordinate({ x: aCenter.x + aRadius, y: aCenter.y }));

    this.addItem(circle);
  }

  /**
   * `AddEllipse`, which GRAPHICS_IMPORTER_PCBNEW does not override in 10.0.6:
   * the base declares it, and a board has no ellipse to build. Reported and
   * dropped; the schematic, whose model does have one, imports it.
   */
  AddEllipse(
    aCenter: Vec2,
    aMajorRadius: number,
    aMinorRadius: number,
    aRotation: EDA_ANGLE,
    aStroke: IMPORTED_STROKE,
    aFilled: boolean,
    aFillColor: Color4d,
  ): void {
    this.ReportMsg('Ellipses are not supported on a board and were not imported.');
  }

  /** `AddEllipseArc`. Dropped for the same reason as {@link AddEllipse}. */
  AddEllipseArc(
    aCenter: Vec2,
    aMajorRadius: number,
    aMinorRadius: number,
    aRotation: EDA_ANGLE,
    aStartAngle: EDA_ANGLE,
    aEndAngle: EDA_ANGLE,
    aStroke: IMPORTED_STROKE,
  ): void {
    this.ReportMsg('Ellipses are not supported on a board and were not imported.');
  }

  AddArc(aCenter: Vec2, aStart: Vec2, aAngle: EDA_ANGLE, aStroke: IMPORTED_STROKE): void {
    /**
     * We need to perform the rotation/conversion here while still using floating point values
     * to avoid rounding errors when operating in integer space in pcbnew
     */
    const end = RotatePointD(aStart, aCenter, aAngle.negate());
    const mid = RotatePointD(aStart, aCenter, aAngle.negate().divide(2.0));

    // Ensure the arc can be handled by Pcbnew. Arcs with a too big radius cannot.
    // The criteria used here is radius < MAX_INT / 2.
    // this is not perfect, but we do not know the exact final position of the arc, so
    // we cannot test the coordinate values, because the arc can be moved before being placed.
    const center = this.MapCoordinate(aCenter);
    const mappedStart = this.MapCoordinate(aStart);
    const radius = EuclideanNormI({ x: center.x - mappedStart.x, y: center.y - mappedStart.y });
    const rd_max_value = 2147483647 / 2.0;

    if (radius >= rd_max_value) {
      // Arc cannot be handled: convert it to a segment
      this.AddLine(aStart, end, aStroke);
      return;
    }

    const arc = new PCB_SHAPE(this.m_parent);
    arc.SetShape(SHAPE_T.ARC);
    arc.SetLayer(this.GetLayer());
    arc.SetArcGeometry(mappedStart, this.MapCoordinate(mid), this.MapCoordinate(end));
    arc.SetStroke(this.MapStrokeParams(aStroke));

    this.addItem(arc);
  }

  AddPolygon(
    aVertices: Vec2[],
    aStroke: IMPORTED_STROKE,
    aFilled: boolean,
    // biome-ignore lint/correctness/noUnusedFunctionParameters: upstream ignores it too
    aFillColor: Color4d = COLOR4D_UNSPECIFIED,
  ): void {
    const convertedPoints = aVertices.map((p) => this.MapCoordinate(p));

    const polygon = new PCB_SHAPE(this.m_parent);
    polygon.SetShape(SHAPE_T.POLY);
    polygon.SetFilled(aFilled);
    polygon.SetLayer(this.GetLayer());
    polygon.SetPolyPoints(convertedPoints);

    const parentFP = polygon.GetParentFootprint();

    if (parentFP) {
      polygon.Rotate({ x: 0, y: 0 }, parentFP.GetOrientation());
      polygon.Move(parentFP.GetPosition());
    }

    polygon.SetStroke(this.MapStrokeParams(aStroke));

    if (polygon.IsPolyShapeValid()) this.addItem(polygon);
  }

  AddText(
    aOrigin: Vec2,
    aText: string,
    aHeight: number,
    aWidth: number,
    aThickness: number,
    aOrientation: number,
    aHJustify: GR_TEXT_H_ALIGN_T,
    aVJustify: GR_TEXT_V_ALIGN_T,
    // biome-ignore lint/correctness/noUnusedFunctionParameters: upstream ignores it too
    aColor: Color4d = COLOR4D_UNSPECIFIED,
  ): void {
    const textItem = new PCB_TEXT(this.m_parent);
    textItem.SetLayer(this.GetLayer());
    textItem.SetTextThickness(this.MapLineWidth(aThickness));
    textItem.SetTextPos(this.MapCoordinate(aOrigin));
    textItem.SetTextAngle(new EDA_ANGLE(aOrientation, EDA_ANGLE_T.DEGREES_T));
    // SetTextWidth / SetTextHeight take an int: the double is truncated.
    textItem.SetTextWidth(Math.trunc(aWidth * this.ImportScalingFactor().x));
    textItem.SetTextHeight(Math.trunc(aHeight * this.ImportScalingFactor().y));
    textItem.SetVertJustify(aVJustify);
    textItem.SetHorizJustify(aHJustify);
    textItem.SetText(aText);

    this.addItem(textItem);
  }

  AddSpline(
    aStart: Vec2,
    aBezierControl1: Vec2,
    aBezierControl2: Vec2,
    aEnd: Vec2,
    aStroke: IMPORTED_STROKE,
  ): void {
    const spline = new PCB_SHAPE(this.m_parent);
    spline.SetLayer(this.GetLayer());
    spline.SetStroke(this.MapStrokeParams(aStroke));
    spline.SetStart(this.MapCoordinate(aStart));
    spline.SetBezierC1(this.MapCoordinate(aBezierControl1));
    spline.SetBezierC2(this.MapCoordinate(aBezierControl2));
    spline.SetEnd(this.MapCoordinate(aEnd));

    // `setupSplineOrLine( *spline, ARC_HIGH_DEF )`: BEZIER, or a SEGMENT when
    // it is degenerate, or nothing when that segment is too short to keep.
    const kind = setupSplineOrLine(
      spline.GetStart(),
      spline.GetBezierC1(),
      spline.GetBezierC2(),
      spline.GetEnd(),
      ARC_HIGH_DEF,
    );

    if (kind === null) return;

    if (kind === 'curve') {
      spline.SetShape(SHAPE_T.BEZIER);
      spline.RebuildBezierToSegmentsPointsList(ARC_HIGH_DEF);
    } else {
      spline.SetShape(SHAPE_T.SEGMENT);
    }

    this.addItem(spline);
  }
}
