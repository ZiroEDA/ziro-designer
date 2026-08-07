// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PNS::ROUTER` — the state machine, the mode dispatch, and the commit path.
 *
 * `ROUTER` does no geometry. Every method is a guard on the state, a
 * delegation to whichever placer or dragger is current, and a view update. So
 * what is worth pinning is not "does this route correctly" — the placers own
 * that and have their own suites — but the transitions: which state a failed
 * start leaves behind, which of the placer and the dragger wins when both
 * exist, and whether `FixRoute` ends the session (it does not).
 *
 * Six upstream oddities are pinned rather than fixed. Each one is the kind of
 * thing a careful reimplementation would "clean up", and each one changes
 * behaviour if you do:
 *
 *  - `Move`'s `ClearTemporaryCaches()` is unreachable while routing, because
 *    both live cases return from inside the switch;
 *  - `GetUpdatedItems` handles `ROUTE_TRACK` and `DRAG_SEGMENT` but silently
 *    ignores `DRAG_COMPONENT`;
 *  - `StopRouting`'s ratsnest refresh happens *before* its own
 *    `RoutingInProgress()` early return, so an idle router with a leftover
 *    placer still updates nets and still keeps the placer;
 *  - `ClearWorld` drops the placer but not the dragger;
 *  - `SetOrthoMode` and `IsPlacingVia` guard on the placer existing rather than
 *    on the state, unlike the four methods next to them;
 *  - `DM_ANY` is `0x17` and does not include `DM_FREE_ANGLE`.
 *
 * ## What these tests do NOT pin
 *
 * See the survivor list at the bottom of this file. `PnsRouterIface` is
 * declared but unimplemented in this tree, so everything downstream of a real
 * board — `SyncWorld`'s content, `ImportSizes`, the clearance numbers handed to
 * `DisplayItem` — is stubbed here and pinned only for call order and count.
 */

import { describe, expect, it } from 'vitest';
import { CornerMode } from '@ziroeda/kimath/src/geometry/direction45.js';
import {
  DEFAULT_ROUTER_SIZES,
  PNS_HEAD_TRACE,
  PnsRouter,
  PnsRouterMode,
  PnsRouterState,
  type PnsPlacementAlgo,
  type PnsRouterAlgoFactory,
  type PnsRouterIface,
  type PnsRouterSizes,
} from '@ziroeda/pcbnew/src/router/pns_router.js';
import { DEFAULT_ROUTING_SETTINGS } from '@ziroeda/pcbnew/src/router/pns_routing_settings.js';
import {
  PnsDragAlgo,
  PnsDragMode,
  makePnsRouterHost,
} from '@ziroeda/pcbnew/src/router/pns_drag_algo.js';
import type { PnsDiffPairPlacer } from '@ziroeda/pcbnew/src/router/pns_diff_pair_placer.js';
import type { PnsDpMeanderPlacer } from '@ziroeda/pcbnew/src/router/pns_dp_meander_placer.js';
import { PnsItemSet } from '@ziroeda/pcbnew/src/router/pns_itemset.js';
import { PnsKind } from '@ziroeda/pcbnew/src/router/pns_item.js';
import { PnsLayerRange } from '@ziroeda/pcbnew/src/router/pns_layerset.js';
import { PnsLine, PnsLineChain } from '@ziroeda/pcbnew/src/router/pns_line_item.js';
import type { PnsMeanderPlacer } from '@ziroeda/pcbnew/src/router/pns_meander_placer.js';
import type { PnsMeanderSkewPlacer } from '@ziroeda/pcbnew/src/router/pns_meander_skew_placer.js';
import { PnsNode } from '@ziroeda/pcbnew/src/router/pns_node.js';
import { PnsSegment } from '@ziroeda/pcbnew/src/router/pns_segment.js';
import { PnsSolid } from '@ziroeda/pcbnew/src/router/pns_solid.js';
import type { NetHandle } from '@ziroeda/pcbnew/src/router/pns_collision.js';
import type { RoutingSettings } from '@ziroeda/pcbnew/src/router/pns_routing_settings.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

// ---------------------------------------------------------------------------
// The declaration this port exists to define: every placer already in the tree
// must satisfy `PnsPlacementAlgo`. These are compile-time assertions — if the
// interface drifts from what the four concrete placers implement, `tsc` fails
// here rather than at some call site months later. They are the reason the
// interface can be trusted as the contract for the unported LINE_PLACER.

const _dpConformsToPlacementAlgo: PnsPlacementAlgo = null as unknown as PnsDiffPairPlacer;
const _meanderConformsToPlacementAlgo: PnsPlacementAlgo = null as unknown as PnsMeanderPlacer;
const _dpMeanderConformsToPlacementAlgo: PnsPlacementAlgo = null as unknown as PnsDpMeanderPlacer;
const _skewConformsToPlacementAlgo: PnsPlacementAlgo = null as unknown as PnsMeanderSkewPlacer;
void _dpConformsToPlacementAlgo;
void _meanderConformsToPlacementAlgo;
void _dpMeanderConformsToPlacementAlgo;
void _skewConformsToPlacementAlgo;

// ---------------------------------------------------------------------------
// fixtures

/** Every call the router made on its interface, in order. */
type IfaceLog = string[];

function makeIface(aLog: IfaceLog): PnsRouterIface {
  return {
    syncWorld: () => aLog.push('syncWorld'),
    addItem: () => aLog.push('addItem'),
    updateItem: () => aLog.push('updateItem'),
    removeItem: () => aLog.push('removeItem'),
    isAnyLayerVisible: () => true,
    isItemVisible: () => true,
    isFlashedOnLayer: () => true,
    isPnsCopperLayer: () => true,
    displayItem: (_i, _c, _e, aFlags) => aLog.push(`displayItem:${aFlags ?? 0}`),
    displayPathLine: () => aLog.push('displayPathLine'),
    displayRatline: () => aLog.push('displayRatline'),
    hideItem: () => aLog.push('hideItem'),
    commit: () => aLog.push('commit'),
    importSizes: () => true,
    stackupHeight: () => 0,
    eraseView: () => aLog.push('eraseView'),
    getNetCode: () => 0,
    getNetName: () => '',
    updateNet: () => aLog.push('updateNet'),
    getOrphanedNetHandle: () => null,
    getWorld: () => null,
    getRuleResolver: () => null,
    getBoardLayerFromPnsLayer: () => 'F.Cu',
    getPnsLayerFromBoardLayer: () => 0,
    startPointUnroutableReason: () => null,
    calculateRoutedPathLength: () => 0,
    calculateRoutedPathDelay: () => 0,
    calculateLengthForDelay: () => 0,
    calculateDelayForShapeLineChain: () => 0,
    getSignalAggregate: () => null,
    getNetBoardLength: () => 0,
  };
}

