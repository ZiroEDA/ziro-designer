// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SCH_MOVE_TOOL (tools/sch_move_tool.cpp) and SCH_LINE_WIRE_BUS_TOOL (tools/sch_line_wire_bus_tool.cpp)
 * on the live model, driven through the frame's TOOL_MANAGER, with SCH_EDIT_FRAME::TrimWire.
 */
import { resolve } from 'node:path';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { TA_MOUSE_MOTION } from '@ziroeda/common/tool/tool_event.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { SCH_COMMIT } from '@ziroeda/eeschema/sch_commit.js';
import { SCH_LINE } from '@ziroeda/eeschema/sch_line.js';
import type { SCH_SYMBOL } from '@ziroeda/eeschema/sch_symbol.js';
import { SCH_ACTIONS } from '@ziroeda/eeschema/tools/sch_actions.js';
import { SCH_LINE_WIRE_BUS_TOOL } from '@ziroeda/eeschema/tools/sch_line_wire_bus_tool.js';
import { SCH_SELECTION_TOOL } from '@ziroeda/eeschema/tools/sch_selection_tool.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  click,
  mouse,
  openProject,
  type SCH_HARNESS,
  schToolHarness,
} from './support/sch_tool_harness.js';

const ORACLE = resolve(__dirname, '../../data/eeschema/netlist_oracle/complex_hierarchy');
const SHEETS = ['complex_hierarchy.kicad_sch', 'ampli_ht.kicad_sch', 'complex_hierarchy.kicad_pro'];
const MIL = 254;
const G = 50 * MIL; // the 50 mil grid

beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => SetPgm(null));

function setUp() {
  const h = schToolHarness();
  openProject(h.frame, ORACLE, 'complex_hierarchy', SHEETS);
  const sub = h.frame
    .Schematic()
    .Hierarchy()
    .find((p) => p.size() === 2)!;
  h.frame.SetCurrentSheet(sub);
  const mgr = h.frame.GetToolManager()!;
  return { ...h, mgr, sel: mgr.GetTool(SCH_SELECTION_TOOL)! };
}

const lone = (h: SCH_HARNESS) =>
  ([...h.frame.GetScreen()!.Items().OfType(KICAD_T.SCH_SYMBOL_T)] as SCH_SYMBOL[]).filter(
    (s) => !s.GetLibSymbolRef()?.IsPower(),
  )[0]!;

const at = (p: { x: number; y: number }, q: { x: number; y: number }) => p.x === q.x && p.y === q.y;

const wiresAt = (h: SCH_HARNESS, p: { x: number; y: number }) =>
  ([...h.frame.GetScreen()!.Items().OfType(KICAD_T.SCH_LINE_T)] as SCH_LINE[]).filter(
    (l) => l.IsWire() && (at(l.GetStartPoint(), p) || at(l.GetEndPoint(), p)),
  );

describe('SCH_MOVE_TOOL', () => {
  it('moves the selected symbol by the cursor travel, on the grid, as one undo step', () => {
    const h = setUp();
    const sym = lone(h);
    const before = sym.GetPosition();
    const undo = h.frame.GetUndoCommandCount();
    h.sel.AddItemToSel(sym, true);
    h.h.mouse = before;
    h.mgr.RunAction(SCH_ACTIONS.move);
    mouse(h, TA_MOUSE_MOTION, { x: before.x + 4 * G, y: before.y + 2 * G });
    click(h, { x: before.x + 4 * G, y: before.y + 2 * G });
    expect(sym.GetPosition()).toEqual({ x: before.x + 4 * G, y: before.y + 2 * G });
    expect(h.frame.GetUndoCommandCount()).toBe(undo + 1);
  });

  it('puts everything back on Escape', () => {
    const h = setUp();
    const sym = lone(h);
    const before = sym.GetPosition();
    h.sel.AddItemToSel(sym, true);
    h.h.mouse = before;
    h.mgr.RunAction(SCH_ACTIONS.move);
    mouse(h, TA_MOUSE_MOTION, { x: before.x + 6 * G, y: before.y });
    h.mgr.RunAction(ACTIONS.cancelInteractive);
    expect(sym.GetPosition()).toEqual(before);
  });

  it('drags the wires hanging off a symbol, keeping them attached', () => {
    const h = setUp();
    const sym = lone(h);
    const pin = sym.GetPins().find((p) => wiresAt(h, p.GetPosition()).length > 0)!;
    const pinAt = pin.GetPosition();
    const before = sym.GetPosition();
    h.sel.AddItemToSel(sym, true);
    h.h.mouse = before;
    h.mgr.RunAction(SCH_ACTIONS.drag);
    mouse(h, TA_MOUSE_MOTION, { x: before.x + 2 * G, y: before.y });
    click(h, { x: before.x + 2 * G, y: before.y });
    const moved = { x: pinAt.x + 2 * G, y: pinAt.y };
    expect(pin.GetPosition()).toEqual(moved);
    // the wire (or a bend added for it) still meets the pin
    expect(wiresAt(h, moved).length).toBeGreaterThan(0);
  });

  it('leaves a moved wire unattached: a move is not a drag', () => {
    const h = setUp();
    const sym = lone(h);
    const pin = sym.GetPins().find((p) => wiresAt(h, p.GetPosition()).length > 0)!;
    const pinAt = pin.GetPosition();
    const before = sym.GetPosition();
    h.sel.AddItemToSel(sym, true);
    h.h.mouse = before;
    h.mgr.RunAction(SCH_ACTIONS.move);
    mouse(h, TA_MOUSE_MOTION, { x: before.x + 2 * G, y: before.y });
    click(h, { x: before.x + 2 * G, y: before.y });
    expect(wiresAt(h, pinAt).length).toBeGreaterThan(0); // the wire stayed where it was
    expect(wiresAt(h, { x: pinAt.x + 2 * G, y: pinAt.y })).toHaveLength(0);
  });
});

