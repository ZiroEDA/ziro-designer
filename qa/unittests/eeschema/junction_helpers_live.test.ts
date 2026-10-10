// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `JUNCTION_HELPERS::AnalyzePoint` on the live model (junction_helpers.cpp, 10.0.6), through
 * `SCH_SCREEN::IsExplicitJunctionNeeded`, for the two cases 10.0.6 added:
 *
 * - `keepStubJunction`: wire ENDS leaving a point in three or more directions are a junction
 *   even when they pair into two collinear lines. The collinear merge would otherwise turn
 *   a four-stub cross into two lines crossing mid-segment, which is not a junction. The
 *   EasyEDA Pro and LTspice importers draw crosses that way, and FixupJunctionsAfterImport
 *   missed every one of them.
 * - `hasBusEntryToMultipleBuses`: a bus entry at a real bus fork (three bus directions, one
 *   bus ending there) allows the dot; at a plain bus crossing it does not.
 */
import { describe, expect, it } from 'vitest';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { SCH_BUS_WIRE_ENTRY } from '@ziroeda/eeschema/sch_bus_entry.js';
import { SCH_LINE } from '@ziroeda/eeschema/sch_line.js';
import { SCH_SCREEN } from '@ziroeda/eeschema/sch_screen.js';

const P: VECTOR2I = { x: 1_000_000, y: 1_000_000 };
const at = (dx: number, dy: number): VECTOR2I => ({ x: P.x + dx, y: P.y + dy });

function line(aScreen: SCH_SCREEN, a: VECTOR2I, b: VECTOR2I, aLayer = SCH_LAYER_ID.LAYER_WIRE) {
  const l = new SCH_LINE(a, aLayer);
  l.SetEndPoint(b);
  aScreen.Append(l);
}

describe('AnalyzePoint (live), 10.0.6', () => {
  it('four wire stubs meeting at a point need a junction', () => {
    const screen = new SCH_SCREEN();
    line(screen, P, at(-38100, 0));
    line(screen, P, at(25400, 0));
    line(screen, P, at(0, -25400));
    line(screen, P, at(0, 25400));

    expect(screen.IsExplicitJunctionNeeded(P)).toBe(true);
  });

  it('two wires crossing mid-segment do not', () => {
    const screen = new SCH_SCREEN();
    line(screen, at(-38100, 0), at(25400, 0));
    line(screen, at(0, -25400), at(0, 25400));

    expect(screen.IsExplicitJunctionNeeded(P)).toBe(false);
  });

  it('a wire passing straight through a joint of two stubs is no junction', () => {
    // Two stubs end at P, collinear: one exit direction each way, and nothing else.
    const screen = new SCH_SCREEN();
    line(screen, P, at(-25400, 0));
    line(screen, P, at(25400, 0));

    expect(screen.IsExplicitJunctionNeeded(P)).toBe(false);
  });

  it('a bus entry at a bus fork allows the dot', () => {
    const screen = new SCH_SCREEN();
    // A bus ends at P from the left; another passes P vertically: three bus directions.
    line(screen, at(-50800, 0), P, SCH_LAYER_ID.LAYER_BUS);
    line(screen, at(0, -50800), at(0, 50800), SCH_LAYER_ID.LAYER_BUS);
    screen.Append(new SCH_BUS_WIRE_ENTRY(P));

    expect(screen.IsExplicitJunctionNeeded(P)).toBe(true);
  });

  it('a bus entry where two buses only cross does not', () => {
    const screen = new SCH_SCREEN();
    line(screen, at(-50800, 0), at(50800, 0), SCH_LAYER_ID.LAYER_BUS);
    line(screen, at(0, -50800), at(0, 50800), SCH_LAYER_ID.LAYER_BUS);
    screen.Append(new SCH_BUS_WIRE_ENTRY(P));

    expect(screen.IsExplicitJunctionNeeded(P)).toBe(false);
  });
});
