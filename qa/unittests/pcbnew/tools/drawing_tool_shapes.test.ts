// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DRAWING_TOOL's shape tools on a live BOARD: DrawLine, DrawRectangle,
 * DrawCircle and DrawArc through drawShape / drawArc (drawing_tool.cpp),
 * driven by mouse events through the TOOL_MANAGER. Each expectation cites
 * its line.
 */
import { KICURSOR } from '@ziroeda/common/gal/cursors.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/font/text_attributes.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import {
  AS_GLOBAL,
  MD_CTRL,
  TC_MOUSE,
  TOOL_EVENT,
  BUT_LEFT,
  TA_MOUSE_CLICK,
  TA_MOUSE_DBLCLICK,
  TA_MOUSE_MOTION,
} from '@ziroeda/common/tool/tool_event.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { PCB_SHAPE } from '@ziroeda/pcbnew/pcb_shape.js';
import type { BOARD_ITEM } from '@ziroeda/pcbnew/board_item.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import type { DIALOG_TEXT_PROPERTIES } from '@ziroeda/pcbnew/dialogs/dialog_text_properties.js';
import type { PCB_TEXT } from '@ziroeda/pcbnew/pcb_text.js';
import { DIALOG_NON_COPPER_ZONES_EDITOR } from '@ziroeda/pcbnew/dialogs/dialog_non_copper_zones_properties.js';
import { DIALOG_RULE_AREA_PROPERTIES } from '@ziroeda/pcbnew/dialogs/dialog_rule_area_properties.js';
import { DIALOG_COPPER_ZONE } from '@ziroeda/pcbnew/dialogs/panel_zone_properties.js';
import type { ZONE } from '@ziroeda/pcbnew/zone.js';
import type { PCB_TABLE } from '@ziroeda/pcbnew/pcb_table.js';
import { PCB_TEXTBOX as PcbTextboxClass, type PCB_TEXTBOX } from '@ziroeda/pcbnew/pcb_textbox.js';
import type { PCB_REFERENCE_IMAGE } from '@ziroeda/pcbnew/pcb_reference_image.js';
import type { PCB_BARCODE } from '@ziroeda/pcbnew/pcb_barcode.js';
import type { IMPORT_GRAPHICS_RESULT } from '@ziroeda/pcbnew/pcb_base_edit_frame.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  PCB_DIMENSION_BASE,
  type PCB_DIM_ALIGNED,
  PCB_DIM_ORTHOGONAL,
  type PCB_DIM_RADIAL,
} from '@ziroeda/pcbnew/pcb_dimension.js';
import { DIM_ARROW_DIRECTION, DIM_UNITS_FORMAT } from '@ziroeda/pcbnew/pcb_dimension_types.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { sub } from '@ziroeda/kimath/src/math/vector2.js';
import { PCB_TRACK, type PCB_VIA } from '@ziroeda/pcbnew/pcb_track.js';
import { VIATYPE } from '@ziroeda/pcbnew/pcb_track_types.js';
import { BOARD_COMMIT } from '@ziroeda/pcbnew/board_commit.js';
import { DRAWING_MODE, DRAWING_TOOL } from '@ziroeda/pcbnew/tools/drawing_tool.js';
import type { TOOL_ACTION } from '@ziroeda/common/tool/tool_action.js';
import { PCB_ACTIONS } from '@ziroeda/pcbnew/tools/pcb_actions.js';
import { mouse, type TOOL_HARNESS, toolHarness } from '../support/pcb_tool_harness.js';
import { TEST_PCB_FRAME } from '../support/test_pcb_frame.js';

const MM = 1_000_000;
const mm = (x: number, y: number): Vec2 => ({ x: x * MM, y: y * MM });

const BOARD_TEXT = `(kicad_pcb (version 20241229) (generator "pcbnew") (generator_version "9.0")
  (general (thickness 1.6) (legacy_teardrops no))
  (paper "A4")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (5 "F.SilkS" user "F.Silkscreen") (25 "Edge.Cuts" user))
  (setup (pad_to_mask_clearance 0))
  (net 0 "")
  (net 1 "N1")
)
`;

/** The text dialog's answer: the text typed, or null for Cancel. */
let dialogText: string | null = 'HELLO';

/** The zone dialogs the tool asked for, and whether they answer OK. */
let zoneDialogs: unknown[] = [];
let zoneDialogOk = true;

/** The table dialog's answer. */
let tableDialogOk = true;

/** The image file dialog's answer: a fixture PNG's bytes, or null for Cancel. */
let imageFile: Uint8Array | null = null;

/** The text box dialog's answer. */
let textBoxOk = true;
/** The barcode dialog's answer, and the text it types into the new barcode. */
let barcodeOk = true;
/** What OK on the import graphics dialog hands the tool, or null for Cancel. */
let importResult: IMPORT_GRAPHICS_RESULT | null = null;

class TEXT_FRAME extends TEST_PCB_FRAME {
  override ShowImportGraphicsDialog(): Promise<IMPORT_GRAPHICS_RESULT | null> {
    return Promise.resolve(importResult);
  }
  override ShowBarcodePropertiesDialog(aBarcode: PCB_BARCODE): Promise<boolean> {
    if (barcodeOk) {
      aBarcode.SetText('ZIRO');
      aBarcode.AssembleBarcode();
    }
    return Promise.resolve(barcodeOk);
  }

  override ShowTextBoxPropertiesDialog(): Promise<boolean> {
    return Promise.resolve(textBoxOk);
  }

  override ShowImageFileDialog(): Promise<Uint8Array | null> {
    return Promise.resolve(imageFile);
  }

  override ShowTablePropertiesDialog(): Promise<boolean> {
    return Promise.resolve(tableDialogOk);
  }

  override ShowZoneSettingsDialog(aDialog: unknown): Promise<boolean> {
    zoneDialogs.push(aDialog);
    if (!zoneDialogOk) return Promise.resolve(false);
    const d = aDialog as {
      TransferDataToWindow(): unknown;
      TransferDataFromWindow(v: unknown): unknown;
    };
    d.TransferDataFromWindow(d.TransferDataToWindow());
    return Promise.resolve(true);
  }

  override ShowTextPropertiesDialog(aDialog: DIALOG_TEXT_PROPERTIES): Promise<boolean> {
    if (dialogText === null) return Promise.resolve(false);
    const v = aDialog.TransferDataToWindow();
    aDialog.TransferDataFromWindow({ ...v, text: dialogText });
    return Promise.resolve(true);
  }
}

let h: TOOL_HARNESS<TEST_PCB_FRAME>;
let tool: DRAWING_TOOL;

beforeEach(() => {
  h = toolHarness(
    BOARD_TEXT,
    (aBoard) => new TEXT_FRAME(aBoard),
    () => {
      tool = new DRAWING_TOOL();
      return [tool];
    },
  );
  dialogText = 'HELLO';
  zoneDialogs = [];
  zoneDialogOk = true;
  tableDialogOk = true;
  imageFile = null;
  textBoxOk = true;
  barcodeOk = true;
  importResult = null;
  h.frame.SetActiveLayer(PCB_LAYER_ID.F_SilkS);
  h.mgr.ResetTools(RESET_REASON.MODEL_RELOAD);
});

const shapes = (): PCB_SHAPE[] => h.board.Drawings() as unknown as PCB_SHAPE[];
const click = (p: Vec2): void => {
  mouse(h, TA_MOUSE_MOTION, p);
  mouse(h, TA_MOUSE_CLICK, p, BUT_LEFT);
};
const move = (p: Vec2): void => mouse(h, TA_MOUSE_MOTION, p);
/** A toolbar click: ACTION_TOOLBAR's event carries no position. */
const start = (aAction: TOOL_ACTION): void => {
  const evt = aAction.MakeEvent();
  evt.SetHasPosition(false);
  h.mgr.ProcessEvent(evt);
};
const esc = (): void => {
  h.mgr.RunAction(ACTIONS.cancelInteractive);
};

