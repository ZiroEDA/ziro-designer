// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SCH_EDITOR_CONTROL::Paste` parity (eeschema/tools/sch_editor_control.cpp,
 * KiCad 10.0.5) — the batch-A findings of the M2 clipboard audit.
 *
 * Every case here runs the whole paste **command** path — copy text, parse,
 * translate, `pasteItems(...).apply(doc)` — and asserts on the resulting
 * document, never on an intermediate helper. A mutation of the paste internals
 * can leave helper-level assertions green while the document the user ends up
 * with is wrong, so the document is what is checked.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic, schSymbolLibraryName, RefDesTracker } from '@ziroeda/eeschema';
import type { Schematic } from '@ziroeda/eeschema';
import {
  copySelectionText,
  parsePastedText,
  translatePayload,
  pasteItems,
  type PasteOptions,
} from '@ziroeda/eeschema/src/tools/clipboard.js';
import { refId } from '@ziroeda/eeschema/src/tools/hittest.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';

// ---- fixtures ---------------------------------------------------------------

/** One definition with a single pin, whose number is the caller's to choose so
 *  two same-named definitions can be told apart. */
const libDef = (name: string, pinNumber: string, power = false): string => `
    (symbol "${name}"${power ? ' (power)' : ''}
      (symbol "${name}_0_1"
        (rectangle (start -2.54 2.54) (end 2.54 -2.54)
          (stroke (width 0.254) (type default)) (fill (type background))))
      (symbol "${name}_1_1"
        (pin passive line (at -5.08 0 0) (length 2.54)
          (name "~" (effects (font (size 1.27 1.27))))
          (number "${pinNumber}" (effects (font (size 1.27 1.27))))))) `;

interface SymSpec {
  libId: string;
  libName?: string;
  ref: string;
  uuid: string;
  x: number;
}

const placement = (s: SymSpec): string => `
  (symbol
    (lib_id "${s.libId}")${s.libName ? `\n    (lib_name "${s.libName}")` : ''}
    (at ${s.x} 100 0)
    (unit 1)
    (uuid "${s.uuid}")
    (property "Reference" "${s.ref}" (at ${s.x} 95 0) (effects (font (size 1.27 1.27))))
    (property "Value" "Val" (at ${s.x} 105 0) (effects (font (size 1.27 1.27))))
  )`;

const sheet = (defs: string, syms: readonly SymSpec[]): Schematic =>
  readSchematic(
    parse(`(kicad_sch
  (version 20250114)
  (generator "eeschema")
  (paper "A4")
  (lib_symbols${defs})
  ${syms.map(placement).join('\n')}
)`),
  );

const blank = (): Schematic => sheet('', []);

const refOf = (doc: Schematic, i: number): string =>
  doc.symbols[i]!.fields.find((f) => f.key === 'Reference')!.value;

const symbolId = (doc: Schematic, i: number): string => refId('symbol', doc.symbols[i]!.uuid, i);

/** Copy symbol `i` out of `from`, paste it into `into`, return the new document. */
const copyPaste = (from: Schematic, i: number, into: Schematic, opts?: PasteOptions): Schematic => {
  const text = copySelectionText(from, new Set([symbolId(from, i)]));
  const payload = parsePastedText(text, into, opts);
  expect(payload, 'the clipboard text must parse back into a payload').not.toBeNull();
  return pasteItems(translatePayload(payload!, { x: mmToIU(20), y: 0 })).apply(into);
};

// ---- finding 1 --------------------------------------------------------------

describe('a placement filed under (lib_name …) copies with its definition', () => {
  // SCH_IO_KICAD_SEXPR::Format(SCH_SELECTION*) looks the definition up under
  // `GetSchSymbolLibraryName()`, not under the lib id. Keying on the id copied
  // such a symbol with no `(lib_symbols …)` block at all, so it pasted with no
  // body and — the part that silently changes the netlist — no pins.
  const src = (): Schematic =>
    sheet(libDef('Edited-R', '9'), [
      {
        libId: 'Device:R',
        libName: 'Edited-R',
        ref: 'R1',
        uuid: 'aaaaaaaa-0000-0000-0000-000000000001',
        x: 100,
      },
    ]);

  it('puts the definition on the clipboard', () => {
    const text = copySelectionText(src(), new Set([symbolId(src(), 0)]));
    expect(text.startsWith('(lib_symbols')).toBe(true);
    expect(text).toContain('"Edited-R"');
  });

  it('and the pasted symbol resolves to it, pins and all', () => {
    const next = copyPaste(src(), 0, blank());
    expect(next.symbols).toHaveLength(1);
    const byName = new Map(next.libSymbols.map((l) => [l.libId, l]));
    const def = byName.get(schSymbolLibraryName(next.symbols[0]!));
    expect(def, 'the pasted placement must resolve to a definition').toBeDefined();
    expect(def!.units.flatMap((u) => u.pins).map((p) => p.number)).toEqual(['9']);
  });
});

