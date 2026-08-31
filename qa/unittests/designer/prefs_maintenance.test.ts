// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_MAINTENANCE`'s two live actions (common/dialogs/panel_maintenance.cpp).
 *
 *     onClearFileHistory -> SETTINGS_MANAGER::ClearFileHistory()
 *                           + KIWAY::ClearFileHistory()        (:82-90)
 *     onResetAll         -> SETTINGS_MANAGER::ResetToDefaults() (:138-148)
 *
 * The first clears EVERY app's "Open Recent" list, not the current frame's --
 * that is what the second call is for. The second resets KiCad's settings
 * directory.
 *
 * Both are storage effects, so they are tested against a storage double rather
 * than through the panel: a click test would prove the button is wired and say
 * nothing about which keys go.
 */
import { describe, expect, it } from 'vitest';
import {
  STORAGE_PREFIX,
  clearFileHistory,
  resetAllSettings,
} from '@ziroeda/designer/src/prefs/maintenance.js';

/** Enough of the Storage interface for the two functions under test. */
function fakeStore(entries: Record<string, string>): Storage {
  const map = new Map(Object.entries(entries));
  return {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  } as Storage;
}

const populated = (): Storage =>
  fakeStore({
    [`${STORAGE_PREFIX}.common`]: '{}',
    [`${STORAGE_PREFIX}.eeschema`]: '{}',
    [`${STORAGE_PREFIX}.drawingsheet.recent`]: '[]',
    [`${STORAGE_PREFIX}.bitmap2cmp.recent`]: '[]',
    // Another origin's key. We share localStorage with whatever else is here.
    'some.other.app': 'x',
  });

describe('Clear "Open Recent" History', () => {
  it('clears every app’s history, not one', () => {
    const s = populated();
    expect(clearFileHistory(s)).toBe(2);
    expect(s.getItem(`${STORAGE_PREFIX}.drawingsheet.recent`)).toBeNull();
    expect(s.getItem(`${STORAGE_PREFIX}.bitmap2cmp.recent`)).toBeNull();
  });

  it('leaves the settings themselves alone', () => {
    const s = populated();
    clearFileHistory(s);
    // The histories are separate keys here; upstream they are `system.file_history`
    // inside each settings file, and clearing one must not take the file.
    expect(s.getItem(`${STORAGE_PREFIX}.common`)).toBe('{}');
    expect(s.getItem(`${STORAGE_PREFIX}.eeschema`)).toBe('{}');
  });

  it('is quiet when there is nothing to clear', () => {
    expect(clearFileHistory(fakeStore({ [`${STORAGE_PREFIX}.common`]: '{}' }))).toBe(0);
  });
});

describe('Reset All Program Settings to Defaults', () => {
  it('removes every key this app owns, so each slice falls back to its defaults', () => {
    const s = populated();
    expect(resetAllSettings(s)).toBe(4);
    expect(s.getItem(`${STORAGE_PREFIX}.common`)).toBeNull();
    expect(s.getItem(`${STORAGE_PREFIX}.drawingsheet.recent`)).toBeNull();
  });

  it('does NOT touch keys belonging to anything else on the origin', () => {
    // `ResetToDefaults` resets KiCad's settings directory, not the user's home.
    // `store.clear()` would be the home.
    const s = populated();
    resetAllSettings(s);
    expect(s.getItem('some.other.app')).toBe('x');
  });
});

describe('the prefix', () => {
  it('is asked of sliceStorageKey rather than written again', () => {
    // If the two ever disagree, every key here is the wrong key and both
    // functions silently become no-ops.
    expect(STORAGE_PREFIX).toBe('ziroeda');
  });
});
