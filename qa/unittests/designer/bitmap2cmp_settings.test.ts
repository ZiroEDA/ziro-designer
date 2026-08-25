// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `BITMAP2CMP_SETTINGS` — the Image Converter's `bitmap2component.json`.
 *
 * It is a `SETTINGS_LOC::USER` file (`APP_SETTINGS_BASE( "bitmap2component",
 * … )`, bitmap2cmp_settings.cpp:33) and therefore a slice, so the threshold and
 * the negative flag follow the user rather than the browser profile they
 * happened to set them in.
 *
 * **Every assertion below is per field, deliberately.** A settings table is
 * exactly where a whole-object check hides a per-entry bug: one
 * `expect(loaded).toEqual(saved)` passes while `last_mod_layer` is dropped on
 * the floor, because the object it compares was produced by the same broken
 * code on both sides. So each of the seven parameters KiCad registers gets its
 * own case, three times over — its default, its round trip through storage, and
 * its fallback when the stored blob does not mention it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  BITMAP2CMP_DEFAULTS,
  LEGACY_BITMAP2CMP_KEY,
  migrateBitmap2CmpKey,
  SETTINGS_SLICES,
  SETTINGS_VERSION,
  SettingsManager,
  sliceStorageKey,
  type Bitmap2CmpSettings,
} from '@ziroeda/designer/src/prefs/settings.js';
import { syncSettings } from '@ziroeda/designer/src/cloud/settingsSync.js';
import { setCloudBackend } from '@ziroeda/designer/src/cloud/cloudStore.js';
import type { CloudBackend, SettingsRow } from '@ziroeda/designer/src/cloud/backend.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const USER = 'user-1';
const KEY = sliceStorageKey('bitmap2component');

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

/** The account, in memory. Only the settings half is exercised here. */
function fakeBackend(): CloudBackend & { rows: Map<string, SettingsRow> } {
  const rows = new Map<string, SettingsRow>();
  return {
    rows,
    async listProjects() {
      return [];
    },
    async getProject() {
      return null;
    },
    async putProject() {},
    async deleteProject() {},
    async putObject() {},
    async getObject() {
      throw new Error('no objects');
    },
    async hasObject() {
      return false;
    },
    async removeObjects() {},
    async getSettings() {
      return [...rows.values()];
    },
    async putSettings(row) {
      const updated_at = new Date(Date.now()).toISOString();
      rows.set(row.key, {
        key: row.key,
        value: row.value,
        version: row.version,
        updated_at,
      });
      return { updated_at };
    },
  } as CloudBackend & { rows: Map<string, SettingsRow> };
}

beforeEach(() => {
  globalThis.localStorage = fakeStorage();
});

