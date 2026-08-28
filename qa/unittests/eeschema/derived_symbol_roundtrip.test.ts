// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A derived symbol (`extends`) placed on a schematic, written, and read back.
 *
 * KiCad never lets a derived symbol into a schematic: `SCH_SYMBOL`'s constructor
 * calls `LIB_SYMBOL::Flatten()` (sch_symbol.cpp:92) and `SCH_SCREEN` caches what
 * that produced (sch_screen.cpp:164-262), which is why the parser can assert
 * "no derived symbols are allowed in the library cache" (parser :2865). We wrote
 * the derived form instead, and since a schematic does not carry the parent, the
 * body was gone on the next open — the symbol came back as its Reference and
 * Value text and nothing else, and never recovered.
 *
 * The proof has to be the whole loop. Checking the written text alone misses a
 * reader that cannot resolve what was written; checking the in-memory model
 * alone misses the writer, which is where this bug actually lived.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { serialize } from '@ziroeda/sexpr/src/serializer.js';
import { readSchematic, readSymbolLib } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import { writeSchematic } from '@ziroeda/eeschema/src/sch_io/sexpr/write-schematic.js';
import { writeSymbolLib } from '@ziroeda/eeschema/src/sch_io/sexpr/write-symbol-lib.js';
import { flattenLibSymbol } from '@ziroeda/eeschema/src/lib_symbol.js';
import { placeSymbol } from '@ziroeda/eeschema/src/tools/mutate.js';
import {
  changeSymbols,
  defaultChangeSymbolsOptions,
} from '@ziroeda/eeschema/src/tools/change_symbols.js';
import { History } from '@ziroeda/eeschema/src/tools/command.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import { Reporter, RPT_SEVERITY_ERROR } from '@ziroeda/common/src/reporter.js';
import type { Schematic } from '@ziroeda/eeschema/src/types.js';

/**
 * Shaped like Diode.kicad_sym's 1N4001/1N4007 pair, the part that lost its body:
 * the parent owns every draw item, the child owns `extends` and some fields.
 */
const LIB = `(kicad_symbol_lib (version 20241209) (generator "kicad_symbol_editor")
  (symbol "BASE" (pin_numbers (hide yes)) (pin_names (hide yes))
    (exclude_from_sim no) (in_bom yes) (on_board yes) (in_pos_files yes)
    (property "Reference" "D" (at 0 2.54 0) (effects (font (size 1.27 1.27))))
    (property "Value" "BASE" (at 0 -2.54 0) (effects (font (size 1.27 1.27))))
    (property "Footprint" "" (at 0 -4.445 0) (effects (font (size 1.27 1.27))))
    (property "Datasheet" "base.pdf" (at 0 0 0) (effects (font (size 1.27 1.27))))
    (property "Description" "the parent" (at 0 0 0) (effects (font (size 1.27 1.27))))
    (property "Sim.Device" "D" (at 0 0 0) (effects (font (size 1.27 1.27))))
    (property "ki_keywords" "diode" (at 0 0 0) (effects (font (size 1.27 1.27))))
    (symbol "BASE_0_1"
      (polyline (pts (xy -1.27 1.27) (xy -1.27 -1.27))
        (stroke (width 0.254) (type default)) (fill (type none)))
      (polyline (pts (xy 1.27 0) (xy -1.27 0))
        (stroke (width 0) (type default)) (fill (type none))))
    (symbol "BASE_1_1"
      (pin passive line (at -3.81 0 0) (length 2.54) (name "K") (number "1"))
      (pin passive line (at 3.81 0 180) (length 2.54) (name "A") (number "2"))))
  (symbol "CHILD" (extends "BASE")
    (property "Reference" "D" (at 0 2.54 0) (effects (font (size 1.27 1.27))))
    (property "Value" "CHILD" (at 0 -2.54 0) (effects (font (size 1.27 1.27))))
    (property "Description" "the child" (at 0 0 0) (effects (font (size 1.27 1.27))))))`;

const EMPTY: Schematic = {
  version: 1,
  libSymbols: [],
  symbols: [],
  lines: [],
  junctions: [],
  noConnects: [],
  labels: [],
  sheets: [],
  busEntries: [],
  images: [],
  graphics: [],
  textBoxes: [],
  tables: [],
  groups: [],
  sheetInstances: [],
  source: parse('(kicad_sch (version 20250114))'),
};

const library = () => readSymbolLib(parse(LIB));
const child = () => library().find((l) => l.libId === 'CHILD')!;

