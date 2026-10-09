// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PCB_EDIT_FRAME::OnEditItemRequest (edit.cpp:99): the item's type picks its
 * properties dialog, which opens on the live item.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { installPgm } from '@ziroeda/designer/src/editors/pcb/pcb_canvas.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import type { BOARD_ITEM } from '@ziroeda/pcbnew/board_item.js';
import { PCB_EDIT_FRAME, type PCB_EDIT_FRAME_HOOKS } from '@ziroeda/pcbnew/pcb_edit_frame.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { PCBNEW_SETTINGS } from '@ziroeda/pcbnew/pcbnew_settings.js';

const BOARD_TEXT = `(kicad_pcb (version 20241229) (generator "pcbnew") (generator_version "9.0")
  (general (thickness 1.6) (legacy_teardrops no)) (paper "A4")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (5 "F.SilkS" user "F.Silkscreen") (25 "Edge.Cuts" user))
  (setup (pad_to_mask_clearance 0))
  (net 0 "") (net 1 "N1")
  (footprint "R" (layer "F.Cu") (at 10 10) (uuid "00000000-0000-4000-8000-000000000001")
    (property "Reference" "R1" (at 0 -2 0) (layer "F.SilkS") (uuid "00000000-0000-4000-8000-000000000002")
      (effects (font (size 1 1) (thickness 0.15))))
    (pad "1" smd rect (at -1 0) (size 1 1) (layers "F.Cu") (net 1 "N1") (uuid "00000000-0000-4000-8000-000000000003")))
  (gr_line (start 0 0) (end 5 0) (stroke (width 0.1) (type solid)) (layer "F.SilkS") (uuid "00000000-0000-4000-8000-000000000004"))
  (gr_text "T" (at 20 20 0) (layer "F.SilkS") (uuid "00000000-0000-4000-8000-000000000005")
    (effects (font (size 1 1) (thickness 0.15))))
  (dimension (type aligned) (layer "F.SilkS") (uuid "00000000-0000-4000-8000-000000000006")
    (pts (xy 0 30) (xy 10 30)) (height 2)
    (gr_text "10" (at 5 28 0) (layer "F.SilkS") (uuid "00000000-0000-4000-8000-000000000007")
      (effects (font (size 1 1) (thickness 0.15))))
    (format (units 2) (units_format 1) (precision 4)) (style (thickness 0.1) (arrow_length 1.27) (text_position_mode 0) (extension_height 0.58) (extension_offset 0.5)))
  (zone (net 1) (net_name "N1") (layer "F.Cu") (uuid "00000000-0000-4000-8000-000000000008") (hatch edge 0.5)
    (connect_pads (clearance 0.5)) (min_thickness 0.25) (fill yes (thermal_gap 0.5) (thermal_bridge_width 0.5))
    (polygon (pts (xy 0 40) (xy 10 40) (xy 10 50) (xy 0 50))))
)`;

let board: BOARD;
let frame: PCB_EDIT_FRAME;
let opened: [string, unknown][];

beforeEach(() => {
  installPgm();
  const settings = new PCBNEW_SETTINGS();
  opened = [];
  const note =
    (aName: string) =>
    (aArg: unknown): Promise<boolean> => {
      opened.push([aName, aArg]);
      return Promise.resolve(false);
    };
  frame = new PCB_EDIT_FRAME({
    settings: () => settings,
    onModify: () => {},
    editZoneParams: note('zone'),
    showPadPropertiesDialog: note('pad'),
    showFootprintPropertiesDialog: note('footprint'),
    showDimensionPropertiesDialog: note('dimension'),
    showGraphicItemPropertiesDialog: note('shape'),
    showTextPropertiesDialog: note('text'),
  } as unknown as PCB_EDIT_FRAME_HOOKS);
  board = ParseBoard(BOARD_TEXT);
  frame.SetBoard(board, false);
});

const of = (t: KICAD_T): BOARD_ITEM => {
  let found: BOARD_ITEM | null = null;
  const visit = (i: BOARD_ITEM): void => {
    if (!found && i.Type() === t) found = i;
  };
  for (const fp of board.Footprints()) {
    visit(fp);
    for (const p of fp.Pads()) visit(p);
  }
  for (const d of board.Drawings()) visit(d);
  for (const z of board.Zones()) visit(z);
  return found!;
};

describe('PCB_EDIT_FRAME::OnEditItemRequest', () => {
  it.each([
    [KICAD_T.PCB_SHAPE_T, 'shape'],
    [KICAD_T.PCB_PAD_T, 'pad'],
    [KICAD_T.PCB_FOOTPRINT_T, 'footprint'],
    [KICAD_T.PCB_DIM_ALIGNED_T, 'dimension'],
    [KICAD_T.PCB_TEXT_T, 'text'],
  ])('type %s opens the %s dialog', (aType, aName) => {
    frame.OnEditItemRequest(of(aType));
    expect(opened.map(([n]) => n)).toEqual([aName]);
  });

  it('a zone goes to Edit_Zone_Params with the zone itself', () => {
    const zone = of(KICAD_T.PCB_ZONE_T);
    frame.OnEditItemRequest(zone);
    expect(opened).toEqual([['zone', zone]]);
  });

  it('the dialog it opens is on the live item', () => {
    const shape = of(KICAD_T.PCB_SHAPE_T);
    frame.OnEditItemRequest(shape);
    const dlg = opened[0]![1] as { GetShape(): number };
    expect(dlg.GetShape()).toBe((shape as unknown as { GetShape(): number }).GetShape());
  });
});
