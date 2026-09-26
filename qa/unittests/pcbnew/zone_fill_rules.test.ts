// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * A custom design rule reaching the zone fill.
 *
 * `ZONE_FILLER` asks `DRC_ENGINE::EvalRules` for the thermal relief gap
 * (`zone_filler.cpp:1901`), the spoke width (`:3396`) and, through
 * `EvalZoneConnection`, how a pad meets the pour (`:1886`). Everything the
 * rule language can say about those - a `(rule …)` in the project's
 * `.kicad_dru`, a netclass, a condition on a pad's number or its footprint's
 * reference - therefore changes the copper.
 *
 * None of it did here. The filler carried its own `thermalReliefGap`,
 * `thermalSpokeWidth` and `padZoneConnection`, each reading the pad's and the
 * zone's own fields and nothing else, so a `.kicad_dru` was invisible to the
 * pour however plainly it was written. The engine has been on the live BOARD
 * since the DRC port; this is the filler asking it.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { EMBEDDED_FILES } from '@ziroeda/common/embedded_files.js';
import { pcbMmToIU as MM } from '@ziroeda/common/eda_units.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_ids.js';
import { DRC_ENGINE } from '@ziroeda/pcbnew/drc/drc_engine.js';
import { DRC_CONSTRAINT_T } from '@ziroeda/pcbnew/drc/drc_rule.js';
import { ParseBoard } from '@ziroeda/pcbnew/read-board.js';
import { boardFromBOARD } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/board_view.js';
import { fillZone } from '@ziroeda/pcbnew/zone_filler.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';

/**
 * A 20 mm GND pour on F.Cu with one thermally-connected GND pad at its
 * centre, written as v10 s-expression so the parser builds the model.
 */
const BOARD_TEXT = `
(kicad_pcb (version 20241229) (generator "pcbnew") (generator_version "10.0")
  (general (thickness 1.6))
  (paper "A4")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (44 "Edge.Cuts" user))
  (setup (pad_to_mask_clearance 0))
  (footprint "R"
    (layer "F.Cu")
    (uuid "11111111-1111-1111-1111-111111111111")
    (at 10 10)
    (property "Reference" "R1" (at 0 0 0) (layer "F.Cu")
      (uuid "22222222-2222-2222-2222-222222222222") (effects (font (size 1 1) (thickness 0.15))))
    (pad "1" thru_hole circle (at 0 0) (size 3 3) (drill 1) (layers "*.Cu")
      (uuid "33333333-3333-3333-3333-333333333333") (net 1 "GND"))
    (pad "2" thru_hole circle (at 20 0) (size 3 3) (drill 1) (layers "*.Cu")
      (uuid "55555555-5555-5555-5555-555555555555") (net 1 "GND"))
  )
  (zone (net 1) (net_name "GND") (layers "F.Cu")
    (uuid "44444444-4444-4444-4444-444444444444")
    (hatch edge 0.5)
    (connect_pads (clearance 0.5))
    (min_thickness 0.25)
    (fill yes (thermal_gap 0.5) (thermal_bridge_width 0.5))
    (polygon (pts (xy 0 0) (xy 20 0) (xy 20 20) (xy 0 20)))
  )
  (zone (net 1) (net_name "GND") (layers "B.Cu")
    (uuid "66666666-6666-6666-6666-666666666666")
    (hatch edge 0.5)
    (connect_pads (clearance 0.5))
    (min_thickness 0.25)
    (fill yes (thermal_gap 0.5) (thermal_bridge_width 0.5))
    (polygon (pts (xy 20 0) (xy 40 0) (xy 40 20) (xy 20 20)))
  )
)`;

