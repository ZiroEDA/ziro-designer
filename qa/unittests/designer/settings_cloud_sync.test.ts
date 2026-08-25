// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Settings following the account rather than the browser.
 *
 * `SETTINGS_MANAGER` writes each settings file to a path under
 * `SETTINGS_LOC::USER` (settings_manager.cpp:190-209) and stops there, because
 * upstream is one machine with one home directory. The reconciliation is ours;
 * the version discipline is upstream's and is pinned below in both directions —
 * a row older than this build is migrated on the way in
 * (`JSON_SETTINGS::Migrate`, json_settings.cpp:714-750), a row newer than this
 * build is read and never written over (`m_isFutureFormat`,
 * json_settings.cpp:323-330, gating `ShouldAutoSave()`, project_file.h:158).
 *
 * The three things a settings sync can get wrong, all of which have a test:
 * losing a preference on the round trip, an idle device pushing stale values
 * over a newer device's, and throwing when the account has no table for it yet.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  SettingsManager,
  SETTINGS_SLICES,
  SETTINGS_VERSION,
  sliceStorageKey,
  normalizeUserColors,
  type SettingsSlice,
} from '@ziroeda/designer/src/prefs/settings.js';
import {
  decideSlice,
  installSettingsSync,
  isMissingSettingsTable,
  resetSettingsSyncWarning,
  SETTINGS_PUSH_DEBOUNCE_MS,
  syncSettings,
} from '@ziroeda/designer/src/cloud/settingsSync.js';
import { setCloudBackend } from '@ziroeda/designer/src/cloud/cloudStore.js';
import type { CloudBackend, SettingsRow } from '@ziroeda/designer/src/cloud/backend.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const USER = 'user-1';

/** An in-memory Storage, so no test touches a real localStorage. */
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

interface Fake extends CloudBackend {
  rows: Map<string, SettingsRow>;
  /** The account's clock. Advanced explicitly so orderings are not wall-clock. */
  now: number;
  /** Reject every settings call with this message. */
  failWith: string | null;
  writes: string[];
  /** Seed a row as if another device had written it. */
  seed(key: string, value: unknown, at: number, version?: number): void;
}

function fake(): Fake {
  const refuse = (): never => {
    throw new Error(f.failWith ?? 'refused');
  };
  const f: Fake = {
    rows: new Map(),
    now: 1_000,
    failWith: null,
    writes: [],
    seed(key, value, at, version = SETTINGS_VERSION) {
      f.rows.set(key, { key, value, version, updated_at: new Date(at).toISOString() });
    },
    // The project half of the interface is not exercised here; it exists so the
    // fake is a CloudBackend and the settings methods hang off the same seam
    // the app installs.
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
      if (f.failWith) refuse();
      return [...f.rows.values()];
    },
    async putSettings(row) {
      if (f.failWith) refuse();
      f.writes.push(row.key);
      const updated_at = new Date(f.now).toISOString();
      f.rows.set(row.key, {
        key: row.key,
        value: row.value,
        version: row.version,
        updated_at,
      });
      return { updated_at };
    },
  };
  return f;
}

let be: Fake;

beforeEach(() => {
  globalThis.localStorage = fakeStorage();
  be = fake();
  setCloudBackend(be);
  resetSettingsSyncWarning();
  // `installSettingsSync` debounces on a timer, and a debounce verified by
  // sleeping is a wall-clock assertion that flakes under load. `Date.now` is
  // left alone: the stamps have to keep advancing.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  vi.useRealTimers();
  setCloudBackend(null);
  vi.restoreAllMocks();
});

/** A manager on its own storage — a different browser, or the same one wiped. */
function freshDevice(): SettingsManager {
  globalThis.localStorage = fakeStorage();
  return new SettingsManager();
}

// ---------------------------------------------------------------------------
// The rule itself
// ---------------------------------------------------------------------------

