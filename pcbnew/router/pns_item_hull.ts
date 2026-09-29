// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `ITEM::Hull( aClearance, aWalkaroundThickness, aLayer )`, dispatched on the
 * kind tag — the switch this repo uses in place of virtual dispatch (there is
 * no single upstream file for a virtual method's dispatch site; the base
 * declaration is `pns_item.h`, and every override now lives in its own item's
 * file — see `pns_utils.ts`'s own doc comment for the full reasoning and the
 * cycle this avoids). The base implementation returns an empty chain, which is
 * what a `LINE`, a `JOINT` or a diff pair gets.
 */
import { PnsKind } from './pns_item.js';
import { getRouterIface } from './pns_collision.js';
import {
  arcHull,
  buildHullForPrimitiveShape,
  octagonalHull,
  segmentHull,
  type Hull,
} from './pns_utils.js';
import type { PnsArc } from './pns_arc.js';
import type { PnsItem } from './pns_item.js';
import type { PnsSegment } from './pns_segment.js';
import type { PnsVia } from './pns_via.js';

const SQRT1_2 = Math.SQRT1_2;

/** KiCad's KiROUND: round half away from zero. */
const kiRound = (v: number): number => (v < 0 ? Math.ceil(v - 0.5) : Math.floor(v + 0.5));

/** C++ `int / int`: truncates towards zero, unlike JS `/`. */
const idiv = (a: number, b: number): number => Math.trunc(a / b);

export function itemHull(
  aItem: PnsItem,
  aClearance: number,
  aWalkaroundThickness: number,
  aLayer: number,
): Hull {
  switch (aItem.kind()) {
    case PnsKind.SEGMENT_T: {
      const seg = (aItem as PnsSegment).seg();

      return segmentHull(
        seg.a,
        seg.b,
        (aItem as PnsSegment).width(),
        aClearance,
        aWalkaroundThickness,
      );
    }

    case PnsKind.ARC_T:
      return arcHull((aItem as PnsArc).cArc(), aClearance, aWalkaroundThickness);

    case PnsKind.VIA_T: {
      const via = aItem as PnsVia;
      const cl = aClearance + idiv(aWalkaroundThickness, 2);
      const hole = via.hole();
      const iface = getRouterIface();

      // A via that is present but *not flashed* on this layer has no annular
      // ring there, so its obstacle is the hole rather than the pad. Upstream
      // reaches the router singleton for the answer; with no router running the
      // `&&` cannot short-circuit there (the call is unconditional), so a null
      // iface is a crash upstream and is treated as "flashed" here — the
      // conservative direction, giving the larger hull.
      const width =
        hole && iface && !iface.isFlashedOnLayer(via, aLayer)
          ? holeRadius(hole) * 2
          : via.diameter(aLayer);

      return octagonalHull(
        { x: via.pos().x - idiv(width, 2), y: via.pos().y - idiv(width, 2) },
        { x: width, y: width },
        cl,
        kiRound((2 * cl + width) * (1.0 - SQRT1_2)),
      );
    }

    case PnsKind.HOLE_T: {
      const shape = aItem.shape(aLayer);

      if (!shape) return [];

      // `HOLE::Hull`'s circle branch is *not* `BuildHullForPrimitiveShape`'s:
      // it truncates half the walkaround thickness where the generic builder
      // rounds it up. See the module docblock.
      if (shape.kind === 'circle') {
        const cl = aClearance + idiv(aWalkaroundThickness, 2);
        const width = shape.r * 2;

        return octagonalHull(
          { x: shape.c.x - idiv(width, 2), y: shape.c.y - idiv(width, 2) },
          { x: width, y: width },
          cl,
          kiRound((2 * cl + width) * (1.0 - SQRT1_2)),
        );
      }

      return buildHullForPrimitiveShape(shape, aClearance, aWalkaroundThickness);
    }

    case PnsKind.SOLID_T: {
      const shape = aItem.shape(aLayer);

      if (!shape) return [];

      return buildHullForPrimitiveShape(shape, aClearance, aWalkaroundThickness);
    }

    default:
      return [];
  }
}

/** A hole's radius, whatever concrete class is carrying it. */
function holeRadius(aHole: PnsItem): number {
  const withRadius = aHole as PnsItem & { radius?: () => number };

  return withRadius.radius?.() ?? 0;
}
