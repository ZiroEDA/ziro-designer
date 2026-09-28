// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Image Converter's settings store, `BITMAP2CMP_SETTINGS`, as the program's
 * settings manager holds it. The window asks for it through `BITMAP2CMP_APP`.
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
 * The file history is the exception, and deliberately still local; it is the
 * frame's own, in `bitmap2component/bitmap2cmp_frame_ui.tsx`.
 */
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
 * before it commits. The window saves from an effect, and an effect
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
