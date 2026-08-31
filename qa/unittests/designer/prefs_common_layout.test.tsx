// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Common — the page's SHAPE, which was wrong three ways.
 *
 * `panel_common_settings_base.cpp` builds two columns:
 *
 *     bPanelSizer->Add( bLeftSizer, 0, wxRIGHT, 35 );   (:325)
 *
 * with Rendering Engine, Helper Applications and User Interface on the left and
 * Scaling, Editing, Session and Project Backup on the right. Ours stacked all of
 * them in one scrolling column.
 *
 * Its group headings are a `wxStaticText` plus a `wxStaticLine`, never a
 * wxStaticBox:
 *
 *     bLeftSizer->Add( m_staticText20, 0, wxTOP|wxRIGHT|wxLEFT|wxEXPAND, 13 );
 *     bLeftSizer->Add( m_staticline3,  0, wxEXPAND|wxTOP|wxBOTTOM, 2 );
 *
 * and NEITHER that file NOR its hand-written `.cpp` calls SetFont anywhere, so a
 * heading is the dialog's own font, weight and foreground. Ours stated 12.5px,
 * 600 and #c7c9cc.
 *
 * And two choices upstream draws as wxRB_GROUP runs — Icon theme (:202-226) and
 * Toolbar icon size (:228-251) — were wxChoices here, which hides two of the
 * three answers behind a click.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup } from '@testing-library/react';

afterEach(cleanup);

const PANEL = readFileSync(
  resolve(process.cwd(), '../designer/src/dialogs/prefs/panels/PanelCommonSettings.tsx'),
  'utf8',
);
const CSS = readFileSync(resolve(process.cwd(), '../designer/src/ui/shell.css'), 'utf8');
const WIDGETS = readFileSync(
  resolve(process.cwd(), '../designer/src/dialogs/prefs/widgets.tsx'),
  'utf8',
);
/** The panel with its comments stripped: prose ABOUT a row is not that row. */
const PANEL_CODE = PANEL.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

/** A rule body by exact selector, comments stripped. */
function rule(selector: string): string {
  const bare = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = (m[1] ?? '').trim().replace(/\s+/g, ' ');
    if (sel.split(',').some((s) => s.trim() === selector)) return m[2] ?? '';
  }
  return '';
}

describe('the page is two columns, as bPanelSizer makes it', () => {
  it('renders a column container with two columns in it', () => {
    expect(PANEL).toContain('ze-pref-columns');
    expect(PANEL.match(/className="ze-pref-col(?: [^"]*)?"/g) ?? []).toHaveLength(2);
  });

  it('the container is a flex row and the gutter is the sizer border', () => {
    expect(rule('.ze-pref-columns')).toMatch(/display:\s*flex/);
    // [data] `wxRIGHT, 35` on the left column.
    expect(rule('.ze-pref-columns > div:first-child')).toMatch(/margin-right:\s*35px/);
  });

  /**
   * `Add( bLeftSizer, 0, … )` against `Add( rightSizer, 1, … )` (`:325`, `:479`):
   * the left column takes what its widest row needs and the right column takes
   * the slack. Neither may shrink past its content -- a wx sizer derives the
   * dialog's width FROM those minimums. `min-width: 0` on both is what let the
   * left column be squeezed until "Focus follows mouse between schematic and
   * PCB editors" wrapped onto two lines.
   */
  it('gives the columns their sizer proportions and lets neither shrink', () => {
    // Proportion 0 is the default, because it is what nearly every one of
    // these Add()s carries -- eeschema's two columns included.
    expect(rule('.ze-pref-columns > div')).toMatch(/flex:\s*none/);
    expect(rule('.ze-pref-columns > div')).not.toMatch(/min-width:\s*0/);
    // ...and Common's right column is the one with a proportion of 1, stated
    // by the page rather than assumed by the class.
    expect(rule('.ze-pref-columns > .ze-grow')).toMatch(/flex:\s*1/);
    expect(PANEL).toContain('ze-pref-col ze-grow');
  });

  it('never wraps a control label, because wx never does', () => {
    // Nothing in these panels calls `wxStaticText::Wrap`, so every label is one
    // line and the dialog is as wide as the widest of them.
    // The selector that belongs only to that rule; `.ze-pref-check` alone also
    // opens the flex rule above it.
    expect(rule('.ze-pref-row > .lbl')).toMatch(/white-space:\s*nowrap/);
  });

  it('splits the groups the way upstream splits them', () => {
    const left = PANEL.slice(PANEL.indexOf('ze-pref-col'), PANEL.lastIndexOf('ze-pref-col'));
    const right = PANEL.slice(PANEL.lastIndexOf('ze-pref-col'));
    // Of upstream's seven, three survive: Rendering Engine and Helper
    // Applications describe a GAL backend and native program paths, and
    // Session and Project Backup describe relaunching processes and writing
    // archives into directories. None of the four has anything behind it here.
    expect(left).toContain('User Interface');
    for (const g of ['Scaling', 'Editing']) expect(right).toContain(g);
  });

  /**
   * `m_checkBoxIconsInMenus->Show( KIPLATFORM::UI::AllowIconsInMenus() )`
   * (`panel_common_settings.cpp:123`), and the GTK port answers by reading
   * `gtk-menu-images` (`wxgtk/ui.cpp:296-300`), which GTK3 deprecated and
   * turned off. The row is invisible on the parity target — and our menus draw
   * no bitmap either (`menu_no_icons.test.ts`), so the checkbox governed
   * nothing in a place KiCad has no checkbox at all.
   */
  it('does not draw the row this platform hides', () => {
    expect(PANEL_CODE).not.toContain('Show icons in menus');
  });

  it('does not draw the four groups that describe a desktop', () => {
    for (const g of ['Rendering Engine', 'Helper Applications', 'Session', 'Project Backup']) {
      expect(PANEL, g).not.toContain(`title="${g}"`);
    }
    // Nor the Privacy group, which was ours rather than KiCad's.
    expect(PANEL).not.toContain('title="Privacy"');
  });
});

