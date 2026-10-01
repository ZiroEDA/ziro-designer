// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The stored-settings migration reaches the `common` slice.
 *
 * Until v7 `migrateStored` ran `migrateSlice` on `eeschema` alone and then
 * stamped the new version, so `common`'s corrections (v5's dimming factor,
 * v6's centre-on-zoom) never reached a device whose settings live only in
 * localStorage: centre-on-zoom stayed on and the wheel kept zooming on the
 * screen centre.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => void m.delete(k),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
  } as Storage;
}

let saved: Storage;

beforeEach(() => {
  saved = globalThis.localStorage;
  globalThis.localStorage = fakeStorage();
});

afterEach(() => {
  globalThis.localStorage = saved;
  vi.restoreAllMocks();
});

describe('migrateStored and the common slice', { timeout: 60_000 }, () => {
  it('turns off a stored centre-on-zoom on a device stamped 6', async () => {
    localStorage.setItem('ziroeda.settings_version', '6');
    localStorage.setItem('ziroeda.common', JSON.stringify({ input: { center_on_zoom: true } }));
    vi.resetModules();
    const mod = await import('@ziroeda/designer/src/prefs/settings.js');
    const m = new mod.SettingsManager();
    expect(m.common.input.center_on_zoom).toBe(false);
    // ...and it is written back, so the next load does not depend on it again.
    expect(JSON.parse(localStorage.getItem('ziroeda.common') ?? '{}').input.center_on_zoom).toBe(
      false,
    );
    expect(localStorage.getItem('ziroeda.settings_version')).toBe(String(mod.SETTINGS_VERSION));
  });

  it('runs the v5 dimming correction from localStorage as well', async () => {
    localStorage.setItem('ziroeda.settings_version', '4');
    localStorage.setItem(
      'ziroeda.common',
      JSON.stringify({ appearance: { hicontrast_dimming_factor: 80 } }),
    );
    vi.resetModules();
    const mod = await import('@ziroeda/designer/src/prefs/settings.js');
    const m = new mod.SettingsManager();
    expect(m.common.appearance.hicontrast_dimming_factor).toBeCloseTo(0.8, 10);
  });

  it('keeps a centre-on-zoom ticked again after the migration', async () => {
    localStorage.setItem('ziroeda.settings_version', '7');
    localStorage.setItem('ziroeda.common', JSON.stringify({ input: { center_on_zoom: true } }));
    vi.resetModules();
    const mod = await import('@ziroeda/designer/src/prefs/settings.js');
    const m = new mod.SettingsManager();
    expect(m.common.input.center_on_zoom).toBe(true);
  });
});