interface FakePlacer extends PnsPlacementAlgo {
  log: string[];
  startResult: boolean;
  placedAnything: boolean;
  placingVia: boolean;
  layerResult: boolean;
  node: PnsNode | null;
  end: Vec2;
  nets: NetHandle[];
  layer: number;
  traceSet: PnsItemSet;
  modifiedNets: NetHandle[];
}

function makePlacer(aOverrides: Partial<FakePlacer> = {}): FakePlacer {
  const p: FakePlacer = {
    log: [],
    startResult: true,
    placedAnything: true,
    placingVia: false,
    layerResult: true,
    node: null,
    end: { x: 0, y: 0 },
    nets: [7],
    layer: 0,
    traceSet: new PnsItemSet(),
    modifiedNets: [],

    start(aP) {
      p.log.push(`start:${aP.x},${aP.y}`);

      return p.startResult;
    },
    move(aP) {
      p.log.push(`move:${aP.x},${aP.y}`);

      return true;
    },
    fixRoute(_aP, _aEnd, aForceFinish) {
      p.log.push(`fixRoute:${aForceFinish === true}`);

      return true;
    },
    traces: () => p.traceSet,
    currentStart: () => ({ x: 0, y: 0 }),
    currentEnd: () => p.end,
    currentNets: () => p.nets,
    currentLayer: () => p.layer,
    currentNode: () => p.node,
    unfixRoute() {
      p.log.push('unfixRoute');

      return { x: 42, y: 43 };
    },
    commitPlacement() {
      p.log.push('commitPlacement');

      return true;
    },
    hasPlacedAnything: () => p.placedAnything,
    toggleVia(aEnabled) {
      p.log.push(`toggleVia:${aEnabled}`);
      p.placingVia = aEnabled;

      return true;
    },
    isPlacingVia: () => p.placingVia,
    setLayer(aLayer) {
      p.log.push(`setLayer:${aLayer}`);
      p.layer = aLayer;

      return p.layerResult;
    },
    flipPosture: () => void p.log.push('flipPosture'),
    updateSizes: (aSizes) => void p.log.push(`updateSizes:${aSizes.trackWidth}`),
    setOrthoMode: (aOn) => void p.log.push(`setOrthoMode:${aOn}`),
    getModifiedNets: (aNets) => void aNets.push(...p.modifiedNets),
    setDebugDecorator: () => void p.log.push('setDebugDecorator'),
  };

  return Object.assign(p, aOverrides);
}

/**
 * A `DRAG_ALGO` that records what the router asked of it.
 *
 * `PnsDragAlgo` is an abstract class, not an interface, so this has to extend
 * it — which is the point: the fake cannot drift from the real base, and the
 * `setDebugDecorator` this port added to that base is inherited here rather
 * than restated.
 */
class FakeDragger extends PnsDragAlgo {
  log: string[] = [];
  startResult = true;
  node: PnsNode | null = null;
  nets: NetHandle[] = [11];
  layer = 3;
  traceSet = new PnsItemSet();

  override setWorld(aWorld: PnsNode | null): void {
    this.log.push('setWorld');
    super.setWorld(aWorld);
  }

  start(aP: Vec2): boolean {
    this.log.push(`start:${aP.x},${aP.y}`);

    return this.startResult;
  }

  drag(aP: Vec2): boolean {
    this.log.push(`drag:${aP.x},${aP.y}`);

    return true;
  }

  fixRoute(aForceCommit: boolean): boolean {
    this.log.push(`fixRoute:${aForceCommit}`);

    return true;
  }

  currentNode(): PnsNode | null {
    return this.node;
  }

  currentNets(): NetHandle[] {
    return this.nets;
  }

  currentLayer(): number {
    return this.layer;
  }

  traces(): PnsItemSet {
    return this.traceSet;
  }

  override setMode(aDragMode: PnsDragMode): void {
    this.log.push(`setMode:${aDragMode}`);
  }

  mode(): PnsDragMode {
    return PnsDragMode.DM_ANY;
  }

  getForceMarkObstaclesMode(_aDragStatus: { value: boolean }): boolean {
    return false;
  }

  override setDebugDecorator(aDecorator: unknown): void {
    this.log.push('setDebugDecorator');
    super.setDebugDecorator(aDecorator);
  }
}

function makeDragger(aOverrides: Partial<FakeDragger> = {}): FakeDragger {
  return Object.assign(new FakeDragger(makePnsRouterHost()), aOverrides);
}

/** A solid at `aP` on layer 0, routable, so the start-point scan accepts it. */
function makeSolid(aP: Vec2, aNet: NetHandle = 1): PnsSolid {
  const s = new PnsSolid();
  s.setPos(aP);
  s.setNet(aNet);
  s.setLayers(new PnsLayerRange(0, 0));

  return s;
}

function makeSegment(aA: Vec2, aB: Vec2, aNet: NetHandle = 1): PnsSegment {
  const s = new PnsSegment({ a: aA, b: aB }, aNet);
  s.setWidth(100);
  s.setLayers(new PnsLayerRange(0, 0));

  return s;
}

interface Harness {
  router: PnsRouter;
  iface: PnsRouterIface;
  log: IfaceLog;
  settings: RoutingSettings;
  placer: FakePlacer;
  dragger: FakeDragger;
  factory: PnsRouterAlgoFactory;
  built: string[];
}

/**
 * A router with a real (empty) world, a stub interface, and a factory that
 * hands out the same fake placer/dragger for every mode so the *dispatch* can
 * be observed without five different fakes.
 */
function makeHarness(aOpts: { sizes?: Partial<PnsRouterSizes> } = {}): Harness {
  const log: IfaceLog = [];
  const built: string[] = [];
  const placer = makePlacer();
  const dragger = makeDragger();

  const factory: PnsRouterAlgoFactory = {
    linePlacer: () => {
      built.push('linePlacer');

      return placer;
    },
    diffPairPlacer: () => {
      built.push('diffPairPlacer');

      return placer;
    },
    meanderPlacer: () => {
      built.push('meanderPlacer');

      return placer;
    },
    dpMeanderPlacer: () => {
      built.push('dpMeanderPlacer');

      return placer;
    },
    meanderSkewPlacer: () => {
      built.push('meanderSkewPlacer');

      return placer;
    },
    componentDragger: () => {
      built.push('componentDragger');

      return dragger;
    },
    multiDragger: () => {
      built.push('multiDragger');

      return dragger;
    },
    dragger: () => {
      built.push('dragger');

      return dragger;
    },
  };

  const router = new PnsRouter({ factory });
  const iface = makeIface(log);
  const settings: RoutingSettings = { ...DEFAULT_ROUTING_SETTINGS };

  router.setInterface(iface);
  router.loadSettings(settings);
  router.updateSizes({ ...DEFAULT_ROUTER_SIZES, ...aOpts.sizes });
  router.syncWorld();

  return { router, iface, log, settings, placer, dragger, factory, built };
}