describe('decideSlice — the conflict rule, stated once', () => {
  it('pushes a slice this device edited when the account has none', () => {
    expect(decideSlice({ updatedAt: 5 }, undefined)).toBe('push');
  });

  it('does nothing for a slice this device has never touched', () => {
    // No stamp: nothing to diverge from. `hasDivergedLocally`'s rule
    // (projectStore.ts:1118-1121) — treating a never-synced record as diverged
    // forks everything the first time anyone signs in.
    expect(decideSlice(undefined, undefined)).toBe('none');
  });

  it('pulls onto a device that has never edited the slice', () => {
    expect(decideSlice(undefined, { updatedAt: 9, version: SETTINGS_VERSION })).toBe('pull');
  });

  it('pulls when this device has not edited since the two sides agreed', () => {
    const local = { updatedAt: 5, syncedAt: 5, cloudAt: 100 };
    expect(decideSlice(local, { updatedAt: 200, version: SETTINGS_VERSION })).toBe('pull');
  });

  it('does nothing when neither side has moved since they agreed', () => {
    const local = { updatedAt: 5, syncedAt: 5, cloudAt: 100 };
    expect(decideSlice(local, { updatedAt: 100, version: SETTINGS_VERSION })).toBe('none');
  });

  it('pushes when only this device has moved', () => {
    const local = { updatedAt: 9, syncedAt: 5, cloudAt: 100 };
    expect(decideSlice(local, { updatedAt: 100, version: SETTINGS_VERSION })).toBe('push');
  });

  it('resolves a genuine conflict in favour of the later edit — either way round', () => {
    // Both sides edited since they agreed at cloudAt=100. This is the only
    // place the rule can pick wrong, and the only cross-clock comparison.
    const older = { updatedAt: 150, syncedAt: 5, cloudAt: 100 };
    expect(decideSlice(older, { updatedAt: 300, version: SETTINGS_VERSION })).toBe('pull');

    const newer = { updatedAt: 400, syncedAt: 5, cloudAt: 100 };
    expect(decideSlice(newer, { updatedAt: 300, version: SETTINGS_VERSION })).toBe('push');
  });

  it('keeps the local copy on a tie', () => {
    const local = { updatedAt: 300, syncedAt: 5, cloudAt: 100 };
    expect(decideSlice(local, { updatedAt: 300, version: SETTINGS_VERSION })).toBe('push');
  });

  it('reads a row from a newer build but never writes over it', () => {
    // m_isFutureFormat (json_settings.cpp:323-330) gates ShouldAutoSave()
    // (project_file.h:158): the parameters this build understands are loaded,
    // and the file is never saved.
    const untouched = { updatedAt: 5, syncedAt: 5, cloudAt: 1 };
    expect(decideSlice(untouched, { updatedAt: 900, version: SETTINGS_VERSION + 1 })).toBe('pull');

    const edited = { updatedAt: 50, syncedAt: 5, cloudAt: 1 };
    expect(decideSlice(edited, { updatedAt: 900, version: SETTINGS_VERSION + 1 })).toBe('none');
  });

  it('still pushes to a row from an OLDER build', () => {
    // The future-format refusal must be a > test, not a != one: a device that
    // has not been opened since the last schema bump wrote every row, and
    // refusing to update those would freeze the account.
    const edited = { updatedAt: 50, syncedAt: 5, cloudAt: 900 };
    expect(decideSlice(edited, { updatedAt: 900, version: SETTINGS_VERSION - 1 })).toBe('push');
  });
});

// ---------------------------------------------------------------------------
// Round trip
// ---------------------------------------------------------------------------

