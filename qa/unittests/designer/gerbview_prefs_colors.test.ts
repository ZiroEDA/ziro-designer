// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Gerber Viewer > Colors — `PANEL_GERBVIEW_COLOR_SETTINGS`.
 *
 * The page is a swatch per layer, so what is worth pinning is the LIST: which
 * layers get one, in what order, under what name, and starting at what colour.
 * `createSwatches` is a switch over `m_validLayers`, and the two are easy to
 * conflate — the switch's case order is not the loop's order, and reading the
 * list off the switch moves one row.
 *
 * The markup itself is not asserted here: the panel is `.tsx` and `qa`'s
 * tsconfig sets no `--jsx`, which is why the table lives in
 * `gerbviewColorLayers.ts` and this reads it as data.
 */
import { describe, it, expect } from 'vitest';
import {
  GERBER_DRAWLAYERS_COUNT,
  GERBVIEW_FIXED_LAYERS,
  gerbviewColor,
  graphicLayerDefault,
  graphicLayerKey,
  graphicLayerName,
  graphicLayerRow,
} from '@ziroeda/designer/src/editors/gerbview/gerbviewColorLayers.js';
import {
  defaultLayerColor,
  GERBER_BG_COLOR,
  GERBER_DEFAULT_THEME_LAYERS,
  GERBER_GRID_COLOR,
} from '@ziroeda/designer/src/editors/gerbview/gerberColors.js';

describe('m_validLayers, and the names createSwatches gives them', () => {
  /**
   * `GERBER_DRAWLAYERS_COUNT` is `PCB_LAYER_ID_COUNT`, 128
   * (`include/layer_ids.h:519`, `:171`) — not the 64 that `s_defaultTheme`
   * happens to carry colours for. Upstream really does draw 128 graphic-layer
   * swatches; the tail are UNSPECIFIED and show as the bare checkerboard.
   */
  it('draws 128 graphic layers, not the 64 that have a default colour', () => {
    expect(GERBER_DRAWLAYERS_COUNT).toBe(128);
    expect(GERBER_DEFAULT_THEME_LAYERS).toBe(64);
    expect(graphicLayerDefault(63)).toBe(defaultLayerColor(63));
    expect(graphicLayerDefault(64)).toBeNull();
    expect(graphicLayerDefault(127)).toBeNull();
  });

  /** `_( "Graphic Layer %d" )` with `layer + 1 - GERBVIEW_LAYER_ID_START`. */
  it('numbers the graphic layers from 1', () => {
    expect(graphicLayerName(0)).toBe('Graphic Layer 1');
    expect(graphicLayerName(127)).toBe('Graphic Layer 128');
  });

  /**
   * The seven in **layer-id order** (`layer_ids.h:529-535`), which is the order
   * `m_validLayers`' second loop appends them — NOT the order
   * `createSwatches`' switch lists its cases, which puts Background last. The
   * switch is a lookup; the loop is the sequence.
   */
  it('lists the seven fixed layers in layer-id order, Background fifth', () => {
    expect(GERBVIEW_FIXED_LAYERS.map((l) => l.id)).toEqual([
      'LAYER_DCODES',
      'LAYER_NEGATIVE_OBJECTS',
      'LAYER_GERBVIEW_GRID',
      'LAYER_GERBVIEW_AXES',
      'LAYER_GERBVIEW_BACKGROUND',
      'LAYER_GERBVIEW_DRAWINGSHEET',
      'LAYER_GERBVIEW_PAGE_LIMITS',
    ]);
  });

  /** `createSwatches`' own strings (`panel_gerbview_color_settings.cpp:90-96`). */
  it('names them as createSwatches does', () => {
    expect(GERBVIEW_FIXED_LAYERS.map((l) => l.name)).toEqual([
      'DCodes',
      'Negative Objects',
      'Grid',
      'Axes',
      'Background',
      'Drawing Sheet',
      'Page Limits',
    ]);
  });

  /**
   * Each row starts at the colour `s_defaultTheme` gives that layer, which is
   * the constant the painter already used. A row whose fallback did not match
   * would open showing a colour the canvas is not drawing in.
   */
  it('starts each one at the theme colour the painter already draws', () => {
    const by = (id: string) => GERBVIEW_FIXED_LAYERS.find((l) => l.id === id);
    expect(by('LAYER_GERBVIEW_GRID')?.fallback).toBe(GERBER_GRID_COLOR);
    expect(by('LAYER_GERBVIEW_BACKGROUND')?.fallback).toBe(GERBER_BG_COLOR);
    for (const l of GERBVIEW_FIXED_LAYERS) expect(l.fallback, l.id).toMatch(/^rgb\(/);
  });
});

describe('the store is namespaced, because one file holds every app’s colours', () => {
  /**
   * `m_colorNamespace = "gerbview"` (`panel_gerbview_color_settings.cpp:33`).
   * Upstream a COLOR_SETTINGS file keeps each app's colours under its own
   * section; ours is one flat map with the namespace in the key. Without it a
   * gerbview `Grid` and the schematic's would be the same entry.
   */
  it('prefixes every key with the app’s namespace', () => {
    for (const l of GERBVIEW_FIXED_LAYERS) expect(l.key.startsWith('gerbview.'), l.key).toBe(true);
    expect(graphicLayerKey(0)).toBe('gerbview.layer0');
    expect(graphicLayerKey(127)).toBe('gerbview.layer127');
    // Distinct per row, or two rows would share a swatch.
    const keys = [
      ...GERBVIEW_FIXED_LAYERS.map((l) => l.key),
      ...Array.from({ length: GERBER_DRAWLAYERS_COUNT }, (_, i) => graphicLayerKey(i)),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });

  /** `GERBER_DRAW_LAYER_INDEX( x )` (`layer_ids.h:544`), which the manager needs. */
  it('reads a graphic row back out of a key, and only a graphic row', () => {
    expect(graphicLayerRow('gerbview.layer7')).toBe(7);
    expect(graphicLayerRow(graphicLayerKey(63))).toBe(63);
    // The seven fixed layers are not graphic rows, and neither is the
    // schematic's half of the same file.
    expect(graphicLayerRow('gerbview.grid')).toBeNull();
    expect(graphicLayerRow('wire')).toBeNull();
    // Out of range: 128 layers, so 128 is one past the end.
    expect(graphicLayerRow('gerbview.layer128')).toBeNull();
  });

  it('an override wins over the theme colour, and only for its own key', () => {
    const overrides = { 'gerbview.grid': 'rgb(1, 2, 3)' };
    expect(gerbviewColor('gerbview.grid', GERBER_GRID_COLOR, overrides)).toBe('rgb(1, 2, 3)');
    expect(gerbviewColor('gerbview.axes', GERBER_BG_COLOR, overrides)).toBe(GERBER_BG_COLOR);
    expect(gerbviewColor('gerbview.grid', GERBER_GRID_COLOR, {})).toBe(GERBER_GRID_COLOR);
  });
});
