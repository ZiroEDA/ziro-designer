// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SCH_DRAWING_TOOLS::PlaceSymbol and PlaceNextSymbolUnit (tools/sch_drawing_tools.cpp) on the
 * TOOL_MANAGER, with the chooser and the library answered through the frame's hooks.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { TA_MOUSE_MOTION } from '@ziroeda/common/tool/tool_event.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { LIB_SYMBOL } from '@ziroeda/eeschema/lib_symbol.js';
import type { SCH_EDIT_FRAME_HOOKS } from '@ziroeda/eeschema/sch_edit_frame.js';
import { wxWriteFileSync } from '@ziroeda/common/wx/filefn.js';
import { SCH_IO_KICAD_SEXPR_LIB_CACHE } from '@ziroeda/eeschema/sch_io/kicad_sexpr/sch_io_kicad_sexpr_lib_cache.js';
import type { PICKED_SYMBOL } from '@ziroeda/eeschema/sch_screen.js';
import type { SCH_SYMBOL } from '@ziroeda/eeschema/sch_symbol.js';
import {
  EESCHEMA_DEFAULTS,
  setEeschemaSettingsProvider,
} from '@ziroeda/eeschema/eeschema_settings.js';
import { SCH_ACTIONS } from '@ziroeda/eeschema/tools/sch_actions.js';
import { SCH_SELECTION_TOOL } from '@ziroeda/eeschema/tools/sch_selection_tool.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { click, mouse, openProject, schFrame, schToolHarness } from './support/sch_tool_harness.js';

const DATA = resolve(__dirname, '../../data');
const ORACLE = resolve(DATA, 'eeschema/netlist_oracle/complex_hierarchy');
const SHEETS = ['complex_hierarchy.kicad_sch', 'ampli_ht.kicad_sch', 'complex_hierarchy.kicad_pro'];
const G = 50 * 254;
const FAR = 3000 * G;
const P = (x: number, y: number) => ({ x: FAR + x * G, y: FAR + y * G });
const at = (p: { x: number; y: number }, q: { x: number; y: number }) => p.x === q.x && p.y === q.y;

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};

/** The named symbol of a .kicad_sym file as the library would load it, under \a aLibId. */
function libSymbol(aFile: string, aName: string, aLibId: string): LIB_SYMBOL {
  const path = `/tmp/place_symbol/${aFile}`;
  wxWriteFileSync(path, new Uint8Array(readFileSync(resolve(DATA, aFile))));
  const cache = new SCH_IO_KICAD_SEXPR_LIB_CACHE(path);
  cache.Load();
  const sym = cache.GetSymbolMap().get(aName)!;
  sym.SetLibId(new LIB_ID(aLibId.split(':')[0]!, aLibId.split(':')[1]!));
  return sym;
}

beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => SetPgm(null));

function setUp(
  aPick: (aHistory: readonly PICKED_SYMBOL[]) => PICKED_SYMBOL | null,
  aLib: () => LIB_SYMBOL,
) {
  const hooks: Partial<SCH_EDIT_FRAME_HOOKS> = {
    pickSymbol: async (_f, history) => aPick(history),
  };
  const h = schToolHarness(schFrame(hooks));
  // The library: GetLibSymbol answers from the test, as a mounted library would.
  h.frame.GetLibSymbol = async () => aLib();
  openProject(h.frame, ORACLE, 'complex_hierarchy', SHEETS);
  h.frame.SetCurrentSheet(
    h.frame
      .Schematic()
      .Hierarchy()
      .find((p) => p.size() === 1)!,
  );
  const mgr = h.frame.GetToolManager()!;
  return { ...h, mgr, sel: mgr.GetTool(SCH_SELECTION_TOOL)!, screen: () => h.frame.GetScreen()! };
}

const placed = (h: ReturnType<typeof setUp>, aAt: { x: number; y: number }) =>
  ([...h.screen().Items().OfType(KICAD_T.SCH_SYMBOL_T)] as SCH_SYMBOL[]).filter((s) =>
    at(s.GetPosition(), aAt),
  );

