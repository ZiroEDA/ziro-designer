// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Copper Zone Properties, headless.
 * Counterparts: `pcbnew/dialogs/dialog_copper_zones.cpp` (the frame) and
 * `pcbnew/dialogs/panel_zone_properties.cpp` (every field it edits).
 *
 * Unlike Track & Via Properties this is a single-zone dialog upstream, so there
 * is no three-state fold: the form is seeded from one zone and every field
 * carries a value. What it shares with #204 is the discipline that matters —
 * each applied field patches the zone's source node in step, because the writer
 * emits a stored source verbatim and a model-only change would never reach the
 * file.
 *
 * The zone's *outline* is not edited here; that is the point editor's job.
 */

import { parseBoardItemId } from '../edit-board.js';
import type { Board, PcbZone, RuleAreaKeepout, ZonePlacementArea } from '../types.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { LSET_Name, LSET_NameToLayer } from '@ziroeda/common/layer_ids.js';
import { LSET } from '@ziroeda/common/lset.js';
import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { BOARD_COMMIT, SKIP_CONNECTIVITY } from '../board_commit.js';
import { ORPHANED_NET } from '../netinfo.js';
import type { PCB_BASE_EDIT_FRAME } from '../pcb_base_edit_frame.js';
import { layerSetOfTokens, layerTokens } from '../pcb_io/kicad_sexpr/board_view.js';
import type { BOARD } from '../board.js';
import type { ZONE } from '../zone.js';
import type { ZONE_SETTINGS_BAG } from '../zone_settings_bag.js';
import { TEARDROP_TYPE } from '../teardrop/teardrop_parameters.js';
import {
  ZONE_BORDER_DISPLAY_STYLE,
  ZONE_FILL_MODE,
  ZONE_LAYER_PROPERTIES,
  ZONE_SETTINGS,
} from '../zone_settings.js';
import {
  ZONE_BORDER_HATCH_MAXDIST_MM,
  ZONE_BORDER_HATCH_MINDIST_MM,
  ZONE_CLEARANCE_MAX_VALUE_MM,
  ZONE_CONNECTION,
  ZONE_THICKNESS_MIN_VALUE_MM,
} from '../zones.js';
import type { TransferResult } from './dialog_text_properties.js';
import type { CONVERT_SETTINGS } from '../pcbnew_settings.js';
import { CONVERSION_BOX, type ConversionBoxValues } from '../tools/convert_settings_dialog.js';

/** Every field PANEL_ZONE_PROPERTIES edits. */
export interface ZoneValues {
  /** `(name "…")`, the handle DRC rules use. */
  name: string;
  net: number;
  layers: string[];
  locked: boolean;
  /** `(connect_pads (clearance …))`, IU. */
  clearance: number;
  /** `(min_thickness …)`, IU. */
  minThickness: number;
  padConnection: NonNullable<PcbZone['padConnection']>;
  /** `(fill … (thermal_gap …))`, IU. */
  thermalGap: number;
  /** `(fill … (thermal_bridge_width …))`, IU. */
  thermalBridgeWidth: number;
  /** Border display: `(hatch none|edge|full <pitch>)`. */
  hatchStyle: NonNullable<PcbZone['hatchStyle']>;
  hatchPitch: number;
  cornerSmoothing: NonNullable<PcbZone['cornerSmoothing']>;
  cornerRadius: number;
  islandRemovalMode: NonNullable<PcbZone['islandRemovalMode']>;
  /** `(fill … (island_area_min …))` in mm², as the file stores it. */
  islandAreaMin: number;
  fillMode: NonNullable<PcbZone['fillMode']>;
  /** Hatched-fill parameters, live only when `fillMode` is `hatch`. */
  hatchThickness: number;
  hatchGap: number;
  hatchOrientation: number;
  hatchSmoothingLevel: number;
  hatchSmoothingValue: number;
  /** `(fill … (hatch_min_hole_area …))`, a fraction of a full grid hole. */
  hatchHoleMinArea: number;
  /** `(fill yes)` — whether the zone is poured at all. */
  filled: boolean;
  priority: number;
  /**
   * The Hatched Fill tab's "Hatch offset overrides" grid — this zone's OWN
   * per-layer hatch origins (`ZONE::LayerProperties()`), keyed by canonical
   * layer name. A layer absent here falls back to Board Setup's own page.
   *
   * `PANEL_ZONE_PROPERTIES` edits it through an add/remove grid rather than
   * listing every copper layer, which is why "All zone layers already
   * overridden" is a message it can put up.
   */
  layerProperties: Record<string, { x: number; y: number }>;
}

