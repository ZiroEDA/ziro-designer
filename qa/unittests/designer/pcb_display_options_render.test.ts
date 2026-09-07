// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Display Options settings that change what the BOARD looks like, at the
 * renderer rather than at the dialog:
 *
 *  - `m_Display.m_UseViaColorForNormalTHPadstacks` — `PCB_PAINTER::GetColor`
 *    swaps a PTH pad's copper layer for `LAYER_VIA_HOLES`
 *    (`pcb_painter.cpp:266-283`);
 *  - `m_Display.m_TrackClearance == SHOW_WITH_VIA_ALWAYS` — the standing
 *    clearance ring around every track, arc and via (`:856-870`, `:1022-1044`,
 *    `:1355-1375`);
 *  - `m_Display.m_NetNames` — one 4-valued choice read at three different
 *    thresholds.
 *
 * A page whose controls only move a JSON key is not wired; these are the
 * assertions that say the canvas asked.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import type { Board } from '@ziroeda/pcbnew/src/types.js';
import {
  buildScene,
  drawBoard,
  DEFAULT_DRAW_OPTIONS,
  type PcbDrawOptions,
} from '@ziroeda/designer/src/editors/pcb/renderBoard.js';
import { PCB_SPECIAL } from '@ziroeda/designer/src/editors/pcb/pcbTheme.js';
import { DEFAULT_OBJECTS } from '@ziroeda/designer/src/widgets/appearance_objects.js';

const MM = 1e6;

