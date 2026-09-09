// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PADSTACK defaults that more than one caller needs. Counterpart:
 * `pcbnew/padstack.cpp`.
 */

import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
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

/**
 * `PAD::ShapePos( aLayer )` (pad.cpp) — where the pad's COPPER sits.
 *
 *     if( GetOffset( aLayer ) == VECTOR2I( 0, 0 ) ) return m_pos;
 *     VECTOR2I loc_offset = GetOffset( aLayer );
 *     RotatePoint( loc_offset, GetOrientation() );
 *     return m_pos + loc_offset;
 *
 * A pad's `(at …)` is the position of its **hole**; `(drill … (offset x y))`
 * moves the copper away from it, not the hole away from the copper. This tree
 * had it the other way round — the hole was drawn and knocked out at
 * `at + offset` while the copper stayed on `at` — which is the same *relative*
 * geometry but the wrong absolute one, so every offset pad's copper, its
 * thermal relief and its spokes sat one offset away from where KiCad puts them.
 * On the `complex_hierarchy` demo that is every TO-92: 0.4 mm of drift on 20
 * transistor pads, and 12 mm² of the pour in the wrong place.
 *
 * The hole itself stays on `pad.at`: `GetEffectiveHoleShape` builds its
 * `SHAPE_SEGMENT` from `m_pos`, never from `ShapePos`.
 */
export function padShapePos(pad: { at: Vec2; angle: number; drill?: { offset?: Vec2 } }): Vec2 {
  const o = pad.drill?.offset;
  if (!o || (o.x === 0 && o.y === 0)) return pad.at;

  // `RotatePoint( VECTOR2I&, const EDA_ANGLE& )` in board coordinates, whose y
  // grows downwards: (0, 0.4) at 90° comes back as (0.4, 0), which is what
  // KiCad's own `ShapePos` answers for U101 on complex_hierarchy.
  const rad = (pad.angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: pad.at.x + o.x * cos + o.y * sin, y: pad.at.y - o.x * sin + o.y * cos };
}
