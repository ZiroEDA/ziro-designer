// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The live-model `.kicad_sym` reader and writer (SCH_IO_KICAD_SEXPR_LIB_CACHE) against
 * KiCad's own: `qa/data/eeschema/sexpr_oracle/sym/<lib>.pass1` is what `kicad-cli sym
 * upgrade --force` (10.0.6) wrote for the library fixture, `.pass2` what it wrote for
 * `.pass1`.  JobSymUpgrade loads the library into a SCH_IO_KICAD_SEXPR_LIB_CACHE, marks
 * it modified and saves it; so do we.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { wxReadFileSync, wxWriteFileSync } from '@ziroeda/common/wx/filefn.js';
import { SCH_IO_KICAD_SEXPR_LIB_CACHE } from '@ziroeda/eeschema/sch_io/kicad_sexpr/sch_io_kicad_sexpr_lib_cache.js';

const DATA = resolve(__dirname, '../../data');
const ORACLE = join(DATA, 'eeschema', 'sexpr_oracle', 'sym');

const LIBS: readonly [string, string][] = [
  ['C', 'C.kicad_sym'],
  ['R', 'R.kicad_sym'],
  ['GND', 'GND.kicad_sym'],
  ['kicad_square24_300dpi', 'bitmap2component/kicad_square24_300dpi.kicad_sym'],
  ['complex_hierarchy-cache', 'eeschema/legacy/complex_hierarchy-cache.kicad_sym'],
  ['legacy_all', 'eeschema/legacy/legacy_all.kicad_sym'],
  // 10.0.6: a pre-20250827 library infers De Morgan only when no body style was declared, and
  // the declared count prunes the draw items of any body style beyond it.
  ['body_styles_legacy', 'eeschema/sexpr_1006/body_styles_legacy.kicad_sym'],
  ['body_styles_leftover', 'eeschema/sexpr_1006/body_styles_leftover.kicad_sym'],
];

function upgrade(aText: string, aName: string): string {
  const path = `/tmp/oracle/${aName}.kicad_sym`;

  wxWriteFileSync(path, new TextEncoder().encode(aText));

  const cache = new SCH_IO_KICAD_SEXPR_LIB_CACHE(path);

  cache.Load();
  cache.SetModified();
  cache.Save(undefined, 'kicad_symbol_editor');

  return new TextDecoder().decode(wxReadFileSync(path)!);
}

describe('SCH_IO_KICAD_SEXPR_LIB_CACHE against kicad-cli sym upgrade', () => {
  for (const [name, fixture] of LIBS) {
    it(`${name}: KiCad's rewrite is a fixed point`, () => {
      const pass1 = readFileSync(join(ORACLE, `${name}.kicad_sym.pass1`), 'utf8');
      const pass2 = readFileSync(join(ORACLE, `${name}.kicad_sym.pass2`), 'utf8');

      expect(upgrade(pass1, name)).toBe(pass2);
    });

    it(`${name}: the original upgrades as KiCad upgrades it`, () => {
      const orig = readFileSync(join(DATA, fixture), 'utf8');
      const pass1 = readFileSync(join(ORACLE, `${name}.kicad_sym.pass1`), 'utf8');

      expect(upgrade(orig, name)).toBe(pass1);
    });
  }
});
