// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PNS::DRAG_ALGO` and the half of `PNS::ALGO_BASE` the draggers use.
 * Counterparts: `pcbnew/router/pns_drag_algo.h`, `pcbnew/router/pns_algo_base.h`,
 * and the `DRAG_MODE` enum from `pcbnew/router/pns_router.h:75-84`.
 *
 * `ALGO_BASE` holds four things: the `ROUTER*`, a `LOGGER*`, a
 * `DEBUG_DECORATOR*` and the `Settings()` accessor that forwards to the router.
 * Only the router and the settings do any work — the logger and the decorator
 * exist to feed `PNS_DBG`, which is compiled out of a release build and is
 * side-effect free in every dragger call site. They are not ported; the
 * accessors that would return them are not stubbed either, so nothing reads as
 * available-but-broken.
 */

import type { NetHandle } from './pns_collision.js';
import type { PnsItem } from './pns_item.js';
import type { PnsItemSet } from './pns_itemset.js';
import type { PnsNode } from './pns_node.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import type { LineDragArcFn } from './pns_line_drag.js';
import { lineDragArc } from './pns_line_drag.js';
import { DEFAULT_ROUTING_SETTINGS, type RoutingSettings } from './pns_routing_settings.js';
import type { PnsShoveSettings } from './pns_shove.js';
import { CornerMode } from '@ziroeda/kimath/src/geometry/direction45.js';

/**
 * `PNS::DRAG_MODE` (`pns_router.h:75-84`), a bit mask.
 *
 * `DRAGGER::m_mode` is declared `int`, not `DRAG_MODE`, and that is deliberate:
 * the caller writes `DM_CORNER | DM_FREE_ANGLE` into it through `SetMode()`,
 * `Start()` reads the free-angle bit out of it, and then `startDragSegment` and
 * friends **overwrite** it with a single mode bit. So the free-angle bit only
 * survives from `SetMode` to the top of `Start`.
 */
export enum PnsDragMode {
  DM_CORNER = 0x1,
  DM_SEGMENT = 0x2,
  DM_VIA = 0x4,
  DM_FREE_ANGLE = 0x8,
  DM_ARC = 0x10,
  DM_ANY = 0x17,
  DM_COMPONENT = 0x20,
}

/** `UNDEFINED_LAYER` (`include/layer_ids.h`), what `COMPONENT_DRAGGER` answers. */
export const PNS_UNDEFINED_LAYER = -1;

/**
 * `ADVANCED_CFG::m_MaxTangentAngleDeviation` (`common/advanced_config.cpp:243`),
 * in degrees. `DRAGGER::startDragArc` refuses an arc whose central angle plus
 * this reaches 180°.
 */
export const PNS_MAX_TANGENT_ANGLE_DEVIATION_DEG = 1.0;

/**
 * `ADVANCED_CFG::m_MaxTrackLengthToKeep` (`:244`), in **millimetres** — 0.0005,
 * i.e. 500 internal units at `IU_PER_MM = 1e6`. `startDragArc` halves it to
 * size the tangential stub it grows off an isolated arc end.
 */
export const PNS_MAX_TRACK_LENGTH_TO_KEEP_MM = 0.0005;

/** `pcbIUScale.IU_PER_MM`. */
export const PNS_IU_PER_MM = 1e6;

/**
 * The slice of `PNS::ROUTER` that the draggers reach for.
 *
 * `ROUTER` is not ported. Every dragger touches exactly three of its members —
 * `Settings()` (through `ALGO_BASE`), `CommitRouting( NODE* )` and
 * `SetFailureReason( const wxString& )` — so this is the whole seam, with
 * upstream's names.
 *
 * `dragArc` is not upstream's at all: it is the injection point for
 * `LINE::DragArc`, which has no port (see {@link lineDragArc}). It lives here
 * rather than as a constructor argument so that a host which *does* have the
 * geometry can supply it once for every dragger it builds.
 */
export interface PnsRouterHost {
  settings(): RoutingSettings;
  /** `ROUTER::CommitRouting( NODE* )`: apply this world state to the board. */
  commitRouting(aNode: PnsNode): void;
  /** `ROUTER::SetFailureReason( const wxString& )`. */
  setFailureReason(aReason: string): void;
  /** `LINE::DragArc`; see {@link lineDragArc} for why it is injected. */
  dragArc: LineDragArcFn;
}

