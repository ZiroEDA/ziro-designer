// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The whole repair, on the real `Diode:1N4007`, end to end.
 *
 * This exists because of how the bug it covers got shipped. Two halves were
 * each well tested on their own:
 *
 *   - `derived_symbol_roundtrip.test.ts` proved `changeSymbols` repairs a
 *     bodyless derived symbol — by HANDING it a good library;
 *   - `change_symbols_repair_source.test.ts` proves the app now fetches that
 *     good library — with a stubbed loader.
 *
 * Nothing joined them up, and the join was exactly where the defect lived: the
 * editor built its library map out of `doc.libSymbols`, so the command compared
 * every symbol against a copy of itself. Both halves passed throughout. That is
 * the shape this file is here to stop, so it runs the real sequence over the
 * real library bytes and asserts the body comes back.
 *
 * The library text is the file the hosted set actually serves for this part
 * (`symbols/Diode/1N4007.kicad_sym`), trimmed to the two symbols that matter
 * and reproduced verbatim: `1N4007` extends `1N4001`, and only `1N4001` carries
 * geometry. The broken schematic is what our writer produced before fb9a40b1.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { serialize } from '@ziroeda/sexpr/src/serializer.js';
import { readSchematic, readSymbolLib } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import { writeSchematic } from '@ziroeda/eeschema/src/sch_io/sexpr/write-schematic.js';
import {
  changeSymbols,
  defaultChangeSymbolsOptions,
} from '@ziroeda/eeschema/src/tools/change_symbols.js';
import { repairSourceLibs } from '@ziroeda/designer/src/editors/schematic/symbols/repair_source.js';

/** As served: the parent carries the body, the child carries only fields. */
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

/** What our writer produced before fb9a40b1: `extends`, no units, no parent. */
const BROKEN_SCHEMATIC = `(kicad_sch (version 20250114) (generator "eeschema")
  (lib_symbols
    (symbol "Diode:1N4007" (extends "1N4001")
      (property "Reference" "D" (at 0 2.54 0) (effects (font (size 1.27 1.27))))
      (property "Value" "1N4007" (at 0 -2.54 0) (effects (font (size 1.27 1.27))))))
  (symbol (lib_id "Diode:1N4007") (at 100 100 0) (unit 1)
    (uuid "1c3d0a1e-0000-4000-8000-000000000001")
    (property "Reference" "D1" (at 100 96 0) (effects (font (size 1.27 1.27))))
    (property "Value" "1N4007" (at 100 104 0) (effects (font (size 1.27 1.27))))))`;

/** `loadSymbol`, standing in for the hosted fetch with the bytes it serves. */
const loadFromLibrary = async (_lib: string, name: string) => {
  const sym = readSymbolLib(parse(LIBRARY)).find((s) => s.libId === name);
  return sym ? { ...sym, libId: `Diode:${sym.libId}` } : undefined;
};

describe('repairing a schematic whose 1N4007 lost its body', () => {
  it('opens with no body at all, which is the reported symptom', () => {
    const doc = readSchematic(parse(BROKEN_SCHEMATIC));
    const cached = doc.libSymbols.find((l) => l.libId === 'Diode:1N4007')!;
    expect(cached.units.flatMap((u) => u.graphics)).toHaveLength(0);
    expect(cached.units.flatMap((u) => u.pins)).toHaveLength(0);
  });

  it('and the library alone would not fix it, because the cache is what is read', async () => {
    // The document cache as the editor used to build it. Handing THIS to
    // changeSymbols is the shipped bug, and it must still be a no-op — that is
    // what made the defect invisible.
    const doc = readSchematic(parse(BROKEN_SCHEMATIC));
    const selfCache = new Map(doc.libSymbols.map((l) => [l.libId, l]));
    const r = changeSymbols(doc, selfCache, defaultChangeSymbolsOptions('update'));
    const cached = r.doc.libSymbols.find((l) => l.libId === 'Diode:1N4007')!;
    expect(cached.units.flatMap((u) => u.pins)).toHaveLength(0);
  });

  it('is repaired once the parts come from the library', async () => {
    const doc = readSchematic(parse(BROKEN_SCHEMATIC));
    const libs = await repairSourceLibs(
      doc.symbols.map((s) => s.libId),
      loadFromLibrary,
      new Map(doc.libSymbols.map((l) => [l.libId, l])),
    );
    const r = changeSymbols(doc, libs, defaultChangeSymbolsOptions('update'));

    const cached = r.doc.libSymbols.find((l) => l.libId === 'Diode:1N4007')!;
    expect(cached.extends).toBeUndefined();
    expect(cached.units.flatMap((u) => u.graphics)).toHaveLength(3);
    expect(cached.units.flatMap((u) => u.pins)).toHaveLength(2);
  });

  it('and the body reaches the saved file, renamed to the child', async () => {
    const doc = readSchematic(parse(BROKEN_SCHEMATIC));
    const libs = await repairSourceLibs(
      doc.symbols.map((s) => s.libId),
      loadFromLibrary,
      new Map(doc.libSymbols.map((l) => [l.libId, l])),
    );
    const text = serialize(
      writeSchematic(changeSymbols(doc, libs, defaultChangeSymbolsOptions('update')).doc),
    );

    expect(text).not.toContain('extends');
    // The sub-unit prefix must be the CHILD's name: KiCad's parser rejects a
    // unit whose name does not start with the symbol's own.
    expect(text).toContain('"1N4007_0_1"');
    expect(text).not.toContain('"1N4001_0_1"');
    expect(text).toContain('polyline');
  });
});
