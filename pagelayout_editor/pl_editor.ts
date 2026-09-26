// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pagelayout_editor/pl_editor.cpp`: the `pl_editor` KIFACE. Beyond the DSO
 * plumbing (`KIFACE_GETTER`, `IfaceOrAddress`, which a page has no use for):
 *
 *  - `OnKifaceStart`: `InitSettings( new PL_EDITOR_SETTINGS )` and register
 *    it with the settings manager — here from the stored `plEditor` slice;
 *  - `CreateKiWindow( FRAME_PL_EDITOR )`: the frame over those settings. The
 *    four `PANEL_DS_*` Preferences pages it also makes are
 *    `designer/.../prefs/index.ts` (they read `dialogs/prefs/types`);
 *  - `SaveFileAs`: where a project's Save As puts one of its `.kicad_wks`.
 */
import { PgmOrNull } from '@ziroeda/common/pgm_base.js';
import { PL_EDITOR_FRAME } from './pl_editor_frame.js';
import { PL_EDITOR_SETTINGS, type PL_EDITOR_SETTINGS_JSON } from './pl_editor_settings.js';

/** `kiface( "pl_editor", KIWAY::FACE_PL_EDITOR )`. [data] */
export const PL_EDITOR_KIFACE_NAME = 'pl_editor';

/**
 * `IFACE::OnKifaceStart`: the settings object, loaded from `aStored`, and
 * registered as `pl_editor` so `GetAppSettings<PL_EDITOR_SETTINGS>( "pl_editor" )`
 * finds it (PL_DRAW_PANEL_GAL's constructor asks).
 */
export function OnKifaceStart(aStored: Partial<PL_EDITOR_SETTINGS_JSON>): PL_EDITOR_SETTINGS {
  const settings = new PL_EDITOR_SETTINGS().FromJson(aStored);
  PgmOrNull()?.GetSettingsManager().RegisterSettings(PL_EDITOR_KIFACE_NAME, settings);
  return settings;
}

/** `IFACE::CreateKiWindow( aParent, FRAME_PL_EDITOR, … )`: `new PL_EDITOR_FRAME`. */
export function CreateKiWindow(aSettings: PL_EDITOR_SETTINGS): PL_EDITOR_FRAME {
  return new PL_EDITOR_FRAME(aSettings);
}

/**
 * `IFACE::SaveFileAs`: a `.kicad_wks` inside the project directory moves to
 * the same place under the new directory, and one named after the project
 * takes the new project's name — an exact, case-sensitive match
 * (`destFile.GetName() == aSrcProjectName`).
 *
 * @return the destination path; the copy itself (`KiCopyFile`) is the caller's.
 *         Null for any other file type ("Unexpected filetype").
 */
export function SaveFileAs(
  aProjectBasePath: string,
  aSrcProjectName: string,
  aNewProjectBasePath: string,
  aNewProjectName: string,
  aSrcFilePath: string,
): string | null {
  const pathSep = '/';
  const slash = aSrcFilePath.lastIndexOf(pathSep);
  let destPath = aSrcFilePath.slice(0, slash + 1); // GetPathWithSep()
  const fullName = aSrcFilePath.slice(slash + 1);
  const dot = fullName.lastIndexOf('.');
  let name = dot >= 0 ? fullName.slice(0, dot) : fullName;
  const ext = dot >= 0 ? fullName.slice(dot + 1) : '';

  if (destPath.startsWith(aProjectBasePath + pathSep)) {
    // destPath.Replace( aProjectBasePath, aNewProjectBasePath, false ): the first occurrence.
    destPath = destPath.replace(aProjectBasePath, aNewProjectBasePath);
  }

  if (ext === 'kicad_wks') {
    if (name === aSrcProjectName) name = aNewProjectName;

    return `${destPath}${name}.${ext}`;
  }

  // wxFAIL_MSG( "Unexpected filetype for Pcbnew::SaveFileAs()" )
  return null;
}