// ---------------------------------------------------------------------------

describe('PnsRouter — construction and the singleton', () => {
  it('starts IDLE, in single-track mode, with no world', () => {
    const router = new PnsRouter();

    expect(router.getState()).toBe(PnsRouterState.IDLE);
    expect(router.mode()).toBe(PnsRouterMode.PNS_MODE_ROUTE_SINGLE);
    expect(router.routingInProgress()).toBe(false);
    expect(router.getWorld()).toBeNull();
    expect(router.getIterLimit()).toBe(0);
  });

  it('`ROUTER_MODE` is numbered from 1, not 0', () => {
    // pns_router.h:67-73. The value is persisted, so the offset is load-bearing.
    expect(PnsRouterMode.PNS_MODE_ROUTE_SINGLE).toBe(1);
    expect(PnsRouterMode.PNS_MODE_TUNE_DIFF_PAIR_SKEW).toBe(5);
  });

  it('`DM_ANY` is 0x17 and excludes `DM_FREE_ANGLE` — upstream, pinned', () => {
    // pns_router.h:82. Free-angle dragging is an explicit user action, not
    // something a permissive "any" mask should silently enable. The one-bit
    // "fix" is exactly what a careless port writes.
    expect(PnsDragMode.DM_ANY).toBe(0x17);
    expect(PnsDragMode.DM_ANY & PnsDragMode.DM_FREE_ANGLE).toBe(0);
    expect(PnsDragMode.DM_ANY & PnsDragMode.DM_CORNER).toBe(PnsDragMode.DM_CORNER);
    expect(PnsDragMode.DM_ANY & PnsDragMode.DM_ARC).toBe(PnsDragMode.DM_ARC);
  });

  it('the last-constructed router wins `getInstance()` — upstream, pinned', () => {
    // pns_router.cpp:58-62. Upstream calls this "an ugly singleton ... To be
    // fixed sometime in the future"; the ctor assigns unconditionally, so a
    // second router displaces the first.
    const first = new PnsRouter();
    expect(PnsRouter.getInstance()).toBe(first);

    const second = new PnsRouter();
    expect(PnsRouter.getInstance()).toBe(second);

    second.dispose();
    expect(PnsRouter.getInstance()).toBeNull();
  });

  it('`syncWorld` brackets the interface fill in a bulk add', () => {
    const log: IfaceLog = [];
    const router = new PnsRouter();
    router.setInterface(makeIface(log));
    router.syncWorld();

    expect(router.getWorld()).toBeInstanceOf(PnsNode);
    expect(log).toContain('syncWorld');
  });

  it('`clearWorld` drops the placer but NOT the dragger — upstream, pinned', () => {
    // pns_router.cpp:107-117: `m_placer.reset()` sits outside the
    // `if( m_world )`, and `m_dragger` is never touched here at all. Only
    // StopRouting drops the dragger.
    const h = makeHarness();

    h.router.setMode(PnsRouterMode.PNS_MODE_ROUTE_SINGLE);
    expect(h.router.startRouting({ x: 0, y: 0 }, null, 0)).toBe(true);
    expect(h.router.placer()).not.toBeNull();

    h.router.clearWorld();

    expect(h.router.placer()).toBeNull();
    expect(h.router.getWorld()).toBeNull();

    const h2 = makeHarness();
    expect(
      h2.router.startDragging(
        { x: 0, y: 0 },
        new PnsItemSet(makeSegment({ x: 0, y: 0 }, { x: 1, y: 0 })),
      ),
    ).toBe(true);
    h2.router.clearWorld();
    expect(h2.router.getDragger()).not.toBeNull();
  });
});

describe('PnsRouter — the mode dispatch', () => {
  const cases: [PnsRouterMode, string][] = [
    [PnsRouterMode.PNS_MODE_ROUTE_SINGLE, 'linePlacer'],
    [PnsRouterMode.PNS_MODE_ROUTE_DIFF_PAIR, 'diffPairPlacer'],
    [PnsRouterMode.PNS_MODE_TUNE_SINGLE, 'meanderPlacer'],
    [PnsRouterMode.PNS_MODE_TUNE_DIFF_PAIR, 'dpMeanderPlacer'],
    [PnsRouterMode.PNS_MODE_TUNE_DIFF_PAIR_SKEW, 'meanderSkewPlacer'],
  ];

  for (const [mode, expected] of cases) {
    it(`mode ${PnsRouterMode[mode]} builds the ${expected}`, () => {
      const h = makeHarness();
      // The diff-pair start-point gate needs a start item and a pair; bypass it
      // the way the user's "allow DRC violations" setting does, so this test
      // observes the dispatch and nothing else.
      h.settings.allowDrcViolations = true;
      h.router.setMode(mode);

      expect(h.router.startRouting({ x: 10, y: 20 }, null, 2)).toBe(true);
      expect(h.built).toEqual([expected]);
      expect(h.router.getState()).toBe(PnsRouterState.ROUTE_TRACK);
    });
  }

  it('an unknown mode returns false and leaves a live placer alone', () => {
    // pns_router.cpp:463-464 — `default: return false` never touches m_placer.
    const h = makeHarness();
    h.settings.allowDrcViolations = true;

    h.router.setMode(PnsRouterMode.PNS_MODE_TUNE_SINGLE);
    expect(h.router.startRouting({ x: 0, y: 0 }, null, 0)).toBe(true);
    const live = h.router.placer();

    h.router.setMode(99 as PnsRouterMode);
    expect(h.router.startRouting({ x: 0, y: 0 }, null, 0)).toBe(false);
    expect(h.router.placer()).toBe(live);
  });

  it('the placer is sized and layered before `start`, in that order', () => {
    // pns_router.cpp:467-470 — UpdateSizes seeds the widths Start() then uses.
    const h = makeHarness({ sizes: { trackWidth: 250 } });
    h.settings.allowDrcViolations = true;
    h.router.setMode(PnsRouterMode.PNS_MODE_ROUTE_SINGLE);

    h.router.startRouting({ x: 1, y: 2 }, null, 4);

    expect(h.placer.log).toEqual([
      'updateSizes:250',
      'setLayer:4',
      'setDebugDecorator',
      'start:1,2',
    ]);
  });

  it('a placer whose `start` fails resets the state to IDLE and drops it', () => {
    const h = makeHarness();
    h.settings.allowDrcViolations = true;
    h.placer.startResult = false;
    h.router.setMode(PnsRouterMode.PNS_MODE_ROUTE_SINGLE);

    expect(h.router.startRouting({ x: 0, y: 0 }, null, 0)).toBe(false);
    expect(h.router.getState()).toBe(PnsRouterState.IDLE);
    expect(h.router.placer()).toBeNull();
  });

  it('a mode with no factory entry fails the same way an unknown mode does', () => {
    // LINE_PLACER is not ported; a router wired without one must decline
    // rather than half-start.
    const router = new PnsRouter({ factory: {} });
    router.setInterface(makeIface([]));
    router.loadSettings({ ...DEFAULT_ROUTING_SETTINGS, allowDrcViolations: true });
    router.syncWorld();

    expect(router.startRouting({ x: 0, y: 0 }, null, 0)).toBe(false);
    expect(router.getState()).toBe(PnsRouterState.IDLE);
    expect(router.placer()).toBeNull();
  });
});

