// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Bundled demo projects must parse with our own engines, a demo that fails
 * to open would be the worst possible first impression, and the classic
 * upstream project doubles as a real-world compatibility fixture.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from '@ziroeda/sexpr';
import {
  serializeSchematic,
  serializeSymbolLib,
  readSchematic,
  readSymbolLib,
} from '@ziroeda/eeschema';
import { readBoard, readFootprintFile } from '@ziroeda/pcbnew';

const DEMO = fileURLToPath(new URL('../../../designer/public/demos/ecc83/', import.meta.url));
// Full corpus sweep source: the gitignored upstream clone (local dev only,
// in CI the bundled ecc83 fixture above is the guaranteed compatibility test).
const DEMOS_ROOT = fileURLToPath(new URL('../../../kicad-src/demos/', import.meta.url));
const read = (name: string): string => readFileSync(DEMO + name, 'utf8');

describe.skipIf(!existsSync(DEMO))('bundled demo project (ecc83)', () => {
  it('schematic parses and has real content', () => {
    const sch = readSchematic(parse(read('ecc83-pp.kicad_sch')));
    expect(sch.symbols.length).toBeGreaterThan(5);
    expect(sch.lines.length).toBeGreaterThan(10);
  });

  it('board parses with layers, nets and footprints', () => {
    const board = readBoard(parse(read('ecc83-pp.kicad_pcb')));
    expect(board.layers.length).toBeGreaterThan(2);
    expect(board.footprints.length).toBeGreaterThan(5);
    expect(board.tracks.length).toBeGreaterThan(10);
  });

  it('local symbol library parses', () => {
    const symbols = readSymbolLib(parse(read('ecc83-pp.kicad_sym')));
    expect(symbols.length).toBeGreaterThan(0);
  });

  it('and saves byte-for-byte, but for the generator stamp', () => {
    // The same claim as the schematic above, for the other writer. It already
    // held — unlike the schematic, which needed #439 and #440 — so this pins it
    // rather than fixing anything.
    //
    // This file is the oracle because `kicad_symbol_editor` wrote it. The
    // bundled Device.kicad_sym is *not*: tools/libraries/upload.mjs merges
    // upstream's one-symbol-per-file layout by a byte-exact paren scan, so each
    // symbol keeps the indentation it had as a top-level item and the whole
    // library sits a level deeper than KiCad's canonical layout. Comparing
    // against it would report 156911 differing lines and none of them ours.
    const src = read('ecc83-pp.kicad_sym');
    const out = serializeSymbolLib(readSymbolLib(parse(src)));
    const stamp = (t: string): string =>
      t
        .replace(/\(generator "[^"]*"\)/, '(generator "X")')
        .replace(/\(generator_version "[^"]*"\)/, '(generator_version "X")');
    expect(stamp(out)).toBe(stamp(src));
  });

  it('a save is stable: serialising twice changes nothing the second time', () => {
    // The serializer defines correctness as *semantic* round-trip — parse ∘
    // serialize ∘ parse is identity over the AST — and is explicit that it is
    // not byte-for-byte identical to KiCad's layout (#437).
    //
    // That property was never asserted on this fixture, the one guaranteed to
    // exist in CI. What it rules out is *non-deterministic* output — a Map
    // iteration order, a timestamp, anything that makes two saves of the same
    // document differ.
    //
    // What it does not catch, measured rather than assumed: a change to the
    // layout itself. Re-indenting the whole serializer leaves it green, because
    // the second pass re-parses the first pass's text and lays it out the same
    // new way. Layout is #437; this is only the fixpoint.
    const once = serializeSchematic(readSchematic(parse(read('ecc83-pp.kicad_sch'))));
    const twice = serializeSchematic(readSchematic(parse(once)));
    expect(twice).toBe(once);
  });

  it('and the model survives that save unchanged', () => {
    // Semantic identity, stated over the model rather than the text: every
    // item, and every field of it, comes back.
    const first = readSchematic(parse(read('ecc83-pp.kicad_sch')));
    const second = readSchematic(parse(serializeSchematic(first)));
    const shape = (d: typeof first) => ({
      symbols: d.symbols.length,
      lines: d.lines.length,
      labels: d.labels.length,
      sheets: d.sheets.length,
      junctions: d.junctions.length,
      libSymbols: d.libSymbols.length,
    });
    expect(shape(second)).toEqual(shape(first));
    expect(second.symbols.map((s) => s.libId)).toEqual(first.symbols.map((s) => s.libId));
  });

  it('saves a KiCad file byte-for-byte, but for the generator stamp', () => {
    // The strongest statement the save path can make, and it holds: read the
    // demo, write it back, and the bytes are KiCad's own — same layout, same
    // section order, same everything except the two `(generator …)` lines,
    // which KiCad also rewrites when it saves a file someone else made.
    //
    // Getting here took the `(xy …)` packing rule (#439) and then the section
    // order, which KiCad derives from the KICAD_T enum rather than from the
    // order items sit in. Before that a saved file was a permutation of itself
    // and every line showed as changed.
    const src = read('ecc83-pp.kicad_sch');
    const out = serializeSchematic(readSchematic(parse(src)));
    const stamp = (t: string): string =>
      t
        .replace(/\(generator "[^"]*"\)/, '(generator "X")')
        .replace(/\(generator_version "[^"]*"\)/, '(generator_version "X")');
    expect(stamp(out)).toBe(stamp(src));
  });

  it('saves a KiCad file with KiCad’s own line layout', () => {
    // KiCad packs consecutive `(xy …)` onto one line while the column is under
    // 99 (kicad_io_utils.cpp). Without that rule every polyline was re-laid-out
    // on the first save — 71 lines of diff noise in a file the user did not
    // change, which is exactly what a source-patching writer exists to avoid.
    //
    // Line *count* is the sharp part: a formatting change shows up here
    // immediately, whatever the section order.
    const src = read('ecc83-pp.kicad_sch');
    const out = serializeSchematic(readSchematic(parse(src)));
    expect(out.split('\n').length).toBe(src.split('\n').length);
    expect(out.split('\n').filter((l) => l.includes('(xy ')).length).toBe(
      src.split('\n').filter((l) => l.includes('(xy ')).length,
    );
  });

  it('and every line of content, up to the generator stamp', () => {
    // Order-independent, because our writer emits the document's sections in a
    // different order from KiCad's — a separate divergence, tracked on #437.
    // What this pins is that nothing else differs at all: same lines, same
    // count, only the two `(generator …)` lines rewritten, which is correct
    // and what KiCad does when it saves someone else's file.
    const lines = (t: string): string[] =>
      t
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l !== '' && !l.startsWith('(generator'))
        .sort();
    const src = read('ecc83-pp.kicad_sch');
    expect(lines(serializeSchematic(readSchematic(parse(src))))).toEqual(lines(src));
  });

  it('every bundled footprint parses', () => {
    const dir = `${DEMO}footprints.pretty/`;
    const files = readdirSync(dir).filter((f) => f.endsWith('.kicad_mod'));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const fp = readFootprintFile(parse(readFileSync(dir + f, 'utf8')));
      expect(fp).toBeTruthy();
    }
  });
});

/** The full upstream demo corpus must parse with our engines, run locally
 * against the reference clone (skipped in CI where the clone is absent). */
describe.skipIf(!existsSync(DEMOS_ROOT))('upstream demo corpus parse sweep', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(`${dir}${e.name}/`) : [`${dir}${e.name}`],
    );
  // Guarded walk: vitest executes skipped suite factories during collection,
  // so this must not touch the filesystem when the clone is absent (CI).
  // The jetson/vme-wren showcase boards are 81/67 MB, parseable, but not
  // worth a minute of every local test run; everything else sweeps.
  const all = existsSync(DEMOS_ROOT)
    ? walk(DEMOS_ROOT).filter((f) => statSync(f).size < 20 * 1024 * 1024)
    : [];
  const schs = all.filter((f) => f.endsWith('.kicad_sch'));
  const pcbs = all.filter((f) => f.endsWith('.kicad_pcb'));

  it(`parses every demo schematic (${schs.length})`, { timeout: 60_000 }, () => {
    for (const f of schs) {
      const sch = readSchematic(parse(readFileSync(f, 'utf8')));
      expect(sch.version, f).toBeGreaterThan(0);
    }
  });

  it(`parses every demo board (${pcbs.length})`, { timeout: 120_000 }, () => {
    for (const f of pcbs) {
      const board = readBoard(parse(readFileSync(f, 'utf8')));
      expect(board.layers.length, f).toBeGreaterThan(0);
    }
  });
});
