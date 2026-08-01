// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Symbol annotation (counterpart eeschema/annotate.cpp +
 * sch_reference_list.cpp): assign first-free numbers per prefix, sorted by
 * position, with keep/reset, sheet-× algos, scope, and power-symbol exclusion.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema';
import {
  RefDesTracker,
  annotateHierarchy,
  annotateSymbols,
  annotationReport,
  checkAnnotation,
  clearAnnotationCommand,
  clearAnnotationReport,
  splitReference,
  isSplitNeeded,
  incrementAnnotations,
  defaultAnnotateOptions,
  type AnnotateOptions,
  type AnnotateSheet,
} from '@ziroeda/eeschema';

// Three resistors placed left→right at increasing X (R?, R?, R2) plus a power
// symbol (#PWR01) which must never be re-annotated.
const sym = (ref: string, x: number, y: number, uuid: string): string => `
  (symbol (lib_id "Device:R") (at ${x} ${y} 0) (unit 1) (uuid "${uuid}")
    (property "Reference" "${ref}" (at ${x} ${y} 0))
    (property "Value" "10k" (at ${x} ${y} 0)))`;

const SCH = `(kicad_sch (version 20231120) (generator "test") (paper "A4")
  (lib_symbols
    (symbol "Device:R" (property "Reference" "R" (at 0 0 0)) (symbol "R_0_1")))
  ${sym('R?', 100, 50, 'u-a')}
  ${sym('R?', 50, 50, 'u-b')}
  ${sym('R2', 150, 50, 'u-c')}
  (symbol (lib_id "power:GND") (at 10 10 0) (unit 1) (uuid "u-p")
    (property "Reference" "#PWR01" (at 10 10 0))
    (property "Value" "GND" (at 10 10 0)))
)`;

const opts = (over: Partial<AnnotateOptions>): AnnotateOptions => ({
  ...defaultAnnotateOptions(),
  ...over,
});

const refOf = (s: { fields: readonly { key: string; value: string }[] }): string =>
  s.fields.find((f) => f.key === 'Reference')!.value;

describe('splitReference (SCH_REFERENCE::Split)', () => {
  it('separates prefix and number; leaves ? / bare prefix numberless', () => {
    expect(splitReference('IC12')).toEqual({ prefix: 'IC', num: 12 });
    expect(splitReference('R?')).toEqual({ prefix: 'R' });
    expect(splitReference('R')).toEqual({ prefix: 'R' });
  });
});

describe('annotateSymbols', () => {
  const doc = readSchematic(parse(SCH));
  const libById = new Map(doc.libSymbols.map((l) => [l.libId, l]));

  it('keeps existing numbers and fills ? by X position, avoiding taken numbers', () => {
    const next = annotateSymbols(doc, libById, opts({ resetExisting: false, order: 'x' }));
    // R2 kept; the two R? get the first free numbers by X order: R1 (x=50), R3 (x=100).
    expect(refOf(next.find((s) => s.uuid === 'u-b')!)).toBe('R1'); // leftmost
    expect(refOf(next.find((s) => s.uuid === 'u-a')!)).toBe('R3');
    expect(refOf(next.find((s) => s.uuid === 'u-c')!)).toBe('R2'); // unchanged
  });

  it('reset re-numbers everything by position from 1', () => {
    const next = annotateSymbols(doc, libById, opts({ resetExisting: true, order: 'x' }));
    expect(refOf(next.find((s) => s.uuid === 'u-b')!)).toBe('R1'); // x=50
    expect(refOf(next.find((s) => s.uuid === 'u-a')!)).toBe('R2'); // x=100
    expect(refOf(next.find((s) => s.uuid === 'u-c')!)).toBe('R3'); // x=150
  });

  it('never annotates power symbols', () => {
    const next = annotateSymbols(doc, libById, opts({ resetExisting: true }));
    expect(refOf(next.find((s) => s.uuid === 'u-p')!)).toBe('#PWR01');
  });

  it('sheet number × 100 starts numbering at 101', () => {
    const next = annotateSymbols(
      doc,
      libById,
      opts({ resetExisting: true, algo: 'sheet_100', sheetNumber: 1, order: 'x' }),
    );
    expect(refOf(next.find((s) => s.uuid === 'u-b')!)).toBe('R101');
    expect(refOf(next.find((s) => s.uuid === 'u-c')!)).toBe('R103');
  });

  it('start number offsets the first free number', () => {
    const next = annotateSymbols(
      doc,
      libById,
      opts({ resetExisting: true, startNumber: 10, order: 'x' }),
    );
    expect(refOf(next.find((s) => s.uuid === 'u-b')!)).toBe('R11');
  });
});

