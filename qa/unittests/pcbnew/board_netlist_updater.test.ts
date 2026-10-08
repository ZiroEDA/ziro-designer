// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * "Update PCB from Schematic", end to end: the schematic's netlist (written by
 * NETLIST_EXPORTER_KICAD), read back by KICAD_NETLIST_PARSER, applied to a board by
 * BOARD_NETLIST_UPDATER.
 *
 * Counterparts: qa/tests/pcbnew/test_board_netlist_updater*.cpp.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common';
import { kiidPathAsString } from '@ziroeda/common/kiid.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { Reporter, RPT_SEVERITY_ERROR, RPT_SEVERITY_WARNING } from '@ziroeda/common';
import {
  libraryLoader,
  runLiveUpdate,
  type UpdateOptions,
  type UpdateResult,
} from './support/netlist_update_harness.js';
import { loadKicadNetlist } from '@ziroeda/pcbnew/netlist_reader/kicad_netlist_reader.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import { FP_BOARD_ONLY, type FOOTPRINT } from '@ziroeda/pcbnew/footprint.js';
import { NETINFO_ITEM } from '@ziroeda/pcbnew/netinfo.js';
import { ZONE } from '@ziroeda/pcbnew/zone.js';
import { FormatBoard, ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';

// ----- fixtures ---------------------------------------------------------------

/** Two 0805-ish library footprints, as they would come from a `.pretty` library. */
const R_0805 = `(footprint "R_0805"
  (version 20241229) (generator "pcbnew") (generator_version "9.0")
  (layer "F.Cu")
  (descr "Resistor SMD 0805")
  (property "ki_fp_filters" "R_*")
  (attr smd)
  (property "Reference" "REF**" (at 0 -1.65 0) (layer "F.SilkS")
    (uuid "11111111-0000-4000-8000-000000000001")
    (effects (font (size 1 1) (thickness 0.15))))
  (property "Value" "R_0805" (at 0 1.65 0) (layer "F.Fab")
    (uuid "11111111-0000-4000-8000-000000000002")
    (effects (font (size 1 1) (thickness 0.15))))
  (fp_line (start -1 -0.7) (end 1 -0.7) (stroke (width 0.12) (type solid)) (layer "F.SilkS")
    (uuid "11111111-0000-4000-8000-000000000003"))
  (pad "1" smd roundrect (at -0.9375 0) (size 1.025 1.4) (layers "F.Cu" "F.Paste" "F.Mask")
    (roundrect_rratio 0.243902) (uuid "11111111-0000-4000-8000-000000000011"))
  (pad "2" smd roundrect (at 0.9375 0) (size 1.025 1.4) (layers "F.Cu" "F.Paste" "F.Mask")
    (roundrect_rratio 0.243902) (uuid "11111111-0000-4000-8000-000000000012"))
)`;

const C_0805 = `(footprint "C_0805"
  (version 20241229) (generator "pcbnew") (generator_version "9.0")
  (layer "F.Cu")
  (descr "Capacitor SMD 0805")
  (attr smd)
  (property "Reference" "REF**" (at 0 -1.68 0) (layer "F.SilkS")
    (uuid "22222222-0000-4000-8000-000000000001")
    (effects (font (size 1 1) (thickness 0.15))))
  (property "Value" "C_0805" (at 0 1.68 0) (layer "F.Fab")
    (uuid "22222222-0000-4000-8000-000000000002")
    (effects (font (size 1 1) (thickness 0.15))))
  (pad "1" smd roundrect (at -0.95 0) (size 1 1.45) (layers "F.Cu" "F.Paste" "F.Mask")
    (roundrect_rratio 0.25) (uuid "22222222-0000-4000-8000-000000000011"))
  (pad "2" smd roundrect (at 0.95 0) (size 1 1.45) (layers "F.Cu" "F.Paste" "F.Mask")
    (roundrect_rratio 0.25) (uuid "22222222-0000-4000-8000-000000000012"))
)`;

const LIBRARY = new Map<string, string>([
  ['Resistor_SMD:R_0805', R_0805],
  ['Capacitor_SMD:C_0805', C_0805],
]);

const loadFootprint = libraryLoader(LIBRARY);

/** An empty A4 board with an Edge.Cuts rectangle, so insertion lands below it. */
const EMPTY_BOARD = `(kicad_pcb (version 20241229) (generator "pcbnew") (generator_version "9.0")
  (general (thickness 1.6))
  (paper "A4")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (25 "Edge.Cuts" user) (37 "F.SilkS" user)
    (39 "F.Mask" user) (35 "F.Paste" user) (33 "F.Fab" user) (34 "B.Fab" user))
  (net 0 "")
  (gr_rect (start 100 60) (end 160 100) (stroke (width 0.1) (type default)) (fill no)
    (layer "Edge.Cuts") (uuid "aaaaaaaa-0000-4000-8000-000000000001"))
)`;

/**
 * The netlist a two-resistor / one-capacitor divider would produce. The
 * symbol tstamps are valid uuids: `KIID( const wxString& )` (kiid.cpp) draws
 * a random one for any text that does not parse, so a `(path …)` written from
 * a made-up tstamp would come back different on every read.
 */
const NETLIST = `(export (version "E")
  (design
    (source "divider.kicad_sch")
    (date "2026-07-25T00:00:00.000Z")
    (tool "Eeschema")
    (sheet (number "1") (name "/") (tstamps "/")
      (title_block (title "Divider") (company "") (rev "") (date "") (source "divider.kicad_sch"))))
  (components
    (comp (ref "C1")
      (value "100nF")
      (footprint "Capacitor_SMD:C_0805")
      (fields (field (name "Footprint") "Capacitor_SMD:C_0805") (field (name "MPN") "CAP-100N"))
      (libsource (lib "Device") (part "C") (description "Unpolarized capacitor"))
      (property (name "MPN") (value "CAP-100N"))
      (property (name "Sheetname") (value ""))
      (property (name "Sheetfile") (value "divider.kicad_sch"))
      (sheetpath (names "/") (tstamps "/"))
      (tstamps "cccccccc-0000-4000-8000-000000000001"))
    (comp (ref "R1")
      (value "10k")
      (footprint "Resistor_SMD:R_0805")
      (fields (field (name "Footprint") "Resistor_SMD:R_0805"))
      (libsource (lib "Device") (part "R") (description "Resistor"))
      (property (name "Sheetname") (value ""))
      (property (name "Sheetfile") (value "divider.kicad_sch"))
      (sheetpath (names "/") (tstamps "/"))
      (tstamps "aaaaaaa1-0000-4000-8000-000000000001"))
    (comp (ref "R2")
      (value "10k")
      (footprint "Resistor_SMD:R_0805")
      (fields (field (name "Footprint") "Resistor_SMD:R_0805"))
      (libsource (lib "Device") (part "R") (description "Resistor"))
      (property (name "Sheetname") (value ""))
      (property (name "Sheetfile") (value "divider.kicad_sch"))
      (sheetpath (names "/") (tstamps "/"))
      (tstamps "aaaaaaa2-0000-4000-8000-000000000001")))
  (libparts)
  (libraries)
  (nets
    (net (code "1") (name "GND") (class "Default")
      (node (ref "C1") (pin "2") (pintype "passive"))
      (node (ref "R2") (pin "2") (pintype "passive")))
    (net (code "2") (name "VIN") (class "Default")
      (node (ref "R1") (pin "1") (pintype "passive")))
    (net (code "3") (name "VOUT") (class "Default")
      (node (ref "C1") (pin "1") (pintype "passive"))
      (node (ref "R1") (pin "2") (pintype "passive"))
      (node (ref "R2") (pin "1") (pintype "passive")))))`;

function update(
  boardText: string,
  netlistText: string,
  options: UpdateOptions = {},
): ReturnType<typeof runUpdate> {
  return runUpdate(ParseBoard(boardText), loadKicadNetlist(netlistText), options);
}

function runUpdate(
  board: BOARD,
  netlist: ReturnType<typeof loadKicadNetlist>,
  options: UpdateOptions = {},
): { reporter: Reporter; result: UpdateResult } {
  return runLiveUpdate(board, netlist, loadFootprint, options);
}

const messages = (reporter: Reporter): string[] => reporter.lines.map((l) => l.message);

const refs = (b: BOARD): string[] => b.Footprints().map((f) => f.GetReference());
const fpOf = (b: BOARD, ref: string): FOOTPRINT =>
  b.Footprints().find((f) => f.GetReference() === ref)!;
const netNames = (b: BOARD): string[] => [...b.GetNetInfo()].map((n) => n.GetNetname());
const padNet = (fp: FOOTPRINT, pad: string): string =>
  fp
    .Pads()
    .find((p) => p.GetNumber() === pad)!
    .GetNetname();
/** The footprint's fields after its five mandatory ones, as (name, value). */
const userFields = (fp: FOOTPRINT): { name: string; value: string }[] =>
  fp
    .GetFields()
    .filter((f) => !f.IsMandatory())
    .map((f) => ({ name: f.GetName(), value: f.GetText() }));

// ----- tests ------------------------------------------------------------------

describe('loadKicadNetlist', () => {
  const netlist = loadKicadNetlist(NETLIST);

  it('reads every component with its footprint, value and symbol path', () => {
    expect(netlist.GetCount()).toBe(3);
    const r1 = netlist.GetComponentByReference('R1')!;
    expect(r1.GetFPID()).toBe('Resistor_SMD:R_0805');
    expect(r1.GetValue()).toBe('10k');
    expect(r1.path).toBe('/');
    expect(r1.kiids).toEqual(['aaaaaaa1-0000-4000-8000-000000000001']);
    expect(r1.GetProperties().get('Sheetfile')).toBe('divider.kicad_sch');
  });

  it('attaches each net to the right pad of the right component', () => {
    const r1 = netlist.GetComponentByReference('R1')!;
    expect(r1.GetNet('1').netName).toBe('VIN');
    expect(r1.GetNet('2').netName).toBe('VOUT');
    expect(r1.GetNet('2').pinType).toBe('passive');
    // A pad the schematic does not connect resolves to the empty net.
    expect(r1.GetNet('3').IsValid()).toBe(false);
  });

  it('reads user fields in order', () => {
    const c1 = netlist.GetComponentByReference('C1')!;
    expect([...c1.GetFields()]).toEqual([
      ['Footprint', 'Capacitor_SMD:C_0805'],
      ['MPN', 'CAP-100N'],
    ]);
  });

  it('finds a component by its full symbol path', () => {
    expect(
      netlist.GetComponentByPath('/aaaaaaa2-0000-4000-8000-000000000001')?.GetReference(),
    ).toBe('R2');
  });

  it('sorts by reference in natural order', () => {
    const many = loadKicadNetlist(
      `(export (components (comp (ref "R10")) (comp (ref "R2")) (comp (ref "C1"))))`,
    );
    many.SortByReference();
    expect([0, 1, 2].map((i) => many.GetComponent(i)!.GetReference())).toEqual(['C1', 'R2', 'R10']);
  });
});

describe('BOARD_NETLIST_UPDATER on an empty board', () => {
  it('reports what it would do without touching the board (dry run)', () => {
    const { reporter, result } = update(EMPTY_BOARD, NETLIST, { isDryRun: true });

    expect(result.board.Footprints()).toHaveLength(0);
    expect(result.newFootprintCount).toBe(3);
    expect(result.errorCount).toBe(0);

    const msgs = messages(reporter);
    expect(msgs).toContain("Add C1 (footprint 'Capacitor_SMD:C_0805').");
    expect(msgs).toContain("Add R1 (footprint 'Resistor_SMD:R_0805').");
    expect(msgs).toContain("Add R2 (footprint 'Resistor_SMD:R_0805').");
    // A footprint that does not exist yet has no pads to connect, so a dry run on an
    // empty board reports only the additions (upstream returns nullptr from
    // addNewFootprint in a dry run, which skips the per-footprint update calls).
    expect(msgs.some((m) => m.includes('Connect '))).toBe(false);
    // Past tense is reserved for a real run.
    expect(msgs.some((m) => m.startsWith('Added '))).toBe(false);
    expect(reporter.lines.at(-1)?.message).toBe('Total warnings: 0, errors: 0.');
  });

  it('adds every footprint, links it to its symbol and connects its pads', () => {
    const { reporter, result } = update(EMPTY_BOARD, NETLIST);
    const board = result.board;

    // BOARD_COMMIT::Push adds with ADD_MODE::BULK_INSERT and BOARD::Add puts an
    // inserted footprint at the FRONT (board.cpp:1372-1380): the last added is first.
    expect(refs(board)).toEqual(['R2', 'R1', 'C1']);
    // added in netlist order C1, R1, R2, each one inserted in front of the last
    expect(result.addedFootprints).toEqual([2, 1, 0]);
    expect(result.errorCount).toBe(0);
    expect(result.warningCount).toBe(0);

    const r1 = fpOf(board, 'R1');
    expect(r1.GetFPID().Format()).toBe('Resistor_SMD:R_0805');
    expect(r1.GetValue()).toBe('10k');
    expect(kiidPathAsString(r1.GetPath())).toBe('/aaaaaaa1-0000-4000-8000-000000000001');
    expect(r1.GetSheetfile()).toBe('divider.kicad_sch');
    expect(r1.m_Uuid).toBeTruthy();

    // Nets: VIN/VOUT/GND were all created, and the pads are on them.
    expect(netNames(board).sort()).toEqual(['', 'GND', 'VIN', 'VOUT']);
    expect(padNet(r1, '1')).toBe('VIN');
    expect(padNet(r1, '2')).toBe('VOUT');
    const r2 = fpOf(board, 'R2');
    expect(padNet(r2, '1')).toBe('VOUT');
    expect(padNet(r2, '2')).toBe('GND');

    expect(messages(reporter)).toContain('Connected R1 pin 2 to VOUT.');
  });

  it('places new footprints below the board outline', () => {
    const { result } = update(EMPTY_BOARD, NETLIST);
    // The Edge.Cuts rectangle ends at y = 100 mm; new footprints go 10 mm below.
    for (const fp of result.board.Footprints())
      expect(fp.GetPosition().y).toBeGreaterThan(mmToIU(100));
  });

  it('writes a board that reads back with the same nets', () => {
    const { result } = update(EMPTY_BOARD, NETLIST);
    const reread = ParseBoard(FormatBoard(result.board));

    // As a set: the writer orders footprints by uuid (`BOARD_ITEM::ptr_cmp`), and
    // a footprint the updater adds gets a fresh one.
    expect(refs(reread).sort()).toEqual(['C1', 'R1', 'R2']);
    expect(netNames(reread).sort()).toEqual(['', 'GND', 'VIN', 'VOUT']);

    const r1 = fpOf(reread, 'R1');
    expect(padNet(r1, '1')).toBe('VIN');
    expect(kiidPathAsString(r1.GetPath())).toBe('/aaaaaaa1-0000-4000-8000-000000000001');
    // Pad positions survive the round trip through board-absolute coordinates.
    const pad1 = r1.Pads().find((p) => p.GetNumber() === '1')!;
    expect(pad1.GetPosition().x).toBe(r1.GetPosition().x - mmToIU(0.9375));
  });

  it('errors on a footprint the libraries do not have', () => {
    const { reporter, result } = update(
      EMPTY_BOARD,
      NETLIST.replace('Resistor_SMD:R_0805', 'Nope:Missing'),
    );
    expect(result.errorCount).toBeGreaterThan(0);
    expect(messages(reporter)).toContain("Cannot add R1 (footprint 'Nope:Missing' not found).");
    // Only R1's footprint was replaced in the netlist text, so R2 still lands.
    expect(refs(result.board)).toEqual(['R2', 'C1']);
  });

  it('errors when a symbol has a pin the footprint has no pad for', () => {
    const withPin3 = NETLIST.replace(
      '(node (ref "R1") (pin "1") (pintype "passive"))',
      '(node (ref "R1") (pin "1") (pintype "passive")) (node (ref "R1") (pin "3") (pintype "passive"))',
    );
    const { reporter, result } = update(EMPTY_BOARD, withPin3);
    expect(result.errorCount).toBe(1);
    expect(messages(reporter)).toContain('R1 pad 3 not found in Resistor_SMD:R_0805.');
  });

  it('warns about a legacy footprint id with no library name', () => {
    const { reporter, result } = update(
      EMPTY_BOARD,
      NETLIST.replaceAll('Resistor_SMD:R_0805', 'R_0805'),
    );
    expect(
      messages(reporter).some((m) => m.includes("footprint 'R_0805' is missing a library name")),
    ).toBe(true);
    // Legacy ids still resolve, so the footprints are added.
    expect(refs(result.board)).toEqual(['R2', 'R1', 'C1']);
  });
});

/** A B.Cu copper zone over the board outline on that net. */
const addZone = (board: BOARD, netCode: number): ZONE => {
  const zone = new ZONE(board);
  zone.SetLayer(PCB_LAYER_ID.B_Cu);
  for (const [x, y] of [
    [100, 60],
    [160, 60],
    [160, 100],
    [100, 100],
  ] as const)
    zone.AppendCorner({ x: mmToIU(x), y: mmToIU(y) }, -1);
  zone.SetNetCode(netCode);
  board.Add(zone);
  return zone;
};

describe('BOARD_NETLIST_UPDATER on a populated board', () => {
  /** The board after a first successful update. */
  const populated = (): BOARD => update(EMPTY_BOARD, NETLIST).result.board;

  it('is idempotent: a second run changes nothing', () => {
    const first = populated();
    const before = FormatBoard(first);
    const { result } = runUpdate(first, loadKicadNetlist(NETLIST));

    expect(result.newFootprintCount).toBe(0);
    expect(result.errorCount).toBe(0);
    expect(result.warningCount).toBe(0);
    expect(FormatBoard(result.board)).toBe(before);
  });

  it('follows a value change', () => {
    const { reporter, result } = runUpdate(
      populated(),
      loadKicadNetlist(NETLIST.replace('(value "10k")', '(value "4k7")')),
    );
    expect(messages(reporter)).toContain('Changed R1 value from 10k to 4k7.');
    expect(fpOf(result.board, 'R1').GetValue()).toBe('4k7');
    expect(FormatBoard(result.board)).toContain('"4k7"');
  });

  it('follows a net rename, dropping the net that is gone', () => {
    const { reporter, result } = runUpdate(
      populated(),
      loadKicadNetlist(NETLIST.replaceAll('VOUT', 'MID')),
    );
    const msgs = messages(reporter);
    expect(msgs).toContain('Add net MID.');
    expect(msgs).toContain('Reconnected R1 pin 2 from VOUT to MID.');
    expect(msgs).toContain('Removed unused net VOUT.');
    expect(netNames(result.board)).not.toContain('VOUT');
    expect(netNames(result.board)).toContain('MID');
  });

  it('replaces a footprint when the symbol names a different one', () => {
    const { reporter, result } = runUpdate(
      populated(),
      loadKicadNetlist(
        NETLIST.replace(
          '(comp (ref "R1")\n      (value "10k")\n      (footprint "Resistor_SMD:R_0805")',
          '(comp (ref "R1")\n      (value "10k")\n      (footprint "Capacitor_SMD:C_0805")',
        ),
      ),
    );

    expect(messages(reporter)).toContain(
      "Changed R1 footprint from 'Resistor_SMD:R_0805' to 'Capacitor_SMD:C_0805'.",
    );
    const r1 = fpOf(result.board, 'R1');
    expect(r1.GetFPID().Format()).toBe('Capacitor_SMD:C_0805');
    // The reference text and the pads' nets are carried over from the board.
    expect(r1.GetReference()).toBe('R1');
    expect(padNet(r1, '2')).toBe('VOUT');
  });

  it('leaves a locked footprint alone unless locks are overridden', () => {
    const swapped = loadKicadNetlist(
      NETLIST.replace(
        '(comp (ref "R1")\n      (value "10k")\n      (footprint "Resistor_SMD:R_0805")',
        '(comp (ref "R1")\n      (value "10k")\n      (footprint "Capacitor_SMD:C_0805")',
      ),
    );

    const lockedR1 = (): BOARD => {
      const board = populated();
      fpOf(board, 'R1').SetLocked(true);
      return board;
    };

    const locked = runUpdate(lockedR1(), swapped);
    expect(locked.result.warningCount).toBe(1);
    expect(messages(locked.reporter).some((m) => m.includes('footprint is locked'))).toBe(true);
    expect(fpOf(locked.result.board, 'R1').GetFPID().Format()).toBe('Resistor_SMD:R_0805');

    const overridden = runUpdate(lockedR1(), swapped, { overrideLocks: true });
    expect(fpOf(overridden.result.board, 'R1').GetFPID().Format()).toBe('Capacitor_SMD:C_0805');
  });

  it('deletes a footprint whose symbol is gone only when asked', () => {
    const withoutR2 = NETLIST.replace(
      /\s*\(comp \(ref "R2"\)[\s\S]*?\(tstamps "aaaaaaa2-0000-4000-8000-000000000001"\)\)/,
      '',
    )
      .replace('(node (ref "R2") (pin "2") (pintype "passive"))', '')
      .replace('(node (ref "R2") (pin "1") (pintype "passive"))', '');

    const kept = runUpdate(populated(), loadKicadNetlist(withoutR2));
    expect(refs(kept.result.board)).toContain('R2');
    // An unmatched footprint loses its symbol link.
    expect(fpOf(kept.result.board, 'R2').GetPath()).toHaveLength(0);

    const deleted = runUpdate(populated(), loadKicadNetlist(withoutR2), {
      deleteUnusedFootprints: true,
    });
    expect(messages(deleted.reporter)).toContain('Removed unused footprint R2.');
    expect(refs(deleted.result.board)).toEqual(['R1', 'C1']);
  });

  it('keeps a board-only footprint even when deleting extras', () => {
    const board = populated();
    const r2 = fpOf(board, 'R2');
    r2.SetAttributes(r2.GetAttributes() | FP_BOARD_ONLY);
    const withoutR2 = NETLIST.replace(
      /\s*\(comp \(ref "R2"\)[\s\S]*?\(tstamps "aaaaaaa2-0000-4000-8000-000000000001"\)\)/,
      '',
    );
    const { result } = runUpdate(board, loadKicadNetlist(withoutR2), {
      deleteUnusedFootprints: true,
    });
    expect(refs(result.board)).toContain('R2');
  });

  it('copies symbol fields onto the footprint only with Update Fields on', () => {
    // Every footprint carries its mandatory fields (FOOTPRINT's constructor);
    // the user fields are the ones after them.
    const off = runUpdate(populated(), loadKicadNetlist(NETLIST));
    expect(userFields(fpOf(off.result.board, 'C1'))).toEqual([]);

    const on = runUpdate(populated(), loadKicadNetlist(NETLIST), { updateFields: true });
    expect(messages(on.reporter)).toContain('Updated C1 fields.');
    expect(userFields(fpOf(on.result.board, 'C1'))).toEqual([{ name: 'MPN', value: 'CAP-100N' }]);
    // The new field is written out as an invisible fab-layer property.
    const text = FormatBoard(on.result.board);
    expect(text).toContain('(property "MPN" "CAP-100N"');
    expect(userFields(fpOf(ParseBoard(text), 'C1'))).toEqual([{ name: 'MPN', value: 'CAP-100N' }]);
  });

  it('changes the value of a field the footprint already has (:563-567)', () => {
    const withField = runUpdate(populated(), loadKicadNetlist(NETLIST), {
      updateFields: true,
    }).result.board;
    const changed = NETLIST.replaceAll('CAP-100N', 'CAP-220N');
    const { reporter, result } = runUpdate(withField, loadKicadNetlist(changed), {
      updateFields: true,
    });
    expect(messages(reporter)).toContain('Updated C1 fields.');
    expect(userFields(fpOf(result.board, 'C1')).find((f) => f.name === 'MPN')?.value).toBe(
      'CAP-220N',
    );
  });

  it('removes footprint fields the symbol no longer has, with Remove Extra Fields', () => {
    const withField = runUpdate(populated(), loadKicadNetlist(NETLIST), {
      updateFields: true,
    }).result.board;
    const withoutField = NETLIST.replace(' (field (name "MPN") "CAP-100N")', '').replace(
      '(property (name "MPN") (value "CAP-100N"))',
      '',
    );

    const userFieldNames = (fp: FOOTPRINT): string[] => userFields(fp).map((f) => f.name);
    const withFieldText = FormatBoard(withField);
    const kept = runUpdate(withField, loadKicadNetlist(withoutField), { updateFields: true });
    expect(userFieldNames(fpOf(kept.result.board, 'C1'))).toEqual(['MPN']);

    const removed = runUpdate(ParseBoard(withFieldText), loadKicadNetlist(withoutField), {
      updateFields: true,
      removeExtraFields: true,
    });
    expect(messages(removed.reporter)).toContain('Removed C1 footprint fields not in symbol.');
    expect(userFieldNames(fpOf(removed.result.board, 'C1'))).toEqual([]);
    expect(FormatBoard(removed.result.board)).not.toContain('"CAP-100N"');
  });

  it('applies the DNP and exclude-from-BOM attributes with Update Fields on', () => {
    const dnp = NETLIST.replace(
      '(property (name "Sheetname") (value ""))\n      (property (name "Sheetfile") (value "divider.kicad_sch"))\n      (sheetpath (names "/") (tstamps "/"))\n      (tstamps "aaaaaaa1',
      '(property (name "dnp"))\n      (property (name "exclude_from_bom"))\n      (property (name "Sheetname") (value ""))\n      (property (name "Sheetfile") (value "divider.kicad_sch"))\n      (sheetpath (names "/") (tstamps "/"))\n      (tstamps "aaaaaaa1',
    );
    const { reporter, result } = runUpdate(populated(), loadKicadNetlist(dnp), {
      updateFields: true,
    });
    const msgs = messages(reporter);
    expect(msgs).toContain("Added R1 'Do not place' fabrication attribute.");
    expect(msgs).toContain("Added R1 'exclude from BOM' fabrication attribute.");
    const r1 = fpOf(result.board, 'R1');
    expect(r1.IsDNP()).toBe(true);
    expect(r1.IsExcludedFromBOM()).toBe(true);
    expect(FormatBoard(result.board)).toContain('dnp');
  });

  it('disconnects a pad the schematic no longer connects', () => {
    const { reporter, result } = runUpdate(
      populated(),
      loadKicadNetlist(NETLIST.replace('(node (ref "R1") (pin "1") (pintype "passive"))', '')),
    );
    const msgs = messages(reporter);
    expect(msgs).toContain('Disconnected R1 pin 1.');
    expect(msgs).toContain('Removed unused net VIN.');
    // NETINFO_LIST::UNCONNECTED.
    expect(
      fpOf(result.board, 'R1')
        .Pads()
        .find((p) => p.GetNumber() === '1')!
        .GetNetCode(),
    ).toBe(0);
  });

  it('matches by UUID when Re-link Footprints is off', () => {
    // Rename R1 to R9 in the netlist but keep its symbol UUID: matching by
    // timestamp finds the footprint and renames it.
    const renamed = NETLIST.replace('(comp (ref "R1")', '(comp (ref "R9")').replaceAll(
      '(ref "R1") (pin',
      '(ref "R9") (pin',
    );
    const { reporter, result } = runUpdate(populated(), loadKicadNetlist(renamed), {
      lookupByTimestamp: true,
    });
    expect(messages(reporter)).toContain('Changed R1 reference designator to R9.');
    expect(refs(result.board).sort()).toEqual(['C1', 'R2', 'R9']);
  });

  it('reconnects a zone left on a renamed net', () => {
    const board = populated();
    addZone(board, board.FindNet('GND')!.GetNetCode());

    const { reporter, result } = runUpdate(
      board,
      loadKicadNetlist(NETLIST.replaceAll('GND', 'GNDA')),
    );
    expect(messages(reporter)).toContain('Reconnected copper zone from GND to GNDA.');
    expect(result.board.Zones()[0]!.GetNetname()).toBe('GNDA');
  });

  it('warns about a zone whose net has no pads at all', () => {
    const board = populated();
    const orphan = new NETINFO_ITEM(board, 'ORPHAN');
    board.Add(orphan);
    addZone(board, orphan.GetNetCode());
    const { reporter, result } = runUpdate(board, loadKicadNetlist(NETLIST));
    expect(
      messages(reporter).some((m) => m.includes('has no pads connected to net "ORPHAN"')),
    ).toBe(true);
    expect(result.warningCount).toBeGreaterThan(0);
    expect(reporter.count(RPT_SEVERITY_WARNING)).toBeGreaterThan(0);
    expect(reporter.count(RPT_SEVERITY_ERROR)).toBe(0);
  });
});