const R = () => libSymbol('R.kicad_sym', 'R', 'Device:R');
const pickR = (): PICKED_SYMBOL => ({
  LibId: new LIB_ID('Device', 'R'),
  Unit: 0,
  Convert: 1,
  Fields: [],
});

describe('SCH_DRAWING_TOOLS::PlaceSymbol', () => {
  it('chooses on the first click, follows the cursor, and places on the second', async () => {
    const histories: number[] = [];
    const h = setUp((hist) => {
      histories.push(hist.length);
      return pickR();
    }, R);
    const undo = h.frame.GetUndoCommandCount();
    h.h.mouse = P(0, 0); // the primed click opens the chooser
    h.mgr.RunAction(SCH_ACTIONS.placeSymbol);
    await flush();
    mouse(h, TA_MOUSE_MOTION, P(4, 0));
    click(h, P(4, 0));
    await flush();
    h.mgr.RunAction(ACTIONS.cancelInteractive);
    await flush();
    h.mgr.RunAction(ACTIONS.cancelInteractive);
    const syms = placed(h, P(4, 0));
    expect(syms).toHaveLength(1);
    expect(syms[0]!.GetLibId().Format()).toBe('Device:R');
    expect(syms[0]!.IsNew()).toBe(false);
    // annotated on placement (automatic annotation is on by default)
    expect(syms[0]!.GetRef(h.frame.GetCurrentSheet())).toMatch(/^R\d+$/);
    expect(h.frame.GetUndoCommandCount()).toBe(undo + 1);
    expect(histories).toEqual([0]);
  });

  it('a cancelled chooser places nothing', async () => {
    const h = setUp(() => null, R);
    const before = [...h.screen().Items().OfType(KICAD_T.SCH_SYMBOL_T)].length;
    h.h.mouse = P(0, 0);
    h.mgr.RunAction(SCH_ACTIONS.placeSymbol);
    await flush();
    click(h, P(4, 0));
    await flush();
    h.mgr.RunAction(ACTIONS.cancelInteractive);
    expect([...h.screen().Items().OfType(KICAD_T.SCH_SYMBOL_T)].length).toBe(before);
  });

  it('the pick goes to the front of the history the chooser is shown next time', async () => {
    const histories: (readonly PICKED_SYMBOL[])[] = [];
    const h = setUp((hist) => {
      histories.push([...hist]);
      return pickR();
    }, R);
    h.h.mouse = P(0, 0);
    h.mgr.RunAction(SCH_ACTIONS.placeSymbol);
    await flush();
    click(h, P(0, 0));
    await flush();
    // the tool asks again on the next click
    click(h, P(8, 0));
    await flush();
    h.mgr.RunAction(ACTIONS.cancelInteractive);
    await flush();
    h.mgr.RunAction(ACTIONS.cancelInteractive);
    expect(histories).toHaveLength(2);
    expect(histories[1]!.map((p) => p.LibId.Format())).toEqual(['Device:R']);
    expect(histories[1]![0]!.Unit).toBe(1); // a picked symbol (unit 0) is unit 1
  });

  it('places a given symbol once and leaves the tool', async () => {
    const h = setUp(() => null, R);
    const sym = placed(h, P(0, 0)); // none
    expect(sym).toHaveLength(0);
    const template = ([...h.screen().Items().OfType(KICAD_T.SCH_SYMBOL_T)] as SCH_SYMBOL[])[0]!;
    const copy = template.Clone() as SCH_SYMBOL;
    h.h.mouse = P(0, 0);
    h.mgr.RunAction(SCH_ACTIONS.placeSymbol, { m_Symbol: copy, m_Reannotate: false });
    await flush();
    mouse(h, TA_MOUSE_MOTION, P(6, 2));
    click(h, P(6, 2));
    await flush();
    const here = placed(h, P(6, 2));
    expect(here.length === 1 && here[0] === copy).toBe(true);
    // the tool is gone: another click places nothing new
    click(h, P(12, 2));
    await flush();
    expect(placed(h, P(12, 2))).toHaveLength(0);
  });
});

