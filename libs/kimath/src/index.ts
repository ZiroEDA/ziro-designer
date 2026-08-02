// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** @ziroeda/kimath, math foundations ported from KiCad's libs/kimath. */
export * from './math/vector2.js';
export * from './math/util.js';
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
} from './geometry/shape_poly_set.js';
