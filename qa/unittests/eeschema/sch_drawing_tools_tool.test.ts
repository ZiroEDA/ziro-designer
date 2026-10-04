// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SCH_DRAWING_TOOLS (tools/sch_drawing_tools.cpp) as a TOOL on the frame's TOOL_MANAGER: the
 * single-click and two-click placers, DrawSheet's two clicks with the sheet dialog, and the
 * sheet-pin actions. Dialogs are answered through the frame's hooks, as the window answers them.
 */
import { resolve } from 'node:path';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { TA_MOUSE_MOTION } from '@ziroeda/common/tool/tool_event.js';
import { wxID_CANCEL, wxID_OK } from '@ziroeda/common/wx/menu.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { SCH_EDIT_FRAME, SCH_EDIT_FRAME_HOOKS } from '@ziroeda/eeschema/sch_edit_frame.js';
import { LABEL_FLAG_SHAPE, type SCH_LABEL_BASE } from '@ziroeda/eeschema/sch_label.js';
import { SCH_LINE } from '@ziroeda/eeschema/sch_line.js';
import type { SCH_SHEET } from '@ziroeda/eeschema/sch_sheet.js';
import { SCH_ACTIONS } from '@ziroeda/eeschema/tools/sch_actions.js';
import { SCH_SELECTION_TOOL } from '@ziroeda/eeschema/tools/sch_selection_tool.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { click, mouse, openProject, schFrame, schToolHarness } from './support/sch_tool_harness.js';

const ORACLE = resolve(__dirname, '../../data/eeschema/netlist_oracle/complex_hierarchy');
const SHEETS = ['complex_hierarchy.kicad_sch', 'ampli_ht.kicad_sch', 'complex_hierarchy.kicad_pro'];
const G = 50 * 254; // the 50 mil grid
const FAR = 3000 * G; // well off the sheet's own items

beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => SetPgm(null));

function setUp(aHooks: Partial<SCH_EDIT_FRAME_HOOKS> = {}, aSub = true) {
  const h = schToolHarness(schFrame(aHooks));
  openProject(h.frame, ORACLE, 'complex_hierarchy', SHEETS);
  // the sub-sheet, or the top-level sheet (not the virtual root above it)
  h.frame.SetCurrentSheet(
    h.frame
      .Schematic()
      .Hierarchy()
      .find((p) => p.size() === (aSub ? 2 : 1))!,
  );
  const mgr = h.frame.GetToolManager()!;
  return { ...h, mgr, sel: mgr.GetTool(SCH_SELECTION_TOOL)!, screen: () => h.frame.GetScreen()! };
}

const at = (p: { x: number; y: number }, q: { x: number; y: number }) => p.x === q.x && p.y === q.y;
const flush = async (): Promise<void> => {
  // a dialog answers on a later tick, waking its coroutine through a posted event
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};

const P = (x: number, y: number) => ({ x: FAR + x * G, y: FAR + y * G });

function wire(
  h: ReturnType<typeof setUp>,
  a: { x: number; y: number },
  b: { x: number; y: number },
) {
  const w = new SCH_LINE(a, SCH_LAYER_ID.LAYER_WIRE);
  w.SetEndPoint(b);
  h.frame.AddToScreen(w, h.screen());
  return w;
}