/** Place CHILD and serialize the schematic, as a save would. */
function placeAndWrite(): string {
  const placed = new History().execute(
    EMPTY,
    placeSymbol({ ...child(), libId: `Diode:CHILD` }, { x: mmToIU(100), y: mmToIU(100) }),
  );
  return serialize(writeSchematic(placed));
}

describe('a derived symbol placed on a schematic', () => {
  it('survives write -> read with its body intact', () => {
    const text = placeAndWrite();
    const reread = readSchematic(parse(text));

    expect(reread.libSymbols).toHaveLength(1);
    const cached = reread.libSymbols[0]!;
    expect(cached.libId).toBe('Diode:CHILD');
    // The body. Two polylines and two pins, the same count the parent has.
    expect(cached.units.flatMap((u) => u.graphics)).toHaveLength(2);
    expect(cached.units.flatMap((u) => u.pins)).toHaveLength(2);
  });

  it('is written flat: no extends, and the parent is not needed to read it', () => {
    const text = placeAndWrite();
    expect(text).not.toContain('extends');
    expect(text).not.toContain('"BASE"');
  });

  it('renames the unit sub-symbols after the symbol that now owns them', () => {
    // SaveSymbol prints "%s_%d_%d" from the name being saved (lib cache :495),
    // and the parser rejects a unit name that does not start with the symbol's
    // own ("Invalid symbol unit name prefix", parser :501-505). So the geometry
    // that came from BASE_0_1 has to be written as CHILD_0_1.
    const text = placeAndWrite();
    expect(text).toContain('"CHILD_0_1"');
    expect(text).toContain('"CHILD_1_1"');
    expect(text).not.toContain('BASE_0_1');
    expect(text).not.toContain('BASE_1_1');
  });

  it('carries the fields the parent defines and the ones the child overrides', () => {
    const cached = readSchematic(parse(placeAndWrite())).libSymbols[0]!;
    const value = (key: string) => cached.properties.find((p) => p.key === key)?.value;
    // Overridden by the child.
    expect(value('Value')).toBe('CHILD');
    expect(value('Description')).toBe('the child');
    // Only the parent has these.
    expect(value('Datasheet')).toBe('base.pdf');
    expect(value('Sim.Device')).toBe('D');
    expect(value('ki_keywords')).toBe('diode');
  });

  it('takes the parent pin display settings, not the derived symbol defaults', () => {
    const cached = readSchematic(parse(placeAndWrite())).libSymbols[0]!;
    expect(cached.pinNumbersHidden).toBe(true);
    expect(cached.pinNamesHidden).toBe(true);
  });
});

describe('a .kicad_sym library, which must keep writing the derived form', () => {
  it('still writes (extends "BASE") with no units of its own', () => {
    const text = serialize(writeSymbolLib(library()));
    expect(text).toContain('(extends "BASE")');
    // The child's block holds no unit sub-symbols: the parent is written beside
    // it, so the geometry must not be duplicated (SaveSymbol's IsAlias branch).
    const childBlock = text.slice(text.indexOf('(symbol "CHILD"'));
    expect(childBlock).not.toContain('CHILD_0_1');
    expect(childBlock).not.toContain('BASE_0_1');
  });
});

describe('a schematic already written with a bodyless derived symbol', () => {
  /** What the old writer produced: `extends`, no units, and no parent anywhere. */
  const BROKEN = `(kicad_sch (version 20250114) (generator "eeschema")
    (lib_symbols
      (symbol "Diode:CHILD" (extends "BASE")
        (property "Reference" "D" (at 0 2.54 0) (effects (font (size 1.27 1.27))))
        (property "Value" "CHILD" (at 0 -2.54 0) (effects (font (size 1.27 1.27))))))
    (symbol (lib_id "Diode:CHILD") (at 100 100 0) (unit 1) (uuid "1c3d0a1e-0000-4000-8000-000000000001")
      (property "Reference" "D1" (at 100 96 0) (effects (font (size 1.27 1.27))))
      (property "Value" "CHILD" (at 100 104 0) (effects (font (size 1.27 1.27))))))`;

  it('opens with no body, because the body is not in the file', () => {
    const doc = readSchematic(parse(BROKEN));
    expect(doc.libSymbols[0]!.units).toHaveLength(0);
  });

  it('is repaired by Update Symbols from Library, which re-caches the flat part', () => {
    const doc = readSchematic(parse(BROKEN));
    const libs = new Map([['Diode:CHILD', { ...child(), libId: 'Diode:CHILD' }]]);
    const result = changeSymbols(doc, libs, defaultChangeSymbolsOptions('update'));

    const cached = result.doc.libSymbols.find((l) => l.libId === 'Diode:CHILD')!;
    expect(cached.extends).toBeUndefined();
    expect(cached.units.flatMap((u) => u.pins)).toHaveLength(2);
    expect(result.messages.some((m) => m.text.includes('replaced with the flattened part'))).toBe(
      true,
    );

    // …and the repair reaches the file, not just the model.
    const text = serialize(writeSchematic(result.doc));
    expect(text).not.toContain('extends');
    expect(text).toContain('"CHILD_1_1"');
  });
});

