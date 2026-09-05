// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * "Open Theme Folder" — `m_btnOpenFolder`, whose handler is
 * `LaunchExternal( SETTINGS_MANAGER::GetColorSettingsPath() )`
 * (`common/dialogs/panel_color_settings.cpp:65-69`).
 *
 * The button was drawn and permanently disabled, which is the state the project
 * reserves for a control it intends to build. A tab cannot start the desktop's
 * file manager and there is no directory behind this app to start it on, so what
 * is built is the folder's PURPOSE: the theme files it holds, out of the app and
 * back into it. These tests pin that the button is live, that Export hands over
 * the bytes KiCad would have written, and that Import refuses anything that is
 * not a theme instead of half-loading it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ThemeFolderDialog } from '@ziroeda/designer/src/dialogs/prefs/dialog_theme_folder.js';
import type { ThemeFile } from '@ziroeda/designer/src/dialogs/prefs/dialog_theme_folder.js';
import { PanelEeschemaColorSettings } from '@ziroeda/designer/src/editors/schematic/prefs/PanelEeschemaColorSettings.js';
import { EESCHEMA_DEFAULTS } from '@ziroeda/designer/src/prefs/settings.js';
import type { EeschemaSettings } from '@ziroeda/designer/src/prefs/settings.js';
import type { PrefsContext } from '@ziroeda/designer/src/dialogs/prefs/types.js';

afterEach(cleanup);

const KICAD_TEXT = readFileSync(
  resolve(process.cwd(), 'data/settings/kicad_10_0_5_default_theme.json'),
  'utf8',
);

const FILES: readonly ThemeFile[] = [
  {
    fileName: 'user.json',
    name: 'User',
    contents: { name: 'User', colors: { LAYER_WIRE: 'rgb(1, 2, 3)' }, override: true },
    writable: true,
  },
  {
    fileName: 'com.example.midnight.json',
    name: 'Midnight',
    contents: { name: 'Midnight', colors: {}, override: false },
    writable: false,
  },
];

