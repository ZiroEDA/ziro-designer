// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > SpaceMouse — `PANEL_SPACEMOUSE`
 * (`common/dialogs/panel_spacemouse_base.cpp`).
 *
 * The page was four things away from upstream's:
 *
 *   * its two speeds were spin controls, and `m_rotationSpeed` /
 *     `m_autoPanSpeed` are `wxSlider`s (`:39`, `:54`);
 *   * it carried a paragraph of OUR prose above the group and repeated it in
 *     every control's tooltip — KiCad has neither, and a disabled control
 *     explains itself in the source;
 *   * its controls held literals (`value={5}`, `checked={false}`) rather than
 *     `common.spacemouse.*`, so the page had nothing to reset and its footer
 *     button read "Reset to Defaults", greyed, where upstream's reads "Reset
 *     SpaceMouse to Defaults" — `PANEL_SPACEMOUSE` is a `RESETTABLE_PANEL`
 *     (`panel_spacemouse_base.cpp:12`, `panel_spacemouse.cpp:61`);
 *   * and the group is a `wxGridBagSizer( 1, 10 )` whose rows 2 and 6 are
 *     EMPTY, which is the whole of the space above "Pan speed:" and above
 *     "Reverse zoom direction".
 *
 * [px] `qa/probes/spacemouse_panel_probe.cpp` builds that sizer with wxWidgets
 * on this machine: slider rows 34 tall, checkbox rows 22, one pixel of vgap,
 * and an empty row worth 20.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PANEL = readFileSync(
  resolve(process.cwd(), '../designer/src/dialogs/prefs/panels/PanelSpacemouse.tsx'),
  'utf8',
);
const CSS = readFileSync(resolve(process.cwd(), '../designer/src/ui/shell.css'), 'utf8');
const INDEX = readFileSync(
  resolve(process.cwd(), '../designer/src/dialogs/prefs/panels/index.ts'),
  'utf8',
);
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

describe('the two speeds are the sliders upstream builds', () => {
  it('draws them with the shared Slider, not a spin control', () => {
    // `new wxSlider( this, wxID_ANY, 5, 1, 10 )` twice (`:39`, `:54`).
    expect(CODE.match(/<Slider/g) ?? []).toHaveLength(2);
    expect(CODE).not.toContain('<Num');
    expect(CODE).toMatch(/min=\{1\}[\s\S]{0,40}max=\{10\}/);
  });

  it("carries upstream's own tooltips and no others", () => {
    expect(PANEL).toContain('How far to zoom in for each rotation of the mouse wheel');
    expect(PANEL).toContain('How fast to pan when moving an object off the edge of the screen');
    expect(PANEL).toContain('Swap the direction of rotation');
  });
});

/**
 * The reason a control is dead belongs in the source. This page had it as a
 * banner ABOVE the group and again in every tooltip, and KiCad has neither —
 * the same mistake the high-contrast field's "Not wired yet:" tip was.
 */
describe('the page says nothing KiCad does not say', () => {
  it('draws no explanatory banner', () => {
    expect(CODE).not.toContain('ze-pref-hint');
    expect(CODE).not.toContain('3dxware');
    expect(CODE).not.toContain('No browser API');
  });

  it('keeps the reason as a comment, where a reader of the code finds it', () => {
    expect(PANEL).toContain('3dxware');
  });
});

describe('every control binds to its stored setting', () => {
  it.each([
    ['rotate_speed'],
    ['pan_speed'],
    ['reverse_rotate'],
    ['reverse_pan_y'],
    ['reverse_pan_x'],
    ['reverse_zoom'],
  ])('%s', (key) => {
    expect(CODE).toContain(`spacemouse.${key}`);
  });

  it('holds no literal in place of a setting', () => {
    expect(CODE).not.toContain('value={5}');
    expect(CODE).not.toContain('checked={false}');
  });

  it('disables all six, because no browser API reaches the device', () => {
    expect(CODE.match(/\bdisabled\b/g) ?? []).toHaveLength(6);
  });
});

/**
 * `PANEL_SPACEMOUSE` derives from `RESETTABLE_PANEL` and overrides `ResetPanel`,
 * so `PAGED_DIALOG::UpdateResetButton` labels the footer button "Reset
 * SpaceMouse to Defaults" and enables it
 * (`common/widgets/paged_dialog.cpp:329-350`). A page with no reset arm greys
 * it out and calls it "Reset to Defaults".
 */
describe('the page is resettable, as upstream declares it', () => {
  it('is wired to a reset in the generic factory', () => {
    const arm = INDEX.slice(INDEX.indexOf("case 'spacemouse':"), INDEX.indexOf("case 'version"));
    expect(arm).toMatch(/\breset:/);
  });
});

describe('the group is the grid bag sizer, with its empty rows', () => {
  it("is a two-column grid with the sizer's own gaps", () => {
    // [data] `wxGridBagSizer( 1, 10 )` — vgap 1, hgap 10.
    expect(rule('.ze-spacemouse-grid')).toMatch(/gap:\s*1px 10px/);
  });

  it('spans the checkboxes across both columns', () => {
    // [data] `wxGBSpan( 1, 2 )` on all four.
    expect(rule('.ze-spacemouse-grid > .gb-span')).toMatch(/grid-column:\s*1 \/ -1/);
    expect(CODE.match(/gb-span/g) ?? []).toHaveLength(4);
  });

  it('keeps rows 2 and 6, which hold nothing but space', () => {
    // [px] 20 tall, measured — the only thing holding "Pan speed:" and
    // "Reverse zoom direction" off the rows above them.
    expect(rule('.ze-spacemouse-grid > .gb-empty')).toMatch(/height:\s*20px/);
    expect(CODE.match(/gb-empty/g) ?? []).toHaveLength(2);
  });

  it('gives the horizontal-pan row the one border it has', () => {
    // [data] `wxALIGN_CENTER_VERTICAL|wxTOP, 3`.
    expect(rule('.ze-spacemouse-grid > .gb-top3')).toMatch(/margin-top:\s*3px/);
  });

  it('does not stretch the page to the width of the panel', () => {
    // `bSizer10->Add( bSizer1, 1, 0, 5 )` (`:80`) — no wxEXPAND, the same
    // construct Mouse and Touchpad is built with.
    expect(CODE).toContain('ze-pref-page-natural');
    expect(rule('.ze-pref-page-natural')).toMatch(/width:\s*max-content/);
  });
});
