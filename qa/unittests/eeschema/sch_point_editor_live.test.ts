// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SCH_POINT_EDITOR (tools/sch_point_editor.cpp) on the TOOL_MANAGER: selecting one editable item
 * gives it handles; dragging one runs the item's POINT_EDIT_BEHAVIOR and pushes one "Move Point".
 */
import { resolve } from 'node:path';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { ARC_EDIT_MODE } from '@ziroeda/common/frame_type.js';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { TA_MOUSE_MOTION } from '@ziroeda/common/tool/tool_event.js';
import {
  EESCHEMA_DEFAULTS,
  type EeschemaSettings,
  setEeschemaSettingsProvider,
  setUpdateEeschemaSettingsProvider,
} from '@ziroeda/eeschema/eeschema_settings.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { SCH_LINE } from '@ziroeda/eeschema/sch_line.js';
import { SCH_SHAPE } from '@ziroeda/eeschema/sch_shape.js';
import { SCH_SHEET } from '@ziroeda/eeschema/sch_sheet.js';
import { SCH_ACTIONS } from '@ziroeda/eeschema/tools/sch_actions.js';
import { SCH_POINT_EDITOR } from '@ziroeda/eeschema/tools/sch_point_editor.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { drag, mouse, openProject, schFrame, schToolHarness } from './support/sch_tool_harness.js';

const ORACLE = resolve(__dirname, '../../data/eeschema/netlist_oracle/complex_hierarchy');
const SHEETS = ['complex_hierarchy.kicad_sch', 'ampli_ht.kicad_sch', 'complex_hierarchy.kicad_pro'];
const G = 50 * 254;
const FAR = 3000 * G;
const P = (x: number, y: number) => ({ x: FAR + x * G, y: FAR + y * G });

beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => {
  SetPgm(null);
  setEeschemaSettingsProvider(() => EESCHEMA_DEFAULTS);
  setUpdateEeschemaSettingsProvider(() => {});
});

function setUp() {
  const h = schToolHarness(schFrame({}));
  openProject(h.frame, ORACLE, 'complex_hierarchy', SHEETS);
  h.frame.SetCurrentSheet(
    h.frame
      .Schematic()
      .Hierarchy()
      .find((p) => p.size() === 1)!,
  );
  const mgr = h.frame.GetToolManager()!;
  const add = <T extends EDA_ITEM>(aItem: T): T => {
    h.frame.AddToScreen(aItem as never, h.frame.GetScreen());
    return aItem;
  };
  // Selecting posts SelectedEvent, which starts the point editor's Main().
  const select = (aItem: EDA_ITEM) => {
    h.h.mouse = P(-500, -500);
    mgr.RunAction(ACTIONS.selectionClear);
    mgr.RunAction(ACTIONS.selectItem, aItem);
  };
  const editor = mgr.GetTool(SCH_POINT_EDITOR)!;
  return { ...h, mgr, add, select, editor };
}

function rect(x0: number, y0: number, x1: number, y1: number): SCH_SHAPE {
  const r = new SCH_SHAPE(SHAPE_T.RECTANGLE);
  r.SetPosition(P(x0, y0));
  r.SetEnd(P(x1, y1));
  return r;
}

