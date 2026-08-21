// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The project tree's right-click menu — `PROJECT_TREE_PANE::onRight`
 * (`kicad/project_tree_pane.cpp:816-1119`).
 *
 * Upstream computes six booleans over the selection and then *appends the rows
 * the booleans allow*. Nothing is greyed: an entry that does not apply is
 * absent. Ours drew a fixed five rows and disabled the ones that did not
 * apply, which is the opposite convention and reads as a broken menu rather
 * than a shorter one.
 *
 * The whole menu is here as a pure function of the selection so the conditions
 * can be tested without a DOM — they are the part that was wrong, not the
 * markup.
 *
 * ## What is left out, and why
 *
 * Two of upstream's rows end outside the browser and are omitted rather than
 * carried greyed or replaced:
 *
 * - **`Open Directory in File Explorer`** (`:943-967`, "Reveal in Finder" on
 *   macOS) — `can_open_this_directory`. It opens the OS file manager on the
 *   folder. There is no OS file manager and no folder; the project's files are
 *   in the pane this menu was opened from.
 * - **`Version Control`** (`:1028-1118`), the whole submenu — libgit2 against
 *   a working tree on disk. Neither exists here.
 *
 * `can_open_this_directory` is still computed below, because it is one of the
 * five terms in the separator condition that precedes Move to Trash
 * (`:1010-1018`) and dropping it would move the rule.
 */

import { type TreeFileType, canDelete, canRename } from './file_activation.js';

/** One row of the selection, as much of `PROJECT_TREE_ITEM` as the menu asks. */
export interface TreeMenuSelectionItem {
  readonly type: TreeFileType;
  /** `item->GetId() == m_TreeProject->GetRootItem()` — the project's own row. */
  readonly isTreeRoot?: boolean;
}

/** The rows this menu can contain. `separator` is `wxMenu::AppendSeparator`. */
export type TreeMenuEntryId =
  | 'switchToProject'
  | 'newDirectory'
  | 'editInTextEditor'
  | 'download'
  | 'runJobs'
  | 'renameFile'
  | 'moveToTrash';

export interface TreeMenuEntry {
  readonly id: TreeMenuEntryId;
  /** The row's text, `KIUI::AddMenuItem`'s `aText`. */
  readonly label: string;
  /** Its help string, `aHelpText` — the status-bar line upstream. */
  readonly help: string;
  /** The `BITMAPS::` enumerator, as the name we vendor its SVG under. */
  readonly icon: string;
  /** True for the one row that is ours and has no upstream counterpart. */
  readonly ours?: true;
}

export type TreeMenu = readonly (TreeMenuEntry | 'separator')[];

/**
 * Build the popup for a selection, or an empty menu for an empty one.
 *
 *     if( selection.size() == 0 )
 *         return;
 *
 * (`:850-851`) — upstream returns before building anything, and the final
 * `if( popup_menu.GetMenuItemCount() > 0 ) PopupMenu( &popup_menu );`
 * (`:1117-1118`) means a menu that ended up empty is never shown at all.
 */
