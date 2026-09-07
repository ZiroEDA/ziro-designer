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
} from '@ziroeda/designer/src/editors/pcb/board_adapter_colors.js';
import {
  defaultBoardFinish,
  defaultPhysicalStackup,
  type PhysicalStackup,
} from '@ziroeda/designer/src/editors/pcb/board_settings.js';

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

  it('returns the unspecified colour on a miss, not a table default', () => {
    // A default-constructed COLOR4D is transparent black, and the caller tests
    // against exactly that.
    expect(findColor('No Such Colour', MASK_COLORS)).toEqual({ r: 0, g: 0, b: 0, a: 0 });
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
  const withColors = (patch: Record<string, string>): PhysicalStackup => {
    const s = defaultPhysicalStackup();
    s.layers = s.layers.map((l) => (patch[l.name] ? { ...l, color: patch[l.name] as string } : l));
    return s;
  };

  it('resolves "Not specified" THROUGH the tables, not to the g_Default*', () => {
    // A tempting wrong reading. `NotSpecifiedPrm()` is the NAME of the first
    // entry of g_SilkColors and g_MaskColors (`board_adapter.cpp:164`, `:173`),
    // so `findColor` HITS on it and the stackup override applies: White for
    // silk, Green for mask. The `g_Default*` values are the option-off path —
    // no stackup at all — which is `pcb3d.ts`'s fallback, not this function's.
    const c = stackupColors(defaultPhysicalStackup(), undefined);
    expect(c.silkTop).toEqual(SILK_COLORS['Not specified']);
    expect(c.maskTop).toEqual(MASK_COLORS['Not specified']);
    expect(c.silkTop).not.toEqual(DEFAULT_SILKSCREEN);
    expect(c.maskTop).not.toEqual(DEFAULT_SOLDERMASK);
  });

  it('keeps the g_Default* seed only where the stackup has no such layer', () => {
    // The loop overrides; a stackup with no silkscreen row leaves the seed.
    const s = defaultPhysicalStackup();
    s.layers = s.layers.filter((l) => !l.type.includes('Silk Screen'));
    const c = stackupColors(s, undefined);
    expect(c.silkTop).toEqual(DEFAULT_SILKSCREEN);
    expect(c.maskTop).toEqual(MASK_COLORS['Not specified']);
  });

  it('takes the silkscreen and mask colours per side', () => {
    const c = stackupColors(
      withColors({
        'F.Silkscreen': 'Black',
        'B.Silkscreen': 'Yellow',
        'F.Mask': 'Red',
        'B.Mask': 'Blue',
      }),
      undefined,
    );
    expect(c.silkTop).toEqual(SILK_COLORS.Black);
    expect(c.silkBottom).toEqual(SILK_COLORS.Yellow);
    expect(c.maskTop).toEqual(MASK_COLORS.Red);
    expect(c.maskBottom).toEqual(MASK_COLORS.Blue);
    // and the two tables are genuinely different for a shared name.
    expect(MASK_COLORS.Red).not.toEqual(SILK_COLORS.Red);
  });

  it('takes the body colour from a single dielectric’s own colour', () => {
    // With one dielectric, `bodyColor` is that layer's colour, and its alpha
    // grows by ( 1 - a ) * a / 2.
    const c = stackupColors(withColors({ 'Dielectric 1': 'Polyimide' }), undefined);
    const base = BOARD_COLORS.Polyimide!;
    expect(c.body?.r).toBeCloseTo(base.r, 6);
    expect(c.body?.g).toBeCloseTo(base.g, 6);
    expect(c.body?.a).toBeCloseTo(base.a + (1 - base.a) * (base.a / 2), 6);
  });

  it('leaves the body unset when no dielectric names a colour', () => {
    // `if( bodyColor != COLOR4D( 0, 0, 0, 0 ) )` — "Not specified" is not in
    // g_BoardColors, so findColor misses and the body is never assigned.
    expect(stackupColors(defaultPhysicalStackup(), undefined).body).toBeUndefined();
  });

  it('picks the copper colour from the finish name’s suffix', () => {
    // `:722-744`, in order.
    const s = defaultPhysicalStackup();
    const finish = (copperFinish: string) => ({ ...defaultBoardFinish(), copperFinish });

    expect(stackupColors(s, finish('OSP')).copper).toEqual(FINISH_COLORS.Copper);
    expect(stackupColors(s, finish('ENIG')).copper).toEqual(FINISH_COLORS.Gold);
    expect(stackupColors(s, finish('Hard gold')).copper).toEqual(FINISH_COLORS.Gold);
    expect(stackupColors(s, finish('HAL SnPb')).copper).toEqual(FINISH_COLORS.Tin);
    expect(stackupColors(s, finish('HASL')).copper).toEqual(FINISH_COLORS.Tin);
    expect(stackupColors(s, finish('Immersion tin')).copper).toEqual(FINISH_COLORS.Tin);
    expect(stackupColors(s, finish('Immersion silver')).copper).toEqual(FINISH_COLORS.Silver);
  });

  it('leaves copper unset for a finish it does not recognise', () => {
    expect(stackupColors(defaultPhysicalStackup(), undefined).copper).toBeUndefined();
  });
});
