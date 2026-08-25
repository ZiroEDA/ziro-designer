// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The seam between the calculator panels and `pcb_calculator.json`.
 *
 * ### What upstream does
 *
 * `PCB_CALCULATOR_FRAME::loadPages` builds all fourteen panels and then calls
 * `LoadSettings( config() )` once (pcb_calculator_frame.cpp:188), which hands
 * the settings object to every panel in turn
 * (pcb_calculator_frame.cpp:396-398). Each panel's `LoadSettings` is a list of
 * `SetValue` / `SetSelection` calls; its `SaveSettings` is the same list read
 * back off the controls. `SaveSettings` runs when the frame closes and on a
 * language change (pcb_calculator_frame.cpp:242, 401-419) — **never on a
 * keystroke**, which is why nothing here debounces per edit.
 *
 * ### What a panel does
 *
 * One line of `LoadSettings`:
 *
 * ```ts
 * const [unitIdx, setUnitIdx] = useState(() => settings.pcbCalculator.board_class_units);
 * ```
 *
 * and one of `SaveSettings`:
 *
 * ```ts
 * useCalcSaveSettings((s) => { s.board_class_units = unitIdx; });
 * ```
 *
 * The reads happen once, at mount, exactly as upstream reads them once when the
 * frame builds the panel — a value arriving from the account later does not
 * reach an open frame upstream either.
 *
 * ### When the write happens
 *
 * `wxEVT_CLOSE_WINDOW` has two stand-ins in a browser and both are used: the
 * frame unmounting, which is the close, and the page becoming *hidden*, which
 * is the last callback a tab is guaranteed (`home/flush_on_hide.ts` explains
 * why not `beforeunload`). A tab destroyed without either — an OS kill — loses
 * the session's calculator inputs, which is the same exposure the project
 * autosave carries and is accepted for the same reason.
 *
 * Every registered saver runs inside **one** `updatePcbCalculator`, so the file
 * is written, stamped and pushed once rather than fourteen times.
 */

import { useEffect, useRef } from 'react';
import { installFlushOnHide } from '../../home/flush_on_hide.js';
import { settings, type PcbCalculatorSettings } from '../../prefs/settings.js';

/** One panel's `SaveSettings`. */
export type CalcSaver = (s: PcbCalculatorSettings) => void;

const savers = new Set<{ fn: CalcSaver }>();

/**
 * Register a panel's `SaveSettings`. Returns the disposer.
 *
 * Boxed rather than stored bare so a panel can replace its closure on every
 * render — the closure has to see the panel's *current* state, which is the
 * whole point of reading the controls at save time.
 */
export function registerCalcSaver(box: { fn: CalcSaver }): () => void {
  savers.add(box);
  return () => {
    savers.delete(box);
  };
}

/**
 * `PCB_CALCULATOR_FRAME::SaveSettings`: every panel, into one settings object.
 *
 * Does nothing when no panel is mounted, so a stray `visibilitychange` from
 * somewhere else in the app cannot rewrite the file with defaults.
 */
export function flushCalcSettings(): void {
  if (savers.size === 0) return;
  const current = [...savers];
  settings.updatePcbCalculator((s) => {
    for (const box of current) box.fn(s);
  });
}

/**
 * Install the stand-ins for `wxEVT_CLOSE_WINDOW`. The returned disposer flushes
 * as it goes, because the frame unmounting *is* the close.
 *
 * Called by the frame, not by a panel: a panel is hidden rather than unmounted
 * when the treebook changes page (`CalculatorTools`), so its own unmount is the
 * frame's.
 */
export function installCalcSettingsFlush(): () => void {
  const uninstallHide = installFlushOnHide(flushCalcSettings);
  return () => {
    uninstallHide();
    flushCalcSettings();
  };
}

/**
 * Register this panel's `SaveSettings` for as long as it is mounted.
 *
 * The callback is re-boxed on every render so it closes over the panel's
 * current state; the registration itself happens once.
 */
export function useCalcSaveSettings(save: CalcSaver): void {
  const box = useRef<{ fn: CalcSaver }>({ fn: save });
  box.current.fn = save;
  useEffect(() => registerCalcSaver(box.current), []);
}

/**
 * Which panel owns which top-level key of `pcb_calculator.json`, and the
 * upstream `LoadSettings`/`SaveSettings` each one mirrors:
 *
 *   board_class_units     panel_board_class        PANEL_BOARD_CLASS
 *   color_code_tolerance  panel_color_code         PANEL_COLOR_CODE
 *   last_page             CalculatorTools          PCB_CALCULATOR_FRAME (:413)
 *   translines            panel_transline          PANEL_TRANSLINE (:70-97)
 *   trans_line            panel_transline          "
 *   attenuators           panel_rf_attenuators     PANEL_RF_ATTENUATORS
 *   electrical            panel_electrical_spacing _IPC2221 and _IEC60664 both
 *   regulators            panel_regulator          PANEL_REGULATOR (:551-611)
 *   cable_size            panel_cable_size         PANEL_CABLE_SIZE
 *   wavelength            panel_wavelength         PANEL_WAVELENGTH
 *   track_width           panel_track_width        PANEL_TRACK_WIDTH
 *   via_size              panel_via_size           PANEL_VIA_SIZE (:180-198)
 *   corrosion_table       panel_galvanic_corrosion PANEL_GALVANIC_CORROSION
 *
 * Prose rather than a table, deliberately. It was a
 * `Record<keyof PcbCalculatorSettings, string>` with a test asserting its keys
 * matched the settings type — but that is precisely what the `Record` already
 * makes the compiler enforce, so the test could not fail, and nothing read the
 * value. Two of CLAUDE.md's four shapes at once.
 */

/**
 * The treebook page index of each calculator, and its inverse.
 *
 * `last_page` is a `wxTreebook` page number, and `wxTreebook::AddPage( nullptr,
 * … )` makes each of the four *group* headings a page too, so the calculators
 * are not 0..13 — Regulators is 1, Electrical Spacing is 4, Wavelength is 10
 * (pcb_calculator_frame.cpp:159-189). Stored as upstream's number rather than
 * as our panel id so the file stays readable as a `pcb_calculator.json`.
 */
export const CALC_PAGE_INDEX: Record<string, number> = {
  regulators: 1,
  r_calculator: 2,
  electrical_spacing: 4,
  via_size: 5,
  track_width: 6,
  fusing_current: 7,
  cable_size: 8,
  wavelength: 10,
  rf_attenuators: 11,
  transmission_lines: 12,
  eseries: 14,
  color_code: 15,
  board_classes: 16,
  galvanic_corrosion: 17,
};

/** The panel id a stored `last_page` selects; the default when it names a group
 *  heading or a page this build does not have. */
export function calcPageFromIndex(index: number): string {
  for (const [id, i] of Object.entries(CALC_PAGE_INDEX)) {
    if (i === index) return id;
  }
  return 'regulators';
}
