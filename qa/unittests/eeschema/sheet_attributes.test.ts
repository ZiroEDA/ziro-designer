// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A sheet's attributes and appearance, the parts DIALOG_SHEET_PROPERTIES edits
 * beyond its name and file.
 *
 * `SCH_IO_KICAD_SEXPR::saveSheet` writes `in_bom` and `on_board` inverted from
 * the flags the dialog shows ("Exclude from…"), and a sheet carries the same
 * attribute set as a symbol because they apply to everything inside it.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic, serializeSchematic } from '@ziroeda/eeschema';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';

const read = (body: string) =>
  readSchematic(parse(`(kicad_sch (version 20250114) (generator "x") (lib_symbols) ${body})`));

const SHEET = (extra = '') => `(sheet (at 50 50) (size 30 20) ${extra} (uuid "s1")
    (property "Sheetname" "Sub" (at 50 49.4 0))
    (property "Sheetfile" "sub.kicad_sch" (at 50 70.6 0)))`;

describe('sheet attributes', () => {
  it('defaults to included everywhere when the tokens are absent', () => {
    // A file written before the tokens existed must read as a plain sheet, not
    // as one excluded from everything.
    const sh = read(SHEET()).sheets[0]!;
    expect(sh.inBom).toBe(true);
    expect(sh.onBoard).toBe(true);
    expect(sh.dnp).toBe(false);
    expect(sh.excludedFromSim).toBeUndefined();
  });

  it('reads the tokens, with in_bom and on_board inverted', () => {
    const sh = read(SHEET('(exclude_from_sim yes) (in_bom no) (on_board no) (dnp yes)')).sheets[0]!;
    expect(sh.inBom).toBe(false);
    expect(sh.onBoard).toBe(false);
    expect(sh.dnp).toBe(true);
    expect(sh.excludedFromSim).toBe(true);
  });

  it('round-trips every attribute', () => {
    const doc = read(SHEET('(exclude_from_sim yes) (in_bom no) (on_board yes) (dnp yes)'));
    const back = readSchematic(parse(serializeSchematic(doc))).sheets[0]!;
    const sh = doc.sheets[0]!;
    expect(back.inBom).toBe(sh.inBom);
    expect(back.onBoard).toBe(sh.onBoard);
    expect(back.dnp).toBe(sh.dnp);
    expect(back.excludedFromSim).toBe(sh.excludedFromSim);
  });

  it('adds a token only once the flag leaves its default', () => {
    // A file that never carried the tokens keeps not carrying them, so an
    // untouched sheet still round-trips byte-for-byte.
    const doc = read(SHEET());
    expect(serializeSchematic(doc)).not.toMatch(/in_bom|on_board|dnp|exclude_from_sim/);

    const flagged = {
      ...doc,
      sheets: [{ ...doc.sheets[0]!, dnp: true, inBom: false }],
    };
    const text = serializeSchematic(flagged);
    expect(text).toMatch(/\(dnp\s+yes\)/);
    expect(text).toMatch(/\(in_bom\s+no\)/);
    // on_board never left its default, so it is still absent.
    expect(text).not.toMatch(/on_board/);
  });

  it('round-trips the border width and colour', () => {
    const doc = read(SHEET('(stroke (width 0.254) (type solid) (color 255 0 0 1))'));
    const sh = doc.sheets[0]!;
    expect(sh.stroke?.width).toBe(mmToIU(0.254));
    expect(sh.stroke?.color).toEqual([255, 0, 0, 1]);

    const wider = {
      ...doc,
      sheets: [{ ...sh, stroke: { ...sh.stroke!, width: mmToIU(0.5) } }],
    };
    const back = readSchematic(parse(serializeSchematic(wider))).sheets[0]!;
    expect(back.stroke?.width).toBe(mmToIU(0.5));
    expect(back.stroke?.color).toEqual([255, 0, 0, 1]);
  });

  it('round-trips the background fill colour', () => {
    const doc = read(SHEET('(fill (color 10 20 30 0.5))'));
    expect(doc.sheets[0]!.fillColor).toEqual([10, 20, 30, 0.5]);
    const recoloured = {
      ...doc,
      sheets: [{ ...doc.sheets[0]!, fillColor: [1, 2, 3, 1] as const }],
    };
    const back = readSchematic(parse(serializeSchematic(recoloured))).sheets[0]!;
    expect(back.fillColor).toEqual([1, 2, 3, 1]);
  });

  it('writes an absent background as alpha 0, the way saveSheet does', () => {
    // COLOR4D::UNSPECIFIED is stored as a transparent colour, not a missing
    // node, so clearing the fill has to write it rather than drop it.
    const doc = read(SHEET('(fill (color 10 20 30 0.5))'));
    const cleared = { ...doc, sheets: [{ ...doc.sheets[0]!, fillColor: undefined }] };
    const text = serializeSchematic(cleared);
    expect(text).toMatch(/\(color\s+0\s+0\s+0\s+0\s*\)/);
    expect(readSchematic(parse(text)).sheets[0]!.fillColor).toBeUndefined();
  });
});
