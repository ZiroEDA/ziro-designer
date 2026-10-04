// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * "Automatically select track width" — `PNS_KICAD_IFACE_BASE::inheritTrackWidth`
 * (pcbnew/router/pns_kicad_iface.cpp:982-1096), as `ImportSizes` asks it: on
 * the router's own world, synced from a BOARD, the way ROUTER_TOOL starts a
 * route.
 */
import { describe, expect, it } from 'vitest';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { BOARD_DESIGN_SETTINGS } from '@ziroeda/pcbnew/board_design_settings.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import type { PnsItem } from '@ziroeda/pcbnew/router/pns_item.js';
import { PnsKind } from '@ziroeda/pcbnew/router/pns_item.js';
import {
  PNS_KICAD_IFACE,
  PnsDesignSettingsFromBds,
} from '@ziroeda/pcbnew/router/pns_kicad_iface.js';
import { PnsNode } from '@ziroeda/pcbnew/router/pns_node.js';
import { DEFAULT_ROUTER_SIZES, type PnsRouterSizes } from '@ziroeda/pcbnew/router/pns_router.js';

const MM = 1e6;
const U = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/**
 * A via at (20, 20) with three tracks meeting it: a wide one heading right on
 * F.Cu, a narrow one heading up on F.Cu, and a middling one on B.Cu; a pad at
 * (60, 20) with one 0.3 mm track; a lone via at (90, 90).
 */
const BOARD_TEXT = `(kicad_pcb (version 20241229) (generator "test")
  (general (thickness 1.6))
  (layers (0 "F.Cu" signal) (4 "In1.Cu" signal) (6 "In2.Cu" signal) (2 "B.Cu" signal))
  (setup)
  (net 0 "") (net 1 "a") (net 2 "b") (net 3 "c") (net 4 "d")
  (segment (start 20 20) (end 40 20) (width 0.5) (layer "F.Cu") (net 1) (uuid "${U(1)}"))
  (segment (start 20 20) (end 20 5) (width 0.2) (layer "F.Cu") (net 1) (uuid "${U(2)}"))
  (segment (start 20 20) (end 5 20) (width 0.35) (layer "B.Cu") (net 1) (uuid "${U(3)}"))
  (via (at 20 20) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 1) (uuid "${U(4)}"))
  (footprint "T:P" (layer "F.Cu") (at 60 20) (uuid "${U(5)}")
    (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu") (net 2 "b") (uuid "${U(6)}")))
  (segment (start 60 20) (end 70 20) (width 0.3) (layer "F.Cu") (net 2) (uuid "${U(7)}"))
  (via (at 90 90) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 3) (uuid "${U(8)}"))
  (segment (start 50 50) (end 80 50) (width 0.15) (layer "F.Cu") (net 4) (uuid "${U(9)}"))
  (segment (start 50 50) (end 50 30) (width 0.6) (layer "F.Cu") (net 4) (uuid "${U(10)}"))
  (via (at 50 50) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 4) (uuid "${U(11)}"))
)`;

/** ImportSizes from `aKind` at `aAt`, the route starting on `aLayer`, the cursor at `aCursor`. */
function inherited(
  aKind: PnsKind,
  aAt: { x: number; y: number },
  aLayer: PCB_LAYER_ID,
  aCursor = { x: 0, y: 0 },
): PnsRouterSizes {
  const board = ParseBoard(BOARD_TEXT);
  const bds: BOARD_DESIGN_SETTINGS = board.GetDesignSettings();
  bds.m_UseConnectedTrackWidth = true;
  const iface = new PNS_KICAD_IFACE(board, { designSettings: PnsDesignSettingsFromBds(bds) });
  const node = new PnsNode();
  node.beginBulkAdd();
  iface.syncWorld(node);
  node.finalizeBulkAdd();

  const start = node
    .hitTest({ x: aAt.x * MM, y: aAt.y * MM })
    .items()
    .find((i: PnsItem) => i.kind() === aKind)!;

  expect(start).toBeTruthy();
  iface.SetStartLayerFromPCBNew(aLayer);

  const sizes: PnsRouterSizes = { ...DEFAULT_ROUTER_SIZES };
  iface.importSizes(sizes, start, null, { x: aCursor.x * MM, y: aCursor.y * MM });
  return sizes;
}

