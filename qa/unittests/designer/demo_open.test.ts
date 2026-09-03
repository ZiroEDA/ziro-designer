// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The per-file fallback delivers the WHOLE demo.
 *
 * This file used to assert the opposite, and was right to at the time:
 * `isDeferrableDemoFile` held back .step/.stp/.wrl/.glb/.pdf/.bin — 40.7 MB of
 * the CM5 demo's 46 — and `fetchDemoExtras` collected them later, because 89
 * separate requests made fetching everything unaffordable.
 *
 * The bundle removed that reason (see `demo_bundle.test.ts`, which covers the
 * one-request path). Both functions were deleted with it, and the fallback was
 * widened to fetch every file, so that **the two paths deliver the same
 * project** — a demo opened either way is complete, and `saveDemoCopy` has
 * nothing left to finish.
 *
 * So what is asserted here is the property that replaced the split: nothing is
 * withheld. A file that reached the opening set but not the deferred one used
 * to be the silent failure; a file quietly dropped from the fallback is the
 * one now.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { openDemo, type DemoMeta } from '@ziroeda/designer/src/home/demos.js';

/** No `bundleBytes`, so `openDemo` takes the per-file path this file is about. */
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

/** The five that used to be held back, and must not be any more. */
const ONCE_DEFERRED = [
  'connector.step',
  'regulator.stp',
  'legacy.wrl',
  'datasheet.pdf',
  'blob.bin',
];

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

describe('opening a demo without a bundle', () => {
  it('fetches every file the manifest lists, models and datasheet included', async () => {
    const state = serve();

    const files = await openDemo(demo);

    expect(files).toHaveLength(demo.files.length);
    for (const heavy of ONCE_DEFERRED) {
      expect(
        state.urls.some((u) => u.includes(heavy)),
        `${heavy} was NOT fetched; the fallback is withholding files again`,
      ).toBe(true);
    }
  });

  it('names them under the demo’s own folder, in manifest order', async () => {
    serve();
    expect((await openDemo(demo)).map((f) => f.name)).toEqual(
      demo.files.map((f) => `CM5_MINIMA/${f}`),
    );
  });

  it('accounts for every file, so none falls down a gap', async () => {
    // The split this replaces could lose a file between its two halves. One
    // path now, so the check is that the manifest and the result are the same
    // set — the property, not the ordering, which the test above pins.
    serve();
    const got = (await openDemo(demo)).map((f) => f.name.replace('CM5_MINIMA/', ''));
    expect([...got].sort()).toEqual([...demo.files].sort());
  });

  it('fetches them in parallel rather than one round trip at a time', async () => {
    const state = serve();
    await openDemo(demo);
    // `mapLimit(rels, FETCH_CONCURRENCY, …)`; the point is that it is not one.
    expect(state.peak).toBeGreaterThan(1);
  });

  it('opens a design-only demo the same way', async () => {
    serve();
    const light: DemoMeta = { ...demo, files: ['a.kicad_sch', 'b.kicad_pcb'] };
    expect(await openDemo(light)).toHaveLength(2);
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
    expect(files).toHaveLength(demo.files.length - 1);
  });
});
