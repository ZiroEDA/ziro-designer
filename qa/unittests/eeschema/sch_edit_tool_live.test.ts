// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SCH_EDIT_TOOL (tools/sch_edit_tool.cpp) on the live model, driven through the frame's
 * TOOL_MANAGER: rotate, mirror, delete (with SCH_EDIT_FRAME::DeleteJunction), swap, attributes,
 * text-type conversion, justification and the properties dialogs.
 */
import { resolve } from 'node:path';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { GR_TEXT_H_ALIGN_T } from '@ziroeda/common/font/text_attributes.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { wxID_OK } from '@ziroeda/common/wx/menu.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { SCH_EDIT_FRAME_HOOKS } from '@ziroeda/eeschema/sch_edit_frame.js';
import { type SCH_GLOBALLABEL, SCH_LABEL, SPIN_STYLE } from '@ziroeda/eeschema/sch_label.js';
import { SCH_LINE } from '@ziroeda/eeschema/sch_line.js';
import { SCH_JUNCTION } from '@ziroeda/eeschema/sch_junction.js';
import type { SCH_SYMBOL } from '@ziroeda/eeschema/sch_symbol.js';
import { SCH_TEXT } from '@ziroeda/eeschema/sch_text.js';
import { SYMBOL_ORIENTATION_T } from '@ziroeda/eeschema/symbol.js';
import { SCH_ACTIONS } from '@ziroeda/eeschema/tools/sch_actions.js';
import { SCH_SELECTION_TOOL } from '@ziroeda/eeschema/tools/sch_selection_tool.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  openProject,
  type SCH_HARNESS,
  schFrame,
  schToolHarness,
} from './support/sch_tool_harness.js';

const ORACLE = resolve(__dirname, '../../data/eeschema/netlist_oracle/complex_hierarchy');
const SHEETS = ['complex_hierarchy.kicad_sch', 'ampli_ht.kicad_sch', 'complex_hierarchy.kicad_pro'];
const G = 50 * 254; // the 50 mil grid
const FAR = 3000 * G; // well off the sheet's own items

beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => SetPgm(null));

function setUp(aHooks: Partial<SCH_EDIT_FRAME_HOOKS> = {}) {
  const h = schToolHarness(schFrame(aHooks));
  openProject(h.frame, ORACLE, 'complex_hierarchy', SHEETS);
  const sub = h.frame
    .Schematic()
    .Hierarchy()
    .find((p) => p.size() === 2)!;
  h.frame.SetCurrentSheet(sub);
  const mgr = h.frame.GetToolManager()!;
  const sel = mgr.GetTool(SCH_SELECTION_TOOL)!;
  const select = (...items: EDA_ITEM[]) => {
    sel.ClearSelection(true);
    for (const i of items) sel.AddItemToSel(i, true);
  };
  return { ...h, mgr, sel, select, screen: h.frame.GetScreen()! };
}

const lone = (h: SCH_HARNESS) =>
  ([...h.frame.GetScreen()!.Items().OfType(KICAD_T.SCH_SYMBOL_T)] as SCH_SYMBOL[]).filter(
    (s) => !s.GetLibSymbolRef()?.IsPower(),
  )[0]!;

const flush = async (): Promise<void> => {
  // a dialog answers on a later tick, waking its coroutine through a posted event
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};

const at = (p: { x: number; y: number }, q: { x: number; y: number }) => p.x === q.x && p.y === q.y;

function wire(h: ReturnType<typeof setUp>, a: [number, number], b: [number, number]): SCH_LINE {
  const w = new SCH_LINE({ x: a[0], y: a[1] }, SCH_LAYER_ID.LAYER_WIRE);
  w.SetEndPoint({ x: b[0], y: b[1] });
  h.frame.AddToScreen(w, h.screen);
  return w;
}

