// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `libs/kimath/include/geometry/intersection.h` / `src/geometry/intersection.cpp`:
 * the intersection visitor over `INTERSECTABLE_GEOM`, a variant of LINE,
 * HALF_LINE, SEG, CIRCLE, SHAPE_ARC and BOX2I.
 */
import type { VECTOR2I } from '../math/vector2.js';
import { BOX2I } from '../math/box2.js';
import { CIRCLE } from './circle.js';
import { HALF_LINE } from './half_line.js';
import { LINE } from './line.js';
import { SEG } from './seg.js';
import { SHAPE_ARC } from './shape_arc.js';
import { KIGEOM_BoxToSegs } from './shape_utils.js';

export type INTERSECTABLE_GEOM = LINE | HALF_LINE | SEG | CIRCLE | SHAPE_ARC | BOX2I;

/*
 * Helper functions that dispatch to the correct intersection function
 * in one of the geometry classes.
 */

function findIntersectionsSegSeg(aSegA: SEG, aSegB: SEG, aIntersections: VECTOR2I[]): void {
  const intersection = aSegA.Intersect(aSegB);

  if (intersection) aIntersections.push(intersection);
}

function findIntersectionsSegLine(aSeg: SEG, aLine: LINE, aIntersections: VECTOR2I[]): void {
  const intersection = aLine.Intersect(aSeg);

  if (intersection) aIntersections.push(intersection);
}

function findIntersectionsSegHalfLine(
  aSeg: SEG,
  aHalfLine: HALF_LINE,
  aIntersections: VECTOR2I[],
): void {
  const intersection = aHalfLine.Intersect(aSeg);

  if (intersection) aIntersections.push(intersection);
}

function findIntersectionsSegCircle(aSeg: SEG, aCircle: CIRCLE, aIntersections: VECTOR2I[]): void {
  const intersections = aCircle.Intersect(aSeg);
  aIntersections.push(...intersections);
}

function findIntersectionsSegArc(aSeg: SEG, aArc: SHAPE_ARC, aIntersections: VECTOR2I[]): void {
  const intersections: VECTOR2I[] = [];
  aArc.IntersectLine(aSeg, intersections);

  // Find only the intersections that are within the segment
  for (const intersection of intersections) {
    if (aSeg.Contains(intersection)) aIntersections.push(intersection);
  }
}

function findIntersectionsLineLine(aLineA: LINE, aLineB: LINE, aIntersections: VECTOR2I[]): void {
  const intersection = aLineA.Intersect(aLineB);

  if (intersection) aIntersections.push(intersection);
}

function findIntersectionsLineHalfLine(
  aLine: LINE,
  aHalfLine: HALF_LINE,
  aIntersections: VECTOR2I[],
): void {
  // Intersect as two infinite lines
  const intersection = aHalfLine.GetContainedSeg().Intersect(aLine.GetContainedSeg(), false, true);

  // No intersection at all (parallel, or passes on the other side of the start point)
  if (!intersection) return;

  if (aHalfLine.Contains(intersection)) aIntersections.push(intersection);
}

function findIntersectionsHalfLineHalfLine(
  aHalfLineA: HALF_LINE,
  aHalfLineB: HALF_LINE,
  aIntersections: VECTOR2I[],
): void {
  const intersection = aHalfLineA.Intersect(aHalfLineB);

  if (intersection) aIntersections.push(intersection);
}

function findIntersectionsCircleLine(
  aCircle: CIRCLE,
  aLine: LINE,
  aIntersections: VECTOR2I[],
): void {
  const intersections = aCircle.IntersectLine(aLine.GetContainedSeg());
  aIntersections.push(...intersections);
}

function findIntersectionsCircleHalfLine(
  aCircle: CIRCLE,
  aHalfLine: HALF_LINE,
  aIntersections: VECTOR2I[],
): void {
  const intersections = aCircle.IntersectLine(aHalfLine.GetContainedSeg());

  for (const intersection of intersections) {
    if (aHalfLine.Contains(intersection)) aIntersections.push(intersection);
  }
}

function findIntersectionsCircleCircle(
  aCircleA: CIRCLE,
  aCircleB: CIRCLE,
  aIntersections: VECTOR2I[],
): void {
  const intersections = aCircleA.Intersect(aCircleB);
  aIntersections.push(...intersections);
}

