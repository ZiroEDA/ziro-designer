// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PCB_PROPERTIES_PANEL over the live BOARD (pcb_properties_panel.cpp +
 * common/widgets/properties_panel.cpp): the grid a selection gets from the
 * PROPERTY_MANAGER registrations, and an edit as one BOARD_COMMIT.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { COLOR_SETTINGS } from '@ziroeda/common/settings/color_settings.js';
import { TOOL_MANAGER } from '@ziroeda/common/tool/tool_manager.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { LeaderMode as LEADER_MODE } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import type { BOARD_ITEM_CONTAINER } from '@ziroeda/pcbnew/board_item_container.js';
import { PCB_BASE_EDIT_FRAME } from '@ziroeda/pcbnew/pcb_base_edit_frame.js';
import type { FOOTPRINT_EDITOR_SETTINGS_LIKE } from '@ziroeda/pcbnew/pcb_base_frame.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import type { PCB_VIA } from '@ziroeda/pcbnew/pcb_track.js';
import { PCBNEW_SETTINGS } from '@ziroeda/pcbnew/pcbnew_settings.js';
import {
  PCB_PROPERTIES_PANEL,
  type PCB_GRID_ROW,
} from '@ziroeda/pcbnew/widgets/pcb_properties_panel.js';

const MM = (n: number): number => pcbIUScale.mmToIU(n);

/** A PCB_EDIT_FRAME without the window. */
class TEST_FRAME extends PCB_BASE_EDIT_FRAME {
  readonly settings = new PCBNEW_SETTINGS();

  constructor(board: BOARD, type = FRAME_T.FRAME_PCB_EDITOR) {
    super(type);
    this.SetBoard(board);
    this.m_toolManager = new TOOL_MANAGER();
    this.m_toolManager.SetEnvironment(board, null, null, this.settings, this);
  }

  GetName(): string {
    return 'PcbFrame';
  }
  GetModel(): BOARD_ITEM_CONTAINER | null {
    return this.m_pcb;
  }
  GetPcbNewSettings(): PCBNEW_SETTINGS {
    return this.settings;
  }
  /** The theme, without a PGM_BASE to ask for it. */
  readonly colors = new COLOR_SETTINGS('test');
  override GetColorSettings(): COLOR_SETTINGS {
    return this.colors;
  }
  GetFootprintEditorSettings(): FOOTPRINT_EDITOR_SETTINGS_LIKE {
    return {
      m_DisplayInvertXAxis: false,
      m_DisplayInvertYAxis: false,
      m_AngleSnapMode: LEADER_MODE.DIRECT,
    };
  }
}

const BOARD_TEXT = `(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (5 "F.SilkS" user "F.Silkscreen")
    (25 "Edge.Cuts" user))
  (net 0 "")
  (net 1 "gnd")
  (net 2 "VCC")
  (net 3 "Aux")
  (segment (start 0 0) (end 10 0) (width 0.25) (layer "F.Cu") (net 1)
    (uuid "00000000-0000-4000-8000-000000000001"))
  (segment (start 0 5) (end 10 5) (width 0.5) (layer "F.Cu") (net 1)
    (uuid "00000000-0000-4000-8000-000000000002"))
  (via (at 20 20) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 2)
    (uuid "00000000-0000-4000-8000-000000000003"))
  (gr_line (start 0 30) (end 10 30) (stroke (width 0.1) (type solid)) (layer "F.SilkS")
    (uuid "00000000-0000-4000-8000-000000000004"))
  (zone (net 1) (net_name "gnd") (layer "F.Cu") (uuid "00000000-0000-4000-8000-00000000000a")
    (hatch edge 0.5) (connect_pads (clearance 0.5)) (min_thickness 0.25)
    (fill (mode hatch) (thermal_gap 0.5) (thermal_bridge_width 0.5)
      (hatch_thickness 1) (hatch_gap 1.5) (hatch_orientation 0))
    (polygon (pts (xy 100 100) (xy 110 100) (xy 110 110) (xy 100 110))))
  (footprint "R:R_0603" (layer "F.Cu") (at 50 50) (uuid "00000000-0000-4000-8000-000000000005")
    (property "Reference" "R1" (at 0 -1 0) (layer "F.SilkS") (uuid "00000000-0000-4000-8000-000000000006"))
    (property "Value" "10k" (at 0 1 0) (layer "F.SilkS") (uuid "00000000-0000-4000-8000-000000000007"))
    (property "MPN" "RC0603" (at 0 2 0) (layer "F.SilkS") (hide yes) (uuid "00000000-0000-4000-8000-000000000008"))
    (pad "1" smd rect (at -1 0) (size 1 1) (layers "F.Cu") (net 1 "gnd")
      (uuid "00000000-0000-4000-8000-000000000009")))
)`;