describe('the same workspace on another device', () => {
  it('carries every slice up and back down', async () => {
    const a = new SettingsManager();
    a.updateCommon((s) => {
      s.system.language = 'Deutsch';
      s.input.zoom_speed = 7;
    });
    a.updateEeschema((s) => {
      s.appearance.show_hidden_pins = true;
    });
    a.updatePcbnew((s) => {
      s.printing.scale = 2.5;
    });
    a.updatePlEditor((s) => {
      // The complaint this whole feature answers: mm/mils resetting.
      s.system.units = 'mm';
    });
    a.updatePrivacy((s) => {
      s.crash_reports = false;
    });
    a.setUserColors({ wire: 'rgb(1, 2, 3)' });
    a.setHotkeys({ 'eeschema.save': 'Ctrl+Alt+S' });

    const up = await syncSettings(USER, { manager: a });
    expect(up.error).toBeUndefined();
    expect([...up.pushed].sort()).toEqual([...SETTINGS_SLICES].sort());

    // A different browser: empty storage, defaults everywhere.
    const b = freshDevice();
    expect(b.plEditor.system.units).toBe('mils');

    be.now = 5_000;
    const down = await syncSettings(USER, { manager: b });
    expect(down.error).toBeUndefined();
    expect([...down.pulled].sort()).toEqual([...SETTINGS_SLICES].sort());

    expect(b.common.system.language).toBe('Deutsch');
    expect(b.common.input.zoom_speed).toBe(7);
    expect(b.eeschema.appearance.show_hidden_pins).toBe(true);
    expect(b.pcbnew.printing.scale).toBe(2.5);
    expect(b.plEditor.system.units).toBe('mm');
    expect(b.privacy.crash_reports).toBe(false);
    expect(b.userColors).toEqual({ wire: 'rgb(1, 2, 3)' });
    expect(b.hotkeys).toEqual({ 'eeschema.save': 'Ctrl+Alt+S' });
  });

  it('a pull survives the device reloading', async () => {
    const a = new SettingsManager();
    a.updatePlEditor((s) => {
      s.system.units = 'mm';
    });
    await syncSettings(USER, { manager: a });

    const b = freshDevice();
    await syncSettings(USER, { manager: b });
    // A pull that only reached memory would be lost on the next reload, which
    // is the bug this whole feature exists to fix, one layer down.
    const reloaded = new SettingsManager();
    expect(reloaded.plEditor.system.units).toBe('mm');
  });

  it('a pulled device pushes nothing back and agrees afterwards', async () => {
    const a = new SettingsManager();
    a.updateCommon((s) => {
      s.input.zoom_speed = 4;
    });
    await syncSettings(USER, { manager: a });

    const b = freshDevice();
    be.writes.length = 0;
    await syncSettings(USER, { manager: b });
    expect(be.writes).toEqual([]);

    // And a second reconcile is a no-op: the watermarks landed.
    const again = await syncSettings(USER, { manager: b });
    expect(again.pulled).toEqual([]);
    expect(again.pushed).toEqual([]);
  });

  it('a debounced push sends only the slice that was edited', async () => {
    // `only` restricts the writes to what the debounce timer collected. Two
    // slices have to be dirty for this to mean anything: with one dirty slice
    // the filter is indistinguishable from no filter, and the mutation sweep
    // found exactly that hole in the test below it.
    const a = new SettingsManager();
    a.updateCommon((s) => {
      s.input.zoom_speed = 3;
    });
    a.updatePcbnew((s) => {
      s.printing.mirror = true;
    });

    be.writes.length = 0;
    const r = await syncSettings(USER, { manager: a, only: ['common'] });
    expect(be.writes).toEqual(['common']);
    expect(r.pushed).toEqual(['common']);

    // And the one held back is still dirty, so the next pass carries it.
    const next = await syncSettings(USER, { manager: a });
    expect(next.pushed).toEqual(['pcbnew']);
  });
});

// ---------------------------------------------------------------------------
// Two devices that disagree
// ---------------------------------------------------------------------------

