// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PADSTACK defaults that more than one caller needs. Counterpart:
 * `pcbnew/padstack.cpp`.
 */

import type { PadShape } from './types.js';

/**
 * `PADSTACK::DefaultThermalSpokeAngleForShape`, as the s-expression parser
 * resolves it (`pcb_io_kicad_sexpr_parser.cpp:6442-6469`), in DEGREES.
 *
 * "45° will produce an X (the default for circular pads and circular-anchored
 * custom shaped pads), while 90° will produce a + (the default for all other
 * shapes)."
 *
 * The parser's rule is the one a loaded board uses, and it is not quite
 * `DefaultThermalSpokeAngleForShape`: that function returns 45° for a trapezoid
 * while the parser writes 90°, because it asks whether the shape is a circle
 * rather than whether it is a rectangle. A file always goes through the parser,
 * so the parser wins.
 *
 * `aFileVersion` matters for one case only: a custom pad on a circular anchor
 * took a `+` in 6.0 and an `X` after it.
 */
export function defaultThermalSpokeAngle(
  shape: PadShape,
  anchorShape: PadShape | undefined,
  fileVersion = Number.POSITIVE_INFINITY,
): number {
  if (shape === 'circle') return 45;
  if (shape === 'custom' && (anchorShape ?? 'circle') === 'circle')
    return fileVersion <= 20211014 ? 90 : 45;
  return 90;
}
