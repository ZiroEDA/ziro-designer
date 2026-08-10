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
 * everything leaving is a board-model record in internal units. The whole
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
 * Not represented here: the fill *colour* every `Add…` receives. The board file
 * has no per-graphic colour, so it is dropped rather than approximated — see
 * the port notes.
 */

import { ARC_HIGH_DEF } from './graphics_cleaner.js';
import {
  GRAPHICS_IMPORTER,
  type IMPORTED_STROKE,
  COLOR4D_UNSPECIFIED,
  setupSplineOrLine,
} from '@ziroeda/common/src/import_gfx/graphics_importer.js';
import { LINE_STYLE } from '@ziroeda/common/src/stroke_params.js';
import type { PCB_LAYER_ID } from './layer_ids.js';
import { joinJustify } from './textbox_properties.js';
import type { PcbShape, PcbTextItem, StrokeType } from './types.js';
import { pcbIUScale } from '@ziroeda/common/src/eda_units.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/src/eda_text.js';
import { BezierPoly } from '@ziroeda/kimath/src/bezier_curves.js';
import { segApproxCollinear } from '@ziroeda/kimath/src/geometry/seg.js';
import type { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import { EuclideanNormI, type Vec2, type VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePointD } from '@ziroeda/kimath/src/trigo.js';
import type { Color4d } from './plot_dxf.js';

/**
 * `LINE_STYLE` as the **board** file spells it.
 *
 * Stayed behind when the importer moved to `common`: the enum is shared, but the
 * spelling of a stroke is per-format, and `StrokeType` is a pcbnew type. A
 * schematic sink needs the same mapping against eeschema's own stroke type.
 */
export function lineStyleToStrokeType(aStyle: LINE_STYLE): StrokeType {
  switch (aStyle) {
    case LINE_STYLE.DEFAULT:
      return 'default';
    case LINE_STYLE.SOLID:
      return 'solid';
    case LINE_STYLE.DASH:
      return 'dash';
    case LINE_STYLE.DOT:
      return 'dot';
    case LINE_STYLE.DASHDOT:
      return 'dash_dot';
    case LINE_STYLE.DASHDOTDOT:
      return 'dash_dot_dot';
  }
}

/**
 * What a board import produces: the board model's plain records, without a
 * `source` node — whoever commits them supplies that.
 *
 * Board-shaped, so it stayed here when the base moved to `common` and became
 * generic in its item type (`GRAPHICS_IMPORTER<TItem>`).
 */
export type IMPORTED_ITEM =
  | { type: 'shape'; shape: Omit<PcbShape, 'source'> }
  | { type: 'text'; text: Omit<PcbTextItem, 'source'> };

/** `Dwgs_User`, the layer an import lands on until the caller says otherwise. */
export const DEFAULT_IMPORT_LAYER: PCB_LAYER_ID = 'Dwgs.User';

/**
 * `STROKE_PARAMS` reduced to what a board graphic stores.
 *
 * KiCad's carries a colour as well; `PcbShape` has nowhere to put one.
 */
export interface STROKE_PARAMS {
  width: number;
  plotStyle: StrokeType;
}

/**
 * The layer a source-format layer maps to, or `null` for "do not import".
 *
 * KiCad has two sentinels here, `UNDEFINED_LAYER` and `UNSELECTED_LAYER`, and
 * every test in this file treats them identically — neither is importable and
 * both fall back to the default layer. They collapse to one `null`.
 */
export type LayerMapTarget = PCB_LAYER_ID | null;

export class GRAPHICS_IMPORTER_PCBNEW extends GRAPHICS_IMPORTER<IMPORTED_ITEM> {
  /** Target layer for the imported shapes. */
  protected m_layer: PCB_LAYER_ID = DEFAULT_IMPORT_LAYER;
  protected m_defaultLayer: PCB_LAYER_ID = DEFAULT_IMPORT_LAYER;
  protected m_useLayerMap = false;
  protected m_layerMap = new Map<string, LayerMapTarget>();

  constructor() {
    super();
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

  /** -1 is the parsers' "no stroke"; every other non-positive width is a default. */
  MapStrokeParams(aStroke: IMPORTED_STROKE): STROKE_PARAMS {
    const width = aStroke.GetWidth() === -1 ? 0 : this.MapLineWidth(aStroke.GetWidth());

    return { width, plotStyle: lineStyleToStrokeType(aStroke.GetPlotStyle()) };
  }

  /** A segment whose two ends land on the same internal-unit point is dropped. */
  AddLine(aStart: Vec2, aEnd: Vec2, aStroke: IMPORTED_STROKE): void {
    const stroke = this.MapStrokeParams(aStroke);
    const start = this.MapCoordinate(aStart);
    const end = this.MapCoordinate(aEnd);

    if (start.x === end.x && start.y === end.y) return;

    this.addItem({
      type: 'shape',
      shape: {
        kind: 'line',
        start,
        end,
        width: stroke.width,
        strokeType: stroke.plotStyle,
        fill: false,
        layer: this.GetLayer(),
      },
    });
  }

  /**
   * A circle is centre plus a point one radius away along +X — so the radius is
   * mapped as a *coordinate*, picking up the offset at both ends and the X
   * scale factor alone. (KiCad puts the centre in the shape's `start`; the
   * board model and the file both call it `center`.)
   */
  AddCircle(
    aCenter: Vec2,
    aRadius: number,
    aStroke: IMPORTED_STROKE,
    aFilled: boolean,
    // biome-ignore lint/correctness/noUnusedFunctionParameters: no colour on a board graphic
    aFillColor: Color4d = COLOR4D_UNSPECIFIED,
  ): void {
    const stroke = this.MapStrokeParams(aStroke);

    this.addItem({
      type: 'shape',
      shape: {
        kind: 'circle',
        center: this.MapCoordinate(aCenter),
        end: this.MapCoordinate({ x: aCenter.x + aRadius, y: aCenter.y }),
        width: stroke.width,
        strokeType: stroke.plotStyle,
        fill: aFilled,
        layer: this.GetLayer(),
      },
    });
  }

  /**
   * The rotation to the arc's mid and end points happens in floating point,
   * before the internal-unit grid, which is the whole reason this is not
   * expressed as a start/angle pair and rounded once.
   *
   * An arc whose radius reaches half the coordinate range cannot be stored, and
   * degrades to the chord rather than being dropped: upstream cannot test the
   * final coordinates because the arc may still be moved before it is placed.
   */
  /**
   * `AddEllipse`, which a board cannot yet hold.
   *
   * Upstream builds a `PCB_SHAPE` of `SHAPE_T::ELLIPSE`. Our board model has no
   * such shape — `PcbShape.kind` runs line, arc, circle, rect, poly, curve — so
   * there is nothing to map onto, and an ellipse flattened to a polygon here
   * would be an editing dead end rather than a shape. It is reported and
   * dropped, which is what the DXF plugin used to do one layer lower; the
   * schematic, whose model does have an ellipse, imports it properly.
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
    const end = RotatePointD(aStart, aCenter, aAngle.negate());
    const mid = RotatePointD(aStart, aCenter, aAngle.negate().divide(2.0));

    const center = this.MapCoordinate(aCenter);
    const mappedStart = this.MapCoordinate(aStart);
    const radius = EuclideanNormI({ x: center.x - mappedStart.x, y: center.y - mappedStart.y });
    const rd_max_value = 2147483647 / 2.0;

    if (radius >= rd_max_value) {
      this.AddLine(aStart, end, aStroke);
      return;
    }

    const stroke = this.MapStrokeParams(aStroke);

    this.addItem({
      type: 'shape',
      shape: {
        kind: 'arc',
        start: mappedStart,
        mid: this.MapCoordinate(mid),
        end: this.MapCoordinate(end),
        width: stroke.width,
        strokeType: stroke.plotStyle,
        fill: false,
        layer: this.GetLayer(),
      },
    });
  }

  /** `IsPolyShapeValid`: an outline of two points or fewer is not a polygon. */
  AddPolygon(
    aVertices: Vec2[],
    aStroke: IMPORTED_STROKE,
    aFilled: boolean,
    // biome-ignore lint/correctness/noUnusedFunctionParameters: no colour on a board graphic
    aFillColor: Color4d = COLOR4D_UNSPECIFIED,
  ): void {
    const convertedPoints = aVertices.map((p) => this.MapCoordinate(p));
    const stroke = this.MapStrokeParams(aStroke);

    if (convertedPoints.length <= 2) return;

    this.addItem({
      type: 'shape',
      shape: {
        kind: 'poly',
        pts: convertedPoints,
        width: stroke.width,
        strokeType: stroke.plotStyle,
        fill: aFilled,
        layer: this.GetLayer(),
      },
    });
  }

  /**
   * Text size is scaled per axis and *truncated*, being an `int` setter fed a
   * double; the position goes through `MapCoordinate` and so is rounded. The
   * two disagree by design.
   */
  AddText(
    aOrigin: Vec2,
    aText: string,
    aHeight: number,
    aWidth: number,
    aThickness: number,
    aOrientation: number,
    aHJustify: GR_TEXT_H_ALIGN_T,
    aVJustify: GR_TEXT_V_ALIGN_T,
    // biome-ignore lint/correctness/noUnusedFunctionParameters: no colour on board text
    aColor: Color4d = COLOR4D_UNSPECIFIED,
  ): void {
    const factor = this.ImportScalingFactor();

    this.addItem({
      type: 'text',
      text: {
        kind: 'user',
        text: aText,
        at: this.MapCoordinate(aOrigin),
        angle: aOrientation,
        layer: this.GetLayer(),
        size: { x: Math.trunc(aWidth * factor.x), y: Math.trunc(aHeight * factor.y) },
        thickness: this.MapLineWidth(aThickness),
        justify: joinJustify(
          aHJustify === GR_TEXT_H_ALIGN_T.LEFT
            ? 'left'
            : aHJustify === GR_TEXT_H_ALIGN_T.RIGHT
              ? 'right'
              : 'center',
          aVJustify === GR_TEXT_V_ALIGN_T.TOP
            ? 'top'
            : aVJustify === GR_TEXT_V_ALIGN_T.BOTTOM
              ? 'bottom'
              : 'center',
          false,
        ),
      },
    });
  }

  /**
   * A cubic, unless `setupSplineOrLine` says it is really a segment — in which
   * case the control points are thrown away and only the endpoints survive.
   *
   * A `curve` carries its four control points and nothing else, which is what
   * the writer emits and therefore all a re-read board would have.
   */
  AddSpline(
    aStart: Vec2,
    aBezierControl1: Vec2,
    aBezierControl2: Vec2,
    aEnd: Vec2,
    aStroke: IMPORTED_STROKE,
  ): void {
    const stroke = this.MapStrokeParams(aStroke);
    const start = this.MapCoordinate(aStart);
    const c1 = this.MapCoordinate(aBezierControl1);
    const c2 = this.MapCoordinate(aBezierControl2);
    const end = this.MapCoordinate(aEnd);

    const kind = setupSplineOrLine(start, c1, c2, end, ARC_HIGH_DEF);

    if (kind === null) return;

    this.addItem({
      type: 'shape',
      shape:
        kind === 'curve'
          ? {
              kind: 'curve',
              pts: [start, c1, c2, end],
              width: stroke.width,
              strokeType: stroke.plotStyle,
              fill: false,
              layer: this.GetLayer(),
            }
          : {
              kind: 'line',
              start,
              end,
              width: stroke.width,
              strokeType: stroke.plotStyle,
              fill: false,
              layer: this.GetLayer(),
            },
    });
  }
}