function findIntersectionsCircleArc(
  aCircle: CIRCLE,
  aArc: SHAPE_ARC,
  aIntersections: VECTOR2I[],
): void {
  aArc.Intersect(aCircle, aIntersections);
}

function findIntersectionsArcArc(
  aArcA: SHAPE_ARC,
  aArcB: SHAPE_ARC,
  aIntersections: VECTOR2I[],
): void {
  aArcA.Intersect(aArcB, aIntersections);
}

function findIntersectionsArcLine(aArc: SHAPE_ARC, aLine: LINE, aIntersections: VECTOR2I[]): void {
  const intersections: VECTOR2I[] = [];
  aArc.IntersectLine(aLine.GetContainedSeg(), intersections);
  aIntersections.push(...intersections);
}

function findIntersectionsArcHalfLine(
  aArc: SHAPE_ARC,
  aHalfLine: HALF_LINE,
  aIntersections: VECTOR2I[],
): void {
  const intersections: VECTOR2I[] = [];
  aArc.IntersectLine(aHalfLine.GetContainedSeg(), intersections);

  for (const intersection of intersections) {
    if (aHalfLine.Contains(intersection)) aIntersections.push(intersection);
  }
}

/**
 * The visitor: `INTERSECTION_VISITOR visitor( geom2, points ); std::visit( visitor, geom1 )`
 * is `new INTERSECTION_VISITOR( geom2, points ).visit( geom1 )`.
 *
 * The operator() functions are the entry points for the visitor.
 *
 * Dispatch to the correct function based on the type of the "otherGeometry"
 * which is held as state. This is also where the order of the parameters is
 * determined, which avoids having to define a 'reverse' function for each
 * intersection type.
 */
export class INTERSECTION_VISITOR {
  constructor(
    private readonly m_otherGeometry: INTERSECTABLE_GEOM,
    private readonly m_intersections: VECTOR2I[],
  ) {}

  /** `std::visit( *this, aGeom )`. */
  visit(aGeom: INTERSECTABLE_GEOM): void {
    if (aGeom instanceof SEG) this.visitSeg(aGeom);
    else if (aGeom instanceof LINE) this.visitLine(aGeom);
    else if (aGeom instanceof HALF_LINE) this.visitHalfLine(aGeom);
    else if (aGeom instanceof CIRCLE) this.visitCircle(aGeom);
    else if (aGeom instanceof SHAPE_ARC) this.visitArc(aGeom);
    else this.visitRect(aGeom);
  }

  visitSeg(aSeg: SEG): void {
    const otherGeom = this.m_otherGeometry;

    if (otherGeom instanceof BOX2I) {
      // Seg-Rect via decomposition into segments
      for (const aRectSeg of KIGEOM_BoxToSegs(otherGeom))
        findIntersectionsSegSeg(aSeg, aRectSeg, this.m_intersections);
    } else if (otherGeom instanceof SEG) {
      // In all other segment comparisons, the SEG is the first argument
      findIntersectionsSegSeg(aSeg, otherGeom, this.m_intersections);
    } else if (otherGeom instanceof LINE) {
      findIntersectionsSegLine(aSeg, otherGeom, this.m_intersections);
    } else if (otherGeom instanceof HALF_LINE) {
      findIntersectionsSegHalfLine(aSeg, otherGeom, this.m_intersections);
    } else if (otherGeom instanceof CIRCLE) {
      findIntersectionsSegCircle(aSeg, otherGeom, this.m_intersections);
    } else {
      findIntersectionsSegArc(aSeg, otherGeom, this.m_intersections);
    }
  }

