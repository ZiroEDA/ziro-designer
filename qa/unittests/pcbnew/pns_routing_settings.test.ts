// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PNS::ROUTING_SETTINGS: the defaults, the `tools.pns` round-trip and the
 * three places the routing mode overrules a stored flag.
 *
 * The file format is the point of most of this. `pcbnew.json` is written by
 * KiCad and read by us and vice versa, so a key spelled `can_violate_drc` here
 * and `allow_drc_violations` there is not a cosmetic difference: it silently
 * drops the setting. The key list below is therefore asserted literally
 * against pns_routing_settings.cpp's `m_params`, not derived from the model.
 */
import { describe, expect, it } from 'vitest';
import { CornerMode, Directions } from '@ziroeda/kimath/src/geometry/direction45.js';
import {
  DEFAULT_ROUTING_SETTINGS,
  PnsMode,
  PnsOptimizationEffort,
  pnsAllowDrcViolations,
  pnsCycleMode,
  pnsFollowMouse,
  pnsInitialDirection,
  pnsSettingsEnableState,
  readRoutingSettings,
  writeRoutingSettings,
  type RoutingSettings,
} from '@ziroeda/pcbnew/src/router/pns_routing_settings.js';

/** Every key `m_params` registers, in registration order (plus `meta`). */
const PARAM_KEYS = [
  'meta',
  'mode',
  'effort',
  'remove_loops',
  'smart_pads',
  'shove_vias',
  'suggest_finish',
  'follow_mouse',
  'start_diagonal',
  'shove_iteration_limit',
  'via_force_prop_iteration_limit',
  'shove_time_limit',
  'walkaround_iteration_limit',
  'jump_over_obstacles',
  'smooth_dragged_segments',
  'can_violate_drc',
  'free_angle_mode',
  'snap_to_tracks',
  'snap_to_pads',
  'optimize_dragged_track',
  'auto_posture',
  'fix_all_segments',
  'corner_mode',
  'walkaround_hug_length_threshold',
];

describe('ROUTING_SETTINGS defaults', () => {
  it('are the constructor values', () => {
    expect(DEFAULT_ROUTING_SETTINGS).toEqual({
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
    });
  });

  it('are what an empty (or absent) settings block reads back as', () => {
    expect(readRoutingSettings({})).toEqual(DEFAULT_ROUTING_SETTINGS);
    expect(readRoutingSettings(undefined)).toEqual(DEFAULT_ROUTING_SETTINGS);
    expect(readRoutingSettings(null)).toEqual(DEFAULT_ROUTING_SETTINGS);
    expect(readRoutingSettings([1, 2, 3])).toEqual(DEFAULT_ROUTING_SETTINGS);
  });

  it('are the enum members KiCad numbers them as', () => {
    expect(PnsMode.RM_MarkObstacles).toBe(0);
    expect(PnsMode.RM_Shove).toBe(1);
    expect(PnsMode.RM_Walkaround).toBe(2);
    expect(PnsOptimizationEffort.OE_LOW).toBe(0);
    expect(PnsOptimizationEffort.OE_MEDIUM).toBe(1);
    expect(PnsOptimizationEffort.OE_FULL).toBe(2);
  });
});

