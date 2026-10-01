// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_FP_EDIT_PAD_TABLE (pcbnew/dialogs/dialog_fp_edit_pad_table.cpp) on a live
 * footprint: its WX_GRID, the live edits, Cancel's rollback and OK's commit. KiCad
 * has no qa for it; each expectation is read off the C++ line it cites.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import { INDETERMINATE_STATE } from '@ziroeda/common/widgets/ui_common.js';
import type { wxGridEvent } from '@ziroeda/common/wx/grid.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import {
  COL_DRILL_X,
  COL_DRILL_Y,
  COL_NUMBER,
  COL_P2D_DELAY,
  COL_P2D_LENGTH,
  COL_POS_X,
  COL_POS_Y,
  COL_SHAPE,
  COL_SIZE_X,
  COL_SIZE_Y,
  COL_TYPE,
  DIALOG_FP_EDIT_PAD_TABLE,
  PAD_TABLE_COLUMN_LABELS,
  PAD_TABLE_COLUMN_WIDTHS,
  ShapeFromString,
} from '@ziroeda/pcbnew/dialogs/dialog_fp_edit_pad_table.js';
import type { FOOTPRINT } from '@ziroeda/pcbnew/footprint.js';
import type { PAD } from '@ziroeda/pcbnew/pad.js';
import { PAD_ATTRIB, PAD_SHAPE, PADSTACK, PADSTACK_MODE } from '@ziroeda/pcbnew/padstack.js';
import type { PCB_DRAW_PANEL_GAL } from '@ziroeda/pcbnew/pcb_draw_panel_gal.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { PCB_SCREEN } from '@ziroeda/pcbnew/pcb_screen.js';
import { TEST_PCB_FRAME } from '../support/test_pcb_frame.js';

const MM = 1_000_000;
const U = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const BOARD_TEXT = `(kicad_pcb (version 20241229) (generator "pcbnew") (generator_version "9.0")
  (general (thickness 1.6) (legacy_teardrops no))
  (paper "A4")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (1 "F.Mask" user) (3 "B.Mask" user) (25 "Edge.Cuts" user))
  (setup (pad_to_mask_clearance 0))
  (net 0 "")
  (footprint "R" (layer "F.Cu") (uuid "${U(1)}") (at 60 30)
    (property "Reference" "R" (at 0 -3 0) (layer "F.SilkS") (uuid "${U(2)}")
      (effects (font (size 1 1) (thickness 0.15))))
    (property "Value" "V" (at 0 3 0) (layer "F.Fab") (hide yes) (uuid "${U(3)}")
      (effects (font (size 1 1) (thickness 0.15))))
    (pad "10" smd rect (at -3 0) (size 1.5 1.5) (layers "F.Cu") (uuid "${U(11)}"))
    (pad "2" smd rect (at 0 0) (size 1.5 1.25) (layers "F.Cu") (uuid "${U(12)}"))
    (pad "1" smd rect (at 3 0) (size 1.5 1.5) (layers "F.Cu") (uuid "${U(13)}"))
    (pad "7" thru_hole circle (at 0 5) (size 1.6 1.6) (drill 0.8) (layers "*.Cu" "*.Mask") (pintype passive) (die_length 1.5) (uuid "${U(14)}"))
  )
)
`;

interface CANVAS {
  refreshes: number;
  updates: PAD[];
  dirty: number[];
}

let board: BOARD;
let frame: TEST_PCB_FRAME;
let footprint: FOOTPRINT;
let canvas: CANVAS;
let dlg: DIALOG_FP_EDIT_PAD_TABLE;

const padByUuid = (n: number): PAD => footprint.Pads().find((p) => p.m_Uuid === U(n))!;
const cell = (row: number, col: number): string => dlg.m_grid.GetCellValue(row, col);
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** Edit a cell the way the grid does: open its editor, type, close it. */
function edit(row: number, col: number, text: string): void {
  dlg.m_grid.SetGridCursor(row, col);
  dlg.m_grid.EnableCellEditControl();
  dlg.m_grid.GetCurrentEditor()!.m_value = text;
  dlg.m_grid.DisableCellEditControl();
}

