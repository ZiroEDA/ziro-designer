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
import { parse } from '@ziroeda/sexpr';
import { mmToIU } from '@ziroeda/common';
import { Reporter, RPT_SEVERITY_ERROR, RPT_SEVERITY_WARNING } from '@ziroeda/common';
import {
  BOARD_NETLIST_UPDATER,
  loadKicadNetlist,
  readBoard,
  readFootprintFile,
  serializeBoard,
  type Board,
  type PcbFootprint,
} from '@ziroeda/pcbnew';

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

const LIBRARY = new Map<string, PcbFootprint>([
  ['Resistor_SMD:R_0805', readFootprintFile(parse(R_0805))!],
  ['Capacitor_SMD:C_0805', readFootprintFile(parse(C_0805))!],
]);

/**
 * FOOTPRINT_LIBRARY_ADAPTER::LoadFootprintWithOptionalNickname: a qualified id is
 * looked up directly; a bare name searches every library alphabetically for the
 * first match, which is how legacy Footprint fields still resolve.
 */
const loadFootprint = (fpid: string): PcbFootprint | null => {
  const direct = LIBRARY.get(fpid);
  if (direct) return direct;
  if (fpid.includes(':')) return null;
  for (const key of [...LIBRARY.keys()].sort()) {
    if (key.slice(key.indexOf(':') + 1) === fpid) return LIBRARY.get(key) ?? null;
  }
  return null;
};

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

/** The netlist a two-resistor / one-capacitor divider would produce. */
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
      (tstamps "rrrrrrr1-0000-4000-8000-000000000001"))
    (comp (ref "R2")
      (value "10k")
      (footprint "Resistor_SMD:R_0805")
      (fields (field (name "Footprint") "Resistor_SMD:R_0805"))
      (libsource (lib "Device") (part "R") (description "Resistor"))
      (property (name "Sheetname") (value ""))
      (property (name "Sheetfile") (value "divider.kicad_sch"))
      (sheetpath (names "/") (tstamps "/"))
      (tstamps "rrrrrrr2-0000-4000-8000-000000000001")))
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
  options: Parameters<typeof runUpdate>[2] = {},
): ReturnType<typeof runUpdate> {
  return runUpdate(readBoard(parse(boardText)), loadKicadNetlist(netlistText), options);
}

function runUpdate(
  board: Board,
  netlist: ReturnType<typeof loadKicadNetlist>,
  options: ConstructorParameters<typeof BOARD_NETLIST_UPDATER>[3] = {},
): {
  reporter: Reporter;
  result: ReturnType<BOARD_NETLIST_UPDATER['UpdateNetlist']>;
} {
  const reporter = new Reporter();
  const updater = new BOARD_NETLIST_UPDATER(board, reporter, loadFootprint, options);
  return { reporter, result: updater.UpdateNetlist(netlist) };
}

const messages = (reporter: Reporter): string[] => reporter.lines.map((l) => l.message);

// ----- tests ------------------------------------------------------------------