/** ZONE_SETTINGS' defaults, for a zone whose file omitted a field. */
const DEFAULTS = {
  clearance: 500_000,
  minThickness: 250_000,
  thermalGap: 500_000,
  thermalBridgeWidth: 500_000,
  hatchPitch: 500_000,
} as const;

/** Resolve a `zone:N` id, or null when the selection is not a single zone. */
export function zoneAt(board: Board, selection: Iterable<string>): number | null {
  let found: number | null = null;

  for (const id of selection) {
    const ref = parseBoardItemId(id);
    if (!ref || ref.kind !== 'zone') continue;
    // Upstream's dialog edits exactly one zone; more than one is ambiguous.
    if (found !== null) return null;
    if (board.zones[ref.index]) found = ref.index;
  }

  return found;
}

/** PANEL_ZONE_PROPERTIES::TransferDataToWindow. */
export function collectZoneValues(zone: PcbZone): ZoneValues {
  return {
    name: zone.name ?? '',
    net: zone.net,
    layers: [...zone.layers],
    locked: zone.locked ?? false,
    clearance: zone.clearance ?? DEFAULTS.clearance,
    minThickness: zone.minThickness ?? DEFAULTS.minThickness,
    padConnection: zone.padConnection ?? 'thermal',
    thermalGap: zone.thermalGap ?? DEFAULTS.thermalGap,
    thermalBridgeWidth: zone.thermalBridgeWidth ?? DEFAULTS.thermalBridgeWidth,
    hatchStyle: zone.hatchStyle ?? 'edge',
    hatchPitch: zone.hatchPitch || DEFAULTS.hatchPitch,
    cornerSmoothing: zone.cornerSmoothing ?? 'none',
    cornerRadius: zone.cornerRadius ?? 0,
    islandRemovalMode: zone.islandRemovalMode ?? 'always',
    islandAreaMin: zone.islandAreaMin ?? 10,
    fillMode: zone.fillMode ?? 'solid',
    hatchThickness: zone.hatchThickness ?? 0,
    hatchGap: zone.hatchGap ?? 0,
    hatchOrientation: zone.hatchOrientation ?? 0,
    hatchSmoothingLevel: zone.hatchSmoothingLevel ?? 0,
    hatchSmoothingValue: zone.hatchSmoothingValue ?? 0,
    // `ZONE_SETTINGS::m_HatchHoleMinArea` defaults to 0.3.
    hatchHoleMinArea: zone.hatchHoleMinArea ?? 0.3,
    filled: zone.filled !== false,
    priority: zone.priority ?? 0,
    layerProperties: { ...(zone.layerProperties ?? {}) },
  };
}

/**
 * `ZONE_CREATE_HELPER::setUniquePriority` (zone_create_helper.cpp:55-83) — the
 * priority a newly drawn copper zone opens with.
 *
 * The **first unused** priority, not one past the highest: the priorities in
 * use go into a `std::set`, which iterates ascending, and the loop stops at
 * the first index that does not match its own value. So with 0, 1 and 3 taken
 * the answer is 2.
 *
 * Only zones that compete for the same copper are counted — a teardrop is
 * generated copper the filler owns, and a rule area is never poured.
 */
export function uniqueZonePriority(board: Board): number {
  const priorities = new Set<number>();

  for (const zone of board.zones) {
    if (zone.teardropType !== undefined) continue;
    if (zone.ruleArea !== undefined) continue;
    if (!zone.layers.some((l) => /\.Cu$/.test(l))) continue;
    priorities.add(zone.priority ?? 0);
  }

  let priority = 0;
  for (const existing of [...priorities].sort((a, b) => a - b)) {
    if (priority !== existing) break;
    priority++;
  }

  return priority;
}

