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
import { Combo } from '@ziroeda/common/widgets/wx_combobox.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import type { BOARD } from '../board.js';
import { ISLAND_REMOVAL_MODE, ZONE_BORDER_DISPLAY_STYLE } from '../zone_settings.js';
import { ZONE_CONNECTION } from '../zones.js';

export interface ZoneDefaults {
  name: string;
  clearanceMM: number;
  minWidthMM: number;
  padConnection: string;
  thermalGapMM: number;
  thermalSpokeMM: number;
  outlineDisplay: string;
  outlineHatchPitchMM: number;
  cornerSmoothing: string;
  smoothingRadiusMM: number;
  removeIslands: string;
  areaLimitMM2: number;
  locked: boolean;
}

// The choices' labels indexed by the enum each stores (the combos list them in
// their own display order below).
/** ZONE_CONNECTION: NONE=0, THERMAL=1, FULL=2, THT_THERMAL=3. */
const PAD_CONNECTION_OF: readonly string[] = [
  'None',
  'Thermal reliefs',
  'Solid',
  'Reliefs for PTH',
];
/** ZONE_BORDER_DISPLAY_STYLE: NO_HATCH=0, DIAGONAL_FULL=1, DIAGONAL_EDGE=2. */
const BORDER_STYLE_OF: readonly string[] = ['Line', 'Fully hatched', 'Hatched'];
/** ZONE_SETTINGS::SMOOTHING_NONE 0, SMOOTHING_CHAMFER 1, SMOOTHING_FILLET 2. */
const CORNER_SMOOTHING_OF: readonly string[] = ['None', 'Chamfer', 'Fillet'];
/** ISLAND_REMOVAL_MODE: ALWAYS=0, NEVER=1, AREA=2. */
const ISLAND_REMOVAL_OF: readonly string[] = ['Always', 'Never', 'Below area limit'];

/** A choice's selection index, or `aFallback` when the label is not one of them. */
const selectionOf = (aList: readonly string[], aLabel: string, aFallback: number): number => {
  const i = aList.indexOf(aLabel);
  return i < 0 ? aFallback : i;
};

/**
 * PANEL_SETUP_ZONES's transfers (panel_setup_zones.cpp): the board's default
 * ZONE_SETTINGS through PANEL_ZONE_PROPERTIES.
 */
export const PANEL_SETUP_ZONES = {
  TransferDataToWindow(aBoard: BOARD): ZoneDefaults {
    const zs = aBoard.GetDesignSettings().GetDefaultZoneSettings();
    const mm = (iu: number): number => pcbIUScale.iuToMM(iu);
    return {
      name: zs.m_Name,
      clearanceMM: mm(zs.m_ZoneClearance),
      minWidthMM: mm(zs.m_ZoneMinThickness),
      padConnection: PAD_CONNECTION_OF[zs.GetPadConnection()] ?? 'Thermal reliefs',
      thermalGapMM: mm(zs.m_ThermalReliefGap),
      thermalSpokeMM: mm(zs.m_ThermalReliefSpokeWidth),
      outlineDisplay: BORDER_STYLE_OF[zs.m_ZoneBorderDisplayStyle] ?? 'Hatched',
      outlineHatchPitchMM: mm(zs.m_BorderHatchPitch),
      cornerSmoothing: CORNER_SMOOTHING_OF[zs.GetCornerSmoothingType()] ?? 'None',
      smoothingRadiusMM: mm(zs.GetCornerRadius()),
      removeIslands: ISLAND_REMOVAL_OF[zs.GetIslandRemovalMode()] ?? 'Always',
      areaLimitMM2: zs.GetMinIslandArea() / (pcbIUScale.IU_PER_MM * pcbIUScale.IU_PER_MM),
      locked: zs.m_Locked,
    };
  },

  /** `PANEL_ZONE_PROPERTIES::TransferZoneSettingsFromWindow`, into the board's defaults. */
  TransferDataFromWindow(z: ZoneDefaults, aBoard: BOARD): void {
    const bds = aBoard.GetDesignSettings();
    const iu = (mm: number): number => pcbIUScale.mmToIU(mm);
    const zs = bds.GetDefaultZoneSettings().clone();
    zs.m_Name = z.name;
    zs.m_ZoneClearance = iu(z.clearanceMM);
    zs.m_ZoneMinThickness = iu(z.minWidthMM);
    zs.SetPadConnection(
      selectionOf(PAD_CONNECTION_OF, z.padConnection, ZONE_CONNECTION.THERMAL) as ZONE_CONNECTION,
    );
    zs.m_ThermalReliefGap = iu(z.thermalGapMM);
    zs.m_ThermalReliefSpokeWidth = iu(z.thermalSpokeMM);
    zs.m_ZoneBorderDisplayStyle = selectionOf(
      BORDER_STYLE_OF,
      z.outlineDisplay,
      ZONE_BORDER_DISPLAY_STYLE.DIAGONAL_EDGE,
    ) as ZONE_BORDER_DISPLAY_STYLE;
    zs.m_BorderHatchPitch = iu(z.outlineHatchPitchMM);
    zs.SetCornerSmoothingType(selectionOf(CORNER_SMOOTHING_OF, z.cornerSmoothing, 0));
    zs.SetCornerRadius(iu(z.smoothingRadiusMM));
    zs.SetIslandRemovalMode(
      selectionOf(
        ISLAND_REMOVAL_OF,
        z.removeIslands,
        ISLAND_REMOVAL_MODE.ALWAYS,
      ) as ISLAND_REMOVAL_MODE,
    );
    zs.SetMinIslandArea(Math.trunc(z.areaLimitMM2 * pcbIUScale.IU_PER_MM * pcbIUScale.IU_PER_MM));
    zs.m_Locked = z.locked;
    bds.SetDefaultZoneSettings(zs);
  },
};

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