/** The pour, with `aRules` loaded into the board's engine first. */
function fillWithRules(aRules: string | null, aZoneIndex = 0): { area: number; board: BOARD } {
  const board = ParseBoard(BOARD_TEXT, 'rules.kicad_pcb');

  board.BuildListOfNets();
  board.BuildConnectivity();

  const engine = new DRC_ENGINE(board, board.GetDesignSettings());

  engine.InitEngine(aRules, aRules === null ? '' : 'rules.kicad_dru');
  board.GetDesignSettings().m_DRCEngine = engine;

  const fills = fillZone(boardFromBOARD(board), aZoneIndex);
  const polys = fills[0]?.polys ?? [];
  let total = 0;

  for (const ring of polys) {
    let a = 0;

    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
      a += (ring[j]!.x + ring[i]!.x) * (ring[j]!.y - ring[i]!.y);

    total += a / 2;
  }

  return { area: Math.abs(total) / (MM(1) * MM(1)), board };
}

describe('a .kicad_dru rule reaches the pour', () => {
  beforeAll(async () => {
    await EMBEDDED_FILES.InitCodec();
  });

  it('the board on its own resolves the zone’s own settings', () => {
    // A sanity floor: the 20 x 20 pour, less the relief around one pad.
    const { board } = fillWithRules(null);
    const zone = board.Zones()[0]!;
    const pad = board.Footprints()[0]!.Pads()[0]!;
    const engine = board.GetDesignSettings().m_DRCEngine!;

    expect(
      engine
        .EvalRules(DRC_CONSTRAINT_T.THERMAL_RELIEF_GAP_CONSTRAINT, pad, zone, PCB_LAYER_ID.F_Cu)
        .GetValue()
        .Min(),
    ).toBe(MM(0.5));
  });

  it('a thermal_relief_gap rule opens a wider relief, and the copper shrinks', () => {
    const plain = fillWithRules(null).area;
    const ruled = fillWithRules(`(version 1)
(rule "wide relief"
  (condition "A.Type == 'Pad'")
  (constraint thermal_relief_gap (min 1.5mm)))`).area;

    // A 3 mm circular pad at a 0.5 mm gap knocks out a 4 mm disc; at 1.5 mm,
    // a 6 mm one. The spokes narrow the difference but cannot reverse it.
    expect(ruled).toBeLessThan(plain);
    expect(plain - ruled).toBeGreaterThan(5);
  });

  it('a zone_connection rule of "solid" removes the relief altogether', () => {
    const plain = fillWithRules(null).area;
    const solid = fillWithRules(`(version 1)
(rule "solid pads"
  (condition "A.Type == 'Pad'")
  (constraint zone_connection solid))`).area;

    // Nothing knocked out at all: the pour is the whole 20 x 20 outline, less
    // only the half of `min_thickness` its own border loses on each side -
    // 400 mm2 less about 80 x 0.125.
    expect(solid).toBeGreaterThan(plain);
    expect(solid).toBeGreaterThan(390);
    expect(solid).toBeLessThan(400);
  });

  it('a zone_connection rule of "none" knocks the pad out with no spokes', () => {
    const plain = fillWithRules(null).area;
    const none = fillWithRules(`(version 1)
(rule "isolated pads"
  (condition "A.Type == 'Pad'")
  (constraint zone_connection none))`).area;

    // NONE keeps the clearance hole and adds no spokes back, so it takes more
    // copper than a thermal relief does.
    expect(none).toBeLessThan(plain);
  });

  it('the spoke width is the constraint\u2019s Opt, not its Min', () => {
    // `buildThermalSpokes` reads `Opt()` (zone_filler.cpp:3397-3400) where the
    // relief gap reads `Min()`. A rule that states both, far apart, is the
    // only thing that can tell which one the fill used: at 1.5 mm the four
    // spokes bridge the relief with three times the copper they do at 0.3.
    const narrow = fillWithRules(`(version 1)
(rule "spokes"
  (condition "A.Type == 'Pad'")
  (constraint thermal_spoke_width (min 0.3mm) (opt 0.3mm)))`).area;
    const wide = fillWithRules(`(version 1)
(rule "spokes"
  (condition "A.Type == 'Pad'")
  (constraint thermal_spoke_width (min 0.3mm) (opt 1.5mm)))`).area;

    expect(wide).toBeGreaterThan(narrow);
  });

  it('the relief gap is the constraint\u2019s Min, not its Opt', () => {
    // The mirror of the spoke-width case, and the opposite accessor
    // (zone_filler.cpp:1901-1903). A rule whose Min and Opt disagree is the
    // only thing that can tell them apart.
    const byMin = fillWithRules(`(version 1)
(rule "relief"
  (condition "A.Type == 'Pad'")
  (constraint thermal_relief_gap (min 1.5mm) (opt 0.3mm)))`).area;
    const bothWide = fillWithRules(`(version 1)
(rule "relief"
  (condition "A.Type == 'Pad'")
  (constraint thermal_relief_gap (min 1.5mm) (opt 1.5mm)))`).area;

    expect(byMin).toBe(bothWide);
  });

  it('a rule scoped to another layer leaves this one alone', () => {
    // The layer reaches `EvalRules` as its third argument, and a rule with a
    // `(layer …)` is skipped on any other. Without that argument the pour
    // would take B.Cu's rules on F.Cu.
    const plain = fillWithRules(null).area;
    const elsewhere = fillWithRules(`(version 1)
(rule "wide relief on the back"
  (layer "B.Cu")
  (condition "A.Type == 'Pad'")
  (constraint thermal_relief_gap (min 1.5mm)))`).area;
    const here = fillWithRules(`(version 1)
(rule "wide relief on the front"
  (layer "F.Cu")
  (condition "A.Type == 'Pad'")
  (constraint thermal_relief_gap (min 1.5mm)))`).area;

    expect(elsewhere).toBe(plain);
    expect(here).toBeLessThan(plain);

    // ...and the same from the other side, on the board's B.Cu pour: it takes
    // the B.Cu rule and not the F.Cu one. Without the layer reaching
    // `EvalRules` both pours would answer for F.Cu.
    const backPlain = fillWithRules(null, 1).area;
    const backRuled = fillWithRules(
      `(version 1)
(rule "wide relief on the back"
  (layer "B.Cu")
  (condition "A.Type == 'Pad'")
  (constraint thermal_relief_gap (min 1.5mm)))`,
      1,
    ).area;
    const backFront = fillWithRules(
      `(version 1)
(rule "wide relief on the front"
  (layer "F.Cu")
  (condition "A.Type == 'Pad'")
  (constraint thermal_relief_gap (min 1.5mm)))`,
      1,
    ).area;

    expect(backRuled).toBeLessThan(backPlain);
    expect(backFront).toBe(backPlain);
  });

  it('a board with no engine at all gets one, and pours', () => {
    // `Fill`'s own bootstrap (zone_filler.cpp:421-455): "headless consumers …
    // can reach here with none, which would crash on the first EvalRules()
    // call". Ours builds one on the implicit constraints.
    const board = ParseBoard(BOARD_TEXT, 'rules.kicad_pcb');

    board.BuildListOfNets();
    board.BuildConnectivity();
    expect(board.GetDesignSettings().m_DRCEngine).toBeNull();

    const fills = fillZone(boardFromBOARD(board), 0);

    expect(board.GetDesignSettings().m_DRCEngine).not.toBeNull();
    expect(fills[0]!.polys.length).toBeGreaterThan(0);
  });

  it('a rule that names the wrong item changes nothing', () => {
    // The same constraint conditioned on a via - there is none - must leave
    // the pour exactly as it was. Without this, any rule "working" would be
    // indistinguishable from the engine simply returning something different.
    const plain = fillWithRules(null).area;
    const other = fillWithRules(`(version 1)
(rule "wide relief on vias only"
  (condition "A.Type == 'Via'")
  (constraint thermal_relief_gap (min 1.5mm)))`).area;

    expect(other).toBe(plain);
  });
});
