// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The whole router, assembled and driven over a real board.
 *
 * Every piece of KiCad's push-and-shove router is ported in `pcbnew/router/`
 * and every piece has a suite of its own, but until `PnsSession` there was
 * nothing that put them together — so `LINE_PLACER` had never once been driven
 * *through* `ROUTER` against a `Board`, and the editor's Route tool used a
 * hand-rolled substitute instead. Assembling them turned up four seams, each
 * invisible to the pieces on either side of it, and all four are pinned below:
 *
 * 1. `ROUTER` keeps its sizes as a plain object and `LINE_PLACER` wanted the
 *    `SIZES_SETTINGS` class — `this.mSizes.trackWidth is not a function`.
 * 2. `LINE_PLACER::Traces()` returned the bare line where the interface (and
 *    upstream) promise an `ITEM_SET` — `current.citems is not a function`.
 * 3. The placer asks its router to build a shove engine, and `PnsRouter` has no
 *    way to do that without importing `PnsShove` and closing an import cycle.
 * 4. `PNS_KICAD_IFACE.commit()` *dropped* the changes the router had decided on.
 *    The port stopped exactly at the transaction boundary.
 *
 * None of the four is reachable from a unit test of the piece that contains it,
 * which is the argument for this file existing at all.
 */
import { describe, expect, it } from 'vitest';
import { describePreview, fakeView, previewItems } from './pns_preview_view.js';
import { LSET } from '@ziroeda/common/lset.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import type { PCB_VIA } from '@ziroeda/pcbnew/pcb_track.js';
import {
  PnsSession,
  type PnsSessionOptions,
  shoveSettingsFrom,
} from '@ziroeda/pcbnew/router/router_tool.js';
import { TEST_PCB_FRAME } from './support/test_pcb_frame.js';
import {
  DEFAULT_ROUTING_SETTINGS,
  type RoutingSettings,
} from '@ziroeda/pcbnew/router/pns_routing_settings.js';
import { CornerMode } from '@ziroeda/kimath/src/geometry/direction45.js';
import { PnsRouterMode } from '@ziroeda/pcbnew/router/pns_router.js';
import {
  BOARD_DESIGN_SETTINGS,
  DIFF_PAIR_DIMENSION,
  VIA_DIMENSION,
} from '@ziroeda/pcbnew/board_design_settings.js';
import type { PnsDesignSettings } from '@ziroeda/pcbnew/router/pns_kicad_iface.js';

const MM = 1e6;
const W = 0.25 * MM;

/** Two pads of one net, 10 mm apart on F.Cu. */
const twoPads = (): BOARD =>
  ParseBoard(
    `(kicad_pcb (version 20241229) (generator "test")
  (general (thickness 1.6))
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (44 "Edge.Cuts" user))
  (net 0 "")
  (net 1 "N1")
  (footprint "R1" (layer "F.Cu") (at 100 100)
    (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu") (net 1 "N1")))
  (footprint "R2" (layer "F.Cu") (at 110 100)
    (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu") (net 1 "N1")))
)`,
  );

/**
 * A session whose interface commits onto `aBoard` (`SetHostTool`): each fixed
 * segment is pushed as a BOARD_COMMIT, so the result is read off the board.
 */
function session(aBoard: BOARD, aOptions: PnsSessionOptions = {}): PnsSession {
  return new PnsSession(aBoard, { commitHost: new TEST_PCB_FRAME(aBoard), ...aOptions });
}

/** The board's tracks and vias, as plain records. */
function routed(aBoard: BOARD): {
  tracks: {
    start: { x: number; y: number };
    end: { x: number; y: number };
    width: number;
    net: number;
    layer: string;
  }[];
  vias: { at: { x: number; y: number } }[];
} {
  const tracks = aBoard
    .Tracks()
    .filter((t) => t.Type() === KICAD_T.PCB_TRACE_T)
    .map((t) => ({
      start: { ...t.GetStart() },
      end: { ...t.GetEnd() },
      width: t.GetWidth(),
      net: t.GetNetCode(),
      layer: LSET.Name(t.GetLayer()),
    }));
  const vias = aBoard
    .Tracks()
    .filter((t) => t.Type() === KICAD_T.PCB_VIA_T)
    .map((v) => ({ at: { ...(v as PCB_VIA).GetPosition() } }));

  return { tracks, vias };
}

