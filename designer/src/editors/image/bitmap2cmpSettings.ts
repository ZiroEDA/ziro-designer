// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Image Converter's two stores: `BITMAP2CMP_SETTINGS` and its file history.
 *
 * `bitmap2component.json` is a `SETTINGS_LOC::USER` file like `eeschema.json`,
 * so it is a slice of the shared `SettingsManager` — the shape, the key names
 * and KiCad's defaults are in `prefs/settings.ts` beside the other six, and it
 * follows the account through `cloud/settingsSync.ts` for the reason that
 * module's header gives: `SETTINGS_LOC::USER` means one settings file per user
 * per installation, and in a browser with sign-in the account is what that maps
 * to. It used to be a private localStorage key here, which gave the same person
 * a different threshold in Chrome than in Firefox.
 *
 * The file history is the exception, and deliberately still local — see
 * `recentImages` below.
 */
import { FileHistory } from '../../ui/file_history.js';
import { BITMAP2CMP_DEFAULTS, settings, type Bitmap2CmpSettings } from '../../prefs/settings.js';

export { BITMAP2CMP_DEFAULTS, type Bitmap2CmpSettings };

/**
 * `BITMAP2CMP_PANEL::LoadSettings` (bitmap2cmp_panel.cpp:76-107): the panel
 * reads the settings object once, when the frame builds it, and holds the
 * values in its controls from then on. A snapshot is therefore the faithful
 * shape, not a subscription.
 */
export function loadBitmap2CmpSettings(): Bitmap2CmpSettings {
  return { ...settings.bitmap2cmp };
}

/**
 * `BITMAP2CMP_PANEL::SaveSettings` (bitmap2cmp_panel.cpp:110-117), which
 * upstream runs once, from the frame destructor (bitmap2cmp_frame.cpp:209).
 * Ours writes on each change instead, because a browser tab is not guaranteed a
 * destructor; the debounce that stops that being a request per keystroke is in
 * `settingsSync.ts`, and it is the same trade `SETTINGS_MANAGER` makes by
 * writing on dialog-accept.
 *
 * **An unchanged save must not record an edit**, which is why this compares
 * before it commits. `ImageConverter.tsx` saves from an effect, and an effect
 * also fires on mount — with exactly the values `loadBitmap2CmpSettings` just
 * returned. While this was a private localStorage key that merely rewrote the
 * same bytes. As a slice it would stamp `updatedAt`, and `decideSlice`'s
 * `updatedAt > syncedAt` would read *opening the Image Converter* as this
 * device having edited the settings: it would push a row identical to the one
 * it just pulled, and then win the next conflict against the device where
 * somebody actually changed something. Upstream cannot have this bug — a frame
 * opened and closed with nothing touched writes the same values back, and
 * `SETTINGS_MANAGER` has no second copy to lose to.
 */
export function saveBitmap2CmpSettings(s: Bitmap2CmpSettings): void {
  const cur = settings.bitmap2cmp;
  const keys = Object.keys(BITMAP2CMP_DEFAULTS) as (keyof Bitmap2CmpSettings)[];
  if (keys.every((k) => cur[k] === s[k])) return;
  settings.updateBitmap2Cmp((next) => {
    Object.assign(next, s);
  });
}

// ----- recent images (FILE_HISTORY) -------------------------------------------

export interface RecentImage {
  /** FILE_HISTORY's wxString row: what the menu shows and dedupes on. */
  name: string;
  /** The image bytes as a data URL, so Open Recent can reload them. */
  data: string;
}

/**
 * Skip storing images whose data URL would blow the localStorage quota.
 *
 * No upstream counterpart: a `FILE_HISTORY` row is a path, so it costs nothing
 * to keep. Ours has to carry the bytes, and a 12 MP photograph would evict the
 * whole history on the next write.
 */
export const RECENT_MAX_DATA = 1_500_000;

/**
 * BITMAP2CMP_FRAME's `m_fileHistory`, allocated once the way
 * `EDA_BASE_FRAME::LoadSettings` (eda_base_frame.cpp:1282-1286) allocates it,
 * from the user's `system.file_history_size`.
 *
 * **This one does not follow the account, and upstream is the reason.** The MRU
 * list is stored inside the settings file (`system.file_history`,
 * app_settings.cpp:225-226), so "which file is it in" would say sync it — but
 * `SETTINGS_MANAGER::ResetToDefaults` (settings_manager.cpp:106-124) lifts the
 * history out, resets everything else to its default, and puts the history
 * back; and clearing it needs its own command (`ClearFileHistory`, :126-139).
 * KiCad is drawing the line itself: the history is not one of the settings. It
 * records what this installation has opened rather than what this person
 * prefers, and its rows are paths, which mean nothing on another machine.
 *
 * Ours holds bytes rather than paths, which only sharpens it: at
 * `RECENT_MAX_DATA` per row and a default of nine rows this is up to ~13 MB of
 * base64. If recent images should ever follow the account, they belong in the
 * content-addressed blob store in `cloud/` with hashes in the slice — not in a
 * `jsonb` column on a 1.2 s debounce. See `cloud/settingsSync.ts`.
 */
export const recentImages = new FileHistory<RecentImage>({
  storageKey: 'ziroeda.bitmap2cmp.recent',
  maxFiles: settings.common.system.file_history_size,
});
