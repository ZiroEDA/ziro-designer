// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PNS::ROUTING_SETTINGS, every persistent setting of the interactive router.
 * Counterpart: `pcbnew/router/pns_routing_settings.{h,cpp}`.
 *
 * Upstream this is a NESTED_SETTINGS named "pns", built by the router tool at
 * the `tools.pns` path of `pcbnew.json` (pns_tool_base.cpp:103), so the JSON
 * keys below are the file format, not an invention: `readRoutingSettings` is
 * the `m_params` Load pass and `writeRoutingSettings` the Store pass, key for
 * key and default for default.
 *
 * The model, its defaults and the round-trip live here rather than beside the
 * dialog because the dialog is a `.tsx` and the test package cannot import
 * one. The two derived predicates (`pnsFollowMouse`, `pnsAllowDrcViolations`)
 * and the mode interlock (`pnsSettingsEnableState`) are the parts with a
 * decision in them, and they are here for the same reason.
 */
import { CornerMode, Direction45, Directions } from '@ziroeda/kimath/src/geometry/direction45.js';

/** PNS_MODE (pns_routing_settings.h): the router's collision regime. */
export enum PnsMode {
  /** Ignore collisions, mark obstacles. */
  RM_MarkObstacles = 0,
  /** Only shove. */
  RM_Shove = 1,
  /** Only walk around. */
  RM_Walkaround = 2,
}

/** PNS_OPTIMIZATION_EFFORT: bigger means cleaner traces, but slower routing. */
export enum PnsOptimizationEffort {
  OE_LOW = 0,
  OE_MEDIUM = 1,
  OE_FULL = 2,
}

/**
 * One field per ROUTING_SETTINGS member, in the header's declaration order.
 *
 * `walkaroundTimeLimit` is deliberately absent: upstream declares
 * `WalkaroundTimeLimit()` and the `m_walkaroundTimeLimit` member but never
 * defines the accessor, never initializes the member and registers no param
 * for it, so it holds no value and persists nothing.
 */
export interface RoutingSettings {
  shoveVias: boolean;
  startDiagonal: boolean;
  removeLoops: boolean;
  smartPads: boolean;
  suggestFinish: boolean;
  followMouse: boolean;
  jumpOverObstacles: boolean;
  smoothDraggedSegments: boolean;
  allowDrcViolations: boolean;
  freeAngleMode: boolean;
  snapToTracks: boolean;
  snapToPads: boolean;
  optimizeEntireDraggedTrack: boolean;
  autoPosture: boolean;
  fixAllSegments: boolean;
  cornerMode: CornerMode;
  routingMode: PnsMode;
  optimizerEffort: PnsOptimizationEffort;
  walkaroundIterationLimit: number;
  shoveIterationLimit: number;
  viaForcePropIterationLimit: number;
  walkaroundHugLengthThreshold: number;
  /** TIME_LIMIT, in milliseconds (time_limit.h stores a wxLongLong of ms). */
  shoveTimeLimit: number;
}

/** The ROUTING_SETTINGS constructor's member initialization, verbatim. */
export const DEFAULT_ROUTING_SETTINGS: RoutingSettings = {
  shoveVias: true,
  startDiagonal: false,
  removeLoops: true,
  smartPads: true,
  suggestFinish: false,
  followMouse: true,
  jumpOverObstacles: false,
  smoothDraggedSegments: true,
  allowDrcViolations: false,
  freeAngleMode: false,
  snapToTracks: false,
  snapToPads: false,
  optimizeEntireDraggedTrack: false,
  autoPosture: true,
  fixAllSegments: true,
  cornerMode: CornerMode.MITERED_45,
  routingMode: PnsMode.RM_Walkaround,
  optimizerEffort: PnsOptimizationEffort.OE_MEDIUM,
  walkaroundIterationLimit: 40,
  shoveIterationLimit: 250,
  viaForcePropIterationLimit: 40,
  walkaroundHugLengthThreshold: 1.5,
  shoveTimeLimit: 1000,
};

/** The `pns` schema version (pns_routing_settings.cpp `pnsSchemaVersion`). */
export const PNS_SCHEMA_VERSION = 0;

/** The path this settings block occupies inside `pcbnew.json`. */
export const PNS_SETTINGS_PATH = 'tools.pns';