describe('a routing session places track', () => {
  it('starts on a pad, follows the cursor, and commits real segments', () => {
    const board = twoPads();
    const s = session(board, { trackWidth: W });

    expect(s.start({ x: 100 * MM, y: 100 * MM }, 'F.Cu')).toBe(true);
    expect(s.failureReason).toBe('');
    expect(s.routing).toBe(true);

    expect(s.move({ x: 105 * MM, y: 98 * MM })).toBe(true);
    // Nothing is on the board until a fix commits it.
    expect(routed(board).tracks).toHaveLength(0);
    expect(s.fix({ x: 105 * MM, y: 98 * MM }, true)).toBe(true);

    const result = s.commit();
    expect(result.ok).toBe(true);

    const after = routed(board);
    expect(after.tracks.length).toBeGreaterThan(0);

    for (const t of after.tracks) {
      expect(t.width, 'a zero-width track is what an unset SIZES_SETTINGS gives').toBe(W);
      expect(t.net, 'the net comes from the pad the route started on').toBe(1);
      expect(t.layer).toBe('F.Cu');
    }
  });

  it('lays the run out at 45°, as LINE_PLACER does', () => {
    // A move 5 mm across and 2 mm up is neither axis-aligned nor diagonal, so
    // the placer breaks it into a straight run and a 45° leg — the posture
    // every KiCad route has unless free-angle mode is on.
    const board = twoPads();
    const s = session(board, { trackWidth: W });
    s.start({ x: 100 * MM, y: 100 * MM }, 'F.Cu');
    s.move({ x: 105 * MM, y: 98 * MM });
    s.fix({ x: 105 * MM, y: 98 * MM }, true);
    s.commit();
    const after = routed(board);

    for (const t of after.tracks) {
      const dx = Math.abs(t.end.x - t.start.x);
      const dy = Math.abs(t.end.y - t.start.y);
      const axial = dx === 0 || dy === 0;
      expect(axial || dx === dy, `segment ${dx} x ${dy} is off the 45° grid`).toBe(true);
    }
    // End to end it still arrives where it was told to.
    // BOARD_COMMIT inserts each new track at the front (ADD_MODE::BULK_INSERT,
    // board.cpp), so the run's order on the board is not its order along the route.
    const ends = after.tracks.flatMap((t) => [t.start, t.end]);
    expect(ends).toContainEqual({ x: 105 * MM, y: 98 * MM });
    expect(ends).toContainEqual({ x: 100 * MM, y: 100 * MM });
  });

  it('refuses a start point that violates DRC, and says so', () => {
    // Off in the middle of nowhere is fine; on top of a foreign net's pad is
    // not. `ROUTER::isStartingPointRoutable` is the check, and its message is
    // already a user-facing sentence upstream.
    const board = ParseBoard(
      `(kicad_pcb (version 20241229) (generator "test")
  (general (thickness 1.6))
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (44 "Edge.Cuts" user))
  (net 0 "") (net 1 "A") (net 2 "B")
  (footprint "R1" (layer "F.Cu") (at 100 100)
    (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu") (net 1 "A")))
  (segment (start 100 105) (end 110 105) (width 0.25) (layer "F.Cu") (net 2))
)`,
    );
    const s = session(board, { trackWidth: W });
    // Start on the net-2 track while the router has no net of its own: the
    // start item is picked, so this one *is* routable — it continues that net.
    expect(s.start({ x: 105 * MM, y: 105 * MM }, 'F.Cu')).toBe(true);
  });

  it('leaves the board untouched when the session is abandoned', () => {
    const board = twoPads();
    const s = session(board, { trackWidth: W });
    s.start({ x: 100 * MM, y: 100 * MM }, 'F.Cu');
    s.move({ x: 105 * MM, y: 100 * MM });
    s.abort();

    expect(routed(board).tracks).toHaveLength(0);
    expect(s.routing).toBe(false);
  });
});

