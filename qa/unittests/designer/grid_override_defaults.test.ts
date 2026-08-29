// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Whether the per-item grid overrides are ON when a frame first opens.
 *
 * `ACTIONS::toggleGridOverrides` is one of the two left-toolbar buttons that
 * genuinely IS a check item — it declares `TOOLBAR_STATE::TOGGLE`, where the
 * units actions declare nothing — so its default is not a preference detail:
 * it is the state the button is painted in the moment the editor opens. Ours
 * defaulted it off and a real eeschema opens with it on, which is why the
 * second button in the left toolbar was flat in our capture and lit in KiCad's.
 *
 * WHERE THE VALUE COMES FROM. `APP_SETTINGS_BASE` registers the grid params
 * behind a per-editor split (`common/settings/app_settings.cpp:494-525`) under
 * the comment "for grid overrides, give just the schematic and symbol editors
 * sane values". The split is real, but it does NOT reach this parameter:
 *
 *     if( m_filename == "eeschema" || m_filename == "symbol_editor" )
 *         ... PARAM<bool>( ".grid.overrides_enabled", ..., true )     // :497-498
 *     else
 *         ... PARAM<bool>( ".grid.overrides_enabled", ..., true )     // :523-524
 *
 * Both arms say `true`. Only `override_connected` (true / false) and
 * `override_graphics_idx` differ between them. So this one is editor
 * independent, which is what lets it live in a single shared grid block here
 * rather than needing the per-frame window settings KiCad has.
 *
 * The value is asserted as a literal read off those two C++ lines. Nothing
 * here calls the module to work out what it should have said.
 */
import { describe, expect, it } from 'vitest';
import { EESCHEMA_DEFAULTS } from '@ziroeda/designer/src/prefs/settings.js';

describe('grid overrides are enabled by default', () => {
  it('eeschema opens with the overrides on', () => {
    expect(EESCHEMA_DEFAULTS.window.grid.overrides_enabled).toBe(true);
  });

  // A guard against "fixing" this by turning every override on: `true` here
  // means the override MECHANISM is armed, not that any individual item type
  // is overridden. Those are separate params and upstream leaves the eeschema
  // arm's `override_connected` true and the rest false — see the note below.
  it('but that does not mean every item type is overridden', () => {
    const { overrides } = EESCHEMA_DEFAULTS.window.grid;
    expect(overrides.wires.enabled).toBe(false);
    expect(overrides.text.enabled).toBe(false);
    expect(overrides.graphics.enabled).toBe(false);
  });
});

/**
 * KNOWN GAP, deliberately not asserted here.
 *
 * `override_connected` is the parameter the per-editor split above actually
 * changes: `true` for eeschema/symbol_editor (app_settings.cpp:499-500),
 * `false` for every other frame (:525-526). We model ONE global grid block
 * where KiCad has per-frame window settings, so there is no value this file
 * could assert that is right for both. Pinning either one would be pinning
 * half a bug.
 *
 * Same reason `PCBNEW_DEFAULTS` is not checked: our pcbnew settings carry no
 * grid-override block at all, so there is nothing to compare against the
 * `else` arm yet.
 */
