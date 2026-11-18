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
 * One of upstream's rows ends outside the browser and is omitted rather than
 * carried greyed or replaced:
 *
 * - **`Open Directory in File Explorer`** (`:943-967`, "Reveal in Finder" on
 *   macOS) — `can_open_this_directory`. It opens the OS file manager on the
 *   folder. There is no OS file manager and no folder; the project's files are
 *   in the pane this menu was opened from.
 *
 * ## Version Control
 *
 * The submenu (`:1029-1112`) is here, built over GitHub rather than libgit2
 * (`designer/src/github/`), and it keeps upstream's convention for it rather
 * than the popup's: its rows are greyed with `Enable( false )`, not left out.
 * What is in it, against upstream's:
 *
 * - "Add Project to Version Control..." is ours, `Push to GitHub...`: the
 *   repository is created on GitHub (or an empty one chosen) and the project
 *   pushed to it, since there is no local repository to initialise first.
 *   Before it, `Connect GitHub...` while the account has not connected GitHub
 *   on this device, and `Disconnect GitHub` once it has.
 * - `Commit Project...` commits and pushes in one step, so upstream's separate
 *   `Push` row - enabled only with local commits to push, which never exist
 *   here - is left out rather than drawn greyed forever.
 * - `Pull`, and `Switch to Branch` with its quick rows and `Other...`.
 * - Not built yet, and left out: "Configure Default Remote...", "Amend Last
 *   Commit...", "Commit File...", "Disable Git Integration".
 *
 * `can_open_this_directory` is still computed below, because it is one of the
 * five terms in the separator condition that precedes Move to Trash
 * (`:1010-1018`) and dropping it would move the rule.
 */

import { type TreeFileType, canDelete, canRename } from './file_activation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';
import { _ } from '@ziroeda/wx/translation.js';
import { wxFormat } from '@ziroeda/wx/wxstring.js';

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
  | 'downloadProject'
  | 'runJobs'
  | 'renameFile'
  | 'moveToTrash'
  | 'versionControl'
  | 'connectGithub'
  | 'disconnectGithub'
  | 'pushToGithub'
  | 'gitCommitProject'
  | 'gitPull'
  | 'gitSwitchToBranch'
  | 'gitSwitchBranch'
  | 'gitSwitchBranchOther';

export interface TreeMenuEntry {
  readonly id: TreeMenuEntryId;
  /** The row's text, `KIUI::AddMenuItem`'s `aText`. */
  readonly label: string;
  /** Its help string, `aHelpText` — the status-bar line upstream. */
  readonly help: string;
  /**
   * The `BITMAPS::` enumerator, as the name we vendor its SVG under. Absent on
   * the Version Control rows, which upstream appends with a plain
   * `wxMenu::Append` and no bitmap.
   */
  readonly icon?: string;
  /** True for a row that is ours and has no upstream counterpart. */
  readonly ours?: true;
  /**
   * `vcs_menuitem->Enable( false )`. Only the Version Control submenu greys a
   * row; the popup's own rows are present or absent (see the header).
   */
  readonly disabled?: true;
  /**
   * The label is already in the user's language - a string formatted around
   * one, like "Pull from %s" - or is data, like a branch name: the menu draws
   * it as it is rather than looking it up.
   */
  readonly noTranslate?: true;
  /** `AppendSubMenu` / `Append( id, label, submenu )`. */
  readonly submenu?: TreeMenu;
  /** A quick `Switch to Branch` row's branch (`ID_GIT_SWITCH_BRANCH + ii`). */
  readonly branch?: string;
}

export type TreeMenu = readonly (TreeMenuEntry | 'separator')[];

/** What the Version Control submenu's rows are conditioned on (`onRight`, `:832-850`). */
export interface VcsMenuState {
  /** `vcs_menu = Pgm().GetCommonSettings()->m_Git.enableGit`: no submenu at all when off. */
  readonly enableGit: boolean;
  /** GitHub is connected for this account on this device. */
  readonly connected: boolean;
  /** `vcs_has_repo`: the project is linked to a repository. */
  readonly linked: boolean;
  /** `m_gitCurrentBranchName`. */
  readonly branch?: string;
  /** `m_gitCurrentUpstream`, as `git` shortens it: "origin/main". */
  readonly upstream?: string;
  /** `GitCommon()->GetBranchNames()`: the current branch first. */
  readonly branches?: readonly string[];
}

/**
 * `vcs_submenu` (`:1031-1112`) for a project on GitHub. Every row upstream
 * conditions with `Enable` is greyed, not dropped, as upstream draws it.
 */
