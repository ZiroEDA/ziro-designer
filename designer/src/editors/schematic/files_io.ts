// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Counterpart: `eeschema/files-io.cpp`, the parts of it that are decisions
 * rather than disk access.
 *
 * A `.ts` module rather than part of the editor component because `qa`'s
 * tsconfig has no `--jsx` and cannot import a `.tsx` at all — a rule only the
 * component knows is untestable by construction.
 */

/**
 * `SCH_EDIT_FRAME::saveSchematicFile`'s success message
 * (eeschema/files-io.cpp:1073-1075):
 *
 *     msg.Printf( _( "File '%s' saved." ), screen->GetFileName() );
 *     SetStatusText( msg, 0 );
 *
 * The straight quotes are upstream's own — `_( "File '%s' saved." )` — not the
 * typographic pair, so a user comparing the two status bars sees the same
 * characters.
 *
 * Note WHICH name it interpolates: `screen->GetFileName()`. After
 * `Save Current Sheet Copy As...` that is still the ORIGINAL file, because
 * `saveSchematicFile` never calls `screen->SetFileName()` — see the comment on
 * `saveCurrSheetCopyAs` for why that is mirrored rather than corrected.
 */
export function savedFileMessage(filename: string): string {
  return `File '${filename}' saved.`;
}

/**
 * `SCH_EDITOR_CONTROL::Revert`'s question
 * (eeschema/tools/sch_editor_control.cpp:466-467):
 *
 *     msg.Printf( _( "Revert '%s' (and all sub-sheets) to last version saved?" ),
 *                 schematic.GetFileName() );
 *
 * The `%s` is `SCHEMATIC::GetFileName()` — the FIRST TOP-LEVEL SHEET's file
 * (eeschema/schematic.cpp:524-532) — not whichever sheet is on screen. The
 * parenthesis is why: it discards the whole hierarchy, so it names the project
 * rather than the sheet you happen to be looking at.
 */
export function revertPromptMessage(rootFileName: string): string {
  return `Revert '${rootFileName}' (and all sub-sheets) to last version saved?`;
}

/**
 * `IsOK`'s caption (common/confirm.cpp:293) — `KICAD_MESSAGE_DIALOG( aParent,
 * aMessage, _( "Confirmation" ), … )`. Not the frame's name, and not a question
 * of its own: every IsOK in KiCad puts this one word in the title bar.
 */
export const CONFIRMATION_CAPTION = 'Confirmation';