describe('the tools.pns file format', () => {
  it('writes exactly the keys m_params registers, in order', () => {
    expect(Object.keys(writeRoutingSettings(DEFAULT_ROUTING_SETTINGS))).toEqual(PARAM_KEYS);
  });

  it('writes the nested settings schema version', () => {
    expect(writeRoutingSettings(DEFAULT_ROUTING_SETTINGS).meta).toEqual({ version: 0 });
  });

  it('writes the defaults with KiCad`s values', () => {
    expect(writeRoutingSettings(DEFAULT_ROUTING_SETTINGS)).toEqual({
      meta: { version: 0 },
      mode: 2,
      effort: 1,
      remove_loops: true,
      smart_pads: true,
      shove_vias: true,
      suggest_finish: false,
      follow_mouse: true,
      start_diagonal: false,
      shove_iteration_limit: 250,
      via_force_prop_iteration_limit: 40,
      shove_time_limit: 1000,
      walkaround_iteration_limit: 40,
      jump_over_obstacles: false,
      smooth_dragged_segments: true,
      can_violate_drc: false,
      free_angle_mode: false,
      snap_to_tracks: false,
      snap_to_pads: false,
      optimize_dragged_track: false,
      auto_posture: true,
      fix_all_segments: true,
      corner_mode: 0,
      walkaround_hug_length_threshold: 1.5,
    });
  });

  it('round-trips a fully non-default settings block', () => {
    // Every field flipped away from its default, so a key written under the
    // wrong name comes back as the default and fails.
    const s: RoutingSettings = {
      shoveVias: false,
      startDiagonal: true,
      removeLoops: false,
      smartPads: false,
      suggestFinish: true,
      followMouse: false,
      jumpOverObstacles: true,
      smoothDraggedSegments: false,
      allowDrcViolations: true,
      freeAngleMode: true,
      snapToTracks: true,
      snapToPads: true,
      optimizeEntireDraggedTrack: true,
      autoPosture: false,
      fixAllSegments: false,
      cornerMode: CornerMode.MITERED_45,
      routingMode: PnsMode.RM_MarkObstacles,
      optimizerEffort: PnsOptimizationEffort.OE_FULL,
      walkaroundIterationLimit: 7,
      shoveIterationLimit: 11,
      viaForcePropIterationLimit: 13,
      walkaroundHugLengthThreshold: 2.75,
      shoveTimeLimit: 4321,
    };
    expect(readRoutingSettings(writeRoutingSettings(s))).toEqual(s);
  });

  it('reads each key independently of the others', () => {
    // One key at a time: a reader that pulled `snap_to_pads` from
    // `snap_to_tracks` would still pass a whole-block round-trip.
    const cases: [string, unknown, Partial<RoutingSettings>][] = [
      ['mode', 0, { routingMode: PnsMode.RM_MarkObstacles }],
      ['effort', 2, { optimizerEffort: PnsOptimizationEffort.OE_FULL }],
      ['remove_loops', false, { removeLoops: false }],
      ['smart_pads', false, { smartPads: false }],
      ['shove_vias', false, { shoveVias: false }],
      ['suggest_finish', true, { suggestFinish: true }],
      ['follow_mouse', false, { followMouse: false }],
      ['start_diagonal', true, { startDiagonal: true }],
      ['shove_iteration_limit', 99, { shoveIterationLimit: 99 }],
      ['via_force_prop_iteration_limit', 98, { viaForcePropIterationLimit: 98 }],
      ['shove_time_limit', 97, { shoveTimeLimit: 97 }],
      ['walkaround_iteration_limit', 96, { walkaroundIterationLimit: 96 }],
      ['jump_over_obstacles', true, { jumpOverObstacles: true }],
      ['smooth_dragged_segments', false, { smoothDraggedSegments: false }],
      ['can_violate_drc', true, { allowDrcViolations: true }],
      ['free_angle_mode', true, { freeAngleMode: true }],
      ['snap_to_tracks', true, { snapToTracks: true }],
      ['snap_to_pads', true, { snapToPads: true }],
      ['optimize_dragged_track', true, { optimizeEntireDraggedTrack: true }],
      ['auto_posture', false, { autoPosture: false }],
      ['fix_all_segments', false, { fixAllSegments: false }],
      ['walkaround_hug_length_threshold', 3.25, { walkaroundHugLengthThreshold: 3.25 }],
    ];

    for (const [key, value, expected] of cases) {
      expect(readRoutingSettings({ [key]: value })).toEqual({
        ...DEFAULT_ROUTING_SETTINGS,
        ...expected,
      });
    }
  });

  it('falls back to the default when a stored value is of the wrong type', () => {
    // PARAM<T>::Load takes the value only when Get<T> can produce a T.
    expect(readRoutingSettings({ remove_loops: 'yes' }).removeLoops).toBe(true);
    expect(readRoutingSettings({ shove_iteration_limit: 'lots' }).shoveIterationLimit).toBe(250);
    expect(readRoutingSettings({ shove_iteration_limit: null }).shoveIterationLimit).toBe(250);
    expect(readRoutingSettings({ mode: true }).routingMode).toBe(PnsMode.RM_Walkaround);
    expect(readRoutingSettings({ walkaround_hug_length_threshold: {} })).toEqual(
      DEFAULT_ROUTING_SETTINGS,
    );
    expect(readRoutingSettings({ shove_time_limit: Number.NaN }).shoveTimeLimit).toBe(1000);
  });

  it('truncates a float stored in an int param, but not in a double one', () => {
    // Get<int> on a JSON float narrows; walkaround_hug_length_threshold is the
    // one PARAM<double> in the block and keeps its fraction.
    expect(readRoutingSettings({ shove_iteration_limit: 12.9 }).shoveIterationLimit).toBe(12);
    expect(
      readRoutingSettings({ walkaround_hug_length_threshold: 12.9 }).walkaroundHugLengthThreshold,
    ).toBe(12.9);
  });

  it('does not range-check mode or effort, which are PARAM<int>, not PARAM_ENUM', () => {
    // reinterpret_cast<int*>( &m_routingMode ): upstream stores the raw int.
    expect(readRoutingSettings({ mode: 7 }).routingMode).toBe(7);
    expect(readRoutingSettings({ effort: -3 }).optimizerEffort).toBe(-3);
  });

  it('always resets corner_mode, whose registered range is inverted', () => {
    // PARAM_ENUM( "corner_mode", ..., min = ROUNDED_90 (3), max = MITERED_45
    // (0) ): no int satisfies 3 <= v <= 0, so every load takes the default.
    // Mirrored deliberately; see the comment on enumParam.
    for (const v of [0, 1, 2, 3, -1, 4])
      expect(readRoutingSettings({ corner_mode: v }).cornerMode).toBe(CornerMode.MITERED_45);
  });

  it('ignores keys it does not own', () => {
    expect(readRoutingSettings({ meta: { version: 0 }, not_a_setting: 42 })).toEqual(
      DEFAULT_ROUTING_SETTINGS,
    );
  });
});

