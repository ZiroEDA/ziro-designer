// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The complete official symbol + footprint libraries must parse with our
 * engines. Local-only sweeps (skipped in CI): merged symbol libraries come
 * from the uploader's staging dir, footprints from the upstream clone.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from '@ziroeda/sexpr';
import { readSymbolLib, type LibSymbol } from '@ziroeda/eeschema';
import { readFootprintFile } from '@ziroeda/pcbnew';

const SYM_STAGED = fileURLToPath(new URL('../../../tools/libraries/out/symbols/', import.meta.url));
const FP_SRC = fileURLToPath(new URL('../../../kicad-footprints-src/', import.meta.url));

describe.skipIf(!existsSync(SYM_STAGED))('official symbol library sweep (merged)', () => {
  const libs = existsSync(SYM_STAGED)
    ? readdirSync(SYM_STAGED).filter((f) => f.endsWith('.kicad_sym'))
    : [];

  it(`parses every merged library (${libs.length})`, { timeout: 300_000 }, () => {
    let symbols = 0;
    for (const f of libs) {
      const syms = readSymbolLib(parse(readFileSync(SYM_STAGED + f, 'utf8')));
      expect(syms.length, f).toBeGreaterThan(0);
      symbols += syms.length;
    }
    expect(symbols).toBeGreaterThan(20000);
  });

  /**
   * Every per-symbol file must resolve to the same symbol the merged library
   * gives, pins and all.
   *
   * A derived symbol owns no geometry: it is `(extends "Parent")` and nothing
   * else. If its own file omits that parent, `resolveExtends` looks the name up,
   * finds nothing, and keeps the child's empty body. The file parses, the symbol
   * places, and it has no pins. Nothing anywhere reports a problem, so this is
   * checked against the merged library on the real set rather than trusted.
   */
  it(`splits every symbol without losing its parent`, { timeout: 600_000 }, () => {
    let checked = 0;
    let derived = 0;
    for (const f of libs) {
      const lib = f.replace(/\.kicad_sym$/, '');
      const dir = `${SYM_STAGED}${lib}/`;
      if (!existsSync(dir)) continue;
      const pinsOf = (s: LibSymbol): number =>
        s.units.reduce((n, u) => (u.bodyStyle <= 1 ? n + u.pins.length : n), 0);
      const whole = new Map(
        readSymbolLib(parse(readFileSync(SYM_STAGED + f, 'utf8'))).map((s) => [s.libId, s]),
      );
      for (const [name, expected] of whole) {
        const one = `${dir}${name.replace(/\//g, '%2F')}.kicad_sym`;
        expect(existsSync(one), one).toBe(true);
        const got = readSymbolLib(parse(readFileSync(one, 'utf8'))).find((s) => s.libId === name);
        expect(got, one).toBeDefined();
        expect(pinsOf(got!), `${lib}:${name} pin count`).toBe(pinsOf(expected));
        if (expected.extends) derived++;
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20000);
    // If this is zero the check above proved nothing: the whole risk is derived
    // symbols, and the standard set has thousands of them.
    expect(derived).toBeGreaterThan(1000);
  });
});

describe.skipIf(!existsSync(FP_SRC))('official footprint library sweep', () => {
  const pretties = existsSync(FP_SRC)
    ? readdirSync(FP_SRC).filter((d) => d.endsWith('.pretty'))
    : [];

  it(`parses every footprint in all ${pretties.length} libraries`, { timeout: 600_000 }, () => {
    let count = 0;
    for (const dir of pretties) {
      for (const f of readdirSync(FP_SRC + dir)) {
        if (!f.endsWith('.kicad_mod')) continue;
        const fp = readFootprintFile(parse(readFileSync(`${FP_SRC}${dir}/${f}`, 'utf8')));
        expect(fp, `${dir}/${f}`).toBeTruthy();
        count++;
      }
    }
    expect(count).toBeGreaterThan(15000);
  });
});