describe('SCH_EDIT_TOOL', () => {
  it('rotates a symbol counter-clockwise about its anchor, as one undo step', () => {
    const h = setUp();
    const sym = lone(h);
    const pos = sym.GetPosition();
    const before = sym.GetOrientation();
    const undo = h.frame.GetUndoCommandCount();
    h.select(sym);
    h.mgr.RunAction(SCH_ACTIONS.rotateCCW);
    expect(sym.GetPosition()).toEqual(pos);
    expect(sym.GetOrientation()).not.toBe(before);
    expect(h.frame.GetUndoCommandCount()).toBe(undo + 1);
    // four quarter turns are the identity
    for (let i = 0; i < 3; i++) {
      h.select(sym);
      h.mgr.RunAction(SCH_ACTIONS.rotateCCW);
    }
    expect(sym.GetOrientation()).toBe(before);
  });

  it('rotateCW turns a symbol clockwise, rotateCCW counter-clockwise (SCH_SYMBOL::Rotate( pt, !clockwise ))', () => {
    const h = setUp();
    const sym = lone(h);
    const cw = sym.Clone() as SCH_SYMBOL;
    cw.SetOrientation(SYMBOL_ORIENTATION_T.SYM_ROTATE_CLOCKWISE);
    const ccw = sym.Clone() as SCH_SYMBOL;
    ccw.SetOrientation(SYMBOL_ORIENTATION_T.SYM_ROTATE_COUNTERCLOCKWISE);
    h.select(sym);
    h.mgr.RunAction(SCH_ACTIONS.rotateCW);
    expect(sym.GetTransform()).toEqual(cw.GetTransform());
    expect(sym.GetTransform()).not.toEqual(ccw.GetTransform());
  });

  it('rotates a lone label in place: RIGHT turns to BOTTOM clockwise, to UP counter-clockwise', () => {
    const h = setUp();
    const label = new SCH_LABEL({ x: FAR, y: FAR }, 'NET_A');
    // a constructed label is centre-justified (TEXT_ATTRIBUTES' default); placement spins it
    label.SetSpinStyle(new SPIN_STYLE(SPIN_STYLE.RIGHT));
    h.frame.AddToScreen(label, h.screen);
    h.select(label);
    h.mgr.RunAction(SCH_ACTIONS.rotateCW);
    expect(Number(label.GetSpinStyle())).toBe(SPIN_STYLE.BOTTOM);
    h.select(label);
    h.mgr.RunAction(SCH_ACTIONS.rotateCCW);
    expect(Number(label.GetSpinStyle())).toBe(SPIN_STYLE.RIGHT);
    h.select(label);
    h.mgr.RunAction(SCH_ACTIONS.rotateCCW);
    expect(Number(label.GetSpinStyle())).toBe(SPIN_STYLE.UP);
    expect(label.GetPosition()).toEqual({ x: FAR, y: FAR });
  });

  it('mirrors a symbol about its own anchor (mirrorV is SYM_MIRROR_X)', () => {
    const h = setUp();
    const sym = lone(h);
    const pos = sym.GetPosition();
    const ref = sym.Clone() as SCH_SYMBOL;
    ref.SetOrientation(SYMBOL_ORIENTATION_T.SYM_MIRROR_X);
    h.select(sym);
    h.mgr.RunAction(SCH_ACTIONS.mirrorV);
    expect(sym.GetPosition()).toEqual(pos);
    expect(sym.GetTransform()).toEqual(ref.GetTransform());
  });

  it('mirrors a selection of two about their common centre', () => {
    const h = setUp();
    const a = new SCH_TEXT({ x: FAR, y: FAR }, 'A');
    const b = new SCH_TEXT({ x: FAR + 10 * G, y: FAR }, 'B');
    h.frame.AddToScreen(a, h.screen);
    h.frame.AddToScreen(b, h.screen);
    h.select(a, b);
    h.mgr.RunAction(SCH_ACTIONS.mirrorH);
    // the two swap sides about the half-grid-snapped centre between them
    expect(a.GetPosition().x).toBeGreaterThan(b.GetPosition().x);
  });

  it('deletes a wire, and the junction it leaves needless goes with it, merging the run', () => {
    const h = setUp();
    const y = FAR;
    const left = wire(h, [FAR, y], [FAR + 10 * G, y]);
    const right = wire(h, [FAR + 10 * G, y], [FAR + 20 * G, y]);
    const stub = wire(h, [FAR + 10 * G, y], [FAR + 10 * G, y + 10 * G]);
    const j = new SCH_JUNCTION({ x: FAR + 10 * G, y });
    h.frame.AddToScreen(j, h.screen);
    h.select(stub);
    h.mgr.RunAction(ACTIONS.doDelete);
    const lines = ([...h.screen.Items().OfType(KICAD_T.SCH_LINE_T)] as SCH_LINE[]).filter(
      (l) => l.GetStartPoint().y === y && l.GetEndPoint().y === y,
    );
    expect([...h.screen.Items().OfType(KICAD_T.SCH_JUNCTION_T)].includes(j)).toBe(false);
    expect(lines).toHaveLength(1);
    const [l] = lines;
    expect([l!.GetStartPoint().x, l!.GetEndPoint().x].sort((p, q) => p - q)).toEqual([
      FAR,
      FAR + 20 * G,
    ]);
    void left;
    void right;
  });

  it('a deleted field is hidden, not removed', () => {
    const h = setUp();
    const sym = lone(h);
    const value = sym.GetField(FIELD_T.VALUE)!;
    expect(value.IsVisible()).toBe(true);
    h.select(value);
    h.mgr.RunAction(ACTIONS.doDelete);
    expect(value.IsVisible()).toBe(false);
    expect([...h.screen.Items().OfType(KICAD_T.SCH_SYMBOL_T)]).toContain(sym);
  });

  it('swaps the positions of two labels in selection order', () => {
    const h = setUp();
    const a = new SCH_LABEL({ x: FAR, y: FAR }, 'A');
    const b = new SCH_LABEL({ x: FAR + 10 * G, y: FAR + 4 * G }, 'B');
    h.frame.AddToScreen(a, h.screen);
    h.frame.AddToScreen(b, h.screen);
    h.select(a, b);
    h.mgr.RunAction(SCH_ACTIONS.swap);
    expect(a.GetPosition()).toEqual({ x: FAR + 10 * G, y: FAR + 4 * G });
    expect(b.GetPosition()).toEqual({ x: FAR, y: FAR });
  });

  it('toggles DNP: on when any lacks it, then off', () => {
    const h = setUp();
    const sym = lone(h);
    const sheet = h.frame.GetCurrentSheet();
    const v = h.frame.Schematic().GetCurrentVariant();
    expect(sym.GetDNP(sheet, v)).toBe(false);
    h.select(sym);
    h.mgr.RunAction(SCH_ACTIONS.setDNP);
    expect(sym.GetDNP(sheet, v)).toBe(true);
    h.select(sym);
    h.mgr.RunAction(SCH_ACTIONS.setDNP);
    expect(sym.GetDNP(sheet, v)).toBe(false);
  });

  it('changes a local label to a global one with its text, place and selection', () => {
    const h = setUp();
    const label = new SCH_LABEL({ x: FAR, y: FAR }, 'SIG');
    h.frame.AddToScreen(label, h.screen);
    h.select(label);
    h.mgr.RunAction(SCH_ACTIONS.toGLabel);
    const globals = [...h.screen.Items().OfType(KICAD_T.SCH_GLOBAL_LABEL_T)].filter((g) =>
      at(g.GetPosition(), { x: FAR, y: FAR }),
    ) as SCH_GLOBALLABEL[];
    expect(globals).toHaveLength(1);
    expect(globals[0]!.GetText()).toBe('SIG');
    expect([...h.screen.Items().OfType(KICAD_T.SCH_LABEL_T)]).not.toContain(label);
    const selected = h.sel.GetSelection().GetItems();
    expect(selected.length === 1 && selected[0] === globals[0]).toBe(true);
  });

  it('converting text to a label makes a valid net name of it', () => {
    const h = setUp();
    const text = new SCH_TEXT({ x: FAR, y: FAR }, 'two words');
    h.frame.AddToScreen(text, h.screen);
    h.select(text);
    h.mgr.RunAction(SCH_ACTIONS.toLabel);
    const labels = [...h.screen.Items().OfType(KICAD_T.SCH_LABEL_T)].filter((l) =>
      at(l.GetPosition(), { x: FAR, y: FAR }),
    ) as SCH_LABEL[];
    expect(labels.map((l) => l.GetText())).toEqual(['two_words']);
  });

  it('right-justifies a text item', () => {
    const h = setUp();
    const text = new SCH_TEXT({ x: FAR, y: FAR }, 'T');
    h.frame.AddToScreen(text, h.screen);
    h.select(text);
    h.mgr.RunAction(ACTIONS.rightJustify);
    expect(text.GetHorizJustify()).toBe(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT);
    h.select(text);
    h.mgr.RunAction(ACTIONS.centerJustify);
    expect(text.GetHorizJustify()).toBe(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER);
  });

  it('Properties opens the dialog KiCad names, on the live item, promoting a pin to its symbol', async () => {
    const calls: [string, readonly EDA_ITEM[]][] = [];
    const h = setUp({
      showModal: (d, items) => {
        calls.push([d, items]);
        return wxID_OK;
      },
    });
    const label = new SCH_LABEL({ x: FAR, y: FAR }, 'L');
    h.frame.AddToScreen(label, h.screen);
    h.select(label);
    h.mgr.RunAction(SCH_ACTIONS.properties);
    await flush();
    const sym = lone(h);
    h.select(sym.GetPins()[0]!);
    h.mgr.RunAction(SCH_ACTIONS.properties);
    await flush();
    expect(calls.map(([d, items]) => [d, items[0]])).toEqual([
      ['DIALOG_LABEL_PROPERTIES', label],
      ['DIALOG_SYMBOL_PROPERTIES', sym],
    ]);
  });

  it('a cancelled field dialog leaves no undo step', async () => {
    const h = setUp(); // no window: every dialog is cancelled
    const sym = lone(h);
    const undo = h.frame.GetUndoCommandCount();
    h.select(sym);
    h.mgr.RunAction(SCH_ACTIONS.editValue);
    await flush();
    expect(h.frame.GetUndoCommandCount()).toBe(undo);
  });
});
