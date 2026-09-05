// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The colour-theme folder, as a real directory on the user's disk.
 *
 * `PANEL_COLOR_SETTINGS::OnBtnOpenThemeFolderClicked` is
 * `LaunchExternal( SETTINGS_MANAGER::GetColorSettingsPath() )` — the file
 * manager, on the folder KiCad keeps its themes in. A page cannot start the
 * file manager, but it CAN open the desktop's folder chooser and then read and
 * write inside whatever the user picks: that is the File System Access API, and
 * this app already opens a project with it (`HomePage.openProjectPicker`).
 *
 * So "Open Theme Folder" opens a folder. Point it at
 * `~/.config/kicad/10.0/colors` and it is KiCad's own theme folder, with
 * KiCad's own files in it — read, and written back.
 *
 * Chrome refuses the picker for "system" locations (the profile root, Desktop,
 * Documents, Downloads); a deep path like `.config/kicad/10.0/colors` is not on
 * that list, but a refusal is possible and is reported as {@link PICK_BLOCKED}
 * so the caller can fall back to a download and an upload, which need no
 * permission at all.
 */
import { colorThemeFromFile, type ColorThemeContents } from '@ziroeda/common';

/** The half of `FileSystemDirectoryHandle` this uses. */
export interface ThemeDirHandle {
  name: string;
  values: () => AsyncIterable<ThemeFsEntry>;
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<ThemeFileHandle>;
}
export interface ThemeFsEntry {
  kind: string;
  name: string;
  getFile: () => Promise<File>;
}
export interface ThemeFileHandle {
  createWritable: () => Promise<ThemeWritable>;
}
export interface ThemeWritable {
  write: (data: string) => Promise<void>;
  close: () => Promise<void>;
}

/** The user closed the chooser. Nothing to do — same as `AbortError` upstream. */
export const PICK_CANCELLED = 'cancelled';
/** No API, or the browser refused this folder. The caller offers files instead. */
export const PICK_BLOCKED = 'blocked';

export type PickedFolder = ThemeDirHandle | typeof PICK_CANCELLED | typeof PICK_BLOCKED;

type Picker = (options?: { mode?: string; id?: string }) => Promise<ThemeDirHandle>;

/**
 * Open the desktop's folder chooser.
 *
 * `mode: 'readwrite'` asks for write permission in the same gesture, because
 * the point of the folder is that a theme goes back into it; asking again on
 * the first save would put a second prompt between the user and a button they
 * already pressed. `id` makes Chrome reopen the chooser where it was last left,
 * which is what a folder you return to should do.
 */
export async function pickThemeFolder(): Promise<PickedFolder> {
  const picker = (globalThis as { showDirectoryPicker?: Picker }).showDirectoryPicker;
  if (!picker) return PICK_BLOCKED;
  try {
    return await picker({ mode: 'readwrite', id: 'kicad-color-themes' });
  } catch (e) {
    // AbortError is the user closing the dialog; a blocked folder, a
    // SecurityError or an unsupported call is not, and gets the fallback.
    return (e as DOMException)?.name === 'AbortError' ? PICK_CANCELLED : PICK_BLOCKED;
  }
}

/** One `.json` in the folder that parses as a colour theme. */
export interface FolderTheme {
  fileName: string;
  contents: ColorThemeContents;
}

/**
 * Every colour theme in the folder, in the order the platform lists it.
 *
 * A `.json` that is not a theme is skipped rather than reported: KiCad's own
 * folder is not guaranteed to hold only themes, and a listing that refused to
 * open because of a stray file would be worse than one that leaves it out.
 * Subfolders are not walked — `GetColorSettingsPath()` is one flat directory.
 */
export async function readThemeFolder(dir: ThemeDirHandle): Promise<FolderTheme[]> {
  const out: FolderTheme[] = [];
  for await (const entry of dir.values()) {
    if (entry.kind !== 'file' || !entry.name.toLowerCase().endsWith('.json')) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(await (await entry.getFile()).text());
    } catch {
      continue;
    }
    const contents = colorThemeFromFile(parsed);
    if (contents) out.push({ fileName: entry.name, contents });
  }
  return out;
}

/** Write one theme file into the folder, creating it if it is not there. */
export async function writeThemeFile(
  dir: ThemeDirHandle,
  fileName: string,
  text: string,
): Promise<void> {
  const handle = await dir.getFileHandle(fileName, { create: true });
  const w = await handle.createWritable();
  await w.write(text);
  await w.close();
}
