// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * "Place Pins from Sheet" imports; it does not ask for a name.
 *
 * `SCH_DRAWING_TOOLS::TwoClickPlace`, the sheet-pin branch:
 *
 *     SCH_HIERLABEL* label = importHierLabel( sheet );
 *     if( !label ) { … "No new hierarchical labels found." … break; }
 *     item = createNewSheetPinFromLabel( sheet, cursorPos, label );
 *
 * and the label chosen is the first, in natural name order, that the sheet has
 * no pin for:
 *
 *     std::sort( labels.begin(), labels.end(), … StrNumCmp( … ) < 0 );
 *     for( SCH_HIERLABEL* label : labels )
 *         if( !aSheet->HasPin( label->GetText() ) )
 *             return label;
 *
 * Ours opened the pin-properties dialog and had you type the name, which is the
 * *manual* gesture — upstream only offers that from the sync dialog — and which
 * lets a pin and the label it is supposed to match drift apart.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema';
import {
  importableSheetPins,
  nextImportableSheetPin,
  sheetHasPin,
} from '@ziroeda/eeschema/src/tools/import_sheet_pins.js';
import type { Schematic } from '@ziroeda/eeschema/src/types.js';

/** A child schematic carrying the given hierarchical labels. */
const child = (labels: { name: string; shape?: string }[]): Schematic =>
  readSchematic(
    parse(`(kicad_sch (version 20250114) (lib_symbols)
      ${labels
        .map(
          (l, i) =>
            `(hierarchical_label "${l.name}" (shape ${l.shape ?? 'bidirectional'})
               (at 50 ${20 + i * 5} 0) (effects (font (size 1.27 1.27))) (uuid "h${i}"))`,
        )
        .join('\n      ')})`),
  );

/** A parent sheet symbol, optionally already carrying some pins. */
const parent = (pins: string[]): Schematic =>
  readSchematic(
    parse(`(kicad_sch (version 20250114) (lib_symbols)
      (sheet (at 100 50) (size 40 40) (uuid "sh1")
        (property "Sheetname" "S" (at 100 49 0))
        (property "Sheetfile" "child.kicad_sch" (at 100 95 0))
        ${pins
          .map(
            (n, i) =>
              `(pin "${n}" input (at 100 ${60 + i * 5} 180)
                 (effects (font (size 1.27 1.27))) (uuid "p${i}"))`,
          )
          .join('\n        ')}))`),
  );

const sheetOf = (pins: string[]) => parent(pins).sheets[0]!;

describe('which labels are importable', () => {
  it('all of them when the sheet has no pins yet', () => {
    const out = importableSheetPins(sheetOf([]), child([{ name: 'CLK' }, { name: 'RST' }]));
    expect(out.map((l) => l.text)).toEqual(['CLK', 'RST']);
  });

  it('and none that the sheet already has a pin for', () => {
    // `if( !aSheet->HasPin( label->GetText() ) )`.
    const out = importableSheetPins(sheetOf(['CLK']), child([{ name: 'CLK' }, { name: 'RST' }]));
    expect(out.map((l) => l.text)).toEqual(['RST']);
  });

  it('nothing at all when the child is not loaded', () => {
    // `if( !aSheet->GetScreen() ) return {};`
    expect(importableSheetPins(sheetOf([]), undefined)).toEqual([]);
  });

  it('and only hierarchical labels count, not net or global ones', () => {
    const mixed = readSchematic(
      parse(`(kicad_sch (version 20250114) (lib_symbols)
        (hierarchical_label "HIER" (shape input) (at 50 20 0)
          (effects (font (size 1.27 1.27))) (uuid "h1"))
        (label "PLAIN" (at 50 30 0) (effects (font (size 1.27 1.27))) (uuid "l1"))
        (global_label "GLOB" (shape input) (at 50 40 0)
          (effects (font (size 1.27 1.27))) (uuid "g1")))`),
    );
    expect(importableSheetPins(sheetOf([]), mixed).map((l) => l.text)).toEqual(['HIER']);
  });
});

describe('which one the tool places next', () => {
  it('the first in natural name order, not file order', () => {
    // StrNumCmp is a natural sort, so D9 comes before D10 — a plain string
    // compare would put D10 first.
    const next = nextImportableSheetPin(sheetOf([]), child([{ name: 'D10' }, { name: 'D9' }]));
    expect(next?.text).toBe('D9');
  });

  it('skipping the ones already placed, so repeated use walks the list', () => {
    const labels = [{ name: 'A' }, { name: 'B' }, { name: 'C' }];
    expect(nextImportableSheetPin(sheetOf([]), child(labels))?.text).toBe('A');
    expect(nextImportableSheetPin(sheetOf(['A']), child(labels))?.text).toBe('B');
    expect(nextImportableSheetPin(sheetOf(['A', 'B']), child(labels))?.text).toBe('C');
  });

  it('and null once they are all placed — "No new hierarchical labels found."', () => {
    expect(nextImportableSheetPin(sheetOf(['A', 'B']), child([{ name: 'A' }, { name: 'B' }]))).toBe(
      null,
    );
  });

  it('carries the label’s shape onto the pin', () => {
    // `pin->SetShape( aLabel->GetShape() )` — so the pin and its label agree by
    // construction, which typing the name by hand cannot guarantee.
    const next = nextImportableSheetPin(sheetOf([]), child([{ name: 'OUT', shape: 'output' }]));
    expect(next?.shape).toBe('output');
  });
});

describe('sheetHasPin', () => {
  it('matches on the pin name', () => {
    const sheet = sheetOf(['CLK']);
    expect(sheetHasPin(sheet, 'CLK')).toBe(true);
    expect(sheetHasPin(sheet, 'clk')).toBe(false);
    expect(sheetHasPin(sheet, 'RST')).toBe(false);
  });
});
