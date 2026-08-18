// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `FOOTPRINT::GetUniquePadNumbers( DO_NOT_INCLUDE_NPTH )`
 * (pcbnew/footprint.cpp:2532-2558), the count "Filter by pin count" compares
 * against a symbol's netlist pin count, and the FOOTPRINT_INFO fields the
 * hosted index carries so the browser can filter without downloading anything
 * (`footprint_info_impl.cpp:36-58`).
 *
 * There are two implementations by necessity — the library pipeline runs under
 * bare node with no build step and cannot import the TypeScript packages — so
 * this file pins them against each other over every hosted footprint as well as
 * checking each rule on its own.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { uniquePadCount, uniquePadNumbers } from '@ziroeda/pcbnew';
import { parseFootprint } from '@ziroeda/designer/src/editors/footprint/footprintBoard.js';
import {
  footprintIndexInfo,
  uniquePadNumbers as indexPadNumbers,
} from '../../../tools/libraries/fp_index.mjs';

const CM5IO_DIR = fileURLToPath(
  new URL('../../../designer/public/footprints/CM5IO.pretty', import.meta.url),
);

/**
 * Every kind of pad the rule has an opinion about, in one part: two ordinary
 * SMD pads, the same number repeated on the other side, a *numbered* NPTH
 * mounting hole, an unnumbered NPTH hole, and a numbered stencil-only paste
 * pad. A naive "distinct pad numbers" count says 5; KiCad says 2.
 */
const MIXED = `(footprint "Mixed" (version 20221018) (generator pcbnew)
  (layer "F.Cu")
  (descr "Two-pad part with M3 mounting holes and a paste stencil")
  (tags "SMD handsolder mounting hole")
  (pad "1" smd rect (at -1 0) (size 1 1) (layers "F.Cu" "F.Paste" "F.Mask"))
  (pad "2" smd rect (at 1 0) (size 1 1) (layers "F.Cu" "F.Paste" "F.Mask"))
  (pad "1" smd rect (at -1 0) (size 1 1) (layers "B.Cu" "B.Mask"))
  (pad "MH1" np_thru_hole circle (at -3 0) (size 3.2 3.2) (drill 3.2) (layers "F&B.Cu" "*.Mask"))
  (pad "" np_thru_hole circle (at 3 0) (size 3.2 3.2) (drill 3.2) (layers "F&B.Cu" "*.Mask"))
  (pad "9" smd rect (at 0 2) (size 1 1) (layers "F.Paste"))
  (pad "" smd rect (at 0 -2) (size 1 1) (layers "F.Paste"))
)`;

describe('FOOTPRINT::GetUniquePadNumbers', () => {
  const fp = parseFootprint(MIXED)!;

  it('counts distinct numbers of the pads KiCad calls electrical', () => {
    // "1" (twice, front and back) and "2". Everything else is excluded below.
    expect([...uniquePadNumbers(fp)].sort()).toEqual(['1', '2']);
    expect(uniquePadCount(fp)).toBe(2);
  });

  it('skips a pad with no copper layer', () => {
    // Pad "9" is stencil-only: `(layers "F.Paste")`. Upstream's comment is
    // "used to build complex solder paste shapes for instance".
    expect(uniquePadNumbers(fp).has('9')).toBe(false);
    // Including NPTH does not bring it back — it is a separate rule.
    expect(uniquePadNumbers(fp, true).has('9')).toBe(false);
  });

  it('skips an NPTH pad even when it is numbered', () => {
    // This is the mounting-hole case A8 is about: the hole carries a number,
    // so the empty-number rule does not catch it, and the count is inflated
    // past anything the symbol can have pins for.
    expect(uniquePadNumbers(fp).has('MH1')).toBe(false);
    // …unless the caller asks for them; footprint_info_impl.cpp:53 does not.
    expect([...uniquePadNumbers(fp, true)].sort()).toEqual(['1', '2', 'MH1']);
    expect(uniquePadCount(fp, true)).toBe(3);
  });

  it('skips pads with an empty number', () => {
    expect(uniquePadNumbers(fp).has('')).toBe(false);
    expect(uniquePadNumbers(fp, true).has('')).toBe(false);
  });
});

describe('the hosted index fields', () => {
  it('applies the same three rules from the file text', () => {
    expect([...indexPadNumbers(MIXED)].sort()).toEqual(['1', '2']);
    expect([...indexPadNumbers(MIXED, true)].sort()).toEqual(['1', '2', 'MH1']);
  });

  it('carries the description and keywords FOOTPRINT_INFO caches', () => {
    // GetSearchTerms scores these, so "stencil" and "handsolder" have to reach
    // the browser or the search box can never match them.
    const info = footprintIndexInfo(MIXED);
    expect(info.pads).toBe(2);
    expect(info.descr).toBe('Two-pad part with M3 mounting holes and a paste stencil');
    expect(info.tags).toBe('SMD handsolder mounting hole');
  });

  it('reports empty strings when the footprint declares neither', () => {
    const bare =
      '(footprint "Bare" (layer "F.Cu") (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu")))';
    expect(footprintIndexInfo(bare)).toEqual({ pads: 1, descr: '', tags: '' });
  });

  it('agrees with the parsed-board implementation on every hosted footprint', () => {
    const files = readdirSync(CM5IO_DIR).filter((f) => f.endsWith('.kicad_mod'));
    expect(files.length).toBeGreaterThan(20);
    for (const file of files) {
      const text = readFileSync(`${CM5IO_DIR}/${file}`, 'utf8');
      const fp = parseFootprint(text)!;
      expect([...indexPadNumbers(text)].sort(), file).toEqual([...uniquePadNumbers(fp)].sort());
    }
  });

  it('and the hosted set really does contain the pads the rules exclude', () => {
    // A guard on the fixture: if these ever stop being present the agreement
    // test above would be checking nothing interesting.
    const paste = readFileSync(
      `${CM5IO_DIR}/DFN-8-1EP_2x2mm_P0.5mm_EP1.05x1.75mm.kicad_mod`,
      'utf8',
    );
    expect(paste).toContain('(layers "F.Paste")');
    expect(footprintIndexInfo(paste).pads).toBe(9);

    const hole = readFileSync(`${CM5IO_DIR}/MountingHole_2.7mm_M2.5_DIN965.kicad_mod`, 'utf8');
    expect(hole).toContain('np_thru_hole');
    expect(footprintIndexInfo(hole).pads).toBe(0);
    expect(footprintIndexInfo(hole).tags).toBe('mounting hole 2.7mm no annular m2.5 din965');
  });
});
