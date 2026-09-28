// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DRC_INTERACTIVE_COURTYARD_CLEARANCE: the live courtyard-collision feedback
 * during a move (`drc_interactive_courtyard_clearance.cpp`).
 *
 * This is the red wash a footprint gets while you drag another one on top of
 * it. It is NOT the `courtyards_overlap` DRC violation: it runs per frame, it
 * collides at a hardcoded zero clearance, it marks BOTH sides including the
 * footprint under the cursor (the move tool passes `aHighlightMoved = true`),
 * and it also fires on a pad hole inside the other courtyard and on a rule
 * area that disallows footprints.
 */
import { describe, expect, it } from 'vitest';
import { COURTYARD_CONFLICT } from '@ziroeda/common/eda_item_flags.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { VIEW } from '@ziroeda/common/view/view.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import type { BOARD_ITEM } from '@ziroeda/pcbnew/board_item.js';
import { DRC_ENGINE } from '@ziroeda/pcbnew/drc/drc_engine.js';
import { DRC_INTERACTIVE_COURTYARD_CLEARANCE } from '@ziroeda/pcbnew/drc/drc_interactive_courtyard_clearance.js';
import type { FOOTPRINT } from '@ziroeda/pcbnew/footprint.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';

const MM = (n: number): number => pcbIUScale.mmToIU(n);

let seq = 0;
const U = (): string => `00000000-0000-4000-8000-${(++seq).toString(16).padStart(12, '0')}`;

/** A box courtyard, drawn as the four-sided fp_rect a library footprint has. */
const crtyd = (x0: number, y0: number, x1: number, y1: number, layer = 'F.CrtYd'): string =>
  `(fp_rect (start ${x0} ${y0}) (end ${x1} ${y1}) (stroke (width 0.05) (type solid)) (fill no) (layer "${layer}") (uuid "${U()}"))`;

const hole = (x: number, y: number): string =>
  `(pad "1" thru_hole circle (at ${x} ${y}) (size 1.5 1.5) (drill 0.8) (layers "*.Cu" "*.Mask") (uuid "${U()}"))`;

/**
 * A footprint anchored at (`ox`, 0); its children are relative to it. The
 * anchor matters: FOOTPRINT::GetBoundingBox starts from m_pos, and the
 * broad phase rejects on that box.
 */
const fp = (ref: string, ox: number, ...items: string[]): string =>
  `(footprint "L:F" (layer "F.Cu") (uuid "${U()}") (at ${ox} 0)
    (property "Reference" "${ref}" (at 0 0 0) (layer "F.SilkS") (hide yes) (uuid "${U()}"))
    ${items.join('\n    ')})`;

/** A rule area that always disallows tracks, and footprints when asked. */
const keepout = (footprints: boolean, layer = 'F.Cu'): string =>
  `(zone (net 0) (net_name "") (layer "${layer}") (uuid "${U()}") (hatch edge 0.5)
    (connect_pads (clearance 0))
    (min_thickness 0.25)
    (keepout (tracks not_allowed) (vias allowed) (pads allowed) (copperpour allowed)
      (footprints ${footprints ? 'not_allowed' : 'allowed'}))
    (fill (thermal_gap 0.5) (thermal_bridge_width 0.5))
    (polygon (pts (xy 0 0) (xy 10 0) (xy 10 10) (xy 0 10))))`;

const pcb = (...items: string[]): BOARD =>
  ParseBoard(`(kicad_pcb (version 20241229) (generator "test")
  (general (thickness 1.6))
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (5 "F.SilkS" user "F.Silkscreen")
    (31 "F.CrtYd" user "F.Courtyard") (29 "B.CrtYd" user "B.Courtyard") (25 "Edge.Cuts" user))
  (setup)
  (net 0 "")
  ${items.join('\n  ')}
)`);

/** The VIEW calls UpdateConflicts makes; the flags are what the test reads. */
const view = { Update: () => {}, MarkTargetDirty: () => {} } as unknown as VIEW;

/**
 * EDIT_TOOL::doMoveSelection: Init once, the moved footprints selected and in
 * m_FpInMove; each frame moves them, Runs and UpdateConflicts( view, true ).
 */
function drag(board: BOARD, moving: number[]) {
  const engine = new DRC_ENGINE(board, board.GetDesignSettings());
  engine.InitEngine(null);
  const drc = new DRC_INTERACTIVE_COURTYARD_CLEARANCE(engine);
  const fps = board.Footprints();
  drc.Init(board);
  for (const i of moving) {
    fps[i]!.SetSelected();
    drc.m_FpInMove.push(fps[i]!);
  }
  let at = { x: 0, y: 0 };

  return {
    drc,
    /** Move the dragged footprints to `dx` mm (absolute), run, and report the flagged items. */
    to(dx: number, dy = 0): { fps: number[]; zones: number } {
      const d = { x: MM(dx) - at.x, y: MM(dy) - at.y };
      at = { x: MM(dx), y: MM(dy) };
      for (const i of moving) fps[i]!.Move(d);
      drc.Run();
      drc.UpdateConflicts(view, true);
      const flagged = (it: BOARD_ITEM) => it.HasFlag(COURTYARD_CONFLICT);
      return {
        fps: fps.flatMap((f, i) => (flagged(f) ? [i] : [])),
        zones: board.Zones().filter(flagged).length,
      };
    },
  };
}