const ev = (row: number, col = 0): wxGridEvent =>
  ({ GetRow: () => row, GetCol: () => col }) as unknown as wxGridEvent;

function make(units: 'mm' | 'in' | 'mils' = 'mm'): void {
  board = ParseBoard(BOARD_TEXT, '/p/x.kicad_pcb');
  frame = new TEST_PCB_FRAME(board, FRAME_T.FRAME_FOOTPRINT_EDITOR);
  frame.SetScreen(new PCB_SCREEN({ x: 297 * MM, y: 210 * MM }));
  frame.SetUserUnits(units);
  footprint = board.Footprints()[0]!;
  canvas = { refreshes: 0, updates: [], dirty: [] };
  frame.SetCanvas({
    // a view that records what the dialog asks and does nothing for the rest
    GetView: () =>
      new Proxy(
        {
          Update: (p: PAD) => canvas.updates.push(p),
          MarkTargetDirty: (t: number) => canvas.dirty.push(t),
        } as Record<string, unknown>,
        { get: (t, k: string) => t[k] ?? (() => null) },
      ),
    ForceRefresh: () => canvas.refreshes++,
    Refresh: () => {},
    GetGAL: () => null,
  } as unknown as PCB_DRAW_PANEL_GAL);
  dlg = new DIALOG_FP_EDIT_PAD_TABLE(frame, footprint);
  dlg.TransferDataToWindow();
}

beforeEach(() => make());

