// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * eeschema/cross-probing.cpp on the live model: findItemsFromSyncSelection and the KiwayMailIn
 * MAIL_SELECTION arm that hands its answer to SCH_SELECTION_TOOL::SyncSelection, the flash
 * (sch_edit_frame.cpp:491-588), SendSelectItemsToPcb's packet, and ZoomFitCrossProbeBBox's
 * arithmetic.
 */
import { resolve } from 'node:path';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { KIWAY } from '@ziroeda/common/kiway.js';
import type { KIWAY_MAIL_EVENT } from '@ziroeda/common/kiway_mail.js';
import { KIWAY_PLAYER } from '@ziroeda/common/kiway_player.js';
import { MAIL_T } from '@ziroeda/common/mail_type.js';
import { mmToIU, schIUScale } from '@ziroeda/common/eda_units.js';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { CROSS_PROBING_SETTINGS } from '@ziroeda/common/settings/app_settings.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { findItemsFromSyncSelection } from '@ziroeda/eeschema/cross-probing.js';
import { SCH_REFERENCE_LIST } from '@ziroeda/eeschema/sch_reference_list.js';
import { SYMBOL_FILTER, type SCH_SHEET_PATH } from '@ziroeda/eeschema/sch_sheet_path.js';
import type { SCH_SYMBOL } from '@ziroeda/eeschema/sch_symbol.js';
import { SCH_TEXT } from '@ziroeda/eeschema/sch_text.js';
import type { SCH_ITEM } from '@ziroeda/eeschema/sch_item.js';
import { SCH_CLEANUP_FLAGS } from '@ziroeda/eeschema/schematic.js';
import { SCH_SELECTION_TOOL } from '@ziroeda/eeschema/tools/sch_selection_tool.js';
import { BOX2D, BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openProject, schFrame, schToolHarness } from './support/sch_tool_harness.js';

const ORACLE = resolve(__dirname, '../../data/eeschema/netlist_oracle/complex_hierarchy');
const SHEETS = ['complex_hierarchy.kicad_sch', 'ampli_ht.kicad_sch', 'complex_hierarchy.kicad_pro'];

beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => {
  vi.useRealTimers();
  SetPgm(null);
});

class PCB_STUB extends KIWAY_PLAYER {
  readonly received: [MAIL_T, string][] = [];

  constructor() {
    super(FRAME_T.FRAME_PCB_EDITOR, schIUScale, 'mm');
  }

  override KiwayMailIn(aEvent: KIWAY_MAIL_EVENT): void {
    this.received.push([aEvent.Command(), aEvent.GetPayload()]);
  }
}

/** The annotated, non-power references on a sheet, read by the reference list. */
function refsOn(aPath: SCH_SHEET_PATH): { ref: string; symbol: SCH_SYMBOL }[] {
  const list = new SCH_REFERENCE_LIST();
  aPath.GetSymbols(list, SYMBOL_FILTER.SYMBOL_FILTER_NON_POWER, true);
  const out: { ref: string; symbol: SCH_SYMBOL }[] = [];
  for (let i = 0; i < list.GetCount(); i++) {
    const r = list.at(i);
    out.push({ ref: r.GetSymbol().GetRef(aPath), symbol: r.GetSymbol() });
  }
  return out.filter((r) => !r.ref.startsWith('#') && !r.ref.endsWith('?'));
}

function setUp() {
  const cfg = new CROSS_PROBING_SETTINGS();
  const h = schToolHarness(schFrame({ crossProbingSettings: () => cfg }));
  openProject(h.frame, ORACLE, 'complex_hierarchy', SHEETS);
  const schematic = h.frame.Schematic();
  const root = schematic.Hierarchy()[0]!;
  const sub = schematic.Hierarchy().find((p) => p.size() > 1 && refsOn(p).length > 0)!;
  h.frame.SetCurrentSheet(root);
  const kiway = new KIWAY({
    OnKiCadExit: () => {},
    Player: () => true,
    HasProjectManager: () => true,
    ShowProjectManager: () => {},
    CreateKiWindow: () => false,
  });
  h.frame.SetKiway(kiway);
  kiway.SetPlayerFrame(FRAME_T.FRAME_SCH, h.frame);
  const pcb = new PCB_STUB();
  kiway.SetPlayerFrame(FRAME_T.FRAME_PCB_EDITOR, pcb);
  const select = (packet: string, force = false) =>
    kiway.ExpressMail(
      FRAME_T.FRAME_SCH,
      force ? MAIL_T.MAIL_SELECTION_FORCE : MAIL_T.MAIL_SELECTION,
      { value: packet },
      pcb,
    );
  const sel = h.frame.GetToolManager()!.GetTool(SCH_SELECTION_TOOL)!;
  return { h, cfg, schematic, root, sub, pcb, select, sel };
}

