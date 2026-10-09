// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_CHANGE_SYMBOLS (dialog_change_symbols.cpp) on the live schematic: the opening checklist
 * (Reference and Value from the settings, the rest on), the match the symbol seeds, the fields
 * list from the matching symbols, a Change to a derived library symbol caching its flattened
 * parent's body as one commit, the reference re-prefixed with its number kept, and the report
 * lines for a missing symbol and for nothing matched.
 */
import { resolve } from 'node:path';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { RPT_SEVERITY_ACTION, RPT_SEVERITY_ERROR } from '@ziroeda/common/reporter.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import {
  MEMORY_FILESYSTEM,
  wxMountFileSystem,
  wxWriteFileSync,
} from '@ziroeda/common/wx/filefn.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import {
  CHANGE_SYMBOLS_MATCH,
  DIALOG_CHANGE_SYMBOLS,
} from '@ziroeda/eeschema/dialogs/dialog_change_symbols.js';
import {
  setUpdateEeschemaSettingsProvider,
  type EeschemaSettings,
} from '@ziroeda/eeschema/eeschema_settings.js';
import { SCH_FIELD } from '@ziroeda/eeschema/sch_field.js';
import { SCH_IO_KICAD_SEXPR } from '@ziroeda/eeschema/sch_io/kicad_sexpr/sch_io_kicad_sexpr.js';
import type { SCH_SYMBOL } from '@ziroeda/eeschema/sch_symbol.js';
import { DIALOG_CHANGE_SYMBOLS_MODE } from '@ziroeda/eeschema/tools/sch_edit_tool.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openProject, schFrame, schToolHarness } from './support/sch_tool_harness.js';

const ORACLE = resolve(__dirname, '../../data/eeschema/netlist_oracle/complex_hierarchy');
const SHEETS = ['complex_hierarchy.kicad_sch', 'ampli_ht.kicad_sch', 'complex_hierarchy.kicad_pro'];

/** As served: the parent carries the body, the child only fields. */
const LIBRARY = `(kicad_symbol_lib (version 20241209) (generator "kicad_symbol_editor")
  (symbol "1N4001" (pin_numbers (hide yes)) (pin_names (offset 1.016) (hide yes))
    (exclude_from_sim no) (in_bom yes) (on_board yes)
    (property "Reference" "D" (at 0 2.54 0) (effects (font (size 1.27 1.27))))
    (property "Value" "1N4001" (at 0 -2.54 0) (effects (font (size 1.27 1.27))))
    (symbol "1N4001_0_1"
      (polyline (pts (xy -1.27 1.27) (xy -1.27 -1.27)) (stroke (width 0.254) (type default)) (fill (type none)))
      (polyline (pts (xy 1.27 1.27) (xy 1.27 -1.27) (xy -1.27 0) (xy 1.27 1.27)) (stroke (width 0.254) (type default)) (fill (type none)))
      (polyline (pts (xy 1.27 0) (xy -1.27 0)) (stroke (width 0) (type default)) (fill (type none))))
    (symbol "1N4001_1_1"
      (pin passive line (at -3.81 0 0) (length 2.54) (name "K" (effects (font (size 1.27 1.27)))) (number "1" (effects (font (size 1.27 1.27)))))
      (pin passive line (at 3.81 0 180) (length 2.54) (name "A" (effects (font (size 1.27 1.27)))) (number "2" (effects (font (size 1.27 1.27)))))))
  (symbol "1N4007" (extends "1N4001")
    (property "Reference" "D" (at 0 2.54 0) (effects (font (size 1.27 1.27))))
    (property "Value" "1N4007" (at 0 -2.54 0) (effects (font (size 1.27 1.27))))))`;

let unmount: () => void = () => {};

beforeEach(() => {
  SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER()));
  unmount = wxMountFileSystem('/lib', new MEMORY_FILESYSTEM());
  wxWriteFileSync('/lib/Diode.kicad_sym', new TextEncoder().encode(LIBRARY));
});
afterEach(() => {
  unmount();
  SetPgm(null);
});