describe('a group heading is a label and a rule, at the dialog font', () => {
  it('states no size, no weight and no colour of its own', () => {
    // Upstream calls SetFont on none of the seven.
    const body = rule('.ze-pref-group-title');
    expect(body).not.toMatch(/font-size\s*:/);
    expect(body).not.toMatch(/font-weight\s*:/);
    expect(body).not.toMatch(/(^|[;\s])color\s*:/);
  });

  it('still draws the wxStaticLine under it', () => {
    expect(rule('.ze-pref-group-title')).toMatch(/border-bottom:\s*1px solid/);
  });
});

/**
 * Which rows of User Interface are LIVE and which are dead, checked against the
 * only thing that decides it: whether anything outside Preferences reads the
 * setting.
 *
 *     appearance.show_scrollbars      nobody          — no canvas draws them
 *     input.focus_follow_sch_pcb      nobody          — one tab, no windows
 *     input.hotkey_feedback           LIVE            — ui/grid_settings.ts:355,
 *                                                       widgets/hotkey_cycle_popup.ts
 *     appearance.grid_striping        nobody          — no grid stripes rows
 *     appearance.use_custom_cursors   LIVE            — ui/kicursors.ts:98
 *     appearance.icon_theme           nobody          — one SVG set, currentColor
 *     appearance.toolbar_icon_size    nobody          — toolbars draw at one size
 *     appearance.hicontrast_dimming_factor  nobody    — the painters take
 *                                       common/src/render_settings.ts's
 *                                       HI_CONTRAST_FACTOR = 0.2, a constant
 *
 * A dead row is DISABLED, not hidden and not left clickable: the page must
 * still be KiCad's page, and a control that swallows a click and changes
 * nothing is worse than one that says it cannot be answered. When a setting
 * gains a reader, its row loses `disabled` and this list is what says so.
 */
describe('a row is enabled exactly when something reads its setting', () => {
  /** The props of the JSX element the label opens. */
  function props(label: string): string {
    const at = PANEL.indexOf(label);
    expect(at, label).toBeGreaterThan(-1);
    return PANEL.slice(at, PANEL.indexOf('/>', at));
  }

  it.each([
    ['Show scrollbars in editors'],
    ['Focus follows mouse between schematic and PCB editors'],
    ['Use alternating row colors in tables'],
    ['Icon theme:'],
    ['Toolbar icon size:'],
    ['High-contrast mode dimming factor:'],
    // Editing: neither `input.warp_mouse_on_move` (a page cannot move the
    // pointer) nor `input.immediate_actions` has a reader.
    ['Warp mouse to anchor of moved object'],
    ['First hotkey selects tool'],
    // Scaling: `appearance.zoom_correction_factor` has none either, so the
    // whole ZOOM_CORRECTION_CTRL is greyed.
    ['ZoomCorrectionCtrl'],
  ])('%s is disabled, because nothing reads it', (label) => {
    expect(props(label), label).toMatch(/\bdisabled\b/);
  });

  it.each([
    ['Show popup indicator when toggling settings with hotkeys', 'hotkey_feedback'],
    ['Disable custom cursors', 'use_custom_cursors'],
  ])('%s is live, and bound to %s', (label, setting) => {
    const p = props(label);
    expect(p, label).toContain(setting);
    expect(p, label).not.toMatch(/\bdisabled\b/);
  });
});

