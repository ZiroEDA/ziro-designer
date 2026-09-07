// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * "Default Properties for New Zones". Counterpart:
 * `pcbnew/dialogs/panel_setup_zones_base.cpp` (PANEL_SETUP_ZONES) — a heading, a
 * `wxStaticLine`, and an embedded PANEL_ZONE_PROPERTIES: the settings a newly
 * drawn copper zone starts with (clearance, minimum width, pad connection +
 * thermal relief, outline display, corner smoothing, island removal).
 *
 * In KiCad 10 this is NOT a page of its own. `PANEL_SETUP_DEFAULTS` builds it
 * as the third block of the Text & Graphics > Defaults page, under Text &
 * Graphics and Dimensions (`panel_setup_defaults.cpp:41-48`), which is where
 * `dialog_board_setup.tsx` now renders it; the standalone "Zones" row this used
 * to have exists in no version of the Board Setup tree.
 *
 * NOT PORTED YET: PANEL_ZONE_PROPERTIES' net name, hatched-fill block
 * (orientation, hatch width/gap, smoothing effort and amount) and hatch-offset
 * overrides. See BOARD_SETUP_STATUS.md.
 */

import type { JSX } from 'react';
import { Combo } from '../../../../ui/Combo.js';
import type { ZoneDefaults } from '../../board_settings.js';

// The data model lives in board_settings.ts (KiCad's data/UI split);
// re-exported so panel users keep importing from the panel module.
export { defaultZones, type ZoneDefaults } from '../../board_settings.js';

const PAD_CONNECTIONS = ['Solid', 'Thermal reliefs', 'Reliefs for PTH', 'None'];
const OUTLINE_DISPLAY = ['Line', 'Hatched', 'Fully hatched'];
const CORNER_SMOOTHING = ['None', 'Chamfer', 'Fillet'];
const REMOVE_ISLANDS = ['Always', 'Never', 'Below area limit'];

interface Props {
  value: ZoneDefaults;
  onChange: (next: ZoneDefaults) => void;
}

export function PanelPcbZones({ value, onChange }: Props): JSX.Element {
  const num = (s: string): number => (Number.isFinite(Number(s)) ? Number(s) : 0);
  const set = <K extends keyof ZoneDefaults>(k: K, v: ZoneDefaults[K]): void =>
    onChange({ ...value, [k]: v });

  const numRow = (label: string, key: keyof ZoneDefaults, unit: string): JSX.Element => (
    <div className="ze-pref-row" key={key}>
      <span className="lbl">{label}</span>
      <input
        className="ze-search"
        value={value[key] as number}
        onChange={(e) => set(key, num(e.target.value) as never)}
      />
      <span className="unit">{unit}</span>
    </div>
  );
  const selRow = (label: string, key: keyof ZoneDefaults, options: string[]): JSX.Element => (
    // Not a <label>: `Combo` is a button, and a button inside a label toggles
    // the popup open and shut on one click.
    <div className="ze-pref-row" key={key}>
      <span className="lbl">{label}</span>
      <Combo
        value={value[key] as string}
        ariaLabel={label}
        options={options.map((o) => ({ value: o, label: o }))}
        onChange={(o) => set(key, o as never)}
      />
    </div>
  );

  return (
    <div>
      <div className="ze-pref-group-title">Default Properties for New Zones</div>
      <div className="ze-zonedef-cols">
        <div className="ze-pref-group-body">
          <div className="ze-pref-row">
            <span className="lbl">Zone name:</span>
            <input
              className="ze-search"
              value={value.name}
              onChange={(e) => set('name', e.target.value)}
            />
          </div>
          {numRow('Clearance:', 'clearanceMM', 'mm')}
          {numRow('Minimum width:', 'minWidthMM', 'mm')}
          {selRow('Pad connections:', 'padConnection', PAD_CONNECTIONS)}
          {numRow('Thermal relief gap:', 'thermalGapMM', 'mm')}
          {numRow('Thermal spoke width:', 'thermalSpokeMM', 'mm')}
        </div>

        <div className="ze-pref-group-body">
          {selRow('Outline display:', 'outlineDisplay', OUTLINE_DISPLAY)}
          {numRow('Outline hatch pitch:', 'outlineHatchPitchMM', 'mm')}
          {selRow('Corner smoothing:', 'cornerSmoothing', CORNER_SMOOTHING)}
          {numRow('Radius:', 'smoothingRadiusMM', 'mm')}
          {selRow('Remove islands:', 'removeIslands', REMOVE_ISLANDS)}
          {numRow('Area limit:', 'areaLimitMM2', 'mm²')}
          <label className="ze-pref-check ze-border-top">
            <input
              type="checkbox"
              checked={value.locked}
              onChange={(e) => set('locked', e.target.checked)}
            />
            Locked
          </label>
        </div>
      </div>
    </div>
  );
}