/** The stored form: the `tools.pns` subtree of `pcbnew.json`. */
export type RoutingSettingsJson = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Load. PARAM<T>::Load takes the stored value only when JSON_SETTINGS::Get<T>
// can produce a T from it; a key that is missing or of the wrong type falls
// back to the param default (parameters.h:118-138).

function boolParam(v: unknown, dflt: boolean): boolean {
  return typeof v === 'boolean' ? v : dflt;
}

/** `Get<int>`: a JSON number converts (truncating a float), anything else does not. */
function intParam(v: unknown, dflt: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : dflt;
}

function doubleParam(v: unknown, dflt: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : dflt;
}

/**
 * PARAM_ENUM<T>::Load (parameters.h:244-261): the stored int is taken only
 * when it falls inside [min, max], otherwise the default.
 *
 * The `corner_mode` param is registered with min = ROUNDED_90 (3) and
 * max = MITERED_45 (0), an inverted range no value can satisfy, so upstream
 * resets the corner mode to MITERED_45 on every load. That is a bug upstream,
 * but it is upstream's behaviour and its file format: a KiCad-written
 * `corner_mode: 2` does not come back, and if we "fixed" it here our reads and
 * KiCad's would disagree on the same file. Mirrored, and only mirrored.
 */
function enumParam(v: unknown, dflt: number, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return dflt;
  const i = Math.trunc(v);
  return i >= min && i <= max ? i : dflt;
}

/** Hydrate a ROUTING_SETTINGS from the `tools.pns` subtree of `pcbnew.json`. */
export function readRoutingSettings(json: unknown): RoutingSettings {
  const j: RoutingSettingsJson =
    typeof json === 'object' && json !== null && !Array.isArray(json)
      ? (json as RoutingSettingsJson)
      : {};
  const d = DEFAULT_ROUTING_SETTINGS;

  return {
    // `mode` and `effort` are plain PARAM<int> over the enum members
    // (reinterpret_cast), not PARAM_ENUM: upstream range-checks neither.
    routingMode: intParam(j.mode, d.routingMode) as PnsMode,
    optimizerEffort: intParam(j.effort, d.optimizerEffort) as PnsOptimizationEffort,
    removeLoops: boolParam(j.remove_loops, d.removeLoops),
    smartPads: boolParam(j.smart_pads, d.smartPads),
    shoveVias: boolParam(j.shove_vias, d.shoveVias),
    suggestFinish: boolParam(j.suggest_finish, d.suggestFinish),
    followMouse: boolParam(j.follow_mouse, d.followMouse),
    startDiagonal: boolParam(j.start_diagonal, d.startDiagonal),
    shoveIterationLimit: intParam(j.shove_iteration_limit, d.shoveIterationLimit),
    viaForcePropIterationLimit: intParam(
      j.via_force_prop_iteration_limit,
      d.viaForcePropIterationLimit,
    ),
    shoveTimeLimit: intParam(j.shove_time_limit, d.shoveTimeLimit),
    walkaroundIterationLimit: intParam(j.walkaround_iteration_limit, d.walkaroundIterationLimit),
    jumpOverObstacles: boolParam(j.jump_over_obstacles, d.jumpOverObstacles),
    smoothDraggedSegments: boolParam(j.smooth_dragged_segments, d.smoothDraggedSegments),
    allowDrcViolations: boolParam(j.can_violate_drc, d.allowDrcViolations),
    freeAngleMode: boolParam(j.free_angle_mode, d.freeAngleMode),
    snapToTracks: boolParam(j.snap_to_tracks, d.snapToTracks),
    snapToPads: boolParam(j.snap_to_pads, d.snapToPads),
    optimizeEntireDraggedTrack: boolParam(j.optimize_dragged_track, d.optimizeEntireDraggedTrack),
    autoPosture: boolParam(j.auto_posture, d.autoPosture),
    fixAllSegments: boolParam(j.fix_all_segments, d.fixAllSegments),
    cornerMode: enumParam(
      j.corner_mode,
      CornerMode.MITERED_45,
      CornerMode.ROUNDED_90,
      CornerMode.MITERED_45,
    ) as CornerMode,
    walkaroundHugLengthThreshold: doubleParam(
      j.walkaround_hug_length_threshold,
      d.walkaroundHugLengthThreshold,
    ),
  };
}

// ---------------------------------------------------------------------------
// Store.

