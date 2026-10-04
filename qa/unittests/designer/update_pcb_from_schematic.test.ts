// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * "Update PCB from Schematic" over a real project: the Arduino_Uno template, whose
 * schematic and board were both written by KiCad and are in sync. This exercises the
 * whole path the PCB editor's menu item takes, fetchNetlistFromSchematic (annotation
 * gate, hierarchy walk, netlist export, parse) and then BOARD_NETLIST_UPDATER over
 * the board, against files no test wrote.
 *
 * The board is from KiCad 6 (file version 20221018), which makes it the useful case:
 * an in-sync project must come out structurally untouched, no footprint added,
 * removed or re-linked, and no net re-connected, while the handful of updates a
 * newer KiCad genuinely applies to an older file still appear. The last test pins
 * down exactly which those are.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';

// The off-screen SCH_EDIT_FRAME the headless netlist opens needs the program's settings
// manager, as the app has from InitPgm.
// The describe blocks fetch while collecting, before any beforeEach runs.
SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER()));
beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => SetPgm(null));
import { parse } from '@ziroeda/sexpr';
import { Reporter, RPT_SEVERITY_ACTION } from '@ziroeda/common';
import { formatSchematicNetlist } from '@ziroeda/eeschema/cross-probing.js';
import { setHeadlessNetlistProvider } from '@ziroeda/pcbnew/netlist_from_schematic.js';
import {
  readBoard,
  serializeBoard,
} from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { libraryLoader, runLiveUpdate } from '../pcbnew/support/netlist_update_harness.js';
import { fetchNetlistFromSchematic } from '@ziroeda/pcbnew/netlist_from_schematic.js';

// The app registers the headless MAIL_SCH_GET_NETLIST answer at startup
// (pgm_app.ts: `setHeadlessNetlistProvider(formatSchematicNetlist)`), since
// pcbnew/ may not import eeschema/. A test that never starts the app does
// the same, before the module-level fetch below runs.
setHeadlessNetlistProvider(formatSchematicNetlist);

/**
 * A KiCad 6-era copy of the Arduino_Uno template, held here rather than read out
 * of designer/public/templates.
 *
 * Half of what this file tests is migration behaviour that only a pre-PCB-fields
 * board can exercise: version 20221018 keeps its sheet name and file in
 * `(property "Sheetname" ...)` with no `(sheetname ...)` token, and the updater
 * must neither duplicate nor churn them. Pointing at the shipped template made
 * those tests hostage to the bundle - re-importing it from a current KiCad
 * (tools/templates/import.mjs) swapped in a 20241229 board that already carries
 * `(sheetfile ...)`, and the assertions became meaningless rather than failing
 * for any reason to do with the code.
 */
const PROJECT = fileURLToPath(new URL('./fixtures/Arduino_Uno_kicad6/', import.meta.url));

/** The project as the editor sees it: `{ name, text }` for every file. */
function projectFiles(): { name: string; text: string }[] {
  const files: { name: string; text: string }[] = [];
  for (const entry of readdirSync(PROJECT, { withFileTypes: true })) {
    if (entry.isFile()) {
      files.push({ name: entry.name, text: readFileSync(`${PROJECT}${entry.name}`, 'utf8') });
    } else if (entry.isDirectory() && entry.name.endsWith('.pretty')) {
      for (const mod of readdirSync(`${PROJECT}${entry.name}`)) {
        files.push({
          name: `${entry.name}/${mod}`,
          text: readFileSync(`${PROJECT}${entry.name}/${mod}`, 'utf8'),
        });
      }
    }
  }
  return files;
}

const FILES = projectFiles();

/**
 * The footprint loader the PCB editor builds: the project's own `.pretty`
 * directories, plus (in the app) the hosted libraries. Only the project side is
 * available offline, so the connector footprints resolve from the board's own copies
 * - which is exactly what the board already holds, and enough to prove the updater
 * leaves an in-sync project alone.
 */
function footprintLibrary(): Map<string, string> {
  const library = new Map<string, string>();

  for (const file of FILES) {
    const match = /([^/]+)\.pretty\/([^/]+)\.kicad_mod$/i.exec(file.name);
    if (match) library.set(`${match[1]}:${match[2]}`, file.text);
  }

  return library;
}