/**
 * A host with upstream's defaults and no side effects, for tests and for
 * callers that only want the geometry.
 *
 * `commitRouting` deliberately does nothing: upstream's `CommitRouting` hands
 * the node to the board interface, which is outside the router entirely.
 */
export function makePnsRouterHost(aOverrides: Partial<PnsRouterHost> = {}): PnsRouterHost {
  return {
    settings: aOverrides.settings ?? (() => DEFAULT_ROUTING_SETTINGS),
    commitRouting: aOverrides.commitRouting ?? (() => undefined),
    setFailureReason: aOverrides.setFailureReason ?? (() => undefined),
    dragArc: aOverrides.dragArc ?? lineDragArc,
  };
}

/**
 * `ROUTING_SETTINGS` → the subset `SHOVE` was ported against.
 *
 * `PnsShoveSettings` predates `RoutingSettings` in this repo (see the shove
 * spec, §11) and carries the same values under the same upstream accessor
 * names. `cornerMode45` is the one derived field: upstream's shove asks
 * `GetCornerMode()` and enables `SMART_PADS` only for the 45° modes.
 */
export function toShoveSettings(aSettings: RoutingSettings): PnsShoveSettings {
  return {
    shoveIterationLimit: aSettings.shoveIterationLimit,
    shoveTimeLimit: aSettings.shoveTimeLimit,
    shoveVias: aSettings.shoveVias,
    jumpOverObstacles: aSettings.jumpOverObstacles,
    walkaroundIterationLimit: aSettings.walkaroundIterationLimit,
    optimizerEffort: aSettings.optimizerEffort,
    smartPads: aSettings.smartPads,
    cornerMode45:
      aSettings.cornerMode === CornerMode.MITERED_45 ||
      aSettings.cornerMode === CornerMode.ROUNDED_45,
  };
}

/**
 * `PNS::DRAG_ALGO`, the interface all three draggers implement.
 *
 * `SetMode` has an **empty default body** upstream, not a pure virtual one —
 * `MULTI_DRAGGER` relies on that and overrides it with another empty body.
 * `GetLastCommittedLeaderSegments` likewise defaults to an empty vector.
 */
export abstract class PnsDragAlgo {
  protected mWorld: PnsNode | null = null;

  constructor(protected readonly mRouter: PnsRouterHost) {}

  /** `ALGO_BASE::Router()`. */
  router(): PnsRouterHost {
    return this.mRouter;
  }

  /** `ALGO_BASE::Settings()`, which forwards to `Router()->Settings()`. */
  settings(): RoutingSettings {
    return this.mRouter.settings();
  }

  /** `DRAG_ALGO::SetWorld( NODE* )`. */
  setWorld(aWorld: PnsNode | null): void {
    this.mWorld = aWorld;
  }

  /** The world, for tests; upstream's `m_world` is protected. */
  world(): PnsNode | null {
    return this.mWorld;
  }

  abstract start(aP: Vec2, aPrimitives: PnsItemSet): boolean;

  abstract drag(aP: Vec2): boolean;

  abstract fixRoute(aForceCommit: boolean): boolean;

  abstract currentNode(): PnsNode | null;

  abstract currentNets(): NetHandle[];

  abstract currentLayer(): number;

  abstract traces(): PnsItemSet;

  /** Upstream's body is `{}`. */
  setMode(_aDragMode: PnsDragMode): void {}

  abstract mode(): PnsDragMode;

  /**
   * `GetForceMarkObstaclesMode( bool* aDragStatus )`: writes the drag status
   * through the pointer and *returns* whether the dragger has latched into
   * force-mark-obstacles mode. The out-parameter becomes a mutable box, as
   * `pns_node.ts` does for `aOriginSegmentIndex`.
   */
  abstract getForceMarkObstaclesMode(aDragStatus: { value: boolean }): boolean;

  /** Upstream returns an empty vector; only `MULTI_DRAGGER` overrides it. */
  getLastCommittedLeaderSegments(): PnsItem[] {
    return [];
  }
}