describe('findItemsFromSyncSelection', () => {
  it('F<ref> finds the symbol on the sheet that has it; P<ref>/<pad> its pin', () => {
    const { schematic, sub } = setUp();
    const [a] = refsOn(sub);
    const pin = a!.symbol.GetPins(sub)[0]!;

    const byRef = findItemsFromSyncSelection(schematic, `F${a!.ref}`, false)!;
    expect(byRef[0].equals(sub)).toBe(true);
    expect(byRef[1]).toBe(null);
    expect(byRef[2]).toContain(a!.symbol);

    const byPad = findItemsFromSyncSelection(schematic, `P${a!.ref}/${pin.GetNumber()}`, true)!;
    expect(byPad[1]).toBe(pin);
    expect(byPad[2]).toEqual([pin]);
  });

  it('a sheet all of whose symbols are wanted is selected as the sheet', () => {
    const { schematic, root, sub } = setUp();
    const parentRefs = refsOn(root).map((r) => `F${r.ref}`);
    const subRefs = refsOn(sub).map((r) => `F${r.ref}`);
    expect(parentRefs.length).toBeGreaterThan(0);
    expect(sub.size()).toBe(2); // a direct child of the root

    // The root's own symbols first, so the root is the sheet that answers.
    const ret = findItemsFromSyncSelection(
      schematic,
      [...parentRefs, ...subRefs].join(','),
      false,
    )!;
    expect(ret[0].equals(root)).toBe(true);
    expect(
      ret[2].some((i) => i.Type() === KICAD_T.SCH_SHEET_T && i.m_Uuid === sub.Last()!.m_Uuid),
    ).toBe(true);

    // Leaving one symbol of the sheet out leaves the sheet out.
    const partial = findItemsFromSyncSelection(
      schematic,
      [...parentRefs, ...subRefs.slice(1)].join(','),
      false,
    )!;
    expect(partial[2].some((i) => i.m_Uuid === sub.Last()!.m_Uuid)).toBe(false);
  });

  it('nothing it can find is no answer', () => {
    const { schematic } = setUp();
    expect(findItemsFromSyncSelection(schematic, 'FNOPE999,Zjunk', false)).toBe(null);
  });
});

describe('KiwayMailIn MAIL_SELECTION', () => {
  it('selects what the board names, on the sheet that has it', () => {
    const { h, sub, select, sel } = setUp();
    const [a] = refsOn(sub);

    select(`$SELECT: 0,F${a!.ref}`);

    expect(h.frame.GetCurrentSheet().equals(sub)).toBe(true);
    expect(sel.GetSelection().Items()).toContain(a!.symbol);
    expect(h.frame.IsSyncingSelection()).toBe(false);
  });

  it('is refused with on_selection off, unless forced; a short command is dropped', () => {
    const { cfg, sub, select, sel } = setUp();
    const [a] = refsOn(sub);
    cfg.on_selection = false;

    select(`$SELECT: 0,F${a!.ref}`);
    expect(sel.GetSelection().Items()).toEqual([]);

    select('$SELECT: 0');
    expect(sel.GetSelection().Items()).toEqual([]);

    select(`$SELECT: 0,F${a!.ref}`, true);
    expect(sel.GetSelection().Items()).toContain(a!.symbol);
  });

  it('flashes the probed items: cleared, restored, six times, then left selected', () => {
    vi.useFakeTimers();
    const { cfg, sub, select, sel } = setUp();
    const [a] = refsOn(sub);
    cfg.flash_selection = true;

    select(`$SELECT: 0,F${a!.ref}`);
    const seen: boolean[] = [];
    for (let i = 0; i < 8; i++) {
      vi.advanceTimersByTime(500);
      seen.push(sel.GetSelection().Items().includes(a!.symbol));
    }

    // Phases 0..6 alternate clear/restore; after phase 6 the items are restored and it stops.
    expect(seen).toEqual([false, true, false, true, false, true, true, true]);
  });
});

describe('SendSelectItemsToPcb', () => {
  it('mails $SELECT: 0,F<ref>,S<path><uuid>, forced or not, and nothing for items that name nothing', () => {
    const { h, root, pcb } = setUp();
    const screen = root.LastScreen()!;
    const symbol = [...screen.Items().OfType(KICAD_T.SCH_SYMBOL_T)][0] as SCH_SYMBOL;
    const sheet = [...screen.Items().OfType(KICAD_T.SCH_SHEET_T)][0]!;

    h.frame.SendSelectItemsToPcb([symbol, sheet, new SCH_TEXT({ x: 0, y: 0 }, 'skipped')], false);
    h.frame.SendSelectItemsToPcb([symbol], true);
    h.frame.SendSelectItemsToPcb([new SCH_TEXT({ x: 0, y: 0 }, 'x')], true);

    const ref = symbol.GetRef(root, false);
    expect(pcb.received).toEqual([
      [MAIL_T.MAIL_SELECTION, `$SELECT: 0,F${ref},S${root.PathAsString()}${sheet.m_Uuid}`],
      [MAIL_T.MAIL_SELECTION_FORCE, `$SELECT: 0,F${ref}`],
    ]);
  });
});