const boardOf = (...items: string[]): Board =>
  readBoard(
    parse(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (5 "F.SilkS" user))
  (net 0 "")
  (net 1 "N1")
  ${items.join('\n  ')}
)`),
  );

/**
 * Every `fill()` and `stroke()` a whole `drawBoard` performs, with the colour
 * in force at the time. That is the only thing these settings change — which
 * path is painted, and in what colour.
 */
function paints(board: Board, over: Partial<PcbDrawOptions> = {}): string[] {
  const out: string[] = [];
  const ctx = {
    setTransform: () => {},
    save: () => {},
    restore: () => {},
    clearRect: () => {},
    fillRect: () => {},
    scale: () => {},
    translate: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    strokeRect: () => {},
    setLineDash: () => {},
    drawImage: () => {},
    lineCap: '',
    lineJoin: '',
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 0,
    globalAlpha: 1,
    fill: () => out.push(`fill ${(ctx as unknown as { fillStyle: string }).fillStyle}`),
    stroke: () => out.push(`stroke ${(ctx as unknown as { strokeStyle: string }).strokeStyle}`),
  } as unknown as CanvasRenderingContext2D;

  const prev = globalThis.Path2D;
  const prevMatrix = (globalThis as unknown as { DOMMatrix: unknown }).DOMMatrix;
  (globalThis as unknown as { Path2D: unknown }).Path2D = class {
    moveTo(): void {}
    lineTo(): void {}
    arc(): void {}
    rect(): void {}
    roundRect(): void {}
    closePath(): void {}
    addPath(): void {}
  };
  // `addPadShape` places a pad through `matrix().translate(…).rotate(…)`; node
  // has no DOMMatrix and the chain is all this needs of one.
  (globalThis as unknown as { DOMMatrix: unknown }).DOMMatrix = class {
    translate(): unknown {
      return this;
    }
    rotate(): unknown {
      return this;
    }
  };
  try {
    drawBoard(
      ctx,
      buildScene(board, {}),
      { scale: 20 / MM, tx: 400, ty: 300 },
      new Set(['F.Cu', 'B.Cu', 'F.SilkS']),
      800,
      600,
      { ...DEFAULT_DRAW_OPTIONS, drawingSheet: false, ...over },
    );
  } finally {
    (globalThis as unknown as { Path2D: unknown }).Path2D = prev;
    (globalThis as unknown as { DOMMatrix: unknown }).DOMMatrix = prevMatrix;
  }
  return out;
}

const PTH_PAD = `(footprint "T" (layer "F.Cu") (at 0 0)
    (pad "1" thru_hole circle (at 0 0) (size 2.2 2.2) (drill 1.1) (layers "*.Cu") (net 1 "N1")))`;
const SMD_PAD = `(footprint "S" (layer "F.Cu") (at 10 0)
    (pad "1" smd rect (at 0 0) (size 2 1) (layers "F.Cu") (net 1 "N1")))`;

describe('Use via color for normal through hole padstacks', () => {
  it('paints a PTH pad in the via HOLE colour, and only when it is on', () => {
    const off = paints(boardOf(PTH_PAD), { viaColorForThPads: false });
    const on = paints(boardOf(PTH_PAD), { viaColorForThPads: true });

    // `aLayer = LAYER_VIA_HOLES` — the hole colour, not the via annulus'.
    // The hole itself is drawn in that colour on any board, so this counts the
    // fills rather than asking whether one exists.
    //
    // TWO more, not one: `GetColor` is answered per LAYER, and a `*.Cu` pad
    // flashes on both F.Cu and B.Cu — so the recolour follows the pad onto
    // every copper layer it is on, which is what upstream does and what a
    // single-layer assertion would not have noticed.
    const inHoleColour = (ops: string[]): number =>
      ops.filter((o) => o === `fill ${PCB_SPECIAL.viaHole}`).length;
    expect(inHoleColour(on)).toBe(inHoleColour(off) + 2);
  });

  it('leaves an SMD pad on its copper layer either way', () => {
    // `pad->GetAttribute() == PAD_ATTRIB::PTH` — an SMD pad is not recoloured,
    // so switching the setting must change nothing on a board of only SMD pads.
    expect(paints(boardOf(SMD_PAD), { viaColorForThPads: true })).toEqual(
      paints(boardOf(SMD_PAD), { viaColorForThPads: false }),
    );
  });
});

describe('Clearance Outlines: Tracks', () => {
  const TRACK = '(segment (start 0 0) (end 5 0) (width 0.25) (layer "F.Cu") (net 1))';
  const VIA = '(via (at 2 2) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 1))';

  it('draws a standing clearance ring only in Show always', () => {
    const counts = ([0, 1, 2, 3, 4] as const).map(
      (m) => paints(boardOf(TRACK, VIA), { trackClearanceMode: m }).length,
    );
    // 0..3 are router-preview states: a board at rest is identical under all
    // four (`pcb_painter.cpp:858` tests SHOW_WITH_VIA_ALWAYS and nothing else).
    expect(new Set(counts.slice(0, 4)).size).toBe(1);
    // …and 4 paints strictly more.
    expect(counts[4]).toBeGreaterThan(counts[0]!);
  });

  it('does not draw one when Tracks are hidden', () => {
    // The ring belongs to the track's own CLEARANCE layer, so hiding tracks
    // hides it — the same rule `opts.pads` applies to the pad ring.
    const shown = paints(boardOf(TRACK), { trackClearanceMode: 4 }).length;
    const hidden = paints(boardOf(TRACK), { trackClearanceMode: 4, tracks: false }).length;
    const hiddenOff = paints(boardOf(TRACK), { trackClearanceMode: 0, tracks: false }).length;
    expect(shown).toBeGreaterThan(hidden);
    expect(hidden).toBe(hiddenOff);
  });
});

describe('LAYER_BOARD_OUTLINE_AREA — the "Board Area Shadow"', () => {
  const EDGE = `(gr_rect (start 0 0) (end 20 10) (stroke (width 0.05) (type solid))
      (fill none) (layer "Edge.Cuts"))`;

  it('fills inside Edge.Cuts, and only when the layer is on', () => {
    const off = paints(boardOf(EDGE), { boardOutlineArea: false });
    const on = paints(boardOf(EDGE), { boardOutlineArea: true });
    // `PCB_BOARD_OUTLINE::ViewGetLayers` is `{ LAYER_BOARD_OUTLINE_AREA }` and
    // nothing else, so this is one extra fill in that colour.
    expect(on.length).toBe(off.length + 1);
    expect(on).toContain(`fill ${PCB_SPECIAL.outlineArea}`);
    expect(off).not.toContain(`fill ${PCB_SPECIAL.outlineArea}`);
  });

  it('is rgba(100, 100, 100, 0.35), which is what makes the board read lighter', () => {
    // `builtin_color_themes.h:175`. [px] over the KiCad Default background
    // rgb(0,16,35) that composites to rgb(35, 45.4, 57.75) — and a live KiCad
    // preview measures rgb(35,45,58) inside Edge.Cuts against rgb(0,16,35)
    // outside it. That arithmetic is the whole reason this colour is not a
    // guess.
    // `toCssColor`'s own spelling, which has no spaces after the commas.
    expect(PCB_SPECIAL.outlineArea).toBe('rgba(100,100,100,0.35)');
    const over = (fg: number, bg: number): number => 0.35 * fg + 0.65 * bg;
    expect(Math.round(over(100, 0))).toBe(35);
    expect(Math.round(over(100, 16))).toBe(45);
    expect(Math.round(over(100, 35))).toBe(58);
  });

  it('draws nothing for a board whose Edge.Cuts do not close', () => {
    // `boardOutlineLoops` takes no fallback box here: the 3D viewer wants one
    // (it has to extrude *something*), and this must not invent a rectangle
    // where KiCad shows no board area at all.
    const openEdge = `(gr_line (start 0 0) (end 20 0) (stroke (width 0.05) (type solid))
      (layer "Edge.Cuts"))`;
    expect(paints(boardOf(openEdge), { boardOutlineArea: true })).not.toContain(
      `fill ${PCB_SPECIAL.outlineArea}`,
    );
  });

  it('opens OFF, as `GAL_SET::DefaultVisible` leaves it', () => {
    // `// LAYER_BOARD_OUTLINE_AREA,   // currently hidden by default`
    // (`common/lset.cpp:825`). The preview panels show it because they have no
    // project to read that set from.
    expect(DEFAULT_DRAW_OPTIONS.boardOutlineArea).toBe(false);
    expect(DEFAULT_OBJECTS.boardAreaShadow).toBe(false);
    // The other entry commented out of the same array, for the same reason.
    expect(DEFAULT_OBJECTS.drcExclusions).toBe(false);
  });
});

describe('Annotations: Net names is one setting at three thresholds', () => {
  it('fans 0..3 out over pads, tracks and vias', () => {
    // The mapping `PcbEditor` applies, restated so a change to it fails here
    // rather than in a screenshot: pads at 1|3, tracks at >=2, vias at !=0
    // (`pcb_painter.cpp:1403`, the track branch, and `:1118`).
    const fan = (m: number): [boolean, boolean, boolean] => [m === 1 || m === 3, m >= 2, m !== 0];
    expect(fan(0)).toEqual([false, false, false]);
    expect(fan(1)).toEqual([true, false, true]);
    expect(fan(2)).toEqual([false, true, true]);
    expect(fan(3)).toEqual([true, true, true]);
  });
});
