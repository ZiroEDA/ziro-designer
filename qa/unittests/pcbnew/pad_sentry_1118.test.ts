// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * Two footprint-editor crashes Sentry caught on 11-18, from one user's session in Pad Properties.
 *
 * JAVASCRIPT-REACT-21: OK on a 0 x 0 trapezoid pad with a hole. doCheckPad reports "(Pad must have
 * a positive size)" and, as upstream does, goes on to build the copper outline; four corners at
 * one point leave CornerListRemoveDuplicates an empty list, and cornerListToPolygon read [0] of it.
 *
 * JAVASCRIPT-REACT-20: the message panel for a pad whose parent is not a footprint - upstream
 * static_casts m_parent, which is always a FOOTPRINT there - threw on GetOrientation.
 */
import { describe, expect, it } from 'vitest';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { UNITS_PROVIDER } from '@ziroeda/common/units_provider.js';
import type { MSG_PANEL_ITEM } from '@ziroeda/common/widgets/msgpanel.js';
import { ANGLE_0 } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { ERROR_LOC } from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import {
  SHAPE_POLY_SET,
  TransformTrapezoidToPolygon,
} from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { BOARD } from '@ziroeda/pcbnew/board.js';
import { PAD, PAD_SHAPE } from '@ziroeda/pcbnew/pad.js';
import { TEST_PCB_FRAME } from './support/test_pcb_frame.js';

const units = new UNITS_PROVIDER(pcbIUScale, 'mm');

describe('a 0 x 0 trapezoid', () => {
  it('has no outline rather than a throw', () => {
    const buf = new SHAPE_POLY_SET();
    expect(() =>
      TransformTrapezoidToPolygon(
        buf,
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        ANGLE_0,
        0,
        0,
        0,
        5000,
        ERROR_LOC.ERROR_INSIDE,
      ),
    ).not.toThrow();
  });

  it("Pad Properties' check says the size is wrong, and does not throw", () => {
    const p = new PAD(new BOARD());
    p.SetShape(PCB_LAYER_ID.F_Cu, PAD_SHAPE.TRAPEZOID);
    p.SetSize(PCB_LAYER_ID.F_Cu, { x: 0, y: 0 });
    p.SetDrillSize({ x: 300000, y: 300000 }); // a hole: the outline is built only for one
    const errors: string[] = [];
    expect(() => p.CheckPad(units, true, (_code, msg) => errors.push(msg))).not.toThrow();
    expect(errors).toContain('(Pad must have a positive size)');
  });
});

describe("a pad's message panel", () => {
  it('shows a pad whose parent is a board, not a footprint, without throwing', () => {
    const board = new BOARD();
    const p = new PAD(board);
    p.SetSize(PCB_LAYER_ID.F_Cu, { x: 1000000, y: 1000000 });
    const frame = new TEST_PCB_FRAME(board);
    const list: MSG_PANEL_ITEM[] = [];
    expect(() => p.GetMsgPanelInfo(frame.AsDrawFrameLike(), list)).not.toThrow();
    expect(list.length).toBeGreaterThan(0);
  });
});