afterEach(() => {
  setCloudBackend(null);
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// The defaults, one case per parameter
// ---------------------------------------------------------------------------

/**
 * The seven `m_params.emplace_back` calls at bitmap2cmp_settings.cpp:42-48,
 * transcribed with their KiCad default. Written out rather than derived from
 * `BITMAP2CMP_DEFAULTS`: an expectation read out of the object it is checking
 * agrees with any object.
 */
const KICAD_DEFAULTS: ReadonlyArray<[keyof Bitmap2CmpSettings, string | number | boolean]> = [
  ['bitmap_file_name', ''], // :42  PARAM<wxString>( "bitmap_file_name", …, "" )
  ['converted_file_name', ''], // :43  PARAM<wxString>( "converted_file_name", …, "" )
  ['units', 0], // :44  PARAM<int>( "units", …, 0 )
  ['threshold', 50], // :45  PARAM<int>( "threshold", …, 50 )
  ['negative', false], // :46  PARAM<bool>( "negative", …, false )
  ['last_format', 0], // :47  PARAM<int>( "last_format", …, 0 )
  ['last_mod_layer', 0], // :48  PARAM<int>( "last_mod_layer", …, 0 )
];

describe('the defaults are KiCad’s', () => {
  it.each(KICAD_DEFAULTS)('%s defaults to %o', (field, value) => {
    expect(BITMAP2CMP_DEFAULTS[field]).toBe(value);
  });

  it('registers exactly those seven parameters and no invented ones', () => {
    expect(Object.keys(BITMAP2CMP_DEFAULTS).sort()).toEqual(
      KICAD_DEFAULTS.map(([k]) => k as string).sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// Round trip, one case per parameter
// ---------------------------------------------------------------------------

/**
 * A value for each field that is *not* its default, so a field that is silently
 * dropped reverts and the case fails. `units: 2` is DPI, `last_format: 3` is
 * POSTSCRIPT_FMT and `last_mod_layer: 7` is F.Fab — all in range, so nothing
 * here can be rejected as damage by `deepMerge` for a reason unrelated to the
 * bug being hunted.
 */
const CHANGED: ReadonlyArray<[keyof Bitmap2CmpSettings, string | number | boolean]> = [
  ['bitmap_file_name', 'logo.png'],
  ['converted_file_name', 'LOGO.kicad_mod'],
  ['units', 2],
  ['threshold', 73],
  ['negative', true],
  ['last_format', 3],
  ['last_mod_layer', 7],
];

describe('a field survives the reload it is set in', () => {
  it.each(CHANGED)('%s', (field, value) => {
    const a = new SettingsManager();
    a.updateBitmap2Cmp((s) => {
      (s as Record<string, unknown>)[field] = value;
    });
    // A new manager over the same storage: the tab was reloaded.
    expect(new SettingsManager().bitmap2cmp[field]).toBe(value);
  });
});

describe('a field the stored blob omits falls back to KiCad’s default', () => {
  it.each(KICAD_DEFAULTS)('%s', (field, value) => {
    // Everything else present, this one absent — the shape a settings file
    // written by an older build has. It must not come back as 0, '' or
    // undefined unless that is what KiCad says.
    const stored: Record<string, unknown> = {};
    for (const [k, v] of CHANGED) if (k !== field) stored[k] = v;
    localStorage.setItem(KEY, JSON.stringify(stored));

    expect(new SettingsManager().bitmap2cmp[field]).toBe(value);
  });

  it('an empty blob gives every default back', () => {
    localStorage.setItem(KEY, '{}');
    expect(new SettingsManager().bitmap2cmp).toEqual(BITMAP2CMP_DEFAULTS);
  });

  it('an unparsable blob gives every default back rather than throwing', () => {
    localStorage.setItem(KEY, 'not json');
    expect(new SettingsManager().bitmap2cmp).toEqual(BITMAP2CMP_DEFAULTS);
  });
});

// ---------------------------------------------------------------------------
// The account
// ---------------------------------------------------------------------------

describe('it follows the account', () => {
  it('is one of the slices the sync iterates', () => {
    // Named, not `SETTINGS_SLICES.includes(SETTINGS_SLICES[n])`. The string is
    // KiCad's settings-file basename, which is why it is not `bitmap2cmp`.
    expect([...SETTINGS_SLICES]).toContain('bitmap2component');
    expect(KEY).toBe('ziroeda.bitmap2component');
  });

  it.each(CHANGED)('carries %s to another device', async (field, value) => {
    const be = fakeBackend();
    setCloudBackend(be);

    const a = new SettingsManager();
    a.updateBitmap2Cmp((s) => {
      (s as Record<string, unknown>)[field] = value;
    });
    const up = await syncSettings(USER, { manager: a });
    expect(up.error).toBeUndefined();
    expect(up.pushed).toContain('bitmap2component');

    // A different browser profile: empty storage, defaults everywhere.
    globalThis.localStorage = fakeStorage();
    const b = new SettingsManager();
    expect(b.bitmap2cmp[field]).toBe(BITMAP2CMP_DEFAULTS[field]);

    const down = await syncSettings(USER, { manager: b });
    expect(down.pulled).toContain('bitmap2component');
    expect(b.bitmap2cmp[field]).toBe(value);
    // And it survives that device reloading, not just this object.
    expect(new SettingsManager().bitmap2cmp[field]).toBe(value);
  });

  it('the row it writes is a faithful bitmap2component.json', async () => {
    const be = fakeBackend();
    setCloudBackend(be);
    const a = new SettingsManager();
    a.updateBitmap2Cmp((s) => {
      s.threshold = 73;
    });
    await syncSettings(USER, { manager: a });
    const row = be.rows.get('bitmap2component')!;
    expect(row.version).toBe(SETTINGS_VERSION);
    // No sync bookkeeping smuggled into the settings object: the stamps are a
    // separate key precisely so this stays readable as KiCad's own file.
    expect(Object.keys(row.value as object).sort()).toEqual(
      KICAD_DEFAULTS.map(([k]) => k as string).sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// What deliberately does NOT follow the account
// ---------------------------------------------------------------------------

describe('the recent-images history stays on this device', () => {
  it('is not a slice, so nothing pushes it', () => {
    // `SETTINGS_MANAGER::ResetToDefaults` (settings_manager.cpp:106-124) lifts
    // `system.file_history` out, resets everything else, and puts the history
    // back — upstream saying the history is not one of the settings. Ours
    // additionally holds image bytes, so a synced one would be up to ~13 MB of
    // base64 in a jsonb column on a 1.2 s debounce.
    for (const slice of SETTINGS_SLICES) {
      expect(sliceStorageKey(slice)).not.toBe('ziroeda.bitmap2cmp.recent');
    }
  });

  it('a push does not carry it, and a pull does not clear it', async () => {
    const be = fakeBackend();
    setCloudBackend(be);
    localStorage.setItem('ziroeda.bitmap2cmp.recent', '[{"name":"a.png","data":"data:,x"}]');

    const a = new SettingsManager();
    a.updateBitmap2Cmp((s) => {
      s.threshold = 73;
    });
    await syncSettings(USER, { manager: a });

    for (const row of be.rows.values())
      expect(JSON.stringify(row.value)).not.toContain('a.png');
    expect(localStorage.getItem('ziroeda.bitmap2cmp.recent')).toContain('a.png');
  });
});

// ---------------------------------------------------------------------------
// The migration
// ---------------------------------------------------------------------------

describe('settings stored under the old key are not stranded', () => {
  const OLD = JSON.stringify({ threshold: 73, negative: true, units: 2, last_mod_layer: 7 });

  it('moves the value onto the slice key', () => {
    localStorage.setItem(LEGACY_BITMAP2CMP_KEY, OLD);
    expect(migrateBitmap2CmpKey()).toBe(true);
    expect(localStorage.getItem(KEY)).toBe(OLD);
  });

  it('and the manager then reads every one of those fields back', () => {
    localStorage.setItem(LEGACY_BITMAP2CMP_KEY, OLD);
    migrateBitmap2CmpKey();
    const s = new SettingsManager().bitmap2cmp;
    // Per field again: a migration that moved the blob but lost a key inside it
    // would pass a check on the blob.
    expect(s.threshold).toBe(73);
    expect(s.negative).toBe(true);
    expect(s.units).toBe(2);
    expect(s.last_mod_layer).toBe(7);
    // Untouched by the old build, so still KiCad's default rather than absent.
    expect(s.last_format).toBe(0);
    expect(s.bitmap_file_name).toBe('');
  });

  it('removes the old key, so it cannot resurrect a stale value later', () => {
    localStorage.setItem(LEGACY_BITMAP2CMP_KEY, OLD);
    migrateBitmap2CmpKey();
    expect(localStorage.getItem(LEGACY_BITMAP2CMP_KEY)).toBeNull();
  });

  it('is idempotent, and a second run reports nothing to do', () => {
    localStorage.setItem(LEGACY_BITMAP2CMP_KEY, OLD);
    expect(migrateBitmap2CmpKey()).toBe(true);
    expect(migrateBitmap2CmpKey()).toBe(false);
    expect(localStorage.getItem(KEY)).toBe(OLD);
  });

  it('never overwrites a value already on the slice key', () => {
    // The order that matters: this device pulled the account's copy, then a
    // stale old-key blob turned up. The account's copy is the newer of the two
    // and the migration must not undo it.
    const NEWER = JSON.stringify({ threshold: 11 });
    localStorage.setItem(KEY, NEWER);
    localStorage.setItem(LEGACY_BITMAP2CMP_KEY, OLD);
    migrateBitmap2CmpKey();
    expect(localStorage.getItem(KEY)).toBe(NEWER);
    expect(localStorage.getItem(LEGACY_BITMAP2CMP_KEY)).toBeNull();
  });

  it('does nothing at all when there is no old key', () => {
    expect(migrateBitmap2CmpKey()).toBe(false);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('runs from the version stamp, so an existing user gets it once', () => {
    // `migrateStored()` is module scope and has already run against whatever
    // storage was in place at import; the gate itself is what is checked here.
    // v3 is the version that introduced the rename.
    expect(SETTINGS_VERSION).toBeGreaterThanOrEqual(3);
    const SRC = readFileSync(
      fileURLToPath(new URL('../../../designer/src/prefs/settings.ts', import.meta.url)),
      'utf8',
    );
    expect(SRC).toContain('if (from < 3) migrateBitmap2CmpKey();');
  });
});

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

describe('the editor reads and writes the slice, not a private key', () => {
  const SRC = readFileSync(
    fileURLToPath(
      new URL('../../../designer/src/editors/image/bitmap2cmpSettings.ts', import.meta.url),
    ),
    'utf8',
  );

  it('has no localStorage of its own for the settings', () => {
    // The whole point: a private key here is a settings file that cannot follow
    // the account, and it would fail silently — the preference simply stops
    // travelling. The history's key is the one localStorage string that may
    // remain.
    const keys = [...SRC.matchAll(/'(ziroeda\.[a-z0-9_.]+)'/g)].map((m) => m[1]);
    expect(keys).toEqual(['ziroeda.bitmap2cmp.recent']);
  });

  it('goes through the manager in both directions', () => {
    expect(SRC).toContain('settings.bitmap2cmp');
    expect(SRC).toContain('settings.updateBitmap2Cmp');
  });
});
