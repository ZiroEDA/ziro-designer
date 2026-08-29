// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The footprint association file LIST — where a `.equ` file is found, and what
 * Add / Move Up / Move Down / Remove do to the list. Counterpart:
 * `cvpcb/dialogs/dialog_config_equfiles.cpp` (`DIALOG_CONFIG_EQUFILES`), whose
 * window is `dialogs/dialog_config_equfiles.tsx`.
 *
 * The list itself is `PROJECT_FILE::m_EquivalenceFiles`, persisted at
 * `cvpcb.equivalence_files` in the `.kicad_pro`; see
 * `project_settings.ts`. Everything here is the logic the dialog's five
 * handlers run, out of the component so it can be tested — the same reason
 * `cvpcb_commands.ts` exists.
 *
 * ## Where a `.equ` file comes from in a browser
 *
 * Upstream's Add is a `wxFileDialog` over the local disk, and
 * `buildEquivalenceList` re-opens the chosen path with `fopen` every time the
 * button is pressed (auto_associate.cpp:120). Neither half survives the move:
 * a browser page cannot hold a readable handle to a file on the user's disk
 * across sessions, and there is no `fopen`.
 *
 * So the account's project tree is the filesystem, exactly as it is for every
 * other Open in this app (`fs/OpenFileDialog.tsx`). A `.equ` is a project
 * file: it is added to the project, referenced from the `.kicad_pro` the way
 * upstream references it — `${KIPRJMOD}/name.equ`, which is the spelling
 * `OnAddFiles` itself builds when the file sits under the project directory
 * (`:222-233`) — and read back out of the project's own files. A `.equ` picked
 * off the local disk is COPIED into the project first, because a reference
 * that cannot be re-read on the next page load is not a reference.
 *
 * The consequence worth stating: a `.equ` file shared between projects has to
 * be in each project, where upstream could point several projects at one file
 * under a common directory. `${KIPRJMOD}` is the only path variable we can
 * offer, because the other one upstream lists — the global footprint directory
 * (`FOOTPRINT_LIBRARY_ADAPTER::GlobalPathEnvVariableName`, `:69`) — is a
 * hosted bucket here and holds no user files.
 */

import { findProjectFile, projectRoot, type ProjectFile } from '../../fs/project_paths.js';

/** `PROJECT_VAR_NAME` (include/project.h:41), as it is written in a path. */
export const PROJECT_VAR_REF = '${KIPRJMOD}';

/**
 * `FILEEXT::EquFileWildcard()` (common/wildcards_and_files_ext.cpp:515-518):
 * `_( "Symbol footprint association files" )` over `*.equ`.
 */
export const EQU_FILE_EXTENSION = 'equ';

/**
 * The text of one listed equivalence file, or null when the project has no
 * such file — `buildEquivalenceList`'s "could not be found" (`:100-117`).
 *
 * Upstream tries the path as given, then `SEARCH_STACK::FindValidPath`. Here
 * the search stack is the project: a `${KIPRJMOD}`-relative entry resolves
 * against the project root, and anything else is matched as a path inside the
 * project so that a file added before the project moved still resolves.
 */
export function readEquFile(files: readonly ProjectFile[], entry: string): string | null {
  const direct = findProjectFile(files, entry);
  if (direct) return direct.text;

  // An absolute account path (`/MyBoard/foo.equ`) as the file chooser hands it
  // back, against project files named without the leading slash.
  const stripped = entry.replace(/\\/g, '/').replace(/^\/+/, '');
  const found = files.find(
    (f) => f.name.replace(/\\/g, '/').toLowerCase() === stripped.toLowerCase(),
  );
  return found ? found.text : null;
}

/**
 * How a chosen file is spelled in the list — `OnAddFiles`'s relativization
 * (dialog_config_equfiles.cpp:214-238).
 *
 * Upstream walks its path-substitution grid and takes the first variable the
 * file can be made relative to, writing `${VAR}<sep><relative>`; failing that
 * it stores the path whole. Ours has one variable, `${KIPRJMOD}`, so a file in
 * the open project becomes `${KIPRJMOD}/…` and anything else keeps its path.
 *
 * The `\` -> `/` normalization is upstream's too ("Use unix separators only.",
 * `:242`).
 */
