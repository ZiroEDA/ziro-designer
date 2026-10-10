// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The EasyEDA Std schematic importer against real eeschema 10.0.6.
 *
 * `watch.json` is KiCad's own qa/data/pcbnew/plugins/easyeda/"SCH_ESP32-PICO-D4
 * smart watch_2023-09-02.json", unedited. `watch.kicad_sch` is what eeschema wrote
 * after File > Import > Non-KiCad Schematic... on it and File > Save
 * (qa/probes/schio_oracle/oracle.sh). Ours goes through the same importFile arm
 * (import_arm.ts) and the same writer, and every top-level item must match.
 *
 * Two differences are set aside, each by name:
 *
 * - **an instance's `(pin ...)` order.** The writer prints `GetRawPins()`, which a
 *   freshly placed symbol fills from `std::set<SCH_PIN*> unassignedLibPins` in
 *   `SCH_SYMBOL::UpdatePins` (sch_symbol.cpp:398): pointer order, i.e. wherever
 *   the heap put the flattened copy's pins. The file lists CH9102F's pins 1..25
 *   and eeschema wrote 2, 1, 4, 5, 9... Ours iterates in library order. The SET
 *   of pins must still match.
 * - **the embedded SVG logo.** `Pimage` with image/svg+xml goes through
 *   SVG_IMPORT_PLUGIN into GRAPHICS_IMPORTER_LIB_SYMBOL, whose port still yields
 *   plain records, not live SCH_SHAPEs; the importer skips it with a warning. The
 *   only items allowed missing are that logo's blue (85 136 255) polylines, and
 *   their exact count is pinned so the day it is imported this test says so.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { importThroughFrame, SCH_FILE_T, topLevelItems } from './import_arm.js';

const DIR = resolve(__dirname, '../../../data/eeschema/import_oracle/easyeda');

/** The SVG logo's polylines eeschema imported and we do not: the nine blue ones in watch.kicad_sch. */
const SKIPPED_SVG_POLYLINES = 9;

/** An instance's `(pin "n" (uuid U))` lines, sorted: their order is heap order upstream. */
function pinsAsSet(aItem: string): string {
  if (!aItem.startsWith('\t(symbol')) return aItem;
  const re = /\n\t\t\(pin "[^"]*"\n\t\t\t\(uuid U\)\n\t\t\)/g;
  const pins = aItem.match(re) ?? [];
  return aItem.replace(re, '') + [...pins].sort().join('');
}

/** `(lib_symbols ...)`'s drawn items, one string per `\t\t\t\t(...)` block. */
function libGraphics(aLibSymbols: string): string[] {
  const out: string[] = [];
  let cur: string[] | null = null;
  for (const ln of aLibSymbols.split('\n')) {
    if (/^\t{4}\(/.test(ln)) {
      if (cur) out.push(cur.join('\n'));
      cur = [ln];
    } else if (/^\t{0,3}[()]/.test(ln)) {
      if (cur) out.push(cur.join('\n'));
      cur = null;
    } else if (cur) cur.push(ln);
  }
  if (cur) out.push(cur.join('\n'));
  return out;
}

/** a - b as multisets. */
function minus(a: readonly string[], b: readonly string[]): string[] {
  const left = new Map<string, number>();
  for (const x of b) left.set(x, (left.get(x) ?? 0) + 1);
  const out: string[] = [];
  for (const x of a) {
    const n = left.get(x) ?? 0;
    if (n > 0) left.set(x, n - 1);
    else out.push(x);
  }
  return out;
}

function expectSameAsEeschema(aName: string): void {
  const ours = topLevelItems(
    importThroughFrame(join(DIR, `${aName}.json`), SCH_FILE_T.SCH_EASYEDA),
  ).map(pinsAsSet);
  const kicad = topLevelItems(readFileSync(join(DIR, `${aName}.kicad_sch`), 'utf8')).map(pinsAsSet);

  const isLib = (s: string) => s.startsWith('\t(lib_symbols');
  expect(
    minus(
      ours.filter((s) => !isLib(s)),
      kicad.filter((s) => !isLib(s)),
    ),
  ).toEqual([]);
  expect(
    minus(
      kicad.filter((s) => !isLib(s)),
      ours.filter((s) => !isLib(s)),
    ),
  ).toEqual([]);

  const ourLib = libGraphics(ours.find(isLib)!);
  const kicadLib = libGraphics(kicad.find(isLib)!);
  expect(minus(ourLib, kicadLib)).toEqual([]);

  const missing = minus(kicadLib, ourLib);
  expect(
    missing.every((g) => g.startsWith('\t\t\t\t(polyline') && g.includes('(color 85 136 255 1)')),
  ).toBe(true);
  expect(missing).toHaveLength(SKIPPED_SVG_POLYLINES);
}

describe('SCH_IO_EASYEDA against eeschema 10.0.6', () => {
  beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
  afterEach(() => SetPgm(null));

  it('imports the smart-watch schematic item for item as eeschema saved it', () => {
    expectSameAsEeschema('watch');
  });

  // The sample has only angle-0 net labels, three flag styles and no net port. The
  // variant is the same file with every `N` label's angle and alignment cycled and
  // every `F` flag cycled through the other styles (netPort included) and angles;
  // watch_variants.kicad_sch is eeschema's import of it, not ours.
  it('imports rotated net labels and every power-flag style as eeschema does', () => {
    expectSameAsEeschema('watch_variants');
  });
});