// ---- finding 2 --------------------------------------------------------------

describe("ChoosePasteLibSymbol: the clipboard's definition wins", () => {
  // sch_editor_control.cpp:2033-2062 documents why: the clipboard's cached
  // definition is a matched pair with the pasted instance, and taking the
  // destination's same-named one instead silently reverts in-place edits —
  // renumbered pins (issue 21401), a changed power type (issue 22162).
  const clipboardSide = (): Schematic =>
    sheet(libDef('Device:R', '9'), [
      { libId: 'Device:R', ref: 'R1', uuid: 'bbbbbbbb-0000-0000-0000-000000000001', x: 100 },
    ]);
  const destination = (): Schematic =>
    sheet(libDef('Device:R', '1'), [
      { libId: 'Device:R', ref: 'R7', uuid: 'bbbbbbbb-0000-0000-0000-000000000002', x: 50 },
    ]);

  const pinsOf = (doc: Schematic): string[] =>
    doc.libSymbols
      .find((l) => l.libId === 'Device:R')!
      .units.flatMap((u) => u.pins)
      .map((p) => p.number);

  it('replaces the same-named destination definition', () => {
    const dest = destination();
    expect(pinsOf(dest)).toEqual(['1']);
    const next = copyPaste(clipboardSide(), 0, dest);
    expect(next.libSymbols.filter((l) => l.libId === 'Device:R')).toHaveLength(1);
    expect(pinsOf(next)).toEqual(['9']);
  });

  it('and undo puts the replaced definition back', () => {
    const dest = destination();
    const text = copySelectionText(clipboardSide(), new Set([symbolId(clipboardSide(), 0)]));
    const cmd = pasteItems(translatePayload(parsePastedText(text, dest)!, { x: 0, y: 0 }));
    const next = cmd.apply(dest);
    expect(pinsOf(next)).toEqual(['9']);
    const undone = cmd.invert(dest).apply(next);
    expect(pinsOf(undone)).toEqual(['1']);
    expect(undone.libSymbols).toHaveLength(dest.libSymbols.length);
    expect(undone.symbols).toHaveLength(dest.symbols.length);
  });
});

// ---- finding 3 --------------------------------------------------------------

describe('reference uniqueness is hierarchy-wide, not sheet-wide', () => {
  // `hierarchy.GetSymbols( existingRefs, SYMBOL_FILTER_ALL )` over
  // `Schematic().Hierarchy()` (:2222/:2249). Built from the one open sheet, a
  // symbol copied on sheet 2 and pasted on sheet 1 kept its reference and
  // collided with the original hierarchy-wide.
  const sheetTwo = (): Schematic =>
    sheet(libDef('Device:R', '1'), [
      { libId: 'Device:R', ref: 'R5', uuid: 'cccccccc-0000-0000-0000-000000000001', x: 100 },
    ]);
  const sheetOne = (): Schematic =>
    sheet(libDef('Device:R', '1'), [
      { libId: 'Device:R', ref: 'R1', uuid: 'cccccccc-0000-0000-0000-000000000002', x: 50 },
    ]);

  it('re-annotates against every sheet of the project', () => {
    const one = sheetOne();
    const next = copyPaste(sheetTwo(), 0, one, {
      hierarchy: [
        { file: 'one.kicad_sch', doc: one, sheetNumber: 1, scope: 'out' },
        { file: 'two.kicad_sch', doc: sheetTwo(), sheetNumber: 2, scope: 'out' },
      ],
    });
    expect(next.symbols).toHaveLength(2);
    expect(refOf(next, 1)).not.toBe('R5');
    expect(refOf(next, 1)).toMatch(/^R\d+$/);
  });

  it('and R5 free everywhere in the project is kept', () => {
    // aStartAtCurrent: the search starts at the number already carried, so a
    // reference nothing collides with survives the paste unchanged.
    const one = sheetOne();
    const next = copyPaste(sheetTwo(), 0, one, {
      hierarchy: [{ file: 'one.kicad_sch', doc: one, sheetNumber: 1, scope: 'out' }],
    });
    expect(refOf(next, 1)).toBe('R5');
  });
});

// ---- findings 4 and 5 -------------------------------------------------------