describe('loadKicadNetlist', () => {
  const netlist = loadKicadNetlist(NETLIST);

  it('reads every component with its footprint, value and symbol path', () => {
    expect(netlist.GetCount()).toBe(3);
    const r1 = netlist.GetComponentByReference('R1')!;
    expect(r1.GetFPID()).toBe('Resistor_SMD:R_0805');
    expect(r1.GetValue()).toBe('10k');
    expect(r1.path).toBe('/');
    expect(r1.kiids).toEqual(['rrrrrrr1-0000-4000-8000-000000000001']);
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
      netlist.GetComponentByPath('/rrrrrrr2-0000-4000-8000-000000000001')?.GetReference(),
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

    expect(result.board.footprints).toHaveLength(0);
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

    expect(board.footprints.map((f) => f.reference)).toEqual(['C1', 'R1', 'R2']);
    expect(result.addedFootprints).toEqual([0, 1, 2]);
    expect(result.errorCount).toBe(0);
    expect(result.warningCount).toBe(0);

    const r1 = board.footprints.find((f) => f.reference === 'R1')!;
    expect(r1.lib).toBe('Resistor_SMD:R_0805');
    expect(r1.value).toBe('10k');
    expect(r1.path).toBe('/rrrrrrr1-0000-4000-8000-000000000001');
    expect(r1.sheetfile).toBe('divider.kicad_sch');
    expect(r1.uuid).toBeTruthy();

    // Nets: VIN/VOUT/GND were all created, and pads point at them by code.
    const names = [...board.nets.values()].sort();
    expect(names).toEqual(['', 'GND', 'VIN', 'VOUT']);
    const netOf = (fp: PcbFootprint, pad: string): string =>
      board.nets.get(fp.pads.find((p) => p.number === pad)!.net!) ?? '';
    expect(netOf(r1, '1')).toBe('VIN');
    expect(netOf(r1, '2')).toBe('VOUT');
    const r2 = board.footprints.find((f) => f.reference === 'R2')!;
    expect(netOf(r2, '1')).toBe('VOUT');
    expect(netOf(r2, '2')).toBe('GND');

    expect(messages(reporter)).toContain('Connected R1 pin 2 to VOUT.');
  });

  it('places new footprints below the board outline', () => {
    const { result } = update(EMPTY_BOARD, NETLIST);
    // The Edge.Cuts rectangle ends at y = 100 mm; new footprints go 10 mm below.
    for (const fp of result.board.footprints) expect(fp.at.y).toBeGreaterThan(mmToIU(100));
  });

  it('writes a board that reads back with the same nets', () => {
    const { result } = update(EMPTY_BOARD, NETLIST);
    const reread = readBoard(parse(serializeBoard(result.board)));

    expect(reread.footprints.map((f) => f.reference)).toEqual(['C1', 'R1', 'R2']);
    expect([...reread.nets.values()].sort()).toEqual(['', 'GND', 'VIN', 'VOUT']);

    const r1 = reread.footprints.find((f) => f.reference === 'R1')!;
    expect(reread.nets.get(r1.pads.find((p) => p.number === '1')!.net!)).toBe('VIN');
    expect(r1.path).toBe('/rrrrrrr1-0000-4000-8000-000000000001');
    // Pad positions survive the round trip through board-absolute coordinates.
    const pad1 = r1.pads.find((p) => p.number === '1')!;
    expect(pad1.at.x).toBe(r1.at.x - mmToIU(0.9375));
  });

  it('errors on a footprint the libraries do not have', () => {
    const { reporter, result } = update(
      EMPTY_BOARD,
      NETLIST.replace('Resistor_SMD:R_0805', 'Nope:Missing'),
    );
    expect(result.errorCount).toBeGreaterThan(0);
    expect(messages(reporter)).toContain("Cannot add R1 (footprint 'Nope:Missing' not found).");
    // Only R1's footprint was replaced in the netlist text, so R2 still lands.
    expect(result.board.footprints.map((f) => f.reference)).toEqual(['C1', 'R2']);
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
    expect(result.board.footprints.map((f) => f.reference)).toEqual(['C1', 'R1', 'R2']);
  });
});

