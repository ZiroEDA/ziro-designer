// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * FILE_HISTORY (`common/file_history.cpp`, `include/file_history.h`), ported —
 * together with the two `EDA_BASE_FRAME` methods that drive it,
 * `UpdateFileHistory` and `GetFileFromHistory` (`common/eda_base_frame.cpp`
 * :1468 and :1486).
 *
 * The point of this file is that there is one of it.
 *
 * Upstream every frame that can open a file owns a `FILE_HISTORY*`, allocated
 * once in `EDA_BASE_FRAME::LoadSettings` (:1282-1286) and shared by eeschema,
 * pcbnew, gerbview (four of them), pl_editor, cvpcb, bitmap2component and the
 * project manager. Frames differ in exactly two parameters — the number of
 * files and the text on the clear item — and in nothing else.
 *
 * Ours was written three separate times and had already drifted:
 *   - `editors/image/bitmap2cmpSettings.ts`   — cap 5, dedupe by name
 *   - `editors/drawingsheet/DrawingSheetEditor.tsx` — cap 5, dedupe by name,
 *     a second private copy of the same twelve lines
 *   - `home/menubar.ts`                       — no cap, no dedupe, and an
 *     "(no recent projects)" placeholder nobody upstream has
 * with all three showing a "(empty)" or "(no recent projects)" child row where
 * upstream greys out the "Open Recent" item itself.
 *
 * Three behaviours a naive recent-files list does not have, all ported here:
 *
 *  1. **Duplicates are promoted, not appended.** `wxFileHistory::AddFileToHistory`
 *     searches the list, `RemoveFileFromHistory`s the match, then inserts the
 *     new entry at the front. Re-opening the third-most-recent file moves it to
 *     the top rather than leaving it where it was or adding a second row.
 *
 *  2. **A missing file is offered for removal, and is not opened either way.**
 *     `EDA_BASE_FRAME::GetFileFromHistory` (:1500-1513) puts up a
 *     `KICAD_MESSAGE_DIALOG` — "File '%s' was not found." with the extended
 *     message "Do you want to remove it from list of recently opened files?"
 *     and the buttons relabelled Remove / Keep — then `fn.Clear()`s
 *     *unconditionally*. Keep leaves the row in the list but still does not
 *     open anything.
 *
 *  3. **The submenu's enabled state is the history's emptiness.**
 *     `FILE_HISTORY::FileHistoryNotEmpty` is a `SELECTION_CONDITION` registered
 *     against the "Open Recent" item's own id (`bitmap2cmp_frame.cpp:294-296`,
 *     `pagelayout_editor/menubar.cpp:73-77`, `kicad/menubar.cpp:98-101`), so an
 *     empty history greys out the parent row. `doAddClearItem` does append a
 *     disabled "No Files" child in that state, but you can never open the
 *     submenu to see it.
 *
 * Not ported: `Load`/`Save` against `APP_SETTINGS_BASE` (upstream keeps the
 * list in the per-application JSON under `system.file_history`; ours is one
 * localStorage key per frame, because a browser tab has no config directory),
 * and the wx menu plumbing — `UseMenu`, `AddFilesToMenu`, `doRemoveClearitem`
 * — which exists to mutate a live `wxMenu` in place. Our menu bar is rebuilt
 * from data on every render, which is what `UpdateFileHistory`'s
 * `ReCreateMenuBar()` (:1477-1481) is emulating anyway.
 *
 * Callers: `editors/image/ImageConverter.tsx`,
 * `editors/drawingsheet/DrawingSheetEditor.tsx`, `home/menubar.ts`.
 * Still to be retro-fitted: the Assign Footprints dialog and gerbview's four
 * separate histories, when those branches land.
 */
import type { MenuItem } from './menu_types.js';

/**
 * `MAX_FILE_HISTORY_SIZE` (`include/id.h:50`). The hard ceiling the
 * `FILE_HISTORY` constructor clamps to, independent of the user setting.
 */
export const MAX_FILE_HISTORY_SIZE = 99;

/**
 * The default for `system.file_history_size`
 * (`common/settings/common_settings.cpp:351-352`).
 *
 * It is **9**, and it is a user setting — `PANEL_COMMON_SETTINGS` exposes it as
 * a spin control (`common/dialogs/panel_common_settings.cpp:177`, `:284`), and
 * `EDA_BASE_FRAME::CommonSettingsChanged` (:975-979) pushes a changed value
 * into the live history with `SetMaxFiles`. We already carry the setting and
 * the spinner (`prefs/settings.ts` `system.file_history_size`,
 * `prefs/PreferencesDialog.tsx:505`); all three of our stores hardcoded 5 and
 * ignored it.
 */
export const DEFAULT_FILE_HISTORY_SIZE = 9;

/** `m_clearText`'s default (`include/file_history.h:52`). */
export const DEFAULT_CLEAR_TEXT = 'Clear Recent Files';