export function versionControlSubmenu(vcs: VcsMenuState): TreeMenu {
  const off = (enabled: boolean): { disabled?: true } => (enabled ? {} : { disabled: true });
  const rows: (TreeMenuEntry | 'separator')[] = [];

  // Ours, and one slot for both: connecting until connected, then the way back out.
  if (!vcs.connected) {
    rows.push({
      id: 'connectGithub',
      label: 'Connect GitHub...',
      help: 'Sign in to GitHub, so projects can be pushed to it and pulled from it',
      ours: true,
    });
  } else {
    rows.push({
      id: 'disconnectGithub',
      label: 'Disconnect GitHub',
      help: 'Forget the GitHub connection on this device',
      ours: true,
    });
  }

  // "Add Project to Version Control..." - `Enable( vcs_can_init )`, `vcs_can_init = !vcs_has_repo`.
  rows.push({
    id: 'pushToGithub',
    label: 'Push to GitHub...',
    help: 'Create a repository on GitHub and push this project to it',
    ours: true,
    ...off(!vcs.linked),
  });

  // `Enable( vcs_can_commit )`. Upstream's help is "Commit changes to the local repository";
  // there is no local repository, and this pushes too, so the line says what it does.
  rows.push({
    id: 'gitCommitProject',
    label: _HKI('Commit Project...'),
    help: "Commit the project's changes and push them to GitHub",
    ...off(vcs.linked),
  });

  // `pullLabel`: "Pull from %s" once there is an upstream and a branch, else "Pull" (:1052-1059).
  const named = !!vcs.upstream && !!vcs.branch;
  rows.push({
    id: 'gitPull',
    label: named ? wxFormat(_('Pull from %s'), vcs.upstream!) : _HKI('Pull'),
    help: _HKI('Pull changes from remote repository into local'),
    ...(named ? { noTranslate: true as const } : {}),
    ...off(vcs.linked),
  });

  rows.push('separator');

  // "Skip the first one (that is the current branch)" - at most five quick rows (:1083-1089).
  const branches = vcs.branches ?? [];
  const quick: TreeMenuEntry[] = [];
  for (let ii = 1; ii < branches.length && ii < 6; ++ii) {
    const name = branches[ii]!;
    quick.push({
      id: 'gitSwitchBranch',
      label: name,
      help: _('Switch to branch ') + name,
      noTranslate: true,
      branch: name,
      ...off(vcs.linked),
    });
  }
  rows.push({
    id: 'gitSwitchToBranch',
    label: _HKI('Switch to Branch'),
    help: '',
    submenu: [
      ...quick,
      {
        id: 'gitSwitchBranchOther',
        label: _HKI('Other...'),
        help: _HKI('Switch to a different branch'),
        ...off(vcs.linked),
      },
    ],
  });

  return rows;
}

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
export function projectTreeMenu(
  selection: readonly TreeMenuSelectionItem[],
  /** The open project's Git state; absent, there is no Version Control submenu. */
  vcs?: VcsMenuState | null,
): TreeMenu {
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
      label: _HKI('Switch to this Project'),
      help: _HKI('Close all editors, and switch to the selected project'),
      icon: 'open_project',
    });
    menu.push('separator');
  }

  if (canCreateNewDirectory) {
    menu.push({
      id: 'newDirectory',
      label: _HKI('New Directory...'),
      help: _HKI('Create a New Directory'),
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
      label: _('Edit in a Text Viewer'),
      help: single ? _HKI('Open the file in a Text Editor') : _HKI('Open files in a Text Editor'),
      icon: 'editor',
    });
  }

  // Ours, and the only row here without an upstream counterpart. It is the
  // menu form of the answer `handOffFile` gives to the four Activate branches
  // that end in the operating system: a browser cannot open a file with the
  // system's application, so the most it can do is hand the bytes over.
  //
  // On the root row it is the whole project: that row IS the project, and a .kicad_pro on its own
  // is of no use to anyone - the same zip File > Archive Project makes.
  if (single && selection[0]!.isTreeRoot) {
    menu.push({
      id: 'downloadProject',
      label: 'Download Project...',
      help: 'Save the whole project to your computer as a .zip archive',
      icon: 'export_file',
      ours: true,
    });
  } else if (single) {
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
      label: _HKI('Run Jobs'),
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
      label: single ? _HKI('Rename File...') : _HKI('Rename Files...'),
      help: single ? _HKI('Rename file') : _HKI('Rename files'),
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
      label: _HKI('Move to Trash'),
      help: single
        ? _HKI('Delete the file and its content')
        : _HKI('Delete the files and their contents'),
      icon: 'trash',
    });
  }

  // `if( vcs_menu )` (:1029): a separator, then the submenu, whatever the selection.
  if (vcs?.enableGit) {
    menu.push('separator');
    menu.push({
      id: 'versionControl',
      label: _HKI('Version Control'),
      help: '',
      submenu: versionControlSubmenu(vcs),
    });
  }

  return menu;
}