describe('DIALOG_FP_EDIT_PAD_TABLE rows and cells (dialog_fp_edit_pad_table.cpp:62-86, :212-318)', () => {
  it("has the base file's eleven columns, labels and widths", () => {
    expect(dlg.m_grid.GetNumberCols()).toBe(11);
    expect(PAD_TABLE_COLUMN_LABELS).toEqual([
      'Number',
      'Type',
      'Shape',
      'X Position',
      'Y Position',
      'Size X',
      'Size Y',
      'Drill X',
      'Drill Y',
      'Pad->Die Length',
      'Pad->Die Delay',
    ]);
    expect(PAD_TABLE_COLUMN_WIDTHS).toEqual([60, 110, 140, 84, 84, 84, 84, 84, 84, 110, 110]);
    PAD_TABLE_COLUMN_LABELS.forEach((l, c) => expect(dlg.m_grid.GetColLabelValue(c)).toBe(l));
  });

  it('has one row per pad, in pad number order, 2 before 10 (PAD_SNAPSHOT_COMPARE, StrNumCmp)', () => {
    expect(dlg.m_grid.GetNumberRows()).toBe(4);
    expect([0, 1, 2, 3].map((r) => cell(r, COL_NUMBER))).toEqual(['1', '2', '7', '10']);
    expect([0, 1, 2, 3].map((r) => dlg.GetPadForRow(r))).toEqual([
      padByUuid(13),
      padByUuid(12),
      padByUuid(14),
      padByUuid(11),
    ]);
  });

  it('an out of range row is no pad (getPadForRow)', () => {
    expect(dlg.GetPadForRow(4)).toBeNull();
    expect(dlg.GetPadForRow(-1)).toBeNull();
  });

  it('shows the type, the shape and the lengths in the frame units, with the unit word (:219-266)', () => {
    // row 1 is pad "2": 1.5 x 1.25 smd rect at (60,30)
    expect(cell(1, COL_TYPE)).toBe('SMD');
    expect(cell(1, COL_SHAPE)).toBe('Rectangle');
    expect(cell(1, COL_POS_X)).toBe('60 mm');
    expect(cell(1, COL_POS_Y)).toBe('30 mm');
    expect(cell(1, COL_SIZE_X)).toBe('1.5 mm');
    expect(cell(1, COL_SIZE_Y)).toBe('1.25 mm');
  });

  it("follows the frame's units (the grid's UNITS_PROVIDER, :132-140)", () => {
    make('mils');
    expect(cell(1, COL_SIZE_X)).toBe('59.05512 mils');
  });

  it('a through-hole pad shows its drill; the others have no drill and cannot be given one (:268-290)', () => {
    expect(cell(2, COL_TYPE)).toBe('Through-hole');
    expect(cell(2, COL_SHAPE)).toBe('Circle');
    expect(cell(2, COL_DRILL_X)).toBe('0.8 mm');
    expect(cell(2, COL_DRILL_Y)).toBe('0.8 mm');
    expect(dlg.m_grid.IsReadOnly(2, COL_DRILL_X)).toBe(false);
    expect(cell(1, COL_DRILL_X)).toBe('');
    expect(dlg.m_grid.IsReadOnly(1, COL_DRILL_X)).toBe(true);
    expect(dlg.m_grid.IsReadOnly(1, COL_DRILL_Y)).toBe(true);
  });

  it('shows a pad without copper as an Aperture, whatever its attribute (:259-260)', () => {
    const p = padByUuid(12);
    p.SetAttribute(PAD_ATTRIB.CONN);
    p.SetLayerSet(new LSET([PCB_LAYER_ID.F_Mask]));
    dlg = new DIALOG_FP_EDIT_PAD_TABLE(frame, footprint);
    dlg.TransferDataToWindow();
    expect(cell(1, COL_TYPE)).toBe('Aperture');
  });

  it('shows the pad to die length when there is one, and nothing when there is not (:292-297)', () => {
    expect(cell(2, COL_P2D_LENGTH)).toBe('1.5 mm');
    expect(cell(1, COL_P2D_LENGTH)).toBe('');
    expect(cell(1, COL_P2D_DELAY)).toBe('');
  });

  it('shows -- mixed values -- where the layers of the padstack differ (:243-253)', () => {
    const p = padByUuid(12);
    p.Padstack().SetMode(PADSTACK_MODE.FRONT_INNER_BACK);
    p.SetShape(PCB_LAYER_ID.B_Cu, PAD_SHAPE.OVAL);
    p.SetSize(PCB_LAYER_ID.B_Cu, { x: 3 * MM, y: 1.25 * MM });
    dlg = new DIALOG_FP_EDIT_PAD_TABLE(frame, footprint);
    dlg.TransferDataToWindow();
    expect(cell(1, COL_SHAPE)).toBe(INDETERMINATE_STATE);
    expect(cell(1, COL_SIZE_X)).toBe(INDETERMINATE_STATE);
    expect(cell(1, COL_SIZE_Y)).toBe('1.25 mm');
  });

  it('offers the type names and the seven shapes in the combo boxes (:88-104)', () => {
    const typeEd = dlg.m_grid.GetCellEditor(0, COL_TYPE) as unknown as { m_choices: string[] };
    expect(typeEd.m_choices).toEqual(['Through-hole', 'SMD', 'Connector', 'NPTH', 'Aperture']);
    const shapeEd = dlg.m_grid.GetCellEditor(0, COL_SHAPE) as unknown as { m_choices: string[] };
    expect(shapeEd.m_choices).toEqual([
      'Circle',
      'Oval',
      'Rectangle',
      'Trapezoid',
      'Rounded rectangle',
      'Chamfered rectangle',
      'Custom shape',
    ]);
  });

  it('maps a shape name back to a shape, anything unknown being a circle (ShapeFromString)', () => {
    expect(ShapeFromString('Oval')).toBe(PAD_SHAPE.OVAL);
    expect(ShapeFromString('Rectangle')).toBe(PAD_SHAPE.RECTANGLE);
    expect(ShapeFromString('Trapezoid')).toBe(PAD_SHAPE.TRAPEZOID);
    expect(ShapeFromString('Rounded rectangle')).toBe(PAD_SHAPE.ROUNDRECT);
    expect(ShapeFromString('Chamfered rectangle')).toBe(PAD_SHAPE.CHAMFERED_RECT);
    expect(ShapeFromString('Custom shape')).toBe(PAD_SHAPE.CUSTOM);
    expect(ShapeFromString('Circle')).toBe(PAD_SHAPE.CIRCLE);
    expect(ShapeFromString(INDETERMINATE_STATE)).toBe(PAD_SHAPE.CIRCLE);
  });

  it('refuses to fill a dialog that has no footprint (:218)', () => {
    const none = new DIALOG_FP_EDIT_PAD_TABLE(frame, null);
    expect(none.TransferDataToWindow()).toBe(false);
    expect(none.TransferDataFromWindow()).toBe(true);
  });
});

