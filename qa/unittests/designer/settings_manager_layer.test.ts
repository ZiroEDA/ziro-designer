// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * designer's SettingsManager as a layer over the common SETTINGS_MANAGER: the
 * slices are registered files, kicad.json takes over the project manager's
 * loose keys, and a made colour theme survives a reload.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  LEGACY_KICAD_KEYS,
  migrateKicadSettingsKeys,
  SettingsManager,
  settingsStorageKey,
  SETTINGS_SLICES,
} from '@ziroeda/designer/src/prefs/settings.js';

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

let saved: Storage;
beforeEach(() => {
  saved = globalThis.localStorage;
  globalThis.localStorage = fakeStorage();
});
afterEach(() => {
  globalThis.localStorage = saved;
});

describe('SettingsManager over SETTINGS_MANAGER', () => {
  it('registers every slice as a file of the manager', () => {
    const s = new SettingsManager();
    localStorage.clear();
    s.manager.Save();
    for (const slice of SETTINGS_SLICES)
      expect(localStorage.getItem(settingsStorageKey(slice)), slice).not.toBeNull();
  });

  it('keeps a theme New Theme... made across a reload', () => {
    const a = new SettingsManager();
    a.setUserThemes({
      mine: { name: 'Mine', colors: { 'board.copper.f': '#ff0000' }, override: false },
    });
    const b = new SettingsManager();
    expect(b.userThemes.mine?.name).toBe('Mine');
    expect(b.userThemes.mine?.colors['board.copper.f']).toBe('#ff0000');
  });

  it('saves kicad.json through the manager without stamping a synced slice', () => {
    const a = new SettingsManager();
    let changed = 0;
    a.onSliceChanged = () => changed++;
    a.updateKicad((k) => {
      k.m_LeftWinWidth = 333;
    });
    expect(changed).toBe(0);
    expect(a.stamps.kicad).toBeUndefined();
    expect(new SettingsManager().kicad.m_LeftWinWidth).toBe(333);
  });
});

describe('migrateKicadSettingsKeys', () => {
  it('folds the loose keys into kicad.json and removes them', () => {
    localStorage.setItem(LEGACY_KICAD_KEYS.leftWinWidth, '300');
    localStorage.setItem(LEGACY_KICAD_KEYS.historyShown, '1');
    localStorage.setItem(LEGACY_KICAD_KEYS.recentTemplates, JSON.stringify(['a', 7, 'b']));
    localStorage.setItem(LEGACY_KICAD_KEYS.templateFilter, '2');
    localStorage.setItem(LEGACY_KICAD_KEYS.templateWindowSize, JSON.stringify({ w: 700, h: 500 }));

    const k = new SettingsManager().kicad;
    expect(k.m_LeftWinWidth).toBe(300);
    expect(k.m_ShowHistoryPanel).toBe(true);
    expect(k.m_RecentTemplates).toEqual(['a', 'b']);
    expect(k.m_TemplateFilterChoice).toBe(2);
    expect(k.m_TemplateWindowSize).toEqual({ x: 700, y: 500 });
    for (const key of Object.values(LEGACY_KICAD_KEYS))
      expect(localStorage.getItem(key)).toBeNull();
    expect(migrateKicadSettingsKeys()).toBe(false);
  });

  it('never overwrites a path kicad.json already holds', () => {
    localStorage.setItem(
      settingsStorageKey('kicad'),
      JSON.stringify({ appearance: { left_frame_width: 410 } }),
    );
    localStorage.setItem(LEGACY_KICAD_KEYS.leftWinWidth, '300');
    expect(new SettingsManager().kicad.m_LeftWinWidth).toBe(410);
  });
});