const boardText = FILES.find((f) => f.name.endsWith('.kicad_pcb'))!.text;

describe('fetchNetlistFromSchematic over the Arduino_Uno template', () => {
  const fetched = fetchNetlistFromSchematic(FILES, 'annotate first', 'Arduino_Uno.kicad_pro');

  it('succeeds on an annotated schematic', () => {
    expect(fetched.ok).toBe(true);
  });

  it('finds every board-bound symbol, and no power symbols', () => {
    if (!fetched.ok) throw new Error(fetched.error);
    const refs = fetched.netlist.Components().map((c) => c.GetReference());
    expect(refs).toEqual(['J1', 'J2', 'J3', 'J4']);
    // #PWR power symbols are virtual: they never become footprints.
    expect(refs.some((r) => r.startsWith('#'))).toBe(false);
  });

  it('carries each symbol its footprint and its sheet file', () => {
    if (!fetched.ok) throw new Error(fetched.error);
    const j1 = fetched.netlist.GetComponentByReference('J1')!;
    expect(j1.GetFPID()).toBe('Connector_PinSocket_2.54mm:PinSocket_1x08_P2.54mm_Vertical');
    // The root sheet's own Sheetname/Sheetfile. The .kicad_pro predates
    // top_level_sheets, so PROJECT_FILE::LoadFromFile names the root after the
    // project: `kicad-cli sch export netlist` on this template (09-26) writes
    // (property (name "Sheetname") (value "Arduino_Uno")) on every component.
    expect(j1.GetProperties().get('Sheetfile')).toBe('Arduino_Uno.kicad_sch');
    expect(j1.GetProperties().get('Sheetname')).toBe('Arduino_Uno');
  });

  it('connects the pins the schematic wires together', () => {
    if (!fetched.ok) throw new Error(fetched.error);
    // Every connector pad the schematic drives must have a net name.
    const j1 = fetched.netlist.GetComponentByReference('J1')!;
    expect(j1.GetNetCount()).toBeGreaterThan(0);
    for (let i = 0; i < j1.GetNetCount(); i++) expect(j1.GetNetAt(i).netName).not.toBe('');
  });

  it('rejects a project with no schematic', () => {
    const result = fetchNetlistFromSchematic(
      FILES.filter((f) => !f.name.endsWith('.kicad_sch')),
      'annotate first',
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('has no schematic');
  });

  it('reports the annotation errors when a symbol has no reference', () => {
    const files = FILES.map((f) =>
      f.name.endsWith('.kicad_sch')
        ? // Both places a file keeps it: the field and the (instances …) record -
          // SCH_SYMBOL::GetRef reads the instance, so a field edit alone is not an
          // unannotated symbol.
          {
            ...f,
            text: f.text
              .replace('"Reference" "J1"', '"Reference" "J?"')
              .replace('(reference "J1")', '(reference "J?")'),
          }
        : f,
    );
    const result = fetchNetlistFromSchematic(
      files,
      'Updating PCB requires a fully annotated schematic.',
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('Updating PCB requires a fully annotated schematic.');
    // FetchNetlistFromSchematic (pcb_edit_frame.cpp:2352) reports a payload that comes back
    // unchanged as the annotate message alone: no list of what is unannotated.
    expect(result.details).toBeUndefined();
  });
});

describe('BOARD_NETLIST_UPDATER over the Arduino_Uno template', () => {
  const fetched = fetchNetlistFromSchematic(FILES, 'annotate first', 'Arduino_Uno.kicad_pro');
  const library = footprintLibrary();

  const run = (dryRun: boolean, relink = false) => {
    if (!fetched.ok) throw new Error(fetched.error);
    const board = readBoard(parse(boardText));
    const { reporter, result } = runLiveUpdate(board, fetched.netlist, libraryLoader(library), {
      isDryRun: dryRun,
      // The dialog's defaults (dialog_update_pcb_base.cpp).
      lookupByTimestamp: !relink,
      replaceFootprints: true,
      updateFields: true,
    });
    return { board, reporter, result };
  };

  const actionsOf = (reporter: Reporter): string[] =>
    reporter.lines
      .filter((l) => l.severity === RPT_SEVERITY_ACTION && l.message !== '')
      .map((l) => l.message);

  it('finds every footprint already on the board, nothing added, nothing removed', () => {
    const { board, result } = run(true);
    expect(result.newFootprintCount).toBe(0);
    expect(result.errorCount).toBe(0);
    expect(actionsOf(run(true).reporter).some((m) => m.startsWith('Add J'))).toBe(false);
    expect(actionsOf(run(true).reporter).some((m) => m.startsWith('Remove'))).toBe(false);
    expect(result.board.footprints).toHaveLength(board.footprints.length);
  });

  it('matches footprints to symbols through their UUID paths, either way round', () => {
    for (const relink of [false, true]) {
      const { result } = run(false, relink);
      expect(result.errorCount).toBe(0);
      expect(result.newFootprintCount).toBe(0);
      const refs = result.board.footprints
        .map((f) => f.reference)
        .filter((r) => r?.startsWith('J'));
      expect(refs.sort()).toEqual(['J1', 'J2', 'J3', 'J4']);
      for (const fp of result.board.footprints) {
        if (fp.reference?.startsWith('J')) expect(fp.path).toMatch(/^\/[0-9a-f-]+$/i);
      }
    }
  });

  it("does not churn a legacy board's Sheetname / Sheetfile properties", () => {
    // This board predates PCB fields (version 20221018), so it keeps its sheet name
    // and file in `(property "Sheetname" …)`. "Sheet file and name used to be
    // stored as properties invisible to the user": `parseFOOTPRINT` folds them
    // into `SetSheetfile` / `SetSheetname` (pcb_io_kicad_sexpr_parser.cpp:5168-5181),
    // so they are neither user fields the symbol is missing nor written twice —
    // the modern `(sheetfile …)` token is the only spelling that comes back out.
    const { result, reporter } = run(false);
    expect(actionsOf(reporter)).not.toContain("Updated J1 sheetfile to ''.");

    const text = serializeBoard(result.board);
    expect(text).not.toContain('"Sheetfile"');
    expect(text.match(/\(sheetfile "Arduino_Uno.kicad_sch"\)/g)?.length).toBe(
      boardText.match(/"Sheetfile"/g)?.length,
    );
    const j1 = result.board.footprints.find((f) => f.reference === 'J1')!;
    expect(j1.sheetfile).toBe('Arduino_Uno.kicad_sch');
  });

  it('reports the updates a KiCad 6-era board genuinely needs, and nothing more', () => {
    const { reporter } = run(true);
    const actions = actionsOf(reporter);

    // Modern KiCad writes the human-readable sheet path as the sheet name, adds the
    // symbol's footprint filters, and keeps Datasheet/Description as PCB fields,
    // none of which a 20221018 file carries.
    for (const ref of ['J1', 'J2', 'J3', 'J4']) {
      expect(actions).toContain(`Update ${ref} fields.`);
      expect(actions).toContain(`Update ${ref} sheetname to '/'.`);
      expect(actions).toContain(`Update ${ref} footprint filters to 'Connector*:*_1x??_*'.`);
    }

    // Net names agree with the board KiCad wrote, so nothing is re-connected. That
    // includes the power net: KiCad 7+ names a power net after its Value field (here
    // +3.3V), but a pre-20230221 file is loaded through FixLegacyPowerSymbolMismatches
    // (sch_screen.cpp:1560), which sets an invisible-pin power symbol's Value back to
    // its pin name, +3V3 - the name `kicad-cli sch export netlist` writes for this file.
    const netActions = actions.filter(
      (m) =>
        m.startsWith('Add net ') || m.includes('connect ') || m.startsWith('Removed unused net'),
    );
    expect(netActions).toEqual([]);

    // In particular: every local label ("/IOREF", "/SDA{slash}A4"), the auto-named
    // no-connect pin ("unconnected-(J1-Pin_1-Pad1)") and the global power nets all
    // round-trip untouched.
    expect(actions.every((m) => !m.includes('IOREF'))).toBe(true);
    expect(actions.every((m) => !m.includes('unconnected-'))).toBe(true);
    expect(actions.every((m) => !m.includes('GND') && !m.includes('+5V'))).toBe(true);
  });
});