/**
 * The `tools.pns` subtree for a ROUTING_SETTINGS, in `m_params` registration
 * order. `meta.version` comes first because JSON_SETTINGS registers it in its
 * own constructor, as a read-only param that Store still writes
 * (json_settings.cpp:98).
 */
export function writeRoutingSettings(s: RoutingSettings): RoutingSettingsJson {
  return {
    meta: { version: PNS_SCHEMA_VERSION },
    mode: s.routingMode,
    effort: s.optimizerEffort,
    remove_loops: s.removeLoops,
    smart_pads: s.smartPads,
    shove_vias: s.shoveVias,
    suggest_finish: s.suggestFinish,
    follow_mouse: s.followMouse,
    start_diagonal: s.startDiagonal,
    shove_iteration_limit: s.shoveIterationLimit,
    via_force_prop_iteration_limit: s.viaForcePropIterationLimit,
    shove_time_limit: s.shoveTimeLimit,
    walkaround_iteration_limit: s.walkaroundIterationLimit,
    jump_over_obstacles: s.jumpOverObstacles,
    smooth_dragged_segments: s.smoothDraggedSegments,
    can_violate_drc: s.allowDrcViolations,
    free_angle_mode: s.freeAngleMode,
    snap_to_tracks: s.snapToTracks,
    snap_to_pads: s.snapToPads,
    optimize_dragged_track: s.optimizeEntireDraggedTrack,
    auto_posture: s.autoPosture,
    fix_all_segments: s.fixAllSegments,
    corner_mode: s.cornerMode,
    walkaround_hug_length_threshold: s.walkaroundHugLengthThreshold,
  };
}

// ---------------------------------------------------------------------------
// Derived state. Three accessors do more than return a member, and every one
// of them mixes the mode into the answer.

/**
 * ROUTING_SETTINGS::FollowMouse. Highlight-collisions mode never follows the
 * mouse, whatever the stored flag says.
 */
export function pnsFollowMouse(s: RoutingSettings): boolean {
  return s.followMouse && !(s.routingMode === PnsMode.RM_MarkObstacles);
}

/**
 * ROUTING_SETTINGS::AllowDRCViolations, which is *not* the stored setting:
 * violations are only ever allowed in highlight-collisions mode. The raw
 * setting is `s.allowDrcViolations` (GetAllowDRCViolationsSetting), and that is
 * what the dialog shows and stores.
 */
export function pnsAllowDrcViolations(s: RoutingSettings): boolean {
  return s.routingMode === PnsMode.RM_MarkObstacles && s.allowDrcViolations;
}

/** ROUTING_SETTINGS::InitialDirection. */
export function pnsInitialDirection(s: RoutingSettings): Direction45 {
  return Direction45.of(s.startDiagonal ? Directions.NE : Directions.N);
}

/** Which of the four mode-gated checkboxes DIALOG_PNS_SETTINGS leaves enabled. */
export interface PnsSettingsEnableState {
  freeAngleMode: boolean;
  violateDrc: boolean;
  shoveVias: boolean;
  jumpOverObstacles: boolean;
}

/**
 * DIALOG_PNS_SETTINGS::onModeChange: the free-angle and allow-DRC-violations
 * boxes belong to Highlight collisions, the shove-vias and jump-over-obstacles
 * boxes to Shove. Walk around enables none of them — upstream tests the two
 * radio buttons directly, so the third mode leaves all four greyed out.
 *
 * Greying out does not clear the value: the dialog still writes every box back
 * on OK, as TransferDataFromWindow does unconditionally.
 */
export function pnsSettingsEnableState(mode: PnsMode): PnsSettingsEnableState {
  const markObstacles = mode === PnsMode.RM_MarkObstacles;
  const shove = mode === PnsMode.RM_Shove;
  return {
    freeAngleMode: markObstacles,
    violateDrc: markObstacles,
    shoveVias: shove,
    jumpOverObstacles: shove,
  };
}

/** ROUTER_TOOL::CycleRouterMode's order: highlight -> shove -> walk around. */
export function pnsCycleMode(mode: PnsMode): PnsMode {
  switch (mode) {
    case PnsMode.RM_MarkObstacles:
      return PnsMode.RM_Shove;
    case PnsMode.RM_Shove:
      return PnsMode.RM_Walkaround;
    default:
      return PnsMode.RM_MarkObstacles;
  }
}