/**
 * The rule-area halves of a zone: `(keepout …)`'s five do-not-allow flags and
 * `(placement …)`'s three fields, which `PANEL_ZONE_PROPERTIES` does not edit
 * and ZONE_DESC does (zone.cpp:2131-2174, groups "Keepout" and "Placement").
 *
 * Kept apart from {@link applyZoneValues} because they belong to a different
 * dialog upstream (DIALOG_RULE_AREA_PROPERTIES) and because a copper zone has
 * neither node — writing one would turn it into a rule area.
 */
export function applyZoneRuleArea(
  board: Board,
  index: number,
  patch: { keepout?: Partial<RuleAreaKeepout>; placement?: Partial<ZonePlacementArea> },
): Board {
  const zone = board.zones[index];
  if (!zone?.ruleArea) return board;

  const ruleArea: RuleAreaKeepout = { ...zone.ruleArea, ...patch.keepout };
  const placement: ZonePlacementArea | undefined = zone.placementArea
    ? { ...zone.placementArea, ...patch.placement }
    : undefined;

  return {
    ...board,
    zones: board.zones.map((z, i) =>
      i === index ? { ...z, ruleArea, placementArea: placement } : z,
    ),
  };
}

/**
 * PANEL_ZONE_PROPERTIES::TransferDataFromWindow, patching the source in step.
 *
 * Returns the board unchanged when nothing moved, so an OK on an untouched
 * dialog does not push an undo entry.
 */
export function applyZoneValues(board: Board, index: number, v: ZoneValues): Board {
  const zone = board.zones[index];
  if (!zone) return board;

  const next: PcbZone = {
    ...zone,
    name: v.name === '' ? undefined : v.name,
    net: v.net,
    layers: [...v.layers],
    locked: v.locked,
    clearance: v.clearance,
    minThickness: v.minThickness,
    padConnection: v.padConnection,
    thermalGap: v.thermalGap,
    thermalBridgeWidth: v.thermalBridgeWidth,
    hatchStyle: v.hatchStyle,
    hatchPitch: v.hatchPitch,
    cornerSmoothing: v.cornerSmoothing,
    cornerRadius: v.cornerRadius,
    islandRemovalMode: v.islandRemovalMode,
    islandAreaMin: v.islandAreaMin,
    fillMode: v.fillMode,
    hatchThickness: v.hatchThickness,
    hatchGap: v.hatchGap,
    hatchOrientation: v.hatchOrientation,
    hatchSmoothingLevel: v.hatchSmoothingLevel,
    hatchSmoothingValue: v.hatchSmoothingValue,
    hatchHoleMinArea: v.hatchHoleMinArea,
    filled: v.filled,
    priority: v.priority,
    layerProperties: { ...v.layerProperties },
  };

  // Nothing to do if every field came back as it went in.
  const before = collectZoneValues(zone);
  if (JSON.stringify(before) === JSON.stringify(v)) return board;

  const zones = board.zones.map((z, i) => (i === index ? next : z));
  return { ...board, zones };
}

// ---------------------------------------------------------------------------
// The live dialog: DIALOG_COPPER_ZONE on a ZONE (#636 stage 6)
// ---------------------------------------------------------------------------

/**
 * The tail of `PCB_EDIT_FRAME::Edit_Zone_Params` (edit_zone_helpers.cpp:66-84),
 * once a zone dialog has returned OK over `aSettings`: one BOARD_COMMIT, "Edit
 * Zone Properties" - `ExportSetting` onto the zone, the net when the board has
 * it - then the settings, net orphaned, become the board's default zone
 * settings, whichever dialog produced them.
 */
export function editZoneParamsCommit(
  aFrame: PCB_BASE_EDIT_FRAME,
  aZone: ZONE,
  aSettings: ZONE_SETTINGS,
): void {
  const board = aZone.GetBoard();
  const commit = new BOARD_COMMIT(aFrame);
  commit.Modify(aZone);

  aSettings.ExportSetting(aZone);

  const net = board?.FindNet(aSettings.m_Netcode);
  if (net) aZone.SetNetCode(net.GetNetCode());

  // restore default net properties
  aSettings.m_Netcode = ORPHANED_NET;
  aFrame.GetDesignSettings().SetDefaultZoneSettings(aSettings);

  commit.Push('Edit Zone Properties', SKIP_CONNECTIVITY);
  board?.BuildConnectivity();
}

