// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_MAINTENANCE`'s actions (common/dialogs/panel_maintenance.cpp:82-148).
 *
 * The four buttons upstream do four things to the settings tree on disk. Ours
 * is `localStorage` under one prefix, so the same four are expressible — this
 * is the one page of KiCad's five remaining generic pages that ports whole,
 * because it manipulates storage rather than describing a device or a path.
 *
 * Split out of the panel so the storage effects can be tested without a DOM,
 * and so nothing here needs React.
 */
import { COMMON_DEFAULTS, SETTINGS_SLICES, sliceStorageKey } from './settings.js';

/**
 * Every key this app owns. `sliceStorageKey` is the one place the prefix is
 * written, so the prefix is asked for rather than repeated.
 */
export const STORAGE_PREFIX: string =
  sliceStorageKey(SETTINGS_SLICES[0]).split('.')[0] ?? 'ziroeda';

/** Keys under our prefix, in whatever order the store yields them. */
function ownedKeys(store: Storage): string[] {
  const out: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (k !== null && k.startsWith(`${STORAGE_PREFIX}.`)) out.push(k);
  }
  return out;
}

/**
 * `SETTINGS_MANAGER::ClearFileHistory()` plus `KIWAY::ClearFileHistory()`
 * (`:84-87`) — every app's "Open Recent" list, not just the current frame's.
 *
 * Upstream a history is `system.file_history` inside each app's settings file;
 * ours is a `<prefix>.<app>.recent` key of its own, written by
 * `ui/file_history.ts`. So the match is on that suffix, which is why this
 * cannot simply drop the whole prefix.
 */
export function clearFileHistory(store: Storage = localStorage): number {
  const keys = ownedKeys(store).filter((k) => k.endsWith('.recent'));
  for (const k of keys) store.removeItem(k);
  return keys.length;
}

/**
 * `SETTINGS_MANAGER::ResetToDefaults()` (`:138-148`), reached by the Reset All
 * button after `doClearDialogState()`.
 *
 * Everything under the prefix goes, so the next read of each slice falls back
 * to its defaults — which is exactly what `load()` does with a missing key.
 * Deliberately NOT `store.clear()`: a page shares its origin with whatever else
 * the browser has put there, and upstream resets KiCad's settings directory,
 * not the user's home.
 */
export function resetAllSettings(store: Storage = localStorage): number {
  const keys = ownedKeys(store);
  for (const k of keys) store.removeItem(k);
  return keys.length;
}

/**
 * `PANEL_MAINTENANCE::doClearDontShowAgain` (`:94-105`), the PERSISTED half:
 *
 *     settings->m_DoNotShowAgain = {};
 *     settings->SaveToFile( … );
 *
 * `= {}` on a struct of six bools is all six back to false, which is what
 * `COMMON_DEFAULTS.do_not_show_again` holds. The stored slice is edited in
 * place rather than deleted, because the key carries other settings.
 *
 * The other half is `KIDIALOG::ClearDoNotShowAgainDialogs()`, which lives in
 * `ui/do_not_show_again.ts` — session state, not storage, so it cannot be done
 * from here and the panel calls both. Upstream's function is the pair of them
 * and so is ours; the split is only about which module owns which store.
 *
 * Returns how many of the six were set, for the infobar line.
 */
export function clearDoNotShowAgainSettings(store: Storage = localStorage): number {
  const key = sliceStorageKey('common');
  const raw = store.getItem(key);
  if (raw === null) return 0;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return 0;
  }
  if (typeof parsed !== 'object' || parsed === null) return 0;
  const obj = parsed as { do_not_show_again?: Record<string, unknown> };
  const n = Object.values(obj.do_not_show_again ?? {}).filter((v) => v === true).length;
  if (n === 0) return 0;
  obj.do_not_show_again = structuredClone(COMMON_DEFAULTS.do_not_show_again);
  store.setItem(key, JSON.stringify(obj));
  return n;
}

/**
 * `PANEL_MAINTENANCE::doClearDialogState` (`:117-127`), the second half:
 *
 *     settings->CsInternals().m_dialogControlValues = {};
 *
 * `common.dialog.controls` is the port of exactly that map — dialog key ->
 * control key -> value, written by `DIALOG_SHIM::SaveControlState` and read by
 * `LoadControlState`. Emptying it is what "Reset All Dialogs to Defaults"
 * means, and it is a *user* setting rather than session state, which is why
 * KiCad's "Place repeated copies" survives closing the placer.
 *
 * Returns how many dialogs had remembered state, for the infobar line.
 */
export function clearDialogState(store: Storage = localStorage): number {
  // `doClearDialogState()`'s FIRST line is `doClearDontShowAgain();` (`:119`).
  // Reset All Dialogs to Defaults therefore resets the don't-show-agains too,
  // and so does Reset All Program Settings, which calls this one. Ours did
  // neither, so "reset all dialogs" left a silenced dialog silenced.
  clearDoNotShowAgainSettings(store);
  const key = sliceStorageKey('common');
  const raw = store.getItem(key);
  if (raw === null) return 0;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A corrupt slice is not this button's problem; the loader replaces it.
    return 0;
  }
  if (typeof parsed !== 'object' || parsed === null) return 0;
  const obj = parsed as { dialog?: { controls?: Record<string, unknown> } };
  const n = Object.keys(obj.dialog?.controls ?? {}).length;
  if (n === 0) return 0;
  obj.dialog = { ...obj.dialog, controls: {} };
  store.setItem(key, JSON.stringify(obj));
  return n;
}