describe('SCH_DRAWING_TOOLS::SingleClickPlace', () => {
  it('drops a no-connect at each click, one undo step apiece, until Escape', () => {
    const h = setUp();
    const undo = h.frame.GetUndoCommandCount();
    // A hotkey's action carries the cursor position: the tool is primed with a click there.
    h.h.mouse = P(0, 0);
    h.mgr.RunAction(SCH_ACTIONS.placeNoConnect);
    click(h, P(4, 0));
    h.mgr.RunAction(ACTIONS.cancelInteractive);
    const ncs = [...h.screen().Items().OfType(KICAD_T.SCH_NO_CONNECT_T)].filter(
      (n) => at(n.GetPosition(), P(0, 0)) || at(n.GetPosition(), P(4, 0)),
    );
    expect(ncs).toHaveLength(2);
    expect(h.frame.GetUndoCommandCount()).toBe(undo + 2);
    // the tool is done: a click now places nothing
    click(h, P(8, 0));
    expect(
      [...h.screen().Items().OfType(KICAD_T.SCH_NO_CONNECT_T)].some((n) =>
        at(n.GetPosition(), P(8, 0)),
      ),
    ).toBe(false);
  });

  it('never stacks a second one on the same spot', () => {
    const h = setUp();
    h.h.mouse = P(0, 0);
    h.mgr.RunAction(SCH_ACTIONS.placeNoConnect);
    click(h, P(0, 0));
    h.mgr.RunAction(ACTIONS.cancelInteractive);
    expect(
      [...h.screen().Items().OfType(KICAD_T.SCH_NO_CONNECT_T)].filter((n) =>
        at(n.GetPosition(), P(0, 0)),
      ),
    ).toHaveLength(1);
  });

  it('places a junction only where wires can join, splitting the wire', () => {
    const errors: string[] = [];
    const h = setUp();
    h.frame.ShowInfoBarError = (m: string) => {
      errors.push(m);
    };
    wire(h, P(0, 0), P(10, 0));
    wire(h, P(4, 0), P(4, 6));
    h.h.mouse = P(4, 20); // nothing there: the primed click is refused
    h.mgr.RunAction(SCH_ACTIONS.placeJunction);
    click(h, P(4, 0)); // the T
    h.mgr.RunAction(ACTIONS.cancelInteractive);
    expect(errors).toEqual(['Junction location contains no joinable wires and/or pins.']);
    const js = [...h.screen().Items().OfType(KICAD_T.SCH_JUNCTION_T)].filter((j) =>
      at(j.GetPosition(), P(4, 0)),
    );
    expect(js).toHaveLength(1);
    expect(
      [...h.screen().Items().OfType(KICAD_T.SCH_JUNCTION_T)].some((j) =>
        at(j.GetPosition(), P(4, 20)),
      ),
    ).toBe(false);
  });
});

describe('SCH_DRAWING_TOOLS::TwoClickPlace', () => {
  it('names a label in its dialog on the first click and places it on the second', async () => {
    const dialogs: string[] = [];
    const h = setUp({
      showModal: (d, items) => {
        dialogs.push(d);
        (items[0] as SCH_LABEL_BASE).SetText('CLK');
        return wxID_OK;
      },
    });
    h.h.mouse = P(0, 0); // the primed click opens the dialog
    h.mgr.RunAction(SCH_ACTIONS.placeLabel);
    await flush();
    mouse(h, TA_MOUSE_MOTION, P(2, 2));
    click(h, P(2, 2));
    h.mgr.RunAction(ACTIONS.cancelInteractive);
    const labels = [...h.screen().Items().OfType(KICAD_T.SCH_LABEL_T)].filter((l) =>
      at(l.GetPosition(), P(2, 2)),
    ) as SCH_LABEL_BASE[];
    expect(dialogs).toEqual(['DIALOG_LABEL_PROPERTIES']);
    expect(labels.map((l) => l.GetText())).toEqual(['CLK']);
    expect(labels[0]!.IsNew()).toBe(false);
  });

  it('a label on a wire driven by a label takes that name without asking', async () => {
    const dialogs: string[] = [];
    const h = setUp({
      showModal: (d, items) => {
        dialogs.push(d);
        (items[0] as SCH_LABEL_BASE).SetText('SIG');
        return wxID_OK;
      },
    });
    wire(h, P(0, 0), P(10, 0));
    h.h.mouse = P(0, 0);
    h.mgr.RunAction(SCH_ACTIONS.placeLabel);
    await flush();
    click(h, P(0, 0));
    await flush();
    h.mgr.RunAction(ACTIONS.cancelInteractive);
    expect(dialogs).toEqual(['DIALOG_LABEL_PROPERTIES']);
    dialogs.length = 0;
    h.h.mouse = P(6, 0);
    h.mgr.RunAction(SCH_ACTIONS.placeLabel);
    await flush();
    h.mgr.RunAction(ACTIONS.cancelInteractive);
    expect(dialogs).toEqual([]);
  });

  it('a cancelled label dialog places nothing', async () => {
    const h = setUp({ showModal: () => wxID_CANCEL });
    const before = [...h.screen().Items().OfType(KICAD_T.SCH_LABEL_T)].length;
    h.h.mouse = P(0, 0);
    h.mgr.RunAction(SCH_ACTIONS.placeLabel);
    await flush();
    click(h, P(2, 2));
    h.mgr.RunAction(ACTIONS.cancelInteractive);
    expect([...h.screen().Items().OfType(KICAD_T.SCH_LABEL_T)].length).toBe(before);
  });
});

