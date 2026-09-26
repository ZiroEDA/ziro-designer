// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `view/view_overlay.h` + `common/view/view_overlay.cpp`: `KIGFX::VIEW_OVERLAY`,
 * a VIEW_ITEM that records drawing commands and replays them on the GAL
 * when the view draws its overlay layer.
 */

import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import type { Vec2, VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { SEG } from '@ziroeda/kimath/src/geometry/seg.js';
import type { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import type { Color4d } from '../color4d.js';
import { GAL_SCOPED_ATTRS, GAL_SCOPED_ATTRS_FLAGS } from '../gal/graphics_abstraction_layer.js';
import { LAYER_GP_OVERLAY } from '../layer_id.js';
import type { VIEW } from './view.js';
import { VIEW_ITEM } from './view_item.js';

interface COMMAND {
  Execute(aView: VIEW): void;
}

class COMMAND_LINE implements COMMAND {
  m_p0: Vec2;
  m_p1: Vec2;

  constructor(aP0: Vec2, aP1: Vec2) {
    this.m_p0 = aP0;
    this.m_p1 = aP1;
  }

  Execute(aView: VIEW): void {
    aView.GetGAL().DrawLine(this.m_p0, this.m_p1);
  }
}

class COMMAND_RECTANGLE implements COMMAND {
  m_p0: Vec2;
  m_p1: Vec2;

  constructor(aP0: Vec2, aP1: Vec2) {
    this.m_p0 = aP0;
    this.m_p1 = aP1;
  }

  Execute(aView: VIEW): void {
    aView.GetGAL().DrawRectangle(this.m_p0, this.m_p1);
  }
}

class COMMAND_CIRCLE implements COMMAND {
  m_center: Vec2;
  m_radius: number;

  constructor(aCenter: Vec2, aRadius: number) {
    this.m_center = aCenter;
    this.m_radius = aRadius;
  }

  Execute(aView: VIEW): void {
    aView.GetGAL().DrawCircle(this.m_center, this.m_radius);
  }
}

class COMMAND_ARC implements COMMAND {
  m_center: Vec2;
  m_radius: number;
  m_startAngle: EDA_ANGLE;
  m_endAngle: EDA_ANGLE;

  constructor(aCenter: Vec2, aRadius: number, aStartAngle: EDA_ANGLE, aEndAngle: EDA_ANGLE) {
    this.m_center = aCenter;
    this.m_radius = aRadius;
    this.m_startAngle = aStartAngle;
    this.m_endAngle = aEndAngle;
  }

  Execute(aView: VIEW): void {
    aView
      .GetGAL()
      .DrawArc(
        this.m_center,
        this.m_radius,
        this.m_startAngle,
        this.m_endAngle.sub(this.m_startAngle),
      );
  }
}

class COMMAND_POLYGON implements COMMAND {
  m_pointList: Vec2[];

  constructor(aPointList: readonly Vec2[]) {
    this.m_pointList = [...aPointList];
  }

  Execute(aView: VIEW): void {
    aView.GetGAL().DrawPolygon(this.m_pointList);
  }
}

class COMMAND_POLY_POLYGON implements COMMAND {
  m_polySet: SHAPE_POLY_SET;

  constructor(aPolySet: SHAPE_POLY_SET) {
    this.m_polySet = new SHAPE_POLY_SET(aPolySet);
  }

  Execute(aView: VIEW): void {
    aView.GetGAL().DrawPolygon(this.m_polySet);
  }
}

class COMMAND_POINT_POLYGON implements COMMAND {
  m_pointList: Vec2[];

  constructor(aPointList: readonly Vec2[], aListSize: number) {
    this.m_pointList = [];
    for (let ii = 0; ii < aListSize; ii++) this.m_pointList.push(aPointList[ii]!);
  }

  Execute(aView: VIEW): void {
    aView.GetGAL().DrawPolygon(this.m_pointList);
  }
}

class COMMAND_SET_STROKE implements COMMAND {
  m_isStroke: boolean;

  constructor(aIsStroke: boolean) {
    this.m_isStroke = aIsStroke;
  }

  Execute(aView: VIEW): void {
    aView.GetGAL().SetIsStroke(this.m_isStroke);
  }
}

class COMMAND_SET_FILL implements COMMAND {
  m_isFill: boolean;

  constructor(aIsFill: boolean) {
    this.m_isFill = aIsFill;
  }

  Execute(aView: VIEW): void {
    aView.GetGAL().SetIsFill(this.m_isFill);
  }
}

class COMMAND_SET_COLOR implements COMMAND {
  m_isStroke: boolean;
  m_color: Color4d;

  constructor(aIsStroke: boolean, aColor: Color4d) {
    this.m_isStroke = aIsStroke;
    this.m_color = aColor;
  }

  Execute(aView: VIEW): void {
    if (this.m_isStroke) aView.GetGAL().SetStrokeColor(this.m_color);
    else aView.GetGAL().SetFillColor(this.m_color);
  }
}

class COMMAND_SET_WIDTH implements COMMAND {
  m_width: number;

  constructor(aWidth: number) {
    this.m_width = aWidth;
  }

  Execute(aView: VIEW): void {
    aView.GetGAL().SetLineWidth(this.m_width);
  }
}

class COMMAND_GLYPH_SIZE implements COMMAND {
  m_size: VECTOR2I;

  constructor(aSize: VECTOR2I) {
    this.m_size = aSize;
  }

  Execute(aView: VIEW): void {
    aView.GetGAL().SetGlyphSize(this.m_size);
  }
}

class COMMAND_BITMAP_TEXT implements COMMAND {
  m_text: string;
  m_pos: VECTOR2I;
  m_angle: EDA_ANGLE;

  constructor(aText: string, aPosition: VECTOR2I, aAngle: EDA_ANGLE) {
    this.m_text = aText;
    this.m_pos = aPosition;
    this.m_angle = aAngle;
  }

  Execute(aView: VIEW): void {
    aView.GetGAL().BitmapText(this.m_text, this.m_pos, this.m_angle);
  }
}

export class VIEW_OVERLAY extends VIEW_ITEM {
  private m_strokeColor: Color4d = { r: 0, g: 0, b: 0, a: 1 };
  private m_fillColor: Color4d = { r: 0, g: 0, b: 0, a: 1 };
  private m_commands: COMMAND[] = [];

  GetClass(): string {
    return 'VIEW_OVERLAY';
  }

  private releaseCommands(): void {
    this.m_commands = [];
  }

  Clear(): void {
    this.releaseCommands();
  }

  ViewBBox(): BOX2I {
    const maxBox = new BOX2I();
    maxBox.SetMaximum();
    return maxBox;
  }

  override ViewDraw(aLayer: number, aView: VIEW): void {
    const gal = aView.GetGAL();
    GAL_SCOPED_ATTRS(gal, GAL_SCOPED_ATTRS_FLAGS.LAYER_DEPTH, () => {
      gal.SetLayerDepth(gal.GetMinDepth());

      for (const cmd of this.m_commands) cmd.Execute(aView);
    });
  }

  ViewGetLayers(): number[] {
    return [LAYER_GP_OVERLAY];
  }

  // Basic shape primitives
  Line(aStartPoint: Vec2, aEndPoint: Vec2): void;
  Line(aSeg: SEG): void;
  Line(a: Vec2 | SEG, aEndPoint?: Vec2): void {
    if (aEndPoint === undefined) {
      const aSeg = a as SEG;
      this.Line(aSeg.A, aSeg.B);
      return;
    }

    this.m_commands.push(new COMMAND_LINE(a as Vec2, aEndPoint));
  }

  Segment(aStartPoint: Vec2, aEndPoint: Vec2, aWidth: number): void {
    this.SetLineWidth(aWidth);
    this.Line(aStartPoint, aEndPoint);
  }

  Polyline(aPolyLine: SHAPE_LINE_CHAIN): void {
    this.SetIsStroke(true);
    this.SetIsFill(false);

    for (let i = 0; i < aPolyLine.SegmentCount(); i++) this.Line(aPolyLine.CSegment(i));
  }

  // polygon primitives
  Polygon(aPolySet: SHAPE_POLY_SET): void;
  Polygon(aPointList: readonly Vec2[]): void;
  Polygon(aPointList: readonly Vec2[], aListSize: number): void;
  Polygon(a: SHAPE_POLY_SET | readonly Vec2[], aListSize?: number): void {
    if (a instanceof SHAPE_POLY_SET) {
      this.m_commands.push(new COMMAND_POLY_POLYGON(a));
      return;
    }

    if (aListSize !== undefined) {
      this.m_commands.push(new COMMAND_POINT_POLYGON(a, aListSize));
      return;
    }

    this.m_commands.push(new COMMAND_POLYGON(a));
  }

  Circle(aCenterPoint: Vec2, aRadius: number): void {
    this.m_commands.push(new COMMAND_CIRCLE(aCenterPoint, aRadius));
  }

  Arc(aCenterPoint: Vec2, aRadius: number, aStartAngle: EDA_ANGLE, aEndAngle: EDA_ANGLE): void {
    this.m_commands.push(new COMMAND_ARC(aCenterPoint, aRadius, aStartAngle, aEndAngle));
  }

  Rectangle(aStartPoint: Vec2, aEndPoint: Vec2): void {
    this.m_commands.push(new COMMAND_RECTANGLE(aStartPoint, aEndPoint));
  }

  Cross(aP: Vec2, aSize: number): void {
    this.Line({ x: aP.x - aSize, y: aP.y - aSize }, { x: aP.x + aSize, y: aP.y + aSize });
    this.Line({ x: aP.x + aSize, y: aP.y - aSize }, { x: aP.x - aSize, y: aP.y + aSize });
  }

  BitmapText(aText: string, aPosition: VECTOR2I, aAngle: EDA_ANGLE): void {
    this.m_commands.push(new COMMAND_BITMAP_TEXT(aText, aPosition, aAngle));
  }

  // Draw settings
  SetIsFill(aIsFillEnabled: boolean): void {
    this.m_commands.push(new COMMAND_SET_FILL(aIsFillEnabled));
  }

  SetIsStroke(aIsStrokeEnabled: boolean): void {
    this.m_commands.push(new COMMAND_SET_STROKE(aIsStrokeEnabled));
  }

  SetFillColor(aColor: Color4d): void {
    this.m_fillColor = aColor;
    this.m_commands.push(new COMMAND_SET_COLOR(false, aColor));
  }

  SetStrokeColor(aColor: Color4d): void {
    this.m_strokeColor = aColor;
    this.m_commands.push(new COMMAND_SET_COLOR(true, aColor));
  }

  SetGlyphSize(aSize: VECTOR2I): void {
    this.m_commands.push(new COMMAND_GLYPH_SIZE(aSize));
  }

  SetLineWidth(aLineWidth: number): void {
    this.m_commands.push(new COMMAND_SET_WIDTH(aLineWidth));
  }

  GetStrokeColor(): Color4d {
    return this.m_strokeColor;
  }

  GetFillColor(): Color4d {
    return this.m_fillColor;
  }
}
