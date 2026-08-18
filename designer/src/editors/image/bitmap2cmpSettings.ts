// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * BITMAP2CMP_SETTINGS, web edition (`bitmap2cmp_settings.cpp`). The stored JSON
 * uses KiCad's own key names from `bitmap2component.json` (schema v1) so the
 * blob reads like the desktop settings file: units / threshold / negative /
 * last_format / last_mod_layer plus the last input/output file names.
 * Persistence is localStorage, like the rest of the app's settings.
 *
 * The file-history side (KiCad's FILE_HISTORY, surfaced as File → Open Recent)
 * has no path-based equivalent in a browser, so recent images are kept as data
 * URLs. The store itself is the shared port in `ui/file_history.ts` — this file
 * used to carry a private twelfth-of-a-FILE_HISTORY that capped at 5 and had
 * drifted from the Drawing Sheet Editor's private copy of the same idea.
 */
import { FileHistory } from '../../ui/file_history.js';
import { settings } from '../../prefs/settings.js';

export interface Bitmap2CmpSettings {
  bitmap_file_name: string;
  converted_file_name: string;
  /** Output-size unit choice: 0 mm, 1 inch, 2 DPI. */
  units: number;
  /** Black/white threshold, 0..100. */
  threshold: number;
  negative: boolean;
  /** OUTPUT_FMT_ID: 0 symbol, 1 symbol-paste, 2 footprint, 3 postscript, 4 drawing sheet. */
  last_format: number;
  /** Footprint outline layer index (F.Cu first, PCBNew ordering). */
  last_mod_layer: number;
}

export const BITMAP2CMP_DEFAULTS: Bitmap2CmpSettings = {
  bitmap_file_name: '',
  converted_file_name: '',
  units: 0,
  threshold: 50,
  negative: false,
  last_format: 0,
  last_mod_layer: 0,
};

const SETTINGS_KEY = 'ziroeda.bitmap2cmp';

export function loadBitmap2CmpSettings(): Bitmap2CmpSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...BITMAP2CMP_DEFAULTS };
    return { ...BITMAP2CMP_DEFAULTS, ...(JSON.parse(raw) as Partial<Bitmap2CmpSettings>) };
  } catch {
    return { ...BITMAP2CMP_DEFAULTS };
  }
}

export function saveBitmap2CmpSettings(s: Bitmap2CmpSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* private mode, settings simply don't persist */
  }
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
 */
export const recentImages = new FileHistory<RecentImage>({
  storageKey: 'ziroeda.bitmap2cmp.recent',
  maxFiles: settings.common.system.file_history_size,
});
