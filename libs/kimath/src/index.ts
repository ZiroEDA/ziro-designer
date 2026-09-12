// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** @ziroeda/kimath, math foundations ported from KiCad's libs/kimath. */
export * from './math/vector2.js';
export * from './math/util.js';
export * from './math/box2.js';
export * from './geometry/eda_angle.js';
export * from './geometry/convex_hull.js';
export * from './geometry/seg.js';
export * from './convert_basic_shapes_to_polygon.js';
export * from './bezier_curves.js';
export * from './trigo.js';
export * from './mmh3_hash.js';

export {
  arcTangentToSegments,
  chamferLinePair,
  extendLinePair,
  filletLinePair,
  sharedEndpoint,
  otherEnd,
  lineProject,
  pointOnSegment,
  segmentsIntersect,
  ARC_MIN_PRECISION_IU,
  EXTENSION_PADDING_IU,
  type ArcPoints,
  type ChamferResult,
  type ExtensionResult,
  type FilletResult,
} from './geometry/corner_operations.js';

export {
  booleanOp,
  booleanAdd,
  booleanSubtract,
  booleanIntersection,
  BooleanOp,
} from './geometry/shape_poly_set_algorithms.js';

// The SHAPE family. Named exports rather than `export *` so that adding a
// member can never silently collide with a name already in the barrel.
export { BOX2I_MINMAX } from './math/box2_minmax.js';
export { CIRCLE } from './geometry/circle.js';
export {
  SHAPE,
  SHAPE_BASE,
  SHAPE_LINE_CHAIN_BASE,
  SHAPE_TYPE,
  SHAPE_TYPE_asString,
  type OutInt,
} from './geometry/shape.js';
export { SHAPE_NULL } from './geometry/shape_null.js';
export { SHAPE_SEGMENT } from './geometry/shape_segment.js';
export { SHAPE_CIRCLE } from './geometry/shape_circle.js';
export { SHAPE_RECT } from './geometry/shape_rect.js';
export { ROUNDRECT } from './geometry/roundrect.js';
export { SHAPE_SIMPLE } from './geometry/shape_simple.js';
export { SHAPE_COMPOUND } from './geometry/shape_compound.js';
export { SHAPE_ARC } from './geometry/shape_arc.js';
export {
  CLIPPER_Z_VALUE,
  INTERSECTION,
  SHAPE_LINE_CHAIN,
  type SHAPE_PAIR,
} from './geometry/shape_line_chain.js';
export {
  CornerMode,
  CornerStrategy,
  ITERATOR,
  type POLYGON,
  SEGMENT_ITERATOR,
  SHAPE_POLY_SET,
  TRI,
  TRIANGULATED_POLYGON,
  VERTEX_INDEX,
  TransformArcToPolygon,
  TransformCircleToPolygon,
  TransformOvalToPolygon,
  TransformRingToPolygon,
  TransformRoundChamferedRectToPolygon,
  TransformTrapezoidToPolygon,
} from './geometry/shape_poly_set.js';

export { Vertex, VertexSet, type Box2 } from './geometry/vertex_set.js';

// `CIRCLE`. Named exports rather than `export *` so that adding a member here
// can never silently collide with a name already in the barrel.
export {
  circleIntersectLine,
  circleNearestPoint,
  constructFromTanTanPt,
  type Circle,
} from './geometry/circle.js';
