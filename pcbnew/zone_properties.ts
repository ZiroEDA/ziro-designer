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

import { parseBoardItemId } from './edit-board.js';
import type { Board, PcbZone, RuleAreaKeepout, ZonePlacementArea } from './types.js';

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
