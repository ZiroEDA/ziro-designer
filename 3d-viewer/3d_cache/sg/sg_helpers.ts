// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** `3d-viewer/3d_cache/sg/sg_helpers.{h,cpp}`: the VRML number formats. */
import { formatG } from '@ziroeda/common/plotters/fmt.js';
import type { SGPOINT, SGVECTOR } from './sg_base.js';

/**
 * `S3D::FormatFloat`: `std::setprecision( 8 ) << value` (C's %.8g), trailing zeros of the
 * fraction trimmed, and anything within 1e-8 of zero written as "0".
 */
export function FormatFloat(value: number): string {
  if (value < 1e-8 && value > -1e-8) return '0';

  // note: many VRML implementations use float so we use the max.
  // precision here of 8 digits.
  let result = formatG(value, 8);

  // trim trailing 0 if appropriate
  if (!result.includes('.')) return result;

  const p = result.search(/[eE]/);

  if (p < 0) return result.replace(/0+$/, '');

  if (result[p - 1] !== '0') return result;

  // trim all 0 to the left of 'p'
  return result.substring(0, p).replace(/0+$/, '') + result.substring(p);
}

export function FormatOrientation(axis: SGVECTOR, rotation: number): string {
  const [aX, aY, aZ] = axis.GetVector();
  return `${FormatFloat(aX)} ${FormatFloat(aY)} ${FormatFloat(aZ)} ${FormatFloat(rotation)}`;
}

export function FormatPoint(point: SGPOINT): string {
  return `${FormatFloat(point.x)} ${FormatFloat(point.y)} ${FormatFloat(point.z)}`;
}

export function FormatVector(aVector: SGVECTOR): string {
  const [X, Y, Z] = aVector.GetVector();
  return `${FormatFloat(X)} ${FormatFloat(Y)} ${FormatFloat(Z)}`;
}

/** `S3D::degenerate`: two of the three points (nearly) coincide. */
export function degenerate(pts: readonly [number, number, number][]): boolean {
  const d2 = (a: [number, number, number], b: [number, number, number]): number => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = b[2] - a[2];
    return dx * dx + dy * dy + dz * dz;
  };

  if (d2(pts[0]!, pts[1]!) < 1e-15) return true;

  if (d2(pts[0]!, pts[2]!) < 1e-15) return true;

  if (d2(pts[1]!, pts[2]!) < 1e-15) return true;

  return false;
}
