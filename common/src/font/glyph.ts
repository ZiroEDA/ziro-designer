// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `font/glyph.h` / `common/font/glyph.cpp`: `KIFONT::GLYPH`, one drawn glyph;
 * `STROKE_GLYPH` a list of polylines, `OUTLINE_GLYPH` a `SHAPE_POLY_SET`.
 */

import type { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import {
  SHAPE_POLY_SET,
  TRIANGULATED_POLYGON,
} from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { BOX2D } from '@ziroeda/kimath/src/math/box2.js';
import type { Vec2, VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePointD } from '@ziroeda/kimath/src/trigo.js';

/** The GLYPH surface, so that OUTLINE_GLYPH (a SHAPE_POLY_SET) can carry it. */
export interface GLYPH_LIKE {
  IsOutline(): boolean;
  IsStroke(): boolean;
  BoundingBox(): BOX2D;
  IsHover(): boolean;
  SetIsHover(aIsHover: boolean): void;
}

export abstract class GLYPH implements GLYPH_LIKE {
  protected m_isHover = false;

  IsOutline(): boolean {
    return false;
  }
  IsStroke(): boolean {
    return false;
  }

  abstract BoundingBox(): BOX2D;

  IsHover(): boolean {
    return this.m_isHover;
  }
  SetIsHover(aIsHover: boolean): void {
    this.m_isHover = aIsHover;
  }
}

/**
 * `class OUTLINE_GLYPH : public GLYPH, public SHAPE_POLY_SET`: the polygon
 * side is the base here, and the GLYPH side (`IsOutline`, `BoundingBox`,
 * the hover flag) is carried on the class.
 */
export class OUTLINE_GLYPH extends SHAPE_POLY_SET implements GLYPH_LIKE {
  protected m_isHover = false;

  constructor();
  constructor(aGlyph: OUTLINE_GLYPH);
  constructor(aPoly: SHAPE_POLY_SET);
  constructor(a?: SHAPE_POLY_SET) {
    super(a as SHAPE_POLY_SET);
  }

  IsOutline(): boolean {
    return true;
  }
  IsStroke(): boolean {
    return false;
  }

  IsHover(): boolean {
    return this.m_isHover;
  }
  SetIsHover(aIsHover: boolean): void {
    this.m_isHover = aIsHover;
  }

  BoundingBox(): BOX2D {
    const bbox = this.BBox();
    return new BOX2D(bbox.GetOrigin(), bbox.GetSize());
  }

  Triangulate(aCallback: (aPt1: VECTOR2I, aPt2: VECTOR2I, aPt3: VECTOR2I) => void): void {
    this.CacheTriangulation(false);

    for (let i = 0; i < this.TriangulatedPolyCount(); i++) {
      const polygon = this.TriangulatedPolygon(i);

      for (let j = 0; j < polygon.GetTriangleCount(); j++) {
        const a: VECTOR2I = { x: 0, y: 0 };
        const b: VECTOR2I = { x: 0, y: 0 };
        const c: VECTOR2I = { x: 0, y: 0 };
        polygon.GetTriangle(j, a, b, c);
        aCallback(a, b, c);
      }
    }
  }

  override CacheTriangulation(aPartition = true, aSimplify = false): void {
    // Only call CacheTriangulation if it has never been done before.  Otherwise we'll hash
    // the triangulation to see if it has been edited, and glyphs are invariant after creation.
    //
    // Also forces "partition" to false as we never want to partition a glyph.

    if (this.TriangulatedPolyCount() === 0) super.CacheTriangulation(false, aSimplify);
  }

  /**
   * @return a set of triangulated polygons from the glyph.  CacheTriangulation() will use this
   * data as hint data the next time around.
   */
  GetTriangulationData(): TRIANGULATED_POLYGON[] {
    const data: TRIANGULATED_POLYGON[] = [];

    for (const poly of this.m_triangulatedPolys) data.push(new TRIANGULATED_POLYGON(poly));

    return data;
  }

  /**
   * Cache the triangulation for the glyph from a known set of triangle indexes.
   * (See GetTriangulationData() above for more info.)
   */
  CacheTriangulationFromHint(aHintData: TRIANGULATED_POLYGON[]): void {
    this.cacheTriangulation(false, false, aHintData);
  }
}

/**
 * `class STROKE_GLYPH : public GLYPH, public std::vector<std::vector<VECTOR2D>>`:
 * the strokes are `this.strokes`.
 */
export class STROKE_GLYPH extends GLYPH {
  strokes: VECTOR2I[][] = []; // `std::vector<std::vector<VECTOR2D>>`: doubles, held in the mutable point record

  private m_penIsDown = false;
  private m_boundingBox = new BOX2D();

  constructor(aGlyph?: STROKE_GLYPH) {
    super();

    if (aGlyph) {
      for (const pointList of aGlyph.strokes)
        this.strokes.push(pointList.map((p) => ({ x: p.x, y: p.y })));

      this.m_boundingBox = new BOX2D(
        aGlyph.m_boundingBox.GetOrigin(),
        aGlyph.m_boundingBox.GetSize(),
      );
    }
  }

  override IsStroke(): boolean {
    return true;
  }

  AddPoint(aPoint: Vec2): void {
    if (!this.m_penIsDown) {
      this.strokes.push([]);
      this.m_penIsDown = true;
    }

    this.strokes[this.strokes.length - 1]!.push({ x: aPoint.x, y: aPoint.y });
  }

  RaisePen(): void {
    this.m_penIsDown = false;
  }

  Finalize(): void {
    // Shrinking the strokes saves a bit less than 512K of memory.  It's not worth it for the
    // performance hit of doing more than 328,000 reallocs.
  }

  BoundingBox(): BOX2D {
    return this.m_boundingBox;
  }
  SetBoundingBox(bbox: BOX2D): void {
    this.m_boundingBox = bbox;
  }

  Transform(
    aGlyphSize: Vec2,
    aOffset: Vec2,
    aTilt: number,
    aAngle: EDA_ANGLE,
    aMirror: boolean,
    aOrigin: Vec2,
  ): GLYPH {
    const glyph = new STROKE_GLYPH(this);

    const end = { x: glyph.m_boundingBox.GetEnd().x, y: glyph.m_boundingBox.GetEnd().y };

    end.x *= aGlyphSize.x;
    end.y *= aGlyphSize.y;

    if (aTilt !== 0.0) end.x -= end.y * aTilt;

    glyph.m_boundingBox.SetEnd(end);
    glyph.m_boundingBox.Offset(aOffset);

    for (const pointList of glyph.strokes) {
      for (let i = 0; i < pointList.length; i++) {
        const point = pointList[i]!;
        point.x *= aGlyphSize.x;
        point.y *= aGlyphSize.y;

        if (aTilt !== 0.0) point.x -= point.y * aTilt;

        point.x += aOffset.x;
        point.y += aOffset.y;

        if (aMirror) point.x = aOrigin.x - (point.x - aOrigin.x);

        if (!aAngle.IsZero()) pointList[i] = RotatePointD(point, aOrigin, aAngle);
      }
    }

    return glyph;
  }

  Move(aOffset: Vec2): void {
    this.m_boundingBox.Offset(aOffset);

    for (const pointList of this.strokes) {
      for (const point of pointList) {
        point.x += aOffset.x;
        point.y += aOffset.y;
      }
    }
  }
}