describe('annotateSymbols, multi-unit sharing (REFDES_TRACKER::GetNextRefDesForUnits)', () => {
  // A two-unit part: fresh unit A + unit B placed separately, plus a kept
  // U1 unit A to join, and a different-value dual op-amp that must not share.
  const multiSym = (ref: string, value: string, unit: number, x: number, uuid: string): string => `
  (symbol (lib_id "Amp:Dual") (at ${x} 50 0) (unit ${unit}) (uuid "${uuid}")
    (property "Reference" "${ref}" (at ${x} 50 0))
    (property "Value" "${value}" (at ${x} 50 0)))`;

  const MULTI_SCH = `(kicad_sch (version 20231120) (generator "test") (paper "A4")
    (lib_symbols
      (symbol "Amp:Dual" (property "Reference" "U" (at 0 0 0))
        (symbol "Dual_1_1") (symbol "Dual_2_1")))
    ${multiSym('U1', 'TL072', 1, 10, 'm-kept')}
    ${multiSym('U?', 'TL072', 2, 20, 'm-b')}
    ${multiSym('U?', 'TL072', 1, 30, 'm-a2')}
    ${multiSym('U?', 'NE5532', 1, 40, 'm-other')}
  )`;

  const doc = readSchematic(parse(MULTI_SCH));
  const libById = new Map(doc.libSymbols.map((l) => [l.libId, l]));

  it('fresh units fill free unit slots of a same-lib same-value number', () => {
    const next = annotateSymbols(doc, libById, opts({ resetExisting: false, order: 'x' }));
    // Unit 2 joins the kept U1 (unit 1 taken, unit 2 free).
    expect(refOf(next.find((s) => s.uuid === 'm-b')!)).toBe('U1');
    // A second unit 1 cannot join U1 (slot taken) → first fully-free number
    // for unit 1 is U2.
    expect(refOf(next.find((s) => s.uuid === 'm-a2')!)).toBe('U2');
    // A different value must not share U2's number even though unit 2 is free.
    expect(refOf(next.find((s) => s.uuid === 'm-other')!)).toBe('U3');
    expect(refOf(next.find((s) => s.uuid === 'm-kept')!)).toBe('U1');
  });

  it('reset keeps units that shared a reference together', () => {
    const SHARED = `(kicad_sch (version 20231120) (generator "test") (paper "A4")
      (lib_symbols
        (symbol "Amp:Dual" (property "Reference" "U" (at 0 0 0))
          (symbol "Dual_1_1") (symbol "Dual_2_1")))
      ${multiSym('U7', 'TL072', 1, 10, 's-a')}
      ${multiSym('U7', 'TL072', 2, 90, 's-b')}
      ${multiSym('U3', 'TL072', 1, 50, 's-solo')}
    )`;
    const sdoc = readSchematic(parse(SHARED));
    const slib = new Map(sdoc.libSymbols.map((l) => [l.libId, l]));
    const next = annotateSymbols(sdoc, slib, opts({ resetExisting: true, order: 'x' }));
    // The U7 pair stays paired on one number despite s-solo sitting between
    // them in X order.
    const a = refOf(next.find((s) => s.uuid === 's-a')!);
    const b = refOf(next.find((s) => s.uuid === 's-b')!);
    expect(a).toBe(b);
    expect(refOf(next.find((s) => s.uuid === 's-solo')!)).not.toBe(a);
  });
});