describe('two devices, one stale', () => {
  it('an idle device pushes nothing at all', async () => {
    const a = new SettingsManager();
    a.updateCommon((s) => {
      s.input.zoom_speed = 3;
    });
    await syncSettings(USER, { manager: a });

    // Another device changes six other files. This one has touched none of
    // them since it agreed, so it writes nothing and takes all six.
    for (const key of ['eeschema', 'pcbnew', 'pl_editor', 'privacy', 'colors.user', 'hotkeys'])
      be.seed(key, {}, 9_000);

    be.writes.length = 0;
    const r = await syncSettings(USER, { manager: a });
    expect(be.writes).toEqual([]);
    expect(r.pushed).toEqual([]);
    expect(r.pulled.length).toBe(6);
  });

  it('a device that edits ONE file pushes only that file', async () => {
    const a = new SettingsManager();
    a.updateCommon((s) => {
      s.input.zoom_speed = 3;
    });
    a.updateEeschema((s) => {
      s.appearance.show_hidden_pins = true;
    });
    await syncSettings(USER, { manager: a });

    // The other device moves eeschema on.
    be.seed('eeschema', { appearance: { show_hidden_pins: false } }, 9_000);

    a.updateCommon((s) => {
      s.input.zoom_speed = 8;
    });
    be.writes.length = 0;
    const r = await syncSettings(USER, { manager: a, only: ['common'] });

    // `common` goes up; `eeschema` is not written, because this device has not
    // edited it since it agreed. That is the whole mitigation: an overnight tab
    // cannot push six stale files just because it wrote one fresh one.
    expect(be.writes).toEqual(['common']);
    expect(r.pulled).toContain('eeschema');
    expect(a.eeschema.appearance.show_hidden_pins).toBe(false);
  });

  it('the later edit wins when both devices edited the same file', async () => {
    const a = new SettingsManager();
    a.updatePlEditor((s) => {
      s.system.units = 'mm';
    });
    be.now = 1_000;
    await syncSettings(USER, { manager: a });

    // The account moves on, LATER than anything this device has done.
    be.seed('pl_editor', { system: { units: 'in' } }, Date.now() + 60_000);
    await syncSettings(USER, { manager: a });
    expect(a.plEditor.system.units).toBe('in');
  });

  it('a local edit newer than the account wins, and lands', async () => {
    const a = new SettingsManager();
    a.updatePlEditor((s) => {
      s.system.units = 'mm';
    });
    await syncSettings(USER, { manager: a });

    // The account moved, but EARLIER than this device's next edit.
    be.seed('pl_editor', { system: { units: 'in' } }, Date.now() - 60_000);
    a.updatePlEditor((s) => {
      s.system.units = 'mils';
    });
    be.now = Date.now() + 1;
    const r = await syncSettings(USER, { manager: a });

    expect(r.pushed).toContain('pl_editor');
    expect(a.plEditor.system.units).toBe('mils');
    expect(be.rows.get('pl_editor')?.value).toMatchObject({ system: { units: 'mils' } });
  });

  it('an edit made while the push is in flight is not marked as agreed', async () => {
    const a = new SettingsManager();
    a.updateCommon((s) => {
      s.input.zoom_speed = 2;
    });

    // Land the edit between reading the body and recording agreement.
    const put = be.putSettings!.bind(be);
    be.putSettings = async (row) => {
      a.updateCommon((s) => {
        s.input.zoom_speed = 6;
      });
      return put(row);
    };

    await syncSettings(USER, { manager: a });

    // Still dirty, so the next reconcile sends the value that is actually here.
    const stamp = a.stamps.common!;
    expect(stamp.updatedAt).toBeGreaterThan(stamp.syncedAt!);

    be.putSettings = put;
    be.now = Date.now() + 1_000;
    await syncSettings(USER, { manager: a });
    expect(be.rows.get('common')?.value).toMatchObject({ input: { zoom_speed: 6 } });
  });
});

// ---------------------------------------------------------------------------
// Schema versions
// ---------------------------------------------------------------------------