export function equFilePathFor(chosenPath: string, files: readonly ProjectFile[]): string {
  const path = chosenPath.replace(/\\/g, '/').replace(/^\/+/, '');
  const root = projectRoot(files);
  if (root && path.toLowerCase().startsWith(root.toLowerCase()))
    return `${PROJECT_VAR_REF}/${path.slice(root.length)}`;
  return path;
}

/** `_( "File '%s' already exists in list." )` (dialog_config_equfiles.cpp:250). */
export function equFileExistsMessage(path: string): string {
  return `File '${path}' already exists in list.`;
}

/** What a list edit leaves behind: the rows, and which of them are selected. */
export interface EquFileList {
  files: readonly string[];
  /** `wxArrayInt` from `GetSelections()`, ascending. */
  selection: readonly number[];
}

/**
 * `OnAddFiles` (dialog_config_equfiles.cpp:203-256) — append, unless the list
 * already holds that exact spelling.
 *
 * Two details are upstream's and both look like slips:
 *
 *  - the duplicate test is `FindString( filepath, wxFileName::IsCaseSensitive() )`,
 *    i.e. case sensitive on Linux, and it runs **before** the backslash
 *    normalization at `:242` — so on a case-insensitive path a second spelling
 *    of the same file is added rather than rejected;
 *  - a rejected file raises `DisplayErrorMessage` per file, and the rest of the
 *    batch continues.
 *
 * `error` is that message, or null. The selection is untouched: `Append` does
 * not select what it added.
 */
export function addEquFile(
  list: EquFileList,
  path: string,
): EquFileList & { error: string | null } {
  if (list.files.includes(path)) return { ...list, error: equFileExistsMessage(path) };
  return {
    files: [...list.files, path.replace(/\\/g, '/')],
    selection: list.selection,
    error: null,
  };
}

/**
 * `OnRemoveFiles` (dialog_config_equfiles.cpp:186-199) — delete every selected
 * row, highest index first so the earlier ones do not shift.
 *
 * Nothing is selected afterwards, because `wxListBox::Delete` does not move the
 * selection onto a neighbour and upstream does not put one back.
 */
export function removeEquFiles(list: EquFileList): EquFileList {
  const drop = new Set(list.selection);
  return { files: list.files.filter((_, i) => !drop.has(i)), selection: [] };
}

/**
 * `OnButtonMoveUp` (dialog_config_equfiles.cpp:124-149) — swap each selected
 * row with the one above it, and keep the moved rows selected.
 *
 * The two guards are upstream's, and the second is the enable condition it has
 * instead of a disabled button: nothing selected does nothing, and a selection
 * that includes the FIRST row does nothing **at all** — not "move the others",
 * the whole command returns. The buttons themselves are never disabled;
 * `DIALOG_CONFIG_EQUFILES` has no `wxUpdateUIEvent` handler and no
 * `Enable( … )` call anywhere.
 */
export function moveEquFilesUp(list: EquFileList): EquFileList {
  if (list.selection.length === 0) return list;
  if (list.selection[0] === 0) return list;

  const files = [...list.files];
  for (const jj of list.selection) {
    const above = files[jj - 1] as string;
    files[jj - 1] = files[jj] as string;
    files[jj] = above;
  }
  return { files, selection: list.selection.map((jj) => jj - 1) };
}

/**
 * `OnButtonMoveDown` (dialog_config_equfiles.cpp:152-181) — the mirror, walking
 * the selection backwards so a contiguous block moves as a block.
 *
 * The guard is `selections.Last() == GetCount() - 1`: a selection touching the
 * LAST row does nothing at all.
 */
export function moveEquFilesDown(list: EquFileList): EquFileList {
  if (list.selection.length === 0) return list;
  if (list.selection[list.selection.length - 1] === list.files.length - 1) return list;

  const files = [...list.files];
  for (let ii = list.selection.length - 1; ii >= 0; ii--) {
    const jj = list.selection[ii] as number;
    const below = files[jj + 1] as string;
    files[jj + 1] = files[jj] as string;
    files[jj] = below;
  }
  return { files, selection: list.selection.map((jj) => jj + 1) };
}