describe('DRAWING_TOOL::DrawLine (drawing_tool.cpp:360-408)', () => {
  it('two clicks commit a segment on the active layer at its default width (:2461-2523)', () => {
    start(PCB_ACTIONS.drawLine);
    click(mm(10, 10));
    move(mm(20, 10));
    click(mm(20, 10));
    esc();
    esc();
    expect(shapes()).toHaveLength(1);
    const s = shapes()[0]!;
    expect(s.GetShape()).toBe(SHAPE_T.SEGMENT);
    expect(s.GetStart()).toEqual(mm(10, 10));
    expect(s.GetEnd()).toEqual(mm(20, 10));
    expect(s.GetLayer()).toBe(PCB_LAYER_ID.F_SilkS);
    expect(s.GetWidth()).toBe(h.board.GetDesignSettings().GetLineThickness(PCB_LAYER_ID.F_SilkS));
  });

  it('from a hotkey (an event with a position) the line starts at the cursor (:384-385)', () => {
    h.mouse = mm(5, 5);
    h.mgr.RunAction(PCB_ACTIONS.drawLine);
    click(mm(15, 5));
    expect(shapes()[0]!.GetStart()).toEqual(mm(5, 5));
  });

  it('chains: the next segment starts where the last ended, one undo step each (:390-396)', () => {
    start(PCB_ACTIONS.drawLine);
    const undo = h.frame.GetUndoCommandCount();
    click(mm(10, 10));
    click(mm(20, 10));
    click(mm(20, 20));
    esc();
    esc();
    // BOARD_COMMIT adds at the front of the drawings, so compare as a set.
    expect(shapes().map((s) => [s.GetStart(), s.GetEnd()])).toEqual(
      expect.arrayContaining([
        [mm(10, 10), mm(20, 10)],
        [mm(20, 10), mm(20, 20)],
      ]),
    );
    expect(shapes()).toHaveLength(2);
    expect(h.frame.GetUndoCommandCount()).toBe(undo + 2);
  });

  it('clicking the same spot twice ends the chain without a zero-length line (:2560-2565)', () => {
    start(PCB_ACTIONS.drawLine);
    click(mm(10, 10));
    click(mm(20, 10));
    click(mm(20, 10));
    expect(shapes()).toHaveLength(1);
    expect(tool.GetDrawingMode()).toBe(DRAWING_MODE.LINE);
  });

  it('Delete Last Point backs out the last committed segment (:2612-2641)', () => {
    start(PCB_ACTIONS.drawLine);
    click(mm(10, 10));
    click(mm(20, 10));
    expect(shapes()).toHaveLength(1);
    h.mgr.RunAction(PCB_ACTIONS.deleteLastPoint);
    expect(shapes()).toHaveLength(0);
  });

  it('Esc before the first click leaves the tool and commits nothing (:2426-2438)', () => {
    start(PCB_ACTIONS.drawLine);
    expect(tool.GetDrawingMode()).toBe(DRAWING_MODE.LINE);
    esc();
    expect(tool.GetDrawingMode()).toBe(DRAWING_MODE.NONE);
    expect(shapes()).toHaveLength(0);
  });

  it('+ widens the line by 0.1 mm (:2643-2649)', () => {
    start(PCB_ACTIONS.drawLine);
    click(mm(10, 10));
    const w0 = h.board.GetDesignSettings().GetLineThickness(PCB_LAYER_ID.F_SilkS);
    h.mgr.RunAction(PCB_ACTIONS.incWidth);
    click(mm(20, 10));
    expect(shapes()[0]!.GetWidth()).toBe(w0 + 0.1 * MM);
  });

  it('the preview is in the view while drawing and gone after (:2393-2397, :2711-2712)', () => {
    start(PCB_ACTIONS.drawLine);
    click(mm(10, 10));
    move(mm(15, 12));
    const preview = (tool as unknown as { m_preview: { GetSize(): number } }).m_preview;
    expect(preview.GetSize()).toBe(1);
    const inView = (): boolean =>
      (h.view as unknown as { m_allItems: unknown[] }).m_allItems.includes(preview);
    expect(inView()).toBe(true);
    esc();
    esc();
    expect(preview.GetSize()).toBe(0);
    expect(inView()).toBe(false);
  });

  it('the angle snap holds a line to 45 degrees (:2587-2601)', () => {
    h.frame.GetPcbNewSettings().m_AngleSnapMode = 1; // LEADER_MODE::DEG45
    start(PCB_ACTIONS.drawLine);
    click(mm(10, 10));
    move(mm(20, 11));
    click(mm(20, 11));
    expect(shapes()[0]!.GetEnd()).toEqual(mm(20, 10));
  });
});

describe('DRAWING_TOOL::DrawRectangle / DrawCircle (:411-517)', () => {
  it('a rectangle is normalized and selected (:450-461)', () => {
    start(PCB_ACTIONS.drawRectangle);
    click(mm(30, 30));
    click(mm(20, 20));
    const r = shapes()[0]!;
    expect(r.GetShape()).toBe(SHAPE_T.RECTANGLE);
    expect(r.GetStart()).toEqual(mm(20, 20));
    expect(r.GetEnd()).toEqual(mm(30, 30));
    expect(r.IsSelected()).toBe(true);
  });

  it('Ctrl holds a rectangle to a square: 45 degrees only (:2575-2577, :2596-2597)', () => {
    start(PCB_ACTIONS.drawRectangle);
    click(mm(20, 20));
    const ctrlMove = (p: Vec2): void => {
      h.mouse = p;
      const evt = new TOOL_EVENT(TC_MOUSE, TA_MOUSE_MOTION, BUT_LEFT | MD_CTRL, AS_GLOBAL);
      evt.SetMousePosition(p);
      h.mgr.ProcessEvent(evt);
    };
    ctrlMove(mm(30, 32));
    const ctrlClick = new TOOL_EVENT(TC_MOUSE, TA_MOUSE_CLICK, BUT_LEFT | MD_CTRL, AS_GLOBAL);
    ctrlClick.SetMousePosition(mm(30, 32));
    h.mgr.ProcessEvent(ctrlClick);
    const r = shapes()[0]!;
    const w = r.GetEnd().x - r.GetStart().x;
    const hgt = r.GetEnd().y - r.GetStart().y;
    expect(Math.abs(w)).toBe(Math.abs(hgt));
    expect(w).toBeGreaterThan(0);
  });

  it('a rectangle does not chain: the next starts fresh (:463-468)', () => {
    start(PCB_ACTIONS.drawRectangle);
    click(mm(20, 20));
    click(mm(30, 30));
    click(mm(40, 40));
    click(mm(50, 45));
    expect(shapes()).toHaveLength(2);
    expect(shapes().map((r) => r.GetStart())).toEqual(
      expect.arrayContaining([mm(20, 20), mm(40, 40)]),
    );
  });

  it('a circle is centre then radius point (:496-509)', () => {
    start(PCB_ACTIONS.drawCircle);
    click(mm(50, 50));
    click(mm(53, 54));
    const c = shapes()[0]!;
    expect(c.GetShape()).toBe(SHAPE_T.CIRCLE);
    expect(c.GetCenter()).toEqual(mm(50, 50));
    expect(c.GetRadius()).toBe(5 * MM);
  });

  it('a double click finishes the shape on the spot (:2560)', () => {
    start(PCB_ACTIONS.drawCircle);
    click(mm(50, 50));
    move(mm(52, 50));
    mouse(h, TA_MOUSE_DBLCLICK, mm(52, 50), BUT_LEFT);
    expect(shapes()).toHaveLength(0);
  });
});