describe('what version wrote this', () => {
  it('stamps every push with this build’s schema version', () => {
    expect(SETTINGS_VERSION).toBeGreaterThan(0);
  });

  it('records the version on the row', async () => {
    const a = new SettingsManager();
    a.updateCommon((s) => {
      s.input.zoom_speed = 3;
    });
    await syncSettings(USER, { manager: a });
    expect(be.rows.get('common')?.version).toBe(SETTINGS_VERSION);
  });

  it('migrates a row written by an older build on the way in', async () => {
    // v2's correction: `always_show_cursor: false` alongside the small cross
    // gated the crosshair off entirely and had no button to turn it back on.
    // A row stored at version 1 must get it, exactly as a stored file does.
    be.seed(
      'eeschema',
      { window: { cursor: { crosshair: 'small', always_show_cursor: false } } },
      9_000,
      1,
    );
    const b = freshDevice();
    await syncSettings(USER, { manager: b });
    expect(b.eeschema.window.cursor.always_show_cursor).toBe(true);
  });

  it('takes an un-migrated value verbatim if the row claims to be current', async () => {
    // The mirror of the test above: without it, a green result would be
    // indistinguishable from "the default happened to be true anyway".
    be.seed(
      'eeschema',
      { window: { cursor: { crosshair: 'small', always_show_cursor: false } } },
      9_000,
      SETTINGS_VERSION,
    );
    const b = freshDevice();
    await syncSettings(USER, { manager: b });
    expect(b.eeschema.window.cursor.always_show_cursor).toBe(false);
  });

  it('reads a row from a newer build, keeping only the keys it understands', async () => {
    be.seed(
      'pl_editor',
      { system: { units: 'mm' }, some_future_block: { nothing: 'here' } },
      9_000,
      SETTINGS_VERSION + 5,
    );
    const b = freshDevice();
    const r = await syncSettings(USER, { manager: b });
    expect(r.pulled).toContain('pl_editor');
    expect(r.future).toContain('pl_editor');
    expect(b.plEditor.system.units).toBe('mm');
    expect(b.plEditor as unknown as Record<string, unknown>).not.toHaveProperty(
      'some_future_block',
    );
  });

  it('refuses to write over a row from a newer build', async () => {
    const a = new SettingsManager();
    a.updatePlEditor((s) => {
      s.system.units = 'mm';
    });
    be.seed('pl_editor', { system: { units: 'in' } }, Date.now() + 60_000, SETTINGS_VERSION + 1);

    be.writes.length = 0;
    const r = await syncSettings(USER, { manager: a });
    expect(be.writes).toEqual([]);
    expect(r.pushed).not.toContain('pl_editor');
    // And the local edit is not thrown away either: nothing was saved over it,
    // and nothing overwrote it.
    expect(a.plEditor.system.units).toBe('mm');
  });

  it('says once that a setting has stopped following the account', async () => {
    // `result.future` was a value nothing read — one of the four shapes of test
    // that cannot fail. A preference that silently stops syncing until the
    // device is updated is exactly the condition worth a line in the console.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    be.seed('pl_editor', { system: { units: 'in' } }, 9_000, SETTINGS_VERSION + 1);
    const a = new SettingsManager();
    await syncSettings(USER, { manager: a });
    await syncSettings(USER, { manager: a });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('pl_editor');
  });
});

// ---------------------------------------------------------------------------
// Degrading
// ---------------------------------------------------------------------------

describe('before the migration is applied', () => {
  it('does not throw, and reports the table as missing', async () => {
    be.failWith =
      "read settings: Could not find the table 'public.user_settings' in the schema cache (PGRST205)";
    const a = new SettingsManager();
    a.updatePlEditor((s) => {
      s.system.units = 'mm';
    });

    const r = await syncSettings(USER, { manager: a });
    expect(r.tableMissing).toBe(true);
    expect(r.pushed).toEqual([]);
    expect(r.pulled).toEqual([]);
  });

  it('leaves the setting working from localStorage', async () => {
    be.failWith = "Could not find the table 'public.user_settings' in the schema cache";
    const a = new SettingsManager();
    a.updatePlEditor((s) => {
      s.system.units = 'mm';
    });
    await syncSettings(USER, { manager: a });

    // The reload a user does next.
    expect(new SettingsManager().plEditor.system.units).toBe('mm');
  });

  it('says so once a session, not once a keystroke', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    be.failWith = "Could not find the table 'public.user_settings' in the schema cache";
    const a = new SettingsManager();
    await syncSettings(USER, { manager: a });
    await syncSettings(USER, { manager: a });
    await syncSettings(USER, { manager: a });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('user_settings.sql');
  });

  it('reports an ordinary failure without claiming the table is missing', async () => {
    // A dropped connection must not be reported as "run the migration", or the
    // one message that means "do something" stops meaning anything.
    be.failWith = 'read settings: NetworkError when attempting to fetch resource';
    const r = await syncSettings(USER, { manager: new SettingsManager() });
    expect(r.error).toContain('NetworkError');
    expect(r.tableMissing).toBeUndefined();
  });

  it('recognises both spellings of a missing table and nothing else', () => {
    expect(isMissingSettingsTable(new Error('PGRST205: no such thing'))).toBe(true);
    expect(isMissingSettingsTable(new Error('relation "user_settings" does not exist'))).toBe(true);
    expect(isMissingSettingsTable(new Error('42P01'))).toBe(true);
    expect(isMissingSettingsTable(new Error('JWT expired'))).toBe(false);
    expect(isMissingSettingsTable(new Error('relation "projects" does not exist'))).toBe(false);
  });

  it('does nothing at all with no transport installed', async () => {
    setCloudBackend(null);
    const a = new SettingsManager();
    a.updatePlEditor((s) => {
      s.system.units = 'mm';
    });
    const r = await syncSettings(USER, { manager: a });
    expect(r).toEqual({ pushed: [], pulled: [], future: [] });
    expect(new SettingsManager().plEditor.system.units).toBe('mm');
  });

  it('does nothing with a transport that predates settings support', async () => {
    // Every method on the interface is optional for the reason `recordVersion`
    // is: a deployment mid-upgrade must still work.
    const old = fake();
    delete (old as Partial<CloudBackend>).getSettings;
    delete (old as Partial<CloudBackend>).putSettings;
    setCloudBackend(old);
    const r = await syncSettings(USER, { manager: new SettingsManager() });
    expect(r).toEqual({ pushed: [], pulled: [], future: [] });
  });
});

