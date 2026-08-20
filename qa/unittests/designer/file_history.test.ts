// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * FILE_HISTORY (common/file_history.cpp) and the two EDA_BASE_FRAME methods
 * that drive it, against the shared port in designer/src/ui/file_history.ts.
 *
 * Exercised through the module's public surface and through the real menu
 * builder (`buildManagerMenus`), not through a private helper: a test that
 * pokes an internal function survives mutations the user would notice.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_FILE_HISTORY_SIZE,
  FileHistory,
  MAX_FILE_HISTORY_SIZE,
  NO_FILES_LABEL,
  openRecentMenuItem,
  type FileHistoryStorage,
} from '@ziroeda/designer/src/ui/file_history.js';
import { buildManagerMenus } from '@ziroeda/designer/src/home/menubar.js';
import type { ProjectMeta } from '@ziroeda/designer/src/home/projectStore.js';
import type { MenuItem } from '@ziroeda/designer/src/ui/menu_types.js';

/** An in-memory Storage, so no test touches the real localStorage. */
function fakeStorage(seed?: Record<string, string>): FileHistoryStorage {
  const map = new Map(Object.entries(seed ?? {}));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

function history(opts: { maxFiles?: number; seed?: Record<string, string> } = {}): FileHistory {
  return new FileHistory({
    storageKey: 'k',
    storage: fakeStorage(opts.seed),
    maxFiles: opts.maxFiles,
  });
}

const names = (h: FileHistory): string[] => h.getFiles().map((f) => f.name);

describe('the default history size', () => {
  it('is 9, the COMMON_SETTINGS default, not 5', () => {
    // common/settings/common_settings.cpp:351-352
    //   m_params.emplace_back( new PARAM<int>( "system.file_history_size",
    //           &m_System.file_history_size, 9 ) );
    // All three of our stores hardcoded 5, so the fourth-oldest through the
    // ninth-oldest file simply never appeared in Open Recent.
    expect(DEFAULT_FILE_HISTORY_SIZE).toBe(9);
  });

  it('keeps nine files, and drops the tenth-oldest', () => {
    const h = history();
    for (let i = 1; i <= 12; i++) h.addFileToHistory({ name: `f${i}` });

    expect(h.getCount()).toBe(9);
    // Newest first, so f12 leads and f1..f3 have fallen off the end.
    expect(names(h)).toEqual(['f12', 'f11', 'f10', 'f9', 'f8', 'f7', 'f6', 'f5', 'f4']);
  });

  it('is a user setting, taken from system.file_history_size', () => {
    // EDA_BASE_FRAME::LoadSettings (eda_base_frame.cpp:1282-1286) builds the
    // FILE_HISTORY from the preference rather than from a constant.
    const h = history({ maxFiles: 3 });
    for (let i = 1; i <= 5; i++) h.addFileToHistory({ name: `f${i}` });
    expect(names(h)).toEqual(['f5', 'f4', 'f3']);
  });

  it('clamps to MAX_FILE_HISTORY_SIZE however large the preference is', () => {
    // FILE_HISTORY::FILE_HISTORY: std::min( aMaxFiles, MAX_FILE_HISTORY_SIZE ),
    // with MAX_FILE_HISTORY_SIZE 99 (include/id.h:50).
    expect(MAX_FILE_HISTORY_SIZE).toBe(99);
    expect(history({ maxFiles: 5000 }).getMaxFiles()).toBe(99);
  });

  it('floors the constructor at 1, as std::max( 1, fileHistorySize ) does', () => {
    // eda_base_frame.cpp:1285. Zero is legal on the *update* path only.
    expect(history({ maxFiles: 0 }).getMaxFiles()).toBe(1);
  });

  it('trims the existing list when the preference shrinks', () => {
    // FILE_HISTORY::SetMaxFiles (file_history.cpp:84-93) removes files that no
    // longer fit, rather than only capping later additions. Called from
    // EDA_BASE_FRAME::CommonSettingsChanged (:975-979).
    const h = history();
    for (let i = 1; i <= 9; i++) h.addFileToHistory({ name: `f${i}` });
    h.setMaxFiles(2);
    expect(names(h)).toEqual(['f9', 'f8']);
  });
});

describe('adding a file', () => {
  it('puts the newest at the front', () => {
    const h = history();
    h.addFileToHistory({ name: 'a' });
    h.addFileToHistory({ name: 'b' });
    expect(names(h)).toEqual(['b', 'a']);
  });

  it('promotes a file already in the list instead of appending it', () => {
    // wxFileHistory::AddFileToHistory searches the list, RemoveFileFromHistory's
    // the match, and *then* inserts at the front. Re-opening the third-most
    // recent file moves it to the top.
    const h = history();
    for (const name of ['a', 'b', 'c']) h.addFileToHistory({ name });
    h.addFileToHistory({ name: 'a' });

    expect(names(h)).toEqual(['a', 'c', 'b']);
  });

  it('does not leave a second copy of a promoted file behind', () => {
    const h = history();
    for (const name of ['a', 'b', 'c']) h.addFileToHistory({ name });
    h.addFileToHistory({ name: 'b' });

    expect(h.getCount()).toBe(3);
    expect(names(h).filter((n) => n === 'b')).toHaveLength(1);
  });

  it('promotion refreshes the payload, not just the position', () => {
    // The row we insert is the new entry, not the one already stored - a
    // re-opened drawing sheet carries its current text, not the old text.
    const h = new FileHistory<{ name: string; text: string }>({
      storageKey: 'k',
      storage: fakeStorage(),
    });
    h.addFileToHistory({ name: 'sheet.kicad_wks', text: 'old' });
    h.addFileToHistory({ name: 'sheet.kicad_wks', text: 'new' });

    expect(h.getFiles()).toEqual([{ name: 'sheet.kicad_wks', text: 'new' }]);
  });

  it('dedupes on the caller-supplied key when rows are not identified by name', () => {
    // wxFileHistory compares wxFileNames, not label strings; the project
    // manager's identity is the project id.
    const h = new FileHistory<{ name: string; id: string }>({
      storageKey: 'k',
      storage: fakeStorage(),
      keyOf: (e) => e.id,
    });
    h.addFileToHistory({ name: 'Blinky', id: '1' });
    h.addFileToHistory({ name: 'Blinky (renamed)', id: '1' });

    expect(h.getFiles()).toEqual([{ name: 'Blinky (renamed)', id: '1' }]);
  });
});

describe('persistence', () => {
  it('survives a reload, newest first', () => {
    const storage = fakeStorage();
    const first = new FileHistory({ storageKey: 'k', storage });
    first.addFileToHistory({ name: 'a' });
    first.addFileToHistory({ name: 'b' });

    expect(new FileHistory({ storageKey: 'k', storage }).getFiles().map((f) => f.name)).toEqual([
      'b',
      'a',
    ]);
  });

  it('trims a stored list written under a larger cap', () => {
    const seed = { k: JSON.stringify([1, 2, 3, 4, 5].map((i) => ({ name: `f${i}` }))) };
    expect(names(history({ maxFiles: 2, seed }))).toEqual(['f1', 'f2']);
  });

  it('ignores a corrupt stored value rather than throwing', () => {
    expect(names(history({ seed: { k: 'not json' } }))).toEqual([]);
    expect(names(history({ seed: { k: '{"not":"an array"}' } }))).toEqual([]);
  });

  it('clearFileHistory empties both the list and the store', () => {
    const storage = fakeStorage();
    const h = new FileHistory({ storageKey: 'k', storage });
    h.addFileToHistory({ name: 'a' });
    h.clearFileHistory();

    expect(h.getCount()).toBe(0);
    expect(new FileHistory({ storageKey: 'k', storage }).getCount()).toBe(0);
  });
});

describe('opening a row whose file is gone', () => {
  // EDA_BASE_FRAME::GetFileFromHistory (eda_base_frame.cpp:1486-1523).
  const gone = (h: FileHistory, confirmRemove: (e: { name: string }) => boolean) =>
    h.getFileFromHistory(0, { exists: () => false, confirmRemove });

  it('returns the entry untouched when the file is still there', () => {
    const h = history();
    h.addFileToHistory({ name: 'a' });
    expect(h.getFileFromHistory(0, { exists: () => true, confirmRemove: () => true })).toEqual({
      name: 'a',
    });
  });

  it('asks before removing the row', () => {
    const h = history();
    h.addFileToHistory({ name: 'a' });
    const confirm = vi.fn(() => true);
    gone(h, confirm);

    expect(confirm).toHaveBeenCalledWith({ name: 'a' });
  });

  it('drops the row on Remove', () => {
    const h = history();
    h.addFileToHistory({ name: 'a' });
    h.addFileToHistory({ name: 'b' });
    gone(h, () => true);

    expect(names(h)).toEqual(['a']);
  });

  it('keeps the row on Keep', () => {
    const h = history();
    h.addFileToHistory({ name: 'a' });
    gone(h, () => false);

    expect(names(h)).toEqual(['a']);
  });

  it('opens nothing either way - fn.Clear() runs whichever button was pressed', () => {
    const remove = history();
    remove.addFileToHistory({ name: 'a' });
    expect(gone(remove, () => true)).toBeNull();

    const keep = history();
    keep.addFileToHistory({ name: 'a' });
    expect(gone(keep, () => false)).toBeNull();
  });

  it('returns null past the end of the list without asking', () => {
    const h = history();
    const confirm = vi.fn(() => true);
    expect(h.getFileFromHistory(4, { exists: () => false, confirmRemove: confirm })).toBeNull();
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe('the Open Recent submenu', () => {
  const item = (files: { name: string }[], clearText?: string): MenuItem =>
    openRecentMenuItem({ files, onOpen: () => {}, onClear: () => {}, clearText });

  it('is greyed out when the history is empty', () => {
    // FILE_HISTORY::FileHistoryNotEmpty (file_history.cpp:183-192) is registered
    // against the "Open Recent" item's own id, so an empty history disables the
    // parent row. This is Image Converter finding C3.
    expect(item([]).disabled).toBe(true);
  });

  it('is live as soon as there is one file', () => {
    expect(item([{ name: 'a' }]).disabled).toBeFalsy();
  });

  it('carries the recent icon, as SetIcon( BITMAPS::recent ) does', () => {
    expect(item([{ name: 'a' }]).icon).toBe('recent');
  });

  it('lists the files, then a separator, then the clear item', () => {
    // doAddClearItem (file_history.cpp:147-162): AppendSeparator() then the
    // clear item, always last.
    expect(item([{ name: 'a' }, { name: 'b' }]).submenu).toEqual([
      { label: 'a', action: expect.any(Function) },
      { label: 'b', action: expect.any(Function) },
      { sep: true },
      { label: 'Clear Recent Files', action: expect.any(Function) },
    ]);
  });

  it('places the disabled "No Files" placeholder when empty, not "(empty)"', () => {
    // ID_FILE_LIST_EMPTY's label is _( "No Files" ) (file_history.cpp:151).
    // It is unreachable in practice because the parent is disabled, but it is
    // what the menu holds; "(empty)" was ours.
    expect(NO_FILES_LABEL).toBe('No Files');
    expect(item([]).submenu?.[0]).toEqual({ label: 'No Files', disabled: true });
  });

  it('keeps the clear item reachable in the structure even when empty', () => {
    expect(item([]).submenu?.map((i) => i.label ?? '(sep)')).toEqual([
      'No Files',
      '(sep)',
      'Clear Recent Files',
    ]);
  });

  it('lets a frame override m_clearText', () => {
    // kicad/menubar.cpp:64 SetClearText( _( "Clear Recent Projects" ) ).
    expect(item([{ name: 'a' }], 'Clear Recent Projects').submenu?.at(-1)?.label).toBe(
      'Clear Recent Projects',
    );
  });

  it('opens the row that was clicked, by index', () => {
    const onOpen = vi.fn();
    const menu = openRecentMenuItem({
      files: [{ name: 'a' }, { name: 'b' }, { name: 'c' }],
      onOpen,
      onClear: () => {},
    });
    menu.submenu?.[1]?.action?.();

    expect(onOpen).toHaveBeenCalledWith(1);
  });
});

// ---- the same behaviours through the real menu builder -------------------------

const noop = (): void => undefined;
const managerHandlers = {
  newProject: noop,
  openProject: noop,
  selectProjectFiles: noop,
  openRecent: noop,
  clearRecent: noop,
  language: 'Default',
  setLanguage: noop,
  closeProject: noop,
  restoreLocalHistory: noop,
  hasLocalHistory: false,
  saveAs: noop,
  archiveProject: noop,
  unarchiveProject: noop,
  refresh: noop,
  toggleLocalHistory: noop,
  localHistoryShown: false,
  openTextViewer: noop,
  editSchematic: noop,
  editSymbols: noop,
  editPcb: noop,
  editFootprints: noop,
  openImageConverter: noop,
  openGerberViewer: noop,
  openCalculator: noop,
  openDrawingSheetEditor: noop,
  openPreferences: noop,
  showAbout: noop,
  showHotkeys: noop,
  openDemo: noop,
  hasProject: true,
  hasTextFileSelected: true,
  recent: [] as ProjectMeta[],
  demos: [],
};

const project = (i: number): ProjectMeta => ({
  id: `p${i}`,
  name: `Project ${i}`,
  createdAt: 0,
  updatedAt: 0,
  fileCount: 1,
  bytes: 0,
});

const managerOpenRecent = (over: Partial<typeof managerHandlers> = {}): MenuItem => {
  const file = buildManagerMenus({ ...managerHandlers, ...over }).find((m) => m.label === 'File');
  const item = file?.items.find((i) => i.label === 'Open Recent');
  if (!item) throw new Error('the File menu has no Open Recent row');
  return item;
};

describe("the project manager's File menu", () => {
  it('greys Open Recent out with no projects, and shows no invented child row', () => {
    const item = managerOpenRecent({ recent: [] });
    expect(item.disabled).toBe(true);
    expect(item.submenu?.map((i) => i.label)).not.toContain('(no recent projects)');
  });

  it('enables Open Recent once a project has been opened', () => {
    expect(managerOpenRecent({ recent: [project(1)] }).disabled).toBeFalsy();
  });

  it('shows nine projects, not five and not all of them', () => {
    const recent = Array.from({ length: 20 }, (_, i) => project(i));
    const rows = managerOpenRecent({ recent }).submenu ?? [];
    // Nine rows plus the separator and the clear item.
    expect(rows.filter((r) => !r.sep && r.label !== 'Clear Recent Projects')).toHaveLength(9);
  });

  it('keeps kicad/menubar.cpp:64’s "Clear Recent Projects" wording', () => {
    expect(managerOpenRecent({ recent: [project(1)] }).submenu?.at(-1)?.label).toBe(
      'Clear Recent Projects',
    );
  });

  it('opens the project the clicked row names', () => {
    const openRecent = vi.fn();
    const item = managerOpenRecent({ recent: [project(1), project(2)], openRecent });
    item.submenu?.[1]?.action?.();

    expect(openRecent).toHaveBeenCalledWith('p2');
  });
});