describe('DRAWING_TOOL::DrawArc (:520-563, :2792-3062)', () => {
  it('centre, start, end: an arc on the active layer, selected (:540-553)', () => {
    start(PCB_ACTIONS.drawArc);
    click(mm(50, 50));
    click(mm(60, 50));
    move(mm(50, 40));
    click(mm(50, 40));
    const a = shapes()[0]!;
    expect(a.GetShape()).toBe(SHAPE_T.ARC);
    expect(a.GetCenter().x).toBeCloseTo(50 * MM, -2);
    expect(a.GetCenter().y).toBeCloseTo(50 * MM, -2);
    expect(a.GetRadius()).toBeCloseTo(10 * MM, -3);
    expect(Math.abs(a.GetArcAngle().AsDegrees())).toBeCloseTo(90, 3);
    expect(a.GetLayer()).toBe(PCB_LAYER_ID.F_SilkS);
    expect(a.IsSelected()).toBe(true);
  });

  it('Esc after the centre throws the arc away, the tool stays (:2867-2879)', () => {
    start(PCB_ACTIONS.drawArc);
    click(mm(50, 50));
    esc();
    expect(shapes()).toHaveLength(0);
    expect(tool.GetDrawingMode()).toBe(DRAWING_MODE.ARC);
  });
});

describe('DRAWING_TOOL::PlaceText (drawing_tool.cpp:933-1183)', () => {
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
  };
  const texts = (): PCB_TEXT[] => h.board.Drawings() as unknown as PCB_TEXT[];

  it('the dialog opens at once (immediate actions); the text rides the cursor; a click places it (:984-990, :1052-1131)', async () => {
    h.mouse = mm(40, 40);
    start(PCB_ACTIONS.placeText);
    await flush();
    expect(texts()).toHaveLength(0);
    move(mm(50, 50));
    click(mm(50, 50));
    expect(texts()).toHaveLength(1);
    const t = texts()[0]!;
    expect(t.GetText()).toBe('HELLO');
    expect(t.GetTextPos()).toEqual(mm(50, 50));
    expect(t.GetLayer()).toBe(PCB_LAYER_ID.F_SilkS);
    expect(t.IsSelected()).toBe(true);
  });

  it('the new text takes the layer defaults, bottom-left justified (:1066-1077)', async () => {
    start(PCB_ACTIONS.placeText);
    await flush();
    click(mm(30, 30));
    const t = texts()[0]!;
    const bds = h.board.GetDesignSettings();
    expect(t.GetTextSize()).toEqual(bds.GetTextSize(PCB_LAYER_ID.F_SilkS));
    expect(t.GetVertJustify()).toBe(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM);
    expect(t.GetHorizJustify()).toBe(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT);
  });

  it('Cancel in the dialog places nothing, and the tool stays (:1094-1098)', async () => {
    dialogText = null;
    start(PCB_ACTIONS.placeText);
    await flush();
    click(mm(30, 30));
    await flush();
    expect(texts()).toHaveLength(0);
    expect(tool.GetDrawingMode()).toBe(DRAWING_MODE.TEXT);
  });

  it('a text of only spaces is not placed (:1094)', async () => {
    dialogText = '   ';
    start(PCB_ACTIONS.placeText);
    await flush();
    click(mm(30, 30));
    expect(texts()).toHaveLength(0);
  });

  it('Esc while the text rides the cursor drops it; a second Esc leaves the tool (:1010-1019)', async () => {
    start(PCB_ACTIONS.placeText);
    await flush();
    esc();
    expect(tool.GetDrawingMode()).toBe(DRAWING_MODE.TEXT);
    esc();
    expect(tool.GetDrawingMode()).toBe(DRAWING_MODE.NONE);
    expect(texts()).toHaveLength(0);
  });

  it('one undo step per text (:1121-1122)', async () => {
    const undo = h.frame.GetUndoCommandCount();
    start(PCB_ACTIONS.placeText);
    await flush();
    click(mm(30, 30));
    expect(h.frame.GetUndoCommandCount()).toBe(undo + 1);
  });
});

describe('DRAWING_TOOL::DrawZone, Draw Polygons (drawing_tool.cpp:3435-3683)', () => {
  const polys = (): PCB_SHAPE[] => shapes().filter((s) => s.GetShape() === SHAPE_T.POLY);

  it('three corners and a click on the first close a filled polygon on the active layer (:3587-3601, zone_create_helper.cpp:237-257)', () => {
    start(PCB_ACTIONS.drawPolygon);
    click(mm(10, 10));
    click(mm(30, 10));
    click(mm(30, 30));
    click(mm(10, 10));
    expect(polys()).toHaveLength(1);
    const p = polys()[0]!;
    expect(p.GetLayer()).toBe(PCB_LAYER_ID.F_SilkS);
    expect(p.IsSolidFill()).toBe(true);
    expect(p.GetPolyShape().Outline(0).PointCount()).toBe(3);
    expect(p.GetWidth()).toBe(h.board.GetDesignSettings().GetLineThickness(PCB_LAYER_ID.F_SilkS));
    expect(p.IsSelected()).toBe(true);
    // DrawZone draws one outline and pops the tool (:3600)
    expect(tool.GetDrawingMode()).toBe(DRAWING_MODE.NONE);
  });

  it('on Edge.Cuts the polygon is not filled (zone_create_helper.cpp:246)', () => {
    h.frame.SetActiveLayer(PCB_LAYER_ID.Edge_Cuts);
    start(PCB_ACTIONS.drawPolygon);
    click(mm(10, 10));
    click(mm(30, 10));
    click(mm(30, 30));
    mouse(h, TA_MOUSE_DBLCLICK, mm(30, 30), BUT_LEFT);
    expect(polys()).toHaveLength(1);
    expect(polys()[0]!.IsSolidFill()).toBe(false);
  });

  it('Delete Last Point drops a corner; Esc abandons the outline and stays (:3625-3643, :3528-3541)', () => {
    start(PCB_ACTIONS.drawPolygon);
    click(mm(10, 10));
    click(mm(30, 10));
    click(mm(50, 50));
    h.mgr.RunAction(PCB_ACTIONS.deleteLastPoint);
    click(mm(30, 30));
    click(mm(10, 10));
    const pts = polys()[0]!.GetPolyShape().Outline(0);
    expect(pts.PointCount()).toBe(3);
    expect([...Array(3).keys()].map((i) => pts.CPoint(i))).not.toContainEqual(mm(50, 50));

    start(PCB_ACTIONS.drawPolygon);
    click(mm(60, 60));
    click(mm(70, 60));
    esc();
    expect(tool.GetDrawingMode()).toBe(DRAWING_MODE.GRAPHIC_POLYGON);
    esc();
    expect(tool.GetDrawingMode()).toBe(DRAWING_MODE.NONE);
    expect(polys()).toHaveLength(1);
  });

  it('fewer than three corners scraps the outline (zone_create_helper.cpp:327-331)', () => {
    start(PCB_ACTIONS.drawPolygon);
    click(mm(10, 10));
    click(mm(30, 10));
    h.mgr.RunAction(PCB_ACTIONS.closeOutline);
    expect(polys()).toHaveLength(0);
  });
});

