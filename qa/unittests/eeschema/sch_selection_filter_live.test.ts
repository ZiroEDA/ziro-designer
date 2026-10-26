// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SCH_SELECTION_TOOL::itemPassesFilter (sch_selection_tool.cpp) arm by arm, on a sheet holding one
 * item of every kind: each filter category turned off alone takes exactly its arm's item types
 * out of a Select All, and nothing else.
 *
 * - A graphic SCH_LINE is graphics, a wire or bus is wires: the arm keys on the layer.
 * - A directive label is not a label. It has no case of its own and falls to `default`, so
 *   Other Items governs it, as it does a no-connect and a bus entry.
 * - Nothing here is locked-dependent: upstream's lock test is `#if 0` ("Locking is not yet
 *   exposed uniformly in the schematic"), so Locked Items changes nothing.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import type { SCH_LINE } from '@ziroeda/eeschema/sch_line.js';
import { SCH_SELECTION_TOOL } from '@ziroeda/eeschema/tools/sch_selection_tool.js';
import type { SCH_SELECTION_FILTER_OPTIONS } from '@ziroeda/common/project/project_local_settings.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SCH_SYMBOL } from '@ziroeda/eeschema/sch_symbol.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { click, openProject, schToolHarness } from './support/sch_tool_harness.js';

const DATA = resolve(__dirname, '../../data/eeschema/props_panel');

/** every_kind.kicad_sch, plus the two kinds it lacks: a directive label and a rule area. */
const SHEET = readFileSync(`${DATA}/every_kind.kicad_sch`, 'utf8').replace(
  '(sheet_instances',
  `(netclass_flag "" (length 2.54) (shape round) (at 25.4 165.1 0)
     (effects (font (size 1.27 1.27)) (justify left bottom)) (uuid "d0000000-0000-0000-0000-000000000001"))
   (rule_area (polyline (pts (xy 10.16 170.18) (xy 30.48 170.18) (xy 30.48 185.42) (xy 10.16 185.42))
     (stroke (width 0) (type dash)) (fill (type none)) (uuid "d0000000-0000-0000-0000-000000000002")))
   (sheet_instances`,
);

beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => SetPgm(null));

/** An item's arm key: its type, and for a line, whether it is a wire/bus or a graphic. */
function kind(aItem: EDA_ITEM): string {
  if (aItem.Type() !== KICAD_T.SCH_LINE_T) return KICAD_T[aItem.Type()]!;
  const layer = (aItem as SCH_LINE).GetLayer();
  return layer === SCH_LAYER_ID.LAYER_WIRE || layer === SCH_LAYER_ID.LAYER_BUS
    ? 'SCH_LINE_T wire'
    : 'SCH_LINE_T graphic';
}

function selectAllKinds(aOff: keyof SCH_SELECTION_FILTER_OPTIONS | null): Set<string> {
  const h = schToolHarness();
  h.frame.OpenProjectFiles(['/t/every_kind.kicad_sch'], 0, (p) =>
    p.endsWith('every_kind.kicad_sch')
      ? SHEET
      : p.endsWith('sub.kicad_sch')
        ? readFileSync(`${DATA}/sub.kicad_sch`, 'utf8')
        : null,
  );
  const sel = h.frame.GetToolManager()!.GetTool(SCH_SELECTION_TOOL)!;
  if (aOff) (sel.GetFilter() as unknown as Record<string, boolean>)[aOff] = false;
  sel.SelectAll(null as never);
  return new Set(sel.GetSelection().GetItems().map(kind));
}

/** Each category and the kinds its arm governs, from itemPassesFilter's switch. */
const ARMS: [keyof SCH_SELECTION_FILTER_OPTIONS, string[]][] = [
  ['symbols', ['SCH_SYMBOL_T', 'SCH_SHEET_T']],
  ['pins', ['SCH_SHEET_PIN_T']],
  ['wires', ['SCH_JUNCTION_T', 'SCH_LINE_T wire']],
  ['graphics', ['SCH_SHAPE_T', 'SCH_LINE_T graphic']],
  ['text', ['SCH_TEXT_T', 'SCH_TEXTBOX_T', 'SCH_TABLE_T']],
  ['labels', ['SCH_LABEL_T', 'SCH_GLOBAL_LABEL_T', 'SCH_HIER_LABEL_T']],
  ['images', ['SCH_BITMAP_T']],
  ['ruleAreas', ['SCH_RULE_AREA_T']],
  ['otherItems', ['SCH_NO_CONNECT_T', 'SCH_BUS_WIRE_ENTRY_T', 'SCH_DIRECTIVE_LABEL_T']],
];