const width = (s: PnsRouterSizes): number | null =>
  s.widthSource === 'existing track' ? s.trackWidth : null;

describe('branch 1 — the start item is itself a track', () => {
  it('takes its own width', () => {
    expect(width(inherited(PnsKind.SEGMENT_T, { x: 30, y: 20 }, PCB_LAYER_ID.F_Cu))).toBe(0.5 * MM);
  });
});

describe('branch 2 — a via or pad, with the cursor pointing at an exit stub', () => {
  it('takes the track whose FAR end is nearest the cursor', () => {
    const via = { x: 20, y: 20 };
    // Cursor off to the right: the far end (40, 20) wins → the 0.5 mm track.
    expect(width(inherited(PnsKind.VIA_T, via, PCB_LAYER_ID.F_Cu, { x: 38, y: 21 }))).toBe(
      0.5 * MM,
    );
    // Cursor above: the far end (20, 5) wins → the 0.2 mm track.
    expect(width(inherited(PnsKind.VIA_T, via, PCB_LAYER_ID.F_Cu, { x: 21, y: 7 }))).toBe(0.2 * MM);
  });

  it('only considers stubs on the start layer: a cursor left of the via on F.Cu', () => {
    // The B.Cu stub is the nearest to the cursor, and is skipped on F.Cu; the
    // F.Cu choice falls to the far end nearest (7, 20): (20, 5) beats (40, 20).
    expect(
      width(inherited(PnsKind.VIA_T, { x: 20, y: 20 }, PCB_LAYER_ID.F_Cu, { x: 7, y: 20 })),
    ).toBe(0.2 * MM);
  });

  it('starts from the B.Cu stub when the route starts on B.Cu', () => {
    expect(
      width(inherited(PnsKind.VIA_T, { x: 20, y: 20 }, PCB_LAYER_ID.B_Cu, { x: 7, y: 20 })),
    ).toBe(0.35 * MM);
  });

  it('a pad is a start item too', () => {
    expect(
      width(inherited(PnsKind.SOLID_T, { x: 60, y: 20 }, PCB_LAYER_ID.F_Cu, { x: 69, y: 20 })),
    ).toBe(0.3 * MM);
  });
});

describe('branch 3 — the fallback minimum', () => {
  it('is the narrowest stub on the start layer when there is no cursor', () => {
    expect(width(inherited(PnsKind.VIA_T, { x: 20, y: 20 }, PCB_LAYER_ID.F_Cu))).toBe(0.2 * MM);
    expect(width(inherited(PnsKind.VIA_T, { x: 20, y: 20 }, PCB_LAYER_ID.B_Cu))).toBe(0.35 * MM);
  });

  it('is the narrowest, not the stub pointing nearest the origin, with no cursor', () => {
    // At (50, 50) the narrow stub runs to (80, 50) and the wide one to (50, 30),
    // the far end nearer (0, 0): only the fallback picks 0.15.
    expect(width(inherited(PnsKind.VIA_T, { x: 50, y: 50 }, PCB_LAYER_ID.F_Cu))).toBe(0.15 * MM);
  });

  it('a cursor within one unit of the origin is no cursor: startPosInt truncates', () => {
    // `VECTOR2I startPosInt( aStartPosition.x, aStartPosition.y )` makes
    // (0.4, 0.3) the zero vector, so `aStartPosition != VECTOR2I()` is false.
    const s = inherited(PnsKind.VIA_T, { x: 50, y: 50 }, PCB_LAYER_ID.F_Cu, {
      x: 0.4 / MM,
      y: 0.3 / MM,
    });
    expect(width(s)).toBe(0.15 * MM);
  });

  it('is the narrowest on ANY layer when the start layer has none', () => {
    expect(width(inherited(PnsKind.VIA_T, { x: 20, y: 20 }, PCB_LAYER_ID.In1_Cu))).toBe(0.2 * MM);
  });
});

describe('what it refuses', () => {
  it('a joint with nothing on it leaves the netclass width', () => {
    expect(width(inherited(PnsKind.VIA_T, { x: 90, y: 90 }, PCB_LAYER_ID.F_Cu))).toBeNull();
  });
});
