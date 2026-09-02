// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Gerber Viewer > Display Options, and the store behind it.
 *
 * The page is only worth anything if the values it edits are the ones the frame
 * reads, so the assertions here are about the ROUND TRIP rather than about the
 * markup: `gerbview.json`'s defaults against `GERBVIEW_SETTINGS`' own `PARAM`
 * list, the toolbar-toggle projection in both directions, and the two page
 * tables the panel draws from.
 *
 * Deliberately not a render test. The panel is `.tsx` and `qa`'s tsconfig sets
 * no `--jsx`, which is why `display_options.ts` and `toggles.ts` hold the data
 * and the logic — see the header on `dialogs/prefs/gal_options.ts` for the same
 * split and the same reason.
 */
import { describe, it, expect } from 'vitest';
import { GERBVIEW_DEFAULTS } from '@ziroeda/designer/src/prefs/settings.js';
import {
  GBR_PAGE_SIZE_CHOICES,
  OPACITY_RANGE,
} from '@ziroeda/designer/src/editors/gerbview/prefs/display_options.js';
import {
  applyToggle,
  applyTogglesToSettings,
  DEFAULT_TOGGLES,
  LOCAL_TOGGLES,
  STORED_TOGGLES,
  sameToggles,
  togglesFromSettings,
} from '@ziroeda/designer/src/editors/gerbview/toggles.js';
import { PAPER_MM } from '@ziroeda/common';

const cfg = (): typeof GERBVIEW_DEFAULTS => structuredClone(GERBVIEW_DEFAULTS);

describe('gerbview.json against GERBVIEW_SETTINGS’ own PARAM list', () => {
  /**
   * `gerbview/gerbview_settings.cpp:43-61`. Every default here is the third
   * argument of the matching `PARAM<…>`, read off the C++ and not off our
   * object.
   */
  it('has the appearance defaults the constructor registers', () => {
    expect(GERBVIEW_DEFAULTS.appearance.show_border_and_titleblock).toBe(false);
    expect(GERBVIEW_DEFAULTS.appearance.show_dcodes).toBe(false);
    expect(GERBVIEW_DEFAULTS.appearance.show_negative_objects).toBe(false);
    expect(GERBVIEW_DEFAULTS.appearance.page_type).toBe('GERBER');
    expect(GERBVIEW_DEFAULTS.appearance.show_page_limit).toBe(false);
    expect(GERBVIEW_DEFAULTS.appearance.mode_opacity_value).toBe(0.6);
  });

  /**
   * `GBR_DISPLAY_OPTIONS`' constructor (`gerbview/gbr_display_options.h:57-68`).
   * The three FILL flags are true, which is what makes the three Sketch
   * checkboxes on the page open CLEARED — the panel inverts them
   * (`panel_gerbview_display_options.cpp:41-46`).
   */
  it('has GBR_DISPLAY_OPTIONS’ constructor defaults, fills on', () => {
    expect(GERBVIEW_DEFAULTS.display.flashed_items_fill).toBe(true);
    expect(GERBVIEW_DEFAULTS.display.lines_fill).toBe(true);
    expect(GERBVIEW_DEFAULTS.display.polygons_fill).toBe(true);
    expect(GERBVIEW_DEFAULTS.display.force_opacity_mode).toBe(false);
    expect(GERBVIEW_DEFAULTS.display.xor_mode).toBe(false);
    expect(GERBVIEW_DEFAULTS.display.high_contrast_mode).toBe(false);
    expect(GERBVIEW_DEFAULTS.display.flip_gerber_view).toBe(false);
  });

  /**
   * `EXCELLON_DEFAULTS::ResetToDefaults` (`gerbview/excellon_defaults.h:51-58`)
   * with `FMT_*` from `:26-30`: inches, LZ, 3:3 in mm and 2:4 in inches.
   */
  it('has EXCELLON_DEFAULTS’ own reset values', () => {
    expect(GERBVIEW_DEFAULTS.excellon_defaults).toEqual({
      unit_mm: false,
      lz_format: true,
      mm_integer_len: 3,
      mm_mantissa_len: 3,
      inch_integer_len: 2,
      inch_mantissa_len: 4,
    });
  });

  /**
   * `app_settings.cpp:228-238` puts pl_editor, eeschema and the symbol editor
   * on the imperial side and everything else — gerbview included — on mm.
   */
  it('opens in millimetres, and on grid index 15', () => {
    expect(GERBVIEW_DEFAULTS.system.units).toBe('mm');
    expect(GERBVIEW_DEFAULTS.window.grid.last_size_idx).toBe(15);
    // `fast_grid_2 = defaultGridIdx + 1` (`app_settings.cpp:486-487`).
    expect(GERBVIEW_DEFAULTS.window.grid.fast_grid_2).toBe(
      GERBVIEW_DEFAULTS.window.grid.fast_grid_1 + 1,
    );
  });

  /**
   * `PANEL_GRID_SETTINGS`' constructor hides the overrides heading, its rule
   * and every row for `FRAME_GERBER` (`panel_grid_settings.cpp:62-90`), so
   * gerbview has no override to store. An entry here would be a control we do
   * not draw.
   */
  it('stores no grid override, because gerbview shows none', () => {
    expect(Object.keys(GERBVIEW_DEFAULTS.window.grid.overrides)).toEqual([]);
  });
});