describe('DRAWING_TOOL::DrawZone, the zone modes (drawing_tool.cpp:3435-3683, zone_create_helper.cpp)', () => {
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
  };
  const zones = (): ZONE[] => [...h.board.Zones()];
  const triangle = async (a: Vec2, b: Vec2, c: Vec2): Promise<void> => {
    click(a);
    await flush();
    click(b);
    click(c);
    click(a);
  };

  it('a copper zone: its dialog first, then the outline, committed on the active layer and selected (:212-220, :238-247)', async () => {
    h.frame.SetActiveLayer(PCB_LAYER_ID.F_Cu);
    start(PCB_ACTIONS.drawZone);
    await triangle(mm(10, 10), mm(40, 10), mm(40, 40));
    expect(zoneDialogs).toHaveLength(1);
    expect(zoneDialogs[0]).toBeInstanceOf(DIALOG_COPPER_ZONE);
    expect(zones()).toHaveLength(1);
    const z = zones()[0]!;
    expect(z.GetLayerSet().Seq()).toEqual([PCB_LAYER_ID.F_Cu]);
    expect(z.Outline().Outline(0).PointCount()).toBe(3);
    expect(z.GetIsRuleArea()).toBe(false);
    expect(z.IsSelected()).toBe(true);
  });

  it('a new copper zone takes the first unused priority (zone_create_helper.cpp:56-80)', async () => {
    h.frame.SetActiveLayer(PCB_LAYER_ID.F_Cu);
    start(PCB_ACTIONS.drawZone);
    await triangle(mm(10, 10), mm(40, 10), mm(40, 40));
    start(PCB_ACTIONS.drawZone);
    await triangle(mm(60, 10), mm(90, 10), mm(90, 40));
    expect(
      zones()
        .map((z) => z.GetAssignedPriority())
        .sort(),
    ).toEqual([0, 1]);
  });

  it('Cancel in the dialog draws nothing and the tool stays (zone_create_helper.cpp:142-143)', async () => {
    zoneDialogOk = false;
    h.frame.SetActiveLayer(PCB_LAYER_ID.F_Cu);
    start(PCB_ACTIONS.drawZone);
    click(mm(10, 10));
    await flush();
    click(mm(40, 10));
    await flush();
    click(mm(40, 40));
    await flush();
    click(mm(10, 10));
    await flush();
    expect(zones()).toHaveLength(0);
    // Refused, the outline never starts: every click asks again.
    expect(zoneDialogs).toHaveLength(4);
    expect(tool.GetDrawingMode()).toBe(DRAWING_MODE.ZONE);
  });

  it('a rule area asks the rule-area dialog and is a rule area (:3448-3449, :135-136)', async () => {
    h.frame.SetActiveLayer(PCB_LAYER_ID.F_Cu);
    start(PCB_ACTIONS.drawRuleArea);
    await triangle(mm(10, 10), mm(40, 10), mm(40, 40));
    expect(zoneDialogs[0]).toBeInstanceOf(DIALOG_RULE_AREA_PROPERTIES);
    expect(zones()[0]!.GetIsRuleArea()).toBe(true);
  });

  it('a zone on a non-copper layer asks the non-copper dialog (:139-140)', async () => {
    start(PCB_ACTIONS.drawZone);
    await triangle(mm(10, 10), mm(40, 10), mm(40, 40));
    expect(zoneDialogs[0]).toBeInstanceOf(DIALOG_NON_COPPER_ZONES_EDITOR);
    expect(zones()[0]!.GetLayerSet().Seq()).toEqual([PCB_LAYER_ID.F_SilkS]);
  });

  it('a cutout cuts a hole in the selected zone, without a dialog (:3405-3432, :185-219)', async () => {
    h.frame.SetActiveLayer(PCB_LAYER_ID.F_Cu);
    start(PCB_ACTIONS.drawZone);
    click(mm(10, 10));
    await flush();
    click(mm(50, 10));
    click(mm(50, 50));
    click(mm(10, 50));
    click(mm(10, 10));
    expect(zones()).toHaveLength(1);
    const dialogs = zoneDialogs.length;
    h.mgr.RunAction(ACTIONS.selectItem, zones()[0]!);
    start(PCB_ACTIONS.drawZoneCutout);
    await triangle(mm(20, 20), mm(30, 20), mm(30, 30));
    expect(zoneDialogs).toHaveLength(dialogs);
    expect(zones()).toHaveLength(1);
    expect(zones()[0]!.Outline().HoleCount(0)).toBe(1);
  });

  it('a cutout with no zone selected does nothing (:3418-3428)', () => {
    start(PCB_ACTIONS.drawZoneCutout);
    expect(tool.GetDrawingMode()).toBe(DRAWING_MODE.NONE);
  });

  it('a similar zone copies the source zone, without a dialog (:3463-3464, :160-171)', async () => {
    h.frame.SetActiveLayer(PCB_LAYER_ID.F_Cu);
    start(PCB_ACTIONS.drawZone);
    await triangle(mm(10, 10), mm(40, 10), mm(40, 40));
    const dialogs = zoneDialogs.length;
    h.mgr.RunAction(ACTIONS.selectItem, zones()[0]!);
    start(PCB_ACTIONS.drawSimilarZone);
    await triangle(mm(60, 10), mm(90, 10), mm(90, 40));
    expect(zoneDialogs).toHaveLength(dialogs);
    expect(zones()).toHaveLength(2);
    expect(zones().every((z) => z.GetFirstLayer() === PCB_LAYER_ID.F_Cu)).toBe(true);
  });
});