function setUp() {
  const h = schToolHarness(schFrame({}));
  openProject(h.frame, ORACLE, 'complex_hierarchy', SHEETS);
  const sub = h.frame
    .Schematic()
    .Hierarchy()
    .find((p) => p.size() === 2)!;
  h.frame.SetCurrentSheet(sub);
  const sym = ([...h.frame.GetScreen()!.Items().OfType(KICAD_T.SCH_SYMBOL_T)] as SCH_SYMBOL[]).find(
    (s) => s.GetLibId().GetLibItemName() === 'D_Small',
  )!;
  // GetLibSymbol: Diode:1N4007 from the mounted library, anything else unknown.
  vi.spyOn(h.frame, 'GetLibSymbol').mockImplementation(async (aLibId: LIB_ID) =>
    aLibId.Format() === 'Diode:1N4007'
      ? new SCH_IO_KICAD_SEXPR().LoadSymbol('/lib/Diode.kicad_sym', '1N4007')
      : null,
  );
  const chooser = vi.fn(async () => null);
  const dlg = (aMode: DIALOG_CHANGE_SYMBOLS_MODE, aSymbol: SCH_SYMBOL | null = sym) =>
    new DIALOG_CHANGE_SYMBOLS(h.frame, aSymbol, aMode, chooser);
  return { h, sym, dlg, chooser };
}

