// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Maintenance — `PANEL_MAINTENANCE`
 * (`common/dialogs/panel_maintenance_base.cpp`), which is four `Add()` calls in
 * a column and was drawn here as four buttons across the whole page.
 *
 * The sizer that decides that is the outer one:
 *
 *     bPanelSizer->Add( margins, 0, wxRIGHT|wxLEFT, 5 );      (`:61`)
 *
 * Proportion ZERO and no wxEXPAND, so `margins` is as wide as its widest child
 * insists and the space to its right stays empty. Its widest child is the
 * button column, whose buttons all carry wxEXPAND — so they stretch to each
 * other and stop. That is why KiCad draws four equal buttons about a third of
 * the page wide, and ours ran the full 1095: a flex column inside a `flex: 1`
 * page area has no proportion-0 to read.
 *
 * The second thing pinned here is that a wx border belongs to ONE `Add()`.
 * `.ze-pref-buttoncol` is shared with `PANEL_MOUSE_SETTINGS`' `bSizerRight`,
 * and it was carrying this page's `wxTOP, 10` and this page's spacer, so the
 * mouse page — whose `Add( bSizerRight, 0, wxEXPAND|wxLEFT, 5 )` has no wxTOP
 * at all — was pushed down by a border belonging to another sizer.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { COMMON_DEFAULTS } from '@ziroeda/designer/src/prefs/settings.js';

const src = (rel: string): string =>
  readFileSync(resolve(process.cwd(), '../designer/src', rel), 'utf8');

const CSS = src('ui/shell.css');
const PANEL = src('dialogs/prefs/panels/PanelMaintenance.tsx');
const DIALOG = src('dialogs/PreferencesDialog.tsx');
/** Comments stripped: prose ABOUT a control is not that control. */
const strip = (s: string): string =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const CODE = strip(PANEL);
const DIALOG_CODE = strip(DIALOG);

/** A rule body by exact selector, comments stripped. */
function rule(selector: string): string {
  const bare = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = (m[1] ?? '').trim().replace(/\s+/g, ' ');
    if (sel.split(',').some((s) => s.trim() === selector)) return m[2] ?? '';
  }
  return '';
}

describe('`margins` is a proportion-0 sizer item', () => {
  it('is as wide as its widest control, not as wide as the page', () => {
    // `bPanelSizer->Add( margins, 0, wxRIGHT|wxLEFT, 5 )` — no wxEXPAND.
    expect(rule('.ze-maintenance')).toMatch(/width:\s*max-content;/);
  });

  it('carries its own wxRIGHT|wxLEFT of 5 and nothing vertical', () => {
    const r = rule('.ze-maintenance');
    expect(r).toMatch(/margin:\s*0 5px;/);
    // The Add has no wxTOP or wxBOTTOM; the children below carry those.
    expect(r).not.toMatch(/margin-top|margin-block|padding/);
  });

  it('is what the panel actually wraps its controls in', () => {
    const at = CODE.indexOf('ze-maintenance');
    expect(at, 'the panel has no `margins`').toBeGreaterThan(-1);
    // Both children are inside it; the infobar note is not.
    expect(CODE.indexOf('ze-pref-buttoncol')).toBeGreaterThan(at);
    expect(CODE.indexOf('ze-pref-hint')).toBeGreaterThan(CODE.indexOf('ze-pref-buttoncol'));
  });
});

describe('the shared button column carries only the stretch', () => {
  it('states no gap and no margin of its own', () => {
    // Both were PANEL_MAINTENANCE's, and PANEL_MOUSE_SETTINGS was taking them.
    const r = rule('.ze-pref-buttoncol');
    expect(r).toMatch(/flex-direction:\s*column/);
    expect(r).not.toMatch(/\bgap\b|\bmargin/);
  });

  it('gives Maintenance its own borders, per Add()', () => {
    // `margins->Add( bResetStateSizer, 1, wxEXPAND|wxTOP, 10 )`.
    expect(rule('.ze-maintenance > .ze-pref-buttoncol')).toMatch(/margin-top:\s*10px;/);
    // Every button is `wxALL|wxEXPAND, 5`; two adjoining borders make the 10
    // between any two of them, so there is no container gap to state.
    expect(rule('.ze-maintenance > .ze-pref-buttoncol > button')).toMatch(/margin:\s*5px\b;/);
    // `Add( 0, 10, 1, wxEXPAND )` after the first button, ON TOP of that 5.
    expect(rule('.ze-maintenance > .ze-pref-buttoncol > button:first-child')).toMatch(
      /margin-bottom:\s*15px/,
    );
  });

  it('gives Mouse and Touchpad its own, which do not match', () => {
    // `Add( m_mouseDefaults, 0, wxEXPAND|wxBOTTOM|wxRIGHT|wxLEFT, 5 )` — the
    // first button has no wxTOP, and `bMargins`' Add of the column has none
    // either, so this run starts flush with the group beside it.
    expect(rule('.ze-mouse-scroll > .ze-pref-buttoncol > button')).toMatch(/margin:\s*0 5px 5px;/);
    expect(rule('.ze-mouse-scroll > .ze-pref-buttoncol')).toBe('');
    // Only the second button is wxALL.
    expect(rule('.ze-mouse-scroll > .ze-pref-buttoncol > button + button')).toMatch(
      /margin-top:\s*5px/,
    );
  });
});

