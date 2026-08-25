// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The user's settings, following their account instead of their browser.
 *
 * ### What upstream does, and where it stops
 *
 * `SETTINGS_MANAGER` keeps one `JSON_SETTINGS` per settings *file* and writes
 * each to its own path under `SETTINGS_LOC::USER`
 * (`SETTINGS_MANAGER::Save`, settings_manager.cpp:190-209). It writes when the
 * Preferences dialog is accepted (eda_base_frame.cpp:1777), when a frame
 * releases a settings object (`FlushAndRelease`, settings_manager.cpp:227), and
 * at shutdown (kicad.cpp:448, single_top.cpp:105) — not on every keystroke.
 * We mirror that: a change schedules a write, and the page becoming hidden
 * flushes it, which is the last callback a browser tab is guaranteed
 * (`home/flush_on_hide.ts`).
 *
 * Upstream stops there, because upstream is one machine with one home
 * directory. It has no notion of two copies of `eeschema.json` that disagree,
 * so the reconciliation below is ours to design rather than to port. What *is*
 * portable is the version discipline, and it is used in full:
 *
 *  - a row older than this build is migrated on the way in, through the same
 *    `migrateSlice` corrections a stored file gets (`JSON_SETTINGS::Migrate`,
 *    json_settings.cpp:714-750);
 *  - a row **newer** than this build is read but never written back.
 *    `LoadFromFile` sets `m_isFutureFormat` (json_settings.cpp:323-330) and
 *    keeps loading the parameters it understands, while `ShouldAutoSave()` —
 *    `!m_wasMigrated && !m_isFutureFormat` (project_file.h:158,
 *    project_local_settings.h:80) — then refuses to save over it. That is
 *    exactly the protection a user needs when one of their devices is on a
 *    newer deploy than another.
 *
 * ### The conflict rule, and what it costs
 *
 * **Per settings file, last write wins — and a device only ever pushes a file
 * it has itself edited since it last agreed with the account.**
 *
 * *Per file* is the granularity because it is upstream's: `common.json` and
 * `pcbnew.json` are separate documents that are separately written, and nothing
 * in KiCad ever merges two copies of one of them. Going finer — a timestamp per
 * key — was considered and rejected: merging half of `eeschema.appearance` from
 * one machine with half from another produces a state neither person ever
 * chose, and it is undefined for the free-form maps (`hotkeys`, `colors.user`)
 * and for arrays like `pinned_symbol_libs`. Going coarser — one blob for
 * everything — makes the blast radius of every conflict the entire preferences
 * dialog.
 *
 * *Last write wins* is the rule because settings cannot fork. Projects can:
 * `pullOne` keeps the local copy as a new project and lets the user decide
 * (sync.ts). There is no equivalent for a unit preference — nobody can be
 * shown two copies of "millimetres or mils" and asked to merge them — so one of
 * the two has to lose, and the later edit is the better guess at what the
 * person currently wants.
 *
 * **What it costs.** A device that has been sitting open can overwrite a newer
 * setting from another device. Two things narrow that, both cheap:
 *
 *  1. A slice is only pushed if `updatedAt > syncedAt` — this device edited it.
 *     An idle device pushes nothing at all, and a device that changes the PCB
 *     grid pushes `pcbnew` and leaves the other seven alone. So the loss needs
 *     *both* devices to have edited *the same file*.
 *  2. Every push re-reads the account rows first and re-decides. The stale
 *     window is therefore the few hundred milliseconds between that read and
 *     the write, not the hours the tab was open.
 *
 * What remains, and is accepted: in that race, and in a genuine
 * both-sides-edited-the-same-file conflict, the winner is chosen by comparing
 * this device's clock against the server's. A device whose clock is minutes
 * wrong can lose a conflict it should win. Correcting for the skew is possible
 * — the server's timestamp comes back from every push — but it only ever
 * changes the answer when two edits to the same settings file land closer
 * together than the clock error, and one settings file reverting is a small
 * enough loss that the extra state is not worth carrying. Recorded here rather
 * than discovered later.
 *
 * ### What does not sync
 *
 * Everything in {@link SETTINGS_SLICES} does. The keys deliberately left out
 * are the ones that describe *this machine* rather than this person:
 * `ziro.leftWinWidth`, `ziro.templateWindowSize`, `ziroeda.localHistoryShown`
 * and `ziro.guestNudgeDismissed` — pane and window geometry, and a dismissal.
 * KiCad stores window geometry in `WINDOW_SETTINGS` and it is per-display; a
 * pane width carried from a 4K desktop to a laptop is a worse experience than
 * the default. `ziroeda.settings_version` and `ziroeda.settings_sync` are this
 * device's own bookkeeping and are not settings at all.
 *
 * Hotkeys and the User colour theme *do* sync: upstream they are files under
 * the same `SETTINGS_LOC::USER` directory (`user.hotkeys`, `colors/user.json`),
 * they describe the person, and a rebound key that did not follow the account
 * would be the most conspicuous thing missing.
 */

