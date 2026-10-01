// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `libs/kimath/src/geometry/vector_utils.cpp`: the grid-rounding half
 * (`KIGEOM::RoundGrid`, `RoundNW`, `RoundSE`). The C++ templates divide ints,
 * which truncates toward zero; `Math.trunc` is that division.
 */
import type { Vec2 as VECTOR2I } from '../math/vector2.js';

const idiv = (a: number, b: number): number => Math.trunc(a / b);

function RoundNearest(x: number, g: number): number {
  return idiv(x + (x < 0 ? -idiv(g, 2) : idiv(g, 2)), g) * g;
}

function RoundDown(x: number, g: number): number {
  return idiv(x < 0 ? x - g + 1 : x, g) * g;
}

function RoundUp(x: number, g: number): number {
  return idiv(x < 0 ? x : x + g - 1, g) * g;
}

/** Round a vector to the nearest grid point in any direction. */
export function KIGEOM_RoundGrid(aVec: VECTOR2I, aGridSize: number): VECTOR2I {
  return { x: RoundNearest(aVec.x, aGridSize), y: RoundNearest(aVec.y, aGridSize) };
}

/** Round a vector to the nearest grid point in the NW direction (towards -x, -y). */
export function KIGEOM_RoundNW(aVec: VECTOR2I, aGridSize: number): VECTOR2I {
  return { x: RoundDown(aVec.x, aGridSize), y: RoundDown(aVec.y, aGridSize) };
}

/** Round a vector to the nearest grid point in the SE direction (towards +x, +y). */
export function KIGEOM_RoundSE(aVec: VECTOR2I, aGridSize: number): VECTOR2I {
  return { x: RoundUp(aVec.x, aGridSize), y: RoundUp(aVec.y, aGridSize) };
}
