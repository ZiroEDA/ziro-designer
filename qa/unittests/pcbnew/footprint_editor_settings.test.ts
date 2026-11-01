// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * FOOTPRINT_EDITOR_SETTINGS' four `pcb_display.*` PARAMs (footprint_editor_settings.cpp:96-106):
 * `fpedit.json` loads into the object the painter draws the Footprint Editor with, and what its
 * sketch toggles flip is written back, so a sketch mode outlives the session as upstream's does.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  FOOTPRINT_EDITOR_SETTINGS,
  loadFpEditViewersDisplay,
  storeFpEditViewersDisplay,
} from '@ziroeda/pcbnew/footprint_editor_settings.js';

const json = (aFill: boolean) => ({
  pcb_display: {
    graphics_fill: aFill,
    text_fill: aFill,
    pad_fill: aFill,
    pad_numbers: aFill,
  },
});

describe('pcb_display.* in fpedit.json', () => {
  it('opens on what upstream defaults every one of them to: true', () => {
    const v = new FOOTPRINT_EDITOR_SETTINGS().m_ViewersDisplay;

    expect([
      v.m_DisplayGraphicsFill,
      v.m_DisplayTextFill,
      v.m_DisplayPadFill,
      v.m_DisplayPadNumbers,
    ]).toEqual([true, true, true, true]);
  });

  it('loads each key into its own option', () => {
    const s = new FOOTPRINT_EDITOR_SETTINGS();
    // Every key off its default but one, so a key not read - or read into another - shows.
    const stored = json(false);
    stored.pcb_display.text_fill = true;

    loadFpEditViewersDisplay(s, stored);

    const v = s.m_ViewersDisplay;
    expect([
      v.m_DisplayGraphicsFill,
      v.m_DisplayTextFill,
      v.m_DisplayPadFill,
      v.m_DisplayPadNumbers,
    ]).toEqual([false, true, false, false]);
  });

  it('stores each option into its own key', () => {
    const s = new FOOTPRINT_EDITOR_SETTINGS();
    s.m_ViewersDisplay.m_DisplayGraphicsFill = false;
    s.m_ViewersDisplay.m_DisplayPadFill = false;
    const out = json(true);

    storeFpEditViewersDisplay(s, out);

    expect(out.pcb_display).toEqual({
      graphics_fill: false,
      text_fill: true,
      pad_fill: false,
      pad_numbers: true,
    });
  });
});

describe('the Footprint Editor window', () => {
  const UI = readFileSync(
    fileURLToPath(new URL('../../../pcbnew/footprint_edit_frame_ui.tsx', import.meta.url)),
    'utf8',
  );

  it('loads the settings object from fpedit.json when it builds the frame', () => {
    expect(UI).toMatch(
      /f\.SetFootprintLibAdapter\(store\);[\s\S]{0,300}loadFpEditSettings\(fpEditKifaceSettings\(\), app\.fpEdit\(\)\);\s*return f;/,
    );
  });

  it('reloads the settings object when a preference changes (JSON_SETTINGS::Load)', () => {
    // GetColorSettings reads m_ColorTheme, so a theme chosen on the Colors page must reach it.
    expect(UI).toMatch(
      /useEffect\(\(\) => \{\s*loadFpEditSettings\(fpEditKifaceSettings\(\), fpCfg\);\s*\}, \[fpCfg\]\);/,
    );
  });

  it('writes the settings back after each of the three toggles', () => {
    expect(UI).toMatch(
      /if \(id === 'padDisplayMode' \|\| id === 'graphicsOutlines' \|\| id === 'textOutlines'\) \{\s*app\.updateFpEdit\(\(s\) => storeFpEditViewersDisplay\(fpEditKifaceSettings\(\), s\)\);/,
    );
  });
});