// A hierarchy pass (SCH_EDIT_FRAME::AnnotateSymbols over a SCH_SHEET_LIST):
// two sheets numbered in one go, with out-of-scope sheets reserving numbers.
describe('annotateHierarchy', () => {
  const sheetDoc = (refs: [string, number, string][]): string =>
    `(kicad_sch (version 20231120) (generator "test") (paper "A4")
      (lib_symbols
        (symbol "Device:R" (property "Reference" "R" (at 0 0 0)) (symbol "R_0_1")))
      ${refs.map(([ref, x, uuid]) => sym(ref, x, 50, uuid)).join('\n')})`;

  const root = readSchematic(
    parse(
      sheetDoc([
        ['R?', 50, 'root-a'],
        ['R?', 100, 'root-b'],
      ]),
    ),
  );
  const child = readSchematic(
    parse(
      sheetDoc([
        ['R?', 60, 'child-a'],
        ['R?', 120, 'child-b'],
      ]),
    ),
  );
  const libById = new Map(root.libSymbols.map((l) => [l.libId, l]));
  const sheets = (
    rootScope: AnnotateSheet['scope'],
    childScope: AnnotateSheet['scope'],
  ): AnnotateSheet[] => [
    { file: 'root.kicad_sch', doc: root, sheetNumber: 1, scope: rootScope },
    { file: 'child.kicad_sch', doc: child, sheetNumber: 2, scope: childScope },
  ];

  it('numbers both sheets in one pass, without duplicates', () => {
    const out = annotateHierarchy(sheets('full', 'full'), libById, opts({ order: 'x' }));
    const all = [...out.values()].flatMap((syms) => syms.map(refOf));
    expect(new Set(all).size).toBe(4);
    // Sorted by sheet number first, then X: root's two, then the child's.
    expect(refOf(out.get('root.kicad_sch')!.find((s) => s.uuid === 'root-a')!)).toBe('R1');
    expect(refOf(out.get('root.kicad_sch')!.find((s) => s.uuid === 'root-b')!)).toBe('R2');
    expect(refOf(out.get('child.kicad_sch')!.find((s) => s.uuid === 'child-a')!)).toBe('R3');
    expect(refOf(out.get('child.kicad_sch')!.find((s) => s.uuid === 'child-b')!)).toBe('R4');
  });

  it('an out-of-scope sheet still reserves its numbers (additionalRefs)', () => {
    // The child keeps R1/R2; annotating only the root must skip them.
    const numbered = readSchematic(
      parse(
        sheetDoc([
          ['R1', 60, 'child-a'],
          ['R2', 120, 'child-b'],
        ]),
      ),
    );
    const out = annotateHierarchy(
      [
        { file: 'root.kicad_sch', doc: root, sheetNumber: 1, scope: 'full' },
        { file: 'child.kicad_sch', doc: numbered, sheetNumber: 2, scope: 'out' },
      ],
      libById,
      opts({ order: 'x' }),
    );
    expect(out.has('child.kicad_sch')).toBe(false);
    expect(refOf(out.get('root.kicad_sch')!.find((s) => s.uuid === 'root-a')!)).toBe('R3');
  });

  it('the sheet-x100 algo numbers from each symbol own sheet', () => {
    const out = annotateHierarchy(
      sheets('full', 'full'),
      libById,
      opts({ order: 'x', algo: 'sheet_100' }),
    );
    expect(refOf(out.get('root.kicad_sch')!.find((s) => s.uuid === 'root-a')!)).toBe('R101');
    expect(refOf(out.get('child.kicad_sch')!.find((s) => s.uuid === 'child-a')!)).toBe('R201');
  });
});

// aRegroupUnits: a reset without it keeps units that shared a reference
// together; with it they re-pair by placement.
describe('annotateHierarchy, regroup symbol units', () => {
  const multiSym = (ref: string, unit: number, x: number, uuid: string): string => `
    (symbol (lib_id "Amp:Dual") (at ${x} 50 0) (unit ${unit}) (uuid "${uuid}")
      (property "Reference" "${ref}" (at ${x} 50 0))
      (property "Value" "TL072" (at ${x} 50 0)))`;
  const SCH_UNITS = `(kicad_sch (version 20231120) (generator "test") (paper "A4")
    (lib_symbols
      (symbol "Amp:Dual" (property "Reference" "U" (at 0 0 0))
        (symbol "Dual_1_1") (symbol "Dual_2_1")))
    ${multiSym('U5', 1, 10, 'g-a')}
    ${multiSym('U5', 2, 90, 'g-b')}
    ${multiSym('U6', 1, 20, 'g-c')}
    ${multiSym('U6', 2, 80, 'g-d')})`;
  const doc = readSchematic(parse(SCH_UNITS));
  const libById = new Map(doc.libSymbols.map((l) => [l.libId, l]));
  const one = (o: Partial<AnnotateOptions>): AnnotateSheet[] => [
    { file: 'f', doc, sheetNumber: 1, scope: 'full' },
  ];

  it('keeps the existing pairs when not regrouping', () => {
    const out = annotateHierarchy(one({}), libById, opts({ resetExisting: true, order: 'x' }))!;
    const syms = out.get('f')!;
    const at = (uuid: string): string => refOf(syms.find((s) => s.uuid === uuid)!);
    expect(at('g-a')).toBe(at('g-b'));
    expect(at('g-c')).toBe(at('g-d'));
    expect(at('g-a')).not.toBe(at('g-c'));
  });

  it('regrouping re-pairs units by placement', () => {
    const out = annotateHierarchy(
      one({}),
      libById,
      opts({ resetExisting: true, regroupUnits: true, order: 'x' }),
    )!;
    const syms = out.get('f')!;
    const at = (uuid: string): string => refOf(syms.find((s) => s.uuid === uuid)!);
    // By X the units pair up as (g-a, g-c), both unit-1, so each takes its
    // own number and the unit-2 halves join them.
    expect(at('g-a')).toBe('U1');
    expect(at('g-c')).toBe('U2');
    expect(at('g-d')).toBe('U1');
    expect(at('g-b')).toBe('U2');
  });
});