describe('PASTE_MODE and the "already in the schematic" rule', () => {
  const src = (ref: string, uuid: string): Schematic =>
    sheet(libDef('Device:R', '1'), [{ libId: 'Device:R', ref, uuid, x: 100 }]);
  const dest = (): Schematic =>
    sheet(libDef('Device:R', '1'), [
      { libId: 'Device:R', ref: 'R1', uuid: 'dddddddd-0000-0000-0000-0000000000ff', x: 50 },
    ]);

  it("mode 'remove' clears a designator the project already holds", () => {
    // annotateAutomatic off -> PASTE_MODE::REMOVE_ANNOTATIONS (:2203), and R1
    // is in existingRefs, so forceKeepAnnotations stays false and
    // updatePastedSymbol calls ClearAnnotation (:1911).
    const next = copyPaste(src('R1', 'dddddddd-0000-0000-0000-000000000001'), 0, dest(), {
      mode: 'remove',
    });
    expect(refOf(next, 1)).toBe('R?');
  });

  it("mode 'remove' keeps a designator the project has never seen", () => {
    // :2338-2348 — `if( !existingRefsSet.contains( instance.m_Reference ) )
    // forceKeepAnnotations = !forceRemoveAnnotations;`. Pasting something new
    // into a project is not a duplicate, so its annotation survives.
    const next = copyPaste(src('R99', 'dddddddd-0000-0000-0000-000000000002'), 0, dest(), {
      mode: 'remove',
    });
    expect(refOf(next, 1)).toBe('R99');
  });

  it('an explicit Paste Special "remove" clears it anyway', () => {
    // forceRemoveAnnotations (:2213) is what stops the rule above.
    const next = copyPaste(src('R99', 'dddddddd-0000-0000-0000-000000000003'), 0, dest(), {
      mode: 'remove',
      forceRemoveAnnotations: true,
    });
    expect(refOf(next, 1)).toBe('R?');
  });

  it('and a symbol that is not a duplicate keeps its KIID: this was a move', () => {
    // :2354-2364. Re-uuiding it breaks board cross-probing and the
    // symbol<->footprint link on what the user experienced as a move.
    const uuid = 'dddddddd-0000-0000-0000-000000000004';
    const next = copyPaste(src('R99', uuid), 0, dest(), { mode: 'keep' });
    expect(next.symbols[1]!.uuid).toBe(uuid);
  });

  it('while a duplicate, and every unique-annotation paste, gets a fresh one', () => {
    const uuid = 'dddddddd-0000-0000-0000-000000000005';
    const dup = copyPaste(src('R1', uuid), 0, dest(), { mode: 'keep' });
    expect(dup.symbols[1]!.uuid).not.toBe(uuid);

    const unique = copyPaste(src('R99', uuid), 0, dest(), { mode: 'unique' });
    expect(unique.symbols[1]!.uuid).not.toBe(uuid);
  });
});

// ---- finding 8 --------------------------------------------------------------

describe('re-annotation honours the project annotation settings', () => {
  // ReannotateDuplicates / ReannotateByOptions (:2604-2640) read
  // m_AnnotateSortOrder, m_AnnotateMethod, m_AnnotateStartNum and
  // m_refDesTracker. A bare `while (taken.has(prefix + n)) n++` from 1 ignored
  // all four.
  const src = (): Schematic =>
    sheet(libDef('Device:R', '1'), [
      { libId: 'Device:R', ref: 'R5', uuid: 'eeeeeeee-0000-0000-0000-000000000001', x: 100 },
    ]);
  const dest = (): Schematic =>
    sheet(libDef('Device:R', '1'), [
      { libId: 'Device:R', ref: 'R5', uuid: 'eeeeeeee-0000-0000-0000-0000000000ff', x: 50 },
    ]);

  it('numbers by sheet number x 100 when the project says so', () => {
    const next = copyPaste(src(), 0, dest(), {
      sheetNumber: 2,
      annotate: { algo: 'sheet_100', order: 'x', startNumber: 0 },
    });
    expect(refOf(next, 1)).toBe('R201');
  });

  it('starts a duplicate at the number it already carries, not at 1', () => {
    // aStartAtCurrent (sch_reference_list.cpp:359 -> :510). R5 is taken, so the
    // copy is R6 — never R1, which is what the old first-free-from-1 scan gave.
    const next = copyPaste(src(), 0, dest());
    expect(refOf(next, 1)).toBe('R6');
  });

  it('and skips a designator the REFDES_TRACKER has retired', () => {
    // REFDES_TRACKER with reuse off: a number that was used once is never
    // handed out again, even though nothing currently holds it.
    const tracker = new RefDesTracker();
    tracker.reuseRefDes = false;
    tracker.insert('R6');
    const next = copyPaste(src(), 0, dest(), { annotate: { tracker } });
    expect(refOf(next, 1)).toBe('R7');
  });
});