describe('drawing.new_power_symbols on a placed power symbol', () => {
  const GND = () => libSymbol('GND.kicad_sym', 'GND', 'power:GND');
  const pickGND = (): PICKED_SYMBOL => ({
    LibId: new LIB_ID('power', 'GND'),
    Unit: 0,
    Convert: 1,
    Fields: [],
  });

  function withPowerSymbols(aMode: 0 | 1 | 2): void {
    const settings = {
      ...EESCHEMA_DEFAULTS,
      drawing: { ...EESCHEMA_DEFAULTS.drawing, new_power_symbols: aMode },
    };
    setEeschemaSettingsProvider(() => settings);
  }

  afterEach(() => setEeschemaSettingsProvider(() => EESCHEMA_DEFAULTS));

  async function place(aPick: () => PICKED_SYMBOL, aLib: () => LIB_SYMBOL, aAt = P(8, 8)) {
    const h = setUp(aPick, aLib);
    h.h.mouse = P(0, 0);
    h.mgr.RunAction(SCH_ACTIONS.placeSymbol);
    await flush();
    mouse(h, TA_MOUSE_MOTION, aAt);
    click(h, aAt);
    await flush();
    h.mgr.RunAction(ACTIONS.cancelInteractive);
    await flush();
    h.mgr.RunAction(ACTIONS.cancelInteractive);
    return placed(h, aAt)[0]!.GetLibSymbolRef()!;
  }

  it('keeps the definition’s own kind on Default', async () => {
    withPowerSymbols(0);
    const lib = await place(pickGND, GND);
    expect([lib.IsGlobalPower(), lib.IsLocalPower()]).toEqual([true, false]);
  });

  it('makes a global power symbol local, and rewords its keywords and description', async () => {
    withPowerSymbols(2);
    const lib = await place(pickGND, GND);
    expect(lib.IsLocalPower()).toBe(true);
    expect(lib.GetKeyWords()).toBe('local power');
    expect(lib.GetDescription()).toContain('local label');
    expect(lib.GetDescription()).not.toContain('global label');
  });

  it('never makes an ordinary symbol a power symbol', async () => {
    withPowerSymbols(2);
    const lib = await place(pickR, R);
    expect(lib.IsPower()).toBe(false);
  });
});

describe('SCH_DRAWING_TOOLS::PlaceNextSymbolUnit', () => {
  const TESTPART = () =>
    libSymbol('eeschema/legacy/legacy_all.kicad_sym', 'TESTPART', 'Legacy:TESTPART');
  const pickPart = (): PICKED_SYMBOL => ({
    LibId: new LIB_ID('Legacy', 'TESTPART'),
    Unit: 1,
    Convert: 1,
    Fields: [],
  });

  it('places the lowest unit not yet placed, under the same reference; then there is none', async () => {
    const msgs: string[] = [];
    const h = setUp(pickPart, TESTPART);
    h.frame.ShowInfoBarMsg = (m: string) => {
      msgs.push(m);
    };
    h.h.mouse = P(0, 0);
    h.mgr.RunAction(SCH_ACTIONS.placeSymbol);
    await flush();
    click(h, P(0, 0));
    await flush();
    h.mgr.RunAction(ACTIONS.cancelInteractive);
    await flush();
    h.mgr.RunAction(ACTIONS.cancelInteractive);
    const unitA = placed(h, P(0, 0))[0]!;
    expect(unitA.GetUnit()).toBe(1);

    h.sel.ClearSelection(true);
    h.sel.AddItemToSel(unitA, true);
    h.h.mouse = P(10, 0);
    h.mgr.RunAction(SCH_ACTIONS.placeNextSymbolUnit);
    await flush();
    mouse(h, TA_MOUSE_MOTION, P(10, 0));
    click(h, P(10, 0));
    await flush();
    const unitB = placed(h, P(10, 0))[0]!;
    expect(unitB.GetUnit()).toBe(2);
    const sheet = h.frame.GetCurrentSheet();
    expect(unitB.GetRef(sheet)).toBe(unitA.GetRef(sheet));

    h.sel.ClearSelection(true);
    h.sel.AddItemToSel(unitA, true);
    h.mgr.RunAction(SCH_ACTIONS.placeNextSymbolUnit);
    await flush();
    expect(msgs).toContain('All units of this symbol are already placed.');
  });
});