describe('the mode overrules stored flags', () => {
  const withMode = (mode: PnsMode, over: Partial<RoutingSettings> = {}): RoutingSettings => ({
    ...DEFAULT_ROUTING_SETTINGS,
    routingMode: mode,
    ...over,
  });

  it('FollowMouse is off in Highlight collisions however it is stored', () => {
    expect(pnsFollowMouse(withMode(PnsMode.RM_MarkObstacles))).toBe(false);
    expect(pnsFollowMouse(withMode(PnsMode.RM_Shove))).toBe(true);
    expect(pnsFollowMouse(withMode(PnsMode.RM_Walkaround))).toBe(true);
    expect(pnsFollowMouse(withMode(PnsMode.RM_Shove, { followMouse: false }))).toBe(false);
  });

  it('AllowDRCViolations is only ever true in Highlight collisions', () => {
    const on = { allowDrcViolations: true };
    expect(pnsAllowDrcViolations(withMode(PnsMode.RM_MarkObstacles, on))).toBe(true);
    expect(pnsAllowDrcViolations(withMode(PnsMode.RM_Shove, on))).toBe(false);
    expect(pnsAllowDrcViolations(withMode(PnsMode.RM_Walkaround, on))).toBe(false);
    // ...and the raw setting survives the mode change, which is what the
    // dialog checkbox shows.
    expect(withMode(PnsMode.RM_Shove, on).allowDrcViolations).toBe(true);
    expect(pnsAllowDrcViolations(withMode(PnsMode.RM_MarkObstacles))).toBe(false);
  });

  it('InitialDirection is N, or NE when start_diagonal is set', () => {
    expect(pnsInitialDirection(withMode(PnsMode.RM_Walkaround)).dir).toBe(Directions.N);
    expect(pnsInitialDirection(withMode(PnsMode.RM_Walkaround, { startDiagonal: true })).dir).toBe(
      Directions.NE,
    );
  });
});

describe('the dialog interlock', () => {
  it('gives Highlight collisions the free-angle and DRC boxes only', () => {
    expect(pnsSettingsEnableState(PnsMode.RM_MarkObstacles)).toEqual({
      freeAngleMode: true,
      violateDrc: true,
      shoveVias: false,
      jumpOverObstacles: false,
    });
  });

  it('gives Shove the vias and jump boxes only', () => {
    expect(pnsSettingsEnableState(PnsMode.RM_Shove)).toEqual({
      freeAngleMode: false,
      violateDrc: false,
      shoveVias: true,
      jumpOverObstacles: true,
    });
  });

  it('leaves all four greyed out in Walk around', () => {
    // onModeChange tests only the two other radios, so Walk around enables
    // nothing — easy to "improve" into enabling the shove boxes, which would
    // let the user set an option that mode cannot act on.
    expect(pnsSettingsEnableState(PnsMode.RM_Walkaround)).toEqual({
      freeAngleMode: false,
      violateDrc: false,
      shoveVias: false,
      jumpOverObstacles: false,
    });
  });
});

describe('CycleRouterMode', () => {
  it('walks highlight -> shove -> walk around -> highlight', () => {
    expect(pnsCycleMode(PnsMode.RM_MarkObstacles)).toBe(PnsMode.RM_Shove);
    expect(pnsCycleMode(PnsMode.RM_Shove)).toBe(PnsMode.RM_Walkaround);
    expect(pnsCycleMode(PnsMode.RM_Walkaround)).toBe(PnsMode.RM_MarkObstacles);
  });
});