describe('DIALOG_FP_EDIT_PAD_TABLE selection (:640-668)', () => {
  it('highlights the first pad when it opens (:312-320)', () => {
    expect(dlg.GetPadForRow(0)!.IsBrightened()).toBe(true);
    expect(dlg.GetPadForRow(1)!.IsBrightened()).toBe(false);
  });

  it('moving to a row highlights its pad and no other, and redraws (:640-668)', () => {
    canvas.refreshes = 0;
    dlg.m_grid.SetGridCursor(2, 0);
    expect(dlg.GetPadForRow(2)!.IsBrightened()).toBe(true);
    expect(dlg.GetPadForRow(0)!.IsBrightened()).toBe(false);
    expect(canvas.updates).toContain(dlg.GetPadForRow(2));
    expect(canvas.refreshes).toBeGreaterThan(0);
  });

  it('a row that is no pad highlights nothing (:660)', () => {
    dlg.OnSelectCell(ev(99));
    for (let r = 0; r < 4; r++) expect(dlg.GetPadForRow(r)!.IsBrightened()).toBe(false);
  });
});

describe('DIALOG_FP_EDIT_PAD_TABLE live edits (OnCellChanged, :540-638)', () => {
  it("a new number is the pad's number at once, and makes the summary stale (:549-553)", () => {
    edit(1, COL_NUMBER, '20');
    expect(padByUuid(12).GetNumber()).toBe('20');
    expect(canvas.refreshes).toBeGreaterThan(0);
  });

  it("a new type is the pad's attribute; drills are editable only for through-hole and NPTH (:556-583)", () => {
    edit(1, COL_TYPE, 'Through-hole');
    expect(padByUuid(12).GetAttribute()).toBe(PAD_ATTRIB.PTH);
    expect(dlg.m_grid.IsReadOnly(1, COL_DRILL_X)).toBe(false);
    edit(1, COL_TYPE, 'SMD');
    expect(padByUuid(12).GetAttribute()).toBe(PAD_ATTRIB.SMD);
    expect(dlg.m_grid.IsReadOnly(1, COL_DRILL_X)).toBe(true);
    edit(1, COL_TYPE, 'Connector');
    expect(padByUuid(12).GetAttribute()).toBe(PAD_ATTRIB.CONN);
    edit(1, COL_TYPE, 'NPTH');
    expect(padByUuid(12).GetAttribute()).toBe(PAD_ATTRIB.NPTH);
    expect(dlg.m_grid.IsReadOnly(1, COL_DRILL_Y)).toBe(false);
  });

  it('a type that is no attribute changes nothing (Aperture is derived, :569)', () => {
    edit(1, COL_TYPE, 'Aperture');
    expect(padByUuid(12).GetAttribute()).toBe(PAD_ATTRIB.SMD);
  });

  it('a new shape is the shape of every layer (:586-589)', () => {
    edit(1, COL_SHAPE, 'Oval');
    expect(padByUuid(12).GetShape(PADSTACK.ALL_LAYERS)).toBe(PAD_SHAPE.OVAL);
  });

  it('a position cell moves only its own axis (:591-604)', () => {
    edit(1, COL_POS_X, '61.5');
    expect(padByUuid(12).GetPosition()).toEqual({ x: 61.5 * MM, y: 30 * MM });
    edit(1, COL_POS_Y, '31');
    expect(padByUuid(12).GetPosition()).toEqual({ x: 61.5 * MM, y: 31 * MM });
  });

  it('a size cell changes only its own dimension (:606-620)', () => {
    edit(1, COL_SIZE_X, '2');
    expect(padByUuid(12).GetSize(PADSTACK.ALL_LAYERS)).toEqual({ x: 2 * MM, y: 1.25 * MM });
    edit(1, COL_SIZE_Y, '3');
    expect(padByUuid(12).GetSize(PADSTACK.ALL_LAYERS)).toEqual({ x: 2 * MM, y: 3 * MM });
  });

  it('a drill cell sets the drill of a through-hole pad; a zero side takes the other (:622-642)', () => {
    edit(2, COL_DRILL_X, '1.2');
    // the other side is still 0.8 and is kept
    expect(padByUuid(14).GetDrillSize()).toEqual({ x: 1.2 * MM, y: 0.8 * MM });
    edit(2, COL_DRILL_Y, '0');
    expect(padByUuid(14).GetDrillSize()).toEqual({ x: 1.2 * MM, y: 1.2 * MM });
  });

  it('a drill on a pad that has none is ignored (:626)', () => {
    dlg.OnCellChanged(ev(1, COL_DRILL_X));
    expect(padByUuid(12).GetDrillSize()).toEqual({ x: 0, y: 0 });
  });

  it('the pad to die cells set the length and the delay when they are not empty (:644-654)', () => {
    edit(1, COL_P2D_LENGTH, '2');
    expect(padByUuid(12).GetPadToDieLength()).toBe(2 * MM);
    edit(1, COL_P2D_DELAY, '5 ps');
    expect(padByUuid(12).GetPadToDieDelay()).toBe(5 * pcbIUScale.IU_PER_PS);
  });

  it('an emptied pad to die cell is left empty by its editor, and does not set 0 (:462-482, :645)', async () => {
    edit(2, COL_P2D_LENGTH, '');
    await flush();
    expect(cell(2, COL_P2D_LENGTH)).toBe('');
    expect(padByUuid(14).GetPadToDieLength()).toBe(1.5 * MM);
  });

  it('an emptied position cell is a value after all: "0 mm" (a cell that is not nullable, :462-482)', async () => {
    edit(1, COL_POS_X, '');
    await flush();
    expect(cell(1, COL_POS_X)).toBe('0 mm');
  });

  it('a typed value is shown with the unit word once the editor closes (:455-460)', async () => {
    edit(1, COL_SIZE_X, '2');
    await flush();
    expect(cell(1, COL_SIZE_X)).toBe('2 mm');
  });

  it('a row that is no pad is ignored (:547)', () => {
    expect(() => dlg.OnCellChanged(ev(99, COL_NUMBER))).not.toThrow();
  });
});

