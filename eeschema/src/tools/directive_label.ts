// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The netclass directive label's geometry, SCH_DIRECTIVE_LABEL::
 * CreateGraphicShape (eeschema/sch_label.cpp). The flag is a pin line from the
 * anchor plus a shape at its end: a filled dot, a circle, a diamond or a
 * rectangle. Upstream builds it pointing *up* (negative Y) and then rotates by
 * the spin style; the same points feed drawing, the bounding box and hit-testing.
 */

import type { DirectiveShape, SchDirectiveLabel, Schematic, Vec2 } from '../types.js';
import { refId } from './hittest.js';
import { spinOfAngle, type LabelSpin } from './label_properties.js';

/** m_symbolSize: SCH_DIRECTIVE_LABEL's default flag size (schIUScale, 50 mil). */
export const DIRECTIVE_SYMBOL_SIZE = 12700;

/** The shape's outline, and whether it is a circle (dot/round) or a polygon. */
export interface DirectiveGraphic {
  /** The pin line, from the anchor to the flag. */
  line: [Vec2, Vec2];
  /** Circle flags: centre and radius (dot is filled, round is not). */
  circle?: { center: Vec2; radius: number; filled: boolean };
  /** Diamond / rectangle flags: the closed outline. */
  polygon?: Vec2[];
}

/** Rotate a point about the origin by the spin style, as CreateGraphicShape does. */
function spinPoint(p: Vec2, spin: LabelSpin): Vec2 {
  switch (spin) {
    case 'up':
      return { x: p.y, y: -p.x }; // -90°
    case 'right':
      return { x: -p.x, y: -p.y }; // 180°
    case 'bottom':
      return { x: -p.y, y: p.x }; // +90°
    default:
      return p; // LEFT: unrotated
  }
}

/** The flag's drawable geometry in world space. */
export function directiveGraphic(
  label: SchDirectiveLabel,
  symbolSize = DIRECTIVE_SYMBOL_SIZE,
): DirectiveGraphic {
  const shape: DirectiveShape = label.shape ?? 'round';
  const pinLength = label.pinLength ?? 25400;
  const spin = spinOfAngle(label.angle);
  const at = label.at;
  const place = (p: Vec2): Vec2 => {
    const r = spinPoint(p, spin);
    return { x: at.x + r.x, y: at.y + r.y };
  };

  // The pin line runs from the anchor towards the flag; the shape sits at its
  // end. Upstream's local frame has +Y along the pin.
  const size = shape === 'dot' ? Math.round(symbolSize * 0.7) : symbolSize;
  const line: [Vec2, Vec2] = [place({ x: 0, y: 0 }), place({ x: 0, y: pinLength - size })];

  if (shape === 'dot' || shape === 'round') {
    return {
      line,
      circle: {
        center: place({ x: 0, y: pinLength }),
        radius: size,
        filled: shape === 'dot',
      },
    };
  }

  if (shape === 'diamond') {
    return {
      line,
      polygon: [
        place({ x: 0, y: pinLength - symbolSize }),
        place({ x: -2 * symbolSize, y: pinLength }),
        place({ x: 0, y: pinLength + symbolSize }),
        place({ x: 2 * symbolSize, y: pinLength }),
      ],
    };
  }

  // Rectangle: 80% of the symbol size, centred on the pin's end.
  const s = Math.round(symbolSize * 0.8);
  return {
    line: [place({ x: 0, y: 0 }), place({ x: 0, y: pinLength - s })],
    polygon: [
      place({ x: -2 * s, y: pinLength - s }),
      place({ x: -2 * s, y: pinLength + s }),
      place({ x: 2 * s, y: pinLength + s }),
      place({ x: 2 * s, y: pinLength - s }),
    ],
  };
}

/** The flag's bounding box (the pin line plus the shape). */
export function directiveBox(label: SchDirectiveLabel): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  const g = directiveGraphic(label);
  const pts: Vec2[] = [...g.line, ...(g.polygon ?? [])];
  if (g.circle) {
    pts.push(
      { x: g.circle.center.x - g.circle.radius, y: g.circle.center.y - g.circle.radius },
      { x: g.circle.center.x + g.circle.radius, y: g.circle.center.y + g.circle.radius },
    );
  }
  return {
    minX: Math.min(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)),
    maxX: Math.max(...pts.map((p) => p.x)),
    maxY: Math.max(...pts.map((p) => p.y)),
  };
}

/** The netclass this flag applies (its "Netclass" field), or '' when unset. */
export function directiveNetclass(label: SchDirectiveLabel): string {
  return label.fields.find((f) => f.key === 'Netclass')?.value.trim() ?? '';
}

/**
 * The netclass each flag applies, as pattern assignments on the nets they
 * touch. Upstream hangs the netclass off the connection subgraph the flag
 * attaches to (CONNECTION_GRAPH::propagateToNeighbors reads
 * SCH_DIRECTIVE_LABEL's "Netclass" field); resolving it to the net's own name
 * and feeding NET_SETTINGS' pattern list is how the net-chain feature already
 * applies chain netclasses here, and lands on the same effective class.
 */
export function directiveNetclassAssignments(
  sch: Schematic,
  netlist:
    | { netByItem: ReadonlyMap<string, number>; nets: readonly { code: number; name: string }[] }
    | null
    | undefined,
): { pattern: string; netClass: string }[] {
  if (!netlist) return [];
  const out: { pattern: string; netClass: string }[] = [];
  for (const flag of sch.directiveLabels ?? []) {
    const netClass = directiveNetclass(flag);
    if (!netClass) continue;
    for (let i = 0; i < sch.lines.length; i++) {
      const line = sch.lines[i]!;
      if (line.kind !== 'wire' && line.kind !== 'bus') continue;
      if (!onSegment(line.start, line.end, flag.at)) continue;
      const code = netlist.netByItem.get(refId('line', line.uuid, i));
      const net = code === undefined ? undefined : netlist.nets.find((n) => n.code === code);
      if (net?.name) out.push({ pattern: net.name, netClass });
    }
  }
  return out;
}

/** Is `p` on the segment a→b? */
function onSegment(a: Vec2, b: Vec2, p: Vec2): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return (
    Math.abs(dx * (p.y - a.y) - dy * (p.x - a.x)) < 1 &&
    p.x >= Math.min(a.x, b.x) &&
    p.x <= Math.max(a.x, b.x) &&
    p.y >= Math.min(a.y, b.y) &&
    p.y <= Math.max(a.y, b.y)
  );
}
