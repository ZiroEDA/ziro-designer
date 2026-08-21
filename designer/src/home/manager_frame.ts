// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The two strings `KICAD_MANAGER_FRAME` writes about the open project: the
 * window title and the first status-bar field.
 *
 * Both were ours rather than KiCad's, and in a way that had them swapped: the
 * bracketed placeholder that upstream puts in the *title* had been reworded
 * into the *status bar*, and the title carried a shorter phrase of our own.
 */

/** `_( "[Read Only]" )` — `kicad_manager_frame.cpp:1298`, brackets included. */
export const READ_ONLY_SUFFIX = '[Read Only]';

/** `_( "[no project loaded]" )` — `:1304`. The only place this string exists in
 *  KiCad; it is a title, and never a status-bar line. */
export const NO_PROJECT_TITLE = '[no project loaded]';

/**
 * The em dash and its spaces that separate the document from the app name:
 * `title += wxT( " — " ) + ...` (`:1307` and `:1309`).
 */
const TITLE_SEPARATOR = ' — ';

/**
 * `KICAD_MANAGER_FRAME::LoadProject`'s title (`:1290-1312`):
 *
 *     wxString title;
 *
 *     if( !file.IsEmpty() )
 *     {
 *         wxFileName fn( file );
 *
 *         title = fn.GetName();
 *
 *         if( Prj().IsReadOnly() )
 *             title += wxS( " " ) + _( "[Read Only]" );
 *     }
 *     else
 *     {
 *         title = _( "[no project loaded]" );
 *     }
 *
 *     ...
 *         title += wxT( " — " ) + wxString( wxS( "KiCad " ) ) + GetMajorMinorVersion();
 *
 *     SetTitle( title );
 *
 * `fn.GetName()` is the basename **without** its extension, so a project saved
 * as `demo.kicad_pro` titles the window `demo`, not `demo.kicad_pro`.
 *
 * `appName` stands in for `"KiCad " + GetMajorMinorVersion()`. That one
 * substitution is the product's name and is made by the caller, so this
 * function has no literal of ours in it at all.
 */
export function managerTitle(
  projectName: string | null | undefined,
  appName: string,
  readOnly = false,
): string {
  const name = projectName?.trim().replace(/\.kicad_pro$/i, '');
  const head = name ? `${name}${readOnly ? ` ${READ_ONLY_SUFFIX}` : ''}` : NO_PROJECT_TITLE;
  return `${head}${TITLE_SEPARATOR}${appName}`;
}

/**
 * `KICAD_MANAGER_FRAME::PrintPrjInfo` (`:1353-1359`):
 *
 *     wxString status = wxString::Format( _( "Project: %s" ), Prj().GetProjectFullName() );
 *     KISTATUSBAR* statusBar = static_cast<KISTATUSBAR*>( GetStatusBar() );
 *     statusBar->SetEllipsedTextField( status, 0 );
 *
 * `GetProjectFullName()` is `m_project_name.GetFullPath()` (`common/project.cpp:181-184`)
 * — the whole path to the `.kicad_pro`, not its basename. A real KiCad reads
 * `Project: /home/you/ki_demo/demo/demo.kicad_pro`.
 *
 * With no project the field is **empty**. `CloseProject` clears it with
 * `SetStatusText( "" )` (`:856`) and `PrintPrjInfo` is only ever called with
 * one loaded (`:627, :1050, :1227`). There is no "no project" status string in
 * KiCad — the one we were writing there had no counterpart anywhere in the
 * source.
 */
export function projectStatusText(projectFullPath: string | null | undefined): string {
  const path = projectFullPath?.trim();
  return path ? `Project: ${path}` : '';
}