// ---------------------------------------------------------------------------
// Signed out
// ---------------------------------------------------------------------------

describe('installing and removing the sync', () => {
  it('installs nothing while signed out', async () => {
    const a = new SettingsManager();
    a.onSliceChanged = () => {
      throw new Error('a signed-out session must have no seam installed');
    };
    const dispose = installSettingsSync(null, a);
    expect(a.onSliceChanged).toBeNull();

    a.updatePlEditor((s) => {
      s.system.units = 'mm';
    });
    // Nothing was sent and nothing threw.
    await vi.advanceTimersByTimeAsync(SETTINGS_PUSH_DEBOUNCE_MS * 3);
    expect(be.writes).toEqual([]);
    dispose();
  });

  it('reconciles on sign-in, then pushes an edit after the debounce', async () => {
    be.seed('pl_editor', { system: { units: 'mm' } }, 9_000);
    const a = new SettingsManager();
    const dispose = installSettingsSync(USER, a);

    // The sign-in reconcile: the other device's units arrive.
    await vi.advanceTimersByTimeAsync(0);
    expect(a.plEditor.system.units).toBe('mm');

    be.writes.length = 0;
    a.updateCommon((s) => {
      s.input.zoom_speed = 5;
    });
    // Nothing yet — a settings write is not a request per keystroke, the same
    // call KiCad makes once when the Preferences dialog is accepted.
    expect(be.writes).toEqual([]);

    await vi.advanceTimersByTimeAsync(SETTINGS_PUSH_DEBOUNCE_MS + 1);
    expect(be.writes).toEqual(['common']);
    dispose();
  });

  it('sends nothing more once disposed', async () => {
    const a = new SettingsManager();
    const dispose = installSettingsSync(USER, a);
    await vi.advanceTimersByTimeAsync(0);
    dispose();

    be.writes.length = 0;
    a.updateCommon((s) => {
      s.input.zoom_speed = 5;
    });
    await vi.advanceTimersByTimeAsync(SETTINGS_PUSH_DEBOUNCE_MS * 3);
    expect(be.writes).toEqual([]);
  });
});

describe('signed out is unchanged', () => {
  it('persists and reloads with no seam installed', () => {
    const a = new SettingsManager();
    expect(a.onSliceChanged).toBeNull();
    a.updatePlEditor((s) => {
      s.system.units = 'mm';
    });
    a.setHotkey('eeschema.save', 'Ctrl+Alt+S');
    a.setUserColors({ wire: 'rgb(9, 9, 9)' });

    const reloaded = new SettingsManager();
    expect(reloaded.plEditor.system.units).toBe('mm');
    expect(reloaded.hotkeys['eeschema.save']).toBe('Ctrl+Alt+S');
    expect(reloaded.userColors).toEqual({ wire: 'rgb(9, 9, 9)' });
  });

  it('writes the settings file itself, not a wrapper around it', () => {
    // The stored JSON has to stay a faithful `pl_editor.json`. Bookkeeping in
    // the same key would show up in a user's exported settings and in
    // `deepMerge`'s way.
    const a = new SettingsManager();
    a.updatePlEditor((s) => {
      s.system.units = 'mm';
    });
    const raw = JSON.parse(localStorage.getItem(sliceStorageKey('pl_editor'))!) as Record<
      string,
      unknown
    >;
    expect(raw).not.toHaveProperty('updatedAt');
    expect(raw).not.toHaveProperty('syncedAt');
    expect(raw).toHaveProperty('system');
  });
});