let board: BOARD;
let frame: TEST_FRAME;
let panel: PCB_PROPERTIES_PANEL;

const tracks = () => board.Tracks().filter((t) => t.Type() === KICAD_T.PCB_TRACE_T);
const via = () => board.Tracks().find((t) => t.Type() === KICAD_T.PCB_VIA_T) as PCB_VIA;
const fp = () => board.Footprints()[0]!;

function select(items: EDA_ITEM[]): void {
  panel.SetSelectionProvider(() => items);
  panel.UpdateData();
}

/** `name=value` per group, as the grid reads top to bottom. */
const grid = () =>
  panel.m_groups.map((g) => [g.caption, g.cells.map((c) => c.property.Name())] as const);

const cell = (name: string) =>
  panel.m_groups.flatMap((g) => g.cells).find((c) => c.property.Name() === name);

const rows = (): PCB_GRID_ROW[] =>
  panel.GridRows({
    units: 'mm',
    iuScale: pcbIUScale,
    originTransforms: frame.GetOriginTransforms(),
  });

const row = (name: string) => rows().find((r) => r.name === name)!;

beforeEach(() => {
  board = ParseBoard(BOARD_TEXT);
  frame = new TEST_FRAME(board);
  panel = new PCB_PROPERTIES_PANEL(frame);
});

describe('the caption (properties_panel.cpp:196-210)', () => {
  it('names one item by its type, counts several, and says when there is none', () => {
    select([]);
    expect(panel.m_caption).toBe('No objects selected');
    expect(panel.m_groups).toEqual([]);
    select([tracks()[0]!]);
    expect(panel.m_caption).toBe('Track');
    select(tracks());
    expect(panel.m_caption).toBe('2 objects selected');
  });
});