describe('DRAWING_TOOL::DrawDimension (drawing_tool.cpp:1580-2045)', () => {
  const dims = (): PCB_DIMENSION_BASE[] =>
    h.board.Drawings().filter((d) => d instanceof PCB_DIMENSION_BASE) as PCB_DIMENSION_BASE[];

  it('aligned: origin, end, height - three clicks, then committed and selected (:1690-1846)', () => {
    start(PCB_ACTIONS.drawAlignedDimension);
    click(mm(10, 10));
    click(mm(40, 10));
    expect(dims()).toHaveLength(0);
    move(mm(40, 5));
    click(mm(40, 5));
    expect(dims()).toHaveLength(1);
    const d = dims()[0]! as PCB_DIM_ALIGNED;
    expect(d.Type()).toBe(KICAD_T.PCB_DIM_ALIGNED_T);
    expect(d.GetStart()).toEqual(mm(10, 10));
    expect(d.GetEnd()).toEqual(mm(40, 10));
    expect(d.GetHeight()).toBe(-5 * MM);
    expect(d.GetLayer()).toBe(PCB_LAYER_ID.F_SilkS);
    expect(d.IsSelected()).toBe(true);
  });

  it('a centre mark needs two clicks, the end on 45 degrees (:1823-1832, :1876)', () => {
    start(PCB_ACTIONS.drawCenterDimension);
    click(mm(50, 50));
    move(mm(53, 51));
    click(mm(53, 51));
    expect(dims()).toHaveLength(1);
    const d = dims()[0]!;
    expect(d.Type()).toBe(KICAD_T.PCB_DIM_CENTER_T);
    const e = sub(d.GetEnd(), d.GetStart());
    expect(Math.abs(e.x) === Math.abs(e.y) || e.x === 0 || e.y === 0).toBe(true);
  });

  it('origin and end on the same spot is refused: the end is asked again (:1820-1825)', () => {
    start(PCB_ACTIONS.drawAlignedDimension);
    click(mm(10, 10));
    click(mm(10, 10));
    click(mm(30, 10));
    move(mm(30, 15));
    click(mm(30, 15));
    expect(dims()).toHaveLength(1);
    expect(dims()[0]!.GetEnd()).toEqual(mm(30, 10));
  });

  it('orthogonal measures the longer side by default (:1880-1891)', () => {
    start(PCB_ACTIONS.drawOrthogonalDimension);
    click(mm(10, 10));
    move(mm(20, 40));
    click(mm(20, 40));
    // Inside the box the orientation is kept, so it is the SET_END preview's (:1912-1916).
    move(mm(15, 25));
    click(mm(15, 25));
    const d = dims()[0]! as PCB_DIM_ORTHOGONAL;
    expect(d.Type()).toBe(KICAD_T.PCB_DIM_ORTHOGONAL_T);
    expect(d.GetOrientation()).toBe(PCB_DIM_ORTHOGONAL.DIR.VERTICAL);
  });

  it('Esc mid-dimension starts over; a second Esc leaves (:1661-1673)', () => {
    start(PCB_ACTIONS.drawAlignedDimension);
    click(mm(10, 10));
    esc();
    expect(tool.GetDrawingMode()).toBe(DRAWING_MODE.DIMENSION);
    esc();
    expect(tool.GetDrawingMode()).toBe(DRAWING_MODE.NONE);
    expect(dims()).toHaveLength(0);
  });

  it('changeDimensionArrows flips an aligned dimension arrows (:2006-2020)', () => {
    start(PCB_ACTIONS.drawAlignedDimension);
    click(mm(10, 10));
    move(mm(40, 10));
    const before = h.board.GetDesignSettings().m_DimensionArrowLength;
    expect(before).toBeGreaterThan(0);
    h.mgr.RunAction(PCB_ACTIONS.changeDimensionArrows);
    click(mm(40, 10));
    click(mm(40, 5));
    // OUTWARD is the default (pcb_dimension.cpp), so one flip is INWARD.
    expect(dims()[0]!.GetArrowDirection()).toBe(DIM_ARROW_DIRECTION.INWARD);
  });

  it('a radial takes "R " and a leader of three default arrows, NOT the board arrow length (pcb_dimension.cpp:1557-1565)', () => {
    // `m_leaderLength = m_arrowLength * 3` runs in the constructor, on the
    // base class's 50 mil arrow, before SET_ORIGIN applies the board's own.
    h.board.GetDesignSettings().m_DimensionArrowLength = 2 * MM;
    start(PCB_ACTIONS.drawRadialDimension);
    click(mm(10, 10));
    move(mm(20, 10));
    click(mm(20, 10));
    const d = dims()[0]! as PCB_DIM_RADIAL;
    expect(d.Type()).toBe(KICAD_T.PCB_DIM_RADIAL_T);
    expect(d.GetPrefix()).toBe('R ');
    expect(d.GetLeaderLength()).toBe(3 * pcbIUScale.mmToIU(1.27));
    expect(d.GetArrowLength()).toBe(2 * MM);
  });

  it('a leader is an override reading "Leader" with no unit suffix (pcb_dimension.cpp:1361-1370)', () => {
    start(PCB_ACTIONS.drawLeader);
    click(mm(10, 10));
    move(mm(20, 10));
    click(mm(20, 10));
    const d = dims()[0]!;
    expect(d.Type()).toBe(KICAD_T.PCB_DIM_LEADER_T);
    expect(d.GetOverrideTextEnabled()).toBe(true);
    expect(d.GetOverrideText()).toBe('Leader');
    expect(d.GetUnitsFormat()).toBe(DIM_UNITS_FORMAT.NO_SUFFIX);
    expect(d.GetText()).toBe('Leader');
  });

  it('a centre mark snaps to 45 degrees whatever the snap mode (:1872, constrainDimension)', () => {
    // |x| 3 > |y| 1 * 2: the y component is zeroed.
    start(PCB_ACTIONS.drawCenterDimension);
    click(mm(50, 50));
    move(mm(53, 51));
    click(mm(53, 51));
    expect(sub(dims()[0]!.GetEnd(), dims()[0]!.GetStart())).toEqual(mm(3, 0));
  });

  it('a centre mark near the diagonal goes onto it, keeping the larger axis (:1417)', () => {
    start(PCB_ACTIONS.drawCenterDimension);
    click(mm(50, 50));
    move(mm(60, 58));
    click(mm(60, 58));
    expect(sub(dims()[0]!.GetEnd(), dims()[0]!.GetStart())).toEqual(mm(10, 10));
  });

  it('an aligned end is left free, the default snap mode being DIRECT', () => {
    start(PCB_ACTIONS.drawAlignedDimension);
    click(mm(10, 10));
    move(mm(20, 13));
    click(mm(20, 13));
    move(mm(20, 5));
    click(mm(20, 5));
    expect(dims()[0]!.GetEnd()).toEqual(mm(20, 13));
  });

  it('a dimension on a back layer reads mirrored (SetMirrored( IsBackLayer( layer ) ))', () => {
    h.frame.SetActiveLayer(PCB_LAYER_ID.B_Cu);
    start(PCB_ACTIONS.drawAlignedDimension);
    click(mm(10, 10));
    click(mm(30, 10));
    move(mm(30, 5));
    click(mm(30, 5));
    expect(dims()[0]!.IsMirrored()).toBe(true);
  });
});

describe('DRAWING_TOOL::DrawVia (drawing_tool.cpp:3686-4407)', () => {
  const vias = (): PCB_VIA[] =>
    h.board.Tracks().filter((t) => t.Type() === KICAD_T.PCB_VIA_T) as PCB_VIA[];
  const traces = (): PCB_TRACK[] =>
    h.board.Tracks().filter((t) => t.Type() === KICAD_T.PCB_TRACE_T) as PCB_TRACK[];

  const withTrack = (net: number): void => {
    const t = new PCB_TRACK(h.board);
    t.SetStart(mm(10, 50));
    t.SetEnd(mm(50, 50));
    t.SetWidth(0.25 * MM);
    t.SetLayer(PCB_LAYER_ID.F_Cu);
    t.SetNetCode(net);
    const commit = new BOARD_COMMIT(h.frame);
    commit.Add(t);
    commit.Push('track');
  };

  beforeEach(() => {
    h.board.GetDesignSettings().m_DRCEngine!.InitEngine(null);
    h.frame.SetActiveLayer(PCB_LAYER_ID.F_Cu);
  });

  it('a click places a through via of the current size, with no net in open space (:4361-4397)', () => {
    start(PCB_ACTIONS.drawVia);
    click(mm(80, 80));
    expect(vias()).toHaveLength(1);
    const v = vias()[0]!;
    expect(v.GetPosition()).toEqual(mm(80, 80));
    expect(v.GetViaType()).toBe(VIATYPE.THROUGH);
    expect(v.GetLayerSet().test(PCB_LAYER_ID.F_Cu) && v.GetLayerSet().test(PCB_LAYER_ID.B_Cu)).toBe(
      true,
    );
    const bds = h.board.GetDesignSettings();
    expect(v.GetWidth(PCB_LAYER_ID.F_Cu)).toBe(bds.GetCurrentViaSize());
    expect(v.GetNetCode()).toBe(0);
  });

  it('on a track: takes its net and splits it in two (:4296-4345)', () => {
    withTrack(1);
    start(PCB_ACTIONS.drawVia);
    click(mm(30, 50));
    expect(vias()).toHaveLength(1);
    expect(vias()[0]!.GetNetCode()).toBe(1);
    expect(vias()[0]!.GetPosition()).toEqual(mm(30, 50));
    const ends = traces()
      .map((t) => [t.GetStart().x, t.GetEnd().x].sort((a, b) => a - b))
      .sort((a, b) => a[0]! - b[0]!);
    expect(ends).toEqual([
      [10 * MM, 30 * MM],
      [30 * MM, 50 * MM],
    ]);
  });

  it('a via that would short another net is refused (:4324-4333)', () => {
    withTrack(1);
    start(PCB_ACTIONS.drawVia);
    // Beside the track, within clearance, so it neither snaps to it nor clears it.
    click(mm(30, 50.5));
    expect(vias()).toHaveLength(0);
  });

  it('a via near a track snaps onto it (:4131-4141)', () => {
    withTrack(1);
    start(PCB_ACTIONS.drawVia);
    click(mm(30, 50.2));
    expect(vias()).toHaveLength(1);
    expect(vias()[0]!.GetPosition()).toEqual(mm(30, 50));
  });

  it('places repeatedly: the tool stays for the next via (:4404 IPO_REPEAT)', () => {
    start(PCB_ACTIONS.drawVia);
    click(mm(80, 80));
    click(mm(90, 80));
    expect(vias()).toHaveLength(2);
    expect(tool.GetDrawingMode()).toBe(DRAWING_MODE.VIA);
  });
});