describe('SCH_POINT_EDITOR', () => {
  it('drags a rectangle corner, pinning the opposite one, as one undo step', () => {
    const h = setUp();
    const r = h.add(rect(0, 0, 10, 6));
    h.select(r);
    const undo = h.frame.GetUndoCommandCount();

    drag(h, P(10, 6), P(14, 9));

    expect(r.GetPosition()).toEqual(P(0, 0));
    expect(r.GetEnd()).toEqual(P(14, 9));
    expect(h.frame.GetUndoCommandCount()).toBe(undo + 1);
  });

  it('drags a rectangle edge, moving only that side', () => {
    const h = setUp();
    const r = h.add(rect(0, 0, 10, 6));
    h.select(r);

    // The midpoint of the top edge, dragged up: the edge's EC_PERPLINE keeps it horizontal.
    drag(h, P(5, 0), P(5, -3));

    expect(r.GetPosition()).toEqual(P(0, -3));
    expect(r.GetEnd()).toEqual(P(10, 6));
  });

  it('a graphic line drags the graphic line joined to the moved end', () => {
    const h = setUp();
    const a = new SCH_LINE(P(0, 0), SCH_LAYER_ID.LAYER_NOTES);
    a.SetEndPoint(P(10, 0));
    const b = new SCH_LINE(P(10, 0), SCH_LAYER_ID.LAYER_NOTES);
    b.SetEndPoint(P(10, 10));
    // A wire at the same spot is no graphic line: it stays.
    const w = new SCH_LINE(P(10, 0), SCH_LAYER_ID.LAYER_WIRE);
    w.SetEndPoint(P(20, 0));
    h.add(a);
    h.add(b);
    h.add(w);
    h.select(a);

    drag(h, P(10, 0), P(12, 2));

    expect(a.GetEndPoint()).toEqual(P(12, 2));
    expect(b.GetStartPoint()).toEqual(P(12, 2));
    expect(b.GetEndPoint()).toEqual(P(10, 10));
    expect(w.GetStartPoint()).toEqual(P(10, 0));
  });

  it('resizes a sheet from its bottom-right corner, keeping its position', () => {
    const h = setUp();
    const sheet = h.add(new SCH_SHEET(null, P(0, 0), { x: 20 * G, y: 16 * G }));
    h.select(sheet);

    drag(h, P(20, 16), P(30, 24));

    expect(sheet.GetPosition()).toEqual(P(0, 0));
    expect(sheet.GetSize()).toEqual({ x: 30 * G, y: 24 * G });
  });

  it('removes the hovered corner of a polygon, and adds one on the nearest segment', () => {
    const h = setUp();
    const poly = new SCH_SHAPE(SHAPE_T.POLY);
    for (const [x, y] of [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ] as const)
      poly.AddPoint(P(x, y));
    h.add(poly);
    h.select(poly);

    // Hover the corner at (10, 10): the editor makes it the edited point.
    mouse(h, TA_MOUSE_MOTION, P(10, 10));
    expect(h.editor.HasPoint()).toBe(true);
    h.mgr.RunAction(SCH_ACTIONS.pointEditorRemoveCorner);
    expect(poly.GetPolyShape().Outline(0).CPoints()).toEqual([P(0, 0), P(10, 0), P(0, 10)]);

    // A cursor on the segment (10,0)-(0,10), away from any point, inserts after (10, 0).
    mouse(h, TA_MOUSE_MOTION, P(5, 5));
    h.mgr.RunAction(SCH_ACTIONS.pointEditorAddCorner);
    expect(poly.GetPolyShape().Outline(0).CPoints()).toEqual([
      P(0, 0),
      P(10, 0),
      P(5, 5),
      P(0, 10),
    ]);
  });

  it('a hovered point is HasPoint(); away from every point is not', () => {
    const h = setUp();
    const r = h.add(rect(0, 0, 10, 6));
    h.select(r);

    mouse(h, TA_MOUSE_MOTION, P(0, 6));
    expect(h.editor.HasPoint()).toBe(true);
    mouse(h, TA_MOUSE_MOTION, P(40, 40));
    expect(h.editor.HasPoint()).toBe(false);
  });

  it('cycleArcEditMode writes the next mode to eeschema.json; a keep-centre event sets it', () => {
    const h = setUp();
    let cfg: EeschemaSettings = structuredClone(EESCHEMA_DEFAULTS);
    setEeschemaSettingsProvider(() => cfg);
    setUpdateEeschemaSettingsProvider((mutate) => {
      const next = structuredClone(cfg);
      mutate(next);
      cfg = next;
    });

    h.mgr.RunAction(ACTIONS.cycleArcEditMode);
    // IncrementArcEditMode's order (point_editor_behavior.cpp): centre, centre-ends, endpoints.
    expect(cfg.drawing.arc_edit_mode).toBe(ARC_EDIT_MODE.KEEP_CENTER_ENDS_ADJUST_ANGLE);
    h.mgr.RunAction(ACTIONS.cycleArcEditMode);
    expect(cfg.drawing.arc_edit_mode).toBe(ARC_EDIT_MODE.KEEP_ENDPOINTS_OR_START_DIRECTION);

    h.mgr.RunAction(ACTIONS.pointEditorArcKeepCenter);
    expect(cfg.drawing.arc_edit_mode).toBe(ARC_EDIT_MODE.KEEP_CENTER_ADJUST_ANGLE_RADIUS);
  });
});
