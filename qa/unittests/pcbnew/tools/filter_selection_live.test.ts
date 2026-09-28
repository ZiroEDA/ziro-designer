// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Filter Selection on live items: `itemIsIncludedByFilter` and
 * `PCB_SELECTION_TOOL::filterSelection` (pcb_selection_tool.cpp:3227-3311).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import type { BOARD_ITEM } from '@ziroeda/pcbnew/board_item.js';
import {
  DEFAULT_SELECTION_FILTER,
  type SelectionFilter,
} from '@ziroeda/pcbnew/dialogs/dialog_filter_selection.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import {
  filterSelectionItems,
  itemIsIncludedByFilter,
} from '@ziroeda/pcbnew/tools/pcb_selection_tool.js';

let board: BOARD;

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAGQAAAAyCAAAAACPXiFiAAAALElEQVR4nO3NMQEAAAwCIKMb3Qx7dkEB0geRSCQSiUQikUgkEolEIpFIJDcD7NPEiNYtp+MAAAAASUVORK5CYII=';

beforeEach(() => {
  board = ParseBoard(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (5 "F.SilkS" user "F.Silkscreen") (25 "Edge.Cuts" user))
  (net 0 "")
  (footprint "Lib:R" (layer "F.Cu") (uuid "90000000-0000-4000-8000-000000000001") (at 10 10)
    (property "Reference" "R1" (at 0 0 0) (layer "F.SilkS") (uuid "90000000-0000-4000-8000-000000000002"))
    (pad "1" smd rect (at 1 0) (size 1 1) (layers "F.Cu") (uuid "90000000-0000-4000-8000-000000000003")))
  (footprint "Lib:R" locked (layer "F.Cu") (uuid "90000000-0000-4000-8000-000000000004") (at 20 10)
    (property "Reference" "R2" (at 0 0 0) (layer "F.SilkS") (uuid "90000000-0000-4000-8000-000000000005")))
  (segment (start 0 0) (end 2 0) (width 0.2) (layer "F.Cu") (net 0) (uuid "90000000-0000-4000-8000-000000000011"))
  (via (at 5 5) (size 0.6) (drill 0.3) (layers "F.Cu" "B.Cu") (net 0) (uuid "90000000-0000-4000-8000-000000000012"))
  (gr_line (start 0 0) (end 0 10) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts") (uuid "90000000-0000-4000-8000-000000000013"))
  (gr_line (start 0 0) (end 10 0) (stroke (width 0.1) (type solid)) (layer "F.SilkS") (uuid "90000000-0000-4000-8000-000000000014"))
  (gr_text "hi" (at 5 5) (layer "F.SilkS") (uuid "90000000-0000-4000-8000-000000000015") (effects (font (size 1 1))))
  (image (at 30 30) (layer "F.SilkS") (uuid "90000000-0000-4000-8000-000000000016") (data "${PNG}")))`);
});

const byUuid = (u: string): BOARD_ITEM => {
  const all: BOARD_ITEM[] = [
    ...board.Footprints(),
    ...board.Footprints().flatMap((f) => [...f.Pads(), ...f.GetFields()]),
    ...board.Tracks(),
    ...board.Drawings(),
  ];
  return all.find((i) => i.m_Uuid === `90000000-0000-4000-8000-0000000000${u}`)!;
};
const only = (patch: Partial<SelectionFilter>): SelectionFilter => ({
  footprints: false,
  lockedFootprints: false,
  tracks: false,
  vias: false,
  zones: false,
  boardOutline: false,
  techLayers: false,
  text: false,
  ...patch,
});
const pass = (u: string, f: SelectionFilter) => itemIsIncludedByFilter(byUuid(u), f);

describe('itemIsIncludedByFilter', () => {
  it('footprints, and locked ones only with their box', () => {
    expect(pass('01', only({ footprints: true }))).toBe(true);
    expect(pass('04', only({ footprints: true }))).toBe(false);
    expect(pass('04', only({ footprints: true, lockedFootprints: true }))).toBe(true);
    expect(pass('04', only({ lockedFootprints: true }))).toBe(false);
  });

  it('tracks and vias each follow their own box', () => {
    expect(pass('11', only({ tracks: true }))).toBe(true);
    expect(pass('11', only({ vias: true }))).toBe(false);
    expect(pass('12', only({ vias: true }))).toBe(true);
    expect(pass('12', only({ tracks: true }))).toBe(false);
  });

  it('graphics split on Edge.Cuts', () => {
    expect(pass('13', only({ boardOutline: true }))).toBe(true);
    expect(pass('13', only({ techLayers: true }))).toBe(false);
    expect(pass('14', only({ techLayers: true }))).toBe(true);
    expect(pass('14', only({ boardOutline: true }))).toBe(false);
  });

  it('texts and fields follow the text box', () => {
    expect(pass('15', only({ text: true }))).toBe(true);
    expect(pass('02', only({ text: true }))).toBe(true);
    expect(pass('15', only({ techLayers: true }))).toBe(false);
  });

  it('drops what it has no box for: a pad, a reference image', () => {
    const all = only({
      footprints: true,
      lockedFootprints: true,
      tracks: true,
      vias: true,
      zones: true,
      boardOutline: true,
      techLayers: true,
      text: true,
    });
    expect(pass('03', all)).toBe(false);
    // The view form split an image by layer; upstream's switch has no case for it.
    expect(pass('16', all)).toBe(false);
  });
});

describe('filterSelectionItems', () => {
  it('keeps the passing items in selection order', () => {
    const items = ['14', '11', '03', '01', '04'].map(byUuid);
    expect(filterSelectionItems(items, DEFAULT_SELECTION_FILTER).map((i) => i.m_Uuid)).toEqual([
      byUuid('14').m_Uuid,
      byUuid('11').m_Uuid,
      byUuid('01').m_Uuid,
    ]);
  });
});