describe('DRAWING_TOOL::DrawBezier (drawing_tool.cpp:566-618, :3084-3398)', () => {
  const beziers = (): PCB_SHAPE[] => shapes().filter((s) => s.GetShape() === SHAPE_T.BEZIER);

  it('start, control 1, end, control 2: one bezier committed (:3227-3256, :3367-3378)', () => {
    start(PCB_ACTIONS.drawBezier);
    click(mm(10, 10));
    click(mm(20, 0));
    click(mm(40, 10));
    click(mm(50, 20));
    const b = beziers().find((x) => x.GetStart().x === 10 * MM)!;
    expect(b).toBeDefined();
    expect(b.GetStart()).toEqual(mm(10, 10));
    expect(b.GetBezierC1()).toEqual(mm(20, 0));
    expect(b.GetEnd()).toEqual(mm(40, 10));
    // setControlC2 stores the click mirrored across the end: 2 * (40,10) - (50,20).
    expect(b.GetBezierC2()).toEqual(mm(30, 0));
    expect(b.GetLayer()).toBe(PCB_LAYER_ID.F_SilkS);
  });

  it('chains: the next starts at the end, its first control the mirror of the last (:600-613)', () => {
    start(PCB_ACTIONS.drawBezier);
    click(mm(10, 10));
    click(mm(20, 0));
    click(mm(40, 10));
    click(mm(50, 20));
    // the chained bezier has start and C1 locked in: end and C2 finish it
    click(mm(70, 10));
    click(mm(80, 0));
    const next = beziers().find((x) => x.GetStart().x === 40 * MM)!;
    expect(next).toBeDefined();
    // end - ( C2 - end ): the mirror of the mirror, the point clicked for C2.
    expect(next.GetBezierC1()).toEqual(mm(50, 20));
  });

  it('a double click finishes with the current point and does not chain (:3258-3276)', () => {
    start(PCB_ACTIONS.drawBezier);
    click(mm(10, 10));
    click(mm(20, 0));
    move(mm(40, 10));
    mouse(h, TA_MOUSE_DBLCLICK, mm(40, 10), BUT_LEFT);
    expect(beziers()).toHaveLength(1);
    expect(beziers()[0]!.GetBezierC2()).toEqual(mm(40, 10));
    // No chain: three more clicks are a fresh start, C1 and end. Chained, the
    // start would be primed (end == C2 here, so no C1) and these three the C1,
    // end and C2, finishing a second one.
    click(mm(60, 60));
    click(mm(70, 60));
    click(mm(80, 60));
    expect(beziers()).toHaveLength(1);
  });

  it('a double click right after the start fills the control and end with that point (:3262-3267)', () => {
    start(PCB_ACTIONS.drawBezier);
    click(mm(10, 10));
    move(mm(40, 10));
    mouse(h, TA_MOUSE_DBLCLICK, mm(40, 10), BUT_LEFT);
    const b = beziers()[0]!;
    expect(b.GetBezierC1()).toEqual(mm(40, 10));
    expect(b.GetEnd()).toEqual(mm(40, 10));
  });

  it('Esc mid-bezier resets; Esc again leaves the tool (:3193-3213)', () => {
    start(PCB_ACTIONS.drawBezier);
    click(mm(10, 10));
    esc();
    expect(tool.GetDrawingMode()).toBe(DRAWING_MODE.BEZIER);
    esc();
    expect(tool.GetDrawingMode()).toBe(DRAWING_MODE.NONE);
    expect(beziers()).toHaveLength(0);
  });
});

describe('DRAWING_TOOL::PlacePoint (drawing_tool.cpp:874-925)', () => {
  it('each click places a point on the active layer, and the tool stays (IPO_REPEAT)', () => {
    start(PCB_ACTIONS.placePoint);
    click(mm(10, 10));
    click(mm(20, 20));
    const points = [...h.board.Points()];
    expect(points).toHaveLength(2);
    expect(points.every((p) => p.GetLayer() === PCB_LAYER_ID.F_SilkS)).toBe(true);
    expect(points.map((p) => p.GetPosition())).toEqual(
      expect.arrayContaining([mm(10, 10), mm(20, 20)]),
    );
    expect(tool.GetDrawingMode()).toBe(DRAWING_MODE.POINT);
  });
});