describe('b3DCacheSizer', () => {
  it('sets the label 5px right of the buttons, which is its Add’s wxLEFT', () => {
    // `margins->Add( b3DCacheSizer, 0, wxEXPAND|wxTOP|wxRIGHT|wxLEFT, 5 )` on
    // top of the label's own wxALL 5, against a button's wxALL 5 alone.
    const r = rule('.ze-maintenance > .ze-pref-row');
    expect(r).toMatch(/margin:\s*5px 5px 0;/);
    // The label and "days" carry wxALL; the spin control carries only
    // wxTOP|wxBOTTOM, so each gap around the field is ONE border of 5 — not the
    // 8 `.ze-pref-row` defaults to.
    expect(r).toMatch(/gap:\s*5px;/);
    expect(r).toMatch(/padding:\s*5px 0;/);
  });
});

describe('the 3D cache duration is a live control', () => {
  it('binds to the settings field rather than a literal, and is not disabled', () => {
    const at = CODE.indexOf('3D cache file duration:');
    expect(at).toBeGreaterThan(-1);
    const el = CODE.slice(at, CODE.indexOf('/>', at));
    expect(el).toMatch(/value=\{ctx\.common\.system\.clear_3d_cache_interval\}/);
    expect(el).toMatch(/s\.system\.clear_3d_cache_interval = v/);
    expect(el).not.toMatch(/\bdisabled\b/);
  });

  it('takes the spin control’s own range, and its default from COMMON_DEFAULTS', () => {
    // `new wxSpinCtrl( …, wxSP_ARROW_KEYS, 0, 120, 30 )` (`:27`). The 30 there
    // is wxFormBuilder's initial value and is never shown —
    // `TransferDataToWindow` overwrites it from the settings object — so it is
    // the settings default that has to be 30, not the widget's.
    expect(CODE).toMatch(/CACHE_DAYS_MIN = 0\b/);
    expect(CODE).toMatch(/CACHE_DAYS_MAX = 120\b/);
    // `PARAM<int>( "system.clear_3d_cache_interval", …, 30 )`.
    expect(COMMON_DEFAULTS.system.clear_3d_cache_interval).toBe(30);
  });

  it('is swept when the board editor closes, as canCloseWindow does it', () => {
    // `PCB_BASE_FRAME::canCloseWindow` -> `PROJECT_PCB::Cleanup3DCache( &Prj() )`
    // (`pcbnew/pcb_base_frame.cpp:124`). A file-level check because the frame is
    // one 10k-line component; what it pins is that BOTH ways out of the editor
    // go through the same close, which is the failure a single-exit test would
    // miss.
    const frame = strip(src('editors/pcb/PcbEditor.tsx'));
    expect(frame).toMatch(/cleanup3dCache\(settings\.common\.system\.clear_3d_cache_interval\)/);
    // Neither the File menu's Close nor the home link may call `onExit` raw.
    expect(frame).toMatch(/addQuitOrClose\('PCB Editor', closeFrame\)/);
    expect(frame).toMatch(/HomeLink onClick=\{closeFrame\}/);
  });
});

describe('every button on the page is live', () => {
  it('none of the four is disabled', () => {
    // The last greyed one was Reset "Don't Show Again" Dialogs, on the grounds
    // that this port had no such dialog -- which was a reason to build one, not
    // to grey the button that clears them. `ui/kidialog.tsx` is that dialog.
    const buttons = CODE.split('<button').slice(1);
    expect(buttons.length).toBe(4);
    for (const b of buttons) expect(b.slice(0, b.indexOf('>'))).not.toMatch(/\bdisabled\b/);
  });

  it('clears BOTH stores, because doClearDontShowAgain has two halves', () => {
    // `settings->m_DoNotShowAgain = {}` is persisted; `KIDIALOG::
    // ClearDoNotShowAgainDialogs()` is a file-static map that dies with the
    // process. Clearing one and not the other leaves a silenced dialog silent.
    const at = CODE.indexOf('Reset &quot;Don&apos;t Show Again&quot; Dialogs');
    expect(at).toBeGreaterThan(-1);
    const arm = CODE.slice(CODE.lastIndexOf('<button', at), at);
    expect(arm).toMatch(/clearDoNotShowAgainSettings\(\)/);
    expect(arm).toMatch(/clearDoNotShowAgainDialogs\(\)/);
  });

  it('and the two reset buttons clear the session map too', () => {
    // `doClearDialogState` opens with `doClearDontShowAgain()` (`:117-119`) and
    // `onResetAll` calls `doClearDialogState()` (`:140`). The persisted half of
    // that rides along in storage; the session half cannot.
    for (const label of ['Reset All Dialogs to Defaults', 'Reset All Program Settings']) {
      const at = CODE.indexOf(label);
      expect(at, label).toBeGreaterThan(-1);
      const arm = CODE.slice(CODE.lastIndexOf('<button', at), at);
      expect(arm, label).toMatch(/clearDoNotShowAgainDialogs\(\)/);
    }
  });
});

describe('the footer', () => {
  it('has no Open Preferences Directory button', () => {
    // A browser has no preferences directory and will not grow one — settings
    // are an account slice cached in localStorage. Greying is for a control we
    // intend to back; this one is removed, as every browser-impossible control
    // is.
    expect(DIALOG_CODE).not.toMatch(/Open Preferences Directory/);
  });
});
