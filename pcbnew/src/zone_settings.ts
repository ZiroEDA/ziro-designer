// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/zone_settings.h` / `zone_settings.cpp`: `ZONE_SETTINGS`, used to
 * handle zones parameters in dialogs, and the enums a `ZONE` carries.
 *
 * Not here: `SetupLayersList` (a wxDataViewListCtrl helper) and
 * `LAYER_PROPERTIES_GRID_TABLE` (a wxGrid table); both are dialog chrome.
 */

import { pcbIUScale } from '@ziroeda/common/src/eda_units.js';
import { PCB_LAYER_ID } from '@ziroeda/common/src/layer_ids.js';
import { LSET } from '@ziroeda/common/src/lset.js';
import { ANGLE_0, type EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { type VECTOR2I, equal } from '@ziroeda/kimath/src/math/vector2.js';
import { TEARDROP_TYPE } from './teardrop/teardrop_types.js';
import type { ZONE } from './zone.js';
import {
  ZONE_BORDER_HATCH_DIST_MM,
  ZONE_CLEARANCE_MM,
  ZONE_CONNECTION,
  ZONE_THERMAL_RELIEF_COPPER_WIDTH_MM,
  ZONE_THERMAL_RELIEF_GAP_MM,
  ZONE_THICKNESS_MM,
} from './zones.js';

export enum ZONE_FILL_MODE {
  POLYGONS = 0, // fill zone with polygons
  HATCH_PATTERN = 1, // fill zone using a grid pattern
}

export class ZONE_LAYER_PROPERTIES {
  hatching_offset: VECTOR2I | undefined;

  constructor(hatching_offset?: VECTOR2I) {
    this.hatching_offset = hatching_offset ? { ...hatching_offset } : undefined;
  }

  clone(): ZONE_LAYER_PROPERTIES {
    return new ZONE_LAYER_PROPERTIES(this.hatching_offset);
  }

  equals(aOther: ZONE_LAYER_PROPERTIES): boolean {
    if (this.hatching_offset === undefined || aOther.hatching_offset === undefined)
      return this.hatching_offset === aOther.hatching_offset;

    return equal(this.hatching_offset, aOther.hatching_offset);
  }
}

/// Zone border styles
export enum ZONE_BORDER_DISPLAY_STYLE {
  NO_HATCH = 0,
  DIAGONAL_FULL = 1,
  DIAGONAL_EDGE = 2,
  INVISIBLE_BORDER = 3, // Disable outline drawing for very special cases
}

/// Whether or not to remove isolated islands from a zone
export enum ISLAND_REMOVAL_MODE {
  ALWAYS = 0,
  NEVER = 1,
  AREA = 2,
}

export enum PLACEMENT_SOURCE_T {
  SHEETNAME = 0,
  COMPONENT_CLASS = 1,
  GROUP_PLACEMENT = 2,
  DESIGN_BLOCK = 3,
}

/** `std::map<PCB_LAYER_ID, ZONE_LAYER_PROPERTIES>`, copied by value. */
export type ZONE_LAYER_PROPERTIES_MAP = Map<PCB_LAYER_ID, ZONE_LAYER_PROPERTIES>;

export function cloneLayerProperties(aMap: ZONE_LAYER_PROPERTIES_MAP): ZONE_LAYER_PROPERTIES_MAP {
  const copy: ZONE_LAYER_PROPERTIES_MAP = new Map();

  for (const [layer, props] of aMap) copy.set(layer, props.clone());

  return copy;
}

/** `std::equal` over the two ordered maps, entry by entry (the C++ walks only the first's length). */
function layerPropertiesEqual(a: ZONE_LAYER_PROPERTIES_MAP, b: ZONE_LAYER_PROPERTIES_MAP): boolean {
  const aEntries = [...a.entries()].sort((x, y) => x[0] - y[0]);
  const bEntries = [...b.entries()].sort((x, y) => x[0] - y[0]);

  for (let i = 0; i < aEntries.length; ++i) {
    const other = bEntries[i];

    if (!other) return false;

    if (aEntries[i]![0] !== other[0] || !aEntries[i]![1].equals(other[1])) return false;
  }

  return true;
}

/**
 * ZONE_SETTINGS
 * handles zones parameters.
 * Because a zone can be on copper or non copper layers, and can be also
 * a keepout area, some parameters are irrelevant depending on the type of zone
 */
export class ZONE_SETTINGS {
  // the actual zone outline shape can be slightly modified (smoothed):
  static readonly SMOOTHING_UNDEFINED = -1;
  static readonly SMOOTHING_NONE = 0; // Zone outline is used without change
  static readonly SMOOTHING_CHAMFER = 1; // Zone outline is used after chamfering corners
  static readonly SMOOTHING_FILLET = 2; // Zone outline is used after rounding corners
  static readonly SMOOTHING_LAST = 3; // sentinel

  m_ZonePriority: number; // Priority (0 ... N) of the zone
  m_FillMode: ZONE_FILL_MODE;
  m_ZoneClearance: number; // Minimal clearance value
  m_ZoneMinThickness: number; // Min thickness value in filled areas
  m_HatchThickness: number; // HatchBorder thickness of lines (if 0 -> solid shape)
  m_HatchGap: number; // HatchBorder clearance between lines (0 -> solid shape)
  m_HatchOrientation: EDA_ANGLE; // HatchBorder orientation of grid lines
  m_HatchSmoothingLevel: number; // HatchBorder smoothing type, similar to corner smoothing type
  // 0 = no smoothing, 1 = fillet, >= 2 = arc
  m_HatchSmoothingValue: number; // HatchBorder chamfer/fillet size as a ratio of hole size
  m_HatchHoleMinArea: number; // min size before holes are dropped (ratio)
  m_HatchBorderAlgorithm: number; // 0 = use min zone thickness
  m_Netcode: number; // Net code selection for the current zone
  m_Name: string; // Unique name for the current zone (can be blank)
  m_Layers: LSET; // Layers that this zone exists on

  /// Option to show the zone area (outlines only, short hatches or full hatches
  m_ZoneBorderDisplayStyle: ZONE_BORDER_DISPLAY_STYLE;
  m_BorderHatchPitch: number; // for hatched outlines: dist between 2 hatches

  m_ThermalReliefGap: number; // thickness of the gap in thermal reliefs
  m_ThermalReliefSpokeWidth: number; // thickness of the copper bridge in thermal reliefs

  m_Locked: boolean;

  /* A zone outline can be a teardrop zone with different rules
   * priority, smoothed corners, thermal relief...
   */
  m_TeardropType: TEARDROP_TYPE;

  m_LayerProperties: ZONE_LAYER_PROPERTIES_MAP;

  private m_cornerSmoothingType: number; // Corner smoothing type
  private m_cornerRadius: number; // Corner chamfer distance / fillet radius
  private m_padConnection: ZONE_CONNECTION;

  /*
   * Keepout zones and keepout flags.
   * Note that DRC rules can set keepouts on zones whether they're a keepout or not.
   */
  private m_isRuleArea: boolean;

  /**
   * Placement rule area data
   */
  private m_placementAreaEnabled: boolean;
  private m_placementAreaSourceType: PLACEMENT_SOURCE_T;
  private m_placementAreaSource: string;

  private m_keepoutDoNotAllowZoneFills: boolean;
  private m_keepoutDoNotAllowVias: boolean;
  private m_keepoutDoNotAllowTracks: boolean;
  private m_keepoutDoNotAllowPads: boolean;
  private m_keepoutDoNotAllowFootprints: boolean;

  private m_removeIslands: ISLAND_REMOVAL_MODE;
  private m_minIslandArea: number;

  constructor() {
    this.m_ZonePriority = 0;
    this.m_FillMode = ZONE_FILL_MODE.POLYGONS; // Mode for filling zone
    // Zone clearance value
    this.m_ZoneClearance = pcbIUScale.mmToIU(ZONE_CLEARANCE_MM);
    // Min thickness value in filled areas (this is the minimum width of copper to fill solid areas) :
    this.m_ZoneMinThickness = pcbIUScale.mmToIU(ZONE_THICKNESS_MM);
    // Arbitrary defaults for the hatch settings
    this.m_HatchThickness = Math.max(this.m_ZoneMinThickness * 4, pcbIUScale.mmToIU(1.0));
    this.m_HatchGap = Math.max(this.m_ZoneMinThickness * 6, pcbIUScale.mmToIU(1.5));
    this.m_HatchOrientation = ANGLE_0; // Grid style: orientation of grid lines
    this.m_HatchSmoothingLevel = 0; // Grid pattern smoothing type. 0 = no smoothing
    this.m_HatchSmoothingValue = 0.1; // Grid pattern chamfer value relative to the gap value
    this.m_HatchHoleMinArea = 0.15; // Min size before holes are dropped (ratio of hole size)
    this.m_HatchBorderAlgorithm = 1; // 0 = use zone min thickness; 1 = use hatch width
    this.m_Netcode = 0; // Net code for the current zone
    this.m_ZoneBorderDisplayStyle = ZONE_BORDER_DISPLAY_STYLE.DIAGONAL_EDGE; // Option to show the zone
    // outlines only, short
    // hatches or full hatches

    this.m_BorderHatchPitch = pcbIUScale.mmToIU(ZONE_BORDER_HATCH_DIST_MM);

    this.m_Layers = new LSET().set(PCB_LAYER_ID.F_Cu);
    this.m_Name = '';

    // thickness of the gap in thermal reliefs:
    this.m_ThermalReliefGap = pcbIUScale.mmToIU(ZONE_THERMAL_RELIEF_GAP_MM);
    // thickness of the copper bridge in thermal reliefs:
    this.m_ThermalReliefSpokeWidth = pcbIUScale.mmToIU(ZONE_THERMAL_RELIEF_COPPER_WIDTH_MM);

    this.m_padConnection = ZONE_CONNECTION.THERMAL; // How pads are covered by copper in zone

    this.m_Locked = false;

    this.m_cornerSmoothingType = ZONE_SETTINGS.SMOOTHING_NONE;
    this.m_cornerRadius = 0;

    this.m_removeIslands = ISLAND_REMOVAL_MODE.ALWAYS;
    this.m_minIslandArea = 10 * pcbIUScale.IU_PER_MM * pcbIUScale.IU_PER_MM;

    this.m_isRuleArea = false;
    this.m_placementAreaEnabled = false;
    this.m_placementAreaSourceType = PLACEMENT_SOURCE_T.SHEETNAME;
    this.m_placementAreaSource = '';
    this.m_keepoutDoNotAllowZoneFills = false;
    this.m_keepoutDoNotAllowVias = false;
    this.m_keepoutDoNotAllowTracks = false;
    this.m_keepoutDoNotAllowPads = false;
    this.m_keepoutDoNotAllowFootprints = false;
    this.m_LayerProperties = new Map();

    this.SetIsRuleArea(false);
    this.SetPlacementAreaSourceType(PLACEMENT_SOURCE_T.SHEETNAME);
    this.SetDoNotAllowZoneFills(false);
    this.SetDoNotAllowVias(true);
    this.SetDoNotAllowTracks(true);
    this.SetDoNotAllowPads(true);
    this.SetDoNotAllowFootprints(false);

    this.m_TeardropType = TEARDROP_TYPE.TD_NONE;
    this.m_placementAreaEnabled = false;
  }

  /** `operator==`. */
  equals(aOther: ZONE_SETTINGS): boolean {
    if (this.m_ZonePriority !== aOther.m_ZonePriority) return false;
    if (this.m_FillMode !== aOther.m_FillMode) return false;
    if (this.m_ZoneClearance !== aOther.m_ZoneClearance) return false;
    if (this.m_ZoneMinThickness !== aOther.m_ZoneMinThickness) return false;
    if (this.m_HatchThickness !== aOther.m_HatchThickness) return false;
    if (this.m_HatchGap !== aOther.m_HatchGap) return false;
    if (!this.m_HatchOrientation.equals(aOther.m_HatchOrientation)) return false;
    if (this.m_HatchSmoothingLevel !== aOther.m_HatchSmoothingLevel) return false;
    if (this.m_HatchSmoothingValue !== aOther.m_HatchSmoothingValue) return false;
    if (this.m_HatchBorderAlgorithm !== aOther.m_HatchBorderAlgorithm) return false;
    if (this.m_HatchHoleMinArea !== aOther.m_HatchHoleMinArea) return false;
    if (this.m_Netcode !== aOther.m_Netcode) return false;
    if (this.m_Name !== aOther.m_Name) return false;
    if (this.m_ZoneBorderDisplayStyle !== aOther.m_ZoneBorderDisplayStyle) return false;
    if (this.m_BorderHatchPitch !== aOther.m_BorderHatchPitch) return false;
    if (this.m_ThermalReliefGap !== aOther.m_ThermalReliefGap) return false;
    if (this.m_ThermalReliefSpokeWidth !== aOther.m_ThermalReliefSpokeWidth) return false;
    if (this.m_padConnection !== aOther.m_padConnection) return false;
    if (this.m_cornerSmoothingType !== aOther.m_cornerSmoothingType) return false;
    if (this.m_cornerRadius !== aOther.m_cornerRadius) return false;
    if (this.m_isRuleArea !== aOther.m_isRuleArea) return false;
    if (this.m_placementAreaEnabled !== aOther.m_placementAreaEnabled) return false;
    if (this.m_placementAreaSourceType !== aOther.m_placementAreaSourceType) return false;
    if (this.m_placementAreaSource !== aOther.m_placementAreaSource) return false;
    if (this.m_keepoutDoNotAllowZoneFills !== aOther.m_keepoutDoNotAllowZoneFills) return false;
    if (this.m_keepoutDoNotAllowVias !== aOther.m_keepoutDoNotAllowVias) return false;
    if (this.m_keepoutDoNotAllowTracks !== aOther.m_keepoutDoNotAllowTracks) return false;
    if (this.m_keepoutDoNotAllowPads !== aOther.m_keepoutDoNotAllowPads) return false;
    if (this.m_keepoutDoNotAllowFootprints !== aOther.m_keepoutDoNotAllowFootprints) return false;
    if (this.m_Locked !== aOther.m_Locked) return false;
    if (this.m_removeIslands !== aOther.m_removeIslands) return false;
    if (this.m_minIslandArea !== aOther.m_minIslandArea) return false;

    if (!layerPropertiesEqual(this.m_LayerProperties, aOther.m_LayerProperties)) return false;

    // Currently, the teardrop area type is not really a ZONE_SETTINGS parameter,
    // but a ZONE parameter only.
    // However it can be used in dialogs
    if (this.m_TeardropType !== aOther.m_TeardropType) return false;

    if (!this.m_Layers.equals(aOther.m_Layers)) return false;

    return true;
  }

  /**
   * operator << ( const ZONE& )
   * was Function ImportSetting
   * copies settings from a given zone into this object.
   * @param aSource: the given zone
   */
  importFrom(aSource: ZONE): this {
    this.m_ZonePriority = aSource.GetAssignedPriority();
    this.m_FillMode = aSource.GetFillMode();
    this.m_ZoneClearance = aSource.GetLocalClearance()!;
    this.m_ZoneMinThickness = aSource.GetMinThickness();
    this.m_HatchThickness = aSource.GetHatchThickness();
    this.m_HatchGap = aSource.GetHatchGap();
    this.m_HatchOrientation = aSource.GetHatchOrientation();
    this.m_HatchSmoothingLevel = aSource.GetHatchSmoothingLevel();
    this.m_HatchSmoothingValue = aSource.GetHatchSmoothingValue();
    this.m_HatchBorderAlgorithm = aSource.GetHatchBorderAlgorithm();
    this.m_HatchHoleMinArea = aSource.GetHatchHoleMinArea();
    this.m_Netcode = aSource.GetNetCode();
    this.m_Name = aSource.GetZoneName();
    this.m_ZoneBorderDisplayStyle = aSource.GetHatchStyle();
    this.m_BorderHatchPitch = aSource.GetBorderHatchPitch();
    this.m_ThermalReliefGap = aSource.GetThermalReliefGap();
    this.m_ThermalReliefSpokeWidth = aSource.GetThermalReliefSpokeWidth();
    this.m_padConnection = aSource.GetPadConnection();
    this.m_cornerSmoothingType = aSource.GetCornerSmoothingType();
    this.m_cornerRadius = aSource.GetCornerRadius();
    this.m_isRuleArea = aSource.GetIsRuleArea();
    this.m_placementAreaEnabled = aSource.GetPlacementAreaEnabled();
    this.m_placementAreaSourceType = aSource.GetPlacementAreaSourceType();
    this.m_placementAreaSource = aSource.GetPlacementAreaSource();
    this.m_keepoutDoNotAllowZoneFills = aSource.GetDoNotAllowZoneFills();
    this.m_keepoutDoNotAllowVias = aSource.GetDoNotAllowVias();
    this.m_keepoutDoNotAllowTracks = aSource.GetDoNotAllowTracks();
    this.m_keepoutDoNotAllowPads = aSource.GetDoNotAllowPads();
    this.m_keepoutDoNotAllowFootprints = aSource.GetDoNotAllowFootprints();
    this.m_Locked = aSource.IsLocked();
    this.m_removeIslands = aSource.GetIslandRemovalMode();
    this.m_minIslandArea = aSource.GetMinIslandArea();
    this.m_LayerProperties = cloneLayerProperties(aSource.LayerProperties());

    // Currently, the teardrop area type is not really a ZONE_SETTINGS parameter,
    // but a ZONE parameter only.
    // However it can be used in dialogs
    this.m_TeardropType = aSource.GetTeardropAreaType();

    this.m_Layers = new LSET(aSource.GetLayerSet());

    return this;
  }

  /**
   * @return Default ZONE_SETTINGS
   */
  static GetDefaultSettings(): ZONE_SETTINGS {
    return defaultSettings;
  }

  /**
   * Function ExportSetting
   * copy settings to a given zone
   * @param aTarget: the given zone
   * @param aFullExport: if false: some parameters are NOT exported
   *   because they must not be  exported when export settings from a zone to others zones
   *   Currently: m_ZonePriority, m_Layers & m_LayersProperties, m_Name and m_Netcode
   */
  ExportSetting(aTarget: ZONE, aFullExport = true): void {
    aTarget.SetFillMode(this.m_FillMode);
    aTarget.SetLocalClearance(this.m_ZoneClearance);
    aTarget.SetMinThickness(this.m_ZoneMinThickness);
    aTarget.SetHatchThickness(this.m_HatchThickness);
    aTarget.SetHatchGap(this.m_HatchGap);
    aTarget.SetHatchOrientation(this.m_HatchOrientation);
    aTarget.SetHatchSmoothingLevel(this.m_HatchSmoothingLevel);
    aTarget.SetHatchSmoothingValue(this.m_HatchSmoothingValue);
    aTarget.SetHatchBorderAlgorithm(this.m_HatchBorderAlgorithm);
    aTarget.SetHatchHoleMinArea(this.m_HatchHoleMinArea);
    aTarget.SetThermalReliefGap(this.m_ThermalReliefGap);
    aTarget.SetThermalReliefSpokeWidth(this.m_ThermalReliefSpokeWidth);
    aTarget.SetPadConnection(this.m_padConnection);
    aTarget.SetCornerSmoothingType(this.m_cornerSmoothingType);
    aTarget.SetCornerRadius(this.m_cornerRadius);
    aTarget.SetIsRuleArea(this.GetIsRuleArea());
    aTarget.SetPlacementAreaEnabled(this.GetPlacementAreaEnabled());
    aTarget.SetPlacementAreaSourceType(this.GetPlacementAreaSourceType());
    aTarget.SetPlacementAreaSource(this.GetPlacementAreaSource());
    aTarget.SetDoNotAllowZoneFills(this.GetDoNotAllowZoneFills());
    aTarget.SetDoNotAllowVias(this.GetDoNotAllowVias());
    aTarget.SetDoNotAllowTracks(this.GetDoNotAllowTracks());
    aTarget.SetDoNotAllowPads(this.GetDoNotAllowPads());
    aTarget.SetDoNotAllowFootprints(this.GetDoNotAllowFootprints());
    aTarget.SetLocked(this.m_Locked);
    aTarget.SetIslandRemovalMode(this.GetIslandRemovalMode());
    aTarget.SetMinIslandArea(this.GetMinIslandArea());

    // Currently, the teardrop area type is not imported from a ZONE_SETTINGS, because
    // it is not really a ZONE_SETTINGS parameter, but a ZONE parameter only
    // #if 0
    // aTarget.SetTeardropAreaType( m_TeardropType );
    // #endif

    if (aFullExport) {
      aTarget.SetAssignedPriority(this.m_ZonePriority);
      aTarget.SetLayerProperties(this.m_LayerProperties);
      aTarget.SetLayerSet(this.m_Layers);
      aTarget.SetZoneName(this.m_Name);

      if (!this.m_isRuleArea) aTarget.SetNetCode(this.m_Netcode);
    }

    // call SetBorderDisplayStyle last, because hatch lines will be rebuilt,
    // using new parameters values
    aTarget.SetBorderDisplayStyle(this.m_ZoneBorderDisplayStyle, this.m_BorderHatchPitch, true);
  }

  /**
   * Function CopyFrom
   * copy settings from a different ZONE_SETTINGS object
   *
   * @param aOther the other ZONE_SETTINGS
   * @param aCopyFull if false: some parameters are not copied.
   * This option is used specifically to copy zone settings from
   * a zone to the default zone settings.
   * There, the layer information is not needed, plus layer specific
   * properties should not be overridden in the zone default settings.
   */
  CopyFrom(aOther: ZONE_SETTINGS, aCopyFull = true): void {
    this.m_ZonePriority = aOther.m_ZonePriority;
    this.m_FillMode = aOther.m_FillMode;
    this.m_ZoneClearance = aOther.m_ZoneClearance;
    this.m_ZoneMinThickness = aOther.m_ZoneMinThickness;
    this.m_HatchThickness = aOther.m_HatchThickness;
    this.m_HatchGap = aOther.m_HatchGap;
    this.m_HatchOrientation = aOther.m_HatchOrientation;
    this.m_HatchSmoothingLevel = aOther.m_HatchSmoothingLevel;
    this.m_HatchSmoothingValue = aOther.m_HatchSmoothingValue;
    this.m_HatchBorderAlgorithm = aOther.m_HatchBorderAlgorithm;
    this.m_HatchHoleMinArea = aOther.m_HatchHoleMinArea;
    this.m_Netcode = aOther.m_Netcode;
    this.m_Name = aOther.m_Name;
    this.m_ZoneBorderDisplayStyle = aOther.m_ZoneBorderDisplayStyle;
    this.m_BorderHatchPitch = aOther.m_BorderHatchPitch;
    this.m_ThermalReliefGap = aOther.m_ThermalReliefGap;
    this.m_ThermalReliefSpokeWidth = aOther.m_ThermalReliefSpokeWidth;
    this.m_padConnection = aOther.m_padConnection;
    this.m_cornerSmoothingType = aOther.m_cornerSmoothingType;
    this.m_cornerRadius = aOther.m_cornerRadius;
    this.m_isRuleArea = aOther.m_isRuleArea;
    this.m_placementAreaEnabled = aOther.m_placementAreaEnabled;
    this.m_placementAreaSourceType = aOther.m_placementAreaSourceType;
    this.m_placementAreaSource = aOther.m_placementAreaSource;
    this.m_keepoutDoNotAllowZoneFills = aOther.m_keepoutDoNotAllowZoneFills;
    this.m_keepoutDoNotAllowVias = aOther.m_keepoutDoNotAllowVias;
    this.m_keepoutDoNotAllowTracks = aOther.m_keepoutDoNotAllowTracks;
    this.m_keepoutDoNotAllowPads = aOther.m_keepoutDoNotAllowPads;
    this.m_keepoutDoNotAllowFootprints = aOther.m_keepoutDoNotAllowFootprints;
    this.m_Locked = aOther.m_Locked;
    this.m_removeIslands = aOther.m_removeIslands;
    this.m_minIslandArea = aOther.m_minIslandArea;
    this.m_LayerProperties = cloneLayerProperties(aOther.m_LayerProperties);

    if (aCopyFull) {
      this.m_TeardropType = aOther.m_TeardropType;
      this.m_Layers = new LSET(aOther.m_Layers);
    }
  }

  /** The copy the C++ value semantics give (`ZONE_SETTINGS( const ZONE_SETTINGS& )`). */
  clone(): ZONE_SETTINGS {
    const copy = new ZONE_SETTINGS();
    copy.CopyFrom(this, true);
    return copy;
  }

  SetCornerSmoothingType(aType: number): void {
    this.m_cornerSmoothingType = aType;
  }
  GetCornerSmoothingType(): number {
    return this.m_cornerSmoothingType;
  }

  SetCornerRadius(aRadius: number): void {
    if (aRadius < 0) this.m_cornerRadius = 0;
    else this.m_cornerRadius = aRadius;
  }
  GetCornerRadius(): number {
    return this.m_cornerRadius;
  }

  GetPadConnection(): ZONE_CONNECTION {
    return this.m_padConnection;
  }
  SetPadConnection(aPadConnection: ZONE_CONNECTION): void {
    this.m_padConnection = aPadConnection;
  }

  /**
   * Accessor to determine if any keepout parameters are set
   */
  HasKeepoutParametersSet(): boolean {
    return (
      this.m_keepoutDoNotAllowTracks ||
      this.m_keepoutDoNotAllowVias ||
      this.m_keepoutDoNotAllowPads ||
      this.m_keepoutDoNotAllowFootprints ||
      this.m_keepoutDoNotAllowZoneFills
    );
  }

  /**
   * Accessors to parameters used in Rule Area zones:
   */
  GetPlacementAreaEnabled(): boolean {
    return this.m_placementAreaEnabled;
  }
  GetPlacementAreaSourceType(): PLACEMENT_SOURCE_T {
    return this.m_placementAreaSourceType;
  }
  GetPlacementAreaSource(): string {
    return this.m_placementAreaSource;
  }
  GetIsRuleArea(): boolean {
    return this.m_isRuleArea;
  }
  GetDoNotAllowZoneFills(): boolean {
    return this.m_keepoutDoNotAllowZoneFills;
  }
  GetDoNotAllowVias(): boolean {
    return this.m_keepoutDoNotAllowVias;
  }
  GetDoNotAllowTracks(): boolean {
    return this.m_keepoutDoNotAllowTracks;
  }
  GetDoNotAllowPads(): boolean {
    return this.m_keepoutDoNotAllowPads;
  }
  GetDoNotAllowFootprints(): boolean {
    return this.m_keepoutDoNotAllowFootprints;
  }

  SetPlacementAreaEnabled(aEnabled: boolean): void {
    this.m_placementAreaEnabled = aEnabled;
  }
  SetPlacementAreaSourceType(aType: PLACEMENT_SOURCE_T): void {
    this.m_placementAreaSourceType = aType;
  }
  SetPlacementAreaSource(aSource: string): void {
    this.m_placementAreaSource = aSource;
  }
  SetIsRuleArea(aEnable: boolean): void {
    this.m_isRuleArea = aEnable;
  }
  SetDoNotAllowZoneFills(aEnable: boolean): void {
    this.m_keepoutDoNotAllowZoneFills = aEnable;
  }
  SetDoNotAllowVias(aEnable: boolean): void {
    this.m_keepoutDoNotAllowVias = aEnable;
  }
  SetDoNotAllowTracks(aEnable: boolean): void {
    this.m_keepoutDoNotAllowTracks = aEnable;
  }
  SetDoNotAllowPads(aEnable: boolean): void {
    this.m_keepoutDoNotAllowPads = aEnable;
  }
  SetDoNotAllowFootprints(aEnable: boolean): void {
    this.m_keepoutDoNotAllowFootprints = aEnable;
  }

  GetIslandRemovalMode(): ISLAND_REMOVAL_MODE {
    return this.m_removeIslands;
  }
  SetIslandRemovalMode(aRemove: ISLAND_REMOVAL_MODE): void {
    this.m_removeIslands = aRemove;
  }

  GetMinIslandArea(): number {
    return this.m_minIslandArea;
  }
  SetMinIslandArea(aArea: number): void {
    this.m_minIslandArea = aArea;
  }
}

/** `static ZONE_SETTINGS defaultSettings` of `GetDefaultSettings()`. */
const defaultSettings = new ZONE_SETTINGS();