describe('rebuildProperties: which rows, in which groups', () => {
  it('a track shows the registered properties, groups and order', () => {
    select([tracks()[0]!]);
    expect(grid()).toEqual([
      [
        'Basic Properties',
        ['Locked', 'Layer', 'Net', 'Width', 'Start X', 'Start Y', 'End X', 'End Y'],
      ],
      ['Technical Layers', ['Soldermask', 'Soldermask Margin Override']],
    ]);
  });

  it('a mixed selection shows only the properties every type has', () => {
    select([tracks()[0]!, via()]);
    const names = grid().flatMap(([, n]) => n);
    // BOARD_CONNECTED_ITEM's, not the track's Width or the via's Diameter.
    expect(names).toContain('Net');
    expect(names).toContain('Locked');
    expect(names).not.toContain('Start X');
    expect(names).not.toContain('Diameter');
  });

  it('a property whose item choices differ across the selection is dropped', () => {
    // Error Correction's choices come from the item (SetChoicesFunc): a QR code
    // offers H, a Micro QR does not, so extractValueAndWritability refuses the
    // row for the pair (:446-452) while each alone shows it.
    const b = ParseBoard(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (5 "F.SilkS" user "F.Silkscreen"))
  (net 0 "")
  (barcode (at 0 0 0) (layer "F.SilkS") (size 8 8) (text "A") (text_height 1.5) (type qr)
    (ecc_level M) (uuid "00000000-0000-4000-8000-0000000000b1"))
  (barcode (at 20 0 0) (layer "F.SilkS") (size 8 8) (text "B") (text_height 1.5) (type microqr)
    (ecc_level M) (uuid "00000000-0000-4000-8000-0000000000b2")))`);
    board = b;
    frame = new TEST_FRAME(b);
    panel = new PCB_PROPERTIES_PANEL(frame);
    const [qr, micro] = b.Drawings();
    select([qr!]);
    expect(row('Error Correction').choices).toContain('H (High)');
    select([micro!]);
    expect(row('Error Correction').choices).not.toContain('H (High)');
    select([qr!, micro!]);
    expect(grid().flatMap(([, n]) => n)).not.toContain('Error Correction');
  });

  it('a property with no item choices is shared across types (Layer on a track and a line)', () => {
    // GetChoices( item ) is empty for both, so they agree; KiCad keeps the row.
    select([tracks()[0]!, board.Drawings()[0]!]);
    expect(grid().flatMap(([, n]) => n)).toContain('Layer');
  });

  it('a value the selection disagrees about is the null variant', () => {
    select(tracks());
    expect(cell('Width')!.value).toBeNull();
    expect(cell('Net')!.value).toBe(1);
  });

  it('a property the item says is read-only greys, and is not settable', () => {
    select([fp()]);
    expect(cell('Library Link')!.writeable).toBe(false);
    expect(row('Library Link').set).toBeUndefined();
    expect(row('Position X').set).toBeDefined();
  });

  it('a footprint carries a Fields group: Reference, then Value, then its own fields', () => {
    select([fp()]);
    const fields = grid().find(([c]) => c === 'Fields')![1];
    expect(fields.slice(0, 2)).toEqual(['Reference', 'Value']);
    expect(fields).toContain('MPN');
    expect(cell('MPN')!.value).toBe('RC0603');
  });
});

describe('updateLists: the live board as the choices', () => {
  it('a copper item lists copper layers only, by the board’s names', () => {
    select([tracks()[0]!]);
    expect(row('Layer').choices).toEqual(['F.Cu', 'B.Cu']);
    expect(row('Layer').value).toBe('F.Cu');
    expect(row('Layer').swatch).toMatch(/^rgba\(/);
  });

  it('a graphic lists every enabled layer, the user name where there is one', () => {
    select([board.Drawings()[0]!]);
    expect(row('Layer').choices).toContain('F.Silkscreen');
    expect(row('Layer').choices).toContain('Edge.Cuts');
    expect(row('Layer').value).toBe('F.Silkscreen');
  });

  it('nets are sorted without regard to case (CmpNoCase)', () => {
    select([tracks()[0]!]);
    expect(row('Net').choices).toEqual(['', 'Aux', 'gnd', 'VCC']);
    expect(row('Net').value).toBe('gnd');
  });
});

describe('valueChanged: one BOARD_COMMIT for the whole selection', () => {
  it('sets every selected item, as one undo step', () => {
    select(tracks());
    row('Width').set!(MM(0.3))!();
    expect(tracks().map((t) => t.GetWidth())).toEqual([MM(0.3), MM(0.3)]);
    expect(frame.GetUndoCommandCount()).toBe(1);

    frame.RestoreCopyFromUndoList();
    expect(tracks().map((t) => t.GetWidth())).toEqual([MM(0.25), MM(0.5)]);
  });

  it('a choice commits the choice’s value, not its label', () => {
    select([tracks()[0]!]);
    row('Net').set!('VCC')!();
    expect(tracks()[0]!.GetNetCode()).toBe(2);
    select([tracks()[0]!]);
    row('Layer').set!('B.Cu')!();
    expect(tracks()[0]!.GetLayer()).toBe(2);
  });

  it('an emptied override cell clears the optional', () => {
    select([tracks()[0]!]);
    row('Soldermask Margin Override').set!(MM(0.1))!();
    expect(tracks()[0]!.GetLocalSolderMaskMargin()).toBe(MM(0.1));
    select([tracks()[0]!]);
    expect(row('Soldermask Margin Override').value).toBe(MM(0.1));
    row('Soldermask Margin Override').set!('')!();
    expect(tracks()[0]!.GetLocalSolderMaskMargin()).toBeUndefined();
  });

  it('a pad moved in the board editor drags its footprint (m_AllowFreePads off)', () => {
    const pad = fp().Pads()[0]!;
    select([pad]);
    row('Position X').set!(MM(60))!();
    expect(pad.GetPosition().x).toBe(MM(60));
    // The footprint moved with it by the same delta.
    expect(fp().GetPosition().x).toBe(MM(61));
  });

  it('with free pads allowed, only the pad moves', () => {
    frame.settings.m_AllowFreePads = true;
    const pad = fp().Pads()[0]!;
    select([pad]);
    row('Position X').set!(MM(60))!();
    expect(pad.GetPosition().x).toBe(MM(60));
    expect(fp().GetPosition().x).toBe(MM(50));
  });

  it('a footprint field is edited through the field property', () => {
    select([fp()]);
    row('Value').set!('22k')!();
    expect(fp().GetField('Value')!.GetText()).toBe('22k');
  });

  it('the angle cell reads and writes degrees', () => {
    select([fp()]);
    expect(row('Orientation').value).toBe('0°');
    row('Orientation').set!('90')!();
    expect(fp().GetOrientation().AsDegrees()).toBe(90);
  });

  it('an EDA_ANGLE property commits an EDA_ANGLE', () => {
    const zone = board.Zones()[0]!;
    select([zone]);
    expect(row('Hatch Orientation').value).toBe('0°');
    row('Hatch Orientation').set!('30')!();
    expect(zone.GetHatchOrientation().AsDegrees()).toBe(30);
  });

  it('valueChanging vetoes what the validator refuses', () => {
    select([via()]);
    // A diameter under the drill fails viaDiameterPropertyValidator.
    expect(row('Diameter').set!(MM(0.2))).toBeNull();
    expect(via().GetWidth(0)).toBe(MM(0.8));
    expect(frame.GetUndoCommandCount()).toBe(0);
  });
});