import type { SettingsRow } from './backend.js';
import { cloudBackend } from './cloudStore.js';
import { installFlushOnHide } from '../home/flush_on_hide.js';
import {
  migrateSlice,
  SETTINGS_SLICES,
  SETTINGS_VERSION,
  settings as defaultManager,
  type SettingsManager,
  type SettingsSlice,
  type SliceStamp,
} from '../prefs/settings.js';

/** What one slice's reconcile decided to do. */
export type SliceAction = 'push' | 'pull' | 'none';

/** The account's copy of a slice, as far as a decision is concerned. */
export interface CloudStamp {
  /** The row's `updated_at`, in ms. Server clock. */
  updatedAt: number;
  /** `meta.version` — the schema version of the build that wrote it. */
  version: number;
}

/**
 * Decide what to do with one settings file. Pure, and the whole of the rule.
 *
 * `local` absent means this device has never written the slice: there is
 * nothing to diverge *from*, so it is never dirty. That is `hasDivergedLocally`'s
 * rule (projectStore.ts:1118-1121) and it exists for the same reason — treating
 * a never-synced record as diverged forks everything the first time anyone
 * signs in.
 */
export function decideSlice(
  local: SliceStamp | undefined,
  cloud: CloudStamp | undefined,
  schemaVersion: number = SETTINGS_VERSION,
): SliceAction {
  // This device wrote it after the last time the two sides agreed.
  const dirty = local !== undefined && local.updatedAt > (local.syncedAt ?? -Infinity);

  if (cloud === undefined) return dirty ? 'push' : 'none';

  // The account moved since we agreed. Both sides of this comparison are the
  // server's clock, so it is exact.
  const cloudMoved = cloud.updatedAt > (local?.cloudAt ?? -Infinity);

  if (cloud.version > schemaVersion) {
    // Written by a newer build. Read it if we have nothing of our own to lose —
    // `deepMerge` keeps only the keys this build knows, which is what
    // `JSON_SETTINGS::Load` does with a future-format file — but never write
    // over it, and never let a pull silently discard a local edit either.
    // `ShouldAutoSave()`, project_file.h:158.
    return dirty ? 'none' : cloudMoved ? 'pull' : 'none';
  }

  if (!dirty) return cloudMoved ? 'pull' : 'none';
  if (!cloudMoved) return 'push';

  // Both sides moved. The only cross-clock comparison in the rule, and the
  // only place it can pick wrong. A tie goes to the local copy: if the two
  // cannot be told apart, keep what is in front of the person sitting here.
  // `dirty` is only true when `local` is defined.
  return (local?.updatedAt ?? 0) >= cloud.updatedAt ? 'push' : 'pull';
}