describe('DRAWING_TOOL::DrawTable (drawing_tool.cpp:1186-1415)', () => {
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
  };
  const tables = (): PCB_TABLE[] =>
    h.board.Drawings().filter((d) => d.Type() === KICAD_T.PCB_TABLE_T) as unknown as PCB_TABLE[];

  it('click, drag out the grid, click: the dialog, then one table committed and selected (:1285-1352)', async () => {
    start(PCB_ACTIONS.drawTable);
    click(mm(10, 10));
    // the layer's text size sets the cell: 15 characters wide, 3 lines high
    const fs = h.board.GetDesignSettings().GetTextSize(PCB_LAYER_ID.F_SilkS);
    const w = (fs.x * 15 * 2.5) / MM;
    const ht = (fs.y * 3 * 2.5) / MM;
    move(mm(10 + w, 10 + ht));
    click(mm(10 + w, 10 + ht));
    await flush();
    expect(tables()).toHaveLength(1);
    const t = tables()[0]!;
    expect(t.GetColCount()).toBe(2);
    expect(t.GetRowCount()).toBe(2);
    expect(t.GetPosition()).toEqual(mm(10, 10));
    expect(t.IsSelected()).toBe(true);
  });

  /** Drag a table from (10, 10) mm to `aTo` mm and commit it; the committed table. */
  const drawn = async (aTo: Vec2): Promise<PCB_TABLE> => {
    start(PCB_ACTIONS.drawTable);
    click(mm(10, 10));
    move(aTo);
    click(aTo);
    await flush();
    return tables()[0]!;
  };

  /** `KiROUND( (double) v / g ) * g`, the cell size's snap to the grid. */
  const snapped = (v: number, g: number): number => Math.round(v / g) * g;

  it('a backwards drag is a 1x1 table of the minimum cell, 5 font-widths by 3 heights (:1366-1373)', async () => {
    const fs = h.board.GetDesignSettings().GetTextSize(PCB_LAYER_ID.F_SilkS);
    const g = h.view.GetGAL().GetGridSize();
    const t = await drawn(mm(2, 3));

    expect([t.GetColCount(), t.GetRowCount()]).toEqual([1, 1]);
    expect(t.GetColWidth(0)).toBe(snapped(fs.x * 5, g.x));
    expect(t.GetRowHeight(0)).toBe(snapped(fs.y * 3, g.y));
  });

  it('counts truncate: one column per 15 font-widths, one row per 3 heights (:1366-1367)', async () => {
    const fs = h.board.GetDesignSettings().GetTextSize(PCB_LAYER_ID.F_SilkS);
    // 3.9 columns' and 2.9 rows' worth of drag: 3 and 2.
    const w = (fs.x * 15 * 3.9) / MM;
    const ht = (fs.y * 3 * 2.9) / MM;
    const t = await drawn(mm(10 + w, 10 + ht));

    expect([t.GetColCount(), t.GetRowCount()]).toEqual([3, 2]);
  });

  it('lays the cells out row-major from the first corner, every cell the same size, on the layer', async () => {
    const fs = h.board.GetDesignSettings().GetTextSize(PCB_LAYER_ID.F_SilkS);
    const g = h.view.GetGAL().GetGridSize();
    const w = (fs.x * 15 * 2.5) / MM;
    const ht = (fs.y * 3 * 2.5) / MM;
    const t = await drawn(mm(10 + w, 10 + ht));
    const req = { x: Math.trunc(w * MM), y: Math.trunc(ht * MM) };
    const cw = snapped(Math.max(fs.x * 5, Math.trunc(req.x / 2)), g.x);
    const ch = snapped(Math.max(fs.y * 3, Math.trunc(req.y / 2)), g.y);
    const cells = t.GetCells();

    expect(cells.map((c) => c.GetPosition())).toEqual([
      mm(10, 10),
      { x: 10 * MM + cw, y: 10 * MM },
      { x: 10 * MM, y: 10 * MM + ch },
      { x: 10 * MM + cw, y: 10 * MM + ch },
    ]);
    for (const c of cells)
      expect(c.GetEnd()).toEqual({ x: c.GetPosition().x + cw, y: c.GetPosition().y + ch });
    expect(t.GetLayer()).toBe(PCB_LAYER_ID.F_SilkS);
  });

  it('PENCIL until the first corner, MOVING while the grid is dragged out (:1203-1210)', () => {
    start(PCB_ACTIONS.drawTable);
    expect(h.shape).toBe(KICURSOR.PENCIL);
    click(mm(10, 10));
    move(mm(30, 20));
    expect(h.shape).toBe(KICURSOR.MOVING);
    esc();
    move(mm(31, 20));
    expect(h.shape).toBe(KICURSOR.PENCIL);
  });

  it('Cancel in the dialog draws nothing (:1323-1326)', async () => {
    tableDialogOk = false;
    start(PCB_ACTIONS.drawTable);
    click(mm(10, 10));
    move(mm(40, 30));
    click(mm(40, 30));
    await flush();
    expect(tables()).toHaveLength(0);
  });

  it('Esc while sizing drops the table; a second Esc leaves (:1255-1265)', () => {
    start(PCB_ACTIONS.drawTable);
    click(mm(10, 10));
    esc();
    expect(tool.GetDrawingMode()).toBe(DRAWING_MODE.TABLE);
    esc();
    expect(tool.GetDrawingMode()).toBe(DRAWING_MODE.NONE);
    expect(tables()).toHaveLength(0);
  });
});

describe('DRAWING_TOOL::PlaceReferenceImage (drawing_tool.cpp:623-872)', () => {
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
  };
  const images = (): PCB_REFERENCE_IMAGE[] =>
    h.board
      .Drawings()
      .filter(
        (d) => d.Type() === KICAD_T.PCB_REFERENCE_IMAGE_T,
      ) as unknown as PCB_REFERENCE_IMAGE[];
  const png = (): Uint8Array =>
    new Uint8Array(
      readFileSync(
        fileURLToPath(new URL('../../../fixtures/png/rgb8_100dpi.png', import.meta.url)),
      ),
    );

  it('the file dialog first, the image rides the cursor, a click places it (:728-819)', async () => {
    imageFile = png();
    h.mouse = mm(20, 20);
    start(PCB_ACTIONS.placeReferenceImage);
    await flush();
    // It rides from the cursor it was chosen at (:748-760)...
    const riding = h.sel.GetSelection().GetItems()[0] as unknown as PCB_REFERENCE_IMAGE;
    expect(riding.GetPosition()).toEqual(mm(20, 20));
    // ...and follows it (:842-848).
    move(mm(50, 50));
    click(mm(50, 50));
    expect(images()).toHaveLength(1);
    const im = images()[0]!;
    expect(im.GetPosition()).toEqual(mm(50, 50));
    expect(im.GetLayer()).toBe(PCB_LAYER_ID.F_SilkS);
    expect(im.IsSelected()).toBe(true);
  });

  it('stays armed after a placement, and a second image joins the first (:812-819)', async () => {
    imageFile = png();
    start(PCB_ACTIONS.placeReferenceImage);
    await flush();
    click(mm(10, 10));
    // `if( !immediateMode ) { ... m_toolMgr->PostAction( ACTIONS::cursorClick ) }`
    // is not in this branch: the tool loops for the next image.
    expect(tool.GetDrawingMode()).toBe(DRAWING_MODE.IMAGE);
    click(mm(30, 30));
    await flush();
    click(mm(30, 30));

    const at = images()
      .map((i) => i.GetPosition())
      .sort((a, b) => a.x - b.x);
    expect(at).toEqual([mm(10, 10), mm(30, 30)]);
  });

  it('ARROW until a file is chosen, MOVING while the image rides (:653-661)', async () => {
    imageFile = null;
    start(PCB_ACTIONS.placeReferenceImage);
    await flush();
    expect(h.shape).toBe(KICURSOR.ARROW);
    imageFile = png();
    click(mm(20, 20));
    await flush();
    expect(h.shape).toBe(KICURSOR.MOVING);
  });

  it('Cancel in the file dialog leaves the tool armed (:742-743)', async () => {
    imageFile = null;
    start(PCB_ACTIONS.placeReferenceImage);
    await flush();
    expect(images()).toHaveLength(0);
    expect(tool.GetDrawingMode()).toBe(DRAWING_MODE.IMAGE);
  });

  it('Esc drops a riding image; a second Esc leaves (:704-713)', async () => {
    imageFile = png();
    start(PCB_ACTIONS.placeReferenceImage);
    await flush();
    esc();
    expect(tool.GetDrawingMode()).toBe(DRAWING_MODE.IMAGE);
    esc();
    expect(tool.GetDrawingMode()).toBe(DRAWING_MODE.NONE);
    expect(images()).toHaveLength(0);
  });
});

describe('DRAWING_TOOL::DrawRectangle as a text box (drawing_tool.cpp:411-470)', () => {
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
  };
  const boxes = (): PCB_SHAPE[] => shapes().filter((x) => x.Type() === KICAD_T.PCB_TEXTBOX_T);

  it('a second click on the first draws no box (:2275-2283)', async () => {
    start(PCB_ACTIONS.drawTextBox);
    click(mm(10, 10));
    click(mm(10, 10));
    await flush();
    expect(boxes()).toHaveLength(0);
  });

  it("on the active layer, its margins the constructor's legacy ones (:426)", async () => {
    h.frame.SetActiveLayer(PCB_LAYER_ID.F_Cu);
    start(PCB_ACTIONS.drawTextBox);
    click(mm(10, 10));
    click(mm(30, 20));
    await flush();
    const b = boxes()[0]! as unknown as PCB_TEXTBOX;
    expect(b.GetLayer()).toBe(PCB_LAYER_ID.F_Cu);
    // PCB_TEXTBOX's constructor sets every margin to GetLegacyTextMargin() of
    // ITS state (pcb_textbox.cpp:59-63); the tool's later text size does not move them.
    const legacy = new PcbTextboxClass(h.board).GetLegacyTextMargin();
    expect([b.GetMarginLeft(), b.GetMarginTop(), b.GetMarginRight(), b.GetMarginBottom()]).toEqual([
      legacy,
      legacy,
      legacy,
      legacy,
    ]);
  });

  it('two corners, then the dialog: OK commits a normalized text box, selected (:448-461)', async () => {
    start(PCB_ACTIONS.drawTextBox);
    click(mm(30, 30));
    click(mm(10, 20));
    await flush();
    expect(boxes()).toHaveLength(1);
    const b = boxes()[0]!;
    expect(b.GetStart()).toEqual(mm(10, 20));
    expect(b.GetEnd()).toEqual(mm(30, 30));
    expect(b.IsSelected()).toBe(true);
  });

  it('Cancel in the dialog drops the box (:448-454)', async () => {
    textBoxOk = false;
    start(PCB_ACTIONS.drawTextBox);
    click(mm(30, 30));
    click(mm(10, 20));
    await flush();
    expect(boxes()).toHaveLength(0);
    expect(tool.GetDrawingMode()).toBe(DRAWING_MODE.RECTANGLE);
  });
});

