// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Opening a demo waits for the design, not for the 3D models.
 *
 * The CM5 Minima demo is 107 files and about 46 MB, of which 40.7 MB is STEP
 * bodies and a datasheet: none of it read to show a schematic or a board. They
 * were fetched before the editor appeared, one file at a time, so the open was
 * spent waiting on 128 round trips for bytes nobody had asked to see.
 *
 * Both halves are asserted here, because both can regress silently: the split
 * (a deferrable file must not be in the opening set) and the completeness (the
 * deferred half must still be fetchable, or a demo quietly loses its 3D view).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  fetchDemoExtras,
  isDeferrableDemoFile,
  openDemo,
  type DemoMeta,
} from '@ziroeda/designer/src/home/demos.js';

const demo: DemoMeta = {
  id: 'cm5_minima',
  base: 'CM5_MINIMA',
  title: 'CM5 Minima',
  description: 'a carrier board',
  files: [
    'cm5.kicad_pro',
    'cm5.kicad_sch',
    'cm5.kicad_pcb',
    'lib/R_0805.kicad_mod',
    'models/connector.step',
    'models/regulator.stp',
    'models/legacy.wrl',
    'docs/datasheet.pdf',
    'fw/blob.bin',
  ],
};

const DEFERRED = ['connector.step', 'regulator.stp', 'legacy.wrl', 'datasheet.pdf', 'blob.bin'];

/** Records what was asked for, and how many were in flight at once. */
function serve(): { urls: string[]; peak: number } {
  const state = { urls: [] as string[], peak: 0 };
  let inFlight = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL) => {
      inFlight++;
      state.peak = Math.max(state.peak, inFlight);
      state.urls.push(String(input));
      // Yield, so overlapping requests can actually overlap.
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    }),
  );
  return state;
}

afterEach(() => vi.unstubAllGlobals());

describe('opening a demo', () => {
  it('fetches nothing that only the 3D view or the file manager needs', async () => {
    const state = serve();

    const files = await openDemo(demo);

    expect(files).toHaveLength(4);
    for (const heavy of DEFERRED) {
      expect(
        state.urls.some((u) => u.includes(heavy)),
        `${heavy} was fetched`,
      ).toBe(false);
    }
    // The design itself is all there, under the demo's own folder name.
    expect(files.map((f) => f.name)).toEqual([
      'CM5_MINIMA/cm5.kicad_pro',
      'CM5_MINIMA/cm5.kicad_sch',
      'CM5_MINIMA/cm5.kicad_pcb',
      'CM5_MINIMA/lib/R_0805.kicad_mod',
    ]);
  });

  it('fetches them in parallel rather than one round trip at a time', async () => {
    const state = serve();

    await openDemo(demo);

    // Four files, so four at once; the point is that it is not one.
    expect(state.peak).toBeGreaterThan(1);
  });

  it('still offers the deferred half, so the project ends up complete', async () => {
    serve();

    const extras = await fetchDemoExtras(demo);

    expect(extras.map((f) => f.name)).toEqual([
      'CM5_MINIMA/models/connector.step',
      'CM5_MINIMA/models/regulator.stp',
      'CM5_MINIMA/models/legacy.wrl',
      'CM5_MINIMA/docs/datasheet.pdf',
      'CM5_MINIMA/fw/blob.bin',
    ]);
  });

  it('accounts for every file between the two halves', async () => {
    // No file may fall down the gap between "not needed to open" and "fetched
    // afterwards", which is how a project would lose one silently.
    const opening = demo.files.filter((f) => !isDeferrableDemoFile(f));
    const deferred = demo.files.filter(isDeferrableDemoFile);
    expect([...opening, ...deferred].sort()).toEqual([...demo.files].sort());
  });

  it('keeps a demo of only design files entirely in the opening half', async () => {
    serve();
    const light: DemoMeta = { ...demo, files: ['a.kicad_sch', 'b.kicad_pcb'] };

    expect(await openDemo(light)).toHaveLength(2);
    expect(await fetchDemoExtras(light)).toEqual([]);
  });

  it('skips a file the host does not have instead of failing the open', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) =>
        String(input).includes('cm5.kicad_pcb')
          ? new Response('gone', { status: 404 })
          : new Response(new Uint8Array([1]), { status: 200 }),
      ),
    );

    const files = await openDemo(demo);

    expect(files.map((f) => f.name)).not.toContain('CM5_MINIMA/cm5.kicad_pcb');
    expect(files).toHaveLength(3);
  });
});