describe('SCH_SELECTION_TOOL::itemPassesFilter', () => {
  // With every category on; built inside a test, once the PGM_BASE is set.
  let cached: Set<string> | null = null;
  const allKinds = () => (cached ??= selectAllKinds(null));

  it('the sheet holds every kind the arms name, so each arm is exercised', () => {
    for (const [, kinds] of ARMS) for (const k of kinds) expect(allKinds(), k).toContain(k);
  });

  it.each(ARMS)('%s off takes out exactly %j', (aOff, aKinds) => {
    const left = selectAllKinds(aOff);
    expect([...allKinds()].filter((k) => !left.has(k)).sort()).toEqual([...aKinds].sort());
  });

  it('Locked Items off changes nothing: the lock test is compiled out upstream', () => {
    expect(selectAllKinds('lockedItems')).toEqual(allKinds());
  });
});

describe('SCH_SELECTION_TOOL::itemPassesFilter: the children of a symbol', () => {
  // Select All never selects a symbol's field or pin, so these arms are reached by a click.
  const ORACLE = resolve(__dirname, '../../data/eeschema/netlist_oracle/complex_hierarchy');
  const MM = 10000;

  function setUp() {
    const h = schToolHarness();
    openProject(h.frame, ORACLE, 'complex_hierarchy', [
      'complex_hierarchy.kicad_sch',
      'ampli_ht.kicad_sch',
      'complex_hierarchy.kicad_pro',
    ]);
    h.frame.SetCurrentSheet(
      h.frame
        .Schematic()
        .Hierarchy()
        .find((p) => p.size() === 2)!,
    );
    const sel = h.frame.GetToolManager()!.GetTool(SCH_SELECTION_TOOL)!;
    // a symbol whose reference field and one pin tip are clear of its body
    for (const sym of h.frame
      .GetScreen()!
      .Items()
      .OfType(KICAD_T.SCH_SYMBOL_T) as Iterable<SCH_SYMBOL>) {
      const body = sym
        .GetBodyBoundingBox()
        .Clone()
        .Inflate(1 * MM);
      const ref = sym.GetField(FIELD_T.REFERENCE)!;
      const pin = sym.GetPins().find((p) => !body.Contains(p.GetPosition()));
      if (pin && ref.IsVisible() && !body.Intersects(ref.GetBoundingBox()))
        return { h, sel, sym, ref, pin };
    }
    throw new Error('no symbol with a clear field and pin');
  }

  /** The selection after a click, as identities: a failing toEqual would print the schematic. */
  const after = (t: ReturnType<typeof setUp>, aAt: { x: number; y: number }) => {
    t.sel.ClearSelection(true);
    click(t.h, aAt);
    return t.sel.GetSelection().GetItems();
  };

  it('a field is text: Text off rejects it, Symbols or Pins off do not', () => {
    const t = setUp();
    const at = t.ref.GetBoundingBox().GetCenter();
    t.sel.GetFilter().symbols = false;
    t.sel.GetFilter().pins = false;
    expect(after(t, at).includes(t.ref)).toBe(true);
    t.sel.GetFilter().symbols = true;
    t.sel.GetFilter().text = false;
    expect(after(t, at).includes(t.ref)).toBe(false);
  });

  it('a pin is a pin: with wires off, Pins on takes the pin, Pins off falls back to its symbol', () => {
    const t = setUp();
    t.sel.GetFilter().wires = false;
    // Other Items off as well: a pin has an arm of its own, it is not one of the `default` kinds.
    t.sel.GetFilter().otherItems = false;
    const on = after(t, t.pin.GetPosition());
    expect(on.length === 1 && on[0] === t.pin).toBe(true);
    t.sel.GetFilter().pins = false;
    const off = after(t, t.pin.GetPosition());
    expect(off.length === 1 && off[0] === t.sym).toBe(true);
  });
});