describe('flattenLibSymbol', () => {
  it('leaves a root symbol exactly as it was', () => {
    const base = library().find((l) => l.libId === 'BASE')!;
    expect(flattenLibSymbol(base)).toBe(base);
  });

  it('reports the undefined parent instead of silently dropping the body', () => {
    // A schematic whose lib_symbols block holds the derived symbol but not its
    // parent — the file our writer used to produce.
    const orphan = { ...child(), parent: undefined };
    const reporter = new Reporter();
    const flat = flattenLibSymbol(orphan, reporter);

    expect(flat).toBe(orphan);
    expect(reporter.count(RPT_SEVERITY_ERROR)).toBe(1);
    expect(reporter.lines[0]!.message).toBe("Parent of derived symbol 'CHILD' undefined");
  });

  it('reports a lib_symbols block whose parent is missing when it is read', () => {
    const broken = `(kicad_sch (version 20250114) (lib_symbols
      (symbol "Diode:CHILD" (extends "BASE")
        (property "Value" "CHILD" (at 0 0 0)))))`;
    const reporter = new Reporter();
    readSchematic(parse(broken), reporter);
    expect(reporter.count(RPT_SEVERITY_ERROR)).toBe(1);
    expect(reporter.lines[0]!.message).toBe(
      "No parent for extended symbol Diode:CHILD found in library 'Diode'",
    );
  });

  it('refuses to link a symbol that extends itself, and does not loop on it', () => {
    // LIB_SYMBOL::SetParent walks the candidate's ancestors and declines rather
    // than building a cycle, so the symbol is left unlinked and Flatten has
    // nothing to fold in.
    const text = `(kicad_symbol_lib (version 1) (generator "x")
      (symbol "LOOP" (extends "LOOP") (property "Value" "LOOP" (at 0 0 0))))`;
    const loop = readSymbolLib(parse(text))[0]!;
    expect(loop.parent).toBeUndefined();
    const reporter = new Reporter();
    expect(flattenLibSymbol(loop, reporter)).toBe(loop);
    expect(reporter.count(RPT_SEVERITY_ERROR)).toBe(1);
  });

  it('folds a three-deep chain from the root down, nearest override winning', () => {
    const text = `(kicad_symbol_lib (version 1) (generator "x")
      (symbol "ROOT"
        (property "Reference" "D" (at 0 0 0))
        (property "Value" "ROOT" (at 0 0 0))
        (property "Datasheet" "root.pdf" (at 0 0 0))
        (property "Description" "root" (at 0 0 0))
        (symbol "ROOT_0_1"
          (polyline (pts (xy -1 1) (xy -1 -1)) (stroke (width 0.2)) (fill (type none))))
        (symbol "ROOT_1_1" (pin passive line (at -3 0 0) (length 2) (name "K") (number "1"))))
      (symbol "MID" (extends "ROOT")
        (property "Description" "mid" (at 0 0 0)))
      (symbol "LEAF" (extends "MID")
        (property "Value" "LEAF" (at 0 0 0))))`;
    const leaf = readSymbolLib(parse(text)).find((l) => l.libId === 'LEAF')!;
    const flat = flattenLibSymbol(leaf);
    const value = (key: string) => flat.properties.find((p) => p.key === key)?.value;

    expect(value('Value')).toBe('LEAF'); // the leaf's own
    expect(value('Description')).toBe('mid'); // the middle symbol's
    expect(value('Datasheet')).toBe('root.pdf'); // only the root has one
    expect(flat.units.flatMap((u) => u.pins)).toHaveLength(1);
    expect(flat.units.map((u) => u.name).sort()).toEqual(['LEAF_0_1', 'LEAF_1_1']);
  });
});
