// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `TRACE_MANAGER` / `KI_TRACE` / `wxLogTrace` (common/trace_helpers.ts) and
 * `PROF_TIMER` (libs/core/src/profile.ts): the masks come from the browser's
 * environment, `localStorage`, read once as the C++ reads `KICAD_TRACE` once;
 * a message under a mask that is off is never even built.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROF_TIMER } from '@ziroeda/core/src/profile.js';

const store = new Map<string, string>();

beforeEach(() => {
  vi.resetModules();
  store.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function load() {
  return import('@ziroeda/common/trace_helpers.js');
}

describe('TRACE_MANAGER', () => {
  it('KICAD_TRACE lists the masks that print; the message is built only then', async () => {
    store.set('KICAD_TRACE', 'KICAD_GAL_PROFILE,OTHER');
    const t = await load();
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const built = vi.fn(() => 'View timing: 1ms');
    t.KI_TRACE(t.traceGalProfile, built);
    expect(built).toHaveBeenCalledTimes(1);
    expect(debug).toHaveBeenCalledWith(` ${'KICAD_GAL_PROFILE'.padEnd(30)} | View timing: 1ms`);

    const unbuilt = vi.fn(() => 'never');
    t.KI_TRACE(t.traceDrawPanel, unbuilt);
    expect(unbuilt).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledTimes(1);
  });

  it('no KICAD_TRACE at all: every trace is off', async () => {
    const t = await load();
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    t.KI_TRACE(t.traceGalProfile, () => 'x');
    expect(t.TRACE_MANAGER.Instance().IsTraceEnabled(t.traceGalProfile)).toBe(false);
    expect(debug).not.toHaveBeenCalled();
  });

  it('"all" prints every mask', async () => {
    store.set('KICAD_TRACE', 'all');
    const t = await load();
    expect(t.TRACE_MANAGER.Instance().IsTraceEnabled('ANYTHING')).toBe(true);
  });

  it('wxLogTrace reads WXTRACE, not KICAD_TRACE', async () => {
    store.set('KICAD_TRACE', 'KICAD_ALLEGRO_PERF');
    store.set('WXTRACE', 'KICAD_DRAW_PANEL');
    const t = await load();
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    t.wxLogTrace(t.traceAllegroPerf, () => 'no');
    expect(debug).not.toHaveBeenCalled();
    t.wxLogTrace(t.traceDrawPanel, () => 'DoRePaint exception: x');
    expect(debug).toHaveBeenCalledWith('Trace: DoRePaint exception: x');
  });
});

describe('PROF_TIMER', () => {
  it('prints in the unit the C++ picks, named when it has a name', () => {
    // Exact binary fractions, so the ns conversion stays exact
    let now = 1024;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const t = new PROF_TIMER('view-total');
    now = 1024 + 0.0005; // 500 ns
    expect(t.to_string()).toMatch(/^view-total: 500(\.0+\d+)?ns$/);
    now = 1024 + 0.25; // 250 µs
    expect(t.to_string()).toBe('view-total: 250µs');
    now = 1024 + 12.5;
    expect(t.to_string()).toBe('view-total: 12.5ms');
    now = 1024 + 3000;
    expect(t.to_string()).toBe('view-total: 3s');
    expect(new PROF_TIMER().to_string()).toBe('0ns');
  });

  it('msecs( true ) is the time since the last read; Stop freezes it', () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const t = new PROF_TIMER();
    now = 10;
    expect(t.msecs(true)).toBe(10);
    now = 15;
    expect(t.msecs(true)).toBe(5);
    expect(t.msecs()).toBe(15);
    t.Stop();
    now = 100;
    expect(t.msecs()).toBe(15);
  });
});
