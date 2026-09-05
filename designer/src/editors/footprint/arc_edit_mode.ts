// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `FOOTPRINT_EDITOR_SETTINGS::m_ArcEditMode` — a member of the settings object
 * that is **not one of its params**, and therefore never reaches the file.
 *
 * This is upstream's, not ours. The constructor seeds it
 * (`pcbnew/footprint_editor_settings.cpp:56`), `PANEL_EDIT_OPTIONS` loads and
 * stores it in the footprint branch like any other control
 * (`panel_edit_options.cpp:150`, `:177`), and `EDIT_TOOL`'s point editor reads
 * it — but `m_params.emplace_back( … "editing.arc_edit_mode" … )` appears only
 * in `PCBNEW_SETTINGS` (`pcbnew_settings.cpp:183-185`). So in the Footprint
 * Editor the choice applies for the session and is back to
 * `KEEP_CENTER_ADJUST_ANGLE_RADIUS` at the next launch.
 *
 * A key in `fpedit.json` would be a different settings file from KiCad's, and
 * greying the control would be a different dialog. A module-level value with a
 * subscription is the third thing: the same lifetime the C++ member has, which
 * is the frame's, and something outside the Preferences dialog reads it.
 *
 * Not in `prefs/settings.ts` because everything there is persisted; that is the
 * whole contract of that module.
 */
import { useSyncExternalStore } from 'react';

/**
 * `ARC_EDIT_MODE` (`include/tool/edit_points.h`), in the order
 * `arcEditModeToComboIndex` maps it to the wxChoice
 * (`panel_edit_options.cpp:75-98`): the enum's own order and the combo's agree,
 * which is why upstream can cast between them and still writes the two
 * switches out.
 */
export type ArcEditMode = 0 | 1 | 2;

/** `m_arcEditModeChoices` (`panel_edit_options_base.cpp:66-69`), verbatim. */
export const ARC_EDIT_MODE_CHOICES: [ArcEditMode, string][] = [
  [0, 'Keep center, adjust radius'],
  [1, 'Keep endpoints or direction of starting point'],
  [2, 'Keep center and radius, adjust endpoints'],
];

/** `ARC_EDIT_MODE::KEEP_CENTER_ADJUST_ANGLE_RADIUS`, the constructor's seed. */
export const DEFAULT_ARC_EDIT_MODE: ArcEditMode = 0;

let mode: ArcEditMode = DEFAULT_ARC_EDIT_MODE;
const listeners = new Set<() => void>();

/** The current mode, for a non-React reader (the point editor). */
export function sessionArcEditMode(): ArcEditMode {
  return mode;
}

/** `PANEL_EDIT_OPTIONS::TransferDataFromWindow`'s one line for this control. */
export function setSessionArcEditMode(next: ArcEditMode): void {
  if (next === mode) return;
  mode = next;
  for (const l of listeners) l();
}

/** `ResetPanel`: default-construct a `FOOTPRINT_EDITOR_SETTINGS` and reload. */
export function resetSessionArcEditMode(): void {
  setSessionArcEditMode(DEFAULT_ARC_EDIT_MODE);
}

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The React binding, so the page and the canvas see the same value. */
export function useSessionArcEditMode(): ArcEditMode {
  return useSyncExternalStore(subscribe, sessionArcEditMode, sessionArcEditMode);
}
