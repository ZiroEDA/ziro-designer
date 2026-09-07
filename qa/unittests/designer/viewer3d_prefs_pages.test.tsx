// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > 3D Viewer — `PANEL_3D_DISPLAY_OPTIONS` ("General") and
 * `PANEL_3D_OPENGL_OPTIONS` ("Realtime Renderer").
 *
 * The heading shipped as its Toolbars row alone. Its other three were declared
 * gaps, and one of those declarations was wrong: the Realtime Renderer's read
 * "ours is a three.js scene with none of those knobs", when `WebGLRenderer`
 * takes `antialias`, a `Box3Helper` is a bounding box, and the copper
 * extrusion is geometry we already build. Raytracing stays out — a path tracer
 * is not something a browser canvas grows.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PreferencesDialog } from '@ziroeda/designer/src/dialogs/PreferencesDialog.js';
import { resetPrefsPanelCache } from '@ziroeda/designer/src/dialogs/prefs/lazy_pages.js';
import { shippedUnder, OMITTED_PAGES } from '@ziroeda/designer/src/dialogs/prefs/registry.js';
import {
  VIEWER3D_CAMERA_DEFAULTS,
  VIEWER3D_DEFAULTS,
  VIEWER3D_RENDER_DEFAULTS,
  settings,
} from '@ziroeda/designer/src/prefs/settings.js';
import {
  resetViewer3dGeneral,
  resetViewer3dOpengl,
} from '@ziroeda/designer/src/editors/pcb/prefs/resets.js';
import {
  MATERIAL_MODE_CHOICES,
  REDRAW_SPEED_RANGE,
} from '@ziroeda/designer/src/editors/pcb/prefs/PanelViewer3dGeneral.js';
import { ANTI_ALIASING_CHOICES } from '@ziroeda/designer/src/editors/pcb/prefs/PanelViewer3dOpengl.js';

const SLOW = 60000;

type Page = '3dv-general' | '3dv-opengl';

const ANCHOR: Record<Page, string> = {
  '3dv-general': 'Render Options',
  '3dv-opengl': 'While Moving',
};

afterEach(() => {
  cleanup();
  resetPrefsPanelCache();
  settings.updateViewer3d((s) => {
    s.render = { ...VIEWER3D_RENDER_DEFAULTS };
    s.camera = { ...VIEWER3D_CAMERA_DEFAULTS };
  });
});

async function openPage(id: Page): Promise<void> {
  render(<PreferencesDialog onClose={() => {}} initialPage={id} />);
  await screen.findByText(ANCHOR[id], { exact: false }, { timeout: 30000 });
}

const panelText = (): string =>
  document.querySelector('.ze-prefs-panel')?.textContent?.replace(/\s+/g, ' ') ?? '';

describe('the heading is three of upstream’s four rows', () => {
  it('ships General, Toolbars and Realtime Renderer, in `ShowPreferences`’ order', () => {
    // `common/eda_base_frame.cpp:1693-1696`. The first row is called
    // "General", not "Display Options" like every other editor's.
    expect(shippedUnder('3D Viewer')).toEqual(['General', 'Toolbars', 'Realtime Renderer']);
  });

  it('leaves only Raytracing out, and says why', () => {
    const omitted = OMITTED_PAGES['3D Viewer'] ?? [];
    expect(omitted.map((o) => o.label)).toEqual(['Raytracing Renderer']);
    expect(omitted[0]?.reason).toContain('path tracer');
  });
});

describe('3D Viewer > General', () => {
  it(
    'draws both groups and all eight controls',
    async () => {
      await openPage('3dv-general');
      const text = panelText();
      for (const t of [
        'Render Options',
        'Clip silkscreen at via annuli',
        'Clip silkscreen at solder mask edges',
        'Show filled areas in zones',
        'Use bare copper color for unplated copper (slow)',
        'Material properties:',
        'Camera Options',
        'Rotation increment:',
        'Redraw while moving',
        'Redraw speed:',
      ])
        expect(text, t).toContain(t);
    },
    SLOW,
  );

  it('maps Material properties onto MATERIAL_MODE, Realistic first', () => {
    // `3d-viewer/3d_enums.h`: NORMAL 0, DIFFUSE_ONLY 1, CAD_MODE 2, so the
    // selection index IS the stored value and NORMAL is the default.
    expect(MATERIAL_MODE_CHOICES).toEqual([
      [0, 'Realistic'],
      [1, 'Solid colors'],
      [2, 'CAD colors'],
    ]);
    expect(VIEWER3D_RENDER_DEFAULTS.material_mode).toBe(0);
  });

  it('opens the Redraw speed slider at 3 of 1..5', () => {
    // `wxSlider( …, 3, 1, 5, … )` (`panel_3D_display_options_base.cpp:110`).
    expect(REDRAW_SPEED_RANGE).toEqual({ min: 1, max: 5 });
    expect(VIEWER3D_CAMERA_DEFAULTS.moving_speed_multiplier).toBe(3);
  });

  it(
    'greys the Redraw speed slider AND its label when the animation is off',
    async () => {
      await openPage('3dv-general');
      // `OnCheckEnableAnimation` runs `Enable` on BOTH
      // (`panel_3D_display_options.cpp:36-40`), and `loadViewSettings` runs the
      // same two on load — so the pair opens disabled for a user who has
      // switched it off, not merely on the next click.
      const slider = screen.getByLabelText('Redraw speed') as HTMLInputElement;
      expect(slider.disabled).toBe(false);
      fireEvent.click(screen.getByLabelText('Redraw while moving'));
      expect((screen.getByLabelText('Redraw speed') as HTMLInputElement).disabled).toBe(true);
      expect(document.querySelector('.lbl.ze-disabled')?.textContent).toContain('Redraw speed');
    },
    SLOW,
  );

  it(
    'stores the camera increment, which the viewer’s rotate commands read',
    async () => {
      await openPage('3dv-general');
      // `Num` wraps a `SpinCtrl`, whose stepper buttons sit inside the same
      // `<label>` — so the row is found by its text and the entry taken out of
      // it, rather than by an implicit label that matches three elements.
      const row = Array.from(document.querySelectorAll('.ze-pref-row')).find((r) =>
        r.textContent?.startsWith('Rotation increment:'),
      );
      expect(row, 'the Rotation increment row').toBeTruthy();
      const spin = (row as Element).querySelector('input') as HTMLInputElement;
      fireEvent.change(spin, { target: { value: '45' } });
      fireEvent.blur(spin);
      fireEvent.click(screen.getByText('OK'));
      expect(settings.viewer3d.camera.rotation_increment).toBe(45);
    },
    SLOW,
  );
});