export function projectTreeMenu(selection: readonly TreeMenuSelectionItem[]): TreeMenu {
  if (selection.length === 0) return [];

  let canSwitchToProject = true;
  let canCreateNewDirectory = true;
  let canOpenThisDirectory = true;
  let canEdit = true;
  let canRenameSel = true;
  let canDeleteSel = true;
  let runJobs = false;

  // "Remove things that don't make sense for multiple selections" (:854-860).
  if (selection.length !== 1) {
    canSwitchToProject = false;
    canCreateNewDirectory = false;
    canRenameSel = false;
  }

  for (const item of selection) {
    // Upstream *assigns* here rather than and-ing:
    //
    //     can_delete = item->CanDelete();
    //     can_rename = item->CanRename();
    //
    // (:876-877) so across a multiple selection the LAST item decides both,
    // and it also undoes the `can_rename = false` the multi-selection guard
    // above just set - which is how "Rename Files..." (:987) is reachable at
    // all. Ported as written: a faithful port of a switch includes the order
    // its assignments happen in, and "fixing" it here would put a row on the
    // menu that KiCad does not show for that selection, or take one away.
    canDeleteSel = canDelete(item.type);
    canRenameSel = canRename(item.type);

    switch (item.type) {
      case 'JSON_PROJECT':
      case 'LEGACY_PROJECT':
        canRenameSel = false;

        if (item.isTreeRoot) {
          canSwitchToProject = false;
        } else {
          canCreateNewDirectory = false;
          canOpenThisDirectory = false;
        }
        break;

      case 'DIRECTORY':
        canSwitchToProject = false;
        canEdit = false;
        break;

      case 'ZIP_ARCHIVE':
      case 'PDF':
        canEdit = false;
        canSwitchToProject = false;
        canCreateNewDirectory = false;
        canOpenThisDirectory = false;
        break;

      // Upstream writes this as a KI_FALLTHROUGH chain (:906-919):
      //
      //     case JOBSET_FILE:  run_jobs = true; can_edit = false;  KI_FALLTHROUGH;
      //     case SEXPR_SCHEMATIC:
      //     case SEXPR_PCB:                                        KI_FALLTHROUGH;
      //     default:           can_switch_to_project = false;
      //                        can_create_new_directory = false;
      //                        can_open_this_directory = false;
      //
      // so a jobset does the default's three as well as its own two. Flattened
      // here rather than fallen through, because a `case` with a body that
      // falls into the next one is a lint error and a reader's trap in TS; the
      // two branches below are exactly what the chain above computes.
      case 'JOBSET_FILE':
        runJobs = true;
        canEdit = false;
        canSwitchToProject = false;
        canCreateNewDirectory = false;
        canOpenThisDirectory = false;
        break;

      // SEXPR_SCHEMATIC and SEXPR_PCB carry no body of their own upstream:
      // they exist only to land on `default:`, and they land there here too.
      case 'SEXPR_SCHEMATIC':
      case 'SEXPR_PCB':
      default:
        canSwitchToProject = false;
        canCreateNewDirectory = false;
        canOpenThisDirectory = false;
        break;
    }
  }

  const single = selection.length === 1;
  const menu: (TreeMenuEntry | 'separator')[] = [];

  if (canSwitchToProject) {
    menu.push({
      id: 'switchToProject',
      label: 'Switch to this Project',
      help: 'Close all editors, and switch to the selected project',
      icon: 'open_project',
    });
    menu.push('separator');
  }

  if (canCreateNewDirectory) {
    menu.push({
      id: 'newDirectory',
      label: 'New Directory...',
      help: 'Create a New Directory',
      icon: 'directory',
    });
  }

  // `can_open_this_directory` would put "Open Directory in File Explorer" here.

  if (canEdit) {
    // Upstream's label is "Edit in a Text Editor" and its action hands the file
    // to `Pgm().GetTextEditor()`. There is no external editor to hand it to,
    // and what opens here is read-only, so this reads "Viewer" - the same
    // reinterpretation `View > Open Text Viewer` already carries in menubar.ts,
    // not a new one taken here. The help string is upstream's, unchanged.
    menu.push({
      id: 'editInTextEditor',
      label: 'Edit in a Text Viewer',
      help: single ? 'Open the file in a Text Editor' : 'Open files in a Text Editor',
      icon: 'editor',
    });
  }

  // Ours, and the only row here without an upstream counterpart. It is the
  // menu form of the answer `handOffFile` gives to the four Activate branches
  // that end in the operating system: a browser cannot open a file with the
  // system's application, so the most it can do is hand the bytes over.
  if (single) {
    menu.push({
      id: 'download',
      label: 'Download...',
      help: 'Save this file to your computer',
      icon: 'export_file',
      ours: true,
    });
  }

  if (runJobs && single) {
    menu.push({
      id: 'runJobs',
      label: 'Run Jobs',
      // Upstream passes the `help_text` left over from whichever row ran last
      // (:980-983) rather than a string of its own - a wxWidgets accident, not
      // a message. Ours says nothing rather than repeat someone else's line.
      help: '',
      icon: 'exchange',
    });
  }

  if (canRenameSel) {
    menu.push({
      id: 'renameFile',
      label: single ? 'Rename File...' : 'Rename Files...',
      help: single ? 'Rename file' : 'Rename files',
      icon: 'right',
    });
  }

  if (canDeleteSel) {
    // ":1010-1018" - a separator only if there is something above to separate
    // from. `canOpenThisDirectory` is a term even though we never draw its row.
    if (
      canSwitchToProject ||
      canCreateNewDirectory ||
      canOpenThisDirectory ||
      canEdit ||
      canRenameSel
    ) {
      menu.push('separator');
    }

    menu.push({
      id: 'moveToTrash',
      // "Delete" is the `#ifdef __WINDOWS__` branch (:1020-1021). We are not
      // Windows, so that string is not here at all.
      label: 'Move to Trash',
      help: single ? 'Delete the file and its content' : 'Delete the files and their contents',
      icon: 'trash',
    });
  }

  return menu;
}
