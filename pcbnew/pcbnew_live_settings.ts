// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The live `pcbnew.json` singleton (`PGM_BASE`'s `SETTINGS_MANAGER` slice,
 * `prefs/settings.ts`'s `settings.pcbnew` getter/setter) that
 * `DIALOG_PRINT_PCBNEW` (`dialog_print_pcbnew.tsx`) and
 * `DIALOG_PNS_SETTINGS` (`dialog_pns_settings.tsx`) read on open and write
 * back on close, the same shape `pcb_edit_frame.ts`'s
 * `PCBNEW_JSON_SETTINGS_LIKE` states for a plain snapshot. This one is a
 * *live* read/write pair, so it is a swappable provider — the same shape
 * `common/gal/kicursors.ts`'s `setCustomCursorsEnabledProvider` and
 * `pcbTheme.ts`'s `setColorSettingsByIdProvider` use — because `pcbnew/`
 * cannot read an app's settings singleton itself.
 */

/** `APP_SETTINGS_BASE::PRINTING` (`include/settings/app_settings.h:179`), the pcbnew slice. */
export interface PCBNEW_PRINTING_LIKE {
  background: boolean;
  monochrome: boolean;
  scale: number;
  use_theme: boolean;
  color_theme: string;
  title_block: boolean;
  layers: number[];
  mirror: boolean;
  drill_marks: number;
  pagination: number;
  edge_cuts_on_all_pages: boolean;
  as_item_checkboxes: boolean;
}

/**
 * The slice of the designer's live `PcbnewSettings` these two dialogs read:
 * `appearance.color_theme`, `printing.*` and `tools.pns` (`PNS::ROUTING_SETTINGS`,
 * a `RoutingSettingsJson` — see `router/pns_routing_settings.ts`).
 */
export interface PCBNEW_LIVE_SETTINGS_LIKE {
  appearance: {
    color_theme: string;
  };
  printing: PCBNEW_PRINTING_LIKE;
  tools: {
    pns: Record<string, unknown>;
  };
}

const DEFAULT_PCBNEW_LIVE_SETTINGS: PCBNEW_LIVE_SETTINGS_LIKE = {
  appearance: { color_theme: 'user' },
  printing: {
    background: false,
    monochrome: true,
    scale: 1.0,
    use_theme: false,
    color_theme: 'user',
    title_block: true,
    layers: [],
    mirror: false,
    drill_marks: 1,
    pagination: 0,
    edge_cuts_on_all_pages: true,
    as_item_checkboxes: false,
  },
  tools: { pns: {} },
};

let pcbnewLiveSettingsProvider: () => PCBNEW_LIVE_SETTINGS_LIKE = () =>
  DEFAULT_PCBNEW_LIVE_SETTINGS;

/** The designer's own live getter, registered once by `pgm_app.ts`'s `InitPgm`. */
export function setPcbnewLiveSettingsProvider(fn: () => PCBNEW_LIVE_SETTINGS_LIKE): void {
  pcbnewLiveSettingsProvider = fn;
}

/** `settings.pcbnew`, live. */
export function pcbnewLiveSettings(): PCBNEW_LIVE_SETTINGS_LIKE {
  return pcbnewLiveSettingsProvider();
}

let updatePcbnewLiveSettingsProvider: (mutate: (s: PCBNEW_LIVE_SETTINGS_LIKE) => void) => void =
  () => {};

/** The designer's own live setter, registered once by `pgm_app.ts`'s `InitPgm`. */
export function setUpdatePcbnewLiveSettingsProvider(
  fn: (mutate: (s: PCBNEW_LIVE_SETTINGS_LIKE) => void) => void,
): void {
  updatePcbnewLiveSettingsProvider = fn;
}

/** `settings.updatePcbnew`, live. */
export function updatePcbnewLiveSettings(mutate: (s: PCBNEW_LIVE_SETTINGS_LIKE) => void): void {
  updatePcbnewLiveSettingsProvider(mutate);
}
