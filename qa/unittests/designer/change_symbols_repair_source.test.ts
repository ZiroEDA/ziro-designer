// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Update Symbols from Library must compare against the LIBRARY.
 *
 * `DIALOG_CHANGE_SYMBOLS::processSymbols` resolves every lib_id through the
 * symbol library table, not through the screen. The schematic's `lib_symbols`
 * block is what the command exists to correct, so it cannot also be the
 * authority on what correct means.
 *
 * WHAT THIS CAUGHT. The editor passed its `hierarchyLibs`, and that map begins
 * as `new Map(doc.libSymbols.map((l) => [l.libId, l]))` — the cache itself. So
 * every symbol was compared against a copy of itself and the command reported
 * "no changes" whatever was wrong. A user hit it on a schematic written before
 * placements were flattened: its cached `Diode:1N4007` had `extends` and no
 * body, the hosted library had the real part, and the one command that repairs
 * exactly that did nothing at all.
 *
 * WHY NOTHING FAILED. `change_symbols.test.ts` and
 * `derived_symbol_roundtrip.test.ts` both HAND `changeSymbols` a good library,
 * so they proved the engine and never the wiring. Nothing anywhere asserted
 * where the app's map comes from — the "a value nothing reads" shape, one level
 * up: a parameter nothing supplied honestly. This file pins that seam.
 */
import { describe, expect, it, vi } from 'vitest';
import { repairSourceLibs } from '@ziroeda/designer/src/editors/schematic/symbols/repair_source.js';
import type { LibSymbol } from '@ziroeda/eeschema';

/** A derived symbol as the old writer cached it: `extends`, and no geometry. */
const broken = (): LibSymbol =>
  ({ libId: 'Diode:1N4007', extends: '1N4001', units: [], properties: [] }) as unknown as LibSymbol;

/** The same part as the library actually holds it: flattened, with a body. */
const fixed = (): LibSymbol =>
  ({
    libId: '1N4007',
    units: [{ name: '1N4007_0_1', unit: 0, bodyStyle: 1, graphics: [{}, {}, {}], pins: [] }],
    properties: [],
  }) as unknown as LibSymbol;

describe('the parts Update Symbols from Library compares against', () => {
  it('come from the library, not from the document cache', async () => {
    const cache = new Map([['Diode:1N4007', broken()]]);
    const load = vi.fn(async () => fixed());

    const libs = await repairSourceLibs(['Diode:1N4007'], load, cache);

    expect(load).toHaveBeenCalledWith('Diode', '1N4007');
    expect(libs.get('Diode:1N4007')!.extends).toBeUndefined();
    expect(libs.get('Diode:1N4007')!.units).toHaveLength(1);
  });

  // The bug, stated as the property that failed: handing back the cache is not
  // a repair source. Without this, a mutant that returns `fallback` unchanged
  // passes every other assertion in this file.
  it('so a bodyless cached symbol is never what comes back', async () => {
    const cache = new Map([['Diode:1N4007', broken()]]);
    const libs = await repairSourceLibs(['Diode:1N4007'], async () => fixed(), cache);
    expect(libs.get('Diode:1N4007')).not.toBe(cache.get('Diode:1N4007'));
  });

  it('keeps the cached copy when the library no longer has the part', async () => {
    // Upstream reports this as "not found in any library" rather than emptying
    // the placement, which it can only do if the cached part survives.
    const cache = new Map([['Diode:GONE', broken()]]);
    const libs = await repairSourceLibs(['Diode:GONE'], async () => undefined, cache);
    expect(libs.get('Diode:GONE')).toBe(cache.get('Diode:GONE'));
  });

  it('keeps it when the library throws, too', async () => {
    const cache = new Map([['Diode:1N4007', broken()]]);
    const libs = await repairSourceLibs(
      ['Diode:1N4007'],
      async () => {
        throw new Error('offline');
      },
      cache,
    );
    expect(libs.get('Diode:1N4007')).toBe(cache.get('Diode:1N4007'));
  });

  it('asks the library once per distinct lib_id, however many are placed', async () => {
    const load = vi.fn(async () => fixed());
    await repairSourceLibs(['Diode:1N4007', 'Diode:1N4007', 'Diode:1N4007'], load, new Map());
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('does not ask for an unqualified id, which names no library', async () => {
    const load = vi.fn(async () => fixed());
    await repairSourceLibs(['NoLibraryHere'], load, new Map());
    expect(load).not.toHaveBeenCalled();
  });
});
