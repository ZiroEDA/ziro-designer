// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SCH_EDIT_FRAME::updateTitle` (eeschema/sch_edit_frame.cpp:1819-1862).
 *
 * The frame title is per-frame upstream — each editor has its own
 * `updateTitle()` — but the SHAPE of it is not: star, document, suffixes, em
 * dash, frame name is `docs/frame-titles.md`'s twelve-of-thirteen rule, and
 * `frameTitle()` in `ui/useDocumentTitle.ts` is where that shape lives. This
 * module is only the schematic's own three decisions on top of it, and it
 * states nothing the shared function already states.
 *
 * The C++, in full:
 *
 *     wxFileName fn( Prj().AbsolutePath( screen->GetFileName() ) );
 *     if( IsContentModified() ) title = wxT( "*" );
 *     title += fn.GetName();
 *     wxString sheetPath = GetCurrentSheet().PathHumanReadable( false, true );
 *     if( sheetPath != fn.GetName() )
 *         title += wxString::Format( wxT( " [%s]" ), sheetPath );
 *     if( readOnly ) title += wxS( " " ) + _( "[Read Only]" );
 *     if( unsaved )  title += wxS( " " ) + _( "[Unsaved]" );
 *     ...
 *     title = _( "[no schematic loaded]" );      // the else branch
 *     title += wxT( " — " ) + _( "Schematic Editor" );
 *
 * Three things that are easy to get wrong and were each wrong here:
 *
 *  - The document half is **the current SCREEN's file name**, not the project
 *    name. Descend into a sub-sheet and the title names the sub-sheet's file.
 *  - `wxFileName::GetName()` drops the extension, so it is `ecc83`, never
 *    `ecc83.kicad_sch`.
 *  - The sheet-path bracket is **suppressed at the root**, because
 *    `PathHumanReadable( false, ... )` seeds the path with the root screen's
 *    own `GetName()` — so on the root sheet the two strings are equal and the
 *    comparison at `:1846` fails. A bracket that showed `[ecc83]` on the root
 *    sheet would be wrong in the one place the title is seen most.
 */

import { frameTitle, type FrameTitleParts, READ_ONLY_SUFFIX } from '../../ui/useDocumentTitle.js';

/** `_( "Schematic Editor" )`, the half after the dash. */
export const SCH_FRAME_NAME = 'Schematic Editor';

/** `_( "[no schematic loaded]" )` — sch_edit_frame.cpp:1856. */
export const SCH_NO_DOCUMENT = '[no schematic loaded]';

/**
 * `SCH_SHEET_PATH::PathHumanReadable( false, true )`
 * (eeschema/sch_sheet_path.cpp), for the two arguments `updateTitle` passes.
 *
 * `aUseShortRootName = false` seeds the string with the ROOT screen's file name
 * without its extension rather than with a bare `"/"`; every sheet below the
 * root then contributes its **sheet name** (not its file name) and a `"/"`; and
 * `aStripTrailingSeparator = true` removes the final separator.
 *
 * So the root sheet of `ecc83.kicad_sch` is `"ecc83"`, and a sheet named
 * `Power` beneath it is `"ecc83/Power"`.
 *
 * @param rootFileBase the root screen's file name with the extension already
 *   dropped — `wxFileName( … ).GetName()` of `at( 0 )->GetScreen()`.
 * @param sheetNames the sheet names from the root's child down to the current
 *   sheet, in order. Empty at the root.
 */
export function pathHumanReadable(rootFileBase: string, sheetNames: readonly string[]): string {
  const parts = [rootFileBase, ...sheetNames];
  // `s << sheetName << "/"` for each, then strip the one trailing separator —
  // which is the same string as joining on "/".
  return parts.join('/');
}

export interface SchFrameTitleSpec {
  /**
   * The CURRENT sheet's file name, extension included or not — this function
   * drops it, the way `wxFileName::GetName()` does. Null/empty is the
   * `[no schematic loaded]` branch.
   */
  fileName?: string | null;
  /** `PathHumanReadable( false, true )` for the current sheet. */
  sheetPath?: string;
  /** `IsContentModified()`. */
  modified?: boolean;
  /**
   * `screen->IsReadOnly()`. There is no `[Unsaved]` counterpart here: upstream
   * sets it from `!screen->FileExists()`, and a document in this app exists in
   * the store from the moment it is opened, so the flag would never be true.
   */
  readOnly?: boolean;
}

/** `wxFileName::GetName()` — the base name without its last extension. */
export function fileBaseName(fileName: string): string {
  // A leading dot is not an extension and neither is a dot in a directory
  // component, the same two cases `frameTitleName` handles.
  return fileName.replace(/(?!^)\.[^./\\]*$/, '');
}

export function schFrameTitle(spec: SchFrameTitleSpec): FrameTitleParts {
  const raw = spec.fileName?.trim() ?? '';

  if (raw === '') {
    return frameTitle({
      frameName: SCH_FRAME_NAME,
      document: null,
      placeholder: SCH_NO_DOCUMENT,
      modified: spec.modified,
    });
  }

  const base = fileBaseName(raw);
  // `if( sheetPath != fn.GetName() ) title += " [" + sheetPath + "]"` — equal
  // on the root sheet, so the root carries no bracket.
  const path = spec.sheetPath?.trim() ?? '';
  const document = path !== '' && path !== base ? `${base} [${path}]` : base;

  return frameTitle({
    frameName: SCH_FRAME_NAME,
    document,
    modified: spec.modified,
    suffixes: spec.readOnly ? [READ_ONLY_SUFFIX] : [],
  });
}
