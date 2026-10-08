// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SCH_EDITOR_CONTROL's copy half on the live model: doCopy, Copy, Cut, Copy as Text
 * (sch_editor_control.cpp:1651-1855), SCH_IO_KICAD_SEXPR::Format( SCH_SELECTION* … ) and
 * sch_tool_utils.cpp's GetSelectedItemsAsText.
 */
import { resolve } from 'node:path';
import {
  GetClipboardText,
  GetClipboardUTF8,
  SetClipboardFromText,
} from '@ziroeda/common/clipboard.js';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { SCH_IO_KICAD_SEXPR } from '@ziroeda/eeschema/sch_io/kicad_sexpr/sch_io_kicad_sexpr.js';
import { SCH_SCREEN } from '@ziroeda/eeschema/sch_screen.js';
import { SCH_SHEET } from '@ziroeda/eeschema/sch_sheet.js';
import type { SCH_SYMBOL } from '@ziroeda/eeschema/sch_symbol.js';
import { SCH_TEXT } from '@ziroeda/eeschema/sch_text.js';
import { SCH_SELECTION_TOOL } from '@ziroeda/eeschema/tools/sch_selection_tool.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openProject, schFrame, schToolHarness } from './support/sch_tool_harness.js';

const ORACLE = resolve(__dirname, '../../data/eeschema/netlist_oracle/complex_hierarchy');
const SHEETS = ['complex_hierarchy.kicad_sch', 'ampli_ht.kicad_sch', 'complex_hierarchy.kicad_pro'];
const G = 50 * 254;
const FAR = 3000 * G;
const P = (x: number, y: number) => ({ x: FAR + x * G, y: FAR + y * G });

beforeEach(() => {
  SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER()));
  SetClipboardFromText('');
});
afterEach(() => SetPgm(null));

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
  const sel = mgr.GetTool(SCH_SELECTION_TOOL)!;
  const text = (x: number, y: number, aText: string) => {
    const t = new SCH_TEXT(P(x, y), aText);
    h.frame.AddToScreen(t, h.frame.GetScreen());
    return t;
  };
  return { ...h, mgr, sel, text };
}

/** Load clipboard content into a fresh sheet, as Paste does. */
function load(h: ReturnType<typeof setUp>, aContent: string) {
  const sheet = new SCH_SHEET();
  sheet.SetScreen(new SCH_SCREEN(h.frame.Schematic()));
  new SCH_IO_KICAD_SEXPR().LoadContent(aContent, sheet);
  return [...sheet.GetScreen()!.Items()];
}

describe('copying the selection', () => {
  it('Copy puts the selection on the clipboard as KiCad data that loads back', () => {
    const h = setUp();
    const a = h.text(0, 0, 'ZQX one');
    const b = h.text(5, 0, 'ZQX two');
    h.sel.AddItemToSel(a, true);
    h.sel.AddItemToSel(b, true);

    h.mgr.RunAction(ACTIONS.copy);

    const content = GetClipboardUTF8();
    const loaded = load(h, content)
      .map((i) => (i as SCH_TEXT).GetText())
      .sort();
    expect(loaded).toEqual(['ZQX one', 'ZQX two']);
    // The plain-text format carries the same KiCad data.
    expect(GetClipboardText()).toBe(content);
  });

  it('a copied symbol brings its library symbol along', () => {
    const h = setUp();
    const symbol = [...h.frame.GetScreen()!.Items().OfType(KICAD_T.SCH_SYMBOL_T)][0] as SCH_SYMBOL;
    h.sel.AddItemToSel(symbol, true);

    h.mgr.RunAction(ACTIONS.copy);

    const content = GetClipboardUTF8();
    expect(content.startsWith('(lib_symbols')).toBe(true);

    const sheet = new SCH_SHEET();
    sheet.SetScreen(new SCH_SCREEN(h.frame.Schematic()));
    new SCH_IO_KICAD_SEXPR().LoadContent(content, sheet);
    const pasted = [...sheet.GetScreen()!.Items().OfType(KICAD_T.SCH_SYMBOL_T)] as SCH_SYMBOL[];

    expect(pasted.length).toBe(1);
    expect(sheet.GetScreen()!.GetLibSymbols().has(symbol.GetSchSymbolLibraryName())).toBe(true);
  });

  it('Cut copies, then deletes the selection', () => {
    const h = setUp();
    const t = h.text(0, 0, 'ZQX cut');
    h.sel.AddItemToSel(t, true);

    h.mgr.RunAction(ACTIONS.cut);

    expect(GetClipboardUTF8()).toContain('ZQX cut');
    expect([...h.frame.GetScreen()!.Items()].includes(t)).toBe(false);
  });

  it('Copy with nothing selected leaves the clipboard alone', () => {
    const h = setUp();
    SetClipboardFromText('untouched');
    h.sel.ClearSelection(true);
    h.h.mouse = P(-400, -400);

    h.mgr.RunAction(ACTIONS.copy);

    expect(GetClipboardUTF8()).toBe('untouched');
  });

  it('Copy as Text is one trimmed line per item that has text', () => {
    const h = setUp();
    const a = h.text(0, 0, '  ZQX first ');
    const b = h.text(0, 5, 'ZQX second');
    h.sel.AddItemToSel(a, true);
    h.sel.AddItemToSel(b, true);

    h.mgr.RunAction(ACTIONS.copyAsText);

    expect(GetClipboardUTF8().split('\n').sort()).toEqual(['ZQX first', 'ZQX second']);
  });
});
