// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SCH_SELECTION_TOOL (tools/sch_selection_tool.cpp) on the live model, driven by mouse events
 * through the frame's TOOL_MANAGER as the TOOL_DISPATCHER sends them.
 */
import { resolve } from 'node:path';
import { ENDPOINT, STARTPOINT } from '@ziroeda/common/eda_item_flags.js';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { MD_CTRL, MD_SHIFT, TA_MOUSE_MOTION } from '@ziroeda/common/tool/tool_event.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { SCH_LINE } from '@ziroeda/eeschema/sch_line.js';
import type { SCH_SYMBOL } from '@ziroeda/eeschema/sch_symbol.js';
import { SCH_SELECTION_TOOL } from '@ziroeda/eeschema/tools/sch_selection_tool.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  click,
  drag,
  MM,
  mouse,
  openProject,
  type SCH_HARNESS,
  schToolHarness,
} from './support/sch_tool_harness.js';

const ORACLE = resolve(__dirname, '../../data/eeschema/netlist_oracle/complex_hierarchy');
const SHEETS = ['complex_hierarchy.kicad_sch', 'ampli_ht.kicad_sch', 'complex_hierarchy.kicad_pro'];

beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => SetPgm(null));

function setUp() {
  const h = schToolHarness();
  openProject(h.frame, ORACLE, 'complex_hierarchy', SHEETS);
  // The sub-sheet: symbols and wires (the root holds sheets).
  const sub = h.frame
    .Schematic()
    .Hierarchy()
    .find((p) => p.size() === 2)!;
  h.frame.SetCurrentSheet(sub);
  const tool = h.frame.GetToolManager()!.GetTool(SCH_SELECTION_TOOL)!;
  return { ...h, tool };
}

const symbols = (h: SCH_HARNESS) =>
  [...h.frame.GetScreen()!.Items().OfType(KICAD_T.SCH_SYMBOL_T)] as SCH_SYMBOL[];
const wires = (h: SCH_HARNESS) =>
  ([...h.frame.GetScreen()!.Items().OfType(KICAD_T.SCH_LINE_T)] as SCH_LINE[]).filter((l) =>
    l.IsWire(),
  );

/** A symbol whose body centre has nothing else on it. */
function loneSymbol(h: ReturnType<typeof setUp>, aSkip = 0): SCH_SYMBOL {
  return symbols(h).filter((s) => !s.GetLibSymbolRef()?.IsPower())[aSkip]!;
}

const centre = (s: SCH_SYMBOL) => s.GetBodyBoundingBox().GetCenter();

/**
 * A diagonal wire in empty space (KiCad's 45-degree drawing mode makes these) and a point on it
 * off the IU grid: TestSegmentHit's axis-aligned shortcuts skip the BigInt SquaredDistance, so
 * only a diagonal reaches it.
 */
function diagonalWire(h: ReturnType<typeof setUp>): {
  wire: SCH_LINE;
  on: { x: number; y: number };
} {
  const wire = new SCH_LINE({ x: -100 * MM, y: -100 * MM });
  wire.SetEndPoint({ x: -90 * MM, y: -90 * MM });
  h.frame.AddToScreen(wire, h.frame.GetScreen());
  return { wire, on: { x: -95 * MM + 0.37, y: -95 * MM + 0.61 } };
}