describe('DIALOG_FP_EDIT_PAD_TABLE Cancel and OK (:174-208, :320-452)', () => {
  it('Cancel puts every pad back as it was (:176-181, :322-356)', () => {
    edit(1, COL_NUMBER, '20');
    edit(1, COL_TYPE, 'Through-hole');
    edit(1, COL_POS_X, '70');
    edit(1, COL_SIZE_X, '4');
    edit(1, COL_SHAPE, 'Oval');
    edit(2, COL_P2D_LENGTH, '9');
    dlg.OnCancel();
    dlg.Destroy();
    const p = padByUuid(12);
    expect(p.GetNumber()).toBe('2');
    expect(p.GetAttribute()).toBe(PAD_ATTRIB.SMD);
    expect(p.GetPosition()).toEqual({ x: 60 * MM, y: 30 * MM });
    expect(p.GetSize(PADSTACK.ALL_LAYERS)).toEqual({ x: 1.5 * MM, y: 1.25 * MM });
    expect(p.GetShape(PADSTACK.ALL_LAYERS)).toBe(PAD_SHAPE.RECTANGLE);
    expect(padByUuid(14).GetPadToDieLength()).toBe(1.5 * MM);
    expect(frame.GetUndoCommandCount()).toBe(0);
  });

  it('Cancel clears the highlight and redraws (:347-355)', () => {
    dlg.OnCancel();
    dlg.Destroy();
    for (const pad of footprint.Pads()) expect(pad.IsBrightened()).toBe(false);
    expect(canvas.dirty.length).toBeGreaterThan(0);
  });

  it('closing without Cancel keeps the live edits (the destructor restores only if cancelled, :176)', () => {
    edit(1, COL_NUMBER, '20');
    dlg.Destroy();
    expect(padByUuid(12).GetNumber()).toBe('20');
  });

  it('OK writes the grid to the pads in one undo entry that gives the original back (:358-452)', () => {
    edit(1, COL_NUMBER, '20');
    edit(1, COL_POS_X, '70');
    edit(2, COL_DRILL_X, '1');
    expect(dlg.TransferDataFromWindow()).toBe(true);
    expect(padByUuid(12).GetNumber()).toBe('20');
    expect(padByUuid(12).GetPosition().x).toBe(70 * MM);
    expect(padByUuid(14).GetDrillSize().x).toBe(1 * MM);
    expect(frame.GetUndoCommandCount()).toBe(1);
    frame.RestoreCopyFromUndoList();
    expect(padByUuid(12).GetNumber()).toBe('2');
    expect(padByUuid(12).GetPosition().x).toBe(60 * MM);
    expect(padByUuid(14).GetDrillSize().x).toBe(0.8 * MM);
  });

  it('OK keeps the shape of a pad whose layers differ, and the size of a mixed side (:395-424)', () => {
    const p = padByUuid(12);
    p.Padstack().SetMode(PADSTACK_MODE.FRONT_INNER_BACK);
    p.SetShape(PCB_LAYER_ID.B_Cu, PAD_SHAPE.OVAL);
    p.SetSize(PCB_LAYER_ID.B_Cu, { x: 3 * MM, y: 1.25 * MM });
    dlg = new DIALOG_FP_EDIT_PAD_TABLE(frame, footprint);
    dlg.TransferDataToWindow();
    dlg.TransferDataFromWindow();
    expect(p.GetShape(PCB_LAYER_ID.B_Cu)).toBe(PAD_SHAPE.OVAL);
    expect(p.GetShape(PCB_LAYER_ID.F_Cu)).toBe(PAD_SHAPE.RECTANGLE);
    expect(p.GetSize(PCB_LAYER_ID.B_Cu).x).toBe(3 * MM);
  });

  it('OK sets the shape and size on every layer (:401-424)', () => {
    edit(1, COL_SHAPE, 'Oval');
    edit(1, COL_SIZE_X, '2');
    dlg.TransferDataFromWindow();
    expect(padByUuid(12).GetShape(PADSTACK.ALL_LAYERS)).toBe(PAD_SHAPE.OVAL);
    expect(padByUuid(12).GetSize(PADSTACK.ALL_LAYERS).x).toBe(2 * MM);
  });

  it('OK takes the pad to die cells; an empty one is 0 (:434-448)', () => {
    edit(2, COL_P2D_LENGTH, '');
    edit(1, COL_P2D_DELAY, '7 ps');
    dlg.TransferDataFromWindow();
    expect(padByUuid(14).GetPadToDieLength()).toBe(0);
    expect(padByUuid(12).GetPadToDieDelay()).toBe(7 * pcbIUScale.IU_PER_PS);
  });

  it('OK takes the drill only for through-hole and NPTH pads, mirroring a side that is 0 (:426-447)', () => {
    edit(2, COL_DRILL_X, '1.4');
    edit(2, COL_DRILL_Y, '0');
    dlg.TransferDataFromWindow();
    expect(padByUuid(14).GetDrillSize()).toEqual({ x: 1.4 * MM, y: 1.4 * MM });
    expect(padByUuid(12).GetDrillSize()).toEqual({ x: 0, y: 0 });
  });

  it('an aperture pad keeps its attribute (:393)', () => {
    const p = padByUuid(12);
    p.SetAttribute(PAD_ATTRIB.CONN);
    p.SetLayerSet(new LSET([PCB_LAYER_ID.F_Mask]));
    dlg = new DIALOG_FP_EDIT_PAD_TABLE(frame, footprint);
    dlg.TransferDataToWindow();
    dlg.TransferDataFromWindow();
    expect(p.GetAttribute()).toBe(PAD_ATTRIB.CONN);
  });
});

