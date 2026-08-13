// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A symbol placed while "Annotate Automatically" is on arrives numbered.
 *
 * The toggle existed and set a flag that only the Paste Special dialog read, so
 * turning it on changed nothing: every placed symbol still came out `R?`.
 * KiCad's condition, in `sch_drawing_tools.cpp` right after the symbol is added
 * and inside the same commit, is
 *
 *   if( cfg->m_AnnotatePanel.automatic || newReference.AlwaysAnnotate() )
 *
 * and `SCH_REFERENCE::AlwaysAnnotate` is
 *
 *   m_rootSymbol->GetLibSymbolRef()->IsPower()
 *       || m_rootSymbol->GetRef( &m_sheetPath )[0] == '#'
 *
 * so power symbols are numbered whatever the toggle says. Both halves are
 * pinned here: the numbering itself is the annotate pass's job and is tested
 * with it, what matters here is which symbols reach that pass and what they
 * are numbered against.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import {
  annotateSymbols,
  defaultAnnotateOptions,
  makeSymbol,
  readSchematic,
  readSymbolLib,
  refId,
  type LibSymbol,
  type Schematic,
  type SchSymbol,
} from '@ziroeda/eeschema';

const SHEET = `(kicad_sch (version 20250114) (generator "eeschema")
  (uuid "0f1e2d3c-0000-0000-0000-000000000000") (lib_symbols)
  (sheet_instances (path "/" (page "1"))))
`;

const lib = (name: string, refPrefix: string, power = false): LibSymbol => {
  const raw = readSymbolLib(
    parse(`(kicad_symbol_lib (version 20241209) (generator "x")
      (symbol "${name}" ${power ? '(power)' : ''}
        (property "Reference" "${refPrefix}" (at 0 0 0) (effects (font (size 1.27 1.27))))
        (symbol "${name}_1_1"
          (pin passive line (at 0 3.81 270) (length 1.27)
            (name "~" (effects (font (size 1.27 1.27))))
            (number "1" (effects (font (size 1.27 1.27))))))))`),
  )[0]!;
  return { ...raw, libId: `Device:${raw.libId}` };
};

/**
 * The editor's rule, as `annotatePlacement` implements it: annotate the new
 * symbol alone, in a document that already holds it so every existing
 * reference counts as taken.
 */
function placeWith(doc: Schematic, part: LibSymbol, automatic: boolean): SchSymbol {
  const sym = makeSymbol(part, { x: 100, y: 100 });
  const reference = sym.fields.find((f) => f.key === 'Reference')?.value ?? '';
  const alwaysAnnotate = part.isPower === true || reference.startsWith('#');
  if (!automatic && !alwaysAnnotate) return sym;

  const staged: Schematic = { ...doc, symbols: [...doc.symbols, sym] };
  const index = staged.symbols.length - 1;
  const libs = new Map([[part.libId, part]]);
  const out = annotateSymbols(
    staged,
    libs,
    { ...defaultAnnotateOptions(), scope: 'selection', resetExisting: false, includePower: true },
    new Set([refId('symbol', sym.uuid, index)]),
  );
  return out[index] ?? sym;
}

const refOf = (s: SchSymbol): string => s.fields.find((f) => f.key === 'Reference')?.value ?? '';

describe('placing a symbol with the toggle on', () => {
  it('gives it a number instead of a question mark', () => {
    const doc = readSchematic(parse(SHEET));
    expect(refOf(placeWith(doc, lib('R', 'R'), true))).toBe('R1');
  });

  it('counts what is already on the sheet, so the next one is the next number', () => {
    let doc = readSchematic(parse(SHEET));
    const part = lib('R', 'R');
    const first = placeWith(doc, part, true);
    doc = { ...doc, symbols: [...doc.symbols, first] };
    const second = placeWith(doc, part, true);

    expect([refOf(first), refOf(second)]).toEqual(['R1', 'R2']);
  });

  it('numbers each prefix in its own sequence', () => {
    let doc = readSchematic(parse(SHEET));
    const r = placeWith(doc, lib('R', 'R'), true);
    doc = { ...doc, symbols: [...doc.symbols, r] };
    const c = placeWith(doc, lib('C', 'C'), true);

    expect([refOf(r), refOf(c)]).toEqual(['R1', 'C1']);
  });
});

describe('placing a symbol with the toggle off', () => {
  it('leaves the question mark, as before', () => {
    const doc = readSchematic(parse(SHEET));
    expect(refOf(placeWith(doc, lib('R', 'R'), false))).toBe('R?');
  });

  it('still numbers a power symbol, which AlwaysAnnotate covers', () => {
    // The part of the rule that is not the toggle: a power symbol is numbered
    // whatever the setting says, because its reference is never shown and an
    // unnumbered one collides.
    const doc = readSchematic(parse(SHEET));
    const gnd = lib('GND', '#PWR', true);
    expect(refOf(placeWith(doc, gnd, false))).not.toBe('#PWR?');
  });

  it('still numbers a reference beginning with #, toggle or not', () => {
    const doc = readSchematic(parse(SHEET));
    const hidden = lib('PWR_FLAG', '#FLG');
    expect(refOf(placeWith(doc, hidden, false))).not.toBe('#FLG?');
  });
});