describe('SCH_SELECTION_TOOL::ZoomFitCrossProbeBBox', () => {
  /** A view whose viewport is \a aY world units tall, as the canvas would report. */
  function zoomer(aX: number, aY: number) {
    const { sel } = setUp();
    const view = (
      sel as unknown as {
        getView(): { GetViewport(): BOX2D; GetScale(): number; SetScale(s: number): void };
      }
    ).getView();
    view.GetViewport = () => new BOX2D({ x: 0, y: 0 }, { x: aX, y: aY });
    let scale = 1;
    view.GetScale = () => scale;
    view.SetScale = (s: number) => {
      scale = s;
    };
    const box = (w: number, h: number) => new BOX2I({ x: 0, y: 0 }, { x: w, y: h });
    return { sel, box, scale: () => scale };
  }

  it('is the arithmetic of upstream, to the number', () => {
    // Worked by hand:
    //   box            0.5 mm         -> 5000 IU square
    //   Inflate(20%)   KiROUND(1000)  each side -> bbSize 7000 x 7000
    //   TEXT_HEIGHT    MilsToIU(50)   = 12700
    //   compRatio      7000/12700     = 0.551, under the LUT's first entry -> bent 16
    //   screen         200 x 133 mm   = 2000000 x 1330000
    //   ratio          7000/1330000   = 0.0052631..., part fits, so ratio*16 = 0.0842105...
    //   < 0.5, so SetScale(1 / 0.0842105...) = 11.875
    const z = zoomer(mmToIU(200), mmToIU(133));
    z.sel.ZoomFitCrossProbeBBox(z.box(mmToIU(0.5), mmToIU(0.5)));
    expect(z.scale()).toBeCloseTo(11.875, 9);
  });

  it('measures against the schematic default text height: two boxes under the first LUT entry scale inversely', () => {
    // 0.5 and 1.0 mm inflate to 7000 and 14000, both under 1.25 x 12700 = 15875: same bend (16).
    const a = zoomer(mmToIU(200), mmToIU(133));
    a.sel.ZoomFitCrossProbeBBox(a.box(mmToIU(0.5), mmToIU(0.5)));
    const b = zoomer(mmToIU(200), mmToIU(133));
    b.sel.ZoomFitCrossProbeBBox(b.box(mmToIU(1), mmToIU(1)));
    expect(a.scale() / b.scale()).toBeCloseTo(2, 9);
  });

  it('leaves a ratio inside 0.5..1.0 alone, and a zero-width box', () => {
    // bbSize.y 1.2 x h; a box 0.5 of the screen tall bends by 1 (compRatio > 100): ratio 0.6.
    const z = zoomer(mmToIU(2000), mmToIU(1000));
    z.sel.ZoomFitCrossProbeBBox(z.box(mmToIU(500), mmToIU(500)));
    expect(z.scale()).toBe(1);
    z.sel.ZoomFitCrossProbeBBox(z.box(0, mmToIU(5)));
    expect(z.scale()).toBe(1);
  });
});

describe('ExecuteRemoteCommand $NET:', () => {
  /** A net of the open project, as a wire on the root sheet names it. */
  function aNet(aFrame: ReturnType<typeof setUp>['h']['frame']): string {
    aFrame.RecalculateConnections(null, SCH_CLEANUP_FLAGS.GLOBAL_CLEANUP);
    const root = aFrame.Schematic().Hierarchy()[0]!;
    for (const item of root.LastScreen()!.Items().OfType(KICAD_T.SCH_LINE_T)) {
      const name = (item as SCH_ITEM).Connection(root)?.Name();
      if (name) return name;
    }
    throw new Error('no named net on the root sheet');
  }

  it('highlights the named net and says so in the status bar; "" clears', () => {
    const { h } = setUp();
    const status: string[] = [];
    h.frame.SetStatusTextSink((t, n) => n === 0 && status.push(t));
    const net = aNet(h.frame);

    h.frame.ExecuteRemoteCommand(`$NET: "${net}"`);
    expect(h.frame.GetHighlightedConnection()).toBe(net);
    expect(status.at(-1)).toMatch(/^Highlighted net: /);

    h.frame.ExecuteRemoteCommand('$NET: ""');
    expect(h.frame.GetHighlightedConnection()).toBe('');
  });

  it('is refused with auto_highlight off, leaving what is lit alone', () => {
    const { h, cfg } = setUp();
    const net = aNet(h.frame);
    h.frame.ExecuteRemoteCommand(`$NET: "${net}"`);
    cfg.auto_highlight = false;

    h.frame.ExecuteRemoteCommand('$NET: ""');

    expect(h.frame.GetHighlightedConnection()).toBe(net);
  });
});