/** `m_PadInZoneOpt`'s rows (panel_zone_properties.cpp:170-177, :375-381). */
const PAD_IN_ZONE: readonly [ZoneValues['padConnection'], ZONE_CONNECTION][] = [
  ['full', ZONE_CONNECTION.FULL],
  ['thermal', ZONE_CONNECTION.THERMAL],
  ['thru_hole_only', ZONE_CONNECTION.THT_THERMAL],
  ['none', ZONE_CONNECTION.NONE],
];

/** `m_OutlineDisplayCtrl`'s rows (:162-168, :383-388). */
const OUTLINE_DISPLAY: readonly [ZoneValues['hatchStyle'], ZONE_BORDER_DISPLAY_STYLE][] = [
  ['none', ZONE_BORDER_DISPLAY_STYLE.NO_HATCH],
  ['edge', ZONE_BORDER_DISPLAY_STYLE.DIAGONAL_EDGE],
  ['full', ZONE_BORDER_DISPLAY_STYLE.DIAGONAL_FULL],
];

const SMOOTHING: readonly ZoneValues['cornerSmoothing'][] = ['none', 'chamfer', 'fillet'];
const ISLANDS: readonly ZoneValues['islandRemovalMode'][] = ['always', 'never', 'area'];

const AREA_PER_MM2 = pcbIUScale.IU_PER_MM * pcbIUScale.IU_PER_MM;

/**
 * `PANEL_ZONE_PROPERTIES::TransferZoneSettingsToWindow` (panel_zone_properties.cpp:
 * 139-237) plus the dialog's layer list: what the panel's controls hold for the
 * settings of one zone.
 */
export function zoneSettingsToValues(
  s: ZONE_SETTINGS,
  aZone: ZONE | null,
  aCopperLayerCount: number,
): ZoneValues {
  const layers = s.m_Layers;
  const layerProperties: Record<string, { x: number; y: number }> = {};

  for (const layer of LSET.AllCuMask().UIOrder()) {
    const offset = s.m_LayerProperties.get(layer)?.hatching_offset;
    if (offset) layerProperties[LSET_Name(layer)] = { x: offset.x, y: offset.y };
  }

  return {
    name: s.m_Name,
    net: Math.max(0, s.m_Netcode),
    layers:
      layers.count() > 1
        ? layerTokens(layers, aCopperLayerCount, true, true)
        : layers.Seq().map((l) => LSET_Name(l)),
    locked: s.m_Locked,
    clearance: s.m_ZoneClearance,
    minThickness: s.m_ZoneMinThickness,
    padConnection: (PAD_IN_ZONE.find(([, c]) => c === s.GetPadConnection()) ?? PAD_IN_ZONE[1]!)[0],
    thermalGap: s.m_ThermalReliefGap,
    thermalBridgeWidth: s.m_ThermalReliefSpokeWidth,
    hatchStyle: (OUTLINE_DISPLAY.find(([, d]) => d === s.m_ZoneBorderDisplayStyle) ??
      OUTLINE_DISPLAY[0]!)[0],
    hatchPitch: s.m_BorderHatchPitch,
    cornerSmoothing: SMOOTHING[s.GetCornerSmoothingType()] ?? 'none',
    cornerRadius: s.GetCornerRadius(),
    islandRemovalMode: ISLANDS[s.GetIslandRemovalMode()] ?? 'always',
    islandAreaMin: s.GetMinIslandArea() / AREA_PER_MM2,
    fillMode: s.m_FillMode === ZONE_FILL_MODE.HATCH_PATTERN ? 'hatch' : 'solid',
    hatchThickness: s.m_HatchThickness,
    hatchGap: s.m_HatchGap,
    hatchOrientation: s.m_HatchOrientation.AsDegrees(),
    hatchSmoothingLevel: s.m_HatchSmoothingLevel,
    hatchSmoothingValue: s.m_HatchSmoothingValue,
    hatchHoleMinArea: s.m_HatchHoleMinArea,
    filled: aZone?.IsFilled() ?? false,
    priority: s.m_ZonePriority,
    layerProperties,
  };
}

