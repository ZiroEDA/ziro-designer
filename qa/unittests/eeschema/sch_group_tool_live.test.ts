// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SCH_GROUP_TOOL (tools/sch_group_tool.cpp, over common GROUP_TOOL) on the TOOL_MANAGER.
 */
import { resolve } from 'node:path';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { SCH_GROUP } from '@ziroeda/eeschema/sch_group.js';
import type { SCH_SYMBOL } from '@ziroeda/eeschema/sch_symbol.js';
import { SCH_TEXT } from '@ziroeda/eeschema/sch_text.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { SCH_SELECTION_TOOL } from '@ziroeda/eeschema/tools/sch_selection_tool.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { click, openProject, schFrame, schToolHarness } from './support/sch_tool_harness.js';

const ORACLE = resolve(__dirname, '../../data/eeschema/netlist_oracle/complex_hierarchy');
const SHEETS = ['complex_hierarchy.kicad_sch', 'ampli_ht.kicad_sch', 'complex_hierarchy.kicad_pro'];
const G = 50 * 254;
const FAR = 3000 * G;

beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => SetPgm(null));

function setUp() {
  const h = schToolHarness(schFrame({}));
  openProject(h.frame, ORACLE, 'complex_hierarchy', SHEETS);
  h.frame.SetCurrentSheet(
    h.frame
      .Schematic()
      .Hierarchy()
      .find((p) => p.size() === 2)!,
  );
  const mgr = h.frame.GetToolManager()!;
  const sel = mgr.GetTool(SCH_SELECTION_TOOL)!;
  const select = (...items: EDA_ITEM[]) => {
    sel.ClearSelection(true);
    for (const i of items) sel.AddItemToSel(i, true);
  };
  const text = (x: number) => {
    const t = new SCH_TEXT({ x: FAR + x * G, y: FAR }, 'T');
    h.frame.AddToScreen(t, h.frame.GetScreen());
    return t;
  };
  const groups = () => [...h.frame.GetScreen()!.Items().OfType(KICAD_T.SCH_GROUP_T)] as SCH_GROUP[];
  return { ...h, mgr, sel, select, text, groups };
}

describe('SCH_GROUP_TOOL', () => {
  it('groups the selection into one new group, selected, as one undo step', () => {
    const h = setUp();
    const a = h.text(0);
    const b = h.text(4);
    const undo = h.frame.GetUndoCommandCount();
    h.select(a, b);
    h.mgr.RunAction(ACTIONS.group);
    const [g] = h.groups();
    expect(h.groups()).toHaveLength(1);
    expect(a.GetParentGroup()?.AsEdaItem() === g && b.GetParentGroup()?.AsEdaItem() === g).toBe(
      true,
    );
    const sel = h.sel.GetSelection().GetItems();
    expect(sel.length === 1 && sel[0] === g).toBe(true);
    expect(h.frame.GetUndoCommandCount()).toBe(undo + 1);
  });

  it("a symbol's field is not groupable apart from its symbol; one item alone is no group", () => {
    const h = setUp();
    const warnings: string[] = [];
    h.frame.ShowInfoBarWarning = (m: string) => {
      warnings.push(m);
    };
    const sym = [...h.frame.GetScreen()!.Items().OfType(KICAD_T.SCH_SYMBOL_T)][0] as SCH_SYMBOL;
    const a = h.text(0);
    h.select(a, sym.GetField(FIELD_T.VALUE)!);
    h.mgr.RunAction(ACTIONS.group);
    expect(h.groups()).toHaveLength(0);
    expect(warnings).toEqual(['Child items cannot be grouped separately from their parent item.']);
  });

  it('ungroup takes the members back out', () => {
    const h = setUp();
    const a = h.text(0);
    const b = h.text(4);
    h.select(a, b);
    h.mgr.RunAction(ACTIONS.group);
    h.select(h.groups()[0]!);
    h.mgr.RunAction(ACTIONS.ungroup);
    expect(h.groups()).toHaveLength(0);
    expect(a.GetParentGroup()).toBeNull();
  });
});

describe('SCH_SELECTION_TOOL::GuessSelectionCandidates: a click on a grouped symbol', () => {
  // The group is looked up from the symbol, not the child (`if( !m_isSymbolEditor && sym ) start =
  // sym`), and the clicked item is replaced by that group (`aCollector.Remove( item )`).
  const MM = 10000;

  /** A symbol whose reference field and one pin tip are clear of its body, so each takes a click. */
  function clearSymbol(h: ReturnType<typeof setUp>, aSkip: SCH_SYMBOL | null = null) {
    for (const sym of h.frame
      .GetScreen()!
      .Items()
      .OfType(KICAD_T.SCH_SYMBOL_T) as Iterable<SCH_SYMBOL>) {
      if (sym === aSkip) continue;
      const body = sym
        .GetBodyBoundingBox()
        .Clone()
        .Inflate(1 * MM);
      const ref = sym.GetField(FIELD_T.REFERENCE)!;
      const pin = sym.GetPins().find((p) => !body.Contains(p.GetPosition()));
      if (pin && ref.IsVisible() && !body.Intersects(ref.GetBoundingBox()))
        return { sym, ref, pin };
    }
    throw new Error('no symbol with a clear field and pin');
  }

  function grouped() {
    const h = setUp();
    const c = clearSymbol(h);
    h.select(c.sym, h.text(0));
    h.mgr.RunAction(ACTIONS.group);
    h.sel.ClearSelection(true);
    return { h, ...c, group: h.groups()[0]!.AsEdaItem() };
  }

  /** Whether a click at \a aAt leaves exactly \a aItem selected. Identity, not toEqual: a failing
   *  diff would pretty-print the whole schematic graph each live item reaches. */
  const selectsOnly = (
    h: ReturnType<typeof setUp>,
    aAt: { x: number; y: number },
    aItem: unknown,
  ) => {
    h.sel.ClearSelection(true);
    click(h, aAt);
    const items = h.sel.GetSelection().GetItems();
    return items.length === 1 && items[0] === aItem;
  };

  it('on its reference field selects the group, and only the group', () => {
    const { h, ref, group } = grouped();
    expect(selectsOnly(h, ref.GetBoundingBox().GetCenter(), group)).toBe(true);
  });

  it('on a pin tip selects the group, once the wire ending there is filtered out', () => {
    // With wires on, GuessSelectionCandidates prefers the wire ending on the tip.
    const { h, pin, group } = grouped();
    h.sel.GetFilter().wires = false;
    expect(selectsOnly(h, pin.GetPosition(), group)).toBe(true);
  });

  it('on its body selects the group', () => {
    const { h, sym, group } = grouped();
    expect(selectsOnly(h, sym.GetBodyBoundingBox().GetCenter(), group)).toBe(true);
  });

  it("an ungrouped symbol's field is selected on its own", () => {
    const { h, sym } = grouped();
    const other = clearSymbol(h, sym);
    expect(selectsOnly(h, other.ref.GetBoundingBox().GetCenter(), other.ref)).toBe(true);
  });
});
