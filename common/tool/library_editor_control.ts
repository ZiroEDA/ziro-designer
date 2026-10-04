// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `LIBRARY_EDITOR_CONTROL` (`common/tool/library_editor_control.cpp`,
 * `common/tool/library_editor_control.h`): the library-tree half both library
 * editors share - Pin / Unpin Library, show / hide / search the tree, and the
 * rename prompt. `symbol_edit_frame.cpp:435` and `footprint_edit_frame.cpp:1242`
 * register it; `SYMBOL_EDITOR_CONTROL::Init` and `FOOTPRINT_EDITOR_CONTROL::Init`
 * call `AddContextMenuItems` to put its rows into their own tree menu.
 *
 * `RenameLibrary` shows `RENAME_DIALOG`, a `wxTextEntryDialog` whose
 * `TransferDataFromWindow` is the caller's validator. A modal here cannot
 * block, so it resolves a promise; the dialog is drawn by whoever called
 * `SetRenameDialogPresenter`, the way `COMMON_CONTROL`'s frames present
 * Preferences.
 */
import type { EDA_DRAW_FRAME } from '../eda_draw_frame.js';
import { FACE_T, KIWAY } from '../kiway.js';
import { type LibTreeNode, LibTreeNodeType } from '../lib_tree_model.js';
import { LIB_TYPE_T } from '../project.js';
import { ACTIONS } from './actions.js';
import type { CONDITIONAL_MENU } from './conditional_menu.js';
import type { SELECTION } from './selection.js';
import { SELECTION_CONDITIONS } from './selection_conditions.js';
import type { RESET_REASON } from './tool_base.js';
import type { TOOL_EVENT } from './tool_event.js';
import { SYNC_HANDLER, TOOL_INTERACTIVE } from './tool_interactive.js';

/**
 * `wxString::Trim( true ).Trim( false )`: wx's Trim strips `" \t\r\n"` (and
 * `\v`, `\f`) - `wxSafeIsspace` - from the named end.
 */
function wxTrimBoth(aText: string): string {
  return aText.replace(/^[ \t\r\n\v\f]+|[ \t\r\n\v\f]+$/g, '');
}

/**
 * `RENAME_DIALOG` (`library_editor_control.cpp:171-187`): a
 * `wxTextEntryDialog( aParent, _( "New name:" ), aTitle, aName )` whose OK
 * runs the validator on the trimmed text and stays open when it says no.
 */
export class RENAME_DIALOG {
  static readonly MESSAGE = 'New name:';

  /**
   * @param m_validator may itself ask a modal question — FOOTPRINT_EDITOR_CONTROL's
   *        asks "Overwrite" with a KIDIALOG — so it may answer later.
   */
  constructor(
    readonly aTitle: string,
    readonly aName: string,
    private readonly m_validator: (aNewName: string) => boolean | Promise<boolean>,
  ) {}

  /** `TransferDataFromWindow() override`: false keeps the dialog open. */
  TransferDataFromWindow(aValue: string): boolean | Promise<boolean> {
    return this.m_validator(wxTrimBoth(aValue));
  }
}

/**
 * Show a RENAME_DIALOG and resolve true on `wxID_OK`: OK is only returned once
 * `TransferDataFromWindow` has accepted the text.
 */
export type RENAME_DIALOG_PRESENTER = (aDialog: RENAME_DIALOG) => Promise<boolean>;

let s_renamePresenter: RENAME_DIALOG_PRESENTER | null = null;

/** Install the view that draws RENAME_DIALOG. */
export function SetRenameDialogPresenter(aPresenter: RENAME_DIALOG_PRESENTER | null): void {
  s_renamePresenter = aPresenter;
}

/**
 * The selected rows `changeSelectedPinStatus` acts on: LIBRARY nodes whose
 * `m_Pinned` is not already @p aPin. Symbol and footprint rows are never
 * among them, whichever library they sit in.
 */
export function LibrariesToRepin(
  aSelection: readonly (LibTreeNode | null)[],
  aPin: boolean,
): LibTreeNode[] {
  const out: LibTreeNode[] = [];

  for (const lib of aSelection) {
    if (lib && lib.type === LibTreeNodeType.LIBRARY && lib.pinned !== aPin) out.push(lib);
  }

  return out;
}

/**
 * `AddContextMenuItems`' `checkPinnedStatus` lambda for a tree that exists:
 * true unless a selected LIBRARY node's pin state differs from @p aPin. So a
 * selection with no library node in it - a symbol or footprint row, or
 * nothing - passes for both states, and the menu shows Pin Library and Unpin
 * Library together.
 */
export function CheckPinnedStatus(
  aSelection: readonly (LibTreeNode | null)[],
  aPin: boolean,
): boolean {
  return LibrariesToRepin(aSelection, aPin).length === 0;
}