describe('SCH_SELECTION_TOOL', () => {
  it('hovering a wire at a fractional position leaves the tool alive to select', () => {
    // The rollover pass runs CollectHits and narrowSelection on every motion event: uncast, the
    // first hover over a wire threw and killed the tool before any click.
    const h = setUp();
    const { wire, on } = diagonalWire(h);

    mouse(h, TA_MOUSE_MOTION, on);
    click(h, { x: Math.round(on.x), y: Math.round(on.y) });

    expect(h.tool.GetSelection().GetItems()).toContain(wire);
  });

  it('selects a wire clicked at a fractional pointer position (VECTOR2I aWhere)', () => {
    // The pointer maps to doubles; CollectHits/selectPoint take `const VECTOR2I&` upstream, so
    // the position is cast on the way in. Uncast, the wire's TestSegmentHit took BigInt of a
    // fraction, threw, and the selection tool's coroutine died - every later click did nothing.
    const h = setUp();
    const { wire, on } = diagonalWire(h);

    click(h, on);

    expect(h.tool.GetSelection().GetItems()).toContain(wire);
  });

  it('selects the symbol clicked, and only it', () => {
    const h = setUp();
    const sym = loneSymbol(h);
    click(h, centre(sym));
    expect(h.tool.GetSelection().GetItems()).toEqual([sym]);
    expect(sym.IsSelected()).toBe(true);
  });

  it('adds with shift, removes with ctrl+shift, clears on empty space', () => {
    const h = setUp();
    const a = loneSymbol(h, 0);
    const b = loneSymbol(h, 1);
    click(h, centre(a));
    click(h, centre(b), MD_SHIFT);
    expect(h.tool.GetSelection().GetItems()).toEqual([a, b]);
    click(h, centre(a), MD_SHIFT | MD_CTRL);
    expect(h.tool.GetSelection().GetItems()).toEqual([b]);
    click(h, { x: -500 * MM, y: -500 * MM });
    expect(h.tool.GetSelection().Empty()).toBe(true);
    expect(b.IsSelected()).toBe(false);
  });

  it('takes the end of a wire clicked near it, and the whole wire in the middle', () => {
    const h = setUp();
    const wire = wires(h).find((w) => w.GetLength() > 5 * MM)!;
    const mid = {
      x: (wire.GetStartPoint().x + wire.GetEndPoint().x) / 2,
      y: (wire.GetStartPoint().y + wire.GetEndPoint().y) / 2,
    };
    click(h, mid);
    expect(h.tool.GetSelection().GetItems()).toContain(wire);
    expect(wire.HasFlag(STARTPOINT) && wire.HasFlag(ENDPOINT)).toBe(true);
  });

  it('rubber-bands left to right: only what is wholly inside', () => {
    const h = setUp();
    const sym = loneSymbol(h);
    const box = sym.GetBoundingBox();
    const from = { x: box.GetLeft() - 2 * MM, y: box.GetTop() - 2 * MM };
    const to = { x: box.GetRight() + 2 * MM, y: box.GetBottom() + 2 * MM };
    drag(h, from, to);
    expect(h.tool.GetSelection().GetItems()).toContain(sym);
    // its fields come with it, not as items of their own (FilterCollectorForHierarchy)
    expect(
      h.tool
        .GetSelection()
        .GetItems()
        .filter((i) => i.GetParent() === sym),
    ).toHaveLength(0);

    // Right to left: anything the box touches, so a box over half the body takes it too.
    click(h, { x: -500 * MM, y: -500 * MM });
    const body = sym.GetBodyBoundingBox();
    drag(
      h,
      { x: body.GetCenter().x, y: body.GetBottom() + 2 * MM },
      { x: body.GetLeft() - 2 * MM, y: body.GetTop() - 2 * MM },
    );
    expect(h.tool.GetSelection().GetItems()).toContain(sym);
  });

  it('leaves out a symbol only half inside a left-to-right box', () => {
    const h = setUp();
    const sym = loneSymbol(h);
    const box = sym.GetBodyBoundingBox();
    drag(
      h,
      { x: box.GetLeft() - 2 * MM, y: box.GetTop() - 2 * MM },
      { x: box.GetCenter().x, y: box.GetBottom() + 2 * MM },
    );
    expect(h.tool.GetSelection().GetItems()).not.toContain(sym);
  });

  it('honours the selection filter and reports what it rejected', () => {
    const h = setUp();
    const sym = loneSymbol(h);
    const flashed: unknown[] = [];
    h.frame.SetSelectionFilterListener((o) => flashed.push(o));
    // Everything under the cursor filtered out: the symbol, its fields and its pins (a pin with
    // pins filtered brings its symbol, CollectHits).
    h.tool.GetFilter().symbols = false;
    h.tool.GetFilter().text = false;
    h.tool.GetFilter().pins = false;
    click(h, centre(sym));
    expect(h.tool.GetSelection().GetItems()).not.toContain(sym);
    return new Promise<void>((done) =>
      setTimeout(() => {
        expect(flashed).toHaveLength(1);
        expect((flashed[0] as { symbols: boolean }).symbols).toBe(true);
        done();
      }, 0),
    );
  });

  it('RequestSelection takes the item under the cursor as a hover selection when nothing is selected', () => {
    const h = setUp();
    const sym = loneSymbol(h);
    h.h.mouse = centre(sym);
    const sel = h.tool.RequestSelection([KICAD_T.SCH_SYMBOL_T]);
    expect(sel.GetItems()).toEqual([sym]);
    expect(sel.IsHover()).toBe(true);
  });

  it('RequestSelection trims an existing selection to the asked types', () => {
    const h = setUp();
    const sym = loneSymbol(h);
    const wire = wires(h)[0]!;
    h.tool.AddItemToSel(sym, true);
    h.tool.AddItemToSel(wire, true);
    const sel = h.tool.RequestSelection([KICAD_T.SCH_LINE_T]);
    expect(sel.GetItems()).toEqual([wire]);
    expect(sym.IsSelected()).toBe(false);
  });

  it('SelectConnection grows a wire to the run it belongs to', () => {
    const h = setUp();
    const wire = wires(h).find((w) => w.GetLength() > 5 * MM)!;
    h.tool.AddItemToSel(wire, true);
    h.tool.SelectConnection(null as never);
    expect(h.tool.GetSelection().GetSize()).toBeGreaterThan(1);
    expect(h.tool.GetSelection().GetItems()).toContain(wire);
  });

  it('takes the symbol for a click on its pin tip when pins are filtered out', () => {
    const h = setUp();
    const sym = loneSymbol(h);
    const body = sym.GetBodyBoundingBox();
    // a pin whose tip is clear of the body (the symbol is hit within half the 1.5 mm hit
    // threshold of its body), where only the pin and its wire are
    const pin = sym.GetPins().find(
      (p) =>
        !body
          .Clone()
          .Inflate(1 * MM)
          .Contains(p.GetPosition()),
    )!;
    h.tool.GetFilter().pins = false;
    h.tool.GetFilter().wires = false;
    click(h, pin.GetPosition());
    expect(h.tool.GetSelection().GetItems()).toEqual([sym]);
  });

  it('SelectConnection moves on to the next stop when the first adds nothing', () => {
    const h = setUp();
    const screen = h.frame.GetScreen()!;
    const pinAt = new Set<string>();
    for (const s of symbols(h))
      for (const p of s.GetPins()) pinAt.add(`${p.GetPosition().x},${p.GetPosition().y}`);
    const isStop = (p: { x: number; y: number }) =>
      pinAt.has(`${p.x},${p.y}`) || screen.IsJunction(p);
    // a wire both of whose ends stop the first pass, one of them at a junction it can walk through
    const wire = wires(h).find(
      (w) =>
        isStop(w.GetStartPoint()) &&
        isStop(w.GetEndPoint()) &&
        (screen.IsJunction(w.GetStartPoint()) || screen.IsJunction(w.GetEndPoint())),
    )!;
    expect(wire).toBeTruthy();
    h.tool.AddItemToSel(wire, true);
    h.tool.SelectConnection(null as never);
    expect(h.tool.GetSelection().GetSize()).toBeGreaterThan(1);
  });
});