describe('the Page Size radios', () => {
  /**
   * Labels from `panel_gerbview_display_options_base.cpp:109-133`, values from
   * `panel_gerbview_display_options.cpp:91-97` — where "Full size" is the
   * `else` arm and stores `"GERBER"`, not anything spelled like its label.
   */
  it('are upstream’s seven, in order, with upstream’s stored strings', () => {
    expect(GBR_PAGE_SIZE_CHOICES).toEqual([
      ['GERBER', 'Full size'],
      ['A4', 'Size A4'],
      ['A3', 'Size A3'],
      ['A2', 'Size A2'],
      ['A', 'Size A'],
      ['B', 'Size B'],
      ['C', 'Size C'],
    ]);
  });

  /**
   * The value is fed to `PAGE_INFO::SetType` (`gerbview_frame.cpp:334`), so a
   * radio naming a page the table does not have would silently fall back to
   * the GERBER square and the button would look dead.
   */
  it('every one of them names a page the sheet can actually be laid out on', () => {
    for (const [value] of GBR_PAGE_SIZE_CHOICES) expect(PAPER_MM[value], value).toBeDefined();
  });

  it('opens on the one the PARAM defaults to', () => {
    expect(GBR_PAGE_SIZE_CHOICES[0]?.[0]).toBe(GERBVIEW_DEFAULTS.appearance.page_type);
  });
});

describe('the Forced opacity spin control', () => {
  /**
   * `new wxSpinCtrlDouble( …, wxSP_ARROW_KEYS, 0.2, 1, 0.600000, 0.1 )` then
   * `SetDigits( 2 )` (`panel_gerbview_display_options_base.cpp:86-87`) — min,
   * max, initial, step, digits.
   */
  it('has the wxSpinCtrlDouble’s own range, step and digits', () => {
    expect(OPACITY_RANGE).toEqual({ min: 0.2, max: 1, step: 0.1, digits: 2 });
  });

  /** The constructor's `initial` is the PARAM's default, not a second number. */
  it('starts where the PARAM starts', () => {
    expect(GERBVIEW_DEFAULTS.appearance.mode_opacity_value).toBeGreaterThanOrEqual(
      OPACITY_RANGE.min,
    );
    expect(GERBVIEW_DEFAULTS.appearance.mode_opacity_value).toBeLessThanOrEqual(OPACITY_RANGE.max);
  });
});