// The Annotation Messages panel's content (AnnotateSymbols' report loop and
// SCH_REFERENCE_LIST::CheckAnnotation).
describe('annotation messages', () => {
  const doc = readSchematic(parse(SCH));
  const libById = new Map(doc.libSymbols.map((l) => [l.libId, l]));

  it('words each line by whether the symbol was annotated before', () => {
    const symbols = annotateSymbols(doc, libById, opts({ order: 'x' }));
    const lines = annotationReport([{ before: doc, after: { ...doc, symbols } }], libById);
    expect(lines.map((l) => l.message)).toEqual([
      'Annotated 10k as R3.', // was R? (x=100)
      'Annotated 10k as R1.', // was R? (x=50)
    ]);
    // R2 was already annotated and did not move, so it produced no line.
    expect(lines).toHaveLength(2);
  });

  it('reports a renumber as an update', () => {
    const symbols = annotateSymbols(doc, libById, opts({ resetExisting: true, order: 'x' }));
    const lines = annotationReport([{ before: doc, after: { ...doc, symbols } }], libById);
    expect(lines.map((l) => l.message)).toContain('Updated 10k from R2 to R3.');
  });

  it('clear annotation reports only the symbols that were annotated', () => {
    // DeleteAnnotation's clearSymbolAnnotation reports (and clears) a symbol
    // only when IsAnnotated, the two R? here were never annotated.
    const after = clearAnnotationCommand('all').apply(doc);
    const lines = clearAnnotationReport([{ before: doc, after }], libById);
    expect(lines.map((l) => l.message)).toEqual(['Cleared annotation for 10k.']);
  });

  it('CheckAnnotation flags an unannotated symbol and a duplicate', () => {
    expect(checkAnnotation([doc], libById)[0]!.message).toBe('Item not annotated: R?');

    const dupe = readSchematic(
      parse(`(kicad_sch (version 20231120) (generator "test") (paper "A4")
        (lib_symbols
          (symbol "Device:R" (property "Reference" "R" (at 0 0 0)) (symbol "R_0_1")))
        ${sym('R1', 10, 50, 'd-a')}
        ${sym('R1', 20, 50, 'd-b')})`),
    );
    expect(checkAnnotation([dupe], libById).map((l) => l.message)).toEqual(['Duplicate items R1']);
  });

  it('a fully annotated schematic reports nothing', () => {
    const symbols = annotateSymbols(doc, libById, opts({ resetExisting: true, order: 'x' }));
    expect(checkAnnotation([{ ...doc, symbols }], libById)).toHaveLength(0);
  });
});

describe('clearAnnotationCommand', () => {
  const doc = readSchematic(parse(SCH));
  it('resets references to prefix + ? and leaves power symbols', () => {
    const after = clearAnnotationCommand('all').apply(doc);
    expect(after.symbols.filter((s) => refOf(s) === 'R?')).toHaveLength(3);
    expect(refOf(after.symbols.find((s) => s.uuid === 'u-p')!)).toBe('#PWR01');
  });
  it('is undoable', () => {
    const cmd = clearAnnotationCommand('all');
    const after = cmd.apply(doc);
    const undone = cmd.invert(doc).apply(after);
    expect(undone.symbols.map(refOf)).toEqual(doc.symbols.map(refOf));
  });
});

// REFDES_TRACKER (schematic.used_designators): serialization round-trip and
// the reuse gate in annotation numbering.
describe('RefDesTracker', () => {
  it('serializes ranges and escapes, and round-trips', () => {
    const t = new RefDesTracker();
    for (const r of ['R1', 'R2', 'R3', 'R7', 'U1', 'X-Y2']) t.insert(r);
    const text = t.serialize();
    expect(text).toBe('R1-3,R7,U1,X\\-Y2');
    const t2 = new RefDesTracker();
    expect(t2.deserialize(text)).toBe(true);
    expect(t2.contains('R2')).toBe(true);
    expect(t2.contains('X-Y2')).toBe(true);
    expect(t2.contains('R4')).toBe(false);
  });

  it('rejects malformed data and clears', () => {
    const t = new RefDesTracker();
    t.insert('R1');
    expect(t.deserialize('R0')).toBe(false); // non-positive number fails parsePositiveInt
    expect(t.size).toBe(0);
  });
});