/**
 * A tooltip is `SetToolTip`, and only where upstream calls it.
 *
 * `m_highContrastCtrl` has none (`panel_common_settings_base.cpp:275-293`), so
 * hovering it in KiCad shows nothing and hovering ours must show nothing
 * either — a note explaining why a control is disabled belongs in the source,
 * where it does not follow the user's cursor around the page. The three that
 * DO carry one carry upstream's words, not a paraphrase.
 */
describe("a tooltip is upstream's SetToolTip, or there is none", () => {
  it('gives the high-contrast row no tooltip at all', () => {
    const at = PANEL.indexOf('High-contrast mode dimming factor:');
    expect(PANEL.slice(at, PANEL.indexOf('/>', at))).not.toContain('title=');
  });

  it.each([
    [
      'Focus follows mouse between schematic and PCB editors',
      'If the mouse cursor is moved over the canvas of a schematic or PCB editor window, that window is raised.',
    ],
    [
      'Use alternating row colors in tables',
      'When enabled, use a different color for every other table row',
    ],
    [
      'Disable custom cursors',
      'When enabled, KiCad will use default system cursors instead of custom ones',
    ],
    ['Show scrollbars in editors', 'This change takes effect when relaunching the editor.'],
  ])("%s carries upstream's own words", (label, tip) => {
    const at = PANEL.indexOf(label);
    expect(PANEL.slice(at, PANEL.indexOf('/>', at)), label).toContain(`title="${tip}"`);
  });

  it('puts the radio tooltips on the BUTTONS, as wx does', () => {
    // `m_rbIconThemeLight->SetToolTip(...)` — the tip is the button's, not the
    // row's, so a three-element option carries it.
    expect(PANEL).toContain("'Use icons designed for light window backgrounds'");
    expect(PANEL).toContain("'Use compact icons in the toolbars'");
    expect(WIDGETS).toContain('options.map(([v, l, tip])');
  });
});

/**
 * What "greyed" LOOKS like. GTK dims a disabled control's label as well as the
 * control — `label:disabled` takes the same ink as `entry:disabled` and
 * `button:disabled`, which is `--ctl-fg-disabled` — and it dims by colour,
 * never by opacity. Ours dimmed only the box the browser draws, so a row
 * nothing reads was indistinguishable from one that works.
 */
describe('a disabled row is drawn grey, not merely unclickable', () => {
  it.each([
    ['.ze-pref-check:has(input:disabled)'],
    ['.ze-pref-radio:has(input:disabled)'],
    ['.ze-pref-radiorow:has(input:disabled)'],
    ['.ze-pref-row:has(input:disabled) > .lbl'],
  ])('%s takes the disabled foreground', (selector) => {
    expect(rule(selector), selector).toContain('var(--ctl-fg-disabled)');
  });

  it('states no foreground of its own for an ENABLED label', () => {
    // A `wxStaticText` takes the dialog's foreground; not one panel in
    // `common/dialogs/` calls SetForegroundColour on one. The literals here
    // (#c7c9cc, #9aa0a6) made every labelled row dimmer than the checkbox
    // above it — and left no ink darker for a disabled one to take.
    expect(rule('.ze-pref-row .lbl')).not.toMatch(/(^|[;\s])color\s*:/);
    expect(rule('.ze-pref-row .unit')).toBe('');
  });
});

/**
 * The User Interface group's SPACING, which is not one number.
 *
 * [px] `qa/probes/prefs_ui_group_probe.cpp` builds `bUserInterfaceSizer` with
 * wxWidgets on this machine and this GTK theme — the rows the installed build
 * shows, with upstream's own Add() flags — and reads the widgets back:
 *
 *     checkbox to checkbox      27      (wxBOTTOM|wxRIGHT|wxLEFT, 5)
 *     last checkbox to Icon     37      (+ the row's wxTOP 5, + wxALL 5)
 *     Icon theme to Toolbar     32      (two wxALL 5s and nothing else)
 *     label -> first radio      10      (two adjoining wxALL 5 borders)
 *     radio -> radio            10
 *     left edge                 5       for the checkboxes AND both labels
 *
 * So a radio row is TALLER than a checkbox row, its label takes its own width,
 * and the two rows do not line up with each other. Ours drew both in
 * `.ze-pref-row`'s 150 px label column, which lined the radios up in a grid
 * KiCad does not have and left the rows 20 px apart instead of 32.
 */