/** What a completed reconcile did, and what it could not do. */
export interface SettingsSyncResult {
  pushed: SettingsSlice[];
  pulled: SettingsSlice[];
  /** Slices the account holds in a newer schema than this build understands. */
  future: SettingsSlice[];
  /** Set when the reconcile could not run at all. Never thrown. */
  error?: string;
  /** True when `error` is "the migration has not been applied yet". */
  tableMissing?: boolean;
}

/**
 * Whether an error means `user_settings` does not exist.
 *
 * PostgREST answers an unknown relation with `PGRST205` and a "Could not find
 * the table ... in the schema cache" message; Postgres itself answers `42P01`.
 * Matched on the text because the backend's contract is to reject with an
 * `Error`, not to leak the driver's result object — the whole point of
 * `supabaseBackend.ts`.
 */
export function isMissingSettingsTable(e: unknown): boolean {
  const m = (e instanceof Error ? e.message : String(e)).toLowerCase();
  return (
    m.includes('pgrst205') ||
    m.includes('42p01') ||
    m.includes('could not find the table') ||
    (m.includes('user_settings') && m.includes('does not exist'))
  );
}

/** So a database without the migration says so once a session, not once a keystroke. */
let warnedNoTable = false;
/** The same, for an account written by a build newer than this one. */
let warnedFutureFormat = false;

/** Reset between tests; a module-level latch is otherwise sticky across them. */
export function resetSettingsSyncWarning(): void {
  warnedNoTable = false;
  warnedFutureFormat = false;
}

const ms = (iso: string): number => new Date(iso).getTime();

/**
 * Reconcile the user's settings files with their account.
 *
 * Never throws. localStorage has already been written by the time anything here
 * runs — `SettingsManager.commit` persists before it notifies — so a failure
 * costs the sync, never the setting. That is the opposite balance from a
 * project push, where the local copy is the thing at risk; here the local copy
 * is the thing that is safe.
 *
 * `only` restricts the *writes* to the slices named, which is what a debounced
 * push after an edit wants. The read is whole either way: it is one small
 * select, and re-deciding every slice against fresh rows is what keeps the
 * stale window down to the round trip.
 */
export async function syncSettings(
  userId: string,
  opts: { only?: readonly SettingsSlice[]; manager?: SettingsManager } = {},
): Promise<SettingsSyncResult> {
  const result: SettingsSyncResult = { pushed: [], pulled: [], future: [] };
  const mgr = opts.manager ?? defaultManager;
  const be = cloudBackend();
  // Bound up front: both are optional methods, and a narrowing of `be.getSettings`
  // does not survive the awaits below.
  const getSettings = be?.getSettings?.bind(be);
  const putSettings = be?.putSettings?.bind(be);
  if (!getSettings || !putSettings) return result;

  let rows: SettingsRow[];
  try {
    rows = await getSettings();
  } catch (e) {
    const missing = isMissingSettingsTable(e);
    if (missing && !warnedNoTable) {
      warnedNoTable = true;
      console.warn(
        'Settings are not following your account: the `user_settings` table is missing. ' +
          'Run supabase/user_settings.sql to enable it. Preferences still persist in this browser.',
      );
    }
    result.error = e instanceof Error ? e.message : String(e);
    if (missing) result.tableMissing = true;
    return result;
  }

  const cloud = new Map<string, CloudStamp>();
  for (const r of rows) {
    const at = ms(r.updated_at);
    // A row whose timestamp will not parse cannot be ordered against anything,
    // and treating it as epoch would make it lose every conflict silently.
    if (Number.isFinite(at)) cloud.set(r.key, { updatedAt: at, version: r.version });
  }
  const values = new Map(rows.map((r) => [r.key, r]));

  for (const slice of SETTINGS_SLICES) {
    const remote = cloud.get(slice);
    const stamp = mgr.stamps[slice];
    const action = decideSlice(stamp, remote, SETTINGS_VERSION);

    if (remote && remote.version > SETTINGS_VERSION) result.future.push(slice);

    const row = values.get(slice);
    if (action === 'pull' && remote && row) {
      let value = row.value;
      // Same corrections a stored file gets on the way in. A device that has
      // not opened the app since the correction shipped would otherwise push
      // the un-migrated value straight back up on its next edit.
      if (row.version < SETTINGS_VERSION) {
        value = structuredClone(value);
        migrateSlice(slice, value, row.version);
      }
      mgr.adoptSlice(slice, value, remote.updatedAt);
      result.pulled.push(slice);
      continue;
    }

    if (action !== 'push' || !stamp) continue;
    if (opts.only && !opts.only.includes(slice)) continue;

    // Read the body and its stamp together, before awaiting: an edit that lands
    // while the request is in flight must stay dirty rather than be marked as
    // agreed. See `markSliceSynced`.
    const value = mgr.sliceValue(slice);
    const syncedAt = stamp.updatedAt;
    try {
      const written = await putSettings({
        user_id: userId,
        key: slice,
        version: SETTINGS_VERSION,
        value,
      });
      mgr.markSliceSynced(slice, syncedAt, ms(written.updated_at));
      result.pushed.push(slice);
    } catch (e) {
      // One file that will not write is not a reason to abandon the other seven,
      // and nothing local was risked by trying. Reported, not counted.
      result.error = e instanceof Error ? e.message : String(e);
      if (isMissingSettingsTable(e)) result.tableMissing = true;
    }
  }

  // A settings file this build cannot write is a real, lasting condition — it
  // persists until the user updates this device — and it is invisible from the
  // UI: the preference simply stops following the account. Said once, for the
  // same reason `warnedNoTable` is said once.
  if (result.future.length > 0 && !warnedFutureFormat) {
    warnedFutureFormat = true;
    console.warn(
      `These settings were written by a newer version of Ziro Designer and are ` +
        `read-only on this device: ${result.future.join(', ')}. ` +
        `Changes made here will not reach your account until this device is updated.`,
    );
  }

  return result;
}