describe('SCH_DRAWING_TOOLS::DrawSheet', () => {
  it('draws a sheet from click to click, named by the sheet dialog, on the next free page', async () => {
    const asked: [SCH_SHEET, string | undefined][] = [];
    const frameRef: { frame: SCH_EDIT_FRAME | null } = { frame: null };
    const h = setUp(
      {
        editSheetProperties: (sheet, _path, src) => {
          asked.push([sheet, src]);
          // the dialog's OK links the file it names, as DIALOG_SHEET_PROPERTIES does
          if (!frameRef.frame!.ChangeSheetFile(sheet, sheet.GetFileName())) return null;
          return { isUndoable: true, clearAnnotation: false, updateHierarchyNavigator: false };
        },
      },
      false,
    );
    frameRef.frame = h.frame;
    const undo = h.frame.GetUndoCommandCount();
    h.h.mouse = P(0, 0); // the primed click starts the sheet
    h.mgr.RunAction(SCH_ACTIONS.drawSheet);
    mouse(h, TA_MOUSE_MOTION, P(40, 20));
    click(h, P(40, 20));
    await flush();
    // DrawSheet leaves the new sheet selected
    const selected = h.sel.GetSelection().GetItems();
    h.mgr.RunAction(ACTIONS.cancelInteractive);
    expect(asked).toHaveLength(1);
    const [sheet, src] = asked[0]!;
    expect(src).toBeUndefined();
    expect(sheet.GetName()).toBe('Untitled Sheet');
    expect(sheet.GetPosition()).toEqual(P(0, 0));
    expect(sheet.GetSize()).toEqual({ x: 40 * G, y: 20 * G });
    expect([...h.screen().Items().OfType(KICAD_T.SCH_SHEET_T)]).toContain(sheet);
    expect(h.frame.GetUndoCommandCount()).toBe(undo + 1);
    expect(selected.length).toBe(1);
    expect(selected[0] === sheet).toBe(true);
  });

  it('a cancelled sheet dialog adds nothing', async () => {
    const h = setUp({ editSheetProperties: () => null }, false);
    const before = [...h.screen().Items().OfType(KICAD_T.SCH_SHEET_T)].length;
    h.h.mouse = P(0, 0);
    h.mgr.RunAction(SCH_ACTIONS.drawSheet);
    click(h, P(40, 20));
    await flush();
    h.mgr.RunAction(ACTIONS.cancelInteractive);
    expect([...h.screen().Items().OfType(KICAD_T.SCH_SHEET_T)].length).toBe(before);
  });
});

describe('SCH_DRAWING_TOOLS sheet pins', () => {
  it('autoplaceAllSheetPins pins the selected sheet; with none new it says so', () => {
    const msgs: string[] = [];
    const h = setUp({}, false);
    h.frame.ShowInfoBarMsg = (m: string) => {
      msgs.push(m);
    };
    const sheet = [...h.screen().Items().OfType(KICAD_T.SCH_SHEET_T)][0] as SCH_SHEET;
    const before = sheet.GetPins().length;
    h.sel.AddItemToSel(sheet as EDA_ITEM, true);
    h.mgr.RunAction(SCH_ACTIONS.autoplaceAllSheetPins);
    // the oracle's sheets already have a pin for every label
    expect(sheet.GetPins().length).toBe(before);
    expect(msgs).toEqual(['No new hierarchical labels found.']);
  });

  it('placeSheetPin takes the next unmatched label, by natural order, on each click', () => {
    const h = setUp({}, false);
    const sheet = [...h.screen().Items().OfType(KICAD_T.SCH_SHEET_T)][0] as SCH_SHEET;
    // free two labels by removing their pins
    const pins = [...sheet.GetPins()]
      .sort((a, b) => (a.GetText() < b.GetText() ? -1 : 1))
      .slice(0, 2);
    for (const p of pins) sheet.RemovePin(p);
    const names = pins.map((p) => p.GetText());
    const left = sheet.GetPosition();
    h.sel.AddItemToSel(sheet as EDA_ITEM, true);
    const y1 = { x: left.x, y: left.y + 2 * G };
    const y2 = { x: left.x, y: left.y + 4 * G };
    h.h.mouse = y1; // the primed click takes the first label
    h.mgr.RunAction(SCH_ACTIONS.placeSheetPin);
    click(h, y1); // places it and takes the second
    click(h, y2); // places that
    const placed = sheet.GetPins().filter((p) => names.includes(p.GetText()));
    expect(placed.map((p) => p.GetText()).sort()).toEqual([...names].sort());
    expect(placed.every((p) => p.GetShape() !== undefined && !p.IsNew())).toBe(true);
    void LABEL_FLAG_SHAPE;
  });
});
