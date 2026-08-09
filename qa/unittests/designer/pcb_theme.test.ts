// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PCB color themes (designer/src/editors/pcb/pcbTheme.ts): the two built-in
 * COLOR_SETTINGS palettes from common/settings/builtin_color_themes.h and the
 * synthetic black-and-white print palette.
 */
import { describe, it, expect } from 'vitest';
import {
  PCB_BW_PRINT_THEME,
  PCB_LAYER_COLORS,
  PCB_THEMES,
  themeByFilename,
} from '@ziroeda/designer/src/editors/pcb/pcbTheme.js';
import {
  brightenColor,
  colorBrightness,
  darkenColor,
  dimmedColor,
  emphasize,
  GAL_SCREEN_DPI,
  highlightedColor,
  selectedColor,
  showsNetName,
  type TrackNetLabel,
} from '@ziroeda/designer/src/editors/pcb/renderBoard.js';

describe('pcb color themes', () => {
  it('registers the two KiCad built-ins under their COLOR_SETTINGS filenames', () => {
    expect(PCB_THEMES.map((t) => t.filename)).toEqual(['_builtin_default', '_builtin_classic']);
    expect(PCB_THEMES.map((t) => t.name)).toEqual(['KiCad Default', 'KiCad Classic']);
    expect(themeByFilename('_builtin_classic').name).toBe('KiCad Classic');
    // Unknown filename falls back to the default theme.
    expect(themeByFilename('no_such_theme').filename).toBe('_builtin_default');
  });

  it('default theme is the existing s_defaultTheme palette', () => {
    const dflt = themeByFilename('_builtin_default');
    expect(dflt.layerColors).toBe(PCB_LAYER_COLORS);
    expect(dflt.background).toBe('rgb(0,16,35)');
  });

  it('classic theme matches s_classicTheme (legacy colorRefs are B,G,R)', () => {
    const classic = themeByFilename('_builtin_classic');
    expect(classic.background).toBe('rgb(0,0,0)'); // LAYER_PCB_BACKGROUND = BLACK
    expect(classic.layerColors['F.Cu']).toBe('rgb(132,0,0)'); // RED
    expect(classic.layerColors['B.Cu']).toBe('rgb(0,132,0)'); // GREEN
    expect(classic.layerColors['In1.Cu']).toBe('rgb(194,194,0)'); // YELLOW
    expect(classic.layerColors['In2.Cu']).toBe('rgb(194,0,194)'); // LIGHTMAGENTA
    expect(classic.layerColors['In30.Cu']).toBe('rgb(0,0,132)'); // BLUE
    expect(classic.layerColors['F.SilkS']).toBe('rgb(0,132,132)'); // CYAN
    expect(classic.layerColors['B.Mask']).toBe('rgb(132,132,0)'); // BROWN
    expect(classic.layerColors['Edge.Cuts']).toBe('rgb(194,194,0)'); // YELLOW
    expect(classic.layerColors['B.Paste']).toBe('rgb(0,194,194)'); // LIGHTCYAN
    expect(classic.layerColors['User.1']).toBe('rgb(0,0,132)'); // BLUE
    expect(classic.special.drawingSheet).toBe('rgb(72,0,0)'); // DARKRED
    expect(classic.special.viaHoleWall).toBe('rgb(255,255,255)'); // WHITE
    // Every layer the default theme names is covered by the classic theme.
    for (const name of Object.keys(PCB_LAYER_COLORS))
      expect(classic.layerColors[name], name).toBeDefined();
  });

  it('black-and-white print palette is all black on white', () => {
    expect(PCB_BW_PRINT_THEME.background).toBe('rgb(255,255,255)');
    const colors = new Set(Object.values(PCB_BW_PRINT_THEME.layerColors));
    expect([...colors]).toEqual(['rgb(0,0,0)']);
    // Hole interiors read as paper; walls print black.
    expect(PCB_BW_PRINT_THEME.special.viaHole).toBe('rgb(255,255,255)');
    expect(PCB_BW_PRINT_THEME.special.viaHoleWall).toBe('rgb(0,0,0)');
  });
});

