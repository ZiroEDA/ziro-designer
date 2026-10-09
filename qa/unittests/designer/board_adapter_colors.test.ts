// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `BOARD_ADAPTER::GetLayerColors()`'s `m_UseStackupColors` block
 * (`3d-viewer/3d_canvas/board_adapter.cpp:654-745`) — the Physical Stackup
 * page's Color column becoming the 3D view's materials.
 *
 * The five colour tables are DATA transcribed from the constructor's
 * `ADD_COLOR` calls (`:164-207`); the names are the strings the `.kicad_pcb`
 * stores, so a wrong name is a silently wrong colour rather than an error.
 * Spot-checked here against those lines rather than against our own output.
 */
import { describe, expect, it } from 'vitest';
import {
  BOARD_COLORS,
  DEFAULT_SILKSCREEN,
  DEFAULT_SOLDERMASK,
  FINISH_COLORS,
  MASK_COLORS,
  SILK_COLORS,
  findColor,
  mix,
  stackupColors,
} from '@ziroeda/3d-viewer/board_adapter_colors.js';
import type { BOARD_STACKUP } from '@ziroeda/pcbnew/board_stackup_manager/board_stackup.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';

const ch = (v: number): number => v / 255;

describe('the colour tables are KiCad’s', () => {
  it('has g_SilkColors’ values', () => {
    // ADD_COLOR( g_SilkColors, 20, 51, 36, 1.0, "Green" )
    expect(SILK_COLORS.Green).toEqual({ r: ch(20), g: ch(51), b: ch(36), a: 1.0 });
    // "Not specified" is WHITE in the silk list…
    expect(SILK_COLORS['Not specified']).toEqual(SILK_COLORS.White);
  });

  it('has g_MaskColors’ values, and its different "Not specified"', () => {
    // …and GREEN in the mask list. Getting these two the same way round is the
    // kind of thing only a per-table check catches.
    expect(MASK_COLORS['Not specified']).toEqual(MASK_COLORS.Green);
    expect(MASK_COLORS['Not specified']).not.toEqual(SILK_COLORS['Not specified']);
    // Every mask entry carries alpha 0.83.
    for (const [name, c] of Object.entries(MASK_COLORS)) expect(c.a, name).toBe(0.83);
    // Every silk entry is opaque.
    for (const [name, c] of Object.entries(SILK_COLORS)) expect(c.a, name).toBe(1.0);
  });

  it('has g_BoardColors’ per-entry alpha', () => {
    // ADD_COLOR( g_BoardColors, 109, 116, 75, 0.83, "FR4 natural" )
    expect(BOARD_COLORS['FR4 natural']).toEqual({ r: ch(109), g: ch(116), b: ch(75), a: 0.83 });
    expect(BOARD_COLORS.Polyimide?.a).toBe(0.68);
    expect(BOARD_COLORS['PTFE natural']?.a).toBe(0.9);
    expect(BOARD_COLORS.Aluminum?.a).toBe(1.0);
  });
});

describe('findColor', () => {
  it('takes a #RRGGBB name as a literal colour', () => {
    // `if( aColorName.StartsWith( "#" ) ) return KIGFX::COLOR4D( aColorName );`
    const c = findColor('#ff0000', MASK_COLORS);
    expect(c.r).toBeCloseTo(1, 6);
    expect(c.g).toBeCloseTo(0, 6);
  });

  it('returns a default-constructed COLOR4D on a miss: OPAQUE black', () => {
    // `COLOR4D() : r( 0 ), g( 0 ), b( 0 ), a( 1.0 )` (include/gal/color4d.h:108-114),
    // whatever its comment says - and the board body test below is what shows it.
    expect(findColor('No Such Colour', MASK_COLORS)).toEqual({ r: 0, g: 0, b: 0, a: 1 });
  });
});

describe('mix', () => {
  it('keeps the receiver’s alpha, not the argument’s', () => {
    // `COLOR4D::Mix` returns `a` — this colour's — which is what makes the
    // dielectric accumulation converge instead of drifting.
    const a = { r: 1, g: 0, b: 0, a: 0.25 };
    const b = { r: 0, g: 1, b: 0, a: 0.9 };
    expect(mix(a, b, 0.5)).toEqual({ r: 0.5, g: 0.5, b: 0, a: 0.25 });
  });
});