/**
 * The `ID_FILE_LIST_EMPTY` placeholder's label (`file_history.cpp:151`).
 * Reachable only in theory — see (3) above.
 */
export const NO_FILES_LABEL = 'No Files';

/** `EDA_BASE_FRAME::GetFileFromHistory`'s dialog, :1503-1509. */
export const missingFileMessage = (name: string): string => `File '${name}' was not found.\n`;
export const MISSING_FILE_EXTENDED = 'Do you want to remove it from list of recently opened files?';

/**
 * One row. Upstream a row is a bare `wxString` path; a browser tab cannot
 * reopen a path, so ours carries whatever payload the frame needs to reload the
 * file (image bytes as a data URL, drawing-sheet text, a project id) alongside
 * the `name` that is displayed and deduplicated on.
 */
export interface FileHistoryEntry {
  /** What the menu row reads, and the identity `addFileToHistory` dedupes on. */
  name: string;
}

/** The slice of `Storage` we use, so tests can pass their own. */
export interface FileHistoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface FileHistoryOptions<T extends FileHistoryEntry> {
  /**
   * Where the list is persisted. Upstream this is the frame's own JSON settings
   * file; ours is one localStorage key per frame.
   */
  storageKey: string;
  /**
   * `FILE_HISTORY( aMaxFiles, … )`. Defaults to
   * `DEFAULT_FILE_HISTORY_SIZE`; pass `settings.common.system.file_history_size`
   * to honour the user's preference the way `LoadSettings` (:1285) does.
   */
  maxFiles?: number;
  /** `m_clearText`. `kicad/menubar.cpp:64` overrides it to "Clear Recent Projects". */
  clearText?: string;
  /**
   * `wxFileHistory::AddFileToHistory` compares `wxFileName`s, not strings, so
   * "the same file" is a path comparison rather than a label comparison.
   * Ours defaults to the name; a frame whose rows carry an id (the project
   * manager) should key on that instead.
   */
  keyOf?: (entry: T) => string;
  /** Injected in tests. Defaults to `localStorage`, guarded for private mode. */
  storage?: FileHistoryStorage;
}

const localStorageAdapter: FileHistoryStorage = {
  getItem(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* quota exceeded or private mode: drop the history, not the session */
    }
  },
};

/**
 * `class FILE_HISTORY : public wxFileHistory`.
 *
 * Mutating methods persist immediately and notify subscribers, which is what
 * `UpdateFileHistory`'s `ReCreateMenuBar()` does upstream. React callers should
 * go through `useFileHistory` rather than subscribing by hand.
 */
export class FileHistory<T extends FileHistoryEntry = FileHistoryEntry> {
  private readonly storageKey: string;
  private readonly storage: FileHistoryStorage;
  private readonly keyOf: (entry: T) => string;
  private readonly listeners = new Set<() => void>();
  private maxFiles: number;
  private history: readonly T[];

  /** `m_clearText`, read by `openRecentMenuItem`. */
  clearText: string;

  constructor(opts: FileHistoryOptions<T>) {
    this.storageKey = opts.storageKey;
    this.storage = opts.storage ?? localStorageAdapter;
    this.keyOf = opts.keyOf ?? ((e) => e.name);
    this.clearText = opts.clearText ?? DEFAULT_CLEAR_TEXT;
    // `FILE_HISTORY( std::min( aMaxFiles, MAX_FILE_HISTORY_SIZE ) )`
    // (file_history.cpp:36) over `std::max( 1, fileHistorySize )`
    // (eda_base_frame.cpp:1285) — the constructor's floor is 1, not 0.
    this.maxFiles = clampMax(Math.max(1, opts.maxFiles ?? DEFAULT_FILE_HISTORY_SIZE));
    this.history = this.read();
  }

  // ----- wxFileHistory accessors ----------------------------------------------

  /** `GetCount()`. */
  getCount(): number {
    return this.history.length;
  }

  /** `GetHistoryFile( i )`; `null` rather than an assert past the end. */
  getHistoryFile(index: number): T | null {
    return this.history[index] ?? null;
  }

  /** `m_fileHistory`, newest first. */
  getFiles(): readonly T[] {
    return this.history;
  }

  /** `m_fileMaxFiles`. */
  getMaxFiles(): number {
    return this.maxFiles;
  }

  // ----- mutation --------------------------------------------------------------

  /**
   * `wxFileHistory::AddFileToHistory`, via `EDA_BASE_FRAME::UpdateFileHistory`.
   *
   * An entry already in the list is *removed and re-inserted at the front* —
   * re-opening a file promotes it rather than duplicating it or leaving it in
   * place — and the tail past `m_fileMaxFiles` is dropped.
   */
  addFileToHistory(entry: T): void {
    const key = this.keyOf(entry);
    const kept = this.history.filter((e) => this.keyOf(e) !== key);
    this.commit([entry, ...kept].slice(0, this.maxFiles));
  }

