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
 * reserves for a control it intends to build. It opens a folder, and a page CAN
 * open a folder: `showDirectoryPicker` is the desktop's own chooser, and this
 * app already opens a project with it. Point it at
 * `~/.config/kicad/10.0/colors` and it is KiCad's theme folder, read and
 * written back.
 *
 * What a page cannot start is the file MANAGER, so the folder's contents are
 * listed here instead of in Files. Everything below is about that: the folder's
 * own themes are loadable, ours are writable into it, and a browser with no
 * picker still gets a download and an upload.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ThemeFolderDialog } from '@ziroeda/designer/src/dialogs/prefs/dialog_theme_folder.js';
import type { ThemeFile } from '@ziroeda/designer/src/dialogs/prefs/dialog_theme_folder.js';
import { PanelEeschemaColorSettings } from '@ziroeda/designer/src/editors/schematic/prefs/PanelEeschemaColorSettings.js';
import {
  PICK_BLOCKED,
  PICK_CANCELLED,
  pickThemeFolder,
  readThemeFolder,
} from '@ziroeda/designer/src/fs/theme_folder.js';
import type { ThemeDirHandle } from '@ziroeda/designer/src/fs/theme_folder.js';
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
  return {
    eeschema,
    upE,
    userColors: {},
    setUserColors,
    userThemes: {},
    setUserThemes: () => {},
  } as unknown as PrefsContext;
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

  it('opens the folder, which lists the writable theme', async () => {
    render(<PanelEeschemaColorSettings ctx={ctxFor(settings(), () => {})} />);
    expect(screen.queryByText('user.json')).toBeNull();
    // The chooser is asked first, so the dialog appears a tick later even when
    // there is no chooser to ask.
    fireEvent.click(screen.getByText('Open Theme Folder'));
    await waitFor(() => expect(screen.getByText('user.json')).toBeTruthy());
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
    await waitFor(() => expect(document.querySelector('input[type="file"]')).toBeTruthy());
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([KICAD_TEXT], 'user.json', { type: 'application/json' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);

    await waitFor(() => expect(s.appearance.color_theme).toBe('user'));
    // The file's own wire colour, on our painter's key for LAYER_WIRE.
    expect(colors.wire).toBe('rgb(0, 150, 0)');
  });
});

/* ------------------------------------------------------- the real folder -- */

/** A `FileSystemDirectoryHandle` over a plain map, which is all the module uses. */
function fakeDir(
  name: string,
  initial: Record<string, string>,
): ThemeDirHandle & {
  written: Record<string, string>;
} {
  const written: Record<string, string> = { ...initial };
  return {
    name,
    written,
    values: async function* () {
      for (const [fileName, text] of Object.entries(written))
        yield {
          kind: 'file',
          name: fileName,
          getFile: async () => new File([text], fileName, { type: 'application/json' }),
        };
    },
    getFileHandle: async (fileName: string) => ({
      createWritable: async () => ({
        write: async (data: string) => {
          written[fileName] = data;
        },
        close: async () => {},
      }),
    }),
  };
}

const withPicker = async <T,>(
  impl: (() => Promise<unknown>) | undefined,
  body: () => Promise<T>,
): Promise<T> => {
  const g = globalThis as { showDirectoryPicker?: unknown };
  const had = Object.hasOwn(g, 'showDirectoryPicker');
  const prev = g.showDirectoryPicker;
  if (impl) g.showDirectoryPicker = impl;
  else delete g.showDirectoryPicker;
  try {
    return await body();
  } finally {
    if (had) g.showDirectoryPicker = prev;
    else delete g.showDirectoryPicker;
  }
};

describe('the picker is the desktop chooser, and its answers are the three that matter', () => {
  it('hands back the folder the user picked', async () => {
    const dir = fakeDir('colors', {});
    const got = await withPicker(
      async () => dir,
      () => pickThemeFolder(),
    );
    expect(got).toBe(dir);
  });

  /* `openProjectPicker`'s own branch: AbortError is the user closing the
     dialog, and closing a chooser you did not want must leave nothing behind. */
  it('reports a cancel apart from a refusal', async () => {
    const abort = async (): Promise<never> => {
      throw Object.assign(new Error('x'), { name: 'AbortError' });
    };
    expect(await withPicker(abort, () => pickThemeFolder())).toBe(PICK_CANCELLED);

    const blocked = async (): Promise<never> => {
      throw Object.assign(new Error('x'), { name: 'SecurityError' });
    };
    expect(await withPicker(blocked, () => pickThemeFolder())).toBe(PICK_BLOCKED);
  });

  it('reports a browser that has no picker at all', async () => {
    expect(await withPicker(undefined, () => pickThemeFolder())).toBe(PICK_BLOCKED);
  });

  it('asks for write permission in the same gesture', async () => {
    // Otherwise the first "Save to folder" raises a second prompt, between the
    // user and a button they already pressed.
    let opts: { mode?: string } | undefined;
    await withPicker(
      async (o?: { mode?: string }) => {
        opts = o;
        return fakeDir('colors', {});
      },
      () => pickThemeFolder(),
    );
    expect(opts?.mode).toBe('readwrite');
  });
});

