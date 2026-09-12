// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The bare-ring form of `SHAPE_POLY_SET`, kept only as delegates while its
 * callers move onto the class in `shape_poly_set.ts`. A `Polygon` here is an
 * outline followed by its holes, the same shape `SHAPE_POLY_SET::POLYGON`
 * has, each contour a plain point list. Every function converts to a
 * `SHAPE_POLY_SET`, runs the one implementation there, and converts back.
 *
 * @deprecated Build a `SHAPE_POLY_SET` and call its methods.
 */

import type { Vec2 } from '../math/vector2.js';
import { KiROUND } from '../math/util.js';
import { SHAPE_LINE_CHAIN } from './shape_line_chain.js';
import { CornerMode, CornerStrategy, SHAPE_POLY_SET } from './shape_poly_set.js';

export { CornerMode, CornerStrategy };

/** An outline followed by its holes, KiCad's SHAPE_POLY_SET::POLYGON. */
export type Polygon = Vec2[][];

/** A ring as a closed `SHAPE_LINE_CHAIN`; a caller may still hold a fraction, a VECTOR2I is KiROUND. */
const ringToChain = (ring: readonly Vec2[]): SHAPE_LINE_CHAIN =>
  new SHAPE_LINE_CHAIN(
    ring.map((p) => ({ x: KiROUND(p.x), y: KiROUND(p.y) })),
    true,
  );

/** Rings into a set: the first contour of each polygon its outline, the rest holes. */
export function polygonsToSet(polygons: readonly Polygon[]): SHAPE_POLY_SET {
  const set = new SHAPE_POLY_SET();
  for (const poly of polygons) {
    poly.forEach((ring, i) => {
      if (i === 0) set.AddOutline(ringToChain(ring));
      else set.AddHole(ringToChain(ring));
    });
  }
  return set;
}

/** A set back into rings. */
export function setToPolygons(set: SHAPE_POLY_SET): Polygon[] {
  return set
    .CPolygons()
    .map((poly) => poly.map((c) => c.CPoints().map((p) => ({ x: p.x, y: p.y }))));
}

/** @deprecated `SHAPE_POLY_SET::Fracture( false )` on one polygon. */
export function fractureSingle(paths: Polygon): Polygon {
  const set = polygonsToSet([paths]);
  set.Fracture(false);
  return set.OutlineCount() ? setToPolygons(set)[0]! : [];
}

/** @deprecated `SHAPE_POLY_SET::Unfracture()`. */
export function unfracture(polygons: Polygon[]): Polygon[] {
  const set = polygonsToSet(polygons);
  set.Unfracture();
  return setToPolygons(set);
}

/** @deprecated `SHAPE_POLY_SET::InflateWithLinkedHoles`. */
export function inflateWithLinkedHoles(
  polygons: Polygon[],
  amount: number,
  strategy: CornerStrategy,
  circleSegCount: number,
): Vec2[][] {
  return fracture(inflate(unfracture(polygons), amount, strategy, circleSegCount));
}

/** @deprecated `SHAPE_LINE_CHAIN::PointInside( pt )` on a closed ring. */
export function chainPointInside(ring: readonly Vec2[], pt: Vec2): boolean {
  return ringToChain(ring).PointInside(pt);
}

/** @deprecated `SHAPE_POLY_SET::Simplify()`. */
export const simplify = (polygons: Polygon[]): Polygon[] => {
  const set = polygonsToSet(polygons);
  set.Simplify();
  return setToPolygons(set);
};

/** @deprecated `SHAPE_POLY_SET::Fracture()`: every polygon one simple ring. */
export function fracture(polygons: Polygon[]): Vec2[][] {
  const set = polygonsToSet(polygons);
  set.Fracture();
  return setToPolygons(set).map((poly) => poly[0]!);
}

/** @deprecated `SHAPE_POLY_SET::Fracture( false )`. */
export function fractureNoSimplify(polygons: Polygon[]): Vec2[][] {
  const set = polygonsToSet(polygons);
  set.Fracture(false);
  return setToPolygons(set).map((poly) => poly[0]!);
}

/**
 * @deprecated `SHAPE_POLY_SET::inflate2( aAmount, aCircleSegCount, aCornerStrategy, aSimplify )`.
 */
export function inflate(
  polygons: Polygon[],
  amount: number,
  strategy: CornerStrategy = CornerStrategy.ROUND_ALL_CORNERS,
  circleSegCount = 16,
  simplify = false,
): Polygon[] {
  const set = polygonsToSet(polygons);
  set.inflate2(amount, circleSegCount, strategy, simplify);
  return setToPolygons(set);
}

/** `SHAPE_POLY_SET`'s three boolean operations. */
export enum BooleanOp {
  ADD = 0,
  SUBTRACT = 1,
  INTERSECT = 2,
}

/** @deprecated `SHAPE_POLY_SET::BooleanAdd/Subtract/Intersection( a, b )`. */
export function booleanOp(subject: Polygon[], clip: Polygon[], op: BooleanOp): Polygon[] {
  const a = polygonsToSet(subject);
  const b = polygonsToSet(clip);
  const set = new SHAPE_POLY_SET();
  if (op === BooleanOp.ADD) set.BooleanAdd(a, b);
  else if (op === BooleanOp.SUBTRACT) set.BooleanSubtract(a, b);
  else set.BooleanIntersection(a, b);
  return setToPolygons(set);
}

/** @deprecated `SHAPE_POLY_SET::BooleanAdd`. */
export const booleanAdd = (a: Polygon[], b: Polygon[]): Polygon[] => booleanOp(a, b, BooleanOp.ADD);

/** @deprecated `SHAPE_POLY_SET::BooleanSubtract`. */
export const booleanSubtract = (a: Polygon[], b: Polygon[]): Polygon[] =>
  booleanOp(a, b, BooleanOp.SUBTRACT);

/** @deprecated `SHAPE_POLY_SET::BooleanIntersection`. */
export const booleanIntersection = (a: Polygon[], b: Polygon[]): Polygon[] =>
  booleanOp(a, b, BooleanOp.INTERSECT);

/** @deprecated `SHAPE_POLY_SET::chamferFilletPolygon` on one polygon. */
export function chamferFilletPolygon(
  aPoly: Polygon,
  mode: CornerMode,
  distance: number,
  errorMax = 0,
): Polygon {
  const set = polygonsToSet([aPoly]);
  const out =
    mode === CornerMode.CHAMFERED
      ? set.ChamferPolygon(distance, 0)
      : set.FilletPolygon(distance, errorMax, 0);
  return out.map((c) => c.CPoints().map((p) => ({ x: p.x, y: p.y })));
}

/** @deprecated `SHAPE_POLY_SET::Chamfer`. */
export const chamfer = (polygons: Polygon[], distance: number): Polygon[] =>
  setToPolygons(polygonsToSet(polygons).Chamfer(distance));

/** @deprecated `SHAPE_POLY_SET::Fillet`. */
export const fillet = (polygons: Polygon[], radius: number, errorMax: number): Polygon[] =>
  setToPolygons(polygonsToSet(polygons).Fillet(radius, errorMax));

/** @deprecated `SHAPE_POLY_SET::BuildPolysetFromOrientedPaths`. */
export function buildPolysetFromOrientedPaths(paths: Vec2[][], evenOdd: boolean): Polygon[] {
  const set = new SHAPE_POLY_SET();
  set.BuildPolysetFromOrientedPaths(paths.map(ringToChain), evenOdd);
  return setToPolygons(set);
}