describe('PnsRouter — the drag dispatch', () => {
  it('an all-solids set launches the component dragger and DRAG_COMPONENT', () => {
    const h = makeHarness();
    const set = new PnsItemSet();
    set.add(makeSolid({ x: 0, y: 0 }));
    set.add(makeSolid({ x: 10, y: 0 }));

    expect(h.router.startDragging({ x: 5, y: 0 }, set)).toBe(true);
    expect(h.built).toEqual(['componentDragger']);
    expect(h.router.getState()).toBe(PnsRouterState.DRAG_COMPONENT);
  });

  it('more than one segment launches the multi dragger and DRAG_SEGMENT', () => {
    const h = makeHarness();
    const set = new PnsItemSet();
    set.add(makeSegment({ x: 0, y: 0 }, { x: 10, y: 0 }));
    set.add(makeSegment({ x: 10, y: 0 }, { x: 20, y: 0 }));

    expect(h.router.startDragging({ x: 5, y: 0 }, set)).toBe(true);
    expect(h.built).toEqual(['multiDragger']);
    expect(h.router.getState()).toBe(PnsRouterState.DRAG_SEGMENT);
  });

  it('a single segment launches the plain dragger', () => {
    const h = makeHarness();
    const set = new PnsItemSet();
    set.add(makeSegment({ x: 0, y: 0 }, { x: 10, y: 0 }));

    expect(h.router.startDragging({ x: 5, y: 0 }, set)).toBe(true);
    expect(h.built).toEqual(['dragger']);
    expect(h.router.getState()).toBe(PnsRouterState.DRAG_SEGMENT);
  });

  it('an empty set is refused before anything is constructed', () => {
    const h = makeHarness();

    expect(h.router.startDragging({ x: 0, y: 0 }, new PnsItemSet())).toBe(false);
    expect(h.built).toEqual([]);
    expect(h.router.getState()).toBe(PnsRouterState.IDLE);
  });

  it('the drag mode reaches the dragger, and the world does too', () => {
    const h = makeHarness();
    const set = new PnsItemSet();
    set.add(makeSegment({ x: 0, y: 0 }, { x: 10, y: 0 }));

    h.router.startDragging({ x: 5, y: 0 }, set, PnsDragMode.DM_CORNER);

    expect(h.dragger.log).toEqual([
      `setMode:${PnsDragMode.DM_CORNER}`,
      'setWorld',
      'setDebugDecorator',
      'start:5,0',
    ]);
  });

  it('the single-item overload defaults to DM_ANY, the set one to DM_COMPONENT', () => {
    // pns_router.h:208-209 — the two overloads carry different defaults.
    const h1 = makeHarness();
    h1.router.startDraggingItem({ x: 0, y: 0 }, makeSegment({ x: 0, y: 0 }, { x: 1, y: 0 }));
    expect(h1.dragger.log[0]).toBe(`setMode:${PnsDragMode.DM_ANY}`);

    const h2 = makeHarness();
    const set = new PnsItemSet();
    set.add(makeSegment({ x: 0, y: 0 }, { x: 1, y: 0 }));
    h2.router.startDragging({ x: 0, y: 0 }, set);
    expect(h2.dragger.log[0]).toBe(`setMode:${PnsDragMode.DM_COMPONENT}`);
  });

  it('a dragger whose `start` fails resets to IDLE and drops it', () => {
    const h = makeHarness();
    h.dragger.startResult = false;
    const set = new PnsItemSet();
    set.add(makeSegment({ x: 0, y: 0 }, { x: 10, y: 0 }));

    expect(h.router.startDragging({ x: 5, y: 0 }, set)).toBe(false);
    expect(h.router.getState()).toBe(PnsRouterState.IDLE);
    expect(h.router.getDragger()).toBeNull();
  });
});

describe('PnsRouter — Move', () => {
  it('routes to the placer in ROUTE_TRACK and to the dragger in a drag', () => {
    const h = makeHarness();
    h.settings.allowDrcViolations = true;
    h.router.setMode(PnsRouterMode.PNS_MODE_ROUTE_SINGLE);
    h.router.startRouting({ x: 0, y: 0 }, null, 0);

    h.router.move({ x: 9, y: 9 }, null);
    expect(h.placer.log).toContain('move:9,9');

    const h2 = makeHarness();
    const set = new PnsItemSet();
    set.add(makeSegment({ x: 0, y: 0 }, { x: 10, y: 0 }));
    h2.router.startDragging({ x: 5, y: 0 }, set);

    h2.router.move({ x: 7, y: 7 }, null);
    expect(h2.dragger.log).toContain('drag:7,7');
  });

  it('an IDLE move returns false and touches nothing', () => {
    const h = makeHarness();

    expect(h.router.move({ x: 1, y: 1 }, null)).toBe(false);
    expect(h.placer.log).toEqual([]);
    expect(h.dragger.log).toEqual([]);
  });

  it('`clearTemporaryCaches` is unreachable while routing — upstream, pinned', () => {
    // pns_router.cpp:499-514. Both live cases `return` from inside the switch,
    // so the ClearTemporaryCaches() at :512 only ever runs on the default
    // fall-through — i.e. only when there is nothing to clear. This reads
    // exactly like a `break` that should have been there; writing it
    // "sensibly" silently changes clearance-cache lifetime for every move.
    const cleared: string[] = [];
    const resolver = {
      clearance: () => 0,
      dpCoupledNet: () => null,
      dpNetPolarity: () => 0,
      dpNetPair: () => null,
      netCode: () => 0,
      netName: () => '',
      isInNetTie: () => false,
      isNetTieExclusion: () => false,
      isDrilledHole: () => false,
      isNonPlatedSlot: () => false,
      isKeepout: () => ({ isKeepout: false, keepoutObstacle: false }),
      queryConstraint: () => null,
      clearTemporaryCaches: () => void cleared.push('temp'),
      clearCaches: () => void cleared.push('all'),
    };

    const h = makeHarness();
    (h.iface as unknown as { getRuleResolver: () => unknown }).getRuleResolver = () => resolver;
    h.settings.allowDrcViolations = true;

    // IDLE: the default path runs, so the temporary caches ARE cleared.
    h.router.move({ x: 1, y: 1 }, null);
    expect(cleared).toContain('temp');

    cleared.length = 0;

    // ROUTE_TRACK: the live path returns first, so they are NOT.
    h.router.setMode(PnsRouterMode.PNS_MODE_ROUTE_SINGLE);
    h.router.startRouting({ x: 0, y: 0 }, null, 0);
    cleared.length = 0;
    h.router.move({ x: 2, y: 2 }, null);
    expect(cleared).not.toContain('temp');
  });

  it('a placing move erases the view first and tags the head PNS_HEAD_TRACE', () => {
    const h = makeHarness();
    h.settings.allowDrcViolations = true;
    h.router.setMode(PnsRouterMode.PNS_MODE_ROUTE_SINGLE);
    h.router.startRouting({ x: 0, y: 0 }, null, 0);
    h.log.length = 0;

    h.router.move({ x: 5, y: 5 }, null);

    expect(h.log[0]).toBe('eraseView');
    expect(PNS_HEAD_TRACE).toBe(1);
  });
});

