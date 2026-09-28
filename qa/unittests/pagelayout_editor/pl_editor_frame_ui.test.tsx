// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The Drawing Sheet Editor's window (`pagelayout_editor/pl_editor_frame_ui.tsx`),
 * mounted with a program of the test's own - the `PL_EDITOR_APP` designer
 * supplies in the app. The GL window never arrives, so no WebGL is needed.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { GetClipboardUTF8, SaveClipboard } from '@ziroeda/common/clipboard.js';
import { DS_DATA_MODEL } from '@ziroeda/common/drawing_sheet/ds_data_model.js';
import type { DRAW_PANEL_GAL_WINDOW } from '@ziroeda/common/draw_panel_gal.js';
import { KIWAY } from '@ziroeda/common/kiway.js';
import { PGM_BASE, SetPgm } from '@ziroeda/common/pgm_base.js';
import { COLOR_SETTINGS } from '@ziroeda/common/settings/color_settings.js';
import {
  type PL_EDITOR_APP,
  PlEditorFrameWindow,
} from '@ziroeda/pagelayout_editor/pl_editor_frame_ui.js';
import { PL_EDITOR_DEFAULTS } from '@ziroeda/pagelayout_editor/pl_editor_settings.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

beforeEach(() => {
  DS_DATA_MODEL.SetAltInstance(new DS_DATA_MODEL());
});

afterEach(() => {
  cleanup();
  DS_DATA_MODEL.SetAltInstance(null);
  SetPgm(null);
});

function makeApp(): PL_EDITOR_APP {
  let pl = structuredClone(PL_EDITOR_DEFAULTS);
  const kiway = new KIWAY({
    OnKiCadExit: () => {},
    Player: () => false,
    HasProjectManager: () => true,
    ShowProjectManager: () => {},
    CreateKiWindow: () => false,
  });
  return {
    homeLink: <span data-testid="home" />,
    kiway,
    InitPgm: () => {
      const pgm = new PGM_BASE();
      SetPgm(pgm);
      return pgm;
    },
    plEditorSettings: pl,
    GetPlEditorSettings: () => pl,
    UpdatePlEditorSettings: (fn) => {
      pl = structuredClone(pl);
      fn(pl);
    },
    ColorSettings: (id) => new COLOR_SETTINGS(id),
    colorsVersion: 0,
    fileHistorySize: 9,
    language: 'Default',
    SetLanguage: () => {},
    OpenFileDialog: () => Promise.resolve(null),
    SaveFileDialog: () => Promise.resolve(null),
    WriteFile: () => {},
    Preferences: () => null,
    // The GL window never comes: the canvas stays a bare element.
    DrawPanelWindow: () => new Promise<DRAW_PANEL_GAL_WINDOW>(() => {}),
    toolbars: { top: [], left: [], right: [] },
  };
}

describe('the Drawing Sheet Editor window', () => {
  it('draws the program overlay inside the frame, where the theme reaches it', () => {
    const { container } = render(
      <PlEditorFrameWindow
        app={makeApp()}
        overlay={<div data-testid="chooser" />}
        onExitToHome={() => {}}
      />,
    );
    const root = container.querySelector('.ze-app.ze-wks');
    expect(root).not.toBeNull();
    expect(root!.contains(screen.getByTestId('chooser'))).toBe(true);
  });

  it('a system paste event becomes wxTheClipboard (ACTIONS::paste then reads it)', async () => {
    render(<PlEditorFrameWindow app={makeApp()} onExitToHome={() => {}} />);
    SaveClipboard('copied here');

    const e = new Event('paste', { cancelable: true });
    Object.defineProperty(e, 'clipboardData', {
      value: { types: ['text/plain'], getData: () => 'from the system', items: [] },
    });
    window.dispatchEvent(e);

    expect(e.defaultPrevented).toBe(true);
    await waitFor(() => expect(GetClipboardUTF8()).toBe('from the system'));
  });

  it('puts the program home link at the left of the menu bar', () => {
    render(<PlEditorFrameWindow app={makeApp()} onExitToHome={() => {}} />);
    expect(screen.getByTestId('home')).toBeTruthy();
  });
});