describe('DIALOG_FP_EDIT_PAD_TABLE summary (updateSummary, :736-757)', () => {
  it('lists the pad numbers as runs, counts the pads and names the duplicates (:740-752)', () => {
    dlg.OnUpdateUI();
    expect(dlg.m_pin_numbers_summary).toBe('1-2,7,10');
    expect(dlg.m_pin_count).toBe('4');
    expect(dlg.m_duplicate_pins).toBe('none');
    expect(dlg.m_pin_numbers_summaryToolTip).toBe('1-2,7,10');
  });

  it('names a number two pads share (:741-748)', () => {
    edit(0, COL_NUMBER, '2');
    dlg.OnUpdateUI();
    expect(dlg.m_duplicate_pins).toBe('2');
    expect(dlg.m_duplicate_pinsToolTip).toBe('2');
  });

  it('a pad with no number is not counted in the summary (:743)', () => {
    edit(0, COL_NUMBER, '');
    dlg.OnUpdateUI();
    expect(dlg.m_pin_numbers_summary).toBe('2,7,10');
    expect(dlg.m_pin_count).toBe('4');
  });

  it('is refreshed only when something made it stale (:674-697)', () => {
    dlg.OnUpdateUI();
    padByUuid(12).SetNumber('99');
    dlg.OnUpdateUI();
    expect(dlg.m_pin_numbers_summary).toBe('1-2,7,10');
  });

  it('reads the number being typed before the cell is committed (:679-692)', () => {
    dlg.OnUpdateUI();
    dlg.m_grid.SetGridCursor(1, COL_NUMBER);
    dlg.m_grid.EnableCellEditControl();
    dlg.m_grid.GetCurrentEditor()!.m_value = '30';
    dlg.OnCharHook();
    dlg.OnUpdateUI();
    expect(padByUuid(12).GetNumber()).toBe('30');
    expect(dlg.m_pin_numbers_summary).toBe('1,7,10,30');
  });
});

