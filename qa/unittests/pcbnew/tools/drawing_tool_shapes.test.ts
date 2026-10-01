// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DRAWING_TOOL's shape tools on a live BOARD: DrawLine, DrawRectangle,
 * DrawCircle and DrawArc through drawShape / drawArc (drawing_tool.cpp),
 * driven by mouse events through the TOOL_MANAGER. Each expectation cites
 * its line.
 */
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
import type { PCB_SHAPE } from '@ziroeda/pcbnew/pcb_shape.js';
import type { DIALOG_TEXT_PROPERTIES } from '@ziroeda/pcbnew/dialogs/dialog_text_properties.js';
import type { PCB_TEXT } from '@ziroeda/pcbnew/pcb_text.js';
import { DIALOG_NON_COPPER_ZONES_EDITOR } from '@ziroeda/pcbnew/dialogs/dialog_non_copper_zones_properties.js';
import { DIALOG_RULE_AREA_PROPERTIES } from '@ziroeda/pcbnew/dialogs/dialog_rule_area_properties.js';
import { DIALOG_COPPER_ZONE } from '@ziroeda/pcbnew/dialogs/panel_zone_properties.js';
import type { ZONE } from '@ziroeda/pcbnew/zone.js';
import {
  PCB_DIMENSION_BASE,
  type PCB_DIM_ALIGNED,
  PCB_DIM_ORTHOGONAL,
} from '@ziroeda/pcbnew/pcb_dimension.js';
import { DIM_ARROW_DIRECTION } from '@ziroeda/pcbnew/pcb_dimension_types.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { sub } from '@ziroeda/kimath/src/math/vector2.js';
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
)
`;

/** The text dialog's answer: the text typed, or null for Cancel. */
let dialogText: string | null = 'HELLO';

/** The zone dialogs the tool asked for, and whether they answer OK. */
let zoneDialogs: unknown[] = [];
let zoneDialogOk = true;

class TEXT_FRAME extends TEST_PCB_FRAME {
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
});