// GetNextRefDesForUnits' reuse gate: with reuse off, previously-used-but-freed
// numbers are skipped; with reuse on (the default), they come back.
describe('annotate with a REFDES_TRACKER', () => {
  const doc = readSchematic(parse(SCH));
  const libById = new Map(doc.libSymbols.map((l) => [l.libId, l]));

  it('skips previously used numbers when reuse is off', () => {
    const tracker = new RefDesTracker();
    tracker.reuseRefDes = false;
    tracker.deserialize('R1,R3'); // freed earlier in the project's history
    const next = annotateSymbols(doc, libById, opts({ order: 'x', tracker }));
    // R2 is taken on-sheet; R1/R3 are gated -> the two R? become R4 and R5.
    expect(refOf(next.find((s) => s.uuid === 'u-b')!)).toBe('R4');
    expect(refOf(next.find((s) => s.uuid === 'u-a')!)).toBe('R5');
    // Every assignment is recorded for the next run.
    expect(tracker.contains('R4')).toBe(true);
    expect(tracker.contains('R5')).toBe(true);
  });

  it('reuses freed numbers when reuse is on', () => {
    const tracker = new RefDesTracker();
    tracker.reuseRefDes = true;
    tracker.deserialize('R1,R3');
    const next = annotateSymbols(doc, libById, opts({ order: 'x', tracker }));
    expect(refOf(next.find((s) => s.uuid === 'u-b')!)).toBe('R1');
    expect(refOf(next.find((s) => s.uuid === 'u-a')!)).toBe('R3');
  });
});

const NUMBERED = `(kicad_sch (version 20231120) (generator "test") (paper "A4")
  (lib_symbols
    (symbol "Device:R" (property "Reference" "R" (at 0 0 0)) (symbol "R_0_1")))
  ${sym('R1', 10, 50, 'n-a')}
  ${sym('R2', 20, 50, 'n-b')}
  ${sym('R3', 30, 50, 'n-c')}
  ${sym('C1', 40, 50, 'n-d')})`;

describe('incrementAnnotations (SCH_EDITOR_CONTROL::IncrementAnnotations)', () => {
  const refs = (sch: ReturnType<typeof readSchematic>): string[] =>
    sch.symbols.map((s) => s.fields.find((f) => f.key === 'Reference')?.value ?? '');
  const run = (start: string, by: number) => {
    const sch = readSchematic(parse(NUMBERED));
    return refs({
      ...sch,
      symbols: incrementAnnotations(sch.symbols, { startRef: start, increment: by }),
    });
  };

  it('moves the tail of one prefix up and leaves the rest alone', () => {
    // R1 R2 R3 C1 → start at R2, +1 → R1 R3 R4 C1: R1 is below the start and
    // C1 is a different prefix.
    expect(run('R2', 1)).toEqual(['R1', 'R3', 'R4', 'C1']);
  });

  it('increments by more than one', () => {
    expect(run('R2', 10)).toEqual(['R1', 'R12', 'R13', 'C1']);
  });

  it('does nothing when the start reference has no number to split', () => {
    // IsSplitNeeded is false for "R", and upstream returns without a commit.
    expect(run('R', 1)).toEqual(['R1', 'R2', 'R3', 'C1']);
    expect(isSplitNeeded('R')).toBe(false);
    expect(isSplitNeeded('R1')).toBe(true);
    expect(isSplitNeeded('R?')).toBe(true);
    expect(isSplitNeeded('')).toBe(false);
  });

  it('starting at "R?" renumbers the whole run', () => {
    // atoi( GetRefNumber() ) is 0 for an unannotated reference, so every R is
    // at or above the start.
    expect(run('R?', 1)).toEqual(['R2', 'R3', 'R4', 'C1']);
  });

  it('leaves the array identical when nothing matches', () => {
    const sch = readSchematic(parse(NUMBERED));
    expect(incrementAnnotations(sch.symbols, { startRef: 'U1', increment: 1 })).toBe(sch.symbols);
  });

  it('starting above the run changes nothing', () => {
    expect(run('R9', 1)).toEqual(['R1', 'R2', 'R3', 'C1']);
  });
});