/** Captures what a download would have carried. */
function catchDownload(): { blobs: Blob[]; restore: () => void } {
  const blobs: Blob[] = [];
  const create = URL.createObjectURL;
  const revoke = URL.revokeObjectURL;
  URL.createObjectURL = ((b: Blob) => {
    blobs.push(b);
    return 'blob:test';
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL;
  return {
    blobs,
    restore: () => {
      URL.createObjectURL = create;
      URL.revokeObjectURL = revoke;
    },
  };
}

describe('the folder lists the theme files this app has', () => {
  it('shows one row per file, with the name a real folder would show', () => {
    render(<ThemeFolderDialog files={FILES} onImport={() => {}} onClose={() => {}} />);
    expect(screen.getByText('user.json')).toBeTruthy();
    expect(screen.getByText('com.example.midnight.json')).toBeTruthy();
  });

  /**
   * `GetSettingsDropdownName` appends " (read-only)" to a theme whose file
   * cannot be written (`panel_color_settings.cpp:391-398`); a PCM-installed
   * theme is one of those, and only the writable theme can take an import.
   */
  it('marks the ones that cannot be written', () => {
    render(<ThemeFolderDialog files={FILES} onImport={() => {}} onClose={() => {}} />);
    expect(screen.getByText('Midnight (read-only)')).toBeTruthy();
    expect(screen.getByText('User')).toBeTruthy();
  });
});

describe('Export writes the file KiCad would have written', () => {
  it('hands over a theme file naming that theme, with its colours in it', async () => {
    const caught = catchDownload();
    try {
      render(<ThemeFolderDialog files={FILES} onImport={() => {}} onClose={() => {}} />);
      const exports = screen.getAllByText('Export');
      fireEvent.click(exports[0] as HTMLElement);
      expect(caught.blobs).toHaveLength(1);
      const written = JSON.parse(await (caught.blobs[0] as Blob).text()) as {
        meta: { name: string };
        schematic: Record<string, unknown>;
      };
      expect(written.meta.name).toBe('User');
      // The one colour that row's theme actually carries, and the flag.
      expect(written.schematic.wire).toBe('rgb(1, 2, 3)');
      expect(written.schematic.override_item_colors).toBe(true);
      // …and every other layer, because `Store()` writes them all.
      expect(Object.keys(written.schematic)).toHaveLength(48);
    } finally {
      caught.restore();
    }
  });

  it('exports the row that was clicked, not the first one', () => {
    const caught = catchDownload();
    try {
      render(<ThemeFolderDialog files={FILES} onImport={() => {}} onClose={() => {}} />);
      const exports = screen.getAllByText('Export');
      fireEvent.click(exports[1] as HTMLElement);
      expect(caught.blobs).toHaveLength(1);
    } finally {
      caught.restore();
    }
  });
});

describe('Import reads a KiCad theme file back', () => {
  const pick = (name: string, text: string): void => {
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([text], name, { type: 'application/json' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);
  };

  it('accepts the file a 10.0.5 install wrote', async () => {
    const seen = vi.fn();
    render(<ThemeFolderDialog files={FILES} onImport={seen} onClose={() => {}} />);
    pick('user.json', KICAD_TEXT);
    await waitFor(() => expect(seen).toHaveBeenCalledTimes(1));
    const contents = seen.mock.calls[0]?.[0] as { name: string; colors: Record<string, string> };
    expect(contents.name).toBe('KiCad Default');
    expect(contents.colors.LAYER_WIRE).toBe('rgb(0, 150, 0)');
  });

  it('closes once it has taken one, the way a modal that did its job does', async () => {
    const closed = vi.fn();
    render(<ThemeFolderDialog files={FILES} onImport={() => {}} onClose={closed} />);
    pick('user.json', KICAD_TEXT);
    await waitFor(() => expect(closed).toHaveBeenCalled());
  });

  it('says so and imports nothing when the file is not JSON', async () => {
    const seen = vi.fn();
    render(<ThemeFolderDialog files={FILES} onImport={seen} onClose={() => {}} />);
    pick('notes.txt', 'this is not json');
    await waitFor(() => expect(screen.getByText(/is not a JSON file/)).toBeTruthy());
    expect(seen).not.toHaveBeenCalled();
  });

  it('says so and imports nothing when the JSON is not a theme', async () => {
    const seen = vi.fn();
    render(<ThemeFolderDialog files={FILES} onImport={seen} onClose={() => {}} />);
    pick('board.json', '{"board":{"anchor":"rgb(0, 0, 0)"}}');
    await waitFor(() => expect(screen.getByText(/not a color theme/)).toBeTruthy());
    expect(seen).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------- the button -- */

function ctxFor(
  eeschema: EeschemaSettings,
  upE: (fn: (s: EeschemaSettings) => void) => void,
  setUserColors: (fn: (c: Record<string, string>) => Record<string, string>) => void = () => {},
): PrefsContext {
  return { eeschema, upE, userColors: {}, setUserColors } as unknown as PrefsContext;
}

describe('the button on the Colors page', () => {
  const settings = (): EeschemaSettings => {
    const s = structuredClone(EESCHEMA_DEFAULTS);
    s.appearance.color_theme = 'user';
    return s;
  };

  it('is no longer dead', () => {
    render(<PanelEeschemaColorSettings ctx={ctxFor(settings(), () => {})} />);
    const btn = screen.getByText('Open Theme Folder') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it('opens the folder, which lists the writable theme', () => {
    render(<PanelEeschemaColorSettings ctx={ctxFor(settings(), () => {})} />);
    expect(screen.queryByText('user.json')).toBeNull();
    fireEvent.click(screen.getByText('Open Theme Folder'));
    expect(screen.getByText('user.json')).toBeTruthy();
  });

  it('loads an imported file into the writable theme and selects it', async () => {
    const s = settings();
    s.appearance.color_theme = '_builtin_classic';
    let colors: Record<string, string> = {};
    render(
      <PanelEeschemaColorSettings
        ctx={ctxFor(
          s,
          (fn) => fn(s),
          (fn) => {
            colors = fn(colors);
          },
        )}
      />,
    );
    fireEvent.click(screen.getByText('Open Theme Folder'));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([KICAD_TEXT], 'user.json', { type: 'application/json' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);

    await waitFor(() => expect(s.appearance.color_theme).toBe('user'));
    // The file's own wire colour, on our painter's key for LAYER_WIRE.
    expect(colors.wire).toBe('rgb(0, 150, 0)');
  });
});