/**
 * How long an edit waits before it is sent.
 *
 * KiCad writes when the Preferences dialog is accepted, which is one discrete
 * event. Ours also change from toolbar toggles and from dragging a slider, so a
 * write per change would be a request per frame. The same 1.2 s the project
 * autosave uses, for the same reason, and with the same escape hatch: the page
 * becoming hidden flushes immediately.
 */
export const SETTINGS_PUSH_DEBOUNCE_MS = 1200;

/**
 * Make the signed-in user's settings follow their account, until the returned
 * disposer is called.
 *
 * Signed out (`userId` null) this installs nothing and clears the seam, so an
 * anonymous session behaves exactly as it did before any of this existed:
 * localStorage is written by the mutator and read by the next `SettingsManager`,
 * with nothing in between.
 */
export function installSettingsSync(
  userId: string | null,
  manager: SettingsManager = defaultManager,
): () => void {
  manager.onSliceChanged = null;
  if (!userId) return () => undefined;

  const dirty = new Set<SettingsSlice>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const flush = (): void => {
    clearTimeout(timer);
    timer = undefined;
    if (disposed || dirty.size === 0) return;
    const only = [...dirty];
    dirty.clear();
    void syncSettings(userId, { only, manager }).catch(() => undefined);
  };

  manager.onSliceChanged = (slice) => {
    dirty.add(slice);
    clearTimeout(timer);
    timer = setTimeout(flush, SETTINGS_PUSH_DEBOUNCE_MS);
  };

  // The whole reconcile on sign-in: this is the moment the other device's
  // settings are supposed to arrive.
  void syncSettings(userId, { manager }).catch(() => undefined);

  // A change followed within the debounce window by a tab close reached
  // localStorage and nothing else. `visibilitychange` is the last callback a
  // page is guaranteed — see flush_on_hide.ts for why not `beforeunload`.
  const uninstallHide = installFlushOnHide(flush);

  return () => {
    disposed = true;
    clearTimeout(timer);
    uninstallHide();
    if (manager.onSliceChanged) manager.onSliceChanged = null;
  };
}
