// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Mouse and Touchpad — `PANEL_MOUSE_SETTINGS`
 * (`common/dialogs/panel_mouse_settings_base.cpp`), whose three groups are
 * three DIFFERENT sizers and were all drawn here as one stack of rows:
 *
 *   * `gbSizer1` (`:31-88`) is a wxGridBagSizer two columns wide with a 30 px
 *     spacer between them — two checkboxes on row 0, one spanning row 1, and
 *     the two slider sizers side by side on row 2.
 *   * `fgSizer1` (`:117-172`) is a `wxFlexGridSizer( 0, 3, 5, 5 )`, and every
 *     choice in it carries `wxEXPAND`, so all FOUR are the width of the widest.
 *     [px] `qa/probes/mouse_panel_probe.cpp` builds it with wxWidgets here and
 *     reads all four back at 423 px.
 *   * `bMargins` (`:191-338`) puts the two Reset buttons in a column at the
 *     RIGHT of the modifier grid, not underneath it.
 *
 * And the fourth Drag Gestures row, `m_choicePanMoveKey` (`:161-169`), was
 * missing from the page altogether.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isScrollModSetValid } from '@ziroeda/designer/src/dialogs/prefs/panels/PanelMouseSettings.js';

const PANEL = readFileSync(
  resolve(process.cwd(), '../designer/src/dialogs/prefs/panels/PanelMouseSettings.tsx'),
  'utf8',
);
const CSS = readFileSync(resolve(process.cwd(), '../designer/src/ui/shell.css'), 'utf8');
/** The panel with its comments stripped: prose ABOUT a row is not that row. */
const CODE = PANEL.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

/** A rule body by exact selector, comments stripped. */
function rule(selector: string): string {
  const bare = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = (m[1] ?? '').trim().replace(/\s+/g, ' ');
    if (sel.split(',').some((s) => s.trim() === selector)) return m[2] ?? '';
  }
  return '';
}

/** The props of the JSX element a label opens. */
function props(label: string): string {
  const at = CODE.indexOf(label);
  expect(at, label).toBeGreaterThan(-1);
  return CODE.slice(at, CODE.indexOf('/>', at));
}

describe('Pan and Zoom is a grid bag sizer, not a stack', () => {
  it('lays the group out in two columns with the sizer spacer between them', () => {
    // [data] `gbSizer1->Add( 30, 0, wxGBPosition( 0, 1 ) )`.
    expect(rule('.ze-mouse-panzoom')).toMatch(/grid-template-columns:.*30px/);
  });

  it('puts the second checkbox and the pan slider in column 3', () => {
    // (0,2) and (2,2).
    expect(rule('.ze-mouse-panzoom > .gb-col3')).toMatch(/grid-column:\s*3/);
    expect(PANEL.match(/gb-col3/g) ?? []).toHaveLength(2);
  });

  it('spans "Use zoom acceleration" across the row, as wxGBSpan( 1, 3 ) does', () => {
    expect(rule('.ze-mouse-panzoom > .gb-span')).toMatch(/grid-column:\s*1 \/ -1/);
  });

  /**
   * [px] the probe reads the three rows at 27 px and 40 px apart. The cells
   * carry those borders themselves — `wxALL, 5` on row 0,
   * `wxBOTTOM|wxRIGHT|wxLEFT, 5` on row 1, `wxBOTTOM|wxEXPAND|wxTOP, 5` on
   * row 2 — and the 5 px `.ze-pref-group-body > *` gives a row lands on the
   * grid CONTAINER, not on anything inside it. Ours were 22 and 25 apart.
   */
  it('gives every cell the border its own Add() states', () => {
    expect(rule('.ze-mouse-panzoom > *')).toMatch(/margin:\s*5px 0/);
    // Row 1 is the one with no wxTOP.
    expect(rule('.ze-mouse-panzoom > .gb-span')).toMatch(/margin-top:\s*0/);
  });

  it('gives the slider the width wx gives a wxSlider', () => {
    // [px] 100, measured — a `.ze-slider` fills its container and a flex row
    // gives it none.
    expect(rule('.ze-mouse-slider > .ze-slider')).toMatch(/width:\s*100px/);
  });
});