describe('3D Viewer > Realtime Renderer', () => {
  it(
    'draws both groups and all nine controls',
    async () => {
      await openPage('3dv-opengl');
      const text = panelText();
      for (const t of [
        'Rendering Options',
        'Show model bounding boxes',
        'Show copper and tech layers thickness (slow)',
        'Highlight items on rollover',
        'Anti-aliasing:',
        'Selection color:',
        'While Moving',
        'Disable anti-aliasing',
        'Disable thickness',
        'Disable uVia holes',
        'Disable all plated holes',
      ])
        expect(text, t).toContain(t);
    },
    SLOW,
  );

  it('offers all four anti-aliasing rows and defaults to the LAST one', () => {
    // `ANTIALIASING_MODE`: NONE 0, 2X 1, 4X 2, 8X 3, and
    // `eda_3d_viewer_settings.cpp:255-259` defaults to AA_8X — the one control
    // on either page whose default is not the first row. WebGL takes a boolean
    // and picks the sample count itself, but a page offering two rows would
    // silently rewrite a stored 8x.
    expect(ANTI_ALIASING_CHOICES.map((c) => c[1])).toEqual(['Disabled', '2x', '4x', '8x']);
    expect(VIEWER3D_RENDER_DEFAULTS.opengl_AA_mode).toBe(3);
  });

  it(
    'stores a checkbox the scene reads',
    async () => {
      await openPage('3dv-opengl');
      fireEvent.click(screen.getByLabelText('Show model bounding boxes'));
      fireEvent.click(screen.getByText('OK'));
      expect(settings.viewer3d.render.opengl_show_model_bbox).toBe(true);
    },
    SLOW,
  );
});

describe('the defaults are `eda_3d_viewer_settings.cpp`’s own', () => {
  it('ships every one of them, including the three that are not false', () => {
    expect(VIEWER3D_RENDER_DEFAULTS).toEqual({
      clip_silk_on_via_annulus: false,
      subtract_mask_from_silk: false,
      show_zones: true,
      plated_and_bare_copper: false,
      material_mode: 0,
      opengl_show_model_bbox: false,
      opengl_copper_thickness: false,
      opengl_highlight_on_rollover: true,
      opengl_AA_mode: 3,
      opengl_selection_color: 'rgb(0,255,0)',
      opengl_AA_disableOnMove: false,
      opengl_thickness_disableOnMove: false,
      opengl_vias_disableOnMove: false,
      opengl_holes_disableOnMove: false,
    });
    expect(VIEWER3D_CAMERA_DEFAULTS).toEqual({
      animation_enabled: true,
      moving_speed_multiplier: 3,
      rotation_increment: 10,
    });
  });

  it('keeps the two pages’ reset slices apart, though they share `render`', () => {
    // Both pages write `render.*`, so a reset that took the block would undo
    // the other page. `PANEL_3D_DISPLAY_OPTIONS::ResetPanel` sets five render
    // keys and three camera keys; `PANEL_3D_OPENGL_OPTIONS::ResetPanel` sets
    // the nine `opengl_*`.
    const bag = structuredClone(VIEWER3D_DEFAULTS);
    bag.render.show_zones = false;
    bag.render.opengl_show_model_bbox = true;
    bag.camera.rotation_increment = 45;
    const ctx = { up3d: (fn: (s: typeof bag) => void) => fn(bag) };

    resetViewer3dGeneral(ctx as never);
    expect(bag.render.show_zones, 'General owns show_zones').toBe(true);
    expect(bag.camera.rotation_increment, 'and the camera group').toBe(10);
    expect(bag.render.opengl_show_model_bbox, 'but not the OpenGL page’s keys').toBe(true);

    resetViewer3dOpengl(ctx as never);
    expect(bag.render.opengl_show_model_bbox).toBe(false);
  });
});