describe('PnsRouter — FixRoute and the session end', () => {
  it('FixRoute does NOT leave ROUTE_TRACK', () => {
    // pns_router.cpp:912-935 has no state assignment at all. Fixing a corner
    // mid-track keeps the session alive; ending it is CommitRouting()'s job.
    const h = makeHarness();
    h.settings.allowDrcViolations = true;
    h.router.setMode(PnsRouterMode.PNS_MODE_ROUTE_SINGLE);
    h.router.startRouting({ x: 0, y: 0 }, null, 0);

    expect(h.router.fixRoute({ x: 3, y: 3 }, null, false, false)).toBe(true);
    expect(h.router.getState()).toBe(PnsRouterState.ROUTE_TRACK);
  });

  it('aForceFinish reaches only the placer and aForceCommit only the dragger', () => {
    // pns_router.cpp:922 and :927 — the two flags are not interchangeable.
    const h = makeHarness();
    h.settings.allowDrcViolations = true;
    h.router.setMode(PnsRouterMode.PNS_MODE_ROUTE_SINGLE);
    h.router.startRouting({ x: 0, y: 0 }, null, 0);

    h.router.fixRoute({ x: 0, y: 0 }, null, true, false);
    expect(h.placer.log).toContain('fixRoute:true');

    const h2 = makeHarness();
    const set = new PnsItemSet();
    set.add(makeSegment({ x: 0, y: 0 }, { x: 10, y: 0 }));
    h2.router.startDragging({ x: 5, y: 0 }, set);

    h2.router.fixRoute({ x: 0, y: 0 }, null, false, true);
    expect(h2.dragger.log).toContain('fixRoute:true');
  });

  it('an IDLE FixRoute is false', () => {
    const h = makeHarness();

    expect(h.router.fixRoute({ x: 0, y: 0 }, null, true, true)).toBe(false);
  });

  it('commitRoutingSession commits the placement then stops', () => {
    const h = makeHarness();
    h.settings.allowDrcViolations = true;
    h.router.setMode(PnsRouterMode.PNS_MODE_ROUTE_SINGLE);
    h.router.startRouting({ x: 0, y: 0 }, null, 0);

    h.router.commitRoutingSession();

    expect(h.placer.log).toContain('commitPlacement');
    expect(h.router.getState()).toBe(PnsRouterState.IDLE);
    expect(h.router.placer()).toBeNull();
    expect(h.router.getDragger()).toBeNull();
  });

  it('stopRouting updates nets BEFORE its own early return — upstream, pinned', () => {
    // pns_router.cpp:964-989: the ratsnest refresh is above the
    // `if( !RoutingInProgress() ) return;`. So an idle router that still holds
    // a placer refreshes the nets and *keeps* the placer. Hoisting the guard
    // to the top of the method — the obvious tidy-up — drops a ratsnest
    // refresh the UI depends on.
    const h = makeHarness();
    h.settings.allowDrcViolations = true;
    h.placer.modifiedNets = [3, 4];
    h.router.setMode(PnsRouterMode.PNS_MODE_ROUTE_SINGLE);
    h.router.startRouting({ x: 0, y: 0 }, null, 0);

    // Force the state back to IDLE while the placer is still attached — the
    // shape a partially torn-down session has upstream, and the only way the
    // early return is reachable with a live placer.
    (h.router as unknown as { mState: PnsRouterState }).mState = PnsRouterState.IDLE;
    h.log.length = 0;

    h.router.stopRouting();

    // The nets were refreshed even though the method returned early ...
    expect(h.log.filter((e) => e === 'updateNet')).toHaveLength(2);
    // ... and because it returned early, the placer survived and the view was
    // never erased. Hoisting the guard to the top of the method kills the
    // first assertion; dropping the guard kills the second two.
    expect(h.router.placer()).not.toBeNull();
    expect(h.log).not.toContain('eraseView');
  });

  it('a stop with no placer and no session does nothing at all', () => {
    const h = makeHarness();
    h.log.length = 0;

    h.router.stopRouting();

    expect(h.log).toEqual([]);
  });

  it('a live session stops fully: placer, dragger, view, state, world', () => {
    const h = makeHarness();
    h.settings.allowDrcViolations = true;
    h.placer.modifiedNets = [3];
    h.router.setMode(PnsRouterMode.PNS_MODE_ROUTE_SINGLE);
    h.router.startRouting({ x: 0, y: 0 }, null, 0);
    h.log.length = 0;

    h.router.stopRouting();

    expect(h.log).toContain('updateNet');
    expect(h.log).toContain('eraseView');
    expect(h.router.placer()).toBeNull();
    expect(h.router.getDragger()).toBeNull();
    expect(h.router.getState()).toBe(PnsRouterState.IDLE);
  });

  it('undoLastSegment refuses when idle and returns null in a drag', () => {
    // pns_router.cpp:943-952: `RoutingInProgress()` is true in both drag
    // states, where m_placer is null — upstream dereferences it and crashes.
    // That is UB, not behaviour, so this returns null. Deliberate divergence.
    const h = makeHarness();
    expect(h.router.undoLastSegment()).toBeNull();

    const set = new PnsItemSet();
    set.add(makeSegment({ x: 0, y: 0 }, { x: 10, y: 0 }));
    h.router.startDragging({ x: 5, y: 0 }, set);
    expect(h.router.getState()).toBe(PnsRouterState.DRAG_SEGMENT);
    expect(h.router.undoLastSegment()).toBeNull();
  });

  it('undoLastSegment delegates while routing', () => {
    const h = makeHarness();
    h.settings.allowDrcViolations = true;
    h.router.setMode(PnsRouterMode.PNS_MODE_ROUTE_SINGLE);
    h.router.startRouting({ x: 0, y: 0 }, null, 0);

    expect(h.router.undoLastSegment()).toEqual({ x: 42, y: 43 });
  });
});

