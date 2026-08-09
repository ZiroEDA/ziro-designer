// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * ERC markers are clickable. `SCH_SELECTION_TOOL` says so in one line —
 *
 *     case SCH_MARKER_T:  // Always selectable
 *
 * — and selecting one cross-probes back to the ERC dialog
 * (`SCH_INSPECTION_TOOL::CrossProbe`), while a double-click reaches the same
 * call through `SCH_EDIT_TOOL::Properties`, opening the dialog first if it is
 * closed. Ours drew markers and nothing more: they could not be picked at all.
 *
 * The geometry is `MARKER_BASE::HitTestMarker` — the bounding box for a fast
 * reject, then the arrow polygon itself, with the accuracy allowed around it:
 *
 *     bool hit = bbox.Contains( aHitPosition );
 *     if( hit )   // Fine test
 *     {
 *         SHAPE_LINE_CHAIN polygon;
 *         ShapeToPolygon( polygon );
 *         hit = polygon.PointInside( aHitPosition - m_Pos, aAccuracy );
 *     }
 */
import { describe, it, expect } from 'vitest';
import { hitTestErcMarker } from '@ziroeda/designer/src/editors/schematic/render/renderer.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';

const AT = { x: mmToIU(100), y: mmToIU(100) };
/** The marker polygon is 13 units of 0.15 mm, growing +x/+y from the anchor. */
const U = mmToIU(0.15);
const at = (dx: number, dy: number) => ({ x: AT.x + dx * U, y: AT.y + dy * U });

describe('picking an ERC marker', () => {
  it('hits inside the arrow', () => {
    // Well inside the body of the shape.
    expect(hitTestErcMarker(AT, at(4, 4))).toBe(true);
    expect(hitTestErcMarker(AT, at(2, 3))).toBe(true);
  });

  it('misses well outside it', () => {
    expect(hitTestErcMarker(AT, at(30, 30))).toBe(false);
    expect(hitTestErcMarker(AT, at(-10, -10))).toBe(false);
  });

  it('misses the empty corner inside the bounding box', () => {
    // The arrow does not fill its box — the far corner past the tip is blank,
    // which is exactly what the fine polygon test is for.
    expect(hitTestErcMarker(AT, at(12.5, 0.2))).toBe(false);
  });

  it('accepts a near miss within the accuracy, and not beyond it', () => {
    // Without the slop a small marker is unclickable when zoomed out, which is
    // why `PointInside` takes an accuracy at all.
    const outside = at(-2, -2);
    expect(hitTestErcMarker(AT, outside, 0)).toBe(false);
    expect(hitTestErcMarker(AT, outside, mmToIU(1))).toBe(true);
    expect(hitTestErcMarker(AT, outside, mmToIU(0.05))).toBe(false);
  });

  it('is anchored where the marker is drawn, growing away from the point', () => {
    // ShapeToPolygon's points are all >= 0, so the arrow hangs down-right of
    // the violation's position and the anchor itself is its first vertex.
    expect(hitTestErcMarker(AT, at(1, 1))).toBe(true);
    expect(hitTestErcMarker(AT, at(-4, -4))).toBe(false);
  });

  it('moves with the marker', () => {
    const other = { x: mmToIU(50), y: mmToIU(50) };
    expect(hitTestErcMarker(other, { x: other.x + 4 * U, y: other.y + 4 * U })).toBe(true);
    expect(hitTestErcMarker(other, at(4, 4))).toBe(false);
  });
});
