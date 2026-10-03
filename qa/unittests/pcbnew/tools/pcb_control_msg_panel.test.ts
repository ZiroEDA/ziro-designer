// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PCB_CONTROL::UpdateMessagePanel (pcbnew/tools/pcb_control.cpp:2378-2884),
 * run by the selection tool's events: the board for none, the item for one,
 * a pair's description and clearance for two, and the counts, length and
 * area for any selection.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { MSG_PANEL_ITEM } from '@ziroeda/common/widgets/msgpanel.js';
import { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { BOARD_ITEM } from '@ziroeda/pcbnew/board_item.js';
import type { PCB_TRACK } from '@ziroeda/pcbnew/pcb_track.js';
import { PCB_CONTROL } from '@ziroeda/pcbnew/tools/pcb_control.js';
import { PCB_SELECTION_TOOL } from '@ziroeda/pcbnew/tools/pcb_selection_tool.js';
import { type TOOL_HARNESS, toolHarness } from '../support/pcb_tool_harness.js';
import { TEST_PCB_FRAME } from '../support/test_pcb_frame.js';

const BOARD_TEXT = `(kicad_pcb (version 20241229) (generator "pcbnew") (generator_version "9.0")
  (general (thickness 1.6) (legacy_teardrops no))
  (paper "A4")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (5 "F.SilkS" user) (25 "Edge.Cuts" user))
  (setup (pad_to_mask_clearance 0))
  (net 0 "")
  (segment (start 0 0) (end 5 0) (width 0.25) (layer "F.Cu") (net 0))
  (segment (start 0 2) (end 3 2) (width 0.25) (layer "F.Cu") (net 0))
  (via (at 10 3) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 0))
  (gr_line (start 0 12) (end 4 12) (stroke (width 0.1) (type solid)) (layer "F.SilkS"))
)
`;

let h: TOOL_HARNESS<TEST_PCB_FRAME>;
let sel: PCB_SELECTION_TOOL;

beforeEach(() => {
  sel = new PCB_SELECTION_TOOL();
  h = toolHarness(
    BOARD_TEXT,
    (aBoard) => new TEST_PCB_FRAME(aBoard),
    () => [sel, new PCB_CONTROL()],
  );
  h.mgr.ResetTools(RESET_REASON.MODEL_RELOAD);
  h.frame.SetUserUnits('mm');
});

const panel = (): [string, string][] =>
  h.frame.GetMsgPanelItems().map((i: MSG_PANEL_ITEM) => [i.GetUpperText(), i.GetLowerText()]);
const ofType = (t: KICAD_T): BOARD_ITEM[] =>
  [...h.board.Tracks(), ...h.board.Drawings()].filter((i) => i.Type() === t);
const select = (...aItems: BOARD_ITEM[]): void => {
  for (const item of aItems) sel.AddItemToSel(item, false);
};

describe('PCB_CONTROL::UpdateMessagePanel', () => {
  it('with nothing selected shows the board', () => {
    select(ofType(KICAD_T.PCB_VIA_T)[0]!);
    // ClearSelection posts EVENTS::ClearedEvent.
    sel.ClearSelection();

    const items: MSG_PANEL_ITEM[] = [];
    h.board.GetMsgPanelInfo(h.frame.AsDrawFrameLike(), items);
    expect(panel()).toEqual(items.map((i) => [i.GetUpperText(), i.GetLowerText()]));
  });

  it('with one item shows the item', () => {
    const via = ofType(KICAD_T.PCB_VIA_T)[0]!;
    select(via);

    const items: MSG_PANEL_ITEM[] = [];
    via.GetMsgPanelInfo(h.frame.AsDrawFrameLike(), items);
    expect(panel()).toEqual(items.map((i) => [i.GetUpperText(), i.GetLowerText()]));
  });

  it('with a pair shows both descriptions and the actual clearance', () => {
    const [a, b] = ofType(KICAD_T.PCB_TRACE_T) as [PCB_TRACK, PCB_TRACK];
    select(a, b);

    const rows = panel();
    expect(rows[0]).toEqual([
      a.GetItemDescription(h.frame.GetUnitsProvider(), false),
      b.GetItemDescription(h.frame.GetUnitsProvider(), false),
    ]);
    // Same net: no resolved clearance, but the gap between the two: 2 mm
    // between centrelines, less the two half-widths.
    expect(rows.find((r) => r[0] === 'Resolved Clearance')).toBeUndefined();
    expect(rows.find((r) => r[0] === 'Actual Clearance')?.[1]).toBe('1.7500 mm');
    // 5 + 3 mm of track.
    expect(rows.find((r) => r[0] === 'Selected 2D Length')?.[1]).toBe('8.0000 mm');
    expect(rows.find((r) => r[0] === 'Selected 2D Copper Area')).toBeDefined();
  });

  it('a mixed selection is counted by type, in KICAD_T order', () => {
    const via = ofType(KICAD_T.PCB_VIA_T)[0]!;
    const line = ofType(KICAD_T.PCB_SHAPE_T)[0]!;
    const track = ofType(KICAD_T.PCB_TRACE_T)[0]!;
    select(via, line, track);

    const rows = panel();
    const order = [line, track, via]
      .sort((x, y) => x.Type() - y.Type())
      .map((i) => `${i.GetFriendlyName()}: 1`)
      .join(', ');
    expect(rows[0]).toEqual(['Selected Items', `3 (${order})`]);
    // 5 mm of track, a via's zero, 4 mm of line.
    expect(rows.find((r) => r[0] === 'Selected 2D Length')?.[1]).toBe('9.0000 mm');
    // Silk and copper together.
    expect(rows.find((r) => r[0] === 'Selected 2D Total Area')).toBeDefined();
  });
});