export class LIBRARY_EDITOR_CONTROL extends TOOL_INTERACTIVE {
  private m_frame: EDA_DRAW_FRAME | null;

  constructor() {
    super('common.LibraryEditorControl');
    this.m_frame = null;
  }

  private frame(): EDA_DRAW_FRAME {
    return this.m_frame!;
  }

  /// @copydoc TOOL_INTERACTIVE::Reset()
  override Reset(_aReason: RESET_REASON): void {
    this.m_frame = this.getEditFrame<EDA_DRAW_FRAME>();
  }

  /** The `checkPinnedStatus` lambda: {@link CheckPinnedStatus}, and false with no tree. */
  checkPinnedStatus(aPin: boolean): boolean {
    const libTree = this.frame().GetLibTree();

    if (!libTree) return false;

    const selection: LibTreeNode[] = [];
    libTree.GetSelectedTreeNodes(selection);

    return CheckPinnedStatus(selection, aPin);
  }

  AddContextMenuItems(aMenu: CONDITIONAL_MENU): void {
    const pinnedLibSelectedCondition = (_aSel: SELECTION): boolean => this.checkPinnedStatus(true);

    const unpinnedLibSelectedCondition = (_aSel: SELECTION): boolean =>
      this.checkPinnedStatus(false);

    aMenu.AddItem(ACTIONS.pinLibrary, unpinnedLibSelectedCondition, 1);
    aMenu.AddItem(ACTIONS.unpinLibrary, pinnedLibSelectedCondition, 1);
    aMenu.AddSeparator(1);

    aMenu.AddSeparator(400);
    aMenu.AddItem(ACTIONS.hideLibraryTree, SELECTION_CONDITIONS.ShowAlways, 400);
  }

  PinLibrary(_aEvent: TOOL_EVENT): number {
    this.changeSelectedPinStatus(true);

    return 0;
  }

  UnpinLibrary(_aEvent: TOOL_EVENT): number {
    this.changeSelectedPinStatus(false);

    return 0;
  }

  ToggleLibraryTree(_aEvent: TOOL_EVENT): number {
    this.frame().ToggleLibraryTree();
    return 0;
  }

  LibraryTreeSearch(_aEvent: TOOL_EVENT): number {
    if (!this.frame().IsLibraryTreeShown()) this.frame().ToggleLibraryTree();

    this.frame().FocusLibraryTreeInput();
    return 0;
  }

  /** `dlg.ShowModal() == wxID_OK`; false when nothing can present the dialog. */
  RenameLibrary(
    aTitle: string,
    aName: string,
    aValidator: (aNewName: string) => boolean | Promise<boolean>,
  ): Promise<boolean> {
    const dlg = new RENAME_DIALOG(aTitle, aName, aValidator);

    return s_renamePresenter ? s_renamePresenter(dlg) : Promise.resolve(false);
  }

  private changeSelectedPinStatus(aPin: boolean): void {
    const libTree = this.frame().GetLibTree();

    if (libTree) {
      const selection: LibTreeNode[] = [];
      libTree.GetSelectedTreeNodes(selection);

      for (const lib of LibrariesToRepin(selection, aPin)) {
        const kifaceType = KIWAY.KifaceType(this.frame().GetFrameType());

        if (kifaceType === FACE_T.FACE_SCH || kifaceType === FACE_T.FACE_PCB) {
          const libType =
            kifaceType === FACE_T.FACE_SCH ? LIB_TYPE_T.SYMBOL_LIB : LIB_TYPE_T.FOOTPRINT_LIB;

          if (aPin) this.frame().Prj().PinLibrary(lib.libNickname, libType);
          else this.frame().Prj().UnpinLibrary(lib.libNickname, libType);

          lib.pinned = aPin;
        } else {
          console.assert(false, 'Unsupported frame type for library pinning.');
        }
      }

      this.regenerateLibraryTree();
    }
  }

  /// Set up handlers for various events.
  protected setTransitions(): void {
    this.Go(SYNC_HANDLER(this.PinLibrary), ACTIONS.pinLibrary.MakeEvent());
    this.Go(SYNC_HANDLER(this.UnpinLibrary), ACTIONS.unpinLibrary.MakeEvent());
    this.Go(SYNC_HANDLER(this.ToggleLibraryTree), ACTIONS.showLibraryTree.MakeEvent());
    this.Go(SYNC_HANDLER(this.ToggleLibraryTree), ACTIONS.hideLibraryTree.MakeEvent());
    this.Go(SYNC_HANDLER(this.LibraryTreeSearch), ACTIONS.libraryTreeSearch.MakeEvent());
  }

  private regenerateLibraryTree(): void {
    const libTree = this.frame().GetLibTree()!;
    const target = this.frame().GetTargetLibId();

    libTree.Regenerate(true);

    if (target.IsValid()) libTree.CenterLibId(target);
  }
}