// ---------------------------------------------------------------------------
// The free-form maps
// ---------------------------------------------------------------------------

describe('the free-form settings files', () => {
  it('brings the User colour theme back after a reload', () => {
    // `colors.user` was read through `load()`, which goes through `deepMerge`,
    // which keeps only keys the DEFAULTS already have — and its defaults are
    // `{}`. So every colour the user picked was written on change and dropped
    // on the next page load. `loadHotkeys` documented this trap three lines
    // above the call that fell into it.
    const a = new SettingsManager();
    a.setUserColors({ wire: 'rgb(1, 2, 3)', bus: 'rgb(4, 5, 6)' });
    expect(new SettingsManager().userColors).toEqual({
      wire: 'rgb(1, 2, 3)',
      bus: 'rgb(4, 5, 6)',
    });
  });

  it('drops a colour entry that is not a colour', () => {
    expect(normalizeUserColors({ wire: 'rgb(1, 2, 3)', bad: 7, worse: null })).toEqual({
      wire: 'rgb(1, 2, 3)',
    });
    expect(normalizeUserColors(['nope'])).toEqual({});
    expect(normalizeUserColors(undefined)).toEqual({});
  });

  it('qualifies a bare hotkey name arriving from the account', async () => {
    // The old spelling had no app prefix. A map pulled from another device has
    // to go through the same correction as one read from localStorage, or
    // signing in resurrects keys the app no longer looks up.
    be.seed('hotkeys', { save: 'Ctrl+Alt+S', 'pcbnew.undo': 'Ctrl+Z' }, 9_000);
    const b = freshDevice();
    await syncSettings(USER, { manager: b });
    expect(b.hotkeys).toEqual({ 'eeschema.save': 'Ctrl+Alt+S', 'pcbnew.undo': 'Ctrl+Z' });
  });
});

// ---------------------------------------------------------------------------
// Stamps
// ---------------------------------------------------------------------------