describe('PnsRouter — head manipulation guards', () => {
  function routing(): Harness {
    const h = makeHarness();
    h.settings.allowDrcViolations = true;
    h.router.setMode(PnsRouterMode.PNS_MODE_ROUTE_SINGLE);
    h.router.startRouting({ x: 0, y: 0 }, null, 0);
    h.placer.log.length = 0;

    return h;
  }

  it('switchLayer, flipPosture and toggleViaPlacement need ROUTE_TRACK', () => {
    const idle = makeHarness();
    expect(idle.router.switchLayer(3)).toBe(false);
    idle.router.flipPosture();
    idle.router.toggleViaPlacement();
    expect(idle.placer.log).toEqual([]);

    const h = routing();
    expect(h.router.switchLayer(3)).toBe(true);
    h.router.flipPosture();
    expect(h.placer.log).toContain('setLayer:3');
    expect(h.placer.log).toContain('flipPosture');
  });

  it('toggleViaPlacement pushes the negation of the placer’s own answer', () => {
    const h = routing();

    h.router.toggleViaPlacement();
    expect(h.placer.log).toContain('toggleVia:true');
    expect(h.router.isPlacingVia()).toBe(true);

    h.placer.log.length = 0;
    h.router.toggleViaPlacement();
    expect(h.placer.log).toContain('toggleVia:false');
  });

  it('setOrthoMode and isPlacingVia guard on the placer, not the state — pinned', () => {
    // pns_router.cpp:1057-1063 and :1082-1088 — unlike their four neighbours,
    // these two never look at m_state. A stale placer still answers.
    const h = makeHarness();
    h.settings.allowDrcViolations = true;
    h.placer.placingVia = true;
    h.router.setMode(PnsRouterMode.PNS_MODE_ROUTE_SINGLE);
    h.router.startRouting({ x: 0, y: 0 }, null, 0);

    // Force the state back to IDLE without clearing the placer, the way a
    // half-finished teardown leaves it.
    (h.router as unknown as { mState: PnsRouterState }).mState = PnsRouterState.IDLE;

    expect(h.router.isPlacingVia()).toBe(true);
    h.placer.log.length = 0;
    h.router.setOrthoMode(true);
    expect(h.placer.log).toContain('setOrthoMode:true');

    // ... while switchLayer, which does check the state, refuses.
    expect(h.router.switchLayer(1)).toBe(false);
  });

  it('updateSizes only reaches a placer in ROUTE_TRACK', () => {
    const idle = makeHarness();
    idle.router.updateSizes({ ...DEFAULT_ROUTER_SIZES, trackWidth: 999 });
    expect(idle.placer.log).toEqual([]);
    expect(idle.router.sizes().trackWidth).toBe(999);

    const h = routing();
    h.router.updateSizes({ ...DEFAULT_ROUTER_SIZES, trackWidth: 500 });
    expect(h.placer.log).toContain('updateSizes:500');
  });

  it('the placer wins over the dragger for nets and layer', () => {
    // pns_router.cpp:1029-1048 — placer first, dragger second, then the
    // empty/-1 fallbacks.
    const h = makeHarness();
    expect(h.router.getCurrentNets()).toEqual([]);
    expect(h.router.getCurrentLayer()).toBe(-1);

    const set = new PnsItemSet();
    set.add(makeSegment({ x: 0, y: 0 }, { x: 10, y: 0 }));
    h.router.startDragging({ x: 5, y: 0 }, set);
    expect(h.router.getCurrentNets()).toEqual([11]);
    expect(h.router.getCurrentLayer()).toBe(3);

    h.settings.allowDrcViolations = true;
    h.router.setMode(PnsRouterMode.PNS_MODE_ROUTE_SINGLE);
    h.placer.layer = 8;
    h.router.startRouting({ x: 0, y: 0 }, null, 8);
    expect(h.router.getCurrentNets()).toEqual([7]);
    expect(h.router.getCurrentLayer()).toBe(8);
  });
});

describe('PnsRouter — toggleCornerMode', () => {
  it('cycles MITERED_45 → ROUNDED_45 → MITERED_90 → ROUNDED_90 → MITERED_45', () => {
    // pns_router.cpp:1066-1079.
    const h = makeHarness();
    const seen: CornerMode[] = [];

    h.settings.cornerMode = CornerMode.MITERED_45;

    for (let i = 0; i < 4; i++) {
      h.router.toggleCornerMode();
      seen.push(h.settings.cornerMode);
    }

    expect(seen).toEqual([
      CornerMode.ROUNDED_45,
      CornerMode.MITERED_90,
      CornerMode.ROUNDED_90,
      CornerMode.MITERED_45,
    ]);
  });

  it('writes through the borrowed settings object', () => {
    // `m_settings` is a borrowed pointer upstream, so the owner sees the change.
    const h = makeHarness();
    h.settings.cornerMode = CornerMode.MITERED_45;
    h.router.toggleCornerMode();

    expect(h.router.settings()).toBe(h.settings);
    expect(h.settings.cornerMode).toBe(CornerMode.ROUNDED_45);
  });
});

describe('PnsRouter — getUpdatedItems', () => {
  it('ignores DRAG_COMPONENT entirely — upstream, pinned', () => {
    // pns_router.cpp:830-856 handles ROUTE_TRACK and DRAG_SEGMENT and stops.
    // Upstream is unsure about it too: "There probably should be a debugging
    // assertion and possibly a PNS_LOGGER call here but I'm not sure how to be
    // proceed WLS."
    const h = makeHarness();
    const node = new PnsNode();
    h.dragger.node = node;
    h.dragger.traceSet = new PnsItemSet(makeSegment({ x: 0, y: 0 }, { x: 5, y: 0 }));

    const solids = new PnsItemSet();
    solids.add(makeSolid({ x: 0, y: 0 }));
    h.router.startDragging({ x: 0, y: 0 }, solids);
    expect(h.router.getState()).toBe(PnsRouterState.DRAG_COMPONENT);

    expect(h.router.getUpdatedItems()).toEqual({ removed: [], added: [], heads: [] });

    // The same dragger under DRAG_SEGMENT does report its heads.
    const h2 = makeHarness();
    h2.dragger.node = node;
    h2.dragger.traceSet = new PnsItemSet(makeSegment({ x: 0, y: 0 }, { x: 5, y: 0 }));
    const segs = new PnsItemSet();
    segs.add(makeSegment({ x: 0, y: 0 }, { x: 10, y: 0 }));
    h2.router.startDragging({ x: 0, y: 0 }, segs);
    expect(h2.router.getState()).toBe(PnsRouterState.DRAG_SEGMENT);

    expect(h2.router.getUpdatedItems().heads).toHaveLength(1);
  });

  it('heads are clones, not the placer’s own items', () => {
    const h = makeHarness();
    h.settings.allowDrcViolations = true;
    const seg = makeSegment({ x: 0, y: 0 }, { x: 10, y: 0 });
    h.placer.node = new PnsNode();
    h.placer.traceSet = new PnsItemSet(seg);
    h.router.setMode(PnsRouterMode.PNS_MODE_ROUTE_SINGLE);
    h.router.startRouting({ x: 0, y: 0 }, null, 0);

    const { heads } = h.router.getUpdatedItems();

    expect(heads).toHaveLength(1);
    expect(heads[0]).not.toBe(seg);
    expect(heads[0]?.kind()).toBe(PnsKind.SEGMENT_T);
  });

  it('an IDLE router reports nothing', () => {
    const h = makeHarness();

    expect(h.router.getUpdatedItems()).toEqual({ removed: [], added: [], heads: [] });
  });
});