describe('the toolbar toggles are a view of gerbview.json', () => {
  /**
   * The move that made the Display Options page mean anything: the toggles
   * used to be React state, so nothing outside the component could read them
   * and a Preferences checkbox over the same idea would have been a second,
   * disconnected switch. Upstream both read `gvconfig()`
   * (`gerbview_frame.cpp:1126-1150`).
   */
  it('a fresh store gives exactly the set the frame used to start with', () => {
    expect([...togglesFromSettings(cfg(), DEFAULT_TOGGLES)].sort()).toEqual(
      [...DEFAULT_TOGGLES].sort(),
    );
  });

  /**
   * The three `*Sketch` toggles are the NEGATION of the stored fill flags
   * (`return !gvconfig()->m_Display.m_DisplayLinesFill`, `:1136`). Getting this
   * backwards would show a fresh viewer with all three sketch modes on, which
   * is a different-looking canvas.
   */
  it('reads the sketch toggles as the inverse of the fill flags', () => {
    const c = cfg();
    expect(togglesFromSettings(c, new Set()).has('linesSketch')).toBe(false);
    c.display.lines_fill = false;
    expect(togglesFromSettings(c, new Set()).has('linesSketch')).toBe(true);
  });

  it('round-trips every stored toggle through the settings object', () => {
    for (const id of Object.keys(STORED_TOGGLES)) {
      const c = cfg();
      const flipped = applyToggle(togglesFromSettings(c, new Set()), id);
      expect(applyTogglesToSettings(c, flipped), id).toBe(true);
      expect(togglesFromSettings(c, new Set()).has(id), id).toBe(
        !togglesFromSettings(cfg(), new Set()).has(id),
      );
    }
  });

  /** `system.units` and `window.cursor.cross_hair_mode`, the two radio groups. */
  it('round-trips the units and crosshair groups', () => {
    const c = cfg();
    applyTogglesToSettings(c, applyToggle(togglesFromSettings(c, new Set()), 'unitsMils'));
    expect(c.system.units).toBe('mils');
    applyTogglesToSettings(c, applyToggle(togglesFromSettings(c, new Set()), 'crosshair45'));
    expect(c.window.cursor.crosshair).toBe('45');
    // Exclusive, as `applyToggle`'s groups are: picking one clears the others.
    const on = togglesFromSettings(c, new Set());
    expect(['unitsMm', 'unitsInches', 'unitsMils'].filter((i) => on.has(i))).toEqual(['unitsMils']);
  });

  /**
   * The guard that keeps opening the viewer from writing `gerbview.json` — and
   * waking the account sync — for a set that came out of that very file.
   */
  it('reports no change when the set already matches the store', () => {
    const c = cfg();
    expect(applyTogglesToSettings(c, togglesFromSettings(c, DEFAULT_TOGGLES))).toBe(false);
  });

  /**
   * `showLayerManager` has no `PARAM` behind it (it is wxAUI pane state), so
   * the projection must carry it through rather than dropping it — dropping it
   * would close the Layers manager on every settings write.
   */
  it('carries the frame-only toggles through untouched', () => {
    const kept = togglesFromSettings(cfg(), new Set(['showLayerManager', 'togglePolar']));
    expect(kept.has('showLayerManager')).toBe(true);
    expect(kept.has('togglePolar')).toBe(true);
    for (const id of LOCAL_TOGGLES) expect(id in STORED_TOGGLES, id).toBe(false);
    // …and writing back must not invent a field for them.
    const c = cfg();
    expect(applyTogglesToSettings(c, kept)).toBe(false);
  });

  it('sameToggles compares membership, not identity', () => {
    expect(sameToggles(new Set(['a', 'b']), new Set(['b', 'a']))).toBe(true);
    expect(sameToggles(new Set(['a']), new Set(['a', 'b']))).toBe(false);
    expect(sameToggles(new Set(['a']), new Set(['b']))).toBe(false);
  });
});