describe('DIALOG_FP_EDIT_PAD_TABLE column widths (:454-536)', () => {
  it('keeps the proportions of the widths the window measured, and the widths as a floor (:470-526)', () => {
    dlg.SetColumnSizes([100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100]);
    dlg.OnSize(2200);
    expect(dlg.GetColumnWidths()).toEqual(Array(11).fill(200));
  });

  it('never goes below the measured width (:512)', () => {
    dlg.SetColumnSizes([100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100]);
    dlg.OnSize(500);
    expect(Math.min(...dlg.GetColumnWidths())).toBeGreaterThanOrEqual(100);
  });

  it('gives the last column the rounding left over (:517-518)', () => {
    dlg.SetColumnSizes([100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100]);
    dlg.OnSize(1201);
    const widths = dlg.GetColumnWidths();
    expect(widths.reduce((a, b) => a + b, 0)).toBe(1201);
    expect(widths[10]).toBe(1201 - widths.slice(0, 10).reduce((a, b) => a + b, 0));
  });

  it('does nothing before the proportions are taken (:480)', () => {
    const fresh = new DIALOG_FP_EDIT_PAD_TABLE(frame, footprint);
    fresh.OnSize(3000);
    expect(fresh.GetColumnWidths()).toEqual([...PAD_TABLE_COLUMN_WIDTHS]);
  });
});