/**
 * `PANEL_ZONE_PROPERTIES::AcceptOptions` (panel_zone_properties.cpp:344-455):
 * the controls' values into the zone's settings, false where a validator refuses.
 * `aUseExportableSetupOnly` stops before the net, name, fill mode and hatch
 * fields, the ones that are not exported to other zones.
 */
export function acceptZoneOptions(
  s: ZONE_SETTINGS,
  v: ZoneValues,
  aZone: ZONE | null,
  aUseExportableSetupOnly = false,
  aBoard: BOARD | null = aZone?.GetBoard() ?? null,
): TransferResult {
  const mm = (n: number) => pcbIUScale.mmToIU(n);

  if (v.clearance < 0 || v.clearance > mm(ZONE_CLEARANCE_MAX_VALUE_MM)) return { ok: false };
  if (v.minThickness < mm(ZONE_THICKNESS_MIN_VALUE_MM)) return { ok: false };
  if (v.cornerRadius < 0) return { ok: false };
  if (v.thermalBridgeWidth < 0) return { ok: false };

  // Checked against the fill mode the settings held, before the window's.
  if (s.m_FillMode === ZONE_FILL_MODE.HATCH_PATTERN) {
    if (v.hatchThickness < v.minThickness) return { ok: false };
    if (v.hatchGap < v.minThickness) return { ok: false };
  }

  s.SetPadConnection(
    (PAD_IN_ZONE.find(([name]) => name === v.padConnection) ?? PAD_IN_ZONE[1]!)[1],
  );

  const outline = OUTLINE_DISPLAY.find(([name]) => name === v.hatchStyle);
  if (outline) s.m_ZoneBorderDisplayStyle = outline[1];

  if (
    v.hatchPitch < mm(ZONE_BORDER_HATCH_MINDIST_MM) ||
    v.hatchPitch > mm(ZONE_BORDER_HATCH_MAXDIST_MM)
  )
    return { ok: false };

  s.m_BorderHatchPitch = v.hatchPitch;
  s.m_ZoneClearance = v.clearance;
  s.m_ZoneMinThickness = v.minThickness;

  s.SetCornerSmoothingType(Math.max(0, SMOOTHING.indexOf(v.cornerSmoothing)));

  if (s.GetCornerSmoothingType() === ZONE_SETTINGS.SMOOTHING_NONE) s.SetCornerRadius(0);
  else s.SetCornerRadius(v.cornerRadius);

  s.m_Locked = v.locked;
  s.m_ThermalReliefGap = v.thermalGap;
  s.m_ThermalReliefSpokeWidth = v.thermalBridgeWidth;

  if (s.m_ThermalReliefSpokeWidth < s.m_ZoneMinThickness)
    return {
      ok: false,
      message: 'Thermal spoke width cannot be smaller than the minimum width.',
    };

  s.SetIslandRemovalMode(Math.max(0, ISLANDS.indexOf(v.islandRemovalMode)));
  s.SetMinIslandArea(v.islandAreaMin * AREA_PER_MM2);

  // If we use only exportable to others zones parameters, exit here:
  if (aUseExportableSetupOnly) return { ok: true };

  s.m_Netcode = v.net;
  // `if( BOARD* board = m_frame->GetBoard() )`
  s.m_Name = aBoard?.GetUniqueZoneName(v.name, aZone) ?? v.name;

  s.m_FillMode = v.fillMode === 'hatch' ? ZONE_FILL_MODE.HATCH_PATTERN : ZONE_FILL_MODE.POLYGONS;
  // m_gridStyleRotation.SetValue( NormalizeAngle180( ... ) )
  s.m_HatchOrientation = new EDA_ANGLE(v.hatchOrientation).Normalize180();
  s.m_HatchThickness = v.hatchThickness;
  s.m_HatchGap = v.hatchGap;
  s.m_HatchSmoothingLevel = v.hatchSmoothingLevel;
  s.m_HatchSmoothingValue = v.hatchSmoothingValue;

  for (const props of s.m_LayerProperties.values()) props.hatching_offset = undefined;

  for (const [name, offset] of Object.entries(v.layerProperties)) {
    const layer = LSET_NameToLayer(name);
    if (layer >= 0)
      s.m_LayerProperties.set(layer, new ZONE_LAYER_PROPERTIES({ x: offset.x, y: offset.y }));
  }

  return { ok: true };
}