describe('DIALOG_CHANGE_SYMBOLS', () => {
  it('opens with Reference and Value unchecked (the settings) and the other three on', () => {
    const { dlg } = setUp();
    const d = dlg(DIALOG_CHANGE_SYMBOLS_MODE.UPDATE);

    expect(d.m_fieldsBox.map((r) => [r.name, r.checked])).toEqual([
      ['Reference', false],
      ['Value', false],
      ['Footprint', true],
      ['Datasheet', true],
      ['Description', true],
    ]);
    expect([d.m_resetFieldText, d.m_resetFieldPositions]).toEqual([true, false]);
    expect(dlg(DIALOG_CHANGE_SYMBOLS_MODE.CHANGE).m_resetFieldPositions).toBe(true);
  });

  it('seeds the entries from the symbol, and matches by reference in Change mode', async () => {
    const { h, sym, dlg } = setUp();
    const d = dlg(DIALOG_CHANGE_SYMBOLS_MODE.CHANGE);
    await d.TransferDataToWindow();

    expect(d.m_specifiedReference).toBe(sym.GetRef(h.frame.GetCurrentSheet()));
    expect(d.m_specifiedId).toBe('complex_hierarchy_schlib:D_Small');
    expect(d.m_match).toBe(CHANGE_SYMBOLS_MATCH.REFERENCE);

    const u = dlg(DIALOG_CHANGE_SYMBOLS_MODE.UPDATE, null);
    await u.TransferDataToWindow();
    expect(u.m_match).toBe(CHANGE_SYMBOLS_MATCH.ALL);
  });

  it('lists the user fields of the matching symbols after the mandatory five', async () => {
    const { sym, dlg } = setUp();
    const mpn = new SCH_FIELD(sym, FIELD_T.USER, 'MPN');
    mpn.SetText('x');
    sym.AddField(mpn);
    const d = dlg(DIALOG_CHANGE_SYMBOLS_MODE.CHANGE);
    await d.TransferDataToWindow();

    expect(d.m_fieldsBox.slice(5).map((r) => r.name)).toEqual(['MPN']);
  });

  it('changes a symbol to a derived library symbol, caching its parent’s body, as one commit', async () => {
    const { h, sym, dlg } = setUp();
    const undo = h.frame.GetUndoCommandCount();
    const ref = sym.GetRef(h.frame.GetCurrentSheet());
    const value = sym.GetField(FIELD_T.VALUE)!.GetText();
    const d = dlg(DIALOG_CHANGE_SYMBOLS_MODE.CHANGE);
    await d.TransferDataToWindow();
    d.m_newId = 'Diode:1N4007';

    await d.OnOkButtonClicked();

    expect(sym.GetLibId().Format()).toBe('Diode:1N4007');
    expect(sym.GetLibSymbolRef()!.GetPins()).toHaveLength(2);
    // Value is not checked, so the symbol keeps its own.
    expect(sym.GetField(FIELD_T.VALUE)!.GetText()).toBe(value);
    expect(h.frame.GetUndoCommandCount()).toBe(undo + 1);
    const last = d.m_messagePanel.lines.at(-1)!;
    expect(last.severity).toBe(RPT_SEVERITY_ACTION);
    expect(last.message).toMatch(
      new RegExp(
        `^Change symbols? .*\\b${ref}\\b.* from 'complex_hierarchy_schlib:D_Small' to 'Diode:1N4007': OK$`,
      ),
    );
  });

  it('re-prefixes the reference from the library, keeping its number, when Reference is checked', async () => {
    const { h, sym, dlg } = setUp();
    const sheet = h.frame.GetCurrentSheet();
    sym.SetRef(sheet, 'X7');
    const d = dlg(DIALOG_CHANGE_SYMBOLS_MODE.CHANGE);
    await d.TransferDataToWindow();
    // WildCompareString( …, false ): the reference pattern ignores case.
    d.m_specifiedReference = 'x?';
    d.m_newId = 'Diode:1N4007';
    d.m_fieldsBox[0]!.checked = true;
    d.m_fieldsBox[1]!.checked = true;

    await d.OnOkButtonClicked();

    expect(sym.GetRef(sheet)).toBe('D7');
    expect(sym.GetField(FIELD_T.VALUE)!.GetText()).toBe('1N4007');
  });

  it('reports a symbol its library does not have, and changes nothing', async () => {
    const { h, sym, dlg } = setUp();
    const undo = h.frame.GetUndoCommandCount();
    const d = dlg(DIALOG_CHANGE_SYMBOLS_MODE.UPDATE);
    await d.TransferDataToWindow();
    d.m_match = CHANGE_SYMBOLS_MATCH.SELECTION;

    await d.OnOkButtonClicked();

    expect(d.m_messagePanel.lines.map((l) => [l.message.split(': ').at(-1), l.severity])).toEqual([
      ['*** symbol not found ***', RPT_SEVERITY_ERROR],
    ]);
    expect(sym.GetLibId().Format()).toBe('complex_hierarchy_schlib:D_Small');
    expect(h.frame.GetUndoCommandCount()).toBe(undo);
  });

  it('reports when nothing matches', async () => {
    const { dlg } = setUp();
    const d = dlg(DIALOG_CHANGE_SYMBOLS_MODE.CHANGE);
    await d.TransferDataToWindow();
    d.m_specifiedReference = 'NOPE*';
    d.m_newId = 'Diode:1N4007';

    await d.OnOkButtonClicked();

    expect(d.m_messagePanel.lines.map((l) => l.message)).toEqual([
      '*** No symbols matching criteria found ***',
    ]);
  });

  it('remembers the Reference and Value checks', () => {
    const { dlg } = setUp();
    const d = dlg(DIALOG_CHANGE_SYMBOLS_MODE.UPDATE);
    d.m_fieldsBox[1]!.checked = true;
    // The settings store's writer, as OnKifaceStart installs it.
    const written = {
      change_symbols: { update_references: true, update_values: false },
    } as EeschemaSettings;
    setUpdateEeschemaSettingsProvider((mutate) => mutate(written));

    d.SaveSettings();
    setUpdateEeschemaSettingsProvider(() => {});

    expect(written.change_symbols).toEqual({
      update_references: false,
      update_values: true,
    });
  });
});