describe('Drag Gestures is a three-column flex grid', () => {
  it('is a grid whose third column takes the slack', () => {
    // `fgSizer1->Add( 0, 0, 1, wxEXPAND )` after each choice.
    expect(rule('.ze-mouse-drag')).toMatch(/grid-template-columns:.*1fr/);
    // [data] the sizer's vgap and hgap of 5.
    expect(rule('.ze-mouse-drag')).toMatch(/gap:\s*5px/);
  });

  it("spaces the rows by the vgap AND the cells' own border", () => {
    // [px] 44 measured: a 34 px choice, its `wxBOTTOM, 5`, and the sizer's
    // vgap of 5. A gap alone gives 39.
    expect(rule('.ze-mouse-drag > *')).toMatch(/margin-bottom:\s*5px/);
  });

  it('makes every choice the width of the column, as wxEXPAND does', () => {
    expect(rule('.ze-mouse-drag > .ze-combo')).toMatch(/width:\s*100%/);
  });

  it('draws the fourth row upstream has', () => {
    expect(PANEL).toContain('Pan on mouse movement with key:');
    // `{ None, Alt, Ctrl, Shift }` (`:165`), in that order.
    expect(PANEL).toMatch(
      /\['none', 'None'\],\s*\['alt', 'Alt'\],\s*\['ctrl', 'Ctrl'\],\s*\['shift', 'Shift'\]/,
    );
  });

  it('uses the shared Combo and the shared Slider, never a bare input', () => {
    expect(PANEL).toContain('<Combo');
    expect(PANEL).toContain('<Slider');
    expect(PANEL).not.toContain('type="range"');
    expect(PANEL).not.toContain('<select');
  });
});

describe('Scroll Gestures puts its buttons where upstream puts them', () => {
  /**
   * `bSizer10->Add( bSizer1, 1, 0, 5 )` (`:340`) — proportion 1 and flags of
   * ZERO. No wxEXPAND means the page's content is not stretched to the panel's
   * width: it takes its best size and aligns left, so the Reset buttons stop
   * level with the widest row above them instead of at the right-hand edge.
   */
  it('does not stretch the page to the width of the panel', () => {
    expect(rule('.ze-pref-page-natural')).toMatch(/width:\s*max-content/);
    expect(PANEL).toContain('ze-pref-page-natural');
  });

  it('is a row: the settings, then the button column', () => {
    expect(rule('.ze-mouse-scroll')).toMatch(/display:\s*flex/);
    expect(rule('.ze-mouse-scroll')).not.toMatch(/flex-direction:\s*column/);
    // `Add( bSizerLeft, 1, … )` — the settings take the slack, the buttons do not.
    expect(rule('.ze-mouse-scroll > div:first-child')).toMatch(/flex:\s*1/);
  });

  it("is a six-column grid with the sizer's own vgap", () => {
    // [data] `new wxFlexGridSizer( 0, 6, 8, 0 )` and `Add( …, wxRIGHT|wxLEFT, 24 )`.
    expect(rule('.ze-mouse-scrollgrid')).toMatch(/row-gap:\s*8px/);
    expect(rule('.ze-mouse-scrollgrid')).toMatch(/padding:\s*0 24px/);
  });

  it('gives a radio row the height wx gives it', () => {
    // [px] 33 apart with a vgap of 8, so the row itself is 25 — a browser's
    // radio is smaller than the button GTK draws and closes the rows to 22.
    expect(rule('.ze-mouse-scrollgrid > .ze-pref-radio')).toMatch(/min-height:\s*25px/);
  });

  /**
   * `m_scrollWarning` is a `wxStaticBitmap` of `BITMAPS::small_warning`, hidden
   * on construction and shown only when `isScrollModSetValid` fails
   * (`panel_mouse_settings.cpp:50-51`, `:295`). Ours had folded that bitmap's
   * TOOLTIP into the label, so the sentence was always on screen and the
   * condition it warns about never was.
   */
  it('carries the label upstream carries, and no more', () => {
    expect(PANEL).toContain('Vertical touchpad or scroll wheel movement:');
    expect(PANEL).not.toContain('only one action can be assigned to each');
    expect(PANEL).toContain("bitmapUrl('small_warning')");
    expect(PANEL).toContain('Only one action can be assigned to each column');
  });
});

describe('isScrollModSetValid', () => {
  it('is true only when the three rows hold three different modifiers', () => {
    // `aSet.zoom != aSet.panh && aSet.panh != aSet.panv && aSet.panv != aSet.zoom`
    expect(isScrollModSetValid('none', 'ctrl', 'shift')).toBe(true);
    expect(isScrollModSetValid('ctrl', 'shift', 'none')).toBe(true);
    expect(isScrollModSetValid('ctrl', 'ctrl', 'shift')).toBe(false);
    expect(isScrollModSetValid('none', 'ctrl', 'none')).toBe(false);
    expect(isScrollModSetValid('alt', 'alt', 'alt')).toBe(false);
  });
});

