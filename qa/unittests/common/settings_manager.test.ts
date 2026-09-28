// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * SETTINGS_MANAGER's file half (settings_manager.cpp registerSettings / Load /
 * Save / FlushAndRelease) over a SETTINGS_STORE, and KICAD_SETTINGS' params.
 */
import { describe, expect, it } from 'vitest';
import { KICAD_SETTINGS } from '@ziroeda/common/settings/kicad_settings.js';
import {
  SETTINGS_MANAGER,
  type SETTINGS_STORE,
} from '@ziroeda/common/settings/settings_manager.js';
import { PGM_BASE, SETTINGS_MANAGER as FROM_PGM } from '@ziroeda/common/pgm_base.js';

function memoryStore(): SETTINGS_STORE & { files: Map<string, unknown> } {
  const files = new Map<string, unknown>();
  return {
    files,
    Read: (name) => files.get(name),
    Write: (name, value) => {
      files.set(name, structuredClone(value));
    },
  };
}

describe('SETTINGS_MANAGER files', () => {
  it('loads a registered file from the store, and saves it back', () => {
    const store = memoryStore();
    store.files.set('kicad', { appearance: { left_frame_width: 321 } });
    const m = new SETTINGS_MANAGER();
    m.SetStore(store);

    const k = m.RegisterSettings(new KICAD_SETTINGS());
    expect(k.m_LeftWinWidth).toBe(321);
    // A path the file lacks is its PARAM default.
    expect(k.m_ShowHistoryPanel).toBe(false);

    k.m_ShowHistoryPanel = true;
    m.Save(k);
    const saved = store.files.get('kicad') as {
      aui: { show_history_panel: boolean };
      appearance: { left_frame_width: number };
    };
    expect(saved.aui.show_history_panel).toBe(true);
    expect(saved.appearance.left_frame_width).toBe(321);
  });

  it('does not load a file registered with aLoadNow false', () => {
    const store = memoryStore();
    store.files.set('kicad', { appearance: { left_frame_width: 321 } });
    const m = new SETTINGS_MANAGER();
    m.SetStore(store);
    const k = m.RegisterSettings(new KICAD_SETTINGS(), false);
    expect(k.m_LeftWinWidth).toBe(200);
    m.Load(k);
    expect(k.m_LeftWinWidth).toBe(321);
  });

  it('hands a JSON_SETTINGS file out by name, and a named view before it', () => {
    const m = new SETTINGS_MANAGER();
    const k = m.RegisterSettings(new KICAD_SETTINGS());
    expect(m.GetAppSettings<KICAD_SETTINGS>('kicad')).toBe(k);
    expect(m.GetAppSettings('pcbnew')).toBeNull();
    const view = { m_Display: {} };
    m.RegisterSettings('pcbnew', view);
    expect(m.GetAppSettings('pcbnew')).toBe(view);
  });

  it('FlushAndRelease saves and forgets the file', () => {
    const store = memoryStore();
    const m = new SETTINGS_MANAGER();
    m.SetStore(store);
    const k = m.RegisterSettings(new KICAD_SETTINGS());
    k.m_TemplateFilterChoice = 2;
    m.FlushAndRelease(k);
    expect((store.files.get('kicad') as { template: { filter: number } }).template.filter).toBe(2);
    expect(m.GetAppSettings('kicad')).toBeNull();
    // Released: a later Save() no longer writes it.
    store.files.clear();
    m.Save();
    expect(store.files.has('kicad')).toBe(false);
  });

  it('is the object pgm_base re-exports, and PGM_BASE adopts one it is given', () => {
    expect(FROM_PGM).toBe(SETTINGS_MANAGER);
    const m = new SETTINGS_MANAGER();
    expect(new PGM_BASE(null, m).GetSettingsManager()).toBe(m);
  });
});

describe('KICAD_SETTINGS', () => {
  it('stores the template window size as aui_settings writes a wxSize', () => {
    const k = new KICAD_SETTINGS();
    k.LoadFromJson({});
    expect(k.m_TemplateWindowSize).toEqual({ x: -1, y: -1 });
    k.m_TemplateWindowSize = { x: 640, y: 480 };
    const js = k.SaveToJson() as { template: { window: { size: unknown; pos: unknown } } };
    expect(js.template.window.size).toEqual({ width: 640, height: 480 });
    expect(js.template.window.pos).toEqual({ x: -1, y: -1 });

    const back = new KICAD_SETTINGS();
    back.LoadFromJson(k.SaveToJson());
    expect(back.m_TemplateWindowSize).toEqual({ x: 640, y: 480 });
  });

  it('skips an unreadable size rather than failing the file', () => {
    const k = new KICAD_SETTINGS();
    k.LoadFromJson({ template: { window: { size: { w: 1 } }, filter: 3 } });
    expect(k.m_TemplateWindowSize).toEqual({ x: -1, y: -1 });
    expect(k.m_TemplateFilterChoice).toBe(3);
  });
});