describe('stackupColors', () => {
  /**
   * A two-layer board's BOARD_STACKUP as the file gives it: every row with no
   * `(color ...)` keeps BOARD_STACKUP_ITEM's "Not specified", and `colors`
   * names a row's colour by its layer.
   */
  const stackup = (
    colors: Record<string, string> = {},
    finish = 'None',
    rows: string[] = ['F.SilkS', 'F.Mask', 'F.Cu', 'dielectric 1', 'B.Cu', 'B.Mask', 'B.SilkS'],
  ): BOARD_STACKUP => {
    const ROW: Record<string, string> = {
      'F.SilkS': '(type "Top Silk Screen")',
      'F.Mask': '(type "Top Solder Mask") (thickness 0.01)',
      'F.Cu': '(type "copper") (thickness 0.035)',
      'dielectric 1': '(type "core") (thickness 1.51) (material "FR4")',
      'B.Cu': '(type "copper") (thickness 0.035)',
      'B.Mask': '(type "Bottom Solder Mask") (thickness 0.01)',
      'B.SilkS': '(type "Bottom Silk Screen")',
    };
    const layer = (n: string): string =>
      `(layer "${n}" ${ROW[n]}${colors[n] ? ` (color "${colors[n]}")` : ''})`;
    return ParseBoard(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (1 "F.Mask" user) (3 "B.Mask" user)
          (5 "F.SilkS" user "F.Silkscreen") (7 "B.SilkS" user "B.Silkscreen"))
  (setup (stackup ${rows.map(layer).join(' ')} (copper_finish "${finish}") (dielectric_constraints no)))
  (net 0 ""))`)
      .GetDesignSettings()
      .GetStackupDescriptor();
  };

  it('resolves "Not specified" THROUGH the tables, not to the g_Default*', () => {
    // `NotSpecifiedPrm()` is the NAME of the first entry of g_SilkColors and
    // g_MaskColors (`board_adapter.cpp:164`, `:173`), so `findColor` HITS on it
    // and the stackup override applies: White for silk, Green for mask.
    const c = stackupColors(stackup());
    expect(c.silkTop).toEqual(SILK_COLORS['Not specified']);
    expect(c.maskTop).toEqual(MASK_COLORS['Not specified']);
    expect(c.silkTop).not.toEqual(DEFAULT_SILKSCREEN);
    expect(c.maskTop).not.toEqual(DEFAULT_SOLDERMASK);
  });

  it('keeps the g_Default* seed only where the stackup has no such layer', () => {
    const c = stackupColors(stackup({}, 'None', ['F.Mask', 'F.Cu', 'dielectric 1', 'B.Cu']));
    expect(c.silkTop).toEqual(DEFAULT_SILKSCREEN);
    expect(c.maskTop).toEqual(MASK_COLORS['Not specified']);
  });

  it("takes the silkscreen and mask colours per side, by the item's board layer", () => {
    const c = stackupColors(
      stackup({ 'F.SilkS': 'Black', 'B.SilkS': 'Yellow', 'F.Mask': 'Red', 'B.Mask': 'Blue' }),
    );
    expect(c.silkTop).toEqual(SILK_COLORS.Black);
    expect(c.silkBottom).toEqual(SILK_COLORS.Yellow);
    expect(c.maskTop).toEqual(MASK_COLORS.Red);
    expect(c.maskBottom).toEqual(MASK_COLORS.Blue);
    expect(MASK_COLORS.Red).not.toEqual(SILK_COLORS.Red);
  });

  it("takes the body colour from a single dielectric's own colour", () => {
    // With one dielectric, `bodyColor` is that layer's colour, and its alpha
    // grows by ( 1 - a ) * a / 2.
    const c = stackupColors(stackup({ 'dielectric 1': 'Polyimide' }));
    const base = BOARD_COLORS.Polyimide!;
    expect(c.body?.r).toBeCloseTo(base.r, 6);
    expect(c.body?.g).toBeCloseTo(base.g, 6);
    expect(c.body?.a).toBeCloseTo(base.a + (1 - base.a) * (base.a / 2), 6);
  });

  it('makes the body opaque black when the dielectric is "Not specified", as KiCad renders it', () => {
    // "Not specified" is not in g_BoardColors, so findColor returns COLOR4D():
    // opaque black, which is not COLOR4D( 0, 0, 0, 0 ), so it IS assigned.
    // `kicad-cli pcb render --use-board-stackup-colors` (10.0.6) draws this
    // board's edge at (15,13,10), and at (89,95,61) with "FR4 natural".
    expect(stackupColors(stackup()).body).toEqual({ r: 0, g: 0, b: 0, a: 1 });
  });

  it("picks the copper colour from the finish name's suffix", () => {
    // `:722-744`, in order.
    const copper = (f: string) => stackupColors(stackup({}, f)).copper;
    expect(copper('OSP')).toEqual(FINISH_COLORS.Copper);
    expect(copper('ENIG')).toEqual(FINISH_COLORS.Gold);
    expect(copper('Hard gold')).toEqual(FINISH_COLORS.Gold);
    expect(copper('HAL SnPb')).toEqual(FINISH_COLORS.Tin);
    expect(copper('HASL')).toEqual(FINISH_COLORS.Tin);
    expect(copper('Immersion tin')).toEqual(FINISH_COLORS.Tin);
    expect(copper('Immersion silver')).toEqual(FINISH_COLORS.Silver);
  });

  it('leaves copper unset for a finish it does not recognise', () => {
    expect(stackupColors(stackup()).copper).toBeUndefined();
  });
});