describe('emphasis colors (RENDER_SETTINGS::update + PCB_PAINTER::GetColor)', () => {
  // COLOR4D::Brightened / Darkened, worked through by hand.
  it('brighten pushes toward white, darken scales toward black', () => {
    expect(brightenColor('rgb(100,200,50)', 0.5)).toBe('rgb(178,227,153)');
    expect(darkenColor('rgb(100,200,50)', 0.5)).toBe('rgb(50,100,25)');
    expect(brightenColor('rgba(100,200,50,0.4)', 0.5)).toBe('rgba(178,227,153,0.4)');
    // Alpha rides along untouched, and f = 0 is a no-op.
    expect(brightenColor('rgb(100,200,50)', 0)).toBe('rgb(100,200,50)');
  });

  it("GetBrightness is the weighted W3C formula with KiCad's .117 blue", () => {
    expect(colorBrightness('rgb(255,255,255)')).toBeCloseTo(1.003, 3); // KiCad's weights sum > 1
    expect(colorBrightness('rgb(0,0,0)')).toBe(0);
    expect(colorBrightness('rgb(255,0,0)')).toBeCloseTo(0.299, 3);
  });

  it('a selected item brightens by selectFactor/2 + brightness³, not a flat amount', () => {
    // F.Cu = rgb(200,52,52): brightness .378 -> factor .25 + .054 = .304.
    const fcu = 'rgb(200,52,52)';
    const b = colorBrightness(fcu);
    const factor = Math.min(1, 0.25 + b ** 3);
    expect(selectedColor(fcu)).toBe(brightenColor(fcu, factor));
    // Much closer to the base color than the flat Brightened(0.8) we used to do.
    expect(selectedColor(fcu)).not.toBe(brightenColor(fcu, 0.8));
  });

  it('leaves near-black colors and net-name text alone', () => {
    expect(selectedColor('rgb(5,5,5)')).toBe('rgb(5,5,5)'); // brightness < 0.05
    expect(selectedColor('rgb(200,52,52)', true)).toBe('rgb(200,52,52)'); // netname layer
  });

  it('falls back to darken-plus-blue for colors too bright to brighten', () => {
    // White cannot brighten, so KiCad darkens it and pushes the blue back up.
    const sel = selectedColor('rgb(255,255,255)');
    const rgb = /rgb\((\d+),(\d+),(\d+)\)/.exec(sel)!;
    expect(Number(rgb[1])).toBe(204); // 255 * (1 - 0.5*0.4)
    expect(Number(rgb[2])).toBe(204);
    expect(Number(rgb[3])).toBe(255); // blue restored: the "glow"
  });

  it('highlight brightens by 0.5 and everything else darkens by 0.5', () => {
    const fcu = 'rgb(200,52,52)';
    expect(highlightedColor(fcu)).toBe(brightenColor(fcu, 0.5));
    expect(dimmedColor(fcu)).toBe(darkenColor(fcu, 0.5));
    expect(dimmedColor(fcu)).toBe('rgb(100,26,26)');
  });

  it('emphasize dispatches to the right rule', () => {
    const c = 'rgb(200,52,52)';
    expect(emphasize(c, 'none')).toBe(c);
    expect(emphasize(c, 'selected')).toBe(selectedColor(c));
    expect(emphasize(c, 'highlighted')).toBe(highlightedColor(c));
    expect(emphasize(c, 'dimmed')).toBe(dimmedColor(c));
  });
});

describe('track net names (PCB_TRACK::ViewGetLOD + renderNetNameForSegment)', () => {
  const label = (over: Partial<TrackNetLabel> = {}): TrackNetLabel => ({
    start: { x: 0, y: 0 },
    end: { x: 100000, y: 0 }, // 10 mm at 1e4 IU/mm
    width: 2500, // 0.25 mm
    layer: 'F.Cu',
    text: 'GND',
    ...over,
  });
  const view = (scale: number) => ({ scale, tx: 0, ty: 0, flipX: false });

  it('hides the name until the track is ~14 px wide on screen (4 mm at GAL dpi)', () => {
    // 0.25 mm track: needs scale where width·scale >= 4mm·91/25.4 ≈ 14.3 px.
    // 91 is GAL's screen DPI (advanced_config.cpp m_ScreenDPI), the constant
    // every lodScaleForThreshold gate is defined against — not the browser's 96.
    const need = (4 * GAL_SCREEN_DPI) / 25.4 / 2500;
    expect(showsNetName(label(), view(need * 0.99))).toBe(false);
    expect(showsNetName(label(), view(need * 1.01))).toBe(true);
  });

  it('a wider track shows its name sooner', () => {
    const scale = ((4 * GAL_SCREEN_DPI) / 25.4 / 5000) * 1.001; // enough for a 0.5 mm track only
    expect(showsNetName(label({ width: 5000 }), view(scale))).toBe(true);
    expect(showsNetName(label({ width: 2500 }), view(scale))).toBe(false);
  });

  it('hides it on a track too short to hold the text', () => {
    // length must be >= width · chars = 2500 · 3 = 7500.
    const zoomedIn = view(1);
    expect(showsNetName(label({ end: { x: 7600, y: 0 } }), zoomedIn)).toBe(true);
    expect(showsNetName(label({ end: { x: 7400, y: 0 } }), zoomedIn)).toBe(false);
    // A longer name needs a longer track.
    expect(showsNetName(label({ end: { x: 7600, y: 0 }, text: 'VCC_3V3' }), zoomedIn)).toBe(false);
  });

  it('never shows one for a zero-width track', () => {
    expect(showsNetName(label({ width: 0 }), view(1000))).toBe(false);
  });
});