describe('DRAWING_TOOL::DrawBarcode (drawing_tool.cpp:1425-1577)', () => {
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
  };
  const barcodes = (): PCB_BARCODE[] =>
    h.board
      .Drawings()
      .filter((d) => d.Type() === KICAD_T.PCB_BARCODE_T) as unknown as PCB_BARCODE[];

  it('a click builds the barcode at the cursor and opens the dialog; OK commits it, selected (:1520-1560)', async () => {
    start(PCB_ACTIONS.placeBarcode);
    expect(h.shape).toBe(KICURSOR.PENCIL);
    click(mm(30, 20));
    await flush();
    expect(barcodes()).toHaveLength(1);
    const b = barcodes()[0]!;
    expect(b.GetPosition()).toEqual(mm(30, 20));
    expect(b.GetLayer()).toBe(PCB_LAYER_ID.F_SilkS);
    expect(b.GetTextSize()).toBe(h.board.GetDesignSettings().GetTextSize(PCB_LAYER_ID.F_SilkS).y);
    expect(b.GetText()).toBe('ZIRO');
    expect(b.IsSelected()).toBe(true);
    expect(b.IsNew()).toBe(false);
    // one dialog per click: the tool stays armed for the next barcode
    expect(tool.GetDrawingMode()).toBe(DRAWING_MODE.BARCODE);
  });

  it('Cancel in the dialog adds nothing, and the tool stays (:1542-1546)', async () => {
    barcodeOk = false;
    start(PCB_ACTIONS.placeBarcode);
    click(mm(30, 20));
    await flush();
    expect(barcodes()).toHaveLength(0);
    expect(tool.GetDrawingMode()).toBe(DRAWING_MODE.BARCODE);
    esc();
    expect(tool.GetDrawingMode()).toBe(DRAWING_MODE.NONE);
  });
});

describe('DRAWING_TOOL::PlaceImportedGraphics (drawing_tool.cpp:2044-2230)', () => {
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
  };
  /** A segment as GRAPHICS_IMPORTER_PCBNEW builds one, parented to the board. */
  const seg = (a: Vec2, b: Vec2): PCB_SHAPE => {
    const l = new PCB_SHAPE(h.board, SHAPE_T.SEGMENT);
    l.SetLayer(PCB_LAYER_ID.Dwgs_User);
    l.SetStart(a);
    l.SetEnd(b);
    return l;
  };
  const result = (
    aItems: BOARD_ITEM[],
    aOpts: Partial<Omit<IMPORT_GRAPHICS_RESULT, 'items'>> = {},
  ): IMPORT_GRAPHICS_RESULT => ({
    items: aItems,
    groupItems: true,
    interactive: false,
    fixDiscontinuities: false,
    tolerance: pcbIUScale.mmToIU(1),
    ...aOpts,
  });
  const groups = (): BOARD_ITEM[] => h.board.Groups() as unknown as BOARD_ITEM[];

  it('placed at the file origin: everything committed at once, in one new group, selected (:2083-2149)', async () => {
    const a = seg(mm(0, 0), mm(10, 0));
    const b = seg(mm(10, 0), mm(10, 10));
    importResult = result([a, b]);
    const before = shapes().length;
    start(PCB_ACTIONS.placeImportedGraphics);
    await flush();
    expect(shapes()).toHaveLength(before + 2);
    expect(groups()).toHaveLength(1);
    expect(a.GetParentGroup()).toBe(groups()[0]);
    expect(groups()[0]!.IsSelected()).toBe(true);
    expect(a.GetStart()).toEqual(mm(0, 0));
    expect(h.frame.GetUndoCommandCount()).toBe(1);
  });

  it('one item, or Group unchecked, makes no group and selects the items themselves (:2085-2096)', async () => {
    const a = seg(mm(0, 0), mm(10, 0));
    const b = seg(mm(10, 0), mm(10, 10));
    importResult = result([a, b], { groupItems: false });
    start(PCB_ACTIONS.placeImportedGraphics);
    await flush();
    expect(groups()).toHaveLength(0);
    expect(a.IsSelected() && b.IsSelected()).toBe(true);
  });

  it('a single item is not worth a group, even with Group checked (:2087)', async () => {
    const a = seg(mm(0, 0), mm(10, 0));
    importResult = result([a]);
    start(PCB_ACTIONS.placeImportedGraphics);
    await flush();
    expect(groups()).toHaveLength(0);
    expect(a.IsSelected()).toBe(true);
  });

  it('Fix discontinuities welds the imported shapes at the tolerance (:2098-2108)', async () => {
    // A corner 1 um short: extended to where the two lines cross.
    const a = seg(mm(0, 0), { x: 9_999_000, y: 0 });
    const b = seg(mm(10, 0), mm(10, 10));
    importResult = result([a, b], { fixDiscontinuities: true });
    start(PCB_ACTIONS.placeImportedGraphics);
    await flush();
    expect(a.GetEnd()).toEqual(mm(10, 0));
  });

  it('interactive: the drawing rides the cursor by its top-left item, and a click commits it (:2158-2205)', async () => {
    const a = seg(mm(0, 0), mm(10, 0));
    const b = seg(mm(0, 5), mm(10, 5));
    importResult = result([a, b], { interactive: true });
    h.mouse = mm(40, 40);
    const before = shapes().length;
    start(PCB_ACTIONS.placeImportedGraphics);
    await flush();
    expect(h.shape).toBe(KICURSOR.MOVING);
    expect(shapes()).toHaveLength(before);
    move(mm(50, 60));
    expect(a.GetStart()).toEqual(mm(50, 60));
    expect(b.GetStart()).toEqual(mm(50, 65));
    click(mm(50, 60));
    expect(shapes()).toHaveLength(before + 2);
    expect(h.frame.GetUndoCommandCount()).toBe(1);
  });

  it('interactive: Esc throws the drawing away (:2183-2194)', async () => {
    importResult = result([seg(mm(0, 0), mm(10, 0)), seg(mm(0, 5), mm(10, 5))], {
      interactive: true,
    });
    const before = shapes().length;
    start(PCB_ACTIONS.placeImportedGraphics);
    await flush();
    esc();
    expect(shapes()).toHaveLength(before);
    expect(groups()).toHaveLength(0);
    expect(h.frame.GetUndoCommandCount()).toBe(0);
  });

  it('Cancel in the dialog changes nothing (:2061-2062)', async () => {
    importResult = null;
    const before = shapes().length;
    start(PCB_ACTIONS.placeImportedGraphics);
    await flush();
    expect(shapes()).toHaveLength(before);
  });
});