describe('reading the folder', () => {
  it('finds the theme files and skips everything else', async () => {
    const dir = fakeDir('colors', {
      'user.json': KICAD_TEXT,
      'notes.txt': 'not json at all',
      'broken.json': '{ this is not json',
      'board.json': '{"board":{}}',
      // A perfectly good theme under a name the folder does not use. Without
      // this the extension test cannot fail: every other non-`.json` file here
      // is also unparseable, so dropping the extension check changes nothing.
      // `GetColorSettingsPath()` holds `<name>.json` and KiCad reads nothing
      // else out of it (`settings_manager.cpp` globs `*.json`).
      'user.json.bak': KICAD_TEXT,
    });
    const found = await readThemeFolder(dir);
    expect(found.map((f) => f.fileName)).toEqual(['user.json']);
    expect(found[0]?.contents.name).toBe('KiCad Default');
  });

  it('takes the extension case-insensitively, the way a filesystem hands it over', async () => {
    const dir = fakeDir('colors', { 'Midnight.JSON': KICAD_TEXT });
    expect((await readThemeFolder(dir)).map((f) => f.fileName)).toEqual(['Midnight.JSON']);
  });
});

describe('with a folder open', () => {
  const dirFiles = [
    { fileName: 'midnight.json', contents: { name: 'Midnight', colors: {}, override: false } },
  ];

  it('lists the folder in the title and its files in the list', () => {
    render(
      <ThemeFolderDialog
        files={FILES}
        folderName="colors"
        folderFiles={dirFiles}
        onWriteToFolder={async () => ''}
        onImport={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('Color Themes — colors')).toBeTruthy();
    expect(screen.getByText('midnight.json')).toBeTruthy();
  });

  it("loads one of the folder's files straight in", () => {
    const seen = vi.fn();
    render(
      <ThemeFolderDialog
        files={FILES}
        folderName="colors"
        folderFiles={dirFiles}
        onWriteToFolder={async () => ''}
        onImport={seen}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByText('Load'));
    expect(seen).toHaveBeenCalledWith(dirFiles[0]?.contents);
  });

  it('writes a theme into the folder instead of downloading it', async () => {
    const wrote: [string, string][] = [];
    const caught = catchDownload();
    try {
      render(
        <ThemeFolderDialog
          files={FILES}
          folderName="colors"
          folderFiles={[]}
          onWriteToFolder={async (n, t) => {
            wrote.push([n, t]);
            return '';
          }}
          onImport={() => {}}
          onClose={() => {}}
        />,
      );
      fireEvent.click(screen.getAllByText('Save to folder')[0] as HTMLElement);
      await waitFor(() => expect(wrote).toHaveLength(1));
      expect(wrote[0]?.[0]).toBe('user.json');
      expect(JSON.parse(wrote[0]?.[1] ?? '{}').schematic.wire).toBe('rgb(1, 2, 3)');
      // …and no download happened, which is the whole difference.
      expect(caught.blobs).toHaveLength(0);
    } finally {
      caught.restore();
    }
  });

  it('says so when the write is refused, rather than doing nothing visibly', async () => {
    render(
      <ThemeFolderDialog
        files={FILES}
        folderName="colors"
        folderFiles={[]}
        onWriteToFolder={async () => 'Could not write user.json: refused'}
        onImport={() => {}}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getAllByText('Save to folder')[0] as HTMLElement);
    await waitFor(() => expect(screen.getByText(/Could not write user.json/)).toBeTruthy());
  });
});

describe('with no folder, because the browser would not open one', () => {
  it('says why, and offers a download instead', () => {
    render(<ThemeFolderDialog files={FILES} onImport={() => {}} onClose={() => {}} />);
    expect(screen.getByText(/will not open a folder/)).toBeTruthy();
    expect(screen.getAllByText('Export').length).toBe(FILES.length);
    expect(screen.queryByText('Save to folder')).toBeNull();
  });
});

describe('the button opens the chooser, not just a dialog', () => {
  const settings2 = (): EeschemaSettings => {
    const s = structuredClone(EESCHEMA_DEFAULTS);
    s.appearance.color_theme = 'user';
    return s;
  };

  it('shows the picked folder and its themes', async () => {
    const dir = fakeDir('colors', { 'user.json': KICAD_TEXT });
    await withPicker(
      async () => dir,
      async () => {
        render(<PanelEeschemaColorSettings ctx={ctxFor(settings2(), () => {})} />);
        fireEvent.click(screen.getByText('Open Theme Folder'));
        await waitFor(() => expect(screen.getByText('Color Themes — colors')).toBeTruthy());
        expect(screen.getByText('KiCad Default')).toBeTruthy();
      },
    );
  });

  /* A cancel leaves nothing behind — the dialog must not open on it. */
  it('opens nothing when the chooser is cancelled', async () => {
    const abort = async (): Promise<never> => {
      throw Object.assign(new Error('x'), { name: 'AbortError' });
    };
    await withPicker(abort, async () => {
      render(<PanelEeschemaColorSettings ctx={ctxFor(settings2(), () => {})} />);
      fireEvent.click(screen.getByText('Open Theme Folder'));
      await new Promise((r) => setTimeout(r, 0));
      expect(screen.queryByText(/Color Themes/)).toBeNull();
    });
  });

  it('falls back to files when the browser has no picker', async () => {
    await withPicker(undefined, async () => {
      render(<PanelEeschemaColorSettings ctx={ctxFor(settings2(), () => {})} />);
      fireEvent.click(screen.getByText('Open Theme Folder'));
      await waitFor(() => expect(screen.getByText(/will not open a folder/)).toBeTruthy());
    });
  });
});