  visitLine(aLine: LINE): void {
    const otherGeom = this.m_otherGeometry;

    // Dispatch in the correct order
    if (otherGeom instanceof SEG) findIntersectionsSegLine(otherGeom, aLine, this.m_intersections);
    else if (otherGeom instanceof LINE)
      findIntersectionsLineLine(otherGeom, aLine, this.m_intersections);
    else if (otherGeom instanceof CIRCLE)
      findIntersectionsCircleLine(otherGeom, aLine, this.m_intersections);
    else if (otherGeom instanceof SHAPE_ARC)
      findIntersectionsArcLine(otherGeom, aLine, this.m_intersections);
    else if (otherGeom instanceof HALF_LINE)
      findIntersectionsLineHalfLine(aLine, otherGeom, this.m_intersections);
    else {
      // Line-Rect via decomposition into segments
      for (const aRectSeg of KIGEOM_BoxToSegs(otherGeom))
        findIntersectionsSegLine(aRectSeg, aLine, this.m_intersections);
    }
  }

  visitHalfLine(aHalfLine: HALF_LINE): void {
    const otherGeom = this.m_otherGeometry;

    // Dispatch in the correct order
    if (otherGeom instanceof SEG)
      findIntersectionsSegHalfLine(otherGeom, aHalfLine, this.m_intersections);
    else if (otherGeom instanceof HALF_LINE)
      findIntersectionsHalfLineHalfLine(otherGeom, aHalfLine, this.m_intersections);
    else if (otherGeom instanceof CIRCLE)
      findIntersectionsCircleHalfLine(otherGeom, aHalfLine, this.m_intersections);
    else if (otherGeom instanceof SHAPE_ARC)
      findIntersectionsArcHalfLine(otherGeom, aHalfLine, this.m_intersections);
    else if (otherGeom instanceof LINE)
      findIntersectionsLineHalfLine(otherGeom, aHalfLine, this.m_intersections);
    else {
      // HalfLine-Rect via decomposition into segments
      for (const aRectSeg of KIGEOM_BoxToSegs(otherGeom))
        findIntersectionsSegHalfLine(aRectSeg, aHalfLine, this.m_intersections);
    }
  }

  visitCircle(aCircle: CIRCLE): void {
    const otherGeom = this.m_otherGeometry;

    // Dispatch in the correct order
    if (otherGeom instanceof SEG)
      findIntersectionsSegCircle(otherGeom, aCircle, this.m_intersections);
    else if (otherGeom instanceof CIRCLE)
      findIntersectionsCircleCircle(otherGeom, aCircle, this.m_intersections);
    else if (otherGeom instanceof SHAPE_ARC)
      findIntersectionsCircleArc(aCircle, otherGeom, this.m_intersections);
    else if (otherGeom instanceof LINE)
      findIntersectionsCircleLine(aCircle, otherGeom, this.m_intersections);
    else if (otherGeom instanceof HALF_LINE)
      findIntersectionsCircleHalfLine(aCircle, otherGeom, this.m_intersections);
    else {
      // Circle-Rect via decomposition into segments
      for (const aRectSeg of KIGEOM_BoxToSegs(otherGeom))
        findIntersectionsSegCircle(aRectSeg, aCircle, this.m_intersections);
    }
  }

  visitArc(aArc: SHAPE_ARC): void {
    const otherGeom = this.m_otherGeometry;

    // Dispatch in the correct order
    if (otherGeom instanceof SEG) findIntersectionsSegArc(otherGeom, aArc, this.m_intersections);
    else if (otherGeom instanceof CIRCLE)
      findIntersectionsCircleArc(otherGeom, aArc, this.m_intersections);
    else if (otherGeom instanceof SHAPE_ARC)
      findIntersectionsArcArc(otherGeom, aArc, this.m_intersections);
    else if (otherGeom instanceof LINE)
      findIntersectionsArcLine(aArc, otherGeom, this.m_intersections);
    else if (otherGeom instanceof HALF_LINE)
      findIntersectionsArcHalfLine(aArc, otherGeom, this.m_intersections);
    else {
      // Arc-Rect via decomposition into segments
      for (const aRectSeg of KIGEOM_BoxToSegs(otherGeom))
        findIntersectionsSegArc(aRectSeg, aArc, this.m_intersections);
    }
  }

  visitRect(aRect: BOX2I): void {
    // Defer to the SEG visitor repeatedly
    // Note - in some cases, points can be repeated in the intersection list
    // if that's an issue, both directions of the visitor can be implemented
    // to take care of that.
    const segs = KIGEOM_BoxToSegs(aRect);

    for (const seg of segs) this.visitSeg(seg);
  }
}
