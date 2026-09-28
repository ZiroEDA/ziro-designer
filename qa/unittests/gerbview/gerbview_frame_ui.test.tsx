// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The Gerber Viewer's window (`gerbview/gerbview_frame_ui.tsx`), mounted with a
 * program of the test's own - the `GERBVIEW_APP` designer supplies in the app.
 * The GL window never arrives, so no WebGL is needed: everything checked here
 * is the frame's chrome and what it asks of the program.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { KIWAY } from '@ziroeda/common/kiway.js';
import { PGM_BASE, SetPgm } from '@ziroeda/common/pgm_base.js';
import type { DRAW_PANEL_GAL_WINDOW } from '@ziroeda/common/draw_panel_gal.js';
import { type GERBVIEW_APP, GerbviewFrameWindow } from '@ziroeda/gerbview/gerbview_frame_ui.js';
import { GERBVIEW_DEFAULTS } from '@ziroeda/gerbview/gerbview_settings.js';
import { afterEach, describe, expect, it } from 'vitest';

afterEach(() => {
  cleanup();
  SetPgm(null);
});

function makeApp(over: Partial<GERBVIEW_APP> = {}): { app: GERBVIEW_APP; calls: string[] } {
  const calls: string[] = [];
  let gerbview = structuredClone(GERBVIEW_DEFAULTS);
  let colors: Record<string, string> = {};
  const kiway = new KIWAY({
    OnKiCadExit: () => calls.push('exit'),
    Player: () => false,
    HasProjectManager: () => true,
    ShowProjectManager: () => calls.push('project manager'),
    CreateKiWindow: () => false,
  });
  const app: GERBVIEW_APP = {
    homeLink: <span data-testid="home" />,
    kiway,
    InitPgm: () => {
      const pgm = new PGM_BASE();
      SetPgm(pgm);
      return pgm;
    },
    gerbviewSettings: gerbview,
    GetGerbviewSettings: () => gerbview,
    UpdateGerbviewSettings: (fn) => {
      gerbview = structuredClone(gerbview);
      fn(gerbview);
    },
    userColors: colors,
    GetUserColors: () => colors,
    SetUserColors: (c) => {
      colors = c;
    },
    language: 'Default',
    SetLanguage: (l) => calls.push(`language ${l}`),
    FileDialog: () => Promise.resolve(null),
    Preferences: (page, parent) => <div data-testid="prefs">{`${page}|${parent}`}</div>,
    // The GL window never comes: the canvas stays a bare element.
    DrawPanelWindow: () => new Promise<DRAW_PANEL_GAL_WINDOW>(() => {}),
    toolbars: { top: [], aux: [], left: [] },
    ...over,
  };
  return { app, calls };
}

/** The top-level menu, opened, and the row with that label picked. */
function pick(aMenu: string, aRow: string): void {
  fireEvent.mouseDown(screen.getByText(aMenu));
  fireEvent.click(screen.getByText(aRow));
}

describe('the Gerber Viewer window', () => {
  it('draws the program overlay inside the frame, where the theme reaches it', () => {
    const { app } = makeApp();
    const { container } = render(
      <GerbviewFrameWindow
        app={app}
        overlay={<div data-testid="chooser" />}
        onExitToHome={() => {}}
      />,
    );
    const root = container.querySelector('.ze-app');
    expect(root).not.toBeNull();
    expect(root!.contains(screen.getByTestId('chooser'))).toBe(true);
  });

  it('puts the program home link at the left of the menu bar', () => {
    const { app } = makeApp();
    render(<GerbviewFrameWindow app={app} onExitToHome={() => {}} />);
    expect(screen.getByTestId('home')).toBeTruthy();
  });
});