  /** `wxFileHistory::RemoveFileFromHistory( i )`. */
  removeFileFromHistory(index: number): void {
    if (index < 0 || index >= this.history.length) return;
    this.commit(this.history.filter((_, i) => i !== index));
  }

  /** `FILE_HISTORY::ClearFileHistory` (file_history.cpp:176-180). */
  clearFileHistory(): void {
    this.commit([]);
  }

  /**
   * `FILE_HISTORY::SetMaxFiles` (file_history.cpp:84-93).
   *
   * Clamped to `MAX_FILE_HISTORY_SIZE`, and it trims the *existing* list down
   * to the new size rather than only affecting later additions. Called from
   * `EDA_BASE_FRAME::CommonSettingsChanged` (:975-979) when the user moves the
   * preference, whose own clamp is `std::max( 0, … )` — zero is allowed there,
   * unlike the constructor's floor of 1.
   */
  setMaxFiles(count: number): void {
    this.maxFiles = clampMax(Math.max(0, count));
    if (this.history.length > this.maxFiles) this.commit(this.history.slice(0, this.maxFiles));
  }

  /**
   * `EDA_BASE_FRAME::GetFileFromHistory` (:1486-1523).
   *
   * Returns the entry only when it is still there. When it is not, upstream
   * asks whether to drop the row, drops it on Remove — and then clears the
   * filename **either way**, so Keep does not open anything either.
   */
  getFileFromHistory(
    index: number,
    opts: {
      /** `wxFileName::FileExists( fn )`. */
      exists: (entry: T) => boolean;
      /** The Remove / Keep dialog. `true` removes the row. */
      confirmRemove: (entry: T) => boolean;
    },
  ): T | null {
    const entry = this.getHistoryFile(index);
    if (!entry) return null;
    if (opts.exists(entry)) return entry;
    if (opts.confirmRemove(entry)) this.removeFileFromHistory(index);
    return null;
  }

  // ----- the SELECTION_CONDITION ------------------------------------------------

  /**
   * `FILE_HISTORY::FileHistoryNotEmpty` (file_history.cpp:183-192) — the
   * condition every frame registers against its "Open Recent" item, which is
   * why upstream greys the parent row out instead of showing a placeholder.
   */
  fileHistoryNotEmpty(): boolean {
    return this.getCount() !== 0;
  }

  // ----- persistence / notification ----------------------------------------------

  /** Re-read from storage; for a frame that shares a key with another tab. */
  reload(): void {
    this.history = this.read();
    this.notify();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private read(): readonly T[] {
    try {
      const raw = this.storage.getItem(this.storageKey);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      // A stored list written before the cap moved (or by another build) is
      // trimmed on load, as `Load` + a smaller `m_fileMaxFiles` would.
      return (parsed as T[]).filter((e) => e && typeof e.name === 'string').slice(0, this.maxFiles);
    } catch {
      return [];
    }
  }

  private commit(next: readonly T[]): void {
    this.history = next;
    this.storage.setItem(this.storageKey, JSON.stringify(next));
    this.notify();
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }
}

function clampMax(count: number): number {
  return Math.min(Math.trunc(count), MAX_FILE_HISTORY_SIZE);
}

// ----- the menu ------------------------------------------------------------------

export interface OpenRecentMenuOptions {
  /** `m_fileHistory`, newest first. */
  files: readonly FileHistoryEntry[];
  /** Picking row `index`. `ID_FILE1 + i` upstream. */
  onOpen: (index: number) => void;
  /** `m_clearId`. */
  onClear: () => void;
  /** `m_clearText`. */
  clearText?: string;
}

/**
 * The "Open Recent" submenu, as every frame's `doReCreateMenuBar` assembles it:
 * the history rows, then — when the history is empty — the disabled "No Files"
 * placeholder, then a separator and the clear item (`doAddClearItem`,
 * file_history.cpp:147-162).
 *
 * The parent row carries `disabled` from `FileHistoryNotEmpty`. That is the
 * whole of Image Converter finding C3: given the condition, the "(empty)" child
 * row we had invented is unreachable upstream and the greyed-out parent is what
 * the user actually sees.
 */
export function openRecentMenuItem(opts: OpenRecentMenuOptions): MenuItem {
  const { files } = opts;
  const rows: MenuItem[] = files.map((f, i) => ({
    label: f.name,
    action: () => opts.onOpen(i),
  }));

  if (files.length === 0) rows.push({ label: NO_FILES_LABEL, disabled: true });

  rows.push({ sep: true });
  rows.push({ label: opts.clearText ?? DEFAULT_CLEAR_TEXT, action: opts.onClear });

  return {
    label: 'Open Recent',
    icon: 'recent',
    disabled: files.length === 0,
    submenu: rows,
  };
}
