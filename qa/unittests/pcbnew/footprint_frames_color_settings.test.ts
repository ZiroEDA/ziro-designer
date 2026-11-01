// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The footprint frames' `GetColorSettings`: each answers the Footprint Editor's theme,
 * `appearance.color_theme` in `fpedit.json`.
 *
 *   FOOTPRINT_VIEWER_FRAME::GetColorSettings  footprint_viewer_frame.cpp:872-875
 *   FOOTPRINT_EDIT_FRAME::GetColorSettings    footprint_edit_frame.cpp:877-881
 *
 * The viewer had no override, so PCB_BASE_FRAME's threw "Color settings requested for a
 * PCB_BASE_FRAME that does not override!" the moment its canvas was built with a board
 * (Sentry 156088134). The editor inherited PCB_BASE_EDIT_FRAME's, the board editor's theme.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PgmOrNull } from '@ziroeda/common/pgm_base.js';
import { installPgm } from '@ziroeda/designer/src/editors/pcb/pcb_canvas.js';
import { settings } from '@ziroeda/designer/src/prefs/settings.js';
import { FOOTPRINT_EDIT_FRAME } from '@ziroeda/pcbnew/footprint_edit_frame.js';
import {
  FOOTPRINT_EDITOR_SETTINGS,
  loadFpEditSettings,
} from '@ziroeda/pcbnew/footprint_editor_settings.js';
import { FOOTPRINT_VIEWER_FRAME } from '@ziroeda/pcbnew/footprint_viewer_frame.js';

/** Two themes that differ only by name, so the one answered can only be the one asked for. */
const FP_THEME = 'footprint-theme-under-test';
const BOARD_THEME = 'board-theme-under-test';

let fpTheme = '';
let boardTheme = '';

beforeEach(() => {
  installPgm();
  const mgr = PgmOrNull()!.GetSettingsManager();
  mgr.AddNewColorSettings(FP_THEME);
  mgr.AddNewColorSettings(BOARD_THEME);
  fpTheme = settings.fpEdit.appearance.color_theme;
  boardTheme = settings.pcbnew.appearance.color_theme;
  settings.fpEdit.appearance.color_theme = FP_THEME;
  settings.pcbnew.appearance.color_theme = BOARD_THEME;
  // `installPgm` is the program's `JSON_SETTINGS::Load`: it reads the slices into the objects.
  installPgm();
});

afterEach(() => {
  settings.fpEdit.appearance.color_theme = fpTheme;
  settings.pcbnew.appearance.color_theme = boardTheme;
  installPgm();
});

const themeOf = (aFrame: { GetColorSettings(): { GetFilename(): string } }): string =>
  aFrame.GetColorSettings().GetFilename();

describe('FOOTPRINT_VIEWER_FRAME::GetColorSettings', () => {
  const viewer = (): FOOTPRINT_VIEWER_FRAME =>
    new FOOTPRINT_VIEWER_FRAME({ reCreateLibraryList: () => {}, selectAndViewFootprint: () => {} });

  it('answers, rather than falling through to the base frame that throws', () => {
    expect(() => viewer().GetColorSettings()).not.toThrow();
  });

  it("is the Footprint Editor's theme, not the board editor's", () => {
    expect(themeOf(viewer())).toBe(FP_THEME);
  });
});

describe('FOOTPRINT_EDIT_FRAME::GetColorSettings', () => {
  it("is its own settings' theme, not the board editor's", () => {
    const frame = new FOOTPRINT_EDIT_FRAME({ fpEdit: () => {} });
    expect(themeOf(frame)).toBe(FP_THEME);
  });
});

describe('loadFpEditSettings', () => {
  it('reads appearance.color_theme into m_ColorTheme', () => {
    const s = new FOOTPRINT_EDITOR_SETTINGS();
    loadFpEditSettings(s, {
      pcb_display: { graphics_fill: true, text_fill: true, pad_fill: true, pad_numbers: true },
      appearance: { color_theme: FP_THEME },
    });
    expect(s.m_ColorTheme).toBe(FP_THEME);
  });

  it('still reads the pcb_display four', () => {
    const s = new FOOTPRINT_EDITOR_SETTINGS();
    loadFpEditSettings(s, {
      pcb_display: { graphics_fill: false, text_fill: true, pad_fill: false, pad_numbers: false },
      appearance: { color_theme: FP_THEME },
    });
    const v = s.m_ViewersDisplay;
    expect([
      v.m_DisplayGraphicsFill,
      v.m_DisplayTextFill,
      v.m_DisplayPadFill,
      v.m_DisplayPadNumbers,
    ]).toEqual([false, true, false, false]);
  });
});