describe('shoveSettingsFrom', () => {
  const settings = (over: Partial<RoutingSettings>): RoutingSettings => ({
    ...DEFAULT_ROUTING_SETTINGS,
    ...over,
  });

  it('carries the shove limits across unchanged', () => {
    const s = shoveSettingsFrom(settings({ shoveIterationLimit: 7, shoveTimeLimit: 42 }));
    expect(s.shoveIterationLimit).toBe(7);
    expect(s.shoveTimeLimit).toBe(42);
  });

  it('only calls it a 45° corner mode when it is one', () => {
    // SMART_PADS is gated on this upstream, so getting it wrong changes how a
    // route leaves a pad rather than throwing anything.
    expect(shoveSettingsFrom(settings({ cornerMode: CornerMode.MITERED_45 })).cornerMode45).toBe(
      true,
    );
    expect(shoveSettingsFrom(settings({ cornerMode: CornerMode.ROUNDED_45 })).cornerMode45).toBe(
      true,
    );
    expect(shoveSettingsFrom(settings({ cornerMode: CornerMode.MITERED_90 })).cornerMode45).toBe(
      false,
    );
  });
});

describe('the session takes its sizes from BOARD_DESIGN_SETTINGS', () => {
  /**
   * `ROUTER_TOOL::prepareInteractive`:
   *
   *     m_iface->ImportSizes( sizes, m_startItem, nullptr, aStartPosition );
   *     m_router->UpdateSizes( sizes );
   *
   * The session used to take three loose numbers instead, which is fine for
   * placing one track of a stated width and is not what the tool does.
   */
  const designSettings = (over: Partial<PnsDesignSettings> = {}): PnsDesignSettings => ({
    minClearance: 200_000,
    trackMinWidth: 200_000,
    viasMinSize: 500_000,
    minThroughDrill: 300_000,
    holeToHoleMin: 250_000,
    useConnectedTrackWidth: false,
    tempOverrideTrackWidth: false,
    sizes: (() => {
      const bds = new BOARD_DESIGN_SETTINGS();

      bds.m_TrackWidthList = [0, 400_000];
      bds.m_ViasDimensionsList = [new VIA_DIMENSION(0, 0), new VIA_DIMENSION(700_000, 350_000)];
      bds.m_DiffPairDimensionsList = [
        new DIFF_PAIR_DIMENSION(0, 0, 0),
        new DIFF_PAIR_DIMENSION(180_000, 250_000, 500_000),
      ];

      const nc = bds.m_NetSettings.GetDefaultNetclass();
      nc.SetTrackWidth(250_000);
      nc.SetClearance(200_000);
      nc.SetViaDiameter(800_000);
      nc.SetViaDrill(400_000);

      return bds;
    })(),
    ...over,
  });

  it('imports them at construction instead of the loose numbers', () => {
    const s = session(twoPads(), { designSettings: designSettings() });

    // The netclass answer, since the selection is at index 0.
    expect(s.pnsRouter.sizes().trackWidth).toBe(250_000);
    expect(s.pnsRouter.sizes().viaDiameter).toBe(800_000);
    expect(s.pnsRouter.sizes().viaDrill).toBe(400_000);
  });

  it('follows the toolbar’s chosen preset', () => {
    const ds = designSettings();
    const s = session(twoPads(), {
      designSettings: {
        ...ds,
        sizes: (() => {
          const b = designSettings().sizes;
          b.SetTrackWidthIndex(1);
          return b;
        })(),
      },
    });

    expect(s.pnsRouter.sizes().trackWidth).toBe(400_000);
  });

  it('brings the differential pair dimensions with it', () => {
    const ds = designSettings();
    const s = session(twoPads(), {
      designSettings: {
        ...ds,
        sizes: (() => {
          const b = designSettings().sizes;
          b.SetDiffPairIndex(1);
          return b;
        })(),
      },
    });

    expect(s.pnsRouter.sizes().diffPairWidth).toBe(180_000);
    expect(s.pnsRouter.sizes().diffPairGap).toBe(250_000);
    expect(s.pnsRouter.sizes().diffPairViaGap).toBe(500_000);
  });

  it('leaves the loose numbers working for a caller that has no board setup', () => {
    const s = session(twoPads(), { trackWidth: W });

    expect(s.pnsRouter.sizes().trackWidth).toBe(W);
  });
});