describe('SCH_LINE_WIRE_BUS_TOOL', () => {
  it('draws a wire from the cursor, bending on a click, and finishes', () => {
    const h = setUp();
    const start = { x: 1000 * G, y: 1000 * G }; // well off the sheet's items
    const old = new Set(h.frame.GetScreen()!.Items().OfType(KICAD_T.SCH_LINE_T));
    // The hotkey's action carries the cursor position: the wire starts there.
    h.h.mouse = start;
    h.mgr.RunAction(SCH_ACTIONS.drawWire);
    mouse(h, TA_MOUSE_MOTION, { x: start.x + 10 * G, y: start.y });
    click(h, { x: start.x + 10 * G, y: start.y });
    mouse(h, TA_MOUSE_MOTION, { x: start.x + 10 * G, y: start.y + 5 * G });
    h.mgr.RunAction(ACTIONS.finishInteractive);
    const added = (
      [...h.frame.GetScreen()!.Items().OfType(KICAD_T.SCH_LINE_T)] as SCH_LINE[]
    ).filter((l) => !old.has(l));
    const segs = added.map((l) => [l.GetStartPoint(), l.GetEndPoint()]);
    expect(segs).toEqual([
      [start, { x: start.x + 10 * G, y: start.y }],
      [
        { x: start.x + 10 * G, y: start.y },
        { x: start.x + 10 * G, y: start.y + 5 * G },
      ],
    ]);
    expect(added.every((l) => l.IsWire() && !l.IsNew())).toBe(true);
  });

  it('AddJunction breaks the wire it lands on in two', () => {
    const h = setUp();
    const screen = h.frame.GetScreen()!;
    const w = new SCH_LINE({ x: 0, y: 0 }, SCH_LAYER_ID.LAYER_WIRE);
    w.SetEndPoint({ x: 20 * G, y: 0 });
    h.frame.AddToScreen(w, screen);
    // A wire ending on it makes a T: the junction is needed and survives the commit's cleanup.
    const t = new SCH_LINE({ x: 8 * G, y: 0 }, SCH_LAYER_ID.LAYER_WIRE);
    t.SetEndPoint({ x: 8 * G, y: 10 * G });
    h.frame.AddToScreen(t, screen);
    const lwb = h.mgr.GetTool(SCH_LINE_WIRE_BUS_TOOL)!;
    const commit = new SCH_COMMIT(h.frame);
    lwb.AddJunction(commit, screen, { x: 8 * G, y: 0 });
    commit.Push('j');
    expect(wiresAt(h, { x: 8 * G, y: 0 })).toHaveLength(3); // the two halves and the T
    expect(
      [...screen.Items().OfType(KICAD_T.SCH_JUNCTION_T)].some((j) =>
        at(j.GetPosition(), { x: 8 * G, y: 0 }),
      ),
    ).toBe(true);
  });

  it('TrimWire removes only the stretch between two points', () => {
    const h = setUp();
    const screen = h.frame.GetScreen()!;
    const w = new SCH_LINE({ x: 0, y: 2000 * G }, SCH_LAYER_ID.LAYER_WIRE);
    w.SetEndPoint({ x: 20 * G, y: 2000 * G });
    h.frame.AddToScreen(w, screen);
    const commit = new SCH_COMMIT(h.frame);
    expect(h.frame.TrimWire(commit, { x: 5 * G, y: 2000 * G }, { x: 10 * G, y: 2000 * G })).toBe(
      true,
    );
    commit.Push('t');
    const left = ([...screen.Items().OfType(KICAD_T.SCH_LINE_T)] as SCH_LINE[]).filter(
      (l) => l.GetStartPoint().y === 2000 * G,
    );
    const spans = left
      .map((l) => [
        Math.min(l.GetStartPoint().x, l.GetEndPoint().x),
        Math.max(l.GetStartPoint().x, l.GetEndPoint().x),
      ])
      .sort((a, b) => a[0]! - b[0]!);
    expect(spans).toEqual([
      [0, 5 * G],
      [10 * G, 20 * G],
    ]);
    // an entire wire is never removed
    expect(
      h.frame.TrimWire(new SCH_COMMIT(h.frame), { x: 0, y: 2000 * G }, { x: 5 * G, y: 2000 * G }),
    ).toBe(false);
  });
});