/**
 * `DIALOG_COPPER_ZONE` + `PANEL_ZONE_PROPERTIES` on a live copper ZONE, as
 * `PCB_EDIT_FRAME::Edit_Zone_Params` (edit_zone_helpers.cpp:41-85) drives
 * them: the settings are the board's default zone settings with the zone
 * read over them (`zoneInfo << *aZone`); OK runs AcceptOptions (:344-455) and
 * the dialog's layer check, then one BOARD_COMMIT, "Edit Zone Properties":
 * `ExportSetting` onto the zone, the net when the board has it, and the
 * settings (net orphaned) become the board's default zone settings.
 *
 * The panel edits neither the priority, the hatch hole area nor the fill
 * state, so the values' `priority`, `hatchHoleMinArea` and `filled` are shown
 * and not written. Refilling is BOARD_COMMIT's, under the frame's "Auto-refill
 * zones" setting (board_commit.cpp:229), not this dialog's.
 */
export class DIALOG_COPPER_ZONE {
  private readonly m_frame: PCB_BASE_EDIT_FRAME;
  private readonly m_zone: ZONE | null;
  private readonly m_settings: ZONE_SETTINGS;
  /** `m_ptr`: the caller's settings, written on OK when there is no zone. */
  private readonly m_ptr: ZONE_SETTINGS | null;
  /** `m_convertSettings`: CONVERT_TOOL's, when it opens the dialog. */
  readonly m_convertSettings: CONVERT_SETTINGS | null;

  /**
   * On a live zone, as `Edit_Zone_Params` opens it; or, with `aZone` null, on
   * `aSettings` alone, as `InvokeCopperZonesEditor( frame, nullptr, &zoneInfo,
   * &convertSettings )` does for CONVERT_TOOL - no commit, the settings come
   * back through `*m_ptr`.
   */
  constructor(
    aFrame: PCB_BASE_EDIT_FRAME,
    aZone: ZONE | null,
    aSettings: ZONE_SETTINGS | null = null,
    aConvertSettings: CONVERT_SETTINGS | null = null,
  ) {
    this.m_frame = aFrame;
    this.m_zone = aZone;
    this.m_ptr = aSettings;
    this.m_convertSettings = aConvertSettings;

    if (aZone) {
      this.m_settings = aFrame.GetDesignSettings().GetDefaultZoneSettings().clone();
      this.m_settings.importFrom(aZone);
    } else {
      this.m_settings = aSettings!.clone();
    }
  }

  private copperLayerCount(): number {
    return (this.m_zone?.GetBoard() ?? this.m_frame.GetBoard())?.GetCopperLayerCount() ?? 2;
  }

  /** The "Conversion Settings" box's controls, or null when there is none. */
  TransferConversionToWindow(): ConversionBoxValues | null {
    return this.m_convertSettings ? CONVERSION_BOX.ToWindow(this.m_convertSettings, false) : null;
  }

  /** TransferZoneSettingsToWindow (:139-237), plus the dialog's layer list. */
  TransferDataToWindow(): ZoneValues {
    return zoneSettingsToValues(this.m_settings, this.m_zone, this.copperLayerCount());
  }

  /** AcceptOptions (:344-455): false where a validator refuses. */
  private acceptOptions(v: ZoneValues): TransferResult {
    return acceptZoneOptions(this.m_settings, v, this.m_zone, false, this.m_frame.GetBoard());
  }

