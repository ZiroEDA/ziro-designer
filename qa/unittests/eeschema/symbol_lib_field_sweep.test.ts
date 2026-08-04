// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Every modelled field of a **library symbol** survives a save.
 *
 * The same sweep `writer_field_sweep.test.ts` runs over a schematic, pointed at
 * the other writer. `symbol-lib-roundtrip.spec.ts` already round-trips an
 * *untouched* library — which cannot catch writer lag at all, because an
 * untouched item writes its source node back verbatim and always matches. The
 * bug only appears once a field has been changed.
 *
 * That matters more here than it looks: the whole symbol editor saves through
 * this path, so a field it can edit and this writer cannot emit is an edit the
 * user loses on save.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from '@ziroeda/sexpr';
import { readSymbolLib } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import { serializeSymbolLib } from '@ziroeda/eeschema/src/sch_io/sexpr/write-symbol-lib.js';
import type { LibSymbol } from '@ziroeda/eeschema/src/types.js';

/** Modelled but deliberately not round-tripped, and why. Branch keys apply to everything under them. */
const EXCLUDED: Record<string, string> = {
  '*.source': 'the source node itself — patched, never compared, at any depth',
  libId: 'the symbol’s name, which is also the key it is stored under',
  // The unit's *name* is what the file stores ("R_0_1"); unit and bodyStyle are
  // parsed back out of it. Changing a number without the name it came from is
  // not a state the file can hold. (The name itself is not excluded — it does
  // round-trip, and this is the right way round: the stored form is the name.)
  'units.unit': 'parsed out of the unit name, which is the stored form',
  'units.bodyStyle': 'parsed out of the unit name, which is the stored form',
  // `(power local)` sets both flags on read: a local power symbol IS a power
  // symbol. isLocalPower without isPower is not a state the format can hold.
  isLocalPower: 'implies isPower in the file; the two cannot differ',
  // Renaming the parent of a derived symbol needs the parent to exist.
  extends: 'names another symbol in the library, which must be there',
  // `kind` is the discriminant of a union: a rectangle has start/end, a circle
  // has a centre and a radius. Changing the tag alone does not convert the
  // shape, it describes an object whose other fields are now missing — which
  // is why the writer threw rather than mis-writing. Changing a shape's type
  // means replacing the shape.
  'units.graphics.kind': 'the union discriminant; changed by replacing the shape',
};

/** Token-valued fields: perturb to a *different valid* token, not to gibberish. */
const ENUMS: Record<string, readonly string[]> = {
  'units.pins.type': [
    'input',
    'output',
    'bidirectional',
    'tri_state',
    'passive',
    'free',
    'unspecified',
    'power_in',
    'power_out',
    'open_collector',
    'open_emitter',
    'no_connect',
  ],
  'units.pins.shape': [
    'line',
    'inverted',
    'clock',
    'inverted_clock',
    'input_low',
    'clock_low',
    'output_low',
    'edge_clock_high',
    'non_logic',
  ],
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function leaves(
  node: unknown,
  path: string[] = [],
  depth = 0,
  out: { path: string[]; value: unknown }[] = [],
): { path: string[]; value: unknown }[] {
  if (depth > 6) return out;
  if (Array.isArray(node)) {
    node.forEach((v, i) => leaves(v, [...path, String(i)], depth + 1, out));
    return out;
  }
  if (isRecord(node)) {
    for (const k of Object.keys(node)) leaves(node[k], [...path, k], depth + 1, out);
    return out;
  }
  out.push({ path, value: node });
  return out;
}

function setAt(node: unknown, path: readonly string[], value: unknown): unknown {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  if (Array.isArray(node)) {
    const i = Number(head);
    return node.map((v, j) => (j === i ? setAt(v, rest, value) : v));
  }
  const rec = node as Record<string, unknown>;
  return { ...rec, [head!]: setAt(rec[head!], rest, value) };
}

const getAt = (node: unknown, path: readonly string[]): unknown =>
  path.reduce<unknown>((n, k) => (n == null ? undefined : (n as Record<string, unknown>)[k]), node);

function perturb(v: unknown, key: string): unknown | null {
  const tokens = ENUMS[key];
  if (tokens) return tokens.find((t) => t !== v) ?? null;
  if (typeof v === 'boolean') return !v;
  if (typeof v === 'number') return Number.isInteger(v) ? v + 137 : v + 0.5;
  if (typeof v === 'string') return v === '' ? 'ZQX' : `${v}ZQX`;
  return null;
}

interface Miss {
  where: string;
  wrote: unknown;
  read: unknown;
}

function sweep(symbols: readonly LibSymbol[]): Miss[] {
  const misses: Miss[] = [];
  symbols.forEach((sym, index) => {
    for (const { path, value } of leaves(sym)) {
      const segments = path.filter((p) => !/^\d+$/.test(p));
      // `*.x` excludes an `x` branch wherever it appears — a `source` tree hangs
      // off the symbol, off each property and off each pin. A dotted key
      // excludes one specific branch. Either way it covers everything below.
      if (segments.some((seg) => EXCLUDED[`*.${seg}`])) continue;
      if (segments.some((_, i) => EXCLUDED[segments.slice(0, i + 1).join('.')])) continue;
      const next = perturb(value, segments.join('.'));
      if (next === null) continue;
      const edited = symbols.map((s, i) => (i === index ? (setAt(s, path, next) as LibSymbol) : s));
      const where = `${sym.libId}.${path.join('.')}`;
      // A writer that throws on a legal model value is a finding, not a crash:
      // reporting it keeps one bad field from hiding every field after it.
      let got: unknown;
      try {
        got = getAt(readSymbolLib(parse(serializeSymbolLib(edited)))[index], path);
      } catch (e) {
        misses.push({ where, wrote: next, read: `threw: ${(e as Error).message}` });
        continue;
      }
      if (got !== next) misses.push({ where, wrote: next, read: got });
    }
  });
  return misses;
}

const load = (rel: string): LibSymbol[] =>
  readSymbolLib(parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')));

describe('every modelled field of a library symbol survives a save', () => {
  it('R.kicad_sym', () => {
    const misses = sweep(load('../../data/R.kicad_sym'));
    const report = misses
      .map((m) => `${m.where}: wrote ${JSON.stringify(m.wrote)}, read ${JSON.stringify(m.read)}`)
      .join('\n  ');
    expect(misses, `fields that did not survive a save:\n  ${report}`).toEqual([]);
  });

  it('is actually looking at something', () => {
    // A structural test that finds no leaves passes while testing nothing.
    const syms = load('../../data/R.kicad_sym');
    expect(syms.length).toBeGreaterThan(0);
    expect(leaves(syms[0]!).length).toBeGreaterThan(30);
  });
});