describe('the per-slice stamps', () => {
  it('gives two edits inside one millisecond two different stamps', () => {
    // Sharing one would let the second satisfy `updatedAt === syncedAt` after
    // the first was pushed — read as agreed, and never sent.
    const a = new SettingsManager();
    const at: number[] = [];
    for (let i = 0; i < 5; i++) {
      a.updateCommon((s) => {
        s.input.zoom_speed = i + 1;
      });
      at.push(a.stamps.common!.updatedAt);
    }
    for (let i = 1; i < at.length; i++) expect(at[i]!).toBeGreaterThan(at[i - 1]!);
  });

  it('survives a reload, so a device that was offline still knows it is dirty', async () => {
    const a = new SettingsManager();
    a.updatePcbnew((s) => {
      s.printing.mirror = true;
    });
    // Same storage, new manager: the page was reloaded before the push landed.
    const after = new SettingsManager();
    const r = await syncSettings(USER, { manager: after });
    expect(r.pushed).toContain('pcbnew');
  });

  it('does not move updatedAt when the account’s copy is adopted', () => {
    const a = new SettingsManager();
    a.updateCommon((s) => {
      s.input.zoom_speed = 3;
    });
    const before = a.stamps.common!.updatedAt;
    a.adoptSlice('common', { input: { zoom_speed: 9 } }, 4_242);
    expect(a.stamps.common!.updatedAt).toBe(before);
    expect(a.stamps.common!.syncedAt).toBe(before);
    expect(a.stamps.common!.cloudAt).toBe(4_242);
    expect(a.common.input.zoom_speed).toBe(9);
  });

  it('names every slice the manager can write', () => {
    // A slice added to the manager and forgotten here would persist locally and
    // never follow the account — silently, which is the failure mode this whole
    // change exists to end.
    const a = new SettingsManager();
    const touched = new Set<SettingsSlice>();
    a.onSliceChanged = (s) => touched.add(s);
    a.updateCommon(() => undefined);
    a.updateEeschema(() => undefined);
    a.updatePcbnew(() => undefined);
    a.updatePlEditor(() => undefined);
    a.updatePrivacy(() => undefined);
    a.setUserColors({});
    a.setHotkeys({});
    a.resetCommon();
    a.resetEeschema();
    a.resetUserColors();
    a.resetHotkeys();
    a.setHotkey('eeschema.save', null);

    // Written out rather than compared against `SETTINGS_SLICES`. Comparing the
    // list to itself is an expectation computed by calling the code under test:
    // drop a slice from the list AND from the manager and both sides shrink
    // together, which is green. These are KiCad's settings-file basenames —
    // common.json, eeschema.json, pcbnew.json, pl_editor.json, colors/user.json,
    // user.hotkeys — plus `privacy`, which has no upstream counterpart.
    const expected: SettingsSlice[] = [
      'colors.user',
      'common',
      'eeschema',
      'hotkeys',
      'pcbnew',
      'pl_editor',
      'privacy',
    ];
    expect([...touched].sort()).toEqual(expected);
    // And the list the sync iterates is the same set, so nothing the manager
    // writes is left out of the reconcile.
    expect([...SETTINGS_SLICES].sort()).toEqual(expected);
  });

  it('reads every named slice back and adopts it', () => {
    // The other half: a slice in the list that the IO table cannot read or
    // write would throw on the first sync, or worse, push `undefined`.
    const a = new SettingsManager();
    for (const slice of SETTINGS_SLICES) {
      expect(a.sliceValue(slice), slice).toBeTypeOf('object');
      expect(() => a.adoptSlice(slice, a.sliceValue(slice), 1), slice).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

const APP = readFileSync(
  fileURLToPath(new URL('../../../designer/src/App.tsx', import.meta.url)),
  'utf8',
);

const MAIN = readFileSync(
  fileURLToPath(new URL('../../../designer/src/main.tsx', import.meta.url)),
  'utf8',
);

describe('the app actually installs it', () => {
  it('runs the settings sync for the signed-in session', () => {
    // Every rule above is a pure function over an interface, and a pure
    // function nothing calls passes its tests forever. `qa` has no DOM, so
    // reading the component as text is the only way to see the seam is reached.
    expect(APP).toContain('installSettingsSync(userId)');
  });

  it('installs the transport at boot', () => {
    expect(MAIN).toContain('setCloudBackend(supabaseBackend())');
  });
});

const SQL = readFileSync(
  fileURLToPath(new URL('../../../designer/supabase/user_settings.sql', import.meta.url)),
  'utf8',
);

describe('the migration Akshay has to run', () => {
  it('keys a row by (user_id, key), as projects.sql keys by (user_id, id)', () => {
    // A globally unique key lets one account's upsert take its ON CONFLICT
    // UPDATE path against a row it does not own, which row-level security then
    // refuses. projects.sql carries the same fix and the same note.
    expect(SQL).toMatch(/primary key \(user_id, key\)/);
  });

  it('turns row-level security on and scopes all four verbs to the owner', () => {
    expect(SQL).toContain('alter table public.user_settings enable row level security');
    for (const verb of ['select', 'insert', 'update', 'delete'])
      expect(SQL, verb).toMatch(new RegExp(`for ${verb}\\b`));
    // Three `using` and one `with check` would pass a bare count; every policy
    // has to name the owner.
    expect(SQL.match(/auth\.uid\(\) = user_id/g)?.length).toBeGreaterThanOrEqual(5);
  });

  it('stamps updated_at on the server, not from the client', () => {
    expect(SQL).toContain('new.updated_at := now()');
    expect(SQL).toMatch(/before insert or update on public\.user_settings/);
  });
});