  TransferDataFromWindow(
    v: ZoneValues,
    aConversion: ConversionBoxValues | null = null,
  ): TransferResult {
    // DIALOG_COPPER_ZONE::TransferDataFromWindow's layer check comes first.
    const layers = layerSetOfTokens(v.layers);

    if (layers.none()) return { ok: false, message: 'No layer selected.' };

    this.m_settings.m_Layers = layers;

    const accepted = this.acceptOptions(v);
    if (!accepted.ok) return accepted;

    if (this.m_convertSettings && aConversion)
      CONVERSION_BOX.FromWindow(this.m_convertSettings, aConversion, false);

    // `*m_ptr = *m_zoneSettingsBag.GetZoneSettings( m_zone )`: with no zone,
    // the caller's settings; with one, Edit_Zone_Params' commit.
    if (this.m_zone) editZoneParamsCommit(this.m_frame, this.m_zone, this.m_settings);
    else this.m_ptr!.CopyFrom(this.m_settings, true);

    return { ok: true };
  }
}

// ---------------------------------------------------------------------------
// PANEL_ZONE_PROPERTIES: the panel both the Copper Zone dialog and the Zone
// Manager put a zone's fields in
// ---------------------------------------------------------------------------

/** What the panel reads from its `PCB_BASE_FRAME`. */
export interface PANEL_ZONE_PROPERTIES_FRAME {
  GetBoard(): BOARD | null;
}

/** The events and dialogs the panel raises: `EVT_ZONE_NAME_UPDATE`, `EVT_ZONE_NET_UPDATE`, `DisplayErrorMessage`. */
export interface PANEL_ZONE_PROPERTIES_EVENTS {
  /** `wxQueueEvent( m_parent, new wxCommandEvent( EVT_ZONE_NAME_UPDATE ) )`. */
  ZoneNameUpdate?(): void;
  /** `EVT_ZONE_NET_UPDATE`. */
  ZoneNetUpdate?(): void;
  /** `DisplayErrorMessage( this, aMessage )`. */
  DisplayErrorMessage?(aMessage: string): void;
}

/**
 * `PANEL_ZONE_PROPERTIES` (`panel_zone_properties.{h,cpp}`), the logic half:
 * the panel edits the settings the {@link ZONE_SETTINGS_BAG} keeps for one
 * zone. `SetZone` first transfers whatever the previous zone's fields hold
 * back into its settings, then shows the new zone's. The window is
 * `panel_zone_properties_ui.tsx`, a view over {@link GetValues} that calls
 * {@link SetValues} as a field changes.
 */
export class PANEL_ZONE_PROPERTIES {
  private m_zone: ZONE | null = null;
  private m_settings: ZONE_SETTINGS | undefined;
  private m_isTeardrop = false;
  private m_values: ZoneValues | null = null;
  private readonly m_listeners = new Set<() => void>();
  private m_version = 0;

  constructor(
    private readonly m_frame: PANEL_ZONE_PROPERTIES_FRAME,
    private readonly m_zonesSettingsBag: ZONE_SETTINGS_BAG,
    private readonly m_allowNetSpec = true,
    private readonly m_events: PANEL_ZONE_PROPERTIES_EVENTS = {},
  ) {}

  /** `allowNetSpec`: with false the panel hides the net selector. */
  IsNetSpecAllowed(): boolean {
    return this.m_allowNetSpec;
  }

  GetZone(): ZONE | null {
    return this.m_zone;
  }

  IsTeardrop(): boolean {
    return this.m_isTeardrop;
  }

  /** The controls' values, null while no zone is shown (`Enable( false )`). */
  GetValues(): ZoneValues | null {
    return this.m_values;
  }

  /** `useSyncExternalStore`'s pair: a change notifier and a version to compare. */
  Subscribe(aListener: () => void): () => void {
    this.m_listeners.add(aListener);
    return () => this.m_listeners.delete(aListener);
  }

  GetVersion(): number {
    return this.m_version;
  }

  private notify(): void {
    this.m_version++;
    for (const l of this.m_listeners) l();
  }

  SetZone(aZone: ZONE | null): void {
    if (this.m_settings) this.TransferZoneSettingsFromWindow();

    this.m_zone = aZone;
    this.m_settings = aZone ? this.m_zonesSettingsBag.GetZoneSettings(aZone) : undefined;

    if (!this.m_settings) {
      this.m_isTeardrop = false;
      this.m_values = null;
      this.notify();
      return;
    }

    this.m_isTeardrop = this.m_settings.m_TeardropType !== TEARDROP_TYPE.TD_NONE;

    this.TransferZoneSettingsToWindow();
  }