describe('PnsRouter — commitRoutingTo', () => {
  it('a remove and an add sharing a Parent become one updateItem', () => {
    // pns_router.cpp:870-905. This is what preserves the board item's UUID and
    // pad data across a reroute: the pair is one edit, not two.
    const h = makeHarness();
    const parent = { layer: 'F.Cu' };

    const world = h.router.getWorld();
    expect(world).not.toBeNull();

    const oldSeg = makeSegment({ x: 0, y: 0 }, { x: 10, y: 0 });
    oldSeg.setParent(parent);
    world?.addSegment(oldSeg);

    const branch = world?.branch();
    expect(branch).toBeDefined();

    const newSeg = makeSegment({ x: 0, y: 0 }, { x: 10, y: 5 });
    newSeg.setParent(parent);
    branch?.removeSegment(oldSeg);
    branch?.addSegment(newSeg);

    h.log.length = 0;
    expect(h.router.commitRoutingTo(branch as PnsNode)).toBe(true);

    expect(h.log).toContain('updateItem');
    expect(h.log).not.toContain('removeItem');
    expect(h.log).not.toContain('addItem');
    // The board edit lands before the router's own world folds the branch in.
    expect(h.log[h.log.length - 1]).toBe('commit');
  });

  it('an unpaired removal and an unpaired addition stay separate', () => {
    const h = makeHarness();
    const world = h.router.getWorld();

    const oldSeg = makeSegment({ x: 0, y: 0 }, { x: 10, y: 0 });
    oldSeg.setParent({ layer: 'F.Cu' });
    world?.addSegment(oldSeg);

    const branch = world?.branch();
    const newSeg = makeSegment({ x: 20, y: 0 }, { x: 30, y: 0 });
    newSeg.setParent({ layer: 'F.Cu' });
    branch?.removeSegment(oldSeg);
    branch?.addSegment(newSeg);

    h.log.length = 0;
    h.router.commitRoutingTo(branch as PnsNode);

    expect(h.log).toContain('removeItem');
    expect(h.log).toContain('addItem');
    expect(h.log).not.toContain('updateItem');
  });

  it('a ROUTE_TRACK session that placed nothing commits nothing', () => {
    // pns_router.cpp:861-862 — the early return.
    const h = makeHarness();
    h.settings.allowDrcViolations = true;
    h.placer.placedAnything = false;
    h.router.setMode(PnsRouterMode.PNS_MODE_ROUTE_SINGLE);
    h.router.startRouting({ x: 0, y: 0 }, null, 0);

    const branch = h.router.getWorld()?.branch();
    h.log.length = 0;

    expect(h.router.commitRoutingTo(branch as PnsNode)).toBe(false);
    expect(h.log).toEqual([]);
  });

  it('the guard is on ROUTE_TRACK only — a drag commits regardless', () => {
    const h = makeHarness();
    h.placer.placedAnything = false;
    const set = new PnsItemSet();
    set.add(makeSegment({ x: 0, y: 0 }, { x: 10, y: 0 }));
    h.router.startDragging({ x: 5, y: 0 }, set);

    const branch = h.router.getWorld()?.branch();
    h.log.length = 0;

    expect(h.router.commitRoutingTo(branch as PnsNode)).toBe(true);
    expect(h.log).toContain('commit');
  });
});

describe('PnsRouter — isStartingPointRoutable', () => {
  it('allowDrcViolations short-circuits every other gate', () => {
    // pns_router.cpp:224-225 — the very first line of the function.
    const h = makeHarness({ sizes: { diffPairGap: 1, minClearance: 1000 } });
    h.settings.allowDrcViolations = true;
    h.router.setMode(PnsRouterMode.PNS_MODE_ROUTE_DIFF_PAIR);

    expect(h.router.isStartingPointRoutable({ x: 0, y: 0 }, null, 0)).toBe(true);
  });

  it('a diff-pair gap under the board minimum clearance is refused', () => {
    const h = makeHarness({ sizes: { diffPairGap: 100, minClearance: 1000 } });
    h.router.setMode(PnsRouterMode.PNS_MODE_ROUTE_DIFF_PAIR);

    expect(h.router.isStartingPointRoutable({ x: 0, y: 0 }, null, 0)).toBe(false);
    expect(h.router.failureReason()).toBe('Diff pair gap is less than board minimum clearance.');
  });

  it('a diff pair started in empty space is refused with its own message', () => {
    const h = makeHarness({ sizes: { diffPairGap: 1000, minClearance: 100 } });
    h.router.setMode(PnsRouterMode.PNS_MODE_ROUTE_DIFF_PAIR);

    expect(h.router.isStartingPointRoutable({ x: 0, y: 0 }, null, 0)).toBe(false);
    expect(h.router.failureReason()).toBe(
      'Cannot start a differential pair in the middle of nowhere.',
    );
  });

  it('one routable candidate clears the failure of every unroutable one', () => {
    // pns_router.cpp:248-252 — a routable item clears failureReason and breaks
    // out, regardless of how many unroutable items preceded it.
    const h = makeHarness();
    const world = h.router.getWorld();

    const bad = makeSolid({ x: 0, y: 0 });
    bad.setRoutable(false);
    world?.addSolid(bad);

    const good = makeSolid({ x: 0, y: 0 });
    world?.addSolid(good);

    (
      h.iface as unknown as { startPointUnroutableReason: () => string | null }
    ).startPointUnroutableReason = () => 'Cannot start routing from a text item.';

    expect(h.router.isStartingPointRoutable({ x: 0, y: 0 }, null, 0)).toBe(true);
  });

  it('an Edge.Cuts item is skipped even though it is on every layer', () => {
    // pns_router.cpp:241-243 — "Edge cuts are put on all layers, but they're
    // not *really* on all layers."
    const h = makeHarness();
    const world = h.router.getWorld();

    const edge = makeSolid({ x: 0, y: 0 });
    edge.setRoutable(false);
    edge.setParent({ layer: 'Edge.Cuts' });
    edge.setLayers(PnsLayerRange.all());
    world?.addSolid(edge);

    (
      h.iface as unknown as { startPointUnroutableReason: () => string | null }
    ).startPointUnroutableReason = () => 'should never be consulted';

    expect(h.router.isStartingPointRoutable({ x: 0, y: 0 }, null, 0)).toBe(true);
  });
});

