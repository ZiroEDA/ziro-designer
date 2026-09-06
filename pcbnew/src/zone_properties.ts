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

import { atom, str, type SList, type SNode } from '@ziroeda/sexpr/src/index.js';
import { dropChild, mm, parseBoardItemId, patchChild } from './edit-board.js';
import type { Board, PcbZone, RuleAreaKeepout, ZonePlacementArea } from './types.js';

const list = (...items: SNode[]): SList => ({ kind: 'list', items });

const nodeHead = (n: SList): string | undefined => {
  const first = n.items[0];
  return first && first.kind === 'atom' ? first.value : undefined;
};

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
  };
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

  let src = zone.source;

  if (patch.keepout) {
    // Each flag is written as `allowed` / `not_allowed`, and the model stores
    // the DO-NOT-ALLOW sense, so the words are the negation.
    const word = (on: boolean): string => (on ? 'not_allowed' : 'allowed');
    src = patchChild(src, 'keepout', {
      kind: 'list',
      items: [
        atom('keepout'),
        list(atom('tracks'), atom(word(ruleArea.tracks))),
        list(atom('vias'), atom(word(ruleArea.vias))),
        list(atom('pads'), atom(word(ruleArea.pads))),
        list(atom('copperpour'), atom(word(ruleArea.copperPour))),
        list(atom('footprints'), atom(word(ruleArea.footprints))),
      ],
    });
  }

  if (patch.placement && placement) {
    src = patchChild(src, 'placement', {
      kind: 'list',
      items: [
        atom('placement'),
        list(atom('enabled'), atom(placement.enabled ? 'yes' : 'no')),
        list(atom(placement.sourceType), str(placement.source)),
      ],
    });
  }

  return {
    ...board,
    zones: board.zones.map((z, i) =>
      i === index ? { ...z, ruleArea, placementArea: placement, source: src } : z,
    ),
  };
}

/** Rebuild `(connect_pads [mode] (clearance …))`. */
function connectPadsNode(v: ZoneValues): SList {
  const items: SNode[] = [atom('connect_pads')];
  if (v.padConnection === 'none') items.push(atom('no'));
  else if (v.padConnection === 'full') items.push(atom('yes'));
  else if (v.padConnection === 'thru_hole_only') items.push(atom('thru_hole_only'));
  items.push(list(atom('clearance'), atom(mm(v.clearance))));
  return { kind: 'list', items };
}

/**
 * Rebuild the whole `(fill …)` child.
 *
 * Its sub-tokens are conditional upstream — hatch parameters only for a hatched
 * fill, `island_area_min` only for the area mode — so patching them one by one
 * would leave stale ones behind when the mode changes. Rebuilding the node is
 * both simpler and the only way to drop what no longer applies.
 */
function fillNode(v: ZoneValues, prev: PcbZone): SList {
  const items: SNode[] = [
    atom('fill'),
    atom(v.filled ? 'yes' : 'no'),
    list(atom('thermal_gap'), atom(mm(v.thermalGap))),
    list(atom('thermal_bridge_width'), atom(mm(v.thermalBridgeWidth))),
  ];

  if (v.cornerSmoothing !== 'none') {
    items.push(list(atom('smoothing'), atom(v.cornerSmoothing)));
    if (v.cornerRadius) items.push(list(atom('radius'), atom(mm(v.cornerRadius))));
  }

  if (v.islandRemovalMode !== 'always') {
    items.push(
      list(atom('island_removal_mode'), atom(v.islandRemovalMode === 'never' ? '1' : '2')),
    );
    if (v.islandRemovalMode === 'area')
      items.push(list(atom('island_area_min'), atom(String(v.islandAreaMin))));
  }

  if (v.fillMode === 'hatch') {
    items.push(
      list(atom('mode'), atom('hatch')),
      list(atom('hatch_thickness'), atom(mm(v.hatchThickness))),
      list(atom('hatch_gap'), atom(mm(v.hatchGap))),
      list(atom('hatch_orientation'), atom(String(v.hatchOrientation))),
    );
    if (v.hatchSmoothingLevel > 0) {
      items.push(
        list(atom('hatch_smoothing_level'), atom(String(v.hatchSmoothingLevel))),
        list(atom('hatch_smoothing_value'), atom(String(v.hatchSmoothingValue))),
      );
    }
    items.push(list(atom('hatch_min_hole_area'), atom(String(v.hatchHoleMinArea))));
  } else if (v.fillMode === 'thieving') {
    // The thieving settings themselves are not edited here, so the existing
    // `(thieving …)` sub-node is carried across untouched.
    items.push(list(atom('mode'), atom('thieving')));
    const prevFill = prev.source.items.find(
      (it): it is SList => typeof it === 'object' && 'items' in it && nodeHead(it) === 'fill',
    );
    const thieving = prevFill?.items.find(
      (it): it is SList => typeof it === 'object' && 'items' in it && nodeHead(it) === 'thieving',
    );
    if (thieving) items.push(thieving);
  }

  return { kind: 'list', items };
}

/** The layer children: `(layer …)` for one, `(layers …)` for several. */
function layerNodes(src: SList, layers: readonly string[]): SList {
  if (layers.length === 1) {
    return patchChild(dropChild(src, 'layers'), 'layer', list(atom('layer'), str(layers[0]!)));
  }
  return patchChild(dropChild(src, 'layer'), 'layers', {
    kind: 'list',
    items: [atom('layers'), ...layers.map((l) => str(l))],
  });
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
  };

  // Nothing to do if every field came back as it went in.
  const before = collectZoneValues(zone);
  if (JSON.stringify(before) === JSON.stringify(v)) return board;

  let src = zone.source;

  src =
    v.name === ''
      ? dropChild(src, 'name')
      : patchChild(src, 'name', list(atom('name'), str(v.name)));
  src = patchChild(src, 'net', list(atom('net'), atom(String(v.net))));
  src = layerNodes(src, v.layers);
  src = v.locked
    ? patchChild(src, 'locked', list(atom('locked'), atom('yes')))
    : dropChild(src, 'locked');
  src = patchChild(
    src,
    'hatch',
    list(
      atom('hatch'),
      // INVISIBLE_BORDER has no token; upstream's switch falls through to none.
      atom(v.hatchStyle === 'invisible' ? 'none' : v.hatchStyle),
      atom(mm(v.hatchPitch)),
    ),
  );
  src =
    v.priority > 0
      ? patchChild(src, 'priority', list(atom('priority'), atom(String(v.priority))))
      : dropChild(src, 'priority');
  src = patchChild(src, 'connect_pads', connectPadsNode(v));
  src = patchChild(src, 'min_thickness', list(atom('min_thickness'), atom(mm(v.minThickness))));
  src = patchChild(src, 'fill', fillNode(v, zone));

  next.source = src;

  const zones = board.zones.map((z, i) => (i === index ? next : z));
  return { ...board, zones };
}