  /** `TransferZoneSettingsToWindow`. */
  TransferZoneSettingsToWindow(): boolean {
    const s = this.m_settings;

    if (!s || !this.m_zone) return false;

    const v = zoneSettingsToValues(
      s,
      this.m_zone,
      this.m_frame.GetBoard()?.GetCopperLayerCount() ?? 2,
    );

    if (this.m_isTeardrop) {
      // outlines are never smoothed: they have already the right shape
      v.cornerSmoothing = 'none';
      v.padConnection = 'full';
      v.fillMode = 'solid';
    }

    // `onNetSelector( aEvent )`, run at the end of the transfer: a zone with no
    // net never has islands removed.
    if (v.net <= 0) v.islandRemovalMode = 'never';

    this.m_values = v;
    this.notify();

    return true;
  }

  /**
   * A control changed. The name and the net are the two the rest of the dialog
   * hears about: `OnZoneNameChanged` and `onNetSelector` write them into the
   * bag's settings and the zone at once, so the overview table follows.
   */
  SetValues(aPatch: Partial<ZoneValues>): void {
    if (!this.m_values || !this.m_settings) return;

    const before = this.m_values;
    const next: ZoneValues = { ...before, ...aPatch };

    if ('net' in aPatch && aPatch.net !== before.net) {
      const noNetBefore = before.net <= 0;
      const noNet = next.net <= 0;

      if (noNet && !noNetBefore) {
        // Zones with no net never have islands removed: remember the choice,
        // show "Never", and disable the control.
        this.m_settings.SetIslandRemovalMode(
          Math.max(0, ISLANDS.indexOf(before.islandRemovalMode)),
        );
        next.islandRemovalMode = 'never';
      } else if (!noNet && noNetBefore) {
        next.islandRemovalMode = ISLANDS[this.m_settings.GetIslandRemovalMode()] ?? 'always';
      }
    }

    this.m_values = next;
    this.notify();

    if ('name' in aPatch && aPatch.name !== before.name) this.OnZoneNameChanged();

    if ('net' in aPatch && aPatch.net !== before.net) this.onNetSelector();
  }

  /** `OnZoneNameChanged`: "Propagate all the way out so that the MODEL_ZONES_OVERVIEW can pick it up". */
  OnZoneNameChanged(): void {
    if (!this.m_settings || !this.m_values) return;

    this.m_settings.m_Name = this.m_values.name;

    if (this.m_zone) {
      const inBag = this.m_zonesSettingsBag.GetZoneSettings(this.m_zone);

      if (inBag) inBag.m_Name = this.m_settings.m_Name;

      this.m_zone.SetZoneName(this.m_settings.m_Name);
    }

    this.m_events.ZoneNameUpdate?.();
  }

  /** `onNetSelector`, the part after the island choice: the netcode goes into the settings and the zone. */
  private onNetSelector(): void {
    if (!this.m_allowNetSpec || !this.m_values) return;

    if (this.m_settings) this.m_settings.m_Netcode = this.m_values.net;

    if (this.m_settings && this.m_zone) {
      const inBag = this.m_zonesSettingsBag.GetZoneSettings(this.m_zone);

      if (inBag) inBag.m_Netcode = this.m_settings.m_Netcode;

      this.m_zone.SetNetCode(this.m_settings.m_Netcode, true);
    }

    this.m_events.ZoneNetUpdate?.();
  }

  /** `TransferZoneSettingsFromWindow`: false when a field is refused. */
  TransferZoneSettingsFromWindow(): boolean {
    if (!this.m_settings || !this.m_zone || !this.m_values) return false;

    return this.AcceptOptions();
  }

  /** `AcceptOptions`. */
  AcceptOptions(aUseExportableSetupOnly = false): boolean {
    if (!this.m_settings || !this.m_zone || !this.m_values) return false;

    const r = acceptZoneOptions(
      this.m_settings,
      this.m_values,
      this.m_zone,
      aUseExportableSetupOnly,
    );

    if (!r.ok && r.message) this.m_events.DisplayErrorMessage?.(r.message);

    return r.ok;
  }
}
