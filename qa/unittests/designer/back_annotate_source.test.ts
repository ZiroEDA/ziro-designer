// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The board side of Update Schematic from PCB — the only place the two editors
 * touch, so it is the only place that has to track the board model.
 * Counterpart: BACK_ANNOTATE::getPcbModulesFromString.
 */
import { describe, it, expect } from 'vitest';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { boardFootprintData } from '@ziroeda/designer/src/editors/schematic/back_annotate_source.js';
// The symbol and sheet uuids are real ones: a `(path …)` in a board file is
// read as a KIID_PATH, and `KIID( const wxString& )` (kiid.cpp) draws a random
// uuid for any text that does not parse as one.

const board = (footprints: string) =>
  ParseBoard(`(kicad_pcb (version 20241229) (generator "test") ${footprints})`);

const FP = `(footprint "Resistor_SMD:R_0805"
    (layer "F.Cu") (uuid "fp-1") (at 10 10)
    (path "/bbbbbbbb-0000-4000-8000-0000000000b1/aaaaaaaa-0000-4000-8000-0000000000a1")
    (attr smd exclude_from_bom dnp)
    (property "Reference" "R1" (at 0 0 0) (layer "F.SilkS") (uuid "t-1")
      (effects (font (size 1 1) (thickness 0.15))))
    (property "Value" "10k" (at 0 0 0) (layer "F.Fab") (uuid "t-2")
      (effects (font (size 1 1) (thickness 0.15))))
    (property "MPN" "RC0805" (at 0 0 0) (layer "F.Fab") (uuid "t-3")
      (effects (font (size 1 1) (thickness 0.15))))
    (property "Sheetname" "root" (at 0 0 0) (layer "F.Fab") (uuid "t-4")
      (effects (font (size 1 1) (thickness 0.15)))))`;

describe('reading the board as back-annotation data', () => {
  it('takes the reference, value, library id and attributes', () => {
    const [fp] = boardFootprintData(board(FP));
    expect(fp).toBeDefined();
    expect(fp!.reference).toBe('R1');
    expect(fp!.value).toBe('10k');
    // The symbol's Footprint field is the footprint's library id.
    expect(fp!.footprint).toBe('Resistor_SMD:R_0805');
    expect(fp!.dnp).toBe(true);
    expect(fp!.excludeFromBom).toBe(true);
    expect(fp!.excludeFromPosFiles).toBe(false);
  });

  it('reduces the KIID path to the symbol it names', () => {
    // `(path "/sheet/symbol")` on a sub-sheet; the engine matches the symbol,
    // which is the last element.
    expect(boardFootprintData(board(FP))[0]!.path).toBe('/aaaaaaaa-0000-4000-8000-0000000000a1');
    const root = FP.replace(
      '(path "/bbbbbbbb-0000-4000-8000-0000000000b1/aaaaaaaa-0000-4000-8000-0000000000a1")',
      '(path "/aaaaaaaa-0000-4000-8000-0000000000a1")',
    );
    expect(boardFootprintData(board(root))[0]!.path).toBe('/aaaaaaaa-0000-4000-8000-0000000000a1');
  });

  it('carries user fields and drops the format’s own bookkeeping', () => {
    // Sheetname is a reserved property, not a field the user ever created.
    const fields = boardFootprintData(board(FP))[0]!.fields ?? {};
    expect(fields.MPN).toBe('RC0805');
    expect(fields.Sheetname).toBeUndefined();
    // Reference and Value travel as their own members, not as fields.
    expect(fields.Reference).toBeUndefined();
    expect(fields.Value).toBeUndefined();
  });

  it('reads each attribute on its own', () => {
    // FP_EXCLUDE_FROM_POS_FILES alone: neither DNP nor out of the BOM.
    const pos = FP.replace('(attr smd exclude_from_bom dnp)', '(attr smd exclude_from_pos_files)');
    const [fp] = boardFootprintData(board(pos));
    expect(fp!.dnp).toBe(false);
    expect(fp!.excludeFromBom).toBe(false);
    expect(fp!.excludeFromPosFiles).toBe(true);
    // FP_DNP alone does not take a part out of the BOM.
    const dnp = FP.replace('(attr smd exclude_from_bom dnp)', '(attr smd dnp)');
    const [d] = boardFootprintData(board(dnp));
    expect(d!.dnp).toBe(true);
    expect(d!.excludeFromBom).toBe(false);
  });

  it('skips a footprint with no path rather than guessing at one', () => {
    // A footprint placed on the board by hand never had a symbol. Matching it
    // by reference is what the "re-link footprints" option asks permission for.
    const orphan = FP.replace(
      '(path "/bbbbbbbb-0000-4000-8000-0000000000b1/aaaaaaaa-0000-4000-8000-0000000000a1")',
      '',
    );
    expect(boardFootprintData(board(orphan))).toEqual([]);
  });

  it('reads an empty board as no changes rather than as a failure', () => {
    expect(boardFootprintData(board(''))).toEqual([]);
  });
});