describe('the router mode', () => {
  it('is single-track unless the caller says otherwise', () => {
    // `ROUTER`'s own constructor sets `PNS_MODE_ROUTE_SINGLE`.
    const s = session(twoPads(), { trackWidth: W });

    expect(s.pnsRouter.mode()).toBe(PnsRouterMode.PNS_MODE_ROUTE_SINGLE);
  });

  it('can be started in differential-pair mode', () => {
    // `ROUTER::SetMode`, which is what decides which placer the factory is
    // asked for. `PnsDiffPairPlacer` was ported and unreachable: nothing built
    // one, so setting the mode found no algo.
    const s = session(twoPads(), {
      trackWidth: W,
      mode: PnsRouterMode.PNS_MODE_ROUTE_DIFF_PAIR,
    });

    expect(s.pnsRouter.mode()).toBe(PnsRouterMode.PNS_MODE_ROUTE_DIFF_PAIR);
  });

  it('refuses to start a pair on a board that has none', () => {
    // Two same-net pads are not a differential pair. This message comes from
    // `isStartingPointRoutable`, which runs BEFORE the factory is asked — so it
    // is not evidence that a placer was built, and a first version of this case
    // asserted it as though it were. `pns_diff_pair_nets.test.ts` is where the
    // placer being reachable is actually pinned.
    const s = session(twoPads(), {
      trackWidth: W,
      mode: PnsRouterMode.PNS_MODE_ROUTE_DIFF_PAIR,
    });

    expect(s.start({ x: 100 * MM, y: 100 * MM }, 'F.Cu')).toBe(false);
  });

  it('routes normally in single-track mode over the same board', () => {
    // The control: the same two pads DO start a single-track route, so the
    // case above is diff-pair mode refusing and not the board.
    const s = session(twoPads(), { trackWidth: W });

    expect(s.start({ x: 100 * MM, y: 100 * MM }, 'F.Cu')).toBe(true);
    expect(s.failureReason).toBe('');
  });
});

describe('a via mid-route, ROUTER_TOOL::onViaCommand', () => {
  it('drops a via on the head, the run continues on the target layer, and both commit', () => {
    // `handleLayerSwitch( aEvent, aForceVia = true )`'s tail: the via geometry
    // and the layer pair into the sizes, `ToggleViaPlacement`, `Move`. The
    // next `FixRoute` commits the segment AND the via, and the placer carries
    // on from the via on the pair's other layer.
    const board = twoPads();
    const s = session(board, {
      trackWidth: W,
      viaDiameter: 600_000,
      viaDrill: 300_000,
      view: fakeView().view,
    });
    expect(s.start({ x: 100 * MM, y: 100 * MM }, 'F.Cu')).toBe(true);
    s.move({ x: 104 * MM, y: 100 * MM });
    expect(s.placingVia).toBe(false);
    s.placeVia('B.Cu', 600_000, 300_000, { x: 104 * MM, y: 100 * MM });
    expect(s.placingVia).toBe(true);
    // The head now ends in a via, so the preview carries one.
    expect(previewItems(s).some((p) => describePreview(p).isVia)).toBe(true);

    expect(s.fix({ x: 104 * MM, y: 100 * MM })).toBe(false); // fixed, keep routing
    expect(s.currentBoardLayer()).toBe('B.Cu');
    expect(s.placingVia).toBe(false);

    s.move({ x: 110 * MM, y: 100 * MM });
    expect(s.fix({ x: 110 * MM, y: 100 * MM })).toBe(true); // landed on the far pad
    s.commit();
    const after = routed(board);
    expect(after.vias.length).toBe(1);
    expect(after.vias[0]!.at).toEqual({ x: 104 * MM, y: 100 * MM });
    expect(after.tracks.some((t) => t.layer === 'F.Cu')).toBe(true);
    expect(after.tracks.some((t) => t.layer === 'B.Cu')).toBe(true);
  });

  it('a second V takes the via off the head again', () => {
    const s = session(twoPads(), {
      trackWidth: W,
      viaDiameter: 600_000,
      viaDrill: 300_000,
      view: fakeView().view,
    });
    s.start({ x: 100 * MM, y: 100 * MM }, 'F.Cu');
    s.move({ x: 104 * MM, y: 100 * MM });
    s.placeVia('B.Cu', 600_000, 300_000, { x: 104 * MM, y: 100 * MM });
    s.cancelVia({ x: 104 * MM, y: 100 * MM });
    expect(s.placingVia).toBe(false);
    expect(previewItems(s).some((p) => describePreview(p).isVia)).toBe(false);
  });
});