/** fp 0 static at 0..10 mm, fp 1 moving at 20..30 mm — 10 mm of clear air. */
const twoBoxes = (): BOARD =>
  pcb(fp('A', 0, crtyd(0, 0, 10, 10), hole(5, 5)), fp('B', 20, crtyd(0, 0, 10, 10), hole(5, 5)));

describe('DRC_INTERACTIVE_COURTYARD_CLEARANCE', () => {
  it('reports nothing until the courtyards actually touch', () => {
    const d = drag(twoBoxes(), [1]);
    expect(d.to(0).fps).toEqual([]);
    // 9 mm still leaves a millimetre between 10 and 11.
    expect(d.to(-9).fps).toEqual([]);
  });

  it('marks BOTH footprints, the moving one included', () => {
    // -12 mm puts B's box at 8..18, two millimetres into A's.
    expect(drag(twoBoxes(), [1]).to(-12).fps).toEqual([0, 1]);
    // ...and at the smallest overlap too: 0.5 mm.
    expect(drag(twoBoxes(), [1]).to(-10.5).fps).toEqual([0, 1]);
  });

  it('collides two back courtyards as it does two front ones', () => {
    const b = pcb(
      fp('A', 0, crtyd(0, 0, 10, 10, 'B.CrtYd')),
      fp('B', 20, crtyd(0, 0, 10, 10, 'B.CrtYd')),
    );
    expect(drag(b, [1]).to(-12).fps).toEqual([0, 1]);
  });

  it('with aHighlightMoved false, only the victim', () => {
    const d = drag(twoBoxes(), [1]);
    d.to(-12);
    d.drc.UpdateConflicts(view, false);
    const b = d.drc as unknown as { m_board: BOARD };
    expect(b.m_board.Footprints().map((f: FOOTPRINT) => f.HasFlag(COURTYARD_CONFLICT))).toEqual([
      true,
      false,
    ]);
  });

  it('clears again when the part is dragged back off, and on ClearConflicts', () => {
    const d = drag(twoBoxes(), [1]);
    expect(d.to(-12).fps).toEqual([0, 1]);
    expect(d.to(0).fps).toEqual([]);
    expect(d.to(-12).fps).toEqual([0, 1]);
    d.drc.ClearConflicts(view);
    const b = d.drc as unknown as { m_board: BOARD };
    expect(b.m_board.Footprints().some((f) => f.HasFlag(COURTYARD_CONFLICT))).toBe(false);
  });

  it('never lights up a footprint that draws no courtyard', () => {
    // "No courtyards defined and no hole testing against other footprint's
    // courtyards" — fpA is `continue`d before anything is tested.
    const b = pcb(fp('A', 0, hole(5, 5)), fp('B', 20, crtyd(0, 0, 10, 10)));
    expect(drag(b, [1]).to(-20).fps).toEqual([]);
  });

  it('fires on a pad hole of the moving part inside the static courtyard', () => {
    // B draws no courtyard at all: this is `testPadAgainstCourtyards` on B's pad.
    const b = pcb(fp('A', 0, crtyd(0, 0, 10, 10)), fp('B', 20, hole(5, 5)));
    const d = drag(b, [1]);
    expect(d.to(0).fps).toEqual([]);
    expect(d.to(-20).fps).toEqual([0, 1]);
  });

  it('fires the other way too — a static pad hole inside the moving courtyard', () => {
    // A's pad sits OUTSIDE A's own courtyard, and B stops 2 mm short of it, so
    // the only thing that can match is the second direction of the pad test.
    const b = pcb(fp('A', 0, crtyd(0, 0, 10, 10), hole(14, 5)), fp('B', 20, crtyd(0, 0, 10, 10)));
    expect(drag(b, [1]).to(-8).fps).toEqual([0, 1]);
  });

  it('only collides a side with its own side', () => {
    const b = pcb(fp('A', 0, crtyd(0, 0, 10, 10, 'B.CrtYd')), fp('B', 20, crtyd(0, 0, 10, 10)));
    expect(drag(b, [1]).to(-20).fps).toEqual([]);
  });

  it('fires on a rule area that disallows footprints, and shades the zone', () => {
    const moving = fp('B', 20, crtyd(0, 0, 10, 10));

    const hit = drag(pcb(moving, keepout(true)), [0]).to(-12);
    expect(hit.fps).toEqual([0]);
    expect(hit.zones).toBe(1);

    // A rule area that allows footprints (it only keeps tracks out) is not one
    // of these at all.
    expect(drag(pcb(moving, keepout(false)), [0]).to(-12).zones).toBe(0);
    // …nor is one whose layers are all on the other side.
    expect(drag(pcb(moving, keepout(true, 'B.Cu')), [0]).to(-12).zones).toBe(0);
  });

  it('the moved footprint’s courtyard moves with it', () => {
    // PCB_PAINTER fills `GetCourtyard()` on LAYER_CONFLICTS_SHADOW; during a
    // move the footprint has already moved, the static one has not.
    const b = twoBoxes();
    drag(b, [1]).to(-12);
    const xs = (f: FOOTPRINT) =>
      f
        .GetCourtyard(PCB_LAYER_ID.F_CrtYd)
        .Outline(0)
        .CPoints()
        .map((p) => p.x / MM(1));
    const [a, m] = b.Footprints();
    expect(Math.min(...xs(a!))).toBeCloseTo(0, 1);
    expect(Math.max(...xs(a!))).toBeCloseTo(10, 1);
    expect(Math.min(...xs(m!))).toBeCloseTo(8, 1);
    expect(Math.max(...xs(m!))).toBeCloseTo(18, 1);
  });
});
