// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The per-symbol library split, checked against real libraries.
 *
 * `tools/libraries/split.mjs` produces what the app fetches when placing a part:
 * one file per symbol instead of a whole library (7.0 MB for one connector out
 * of Connector_Generic). The risk it carries is silent. A derived symbol owns no
 * geometry, only `(extends "Parent")`; if its file leaves the parent out,
 * `resolveExtends` looks the name up, does not find it, and keeps the child's
 * own empty body. The file parses, the symbol places, and it has no pins, with
 * nothing logged anywhere.
 *
 * So the emitted files are read back with our own reader and compared against
 * the library they came from, over the bundled set that ships in this repo.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from '@ziroeda/sexpr';
import { readSymbolLib, type LibSymbol } from '@ziroeda/eeschema';
import { extendsOf, perSymbolFiles, topLevelSymbols } from '../../../tools/libraries/split.mjs';

const SYMBOLS = fileURLToPath(new URL('../../../designer/public/symbols/', import.meta.url));

/** Pins across the base body style, as `symbolPinCount` counts them. */
const pinsOf = (s: LibSymbol): number =>
  s.units.reduce((n, u) => (u.bodyStyle <= 1 ? n + u.pins.length : n), 0);

const libraries = readdirSync(SYMBOLS).filter((f) => f.endsWith('.kicad_sym'));

describe('per-symbol split', () => {
  it('has libraries to check', () => {
    expect(libraries.length).toBeGreaterThan(10);
  });

  it('gives every symbol the same body its library does', { timeout: 600_000 }, () => {
    let checked = 0;
    let derived = 0;

    for (const file of libraries) {
      const text = readFileSync(SYMBOLS + file, 'utf8');
      const parts = topLevelSymbols(text);
      const whole = new Map(readSymbolLib(parse(text)).map((s) => [s.libId, s]));
      expect(parts.length, file).toBe(whole.size);

      for (const { name, text: one } of perSymbolFiles(parts)) {
        const expected = whole.get(name);
        expect(expected, `${file}: ${name} missing from the parsed library`).toBeDefined();

        const got = readSymbolLib(parse(one)).find((s) => s.libId === name);
        expect(got, `${file}: ${name} did not survive the split`).toBeDefined();
        expect(pinsOf(got!), `${file}: ${name} pin count`).toBe(pinsOf(expected!));
        expect(got!.units.length, `${file}: ${name} unit count`).toBe(expected!.units.length);

        if (expected!.extends) derived++;
        checked++;
      }
    }

    expect(checked).toBeGreaterThan(10000);
    // Without derived symbols in the set the check above proves very little:
    // they are the only ones that can lose their body in the split.
    expect(derived).toBeGreaterThan(100);
  });

  it('leaves a symbol that extends nothing as a file of one', () => {
    const parts = topLevelSymbols(readFileSync(`${SYMBOLS}Device.kicad_sym`, 'utf8'));
    const plain = perSymbolFiles(parts).find(({ name }) => name === 'R');
    expect(plain).toBeDefined();
    expect(readSymbolLib(parse(plain!.text))).toHaveLength(1);
  });

  it('carries the parent into a derived symbol’s file', () => {
    const parts = topLevelSymbols(readFileSync(`${SYMBOLS}Device.kicad_sym`, 'utf8'));
    const derivedName = parts.find(({ block }) => /\(\s*extends\s+"/.test(block))?.name;
    expect(derivedName, 'Device.kicad_sym has no derived symbol to check').toBeDefined();

    const byName = new Map(parts.map((p) => [p.name, p.block]));
    const parent = extendsOf(byName.get(derivedName!)!);
    expect(parent).toBeDefined();
    const file = perSymbolFiles(parts).find(({ name }) => name === derivedName)!;
    const inFile = readSymbolLib(parse(file.text)).map((s) => s.libId);

    expect(inFile).toContain(parent!);
    // Parent first: the reader resolves by name over what it has already read.
    expect(inFile.indexOf(parent!)).toBeLessThan(inFile.indexOf(derivedName!));
  });
});
