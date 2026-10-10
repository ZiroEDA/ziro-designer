// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/odbpp/odb_feature.{h,cpp}`: a layer's `features` file - FEATURES_MANAGER turns
 * board items into line / arc / pad / surface records, names the symbols they use (`r…`, `rect…`,
 * `oval…`, `donut_r…`) in first-use order, and writes them.
 *
 * `ODB_SURFACE`'s constructor does `delete this` on a polygon with fewer than three points, which
 * leaves a dangling feature upstream (undefined behaviour); here such a polygon adds no feature.
 */
import { CALLBACK_GAL } from '@ziroeda/common/callback_gal.js';
import { FILL_T, SHAPE_T } from '@ziroeda/common/eda_shape.js';
import type { METRICS } from '@ziroeda/common/font/font_metrics.js';
import type { FONT } from '@ziroeda/common/font/font.js';
import type { TEXT_ATTRIBUTES } from '@ziroeda/common/font/text_attributes.js';
import { GetPenSizeForBold } from '@ziroeda/common/gr_text.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import { LINE_STYLE, STROKE_PARAMS } from '@ziroeda/common/stroke_params.js';
import { wxStringSplit } from '@ziroeda/common/string_utils.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import {
  ERROR_LOC,
  RECT_CHAMFER_ALL,
  RECT_CHAMFER_BOTTOM_LEFT,
  RECT_CHAMFER_BOTTOM_RIGHT,
  RECT_CHAMFER_TOP_LEFT,
  RECT_CHAMFER_TOP_RIGHT,
} from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { ANGLE_0, ANGLE_360, type EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { SHAPE_CIRCLE } from '@ziroeda/kimath/src/geometry/shape_circle.js';
import type { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import {
  CornerStrategy,
  type POLYGON,
  SHAPE_POLY_SET,
} from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import type { SHAPE_SEGMENT } from '@ziroeda/kimath/src/geometry/shape_segment.js';
import { SHAPE_TYPE } from '@ziroeda/kimath/src/geometry/shape.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { BOARD } from '../../board.js';
import type { BOARD_ITEM } from '../../board_item.js';
import { PAD } from '../../pad.js';
import { PAD_ATTRIB, PAD_SHAPE, PADSTACK, PADSTACK_MODE } from '../../padstack.js';
import type { PCB_BARCODE } from '../../pcb_barcode.js';
import type { PCB_DIMENSION_BASE } from '../../pcb_dimension.js';
import { PCB_SHAPE } from '../../pcb_shape.js';
import type { PCB_TABLE } from '../../pcb_table.js';
import type { PCB_TEXT } from '../../pcb_text.js';
import type { PCB_TEXTBOX } from '../../pcb_textbox.js';
import type { PCB_ARC, PCB_TRACK, PCB_VIA } from '../../pcb_track.js';
import type { ZONE } from '../../zone.js';
import { ATTR_MANAGER, ATTR_RECORD_WRITER, DRILL, ODB_ATTR, PAD_USAGE } from './odb_attribute.js';
import { FEATURE_ID_TYPE, type ODB_SUBNET_MAPS } from './odb_eda_data.js';
import {
  AddXY,
  CHECK_ONCE,
  Double2String,
  GetShapePosition,
  ODB_DIM_C,
  ODB_DIM_R,
  ODB_DIM_X,
  ODB_SETTINGS,
  type OSTREAM,
  SymDouble2String,
} from './odb_util.js';

export enum ODB_DIRECTION {
  CW,
  CCW,
}

const same = (a: VECTOR2I, b: VECTOR2I): boolean => a.x === b.x && a.y === b.y;

export class FEATURES_MANAGER extends ATTR_MANAGER {
  private m_circleSymMap = new Map<string, number>(); // diameter -> symbol index
  private m_roundDonutSymMap = new Map<string, number>();
  private m_rectSymMap = new Map<string, number>(); // w,h -> symbol index
  private m_ovalSymMap = new Map<string, number>(); // w,h -> symbol index
  private m_roundRectSymMap = new Map<string, number>();
  private m_roundRectDonutSymMap = new Map<string, number>();
  private m_chamRectSymMap = new Map<string, number>();
  /** std::map<uint32_t, wxString>: written by index. */
  private m_allSymMap = new Map<number, string>();
  private m_symIndex = 0;
  readonly m_featuresList: ODB_FEATURE[] = [];

  constructor(
    private readonly m_board: BOARD,
    private readonly m_plugin: ODB_SUBNET_MAPS,
    private readonly m_layerName: string,
  ) {
    super();
  }

  private AddCircleSymbol(aDiameter: string): number {
    return this.GetSymbolIndex(this.m_circleSymMap, `r${aDiameter}`);
  }

  private AddRoundDonutSymbol(aOuterDim: string, aInnerDim: string): number {
    return this.GetSymbolIndex(
      this.m_roundDonutSymMap,
      `donut_r${aOuterDim}${ODB_DIM_X}${aInnerDim}`,
    );
  }

  private AddRectSymbol(aWidth: string, aHeight: string): number {
    return this.GetSymbolIndex(this.m_rectSymMap, `rect${aWidth}${ODB_DIM_X}${aHeight}`);
  }

  private AddOvalSymbol(aWidth: string, aHeight: string): number {
    return this.GetSymbolIndex(this.m_ovalSymMap, `oval${aWidth}${ODB_DIM_X}${aHeight}`);
  }

  private AddRoundRectSymbol(aWidth: string, aHeight: string, aRadius: string): number {
    return this.GetSymbolIndex(
      this.m_roundRectSymMap,
      `rect${aWidth}${ODB_DIM_X}${aHeight}${ODB_DIM_X}${ODB_DIM_R}${aRadius}`,
    );
  }

  private AddChamferRectSymbol(
    aWidth: string,
    aHeight: string,
    aRadius: string,
    aPositions: number,
  ): number {
    let sym = `rect${aWidth}${ODB_DIM_X}${aHeight}${ODB_DIM_X}${ODB_DIM_C}${aRadius}`;

    if (aPositions !== RECT_CHAMFER_ALL) {
      sym += ODB_DIM_X;

      if (aPositions & RECT_CHAMFER_TOP_RIGHT) sym += '1';

      if (aPositions & RECT_CHAMFER_TOP_LEFT) sym += '2';

      if (aPositions & RECT_CHAMFER_BOTTOM_LEFT) sym += '3';

      if (aPositions & RECT_CHAMFER_BOTTOM_RIGHT) sym += '4';
    }

    return this.GetSymbolIndex(this.m_chamRectSymMap, sym);
  }

  private GetSymbolIndex(aSymMap: Map<string, number>, aKey: string): number {
    const known = aSymMap.get(aKey);

    if (known !== undefined) return known;

    const index = this.m_symIndex;
    this.m_symIndex++;
    aSymMap.set(aKey, index);
    this.m_allSymMap.set(index, aKey);
    return index;
  }

  private AddFeature(aFeature: ODB_FEATURE | null): void {
    if (aFeature) this.m_featuresList.push(aFeature);
  }

  private last(): ODB_FEATURE {
    return this.m_featuresList[this.m_featuresList.length - 1]!;
  }

  private get nextIndex(): number {
    return this.m_featuresList.length;
  }

  AddFeatureLine(aStart: VECTOR2I, aEnd: VECTOR2I, aWidth: number): void {
    this.AddFeature(
      new ODB_LINE(
        this.nextIndex,
        AddXY(aStart),
        AddXY(aEnd),
        this.AddCircleSymbol(SymDouble2String(aWidth)),
      ),
    );
  }

  AddFeatureArc(
    aStart: VECTOR2I,
    aEnd: VECTOR2I,
    aCenter: VECTOR2I,
    aWidth: number,
    aDirection: ODB_DIRECTION,
  ): void {
    this.AddFeature(
      new ODB_ARC(
        this.nextIndex,
        AddXY(aStart),
        AddXY(aEnd),
        AddXY(aCenter),
        this.AddCircleSymbol(SymDouble2String(aWidth)),
        aDirection,
      ),
    );
  }

  AddPadCircle(
    aCenter: VECTOR2I,
    aDiameter: number,
    aAngle: EDA_ANGLE,
    aMirror: boolean,
    aResize = 1.0,
  ): void {
    this.AddFeature(
      new ODB_PAD(
        this.nextIndex,
        AddXY(aCenter),
        this.AddCircleSymbol(SymDouble2String(aDiameter)),
        aAngle,
        aMirror,
        aResize,
      ),
    );
  }

  AddContour(
    aPolySet: SHAPE_POLY_SET,
    aOutline = 0,
    aFillType: FILL_T = FILL_T.FILLED_SHAPE,
  ): boolean {
    // todo: args modify aPolySet.Polygon( aOutline ) instead of aPolySet

    if (aPolySet.OutlineCount() < aOutline + 1) return false;

    this.AddFeatureSurface(aPolySet.Polygon(aOutline), aFillType);

    return true;
  }

  AddShape(aShape: PCB_SHAPE, aLayer: PCB_LAYER_ID = PCB_LAYER_ID.UNDEFINED_LAYER): void {
    const stroke_width = aShape.GetWidth();

    switch (aShape.GetShape()) {
      case SHAPE_T.CIRCLE: {
        // GetRadius() can reach INT_MAX / 2 rounded up, which overflows a signed int when doubled
        const diameter = aShape.GetRadius() * 2;
        const center = GetShapePosition(aShape);

        // The stroke straddles the radius, so in diameter terms the whole width comes off the
        // inner edge and goes onto the outer
        const innerDiameter = diameter - stroke_width;
        const outerDim = SymDouble2String(diameter + stroke_width);

        // donut_r has no spelling for a hole closed by its own stroke
        if (aShape.IsSolidFill() || innerDiameter <= 0) {
          this.AddFeature(
            new ODB_PAD(this.nextIndex, AddXY(center), this.AddCircleSymbol(outerDim)),
          );
        } else {
          this.AddFeature(
            new ODB_PAD(
              this.nextIndex,
              AddXY(center),
              this.AddRoundDonutSymbol(outerDim, SymDouble2String(innerDiameter)),
            ),
          );
        }

        break;
      }

      case SHAPE_T.RECTANGLE: {
        // ODB++ donut_rc symbols degenerate when the corner radius is smaller than half the
        // line width, and some viewers drop the feature entirely.  Emit the rectangle as a
        // filled pad for the fill (if any) plus four line segments for the stroke, matching
        // how a rectangle drawn with the line tool is exported.
        if (aShape.IsSolidFill()) {
          const width = Math.abs(aShape.GetRectangleWidth());
          const height = Math.abs(aShape.GetRectangleHeight());
          const center = GetShapePosition(aShape);

          this.AddFeature(
            new ODB_PAD(
              this.nextIndex,
              AddXY(center),
              this.AddRectSymbol(SymDouble2String(width), SymDouble2String(height)),
            ),
          );
        }

        if (stroke_width > 0) {
          const corners = aShape.GetRectCorners();

          for (let ii = 0; ii < corners.length; ++ii)
            this.AddFeatureLine(corners[ii]!, corners[(ii + 1) % corners.length]!, stroke_width);
        }

        break;
      }

      case SHAPE_T.POLY: {
        let soldermask_min_thickness = 0;

        // TODO: check if soldermask_min_thickness should be Stroke width

        if (
          aLayer !== PCB_LAYER_ID.UNDEFINED_LAYER &&
          new LSET([PCB_LAYER_ID.F_Mask, PCB_LAYER_ID.B_Mask]).Contains(aLayer)
        )
          soldermask_min_thickness = stroke_width;

        const maxError = this.m_board.GetDesignSettings().m_MaxError;
        let poly_set = new SHAPE_POLY_SET();

        if (soldermask_min_thickness === 0) {
          poly_set = aShape.GetPolyShape().CloneDropTriangulation();
          poly_set.Fracture();
        } else {
          const initialPolys = new SHAPE_POLY_SET();

          // add shapes inflated by aMinThickness/2 in areas
          aShape.TransformShapeToPolygon(
            initialPolys,
            aLayer,
            0,
            maxError,
            ERROR_LOC.ERROR_OUTSIDE,
          );
          aShape.TransformShapeToPolygon(
            poly_set,
            aLayer,
            Math.trunc(soldermask_min_thickness / 2) - 1,
            maxError,
            ERROR_LOC.ERROR_OUTSIDE,
          );

          poly_set.Simplify();
          poly_set.Deflate(
            Math.trunc(soldermask_min_thickness / 2) - 1,
            CornerStrategy.CHAMFER_ALL_CORNERS,
            maxError,
          );
          poly_set.BooleanAdd(initialPolys);
          poly_set.Fracture();
        }

        const strokeOutline = (ii: number): void => {
          const outline = poly_set.COutline(ii);

          for (let jj = 0; jj < outline.SegmentCount(); ++jj) {
            const seg = outline.CSegment(jj);
            this.AddFeatureLine(seg.A, seg.B, stroke_width);
          }
        };

        // ODB++ surface features can only represent closed polygons.  We add a surface for
        // the fill of the shape, if present, and add line segments for the outline, if present.
        if (aShape.IsSolidFill()) {
          for (let ii = 0; ii < poly_set.OutlineCount(); ++ii) {
            this.AddContour(poly_set, ii, FILL_T.FILLED_SHAPE);

            if (stroke_width !== 0) strokeOutline(ii);
          }
        } else {
          for (let ii = 0; ii < poly_set.OutlineCount(); ++ii) strokeOutline(ii);
        }

        break;
      }

      case SHAPE_T.ARC: {
        const dir = !aShape.IsClockwiseArc() ? ODB_DIRECTION.CW : ODB_DIRECTION.CCW;

        this.AddFeatureArc(
          aShape.GetStart(),
          aShape.GetEnd(),
          aShape.GetCenter(),
          stroke_width,
          dir,
        );
        break;
      }

      case SHAPE_T.BEZIER: {
        const points = aShape.GetBezierPoints();

        for (let i = 0; i < points.length - 1; i++)
          this.AddFeatureLine(points[i]!, points[i + 1]!, stroke_width);

        break;
      }

      case SHAPE_T.SEGMENT:
        this.AddFeatureLine(aShape.GetStart(), aShape.GetEnd(), stroke_width);
        break;

      default:
        break;
    }

    if (aShape.IsHatchedFill()) {
      const hatching = aShape.GetHatching();

      for (let ii = 0; ii < hatching.OutlineCount(); ++ii)
        this.AddContour(hatching, ii, FILL_T.FILLED_SHAPE);
    }
  }

  AddFeatureSurface(aPolygon: POLYGON, aFillType: FILL_T = FILL_T.FILLED_SHAPE): void {
    this.AddFeature(ODB_SURFACE.Make(this.nextIndex, aPolygon, aFillType));
  }

  AddPadShape(aPad: PAD, aLayer: PCB_LAYER_ID): void {
    const fp = aPad.GetParentFootprint();
    let mirror = false;

    if (!aPad.GetOrientation().equals(ANGLE_0)) {
      if (fp?.IsFlipped()) mirror = true;
    }

    const maxError = this.m_board.GetDesignSettings().m_MaxError;

    let expansion = { x: 0, y: 0 };

    if (
      aLayer !== PCB_LAYER_ID.UNDEFINED_LAYER &&
      new LSET([PCB_LAYER_ID.F_Mask, PCB_LAYER_ID.B_Mask]).Contains(aLayer)
    ) {
      const m = aPad.GetSolderMaskExpansion(aLayer);
      expansion = { x: m, y: m };
    }

    if (
      aLayer !== PCB_LAYER_ID.UNDEFINED_LAYER &&
      new LSET([PCB_LAYER_ID.F_Paste, PCB_LAYER_ID.B_Paste]).Contains(aLayer)
    )
      expansion = { ...aPad.GetSolderPasteMargin(aLayer) };

    const mask_clearance = expansion.x;

    const size = aPad.GetSize(aLayer);
    const plotSize = { x: size.x + 2 * expansion.x, y: size.y + 2 * expansion.y };

    const center = aPad.ShapePos(aLayer);

    const width = SymDouble2String(Math.abs(plotSize.x));
    const height = SymDouble2String(Math.abs(plotSize.y));
    const orient = aPad.GetOrientation();

    switch (aPad.GetShape(aLayer)) {
      case PAD_SHAPE.CIRCLE: {
        const diam = SymDouble2String(plotSize.x);

        this.AddFeature(
          new ODB_PAD(this.nextIndex, AddXY(center), this.AddCircleSymbol(diam), orient, mirror),
        );
        break;
      }
      case PAD_SHAPE.RECTANGLE: {
        if (mask_clearance > 0) {
          const rad = SymDouble2String(mask_clearance);

          this.AddFeature(
            new ODB_PAD(
              this.nextIndex,
              AddXY(center),
              this.AddRoundRectSymbol(width, height, rad),
              orient,
              mirror,
            ),
          );
        } else {
          this.AddFeature(
            new ODB_PAD(
              this.nextIndex,
              AddXY(center),
              this.AddRectSymbol(width, height),
              orient,
              mirror,
            ),
          );
        }

        break;
      }
      case PAD_SHAPE.OVAL: {
        this.AddFeature(
          new ODB_PAD(
            this.nextIndex,
            AddXY(center),
            this.AddOvalSymbol(width, height),
            orient,
            mirror,
          ),
        );
        break;
      }
      case PAD_SHAPE.ROUNDRECT: {
        const rad = SymDouble2String(aPad.GetRoundRectCornerRadius(aLayer));

        this.AddFeature(
          new ODB_PAD(
            this.nextIndex,
            AddXY(center),
            this.AddRoundRectSymbol(width, height, rad),
            orient,
            mirror,
          ),
        );
        break;
      }
      case PAD_SHAPE.CHAMFERED_RECT: {
        const shorterSide = Math.min(plotSize.x, plotSize.y);
        const chamfer = Math.max(0, KiROUND(aPad.GetChamferRectRatio(aLayer) * shorterSide));
        const rad = SymDouble2String(chamfer);
        const positions = aPad.GetChamferPositions(aLayer);

        this.AddFeature(
          new ODB_PAD(
            this.nextIndex,
            AddXY(center),
            this.AddChamferRectSymbol(width, height, rad, positions),
            orient,
            mirror,
          ),
        );
        break;
      }
      case PAD_SHAPE.TRAPEZOID: {
        const outline = new SHAPE_POLY_SET();

        aPad.TransformShapeToPolygon(outline, aLayer, 0, maxError, ERROR_LOC.ERROR_INSIDE);

        // Shape polygon can have holes so use InflateWithLinkedHoles(), not Inflate()
        // which can create bad shapes if margin.x is < 0

        if (mask_clearance)
          outline.InflateWithLinkedHoles(expansion.x, CornerStrategy.ROUND_ALL_CORNERS, maxError);

        for (let ii = 0; ii < outline.OutlineCount(); ++ii) this.AddContour(outline, ii);

        break;
      }
      case PAD_SHAPE.CUSTOM: {
        const shape = new SHAPE_POLY_SET();
        aPad.MergePrimitivesAsPolygon(aLayer, shape);

        // as for custome shape, odb++ don't rotate the polygon,
        // so we rotate the polygon in kicad anticlockwise

        shape.Rotate(orient);
        shape.Move(center);

        if (expansion.x !== 0 || expansion.y !== 0) {
          shape.InflateWithLinkedHoles(
            Math.max(expansion.x, expansion.y),
            CornerStrategy.ROUND_ALL_CORNERS,
            maxError,
          );
        }

        for (let ii = 0; ii < shape.OutlineCount(); ++ii) this.AddContour(shape, ii);

        break;
      }
      default:
        break;
    }
  }

  InitFeatureList(aLayer: PCB_LAYER_ID, aItems: BOARD_ITEM[]): void {
    const featureId = (): number => this.m_featuresList.length - 1;

    const add_track = (track: PCB_TRACK): void => {
      const subnet = this.m_plugin.GetViaTraceSubnetMap().get(track);

      if (!subnet) return;

      if (track.Type() === KICAD_T.PCB_TRACE_T) {
        const shape = new PCB_SHAPE(null, SHAPE_T.SEGMENT);
        shape.SetStart(track.GetStart());
        shape.SetEnd(track.GetEnd());
        shape.SetWidth(track.GetWidth());

        this.AddShape(shape);
        subnet.AddFeatureID(FEATURE_ID_TYPE.COPPER, this.m_layerName, featureId());
      } else if (track.Type() === KICAD_T.PCB_ARC_T) {
        const arc = track as PCB_ARC;
        const shape = new PCB_SHAPE(null, SHAPE_T.ARC);
        shape.SetArcGeometry(arc.GetStart(), arc.GetMid(), arc.GetEnd());
        shape.SetWidth(arc.GetWidth());

        this.AddShape(shape);

        subnet.AddFeatureID(FEATURE_ID_TYPE.COPPER, this.m_layerName, featureId());
      } else {
        // add via
        const via = track as PCB_VIA;

        let hole: boolean;

        if (aLayer !== PCB_LAYER_ID.UNDEFINED_LAYER) {
          hole = this.m_layerName.includes('plugging');
        } else {
          hole =
            this.m_layerName.includes('drill') ||
            this.m_layerName.includes('filling') ||
            this.m_layerName.includes('capping');
        }

        if (hole) {
          this.AddViaDrillHole(via, aLayer);
          subnet.AddFeatureID(FEATURE_ID_TYPE.HOLE, this.m_layerName, featureId());

          // TODO: confirm TOOLING_HOLE
          // AddSystemAttribute( *m_featuresList.back(), ODB_ATTR::PAD_USAGE::TOOLING_HOLE );

          if (this.m_featuresList.length > 0) {
            this.AddSystemAttribute(this.last(), ODB_ATTR.DRILL(DRILL.VIA));
            this.AddSystemAttribute(
              this.last(),
              ODB_ATTR.GEOMETRY(`VIA_RoundD${via.GetWidth(aLayer)}`),
            );
          }
        } else {
          // to draw via copper shape on copper layer
          this.AddVia(via, aLayer);
          subnet.AddFeatureID(FEATURE_ID_TYPE.COPPER, this.m_layerName, featureId());

          if (this.m_featuresList.length > 0) {
            this.AddSystemAttribute(this.last(), ODB_ATTR.PAD_USAGE(PAD_USAGE.VIA));
            this.AddSystemAttribute(
              this.last(),
              ODB_ATTR.GEOMETRY(`VIA_RoundD${via.GetWidth(aLayer)}`),
            );
          }
        }
      }
    };

    const add_zone = (zone: ZONE): void => {
      const filled = zone.GetFilledPolysList(aLayer);
      const zone_shape = filled ? filled.CloneDropTriangulation() : new SHAPE_POLY_SET();

      for (let ii = 0; ii < zone_shape.OutlineCount(); ++ii) {
        this.AddContour(zone_shape, ii);

        const subnet = this.m_plugin.GetPlaneSubnetMap().get(zone)?.get(aLayer);

        if (!subnet) return;

        subnet.AddFeatureID(FEATURE_ID_TYPE.COPPER, this.m_layerName, featureId());

        if (zone.IsTeardropArea() && this.m_featuresList.length > 0)
          this.AddSystemAttribute(this.last(), ODB_ATTR.TEAR_DROP(true));
      }
    };

    const add_text = (item: BOARD_ITEM): void => {
      const type = item.Type();
      const isTextLike =
        type === KICAD_T.PCB_TEXT_T ||
        type === KICAD_T.PCB_FIELD_T ||
        type === KICAD_T.PCB_TEXTBOX_T ||
        type === KICAD_T.PCB_TABLECELL_T ||
        type === KICAD_T.PCB_DIM_ALIGNED_T ||
        type === KICAD_T.PCB_DIM_LEADER_T ||
        type === KICAD_T.PCB_DIM_CENTER_T ||
        type === KICAD_T.PCB_DIM_RADIAL_T ||
        type === KICAD_T.PCB_DIM_ORTHOGONAL_T;

      if (!isTextLike) return;

      const text_item = item as unknown as PCB_TEXT;

      if (!text_item.IsVisible() || text_item.GetShownText(false) === '') return;

      const plot_text = (
        aPos: VECTOR2I,
        aTextString: string,
        aAttributes: TEXT_ATTRIBUTES,
        aFont: FONT,
        aFontMetrics: METRICS,
      ): void => {
        const attributes = aAttributes.clone();
        let penWidth = attributes.m_StrokeWidth;

        if (penWidth === 0 && attributes.m_Bold)
          // Use default values if aPenWidth == 0
          penWidth = GetPenSizeForBold(Math.min(attributes.m_Size.x, attributes.m_Size.y));

        if (penWidth < 0) penWidth = -penWidth;

        attributes.m_StrokeWidth = penWidth;

        let pts: VECTOR2I[] = [];

        const push_pts = (): void => {
          if (pts.length < 2) return;

          // Polylines are only allowed for more than 3 points.
          // Otherwise, we have to use a line

          if (pts.length < 3) {
            const shape = new PCB_SHAPE(null, SHAPE_T.SEGMENT);
            shape.SetStart(pts[0]!);
            shape.SetEnd(pts[pts.length - 1]!);
            shape.SetWidth(attributes.m_StrokeWidth);

            this.AddShape(shape);
            this.AddSystemAttribute(this.last(), ODB_ATTR.STRING(aTextString));
          } else {
            for (let i = 0; i + 1 < pts.length; i++) {
              const shape = new PCB_SHAPE(null, SHAPE_T.SEGMENT);
              shape.SetStart(pts[i]!);
              shape.SetEnd(pts[i + 1]!);
              shape.SetWidth(attributes.m_StrokeWidth);
              this.AddShape(shape);

              if (this.m_featuresList.length > 0)
                this.AddSystemAttribute(this.last(), ODB_ATTR.STRING(aTextString));
            }
          }

          pts = [];
        };

        const callback_gal = new CALLBACK_GAL(
          // Stroke callback
          (aPt1: VECTOR2I, aPt2: VECTOR2I) => {
            if (pts.length > 0) {
              if (same(aPt1, pts[pts.length - 1]!)) pts.push(aPt2);
              else if (same(aPt2, pts[0]!)) pts.unshift(aPt1);
              else if (same(aPt1, pts[0]!)) pts.unshift(aPt2);
              else if (same(aPt2, pts[pts.length - 1]!)) pts.push(aPt1);
              else {
                push_pts();
                pts.push(aPt1, aPt2);
              }
            } else {
              pts.push(aPt1, aPt2);
            }
          },
          // Polygon callback
          (aPoly: SHAPE_LINE_CHAIN) => {
            if (aPoly.PointCount() < 3) return;

            const poly_set = new SHAPE_POLY_SET();
            poly_set.AddOutline(aPoly);

            for (let ii = 0; ii < poly_set.OutlineCount(); ++ii) {
              this.AddContour(poly_set, ii, FILL_T.FILLED_SHAPE);

              if (this.m_featuresList.length > 0)
                this.AddSystemAttribute(this.last(), ODB_ATTR.STRING(aTextString));
            }
          },
        );

        // Upstream hands the attributes it was given, not the pen-adjusted copy.
        aFont.Draw(callback_gal, aTextString, aPos, { x: 0, y: 0 }, aAttributes, aFontMetrics);

        if (pts.length > 0) push_pts();
      };

      let text: PCB_TEXT | null = null;
      let textbox: PCB_TEXTBOX | null = null;
      let isKnockout = false;

      if (type === KICAD_T.PCB_TEXT_T || type === KICAD_T.PCB_FIELD_T) {
        text = item as PCB_TEXT;
        isKnockout = text.IsKnockout();
      } else if (type === KICAD_T.PCB_TEXTBOX_T) {
        textbox = item as PCB_TEXTBOX;
        isKnockout = textbox.IsKnockout();
      }

      const fontMetrics = item.GetFontMetrics();
      const font = text_item.GetDrawFont(null);
      const shownText = text_item.GetShownText(true);

      if (shownText === '') return;

      const pos = text_item.GetTextPos();

      const attrs = text_item.GetAttributes().clone();
      attrs.m_StrokeWidth = text_item.GetEffectiveTextPenWidth();
      attrs.m_Angle = text_item.GetDrawRotation();
      attrs.m_Multiline = false;

      if (isKnockout) {
        const finalpolyset = new SHAPE_POLY_SET();
        const maxError = this.m_board.GetDesignSettings().m_MaxError;

        if (text) text.TransformTextToPolySet(finalpolyset, 0, maxError, ERROR_LOC.ERROR_INSIDE);
        else if (textbox)
          textbox.TransformTextToPolySet(finalpolyset, 0, maxError, ERROR_LOC.ERROR_INSIDE);

        finalpolyset.Fracture();

        for (let ii = 0; ii < finalpolyset.OutlineCount(); ++ii) {
          this.AddContour(finalpolyset, ii, FILL_T.FILLED_SHAPE);

          if (this.m_featuresList.length > 0)
            this.AddSystemAttribute(this.last(), ODB_ATTR.STRING(shownText));
        }
      } else if (text_item.IsMultilineAllowed()) {
        const positions: VECTOR2I[] = [];
        const strings_list = wxStringSplit(shownText, '\n');

        text_item.GetLinePositions(null, positions, strings_list.length);

        for (let ii = 0; ii < strings_list.length; ii++)
          plot_text(positions[ii]!, strings_list[ii]!, attrs, font, fontMetrics);
      } else {
        plot_text(pos, shownText, attrs, font, fontMetrics);
      }
    };

    const add_shape = (shape: PCB_SHAPE): void => {
      this.AddShape(shape, aLayer);
    };

    const add_dimension = (dimension: PCB_DIMENSION_BASE): void => {
      // A dimension is a PCB_TEXT subclass, so the value text is plotted via add_text.

      add_text(dimension);

      const temp_shape = new PCB_SHAPE();
      temp_shape.SetStroke(new STROKE_PARAMS(dimension.GetLineThickness(), LINE_STYLE.SOLID));
      temp_shape.SetLayer(dimension.GetLayer());

      for (const shape of dimension.GetShapes()) {
        switch (shape.Type()) {
          case SHAPE_TYPE.SH_SEGMENT: {
            const seg = (shape as SHAPE_SEGMENT).GetSeg();

            temp_shape.SetShape(SHAPE_T.SEGMENT);
            temp_shape.SetStart(seg.A);
            temp_shape.SetEnd(seg.B);

            add_shape(temp_shape);
            break;
          }

          case SHAPE_TYPE.SH_CIRCLE: {
            const center = shape.Centre();
            const radius = (shape as SHAPE_CIRCLE).GetRadius();

            temp_shape.SetShape(SHAPE_T.CIRCLE);
            temp_shape.SetFilled(false);
            temp_shape.SetStart(center);
            temp_shape.SetEnd({ x: center.x + radius, y: center.y });

            add_shape(temp_shape);
            break;
          }

          default:
            break;
        }
      }
    };

    const add_pad = (pad: PAD): void => {
      const subnet = this.m_plugin.GetPadSubnetMap().get(pad);

      if (!subnet) return;

      if (aLayer !== PCB_LAYER_ID.UNDEFINED_LAYER) {
        this.AddPadShape(pad, aLayer);

        subnet.AddFeatureID(FEATURE_ID_TYPE.COPPER, this.m_layerName, featureId());

        if (this.m_featuresList.length > 0)
          this.AddSystemAttribute(this.last(), ODB_ATTR.PAD_USAGE(PAD_USAGE.TOEPRINT));

        if (!pad.HasHole() && this.m_featuresList.length > 0)
          this.AddSystemAttribute(this.last(), ODB_ATTR.SMD(true));
      } else {
        // drill layer round hole or slot hole
        if (this.m_layerName.includes('drill')) {
          // here we exchange round hole or slot hole into pad to draw in drill layer
          const dummy = pad.Clone();
          dummy.Padstack().SetMode(PADSTACK_MODE.NORMAL);

          if (pad.GetDrillSizeX() === pad.GetDrillSizeY())
            dummy.SetShape(PADSTACK.ALL_LAYERS, PAD_SHAPE.CIRCLE); // round hole shape
          else dummy.SetShape(PADSTACK.ALL_LAYERS, PAD_SHAPE.OVAL); // slot hole shape

          dummy.SetOffset(PADSTACK.ALL_LAYERS, { x: 0, y: 0 }); // use hole position not pad position
          dummy.SetSize(PADSTACK.ALL_LAYERS, pad.GetDrillSize());

          this.AddPadShape(dummy, aLayer);

          if (pad.GetAttribute() === PAD_ATTRIB.PTH) {
            // only plated holes link to subnet
            subnet.AddFeatureID(FEATURE_ID_TYPE.HOLE, this.m_layerName, featureId());

            if (this.m_featuresList.length > 0)
              this.AddSystemAttribute(this.last(), ODB_ATTR.DRILL(DRILL.PLATED));
          } else {
            if (this.m_featuresList.length > 0)
              this.AddSystemAttribute(this.last(), ODB_ATTR.DRILL(DRILL.NON_PLATED));
          }
        }
      }
    };

    for (const item of aItems) {
      switch (item.Type()) {
        case KICAD_T.PCB_TRACE_T:
        case KICAD_T.PCB_ARC_T:
        case KICAD_T.PCB_VIA_T:
          add_track(item as PCB_TRACK);
          break;

        case KICAD_T.PCB_ZONE_T:
          add_zone(item as ZONE);
          break;

        case KICAD_T.PCB_PAD_T:
          add_pad(item as PAD);
          break;

        case KICAD_T.PCB_SHAPE_T:
          add_shape(item as PCB_SHAPE);
          break;

        case KICAD_T.PCB_TEXT_T:
        case KICAD_T.PCB_FIELD_T:
          add_text(item);
          break;

        case KICAD_T.PCB_TEXTBOX_T:
          add_text(item);

          if ((item as PCB_TEXTBOX).IsBorderEnabled()) add_shape(item as unknown as PCB_SHAPE);

          break;

        case KICAD_T.PCB_TABLE_T: {
          const table = item as PCB_TABLE;

          for (const cell of table.GetCells()) add_text(cell);

          table.DrawBorders((aPt1, aPt2, aStroke) => {
            const lineWidth = aStroke.GetWidth();

            if (lineWidth > 0) this.AddFeatureLine(aPt1, aPt2, lineWidth);
          });

          break;
        }

        case KICAD_T.PCB_DIM_ALIGNED_T:
        case KICAD_T.PCB_DIM_LEADER_T:
        case KICAD_T.PCB_DIM_CENTER_T:
        case KICAD_T.PCB_DIM_RADIAL_T:
        case KICAD_T.PCB_DIM_ORTHOGONAL_T:
          add_dimension(item as PCB_DIMENSION_BASE);
          break;

        case KICAD_T.PCB_TARGET_T:
          //TODO: Add support for targets
          break;

        case KICAD_T.PCB_BARCODE_T: {
          const barcode = item as PCB_BARCODE;
          const poly_set = new SHAPE_POLY_SET();

          barcode.TransformShapeToPolygon(
            poly_set,
            aLayer,
            0,
            this.m_board.GetDesignSettings().m_MaxError,
            ERROR_LOC.ERROR_INSIDE,
          );
          poly_set.Fracture();

          for (let ii = 0; ii < poly_set.OutlineCount(); ++ii)
            this.AddContour(poly_set, ii, FILL_T.FILLED_SHAPE);

          break;
        }

        default:
          break;
      }
    }
  }

  AddVia(aVia: PCB_VIA, aLayer: PCB_LAYER_ID): void {
    if (!aVia.FlashLayer(aLayer)) return;

    const dummy = new PAD(null); // default pad shape is circle
    dummy.SetPadstack(aVia.Padstack());
    dummy.SetPosition(aVia.GetStart());

    this.AddPadShape(dummy, aLayer);
  }

  AddViaDrillHole(aVia: PCB_VIA, aLayer: PCB_LAYER_ID): void {
    const dummy = new PAD(null); // default pad shape is circle
    const hole = aVia.GetDrillValue();
    dummy.SetPosition(aVia.GetStart());
    dummy.SetSize(PADSTACK.ALL_LAYERS, { x: hole, y: hole });

    this.AddPadShape(dummy, aLayer);
  }

  GenerateProfileFeatures(ost: OSTREAM): void {
    ost.write('UNITS=', ODB_SETTINGS.m_unitsStr, '\n');
    ost.write('#\n#Num Features\n#', '\n');
    ost.write('F ', this.m_featuresList.length, '\n');

    if (this.m_featuresList.length === 0) return;

    ost.write('#\n#Layer features\n#', '\n');

    for (const feat of this.m_featuresList) feat.WriteFeatures(ost);
  }

  GenerateFeatureFile(ost: OSTREAM): void {
    ost.write('UNITS=', ODB_SETTINGS.m_unitsStr, '\n');
    ost.write('#\n#Num Features\n#', '\n');
    ost.write('F ', this.m_featuresList.length, '\n', '\n');

    if (this.m_featuresList.length === 0) return;

    ost.write('#\n#Feature symbol names\n#', '\n');

    for (const n of [...this.m_allSymMap.keys()].sort((a, b) => a - b))
      ost.write('$', n, ' ', this.m_allSymMap.get(n)!, '\n');

    this.WriteAttributes(ost);

    ost.write('#\n#Layer features\n#', '\n');

    for (const feat of this.m_featuresList) feat.WriteFeatures(ost);
  }
}

enum FEATURE_TYPE {
  LINE,
  ARC,
  PAD,
  SURFACE,
}

export abstract class ODB_FEATURE extends ATTR_RECORD_WRITER {
  constructor(protected readonly m_index: number) {
    super();
  }

  WriteFeatures(ost: OSTREAM): void {
    switch (this.GetFeatureType()) {
      case FEATURE_TYPE.LINE:
        ost.write('L ');
        break;
      case FEATURE_TYPE.ARC:
        ost.write('A ');
        break;
      case FEATURE_TYPE.PAD:
        ost.write('P ');
        break;
      case FEATURE_TYPE.SURFACE:
        ost.write('S ');
        break;
      default:
        return;
    }

    this.WriteRecordContent(ost);
    ost.write('\n');
  }

  protected abstract GetFeatureType(): FEATURE_TYPE;

  protected abstract WriteRecordContent(ost: OSTREAM): void;
}

export class ODB_LINE extends ODB_FEATURE {
  constructor(
    aIndex: number,
    private readonly m_start: [string, string],
    private readonly m_end: [string, string],
    private readonly m_symIndex: number,
  ) {
    super(aIndex);
  }

  protected GetFeatureType(): FEATURE_TYPE {
    return FEATURE_TYPE.LINE;
  }

  protected WriteRecordContent(ost: OSTREAM): void {
    ost.write(
      this.m_start[0],
      ' ',
      this.m_start[1],
      ' ',
      this.m_end[0],
      ' ',
      this.m_end[1],
      ' ',
      this.m_symIndex,
      ' P 0',
    );

    this.WriteAttributes(ost);
  }
}

export class ODB_ARC extends ODB_FEATURE {
  constructor(
    aIndex: number,
    private readonly m_start: [string, string],
    private readonly m_end: [string, string],
    private readonly m_center: [string, string],
    private readonly m_symIndex: number,
    private readonly m_direction: ODB_DIRECTION,
  ) {
    super(aIndex);
  }

  protected GetFeatureType(): FEATURE_TYPE {
    return FEATURE_TYPE.ARC;
  }

  protected WriteRecordContent(ost: OSTREAM): void {
    ost.write(
      this.m_start[0],
      ' ',
      this.m_start[1],
      ' ',
      this.m_end[0],
      ' ',
      this.m_end[1],
      ' ',
      this.m_center[0],
      ' ',
      this.m_center[1],
      ' ',
      this.m_symIndex,
      ' P 0 ',
      this.m_direction === ODB_DIRECTION.CW ? 'Y' : 'N',
    );

    this.WriteAttributes(ost);
  }
}

export class ODB_PAD extends ODB_FEATURE {
  private readonly m_angle: EDA_ANGLE;

  constructor(
    aIndex: number,
    private readonly m_center: [string, string],
    private readonly m_symIndex: number,
    aAngle: EDA_ANGLE = ANGLE_0,
    private readonly m_mirror = false,
    private readonly m_resize = 1.0,
  ) {
    super(aIndex);
    // Held by value upstream.
    this.m_angle = aAngle.Clone();
    void this.m_resize;
  }

  protected GetFeatureType(): FEATURE_TYPE {
    return FEATURE_TYPE.PAD;
  }

  protected WriteRecordContent(ost: OSTREAM): void {
    ost.write(this.m_center[0], ' ', this.m_center[1], ' ');

    // TODO: support resize symbol
    // ost << "-1" << " " << m_symIndex << " "
    //     << m_resize << " P 0 ";

    ost.write(this.m_symIndex, ' P 0 ');

    if (this.m_mirror) ost.write('9 ', Double2String(this.m_angle.Normalize().AsDegrees()));
    else ost.write('8 ', Double2String(ANGLE_360.sub(this.m_angle).Normalize().AsDegrees()));

    this.WriteAttributes(ost);
  }
}

export class ODB_SURFACE extends ODB_FEATURE {
  m_surfaces: ODB_SURFACE_DATA;

  private constructor(aIndex: number, aSurfaces: ODB_SURFACE_DATA) {
    super(aIndex);
    this.m_surfaces = aSurfaces;
  }

  /** The constructor: no feature (see the file comment) when the outline has under 3 points. */
  static Make(
    aIndex: number,
    aPolygon: POLYGON,
    aFillType: FILL_T = FILL_T.FILLED_SHAPE,
  ): ODB_SURFACE | null {
    if (aPolygon.length === 0 || aPolygon[0]!.PointCount() < 3) return null;

    const surfaces = new ODB_SURFACE_DATA(aPolygon);

    if (aFillType !== FILL_T.NO_FILL) surfaces.AddPolygonHoles(aPolygon);

    return new ODB_SURFACE(aIndex, surfaces);
  }

  protected GetFeatureType(): FEATURE_TYPE {
    return FEATURE_TYPE.SURFACE;
  }

  protected WriteRecordContent(ost: OSTREAM): void {
    ost.write('P 0');
    this.WriteAttributes(ost);
    ost.write('\n');
    this.m_surfaces.WriteData(ost);
    ost.write('SE');
  }
}

enum LINE_TYPE {
  SEGMENT,
  ARC,
}

interface SURFACE_LINE {
  m_end: VECTOR2I;
  m_type: LINE_TYPE;
  m_center: VECTOR2I;
  m_direction: ODB_DIRECTION;
}

const segmentTo = (aEnd: VECTOR2I): SURFACE_LINE => ({
  m_end: { x: aEnd.x, y: aEnd.y },
  m_type: LINE_TYPE.SEGMENT,
  m_center: { x: 0, y: 0 },
  m_direction: ODB_DIRECTION.CW,
});

export class ODB_SURFACE_DATA {
  readonly m_polygons: SURFACE_LINE[][] = [];

  constructor(aPolygon: POLYGON) {
    const pts = aPolygon[0]!.CPoints();

    if (pts.length > 0) {
      if (this.m_polygons.length === 0) this.m_polygons.push([]);

      const first = this.m_polygons[0]!;
      first.push(segmentTo(pts[pts.length - 1]!));

      for (const p of pts) first.push(segmentTo(p));
    }
  }

  AddPolygonHoles(aPolygon: POLYGON): void {
    for (let ii = 1; ii < aPolygon.length; ++ii) {
      if (aPolygon[ii]!.PointCount() < 3) continue;

      const hole = aPolygon[ii]!.CPoints();

      if (hole.length === 0) continue;

      while (this.m_polygons.length <= ii) this.m_polygons.push([]);

      this.m_polygons[ii]!.push(segmentTo(hole[hole.length - 1]!));

      for (const p of hole) this.m_polygons[ii]!.push(segmentTo(p));
    }
  }

  WriteData(ost: OSTREAM): void {
    const is_island = new CHECK_ONCE();

    for (const contour of this.m_polygons) {
      if (contour.length === 0) continue;

      const back = AddXY(contour[contour.length - 1]!.m_end);
      ost.write('OB ', back[0], ' ', back[1], ' ');

      ost.write(is_island.call() ? 'I' : 'H');
      ost.write('\n');

      for (const line of contour) {
        const end = AddXY(line.m_end);

        if (line.m_type === LINE_TYPE.SEGMENT) {
          ost.write('OS ', end[0], ' ', end[1], '\n');
        } else {
          const c = AddXY(line.m_center);
          ost.write(
            'OC ',
            end[0],
            ' ',
            end[1],
            ' ',
            c[0],
            ' ',
            c[1],
            ' ',
            line.m_direction === ODB_DIRECTION.CW ? 'Y' : 'N',
            '\n',
          );
        }
      }

      ost.write('OE', '\n');
    }
  }
}
