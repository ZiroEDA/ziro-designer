// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/zones.h`: the zone defaults and `ZONE_CONNECTION`. The dialog
 * invokers the header also declares are UI.
 */

// Default values in mm for parameters in ZONE_SETTINGS
export const ZONE_THERMAL_RELIEF_GAP_MM = 0.5; // ZONE_SETTINGS::m_ThermalReliefGap
export const ZONE_THERMAL_RELIEF_COPPER_WIDTH_MM = 0.5; // ZONE_SETTINGS::m_ThermalReliefCopperBridge
export const ZONE_THICKNESS_MM = 0.25; // ZONE_SETTINGS::m_ZoneMinThickness
export const ZONE_THICKNESS_MIN_VALUE_MM = 0.025; // Minimum for ZONE_SETTINGS::m_ZoneMinThickness
export const ZONE_CLEARANCE_MM = 0.5; // ZONE_SETTINGS::m_ZoneClearance
export const ZONE_CLEARANCE_MAX_VALUE_MM = 100; // Maximum for ZONE_SETTINGS::m_ZoneClearance
export const ZONE_BORDER_HATCH_DIST_MM = 0.5; // ZONE_SETTINGS::m_BorderHatchPitch
export const ZONE_BORDER_HATCH_MINDIST_MM = 0.1; // Minimum for ZONE_SETTINGS::m_BorderHatchPitch
export const ZONE_BORDER_HATCH_MAXDIST_MM = 2.0; // Maximum for ZONE_SETTINGS::m_BorderHatchPitch

export const ZONE_MANAGER_REPOUR = 1005; //Reported if repour option is checked while clicking OK

/// How pads are covered by copper in zone
export enum ZONE_CONNECTION {
  INHERITED = -1,
  NONE = 0, ///< Pads are not covered
  THERMAL = 1, ///< Use thermal relief for pads
  FULL = 2, ///< pads are covered by copper
  THT_THERMAL = 3, ///< Thermal relief only for THT pads
}

export function PrintZoneConnection(aConnection: ZONE_CONNECTION): string {
  switch (aConnection) {
    default:
    case ZONE_CONNECTION.INHERITED:
      return 'inherited';
    case ZONE_CONNECTION.NONE:
      return 'none';
    case ZONE_CONNECTION.THERMAL:
      return 'thermal reliefs';
    case ZONE_CONNECTION.FULL:
      return 'solid';
    case ZONE_CONNECTION.THT_THERMAL:
      return 'thermal reliefs for PTH';
  }
}
