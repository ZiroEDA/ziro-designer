// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `GetAppSettings<EESCHEMA_SETTINGS>( "eeschema" )` (eeschema_settings.ts): one object, reloaded
 * from eeschema.json only when the file changed, and stored back on the frame's idle pass - so
 * what COMMON_TOOLS writes into it (ToggleGrid's grid.show) is kept and saved. It was reloaded on
 * every ask: Show Grid flipped the GAL and the object, the next ask put the file's value back,
 * the file never heard, and the canvas kept its grid until the app was reloaded.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  EESCHEMA_DEFAULTS,
  type EeschemaSettings,
  eeschemaKifaceSettings,
  setEeschemaSettingsProvider,
  setUpdateEeschemaSettingsProvider,
  storeEeschemaKifaceSettings,
} from '@ziroeda/eeschema/eeschema_settings.js';

let file: EeschemaSettings;

beforeEach(() => {
  file = structuredClone(EESCHEMA_DEFAULTS);
  file.window.grid.show = true;
  setEeschemaSettingsProvider(() => file);
  // The store replaces rather than mutates, as the app's does.
  setUpdateEeschemaSettingsProvider((mutate) => {
    const next = structuredClone(file);
    mutate(next);
    file = next;
  });
});

afterEach(() => {
  setEeschemaSettingsProvider(() => EESCHEMA_DEFAULTS);
  setUpdateEeschemaSettingsProvider(() => {});
});

describe('EESCHEMA_SETTINGS', () => {
  it('keeps what a tool wrote into it until the file changes', () => {
    eeschemaKifaceSettings().m_Window.grid.show = false;

    expect(eeschemaKifaceSettings().m_Window.grid.show).toBe(false);
  });

  it('stores what a tool wrote into eeschema.json, and only then', () => {
    const before = file;
    storeEeschemaKifaceSettings(eeschemaKifaceSettings());
    expect(file).toBe(before);

    eeschemaKifaceSettings().m_Window.grid.show = false;
    storeEeschemaKifaceSettings(eeschemaKifaceSettings());

    expect(file.window.grid.show).toBe(false);
  });

  it('reads a changed file again', () => {
    eeschemaKifaceSettings();
    const next = structuredClone(file);
    next.window.grid.show = false;
    file = next;

    expect(eeschemaKifaceSettings().m_Window.grid.show).toBe(false);
  });
});