/**
 * A row is enabled exactly when something outside Preferences reads its
 * setting. `ui/view_controls.ts`'s `commonInputPrefs()` is the whole of that
 * list for this page — it is the port of `WX_VIEW_CONTROLS::LoadSettings` — and
 * three of these settings are not in it.
 */
describe('the rows nothing reads are disabled', () => {
  it.each([
    // No autopan timer exists here at all.
    ['Automatically pan while moving object'],
    ['Auto pan speed'],
  ])('%s is disabled', (label) => {
    expect(props(label), label).toMatch(/\bdisabled\b/);
  });

  /**
   * `input.center_on_zoom` is `m_warpCursor` upstream, and `onWheel` acts on it
   * (`wx_view_controls.cpp:177`, `:472`): `CenterOnCursor()` recentres the view
   * and warps the POINTER to the middle of the canvas. A page cannot move the
   * pointer, and `wheelAction` implements neither half — it zooms about the
   * cursor whatever this holds. Assigning it into an `InputPrefs` object is not
   * a reader.
   */
  it('disables "Center and warp cursor on zoom", which nothing acts on', () => {
    expect(props('Center and warp cursor on zoom')).toMatch(/\bdisabled\b/);
  });

  /**
   * The one exception, and it is upstream's: `m_horizontalPan` is loaded
   * (`wx_view_controls.cpp:181`, `draw_panel_gal.cpp:825`) and read by NOTHING
   * — `onWheel` pans horizontally for a native horizontal wheel event whatever
   * it says, and the comment at `:424` describes a branch the code does not
   * have. Ours behaves the same, so the box stays enabled: greying it would be
   * our divergence from the parity target, not a fix.
   */
  it('leaves the horizontal-pan box enabled, as KiCad does', () => {
    const p = props('Pan left/right with horizontal movement');
    expect(p).toContain('horizontal_pan');
    expect(p).not.toMatch(/\bdisabled\b/);
  });

  /**
   * "Use zoom acceleration" was on the dead list while only
   * CONSTANT_ZOOM_CONTROLLER existed here. `ACCELERATING_ZOOM_CONTROLLER`
   * (`common/view/zoom_controller.cpp:73-108`) is ported now and
   * `zoomControllerFor` is `LoadSettings`' branch (`:196-214`), so the row is
   * live and `view_controls.test.ts` pins what it does.
   *
   * It stays enabled even though it changes nothing while `Automatic` is
   * ticked, because that is the parity target's behaviour and not ours:
   * `GetZoomControllerForPlatform` returns a CONSTANT_ZOOM_CONTROLLER on GTK3
   * without consulting the flag (`:55-71`). Greying it on that ground would be
   * the same divergence as greying the horizontal-pan box above.
   */
  /**
   * "Pan on mouse movement with key" was dead while our view controls only
   * panned on a DRAG. `onMotion`'s meta-pan block (`:288-311`) is ported now —
   * `makeMotionPan` — and every canvas asks it before anything else, which is
   * where upstream's early `return` puts it.
   */
  it('leaves "Pan on mouse movement with key" enabled, now that onMotion reads it', () => {
    const p = props('Pan on mouse movement with key');
    expect(p).toContain('motion_pan_modifier');
    expect(p).not.toMatch(/\bdisabled\b/);
  });

  it('leaves "Use zoom acceleration" enabled, now that a controller reads it', () => {
    const p = props('Use zoom acceleration');
    expect(p).toContain('zoom_acceleration');
    expect(p).not.toMatch(/\bdisabled\b/);
  });

  it.each([
    // `wheelAction` branches on all four (`ui/view_controls.ts:160`, `:225-239`).
    ['Zoom:', 'scroll_modifier_zoom'],
    ['Pan left/right:', 'scroll_modifier_pan_h'],
  ])('%s is live, and bound to %s', (label, setting) => {
    const at = CODE.indexOf(`label="${label}"`);
    expect(at, label).toBeGreaterThan(-1);
    const p = CODE.slice(at, CODE.indexOf('/>', at));
    expect(p, label).toContain(setting);
    expect(p, label).not.toMatch(/\bdisabled\b/);
  });

  it('disables the zoom-speed slider from its own checkbox, not for good', () => {
    // `m_zoomSpeed->Enable( !m_checkAutoZoomSpeed->GetValue() )` — a live
    // control that is off while Automatic is ticked, which is not the same as
    // a dead one.
    expect(props('Zoom speed:')).toContain('disabled={input.zoom_speed_auto}');
  });
});
