/**
 * "Update PCB from Schematic" over a real project: the Arduino_Uno template, whose
 * schematic and board were both written by KiCad and are in sync. This exercises the
 * whole path the PCB editor's menu item takes — fetchNetlistFromSchematic (annotation
 * gate, hierarchy walk, netlist export, parse) and then BOARD_NETLIST_UPDATER over
 * the board — against files no test wrote.
 *
 * The board is from KiCad 6 (file version 20221018), which makes it the useful case:
 * an in-sync project must come out structurally untouched — no footprint added,
 * removed or re-linked, and no net re-connected — while the handful of updates a
 * newer KiCad genuinely applies to an older file still appear. The last test pins
 * down exactly which those are.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { Reporter, RPT_SEVERITY_ACTION } from '@ziroeda/common';
import {
  BOARD_NETLIST_UPDATER,
  readBoard,
  readFootprintFile,
  serializeBoard,
} from '@ziroeda/pcbnew';
import type { PcbFootprint } from '@ziroeda/pcbnew';
import { fetchNetlistFromSchematic } from '@ziroeda/designer/src/editors/pcb/netlist_from_schematic.js';

const PROJECT = fileURLToPath(
  new URL('../../../designer/public/templates/Arduino_Uno/', import.meta.url),
);

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
 * — which is exactly what the board already holds, and enough to prove the updater
 * leaves an in-sync project alone.
 */
function footprintLibrary(): Map<string, PcbFootprint> {
  const library = new Map<string, PcbFootprint>();

  for (const file of FILES) {
    const match = /([^/]+)\.pretty\/([^/]+)\.kicad_mod$/i.exec(file.name);
    if (!match) continue;
    const parsed = readFootprintFile(parse(file.text));
    if (parsed) library.set(`${match[1]}:${match[2]}`, parsed);
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
    // The root sheet's own Sheetname/Sheetfile: an empty name and the root file.
    expect(j1.GetProperties().get('Sheetfile')).toBe('Arduino_Uno.kicad_sch');
    expect(j1.GetProperties().get('Sheetname')).toBe('');
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
        ? { ...f, text: f.text.replace('"Reference" "J1"', '"Reference" "J?"') }
        : f,
    );
    const result = fetchNetlistFromSchematic(
      files,
      'Updating PCB requires a fully annotated schematic.',
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('Updating PCB requires a fully annotated schematic.');
    expect(result.details).toContain('not annotated');
  });
});

describe('BOARD_NETLIST_UPDATER over the Arduino_Uno template', () => {
  const fetched = fetchNetlistFromSchematic(FILES, 'annotate first', 'Arduino_Uno.kicad_pro');
  const library = footprintLibrary();

  const run = (dryRun: boolean, relink = false) => {
    if (!fetched.ok) throw new Error(fetched.error);
    const board = readBoard(parse(boardText));
    const reporter = new Reporter();
    const updater = new BOARD_NETLIST_UPDATER(
      board,
      reporter,
      (fpid) => library.get(fpid) ?? null,
      {
        isDryRun: dryRun,
        // The dialog's defaults (dialog_update_pcb_base.cpp).
        lookupByTimestamp: !relink,
        replaceFootprints: true,
        updateFields: true,
      },
    );
    return { board, reporter, result: updater.UpdateNetlist(fetched.netlist) };
  };

  const actionsOf = (reporter: Reporter): string[] =>
    reporter.lines
      .filter((l) => l.severity === RPT_SEVERITY_ACTION && l.message !== '')
      .map((l) => l.message);

  it('finds every footprint already on the board — nothing added, nothing removed', () => {
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
    // and file in `(property "Sheetname" …)` rather than the modern `(sheetname …)`
    // token. Those reserved properties are not user fields, so they must neither be
    // reported as fields the symbol is missing nor duplicated into a second token.
    const { result, reporter } = run(false);
    expect(actionsOf(reporter)).not.toContain("Updated J1 sheetfile to ''.");

    const text = serializeBoard(result.board);
    // Exactly one Sheetfile answer per footprint, still where the file had it.
    expect(text.match(/"Sheetfile"/g)?.length).toBe(boardText.match(/"Sheetfile"/g)?.length);
    expect(text).not.toContain('(sheetfile ');
    const j1 = result.board.footprints.find((f) => f.reference === 'J1')!;
    expect(j1.sheetfile).toBe('Arduino_Uno.kicad_sch');
  });

  it('reports the updates a KiCad 6-era board genuinely needs, and nothing more', () => {
    const { reporter } = run(true);
    const actions = actionsOf(reporter);

    // Modern KiCad writes the human-readable sheet path as the sheet name, adds the
    // symbol's footprint filters, and keeps Datasheet/Description as PCB fields —
    // none of which a 20221018 file carries.
    for (const ref of ['J1', 'J2', 'J3', 'J4']) {
      expect(actions).toContain(`Update ${ref} fields.`);
      expect(actions).toContain(`Update ${ref} sheetname to '/'.`);
      expect(actions).toContain(`Update ${ref} footprint filters to 'Connector*:*_1x??_*'.`);
    }

    // Net names agree with the board KiCad wrote, so nothing is re-connected — the
    // one exception being the power net, which KiCad 6 named after the power symbol
    // (+3V3) and KiCad 7+ names after its Value field (+3.3V).
    const netActions = actions.filter(
      (m) =>
        m.startsWith('Add net ') || m.includes('connect ') || m.startsWith('Removed unused net'),
    );
    expect(netActions).toEqual(['Add net +3.3V.', 'Reconnect J1 pin 4 from +3V3 to +3.3V.']);

    // In particular: every local label ("/IOREF", "/SDA{slash}A4"), the auto-named
    // no-connect pin ("unconnected-(J1-Pin_1-Pad1)") and the global power nets all
    // round-trip untouched.
    expect(actions.every((m) => !m.includes('IOREF'))).toBe(true);
    expect(actions.every((m) => !m.includes('unconnected-'))).toBe(true);
    expect(actions.every((m) => !m.includes('GND') && !m.includes('+5V'))).toBe(true);
  });
});
