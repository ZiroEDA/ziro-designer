// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `ROUTER_PREVIEW_ITEM` - `pcbnew/router/router_preview_item.{h,cpp}`. The
 * router's own overlay: a PNS item (or a bare shape) drawn as a `VIEW_ITEM` on
 * `LAYER_SELECT_OVERLAY`, stacked by a fractional depth so several layers of
 * one preview do not cover each other.
 *
 * The router here computes on `Shape` (`drc/drc_geometry.ts`: circle, stadium,
 * arc, closed poly), not on the `SHAPE` class family, so the `SH_*` switch of
 * `drawShape` maps as: SH_CIRCLE -> circle, SH_SEGMENT -> stadium, SH_ARC ->
 * arc, SH_SIMPLE/SH_RECT -> poly. A `LINE` has no single shape here (its
 * `shape()` answers null; `shapes()` is the list of primitives), so its
 * SH_LINE_CHAIN branch is the primitives drawn by `drawLineChain`'s rule: one
 * `DrawLine` per segment, a zero-length one a filled dot, arcs as `DrawArc`.
 *
 * The router's only preview: `PNS_KICAD_IFACE::DisplayItem` puts these in a
 * `VIEW_GROUP` on the canvas's VIEW (`pns_kicad_iface.ts`).
 */
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { EDA_ANGLE, EDA_ANGLE_T } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { Vec2, VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import {
  brightened,
  COLOR4D_UNSPECIFIED,
  type Color4d,
  LEGACY_COLORS,
  saturate,
  withAlpha,
} from '@ziroeda/common/gal/color4d.js';
import type { GAL } from '@ziroeda/common/gal/graphics_abstraction_layer.js';
import { GAL_LAYER_ID, IsCopperLayer, PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { NET_COLOR_MODE } from '@ziroeda/common/project/board_project_settings.js';
import type { VIEW } from '@ziroeda/common/view/view.js';
import type { Shape } from '@ziroeda/kimath/src/geometry/shape_collisions.js';
import type { PCB_RENDER_SETTINGS } from '../pcb_painter.js';
import { PnsKind, type PnsItem, LineMarker } from './pns_item.js';
import type { PnsLine } from './pns_line.js';
import type { PnsVia } from './pns_via.js';

export const PNS_HEAD_TRACE = 1;
export const PNS_HOVER_ITEM = 2;
export const PNS_SEMI_SOLID = 4;
export const PNS_COLLISION = 8;

/** `ROUTER_PREVIEW_ITEM::ITEM_TYPE`. */
export enum ROUTER_PREVIEW_ITEM_TYPE {
  PR_STUCK_MARKER = 0,
  PR_POINT,
  PR_SHAPE,
}

/**
 * What the preview asks its `PNS::ROUTER_IFACE` for: the board layer of a PNS
 * layer, as a `PCB_LAYER_ID`, and the net code / net-class colour behind a net
 * handle (`NETINFO_ITEM::GetNetCode`, `NETCLASS::GetPcbColor`).
 */
export interface ROUTER_PREVIEW_IFACE {
  GetBoardLayerFromPNSLayer(aPnsLayer: number): number;
  GetNetCode(aNet: unknown): number;
  /** The net class's PCB colour, or null when it has none (`HasPcbColor`). */
  GetNetClassPcbColor?(aNet: unknown): Color4d | null;
}

/** `LayerDepthFactor` and `PathOverlayDepth`. */
export const ROUTER_PREVIEW_LAYER_DEPTH_FACTOR = 0.001;
export const ROUTER_PREVIEW_PATH_OVERLAY_DEPTH =
  ROUTER_PREVIEW_LAYER_DEPTH_FACTOR * GAL_LAYER_ID.LAYER_ZONE_END;

const isLine = (a: PnsItem): a is PnsLine => a.kind() === PnsKind.LINE_T;
const isVia = (a: PnsItem): a is PnsVia => a.kind() === PnsKind.VIA_T;

export class ROUTER_PREVIEW_ITEM extends EDA_ITEM {
  static readonly LayerDepthFactor = ROUTER_PREVIEW_LAYER_DEPTH_FACTOR;
  static readonly PathOverlayDepth = ROUTER_PREVIEW_PATH_OVERLAY_DEPTH;

  private m_view: VIEW;
  private m_iface: ROUTER_PREVIEW_IFACE;
  /** `m_shape`, for everything but a LINE. */
  private m_shape: Shape | null = null;
  /** A LINE's primitives (the SH_LINE_CHAIN branch). */
  private m_lineShapes: readonly Shape[] | null = null;
  private m_hole: Shape | null = null;
  private m_pnsFlags: number;
  private m_type = ROUTER_PREVIEW_ITEM_TYPE.PR_SHAPE;
  private m_layer: number = GAL_LAYER_ID.LAYER_SELECT_OVERLAY;
  private m_originLayer: number = GAL_LAYER_ID.LAYER_SELECT_OVERLAY;
  private m_color: Color4d = COLOR4D_UNSPECIFIED;
  private m_width: number;
  private m_clearance = -1;
  private m_showClearance = false;
  private m_depth: number;
  private m_originDepth: number;
  private m_pos: VECTOR2I = { x: 0, y: 0 };

  /**
   * `ROUTER_PREVIEW_ITEM( const SHAPE& )` when `aItem` is a Shape;
   * `ROUTER_PREVIEW_ITEM( const PNS::ITEM*, ..., aFlags )` when it is an item
   * (or null, which leaves the shape empty until `Update`).
   */
  constructor(
    aItem: PnsItem | Shape | null,
    aIface: ROUTER_PREVIEW_IFACE,
    aView: VIEW,
    aFlags = 0,
  ) {
    super(KICAD_T.NOT_USED);
    this.m_view = aView;
    this.m_iface = aIface;
    this.m_pnsFlags = aFlags;

    const isShape = aItem !== null && 'kind' in aItem && typeof aItem.kind !== 'function';

    if (isShape) {
      this.m_pnsFlags = 0;
      this.m_shape = aItem as Shape;
      this.m_width = 0;
    } else {
      const item = aItem as PnsItem | null;
      this.m_width = aFlags & PNS_SEMI_SOLID ? 1 : 0;

      if (item) this.captureShapes(item);
    }

    this.m_depth = this.m_originDepth = aView.GetLayerOrder(this.m_originLayer);

    if (!isShape && aItem) this.Update(aItem as PnsItem);
  }

  private captureShapes(aItem: PnsItem): void {
    if (isLine(aItem)) {
      this.m_lineShapes = aItem.shapes(-1);
      return;
    }

    // TODO(JE) padstacks -- need to know the layer here
    this.m_shape = aItem.shape(-1);

    if (aItem.hasHole()) this.m_hole = aItem.hole()?.shape(-1) ?? null;
  }

  override GetClass(): string {
    return 'ROUTER_PREVIEW_ITEM';
  }

  /** `Update( const PNS::ITEM* )`. */
  Update(aItem: PnsItem): void {
    this.m_originLayer = this.m_iface.GetBoardLayerFromPNSLayer(aItem.layers().start());

    if (isLine(aItem)) {
      if (!aItem.cLine().segmentCount()) return;
    } else if (isVia(aItem)) {
      if (aItem.isVirtual()) return;
    }

    if (this.m_originLayer < 0) this.m_originLayer = 0;

    this.m_layer = this.m_originLayer;
    this.m_color = { ...this.getLayerColor(this.m_originLayer, aItem), a: 0.8 };
    this.m_depth =
      this.m_originDepth - (aItem.layers().start() + 1) * ROUTER_PREVIEW_LAYER_DEPTH_FACTOR;

    switch (aItem.kind()) {
      case PnsKind.LINE_T:
        this.m_type = ROUTER_PREVIEW_ITEM_TYPE.PR_SHAPE;
        this.m_width = (aItem as PnsLine).width();
        break;

      case PnsKind.ARC_T:
      case PnsKind.SEGMENT_T:
        this.m_type = ROUTER_PREVIEW_ITEM_TYPE.PR_SHAPE;
        this.m_width = (aItem as unknown as { width(): number }).width();
        break;

      case PnsKind.VIA_T: {
        const via = aItem as PnsVia;

        this.m_originLayer = this.m_layer = GAL_LAYER_ID.LAYER_VIAS;
        this.m_type = ROUTER_PREVIEW_ITEM_TYPE.PR_SHAPE;
        this.m_width = 0;
        this.m_color = { r: 0.7, g: 0.7, b: 0.7, a: 0.8 };
        this.m_depth =
          this.m_originDepth - PCB_LAYER_ID.PCB_LAYER_ID_COUNT * ROUTER_PREVIEW_LAYER_DEPTH_FACTOR;

        this.m_shape = null;

        let shapeLayer = -1;
        let largestDiameter = 0;

        for (const layer of via.uniqueShapeLayers()) {
          if (via.diameter(layer) > largestDiameter) {
            largestDiameter = via.diameter(layer);
            shapeLayer = layer;
          }
        }

        this.m_shape = aItem.shape(shapeLayer);
        this.m_hole = null;

        if (aItem.hasHole()) this.m_hole = aItem.hole()?.shape(-1) ?? null;

        break;
      }

      case PnsKind.SOLID_T:
        this.m_type = ROUTER_PREVIEW_ITEM_TYPE.PR_SHAPE;
        break;

      default:
        break;
    }

    if (aItem.marker() & LineMarker.MK_VIOLATION) this.m_pnsFlags |= PNS_COLLISION;

    if (this.m_pnsFlags & PNS_COLLISION) this.m_color = { r: 0, g: 1, b: 0, a: 1 };

    if (this.m_pnsFlags & PNS_HOVER_ITEM) this.m_color = withAlpha(this.m_color, 1.0);
  }

  SetColor(aColor: Color4d): void {
    this.m_color = aColor;
  }

  SetDepth(aDepth: number): void {
    this.m_depth = aDepth;
  }

  SetWidth(aWidth: number): void {
    this.m_width = aWidth;
  }

  SetClearance(aClearance: number): void {
    this.m_clearance = aClearance;
  }

  ShowClearance(aEnabled: boolean): void {
    this.m_showClearance = aEnabled;
  }

  GetOriginDepth(): number {
    return this.m_originDepth;
  }

  override GetPosition(): VECTOR2I {
    return this.m_pos;
  }

  override SetPosition(aPos: VECTOR2I): void {
    this.m_pos = aPos;
  }

  override ViewBBox(): BOX2I {
    let bbox = new BOX2I();

    switch (this.m_type) {
      case ROUTER_PREVIEW_ITEM_TYPE.PR_SHAPE: {
        const shapes = this.m_lineShapes ?? (this.m_shape ? [this.m_shape] : []);
        let first = true;

        for (const s of shapes) {
          const b = shapeBBox(s);

          if (first) {
            bbox = b;
            first = false;
          } else {
            bbox.Merge(b);
          }
        }

        if (!first) bbox.Inflate(Math.trunc(this.m_width / 2));

        if (this.m_hole) bbox.Merge(shapeBBox(this.m_hole));

        return bbox;
      }

      case ROUTER_PREVIEW_ITEM_TYPE.PR_POINT:
        return new BOX2I(
          { x: this.m_pos.x - 100000, y: this.m_pos.y - 100000 },
          { x: 200000, y: 200000 },
        );

      default:
        break;
    }

    return bbox;
  }

  override ViewGetLayers(): number[] {
    return [this.m_layer];
  }

  /** `drawLineChain`, per primitive of a LINE. */
  private drawLineChain(aShapes: readonly Shape[], gal: GAL): void {
    gal.SetIsFill(false);

    for (const s of aShapes) {
      if (s.kind === 'stadium') {
        if (s.a.x === s.b.x && s.a.y === s.b.y) {
          gal.SetIsFill(true);
          gal.SetIsStroke(false);
          gal.DrawCircle(s.a, Math.trunc(gal.GetLineWidth() / 2));
          gal.SetIsFill(false);
          gal.SetIsStroke(true);
        } else {
          gal.DrawLine(s.a, s.b);
        }
      } else if (s.kind === 'arc') {
        gal.DrawArc(
          s.c,
          s.rad,
          new EDA_ANGLE(s.a0, EDA_ANGLE_T.RADIANS_T),
          new EDA_ANGLE(s.sweep, EDA_ANGLE_T.RADIANS_T),
        );
      }
    }
  }

  private drawShape(aShape: Shape, gal: GAL): void {
    let holeDrawn = false;
    // Always show clearance when we're in collision, even if the preference is off
    const showClearance = this.m_showClearance || (this.m_pnsFlags & PNS_COLLISION) > 0;

    switch (aShape.kind) {
      case 'stadium': {
        const w = 2 * aShape.r;

        gal.SetIsStroke(false);

        if (showClearance && this.m_clearance > 0) {
          gal.SetLineWidth(w + 2 * this.m_clearance);
          gal.DrawSegment(aShape.a, aShape.b, w + 2 * this.m_clearance);
        }

        gal.SetLayerDepth(this.m_depth);
        gal.SetLineWidth(w);
        gal.SetFillColor(this.m_color);
        gal.DrawSegment(aShape.a, aShape.b, w);
        break;
      }

      case 'circle': {
        gal.SetStrokeColor(this.m_color);

        if (showClearance && this.m_clearance > 0) {
          gal.SetIsStroke(false);
          gal.DrawCircle(aShape.c, aShape.r + this.m_clearance);
        }

        gal.SetLayerDepth(this.m_depth);

        if (this.m_hole && this.m_hole.kind === 'circle') {
          const h = this.m_hole;
          const halfWidth = Math.trunc(this.m_width / 2);

          gal.SetIsStroke(true);
          gal.SetIsFill(false);
          gal.SetLineWidth(halfWidth + aShape.r - h.r);
          gal.DrawCircle(aShape.c, Math.trunc((halfWidth + aShape.r + h.r) / 2));

          holeDrawn = true;
        } else {
          gal.SetIsStroke(this.m_width !== 0);
          gal.SetLineWidth(this.m_width);
          gal.SetFillColor(this.m_color);
          gal.DrawCircle(aShape.c, aShape.r);
        }

        break;
      }

      case 'poly': {
        const polygon: Vec2[] = aShape.pts.map((p) => ({ x: p.x, y: p.y }));

        gal.SetFillColor(this.m_color);

        if (showClearance && this.m_clearance > 0) {
          gal.SetIsStroke(true);
          gal.SetLineWidth(2 * this.m_clearance);

          // need the implicit last segment to be explicit for DrawPolyline
          gal.DrawPolyline([...polygon, polygon[0]!]);
        }

        gal.SetLayerDepth(this.m_depth);
        gal.SetIsStroke(this.m_width !== 0);
        gal.SetLineWidth(this.m_width);
        gal.SetStrokeColor(this.m_color);
        gal.DrawPolygon(polygon);
        break;
      }

      case 'arc': {
        const w = 2 * aShape.r;
        const start = new EDA_ANGLE(aShape.a0, EDA_ANGLE_T.RADIANS_T);
        const angle = new EDA_ANGLE(aShape.sweep, EDA_ANGLE_T.RADIANS_T);

        gal.SetIsFill(false);
        gal.SetIsStroke(true);

        if (showClearance && this.m_clearance > 0) {
          gal.SetLineWidth(w + 2 * this.m_clearance);
          gal.DrawArc(aShape.c, aShape.rad, start, angle);
        }

        gal.SetLayerDepth(this.m_depth);
        gal.SetStrokeColor(this.m_color);
        gal.SetFillColor(this.m_color);
        gal.SetLineWidth(w);
        gal.DrawArc(aShape.c, aShape.rad, start, angle);
        break;
      }
    }

    if (this.m_hole && !holeDrawn) {
      gal.SetLayerDepth(this.m_depth);
      gal.SetIsStroke(true);
      gal.SetIsFill(false);
      gal.SetStrokeColor(this.m_color);
      gal.SetLineWidth(1);

      if (this.m_hole.kind === 'circle') gal.DrawCircle(this.m_hole.c, this.m_hole.r);
      else if (this.m_hole.kind === 'stadium')
        gal.DrawSegment(this.m_hole.a, this.m_hole.b, 2 * this.m_hole.r);
    }
  }

  override ViewDraw(_aLayer: number, aView: VIEW): void {
    const gal = aView.GetGAL()!;

    if (this.m_type !== ROUTER_PREVIEW_ITEM_TYPE.PR_SHAPE) return;

    if (!this.m_shape && !this.m_lineShapes) return;

    // N.B. The order of draw here is important
    gal.SetLayerDepth(this.m_originDepth);

    // TODO(snh) Add configuration option for the color/alpha here
    gal.SetStrokeColor(withAlpha(LEGACY_COLORS.DARKDARKGRAY, 0.9));
    gal.SetFillColor(withAlpha(LEGACY_COLORS.DARKDARKGRAY, 0.7));
    gal.SetIsStroke(this.m_width !== 0);
    gal.SetIsFill(true);

    // Semi-solids (ie: rule areas) which are not in collision are sketched (ie: outline only)
    if ((this.m_pnsFlags & PNS_SEMI_SOLID) > 0 && (this.m_pnsFlags & PNS_COLLISION) === 0)
      gal.SetIsFill(false);

    if (this.m_lineShapes) {
      const showClearance = this.m_showClearance || (this.m_pnsFlags & PNS_COLLISION) > 0;

      if (showClearance && this.m_clearance > 0) {
        gal.SetLineWidth(this.m_width + 2 * this.m_clearance);
        this.drawLineChain(this.m_lineShapes, gal);
      }

      gal.SetLayerDepth(this.m_depth);
      gal.SetLineWidth(this.m_width);
      gal.SetStrokeColor(this.m_color);
      gal.SetFillColor(this.m_color);
      this.drawLineChain(this.m_lineShapes, gal);
    } else {
      this.drawShape(this.m_shape!, gal);
    }
  }

  /** `getLayerColor`. */
  private getLayerColor(aLayer: number, aItem: PnsItem | null): Color4d {
    const settings = this.m_view.GetPainter().GetSettings() as PCB_RENDER_SETTINGS;

    let color = settings.GetLayerColor(aLayer);

    if (
      aItem?.net() != null &&
      settings.GetNetColorMode() === NET_COLOR_MODE.ALL &&
      IsCopperLayer(aLayer)
    ) {
      const code = this.m_iface.GetNetCode(aItem.net());
      const mapped = settings.GetNetColorMap().get(code);

      if (mapped !== undefined && !isUnspecified(mapped)) {
        color = mapped;
      } else {
        const nc = this.m_iface.GetNetClassPcbColor?.(aItem.net());

        if (nc) color = nc;
      }
    }

    if (this.m_pnsFlags & PNS_HEAD_TRACE) return saturate(color, 1.0);
    if (this.m_pnsFlags & PNS_HOVER_ITEM) return brightened(color, 0.7);

    return color;
  }
}

const isUnspecified = (c: Color4d): boolean => c.r === 0 && c.g === 0 && c.b === 0 && c.a === 0;

/** `SHAPE::BBox()` for the router's `Shape` union. */
function shapeBBox(s: Shape): BOX2I {
  switch (s.kind) {
    case 'circle':
      return new BOX2I({ x: s.c.x - s.r, y: s.c.y - s.r }, { x: 2 * s.r, y: 2 * s.r });
    case 'stadium': {
      const x0 = Math.min(s.a.x, s.b.x) - s.r;
      const y0 = Math.min(s.a.y, s.b.y) - s.r;
      return new BOX2I(
        { x: x0, y: y0 },
        { x: Math.abs(s.a.x - s.b.x) + 2 * s.r, y: Math.abs(s.a.y - s.b.y) + 2 * s.r },
      );
    }
    case 'arc': {
      // The chord's box plus the radius, as a conservative arc box.
      return new BOX2I(
        { x: s.c.x - s.rad - s.r, y: s.c.y - s.rad - s.r },
        { x: 2 * (s.rad + s.r), y: 2 * (s.rad + s.r) },
      );
    }
    case 'poly': {
      const xs = s.pts.map((p) => p.x);
      const ys = s.pts.map((p) => p.y);
      const x0 = Math.min(...xs);
      const y0 = Math.min(...ys);
      return new BOX2I({ x: x0, y: y0 }, { x: Math.max(...xs) - x0, y: Math.max(...ys) - y0 });
    }
  }
}