describe('a radio row is spaced by its own sizer, not by the label column', () => {
  it('is its own class, not the gbSizer cell rule', () => {
    const at = PANEL.indexOf('Icon theme:');
    const around = PANEL.slice(Math.max(0, at - 400), at + 400);
    expect(around).toContain('<Radio');
    expect(around).toContain('row');
    // The shared widget emits it: `row` is the horizontal sizer, and it must
    // not fall back to the label-column rule.
    const variant = /\$\{row \? '([^']+)' : '([^']+)'\}/.exec(WIDGETS);
    expect(variant?.[1]).toBe('ze-pref-radiorow');
    expect(rule('.ze-pref-radiorow')).toMatch(/display:\s*flex/);
  });

  it('spaces the label and the buttons by the wx border, not by a picked gap', () => {
    // [px] 10, twice measured: label -> first radio, and radio -> radio.
    expect(rule('.ze-pref-radiorow')).toMatch(/gap:\s*10px/);
  });

  it('carries the wxALL border above and below, which a checkbox row does not', () => {
    // [px] the 5 that makes the 32 px pitch a 32 and not a 27.
    expect(rule('.ze-pref-radiorow')).toMatch(/padding:\s*5px 0/);
  });

  it('does not give the row a label column', () => {
    // `.ze-pref-row .lbl` states `min-width: 150px` for the gbSizer pages. A
    // radio row taking that rule is the bug this pins.
    expect(rule('.ze-pref-radiorow .lbl')).toBe('');
  });
});

/**
 * `m_highContrastCtrl->SetMinSize( wxSize( GetTextExtent( "XXX.XXX" ), … ) )`
 * (`panel_common_settings.cpp:145-148`): the field is sized to its widest
 * value. [px] 58 on this theme, from the same probe.
 */
describe('the high-contrast field is sized to its widest value', () => {
  it('states the measured width rather than the widget default', () => {
    const at = PANEL.indexOf('High-contrast mode dimming factor:');
    expect(at).toBeGreaterThan(-1);
    const p = PANEL.slice(at, PANEL.indexOf('/>', at));
    expect(p).toContain('width={58}');
    // `m_highContrastCtrl` is a wxTextCtrl (`:283`): no up/down arrows, and
    // not the spin control's right-aligned digits.
    expect(p).toContain('spin={false}');
  });
});

describe('the small choices are radio runs, not combos', () => {
  it.each([
    ['Icon theme:', 'pref-icon-theme'],
    ['Toolbar icon size:', 'pref-toolbar-icon-size'],
  ])('%s is a Radio with its own group name', (label, group) => {
    // Each wxRB_GROUP is its own exclusive set; two sharing a name would make
    // picking Dark clear the toolbar size.
    const at = PANEL.indexOf(label);
    expect(at).toBeGreaterThan(-1);
    // The window spans BOTH sides of the label: `<Radio` opens before it and
    // `name` follows it, so a look-behind alone finds the tag and not the name.
    const around = PANEL.slice(Math.max(0, at - 400), at + 400);
    expect(around).toContain('<Radio');
    expect(around).toContain(group);
    // ...and it is not still a combo.
    expect(around).not.toContain('<Sel');
  });

  it('gives the two runs different group names', () => {
    expect(PANEL).toContain('pref-icon-theme');
    expect(PANEL).toContain('pref-toolbar-icon-size');
  });
});

/**
 * Scaling is `ZOOM_CORRECTION_CTRL` and nothing else:
 *
 *     m_scalingSizer->Add( m_zoomCorrectionCtrl, 1, wxEXPAND );
 *     (panel_common_settings.cpp:120)
 *
 * A browser needs it MORE than a desktop app: `wxDisplay` can at least ask the
 * OS what the panel reports, while a CSS pixel is defined only as a ratio and
 * the page is never told the physical size of anything. So the ruler is the
 * answer and Detect is a guess.
 */
describe('Scaling is the zoom-correction control', () => {
  it('is the widget, not a hand-rolled copy of it', () => {
    expect(PANEL).toContain('ZoomCorrectionCtrl');
    expect(PANEL).toContain('Scaling');
  });

  it('binds it to the setting the C++ binds it to', () => {
    expect(PANEL).toContain('zoom_correction_factor');
  });
});