describe('PnsRouter — getNearestRatnestAnchor', () => {
  it('fails when there are no current nets, before touching the topology', () => {
    // pns_router.cpp:522-523 — "Can't finish something with no connections".
    const h = makeHarness();

    expect(h.router.getNearestRatnestAnchor()).toBeNull();
    expect(h.router.finish()).toBe(false);
  });

  it('fails when the placer has no traces', () => {
    // pns_router.cpp:527 — `placer->Traces().Size() == 0`.
    const h = makeHarness();
    h.settings.allowDrcViolations = true;
    h.router.setMode(PnsRouterMode.PNS_MODE_ROUTE_SINGLE);
    h.router.startRouting({ x: 0, y: 0 }, null, 0);

    expect(h.placer.traces().size()).toBe(0);
    expect(h.router.getNearestRatnestAnchor()).toBeNull();
  });

  it('fails when the first trace is not a LINE', () => {
    // pns_router.cpp:530-533 — `dynamic_cast<LINE*>( placer->Traces()[0] )`.
    // A SEGMENT in slot 0 fails the cast and the whole lookup declines.
    const h = makeHarness();
    h.settings.allowDrcViolations = true;
    h.placer.node = new PnsNode();
    h.placer.traceSet = new PnsItemSet(makeSegment({ x: 0, y: 0 }, { x: 10, y: 0 }));
    h.router.setMode(PnsRouterMode.PNS_MODE_ROUTE_SINGLE);
    h.router.startRouting({ x: 0, y: 0 }, null, 0);

    expect(h.router.getNearestRatnestAnchor()).toBeNull();
  });

  it('a zero-segment trace with no joint at the start point finds nothing', () => {
    // pns_router.cpp:548-553: with SegmentCount() == 0 the lookup goes through
    // FindJoint at the placer's start rather than through the trace end, and a
    // missing joint is `return false`.
    const h = makeHarness();
    h.settings.allowDrcViolations = true;
    const line = new PnsLine();
    const chain = new PnsLineChain();
    chain.appendPoint({ x: 0, y: 0 });
    line.setShape(chain);
    line.setLayer(0);
    line.setNet(1);
    h.placer.node = new PnsNode();
    h.placer.traceSet = new PnsItemSet(line);
    h.router.setMode(PnsRouterMode.PNS_MODE_ROUTE_SINGLE);
    h.router.startRouting({ x: 0, y: 0 }, null, 0);

    expect(line.segmentCount()).toBe(0);
    expect(h.router.getNearestRatnestAnchor()).toBeNull();
  });

  it('continueFromEnd declines without an anchor, before committing anything', () => {
    // pns_router.cpp:636-639 — the anchor lookup precedes CommitRouting(), so a
    // failed lookup leaves the session untouched rather than half-committed.
    const h = makeHarness();
    h.settings.allowDrcViolations = true;
    h.placer.node = new PnsNode();
    h.placer.traceSet = new PnsItemSet(makeSegment({ x: 0, y: 0 }, { x: 10, y: 0 }));
    h.router.setMode(PnsRouterMode.PNS_MODE_ROUTE_SINGLE);
    h.router.startRouting({ x: 0, y: 0 }, null, 0);
    h.placer.log.length = 0;

    expect(h.router.continueFromEnd()).toBeNull();
    expect(h.placer.log).not.toContain('commitPlacement');
    expect(h.router.getState()).toBe(PnsRouterState.ROUTE_TRACK);
  });
});

/*
 * ## Mutation results, and the surface that was never mutated
 *
 * 12 mutants plus 2 controls over `pns_router.ts`, aimed at the state
 * machine's transitions and the two dispatches. All 12 were killed; both
 * controls (an `empty()` spelled as `size() === 0`, and iterating a copy of
 * `removed`) survived, as an equivalent mutant must. The harness scored
 * "suite did not run" separately from "suite failed", so a transform error
 * could not be counted as a kill.
 *
 * The mutants: hoisting `clearTemporaryCaches` above `move`'s switch;
 * negating the all-solids drag test; the multi-dragger's `> 1` threshold;
 * swapping the single and diff-pair arms of the mode switch; a failed
 * `startRouting` keeping its placer; `setLayer` after `start` instead of
 * before; `fixRoute` handing the placer `aForceCommit`; `fixRoute` ending the
 * session; hoisting `stopRouting`'s early return above the ratsnest refresh;
 * `getUpdatedItems` also handling `DRAG_COMPONENT`; `commitRoutingTo`
 * reporting a paired removal as a removal; and `toggleCornerMode` wrapping to
 * the wrong corner mode.
 *
 * ## Not mutated, because it is not reachable from here
 *
 * Two pieces of arithmetic in this file have no test and were left out of the
 * run rather than counted as survivors, since a mutant nothing can reach
 * proves nothing either way:
 *
 *  1. `movePlacing`'s excess-hole-clearance rule
 *     (`excessHoleClearance > clearance`). Reaching it needs a placer whose
 *     `traces()` returns a real `PnsLine` that `endsWithVia()`, over a node
 *     with a resolver answering different numbers for the via and its hole —
 *     i.e. most of LINE_PLACER's output, by hand. The value only ever reaches
 *     `DisplayItem`, so a wrong one draws a wrong halo and changes no route.
 *     Left for the PR that ports LINE_PLACER and gets such a head for free.
 *
 *  2. `markViolations`'s multilayer re-layering
 *     (`itemToMark.layers().isMultilayer() && !currentItem.layers().isMultilayer()`).
 *     Same fixture problem, plus open bug #484: `PnsLine.shape()` returns null,
 *     so a `PnsLine` head cannot collide with another line at all. The only
 *     reachable obstacles are pads and vias, which are exactly the multilayer
 *     side of the test and never the single-layer side. Pinning it today would
 *     pin the bug.
 *
 * Also uncovered, deliberately:
 *
 *  - `finish()`'s convergence loop and `continueFromEnd()`'s commit-and-restart
 *    past the point where the anchor is found. `TOPOLOGY::NearestUnconnected*`
 *    landed on main while this was in review, so `getNearestRatnestAnchor` is
 *    now a real port rather than a seam and its guards are covered below —
 *    but driving `finish()` to a *successful* fix needs a placer whose
 *    `currentEnd()` converges on a real ratsnest anchor, which means a real
 *    `LINE_PLACER` session. The pre-move convergence comparison documented at
 *    that site is therefore still unverified.
 *  - `updateView`'s ordering of violations ahead of the node's own removals.
 *    Verified by reading, not by test: it needs a node reporting both.
 *  - Everything behind `PnsRouterIface`. It is declared, not implemented.
 */