describe('BOARD_NETLIST_UPDATER on a populated board', () => {
  /** The board after a first successful update. */
  const populated = (): Board => update(EMPTY_BOARD, NETLIST).result.board;

  it('is idempotent: a second run changes nothing', () => {
    const first = populated();
    const { result } = runUpdate(first, loadKicadNetlist(NETLIST));

    expect(result.newFootprintCount).toBe(0);
    expect(result.errorCount).toBe(0);
    expect(result.warningCount).toBe(0);
    expect(serializeBoard(result.board)).toBe(serializeBoard(first));
  });

  it('follows a value change', () => {
    const { reporter, result } = runUpdate(
      populated(),
      loadKicadNetlist(NETLIST.replace('(value "10k")', '(value "4k7")')),
    );
    expect(messages(reporter)).toContain('Changed R1 value from 10k to 4k7.');
    expect(result.board.footprints.find((f) => f.reference === 'R1')!.value).toBe('4k7');
    expect(serializeBoard(result.board)).toContain('"4k7"');
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
    expect([...result.board.nets.values()]).not.toContain('VOUT');
    expect([...result.board.nets.values()]).toContain('MID');
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
    const r1 = result.board.footprints.find((f) => f.reference === 'R1')!;
    expect(r1.lib).toBe('Capacitor_SMD:C_0805');
    // The reference text and the pads' nets are carried over from the board.
    expect(r1.reference).toBe('R1');
    expect(result.board.nets.get(r1.pads.find((p) => p.number === '2')!.net!)).toBe('VOUT');
  });

  it('leaves a locked footprint alone unless locks are overridden', () => {
    let board = populated();
    const index = board.footprints.findIndex((f) => f.reference === 'R1');
    board = {
      ...board,
      footprints: board.footprints.map((f, i) => (i === index ? { ...f, locked: true } : f)),
    };
    const swapped = loadKicadNetlist(
      NETLIST.replace(
        '(comp (ref "R1")\n      (value "10k")\n      (footprint "Resistor_SMD:R_0805")',
        '(comp (ref "R1")\n      (value "10k")\n      (footprint "Capacitor_SMD:C_0805")',
      ),
    );

    const locked = runUpdate(board, swapped);
    expect(locked.result.warningCount).toBe(1);
    expect(messages(locked.reporter).some((m) => m.includes('footprint is locked'))).toBe(true);
    expect(locked.result.board.footprints.find((f) => f.reference === 'R1')!.lib).toBe(
      'Resistor_SMD:R_0805',
    );

    const overridden = runUpdate(board, swapped, { overrideLocks: true });
    expect(overridden.result.board.footprints.find((f) => f.reference === 'R1')!.lib).toBe(
      'Capacitor_SMD:C_0805',
    );
  });

  it('deletes a footprint whose symbol is gone only when asked', () => {
    const withoutR2 = NETLIST.replace(
      /\s*\(comp \(ref "R2"\)[\s\S]*?\(tstamps "rrrrrrr2-0000-4000-8000-000000000001"\)\)/,
      '',
    )
      .replace('(node (ref "R2") (pin "2") (pintype "passive"))', '')
      .replace('(node (ref "R2") (pin "1") (pintype "passive"))', '');

    const kept = runUpdate(populated(), loadKicadNetlist(withoutR2));
    expect(kept.result.board.footprints.map((f) => f.reference)).toContain('R2');
    // An unmatched footprint loses its symbol link.
    expect(kept.result.board.footprints.find((f) => f.reference === 'R2')!.path).toBeUndefined();

    const deleted = runUpdate(populated(), loadKicadNetlist(withoutR2), {
      deleteUnusedFootprints: true,
    });
    expect(messages(deleted.reporter)).toContain('Removed unused footprint R2.');
    expect(deleted.result.board.footprints.map((f) => f.reference)).toEqual(['C1', 'R1']);
  });

  it('keeps a board-only footprint even when deleting extras', () => {
    let board = populated();
    const index = board.footprints.findIndex((f) => f.reference === 'R2');
    board = {
      ...board,
      footprints: board.footprints.map((f, i) =>
        i === index ? { ...f, attributes: [...(f.attributes ?? []), 'board_only'] } : f,
      ),
    };
    const withoutR2 = NETLIST.replace(
      /\s*\(comp \(ref "R2"\)[\s\S]*?\(tstamps "rrrrrrr2-0000-4000-8000-000000000001"\)\)/,
      '',
    );
    const { result } = runUpdate(board, loadKicadNetlist(withoutR2), {
      deleteUnusedFootprints: true,
    });
    expect(result.board.footprints.map((f) => f.reference)).toContain('R2');
  });

  it('copies symbol fields onto the footprint only with Update Fields on', () => {
    const off = runUpdate(populated(), loadKicadNetlist(NETLIST));
    expect(off.result.board.footprints.find((f) => f.reference === 'C1')!.fields).toEqual([]);

    const on = runUpdate(populated(), loadKicadNetlist(NETLIST), { updateFields: true });
    expect(messages(on.reporter)).toContain('Updated C1 fields.');
    expect(on.result.board.footprints.find((f) => f.reference === 'C1')!.fields).toEqual([
      { name: 'MPN', value: 'CAP-100N', source: { kind: 'list', items: [] } },
    ]);
    // The new field is written out as an invisible fab-layer property.
    const text = serializeBoard(on.result.board);
    expect(text).toContain('(property "MPN" "CAP-100N"');
    expect(readBoard(parse(text)).footprints.find((f) => f.reference === 'C1')!.fields).toEqual([
      expect.objectContaining({ name: 'MPN', value: 'CAP-100N' }),
    ]);
  });

  it('removes footprint fields the symbol no longer has, with Remove Extra Fields', () => {
    const withField = runUpdate(populated(), loadKicadNetlist(NETLIST), {
      updateFields: true,
    }).result.board;
    const withoutField = NETLIST.replace(' (field (name "MPN") "CAP-100N")', '').replace(
      '(property (name "MPN") (value "CAP-100N"))',
      '',
    );

    const kept = runUpdate(withField, loadKicadNetlist(withoutField), { updateFields: true });
    expect(kept.result.board.footprints.find((f) => f.reference === 'C1')!.fields).toHaveLength(1);

    const removed = runUpdate(withField, loadKicadNetlist(withoutField), {
      updateFields: true,
      removeExtraFields: true,
    });
    expect(messages(removed.reporter)).toContain('Removed C1 footprint fields not in symbol.');
    expect(removed.result.board.footprints.find((f) => f.reference === 'C1')!.fields).toEqual([]);
    expect(serializeBoard(removed.result.board)).not.toContain('"CAP-100N"');
  });

  it('applies the DNP and exclude-from-BOM attributes with Update Fields on', () => {
    const dnp = NETLIST.replace(
      '(property (name "Sheetname") (value ""))\n      (property (name "Sheetfile") (value "divider.kicad_sch"))\n      (sheetpath (names "/") (tstamps "/"))\n      (tstamps "rrrrrrr1',
      '(property (name "dnp"))\n      (property (name "exclude_from_bom"))\n      (property (name "Sheetname") (value ""))\n      (property (name "Sheetfile") (value "divider.kicad_sch"))\n      (sheetpath (names "/") (tstamps "/"))\n      (tstamps "rrrrrrr1',
    );
    const { reporter, result } = runUpdate(populated(), loadKicadNetlist(dnp), {
      updateFields: true,
    });
    const msgs = messages(reporter);
    expect(msgs).toContain("Added R1 'Do not place' fabrication attribute.");
    expect(msgs).toContain("Added R1 'exclude from BOM' fabrication attribute.");
    const r1 = result.board.footprints.find((f) => f.reference === 'R1')!;
    expect(r1.attributes).toContain('dnp');
    expect(r1.attributes).toContain('exclude_from_bom');
    expect(serializeBoard(result.board)).toContain('dnp');
  });

  it('disconnects a pad the schematic no longer connects', () => {
    const { reporter, result } = runUpdate(
      populated(),
      loadKicadNetlist(NETLIST.replace('(node (ref "R1") (pin "1") (pintype "passive"))', '')),
    );
    const msgs = messages(reporter);
    expect(msgs).toContain('Disconnected R1 pin 1.');
    expect(msgs).toContain('Removed unused net VIN.');
    const r1 = result.board.footprints.find((f) => f.reference === 'R1')!;
    expect(r1.pads.find((p) => p.number === '1')!.net).toBe(0);
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
    expect(result.board.footprints.map((f) => f.reference).sort()).toEqual(['C1', 'R2', 'R9']);
  });

  it('reconnects a zone left on a renamed net', () => {
    let board = populated();
    const gnd = [...board.nets].find(([, name]) => name === 'GND')![0];
    const zoneSrc = parse(
      `(zone (net ${gnd}) (net_name "GND") (layer "B.Cu") (hatch edge 0.5)
        (polygon (pts (xy 100 60) (xy 160 60) (xy 160 100) (xy 100 100))))`,
    );
    board = {
      ...board,
      zones: [
        {
          net: gnd,
          netName: 'GND',
          layers: ['B.Cu'],
          fills: [],
          outline: [
            { x: mmToIU(100), y: mmToIU(60) },
            { x: mmToIU(160), y: mmToIU(60) },
          ],
          source: zoneSrc,
        },
      ],
      source: { kind: 'list', items: [...board.source.items, zoneSrc] },
    };

    const { reporter, result } = runUpdate(
      board,
      loadKicadNetlist(NETLIST.replaceAll('GND', 'GNDA')),
    );
    expect(messages(reporter)).toContain('Reconnected copper zone from GND to GNDA.');
    expect(result.board.nets.get(result.board.zones[0]!.net)).toBe('GNDA');
  });

  it('warns about a zone whose net has no pads at all', () => {
    let board = populated();
    const zoneSrc = parse(
      `(zone (net 99) (net_name "ORPHAN") (layer "B.Cu") (hatch edge 0.5)
        (polygon (pts (xy 100 60) (xy 160 60))))`,
    );
    board = {
      ...board,
      nets: new Map([...board.nets, [99, 'ORPHAN']]),
      zones: [
        {
          net: 99,
          netName: 'ORPHAN',
          layers: ['B.Cu'],
          fills: [],
          outline: [{ x: mmToIU(100), y: mmToIU(60) }],
          source: zoneSrc,
        },
      ],
    };
    const { reporter, result } = runUpdate(board, loadKicadNetlist(NETLIST));
    expect(
      messages(reporter).some((m) => m.includes('has no pads connected to net "ORPHAN"')),
    ).toBe(true);
    expect(result.warningCount).toBeGreaterThan(0);
    expect(reporter.count(RPT_SEVERITY_WARNING)).toBeGreaterThan(0);
    expect(reporter.count(RPT_SEVERITY_ERROR)).toBe(0);
  });
});
