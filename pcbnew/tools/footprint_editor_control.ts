// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The footprint tree's right-click menu — `FOOTPRINT_EDITOR_CONTROL::Init`
 * (`pcbnew/tools/footprint_editor_control.cpp:81-171`) plus
 * `LIBRARY_EDITOR_CONTROL::AddContextMenuItems`
 * (`common/tool/library_editor_control.cpp:41-85`), which every library editor
 * appends to its own tree menu.
 *
 * **There was no menu here at all.** Right-clicking a library or a footprint in
 * our tree did nothing; the only tree gesture that existed was a Delete key
 * binding invented for the purpose. Fifteen rows, and the entire second half of
 * what a library editor is for — rename, duplicate, revert, pin — were
 * unreachable.
 *
 * Built through `ui/conditional_menu.ts`, the shared `CONDITIONAL_MENU` port,
 * for the reason that file gives: writing the evaluated shape out by hand is
 * how a menu stops matching, because the conditions end up spelled once in the
 * layout instead of once per row, and separators stop eliding. Two tools
 * contribute to this one menu upstream — the footprint editor's and the shared
 * library editor's — at orders 1/10/100/200/400, and `Evaluate` interleaves
 * them. That is exactly what `AddItem( action, condition, order )` is for.
 *
 * A `.ts`, not part of `FootprintEditor.tsx`, so a test can read the rows.
 */

import { LibTreeNode, LibTreeNodeType } from '@ziroeda/common/lib_tree_model.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { LIBRARY_EDITOR_CONTROL } from '@ziroeda/common/tool/library_editor_control.js';
import type { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import type { TOOL_EVENT } from '@ziroeda/common/tool/tool_event.js';
import { SYNC_HANDLER } from '@ziroeda/common/tool/tool_interactive.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import type { KIID } from '@ziroeda/common/kiid.js';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import { DisplayErrorMessage, DisplayInfoMessage } from '@ziroeda/common/confirm.js';
import { GetAssociatedDocument } from '@ziroeda/common/eda_doc.js';
import { LeaderMode as LEADER_MODE } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import { BOARD_ITEM } from '../board_item.js';
import { FOOTPRINT } from '../footprint.js';
import type { FOOTPRINT_EDIT_FRAME } from '../footprint_edit_frame.js';
import { GetFootprintDocumentationURL } from '../generate_footprint_info.js';
import { PCB_ACTIONS } from './pcb_actions.js';
import { PCB_TOOL_BASE } from './pcb_tool_base.js';
import { BOARD, BOARD_USE } from '../board.js';
import { DIALOG_FOOTPRINT_PROPERTIES_FP_EDITOR } from '../dialogs/dialog_footprint_properties_fp_editor.js';
import type { MenuItem } from '@ziroeda/common/tool/action_menu_types.js';
import { CheckPinnedStatus } from '@ziroeda/common/tool/library_editor_control.js';
import {
  type ConditionalEntry,
  evaluateConditionalMenu,
  menuEntry,
  menuSeparator,
} from '@ziroeda/common/tool/conditional_menu.js';

/**
 * What the tree selection is, which is all four of `Init`'s conditions
 * (:89-111) read off `GetLibTree()->GetSelectedLibId()`.
 */
export interface FpTreeSelection {
  /** `sel.GetLibNickname()` — empty string for no selection. */
  library: string;
  /** `sel.GetLibItemName()` — empty when a library row is selected. */
  footprint: string;
  /** `LIB_TREE_NODE::m_Pinned` for the selected library. */
  pinned: boolean;
}

/**
 * `GetLibTree()->GetSelectedTreeNodes()` for that selection: the one row
 * right-clicked, a LIBRARY node for a library row and an ITEM node for a
 * footprint row; nothing selected is no node.
 */
export function fpTreeSelectedNodes(sel: FpTreeSelection): LibTreeNode[] {
  if (sel.library === '') return [];

  const node = new LibTreeNode();
  node.type = sel.footprint === '' ? LibTreeNodeType.LIBRARY : LibTreeNodeType.ITEM;
  node.libNickname = sel.library;
  node.libItemName = sel.footprint;
  node.name = sel.footprint === '' ? sel.library : sel.footprint;
  node.pinned = sel.pinned;
  return [node];
}

/** The handlers the rows dispatch to, keyed the way the toolbars key ids. */
export interface FpTreeMenuHandlers {
  action: (id: string) => void;
}

/**
 * `fpExportCondition` (:113-118) — `GetBoard()->GetFirstFootprint() != nullptr`.
 * The one condition in this menu that asks about the canvas rather than the
 * tree.
 */
export interface FpTreeMenuConditions {
  haveFootprint: boolean;
}

/**
 * Rows whose command does not exist in this port yet. They are shown, in their
 * upstream position, and greyed — the same treatment `menubar.ts` gives its
 * stubs, and for the same reason: a missing row is a parity gap you cannot see,
 * while a greyed one says what is coming.
 *
 * `CONDITIONAL_MENU` conditions decide whether a row is *present*;
 * `ACTION_CONDITIONS` decides whether it is *enabled*. These are the second
 * kind, so they do not change which rows appear.
 */
const UNIMPLEMENTED = new Set([
  'createFootprint',
  'saveAs',
  'cutFootprint',
  'copyFootprint',
  'pasteFootprint',
  'duplicateFootprint',
  'renameFootprint',
]);

/** One `AddItem( ACTION, condition, order )`, with the action's FriendlyName. */
function row(
  h: FpTreeMenuHandlers,
  label: string,
  id: string,
  when: boolean,
  order: number,
): ConditionalEntry {
  const item: MenuItem = UNIMPLEMENTED.has(id)
    ? { label, icon: id, disabled: true }
    : { label, icon: id, action: () => h.action(id) };
  return menuEntry(item, order, when);
}

/**
 * The menu, evaluated against one tree selection.
 *
 * Every label is the action's `.FriendlyName()`, out of `common/tool/actions.cpp`
 * and `pcbnew/tools/pcb_actions.cpp`: "Delete Footprint from Library", not
 * "Delete"; "Export Current Footprint...", which is a different string from the
 * File > Export submenu's "Footprint..." because that one passes a replacement
 * label to `ACTION_MENU::Add` and this one does not.
 */
export function footprintTreeContextMenu(
  h: FpTreeMenuHandlers,
  sel: FpTreeSelection,
  conds: FpTreeMenuConditions,
): MenuItem[] {
  // :89-111, verbatim. `libInferred` is deliberately looser than `libSelected`:
  // "allows you to do things like New Symbol and Paste with a symbol selected
  // (in other words, when we know the library context even if the library
  // itself isn't selected)".
  const libSelected = sel.library !== '' && sel.footprint === '';
  const libInferred = sel.library !== '';
  const fpSelected = sel.library !== '' && sel.footprint !== '';

  // LIBRARY_EDITOR_CONTROL's `unpinnedLibSelectedCondition` /
  // `pinnedLibSelectedCondition`: only a selected LIBRARY node can fail them,
  // so a footprint row - or no row - shows both.
  const nodes = fpTreeSelectedNodes(sel);

  const entries: ConditionalEntry[] = [
    // --- LIBRARY_EDITOR_CONTROL::AddContextMenuItems, order 1 -----------------
    row(h, 'Pin Library', 'pinLibrary', CheckPinnedStatus(nodes, false), 1),
    row(h, 'Unpin Library', 'unpinLibrary', CheckPinnedStatus(nodes, true), 1),
    menuSeparator(1),

    // --- FOOTPRINT_EDITOR_CONTROL::Init, order 10 ----------------------------
    row(h, 'New Footprint', 'newFootprint', libSelected, 10),
    row(h, 'Create Footprint...', 'createFootprint', libSelected, 10),
    menuSeparator(10),
    row(h, 'Save', 'save', true, 10),
    row(h, 'Save As...', 'saveAs', libSelected || fpSelected, 10),
    row(h, 'Revert', 'revert', libSelected || libInferred, 10),
    menuSeparator(10),
    row(h, 'Cut Footprint', 'cutFootprint', fpSelected, 10),
    row(h, 'Copy Footprint', 'copyFootprint', fpSelected, 10),
    row(h, 'Paste Footprint', 'pasteFootprint', libInferred, 10),
    row(h, 'Duplicate Footprint', 'duplicateFootprint', fpSelected, 10),
    row(h, 'Rename Footprint...', 'renameFootprint', fpSelected, 10),
    row(h, 'Delete Footprint from Library', 'deleteFootprint', fpSelected, 10),
    row(h, 'Footprint Properties...', 'footprintProperties', fpSelected, 10),

    // --- order 100 -----------------------------------------------------------
    menuSeparator(100),
    row(h, 'Import Footprint...', 'importFootprint', libInferred, 100),
    row(h, 'Export Current Footprint...', 'exportFootprint', conds.haveFootprint, 100),

    // NOT here: `ACTIONS::openWithTextEditor` and `ACTIONS::openDirectory` at
    // order 200. Both are behind `ADVANCED_CFG::m_EnableLibWithText` /
    // `m_EnableLibDir`, which default **false** (`advanced_config.cpp:280-281`),
    // so a stock KiCad never draws them — and neither has any meaning in a
    // browser.

    // --- AddContextMenuItems, order 400 --------------------------------------
    menuSeparator(400),
    row(h, 'Hide Library Tree', 'hideLibraryTree', true, 400),
  ];

  return evaluateConditionalMenu(entries);
}

/**
 * `FOOTPRINT_EDITOR_CONTROL` (`pcbnew/tools/footprint_editor_control.cpp`): the
 * footprint editor's library half — new, save, save as, revert, duplicate,
 * rename, delete, cut/copy/paste between libraries, import and export — and
 * the frame toggles and line modes its toolbars run.
 *
 * Not ported:
 * - `CreateFootprint`, the footprint wizard: wizards are Python scripts, and
 *   there is no Python here (`SCRIPTING_TOOL` is not registered either).
 * - `OpenDirectory` / `OpenWithTextEditor`: their rows exist only under
 *   `m_EnableLibDir` / `m_EnableLibWithText`, both off by default, and a
 *   browser has neither a file manager nor a text editor to launch.
 * - `Properties`, `DefaultPadProperties`, `EditTextAndGraphics`,
 *   `CleanupGraphics`, `CheckFootprint` and `CrossProbe`: the dialogs, which
 *   arrive with `OnEditItemRequest` on the frame.
 */
export class FOOTPRINT_EDITOR_CONTROL extends PCB_TOOL_BASE {
  private m_frame: FOOTPRINT_EDIT_FRAME | null = null;

  /** `m_copiedFootprint`: what Cut / Copy Footprint took, for Paste Footprint. */
  private m_copiedFootprint: FOOTPRINT | null = null;

  constructor() {
    super('pcbnew.ModuleEditor');
  }

  override Reset(_aReason: RESET_REASON): void {
    this.m_frame = this.getEditFrame<FOOTPRINT_EDIT_FRAME>();
  }

  override Init(): boolean {
    // The tree's context menu is built by `footprintTreeContextMenu`, which the
    // window evaluates over the same conditions (the menu lives in React).

    // Ensure the left toolbar's Line modes group reflects the current setting at startup
    if (this.m_toolMgr) this.m_toolMgr.RunAction(PCB_ACTIONS.angleSnapModeChanged);

    return true;
  }

  /** `tryToSaveFootprintInLibrary( aFootprint, aTargetLib )` (:174-209). */
  private async tryToSaveFootprintInLibrary(
    aFootprint: FOOTPRINT,
    aTargetLib: LIB_ID,
  ): Promise<void> {
    const frame = this.m_frame!;
    const libraryName = aTargetLib.GetUniStringLibNickname();

    if (aTargetLib.GetLibNickname() === '') {
      // Do nothing - the footprint will need to be saved manually to assign
      // to a library.
    } else {
      if (!(frame.FootprintLibAdapter()?.IsFootprintLibWritable?.(libraryName) ?? false)) {
        // If the library is not writeable, we'll give the user a
        // footprint not in a library. But add a warning to let them know
        // they didn't quite get what they wanted.
        frame.ShowInfoBarWarning(
          `The footprint could not be added to the selected library ('${libraryName}'). ` +
            'This library is read-only.',
          false,
        );
        // And the footprint will need to be saved manually
      } else {
        // Go ahead and save it to the library
        const fpid = aFootprint.GetFPID();
        fpid.SetLibNickname(aTargetLib.GetLibNickname());
        aFootprint.SetFPID(fpid);
        await frame.SaveFootprint(aFootprint);
        frame.ClearModify();
      }
    }
  }

  /** `NewFootprint` (:212-245). */
  NewFootprint(_aEvent: TOOL_EVENT): number {
    void this.newFootprint();
    return 0;
  }

  private async newFootprint(): Promise<void> {
    const frame = this.m_frame!;
    const selected = frame.GetTargetFPID();
    const libraryName = selected.GetUniStringLibNickname();

    if (!(await frame.Clear_Pcb(true))) return;

    const newFootprint = frame.CreateNewFootprint('', libraryName);

    if (!newFootprint) return;

    this.canvas()?.GetViewControls().SetCrossHairCursorPosition({ x: 0, y: 0 }, false);
    frame.AddFootprintToBoard(newFootprint);

    // Initialize data relative to nets and netclasses (for a new footprint the defaults are
    // used).  This is mandatory to handle and draw pads.
    this.board().BuildListOfNets();
    newFootprint.SetPosition({ x: 0, y: 0 });
    newFootprint.ClearFlags();

    frame.Zoom_Automatique(false);
    frame.GetScreen()?.SetContentModified();

    await this.tryToSaveFootprintInLibrary(newFootprint, selected);

    frame.UpdateView();
    frame.GetCanvas()?.ForceRefresh();
    frame.Update3DView(true, true);

    frame.SyncLibraryTree(false);
  }

  /** `Save` (:309-328). */
  Save(_aEvent: TOOL_EVENT): number {
    void this.save();
    return 0;
  }

  private async save(): Promise<void> {
    const frame = this.m_frame!;
    const footprint = this.footprint();

    // no loaded footprint
    if (!footprint) return;

    if (frame.GetTargetFPID().equals(frame.GetLoadedFPID())) {
      if (await frame.SaveFootprint(footprint)) {
        this.view()?.Update(footprint);

        this.canvas()?.ForceRefresh();
        frame.ClearModify();
        frame.UpdateTitle();
      }
    }

    frame.RefreshLibraryTree();
  }

  /**
   * `SaveAs` (:331-377). A library row's Save As is `SaveLibraryAs`, which is
   * not ported: a library here is a project folder, copied with the project.
   */
  SaveAs(_aEvent: TOOL_EVENT): number {
    void this.saveAs();
    return 0;
  }

  private async saveAs(): Promise<void> {
    const frame = this.m_frame!;
    const footprint = this.footprint();

    if (frame.GetTargetFPID().GetLibItemName() === '') {
      // Save Library As: not ported (see above).
    } else if (frame.GetTargetFPID().equals(frame.GetLoadedFPID())) {
      // Save Footprint As
      if (footprint && (await frame.SaveFootprintAs(footprint))) {
        this.view()?.Update(footprint);
        frame.ClearModify();

        // Get rid of the save-will-update-board-only (or any other dismissable warning)
        frame.DismissInfoBar();

        this.canvas()?.ForceRefresh();
        frame.SyncLibraryTree(true);
      }
    } else {
      // Save Selected Footprint As
      const selected = await frame.LoadFootprint(frame.GetTargetFPID());

      if (selected && (await frame.SaveFootprintAs(selected))) {
        frame.SyncLibraryTree(true);
        frame.FocusOnLibID(selected.GetFPID());
      }
    }

    frame.RefreshLibraryTree();
  }

  /** `Revert` (:380-384). */
  Revert(_aEvent: TOOL_EVENT): number {
    void this.getEditFrame<FOOTPRINT_EDIT_FRAME>().RevertFootprint();
    return 0;
  }

  /** `CutCopyFootprint` (:387-405). */
  CutCopyFootprint(aEvent: TOOL_EVENT): number {
    void this.cutCopyFootprint(aEvent);
    return 0;
  }

  private async cutCopyFootprint(aEvent: TOOL_EVENT): Promise<void> {
    const frame = this.m_frame!;
    const fpID = frame.GetLibTree()?.GetSelectedLibId() ?? new LIB_ID();

    if (fpID.equals(frame.GetLoadedFPID())) {
      this.m_copiedFootprint = FOOTPRINT.copyOfFootprint(frame.GetBoard()!.GetFirstFootprint()!);
      this.m_copiedFootprint.SetParent(null);
    } else {
      this.m_copiedFootprint = await frame.LoadFootprint(fpID);
    }

    if (aEvent.IsAction(PCB_ACTIONS.cutFootprint)) await this.deleteFootprint();
  }

  /** `PasteFootprint` (:408-428). */
  PasteFootprint(_aEvent: TOOL_EVENT): number {
    void this.pasteFootprint();
    return 0;
  }

  private async pasteFootprint(): Promise<void> {
    const frame = this.m_frame!;
    const newLib = frame.GetLibTree()?.GetSelectedLibId().GetLibNickname() ?? '';

    if (this.m_copiedFootprint && newLib !== '') {
      const adapter = frame.FootprintLibAdapter();
      let newName = this.m_copiedFootprint.GetFPID().GetLibItemName();

      while (adapter?.FootprintExists(newLib, newName)) newName += '_copy';

      this.m_copiedFootprint.SetFPID(new LIB_ID(newLib, newName));
      await frame.SaveFootprintInLibrary(this.m_copiedFootprint, newLib);

      frame.SyncLibraryTree(true);
      await frame.LoadFootprintFromLibrary(this.m_copiedFootprint.GetFPID());
      frame.FocusOnLibID(this.m_copiedFootprint.GetFPID());
      frame.RefreshLibraryTree();
    }
  }

  /** `DuplicateFootprint` (:431-450). */
  DuplicateFootprint(_aEvent: TOOL_EVENT): number {
    void this.duplicateFootprint();
    return 0;
  }

  private async duplicateFootprint(): Promise<void> {
    const frame = this.m_frame!;
    const fpID = frame.GetLibTree()?.GetSelectedLibId() ?? new LIB_ID();
    let footprint: FOOTPRINT | null;

    if (fpID.equals(frame.GetLoadedFPID()))
      footprint = FOOTPRINT.copyOfFootprint(frame.GetBoard()!.GetFirstFootprint()!);
    else footprint = await frame.LoadFootprint(frame.GetTargetFPID());

    if (footprint && (await frame.DuplicateFootprint(footprint))) {
      frame.SyncLibraryTree(true);
      await frame.LoadFootprintFromLibrary(footprint.GetFPID());
      frame.FocusOnLibID(footprint.GetFPID());
      frame.RefreshLibraryTree();
    }
  }

  /** `RenameFootprint` (:453-551). */
  RenameFootprint(_aEvent: TOOL_EVENT): number {
    void this.renameFootprint();
    return 0;
  }

  private async renameFootprint(): Promise<void> {
    const frame = this.m_frame!;
    const libTool = this.m_toolMgr!.GetTool(LIBRARY_EDITOR_CONTROL)!;
    const adapter = frame.FootprintLibAdapter();

    const fpID = frame.GetLibTree()?.GetSelectedLibId() ?? new LIB_ID();
    const libraryName = fpID.GetLibNickname();
    const oldName = fpID.GetLibItemName();
    let newName = '';

    if (
      !(await libTool.RenameLibrary(
        'Change Footprint Name',
        oldName,
        async (aNewName: string): Promise<boolean> => {
          newName = aNewName;

          if (newName === '') {
            await DisplayInfoMessage('Footprint must have a name.');
            return false;
          }

          // If no change, accept it without prompting
          if (oldName !== newName && adapter?.FootprintExists(libraryName, newName)) {
            const msg = `Footprint '${newName}' already exists in library '${libraryName}'.`;

            const answer = await frame.AskKiDialog({
              caption: 'Confirmation',
              message: msg,
              icon: 'warning',
              labels: { ok: 'Overwrite' },
            });

            return answer === 'ok';
          }

          return true;
        },
      ))
    ) {
      return; // canceled by user
    }

    if (newName === oldName) return;

    let footprint: FOOTPRINT | null = null;

    if (fpID.equals(frame.GetLoadedFPID())) {
      footprint = frame.GetBoard()!.GetFirstFootprint();

      if (footprint) {
        footprint.SetFPID(new LIB_ID(libraryName, newName));

        if (footprint.GetValue() === oldName) footprint.SetValue(newName);

        frame.OnModify();
        frame.UpdateView();
      }
    } else {
      footprint = await frame.LoadFootprint(fpID);

      if (footprint) {
        try {
          footprint.SetFPID(new LIB_ID(libraryName, newName));

          if (footprint.GetValue() === oldName) footprint.SetValue(newName);

          await frame.SaveFootprintInLibrary(footprint, libraryName);

          adapter?.DeleteFootprint?.(libraryName, oldName);
        } catch (ioe) {
          if (ioe instanceof IO_ERROR) DisplayErrorMessage('Error renaming footprint', ioe.What());
          // catch( ... ): Best efforts...
        }
      }
    }

    if (footprint) {
      // `UpdateLibraryTree( treeItem, footprint )`: the row renamed in place.
      frame.SyncLibraryTree(true);
      frame.FocusOnLibID(new LIB_ID(libraryName, newName));
    }
  }

  /** `DeleteFootprint` (:554-567). */
  DeleteFootprint(_aEvent: TOOL_EVENT): number {
    void this.deleteFootprint();
    return 0;
  }

  private async deleteFootprint(): Promise<void> {
    const frame = this.getEditFrame<FOOTPRINT_EDIT_FRAME>();

    if (await frame.DeleteFootprintFromLibrary(frame.GetTargetFPID(), true)) {
      if (frame.GetTargetFPID().equals(frame.GetLoadedFPID())) await frame.Clear_Pcb(false);

      frame.SyncLibraryTree(true);
    }
  }

  /** `ImportFootprint` (:570-595). */
  ImportFootprint(_aEvent: TOOL_EVENT): number {
    void this.importFootprint();
    return 0;
  }

  private async importFootprint(): Promise<void> {
    const frame = this.m_frame!;

    if (!(await frame.Clear_Pcb(true))) return; // this command is aborted

    this.canvas()?.GetViewControls().SetCrossHairCursorPosition({ x: 0, y: 0 }, false);
    await frame.ImportFootprint();

    frame.GetBoard()!.GetFirstFootprint()?.ClearFlags();

    frame.ClearUndoRedoList();

    // `ReCreateMenuBar()` / `ReCreateHToolbar()` after a board footprint: the
    // window's bars re-read the frame on every render.

    this.m_toolMgr!.RunAction(ACTIONS.zoomFitScreen);
    frame.OnModify();
  }

  /** `ExportFootprint` (:598-604). */
  ExportFootprint(_aEvent: TOOL_EVENT): number {
    const fp = this.m_frame!.GetBoard()!.GetFirstFootprint();

    if (fp) void this.m_frame!.ExportFootprint(fp);

    return 0;
  }

  /** `ShowDatasheet` (:704-723). */
  ShowDatasheet(_aEvent: TOOL_EVENT): number {
    const frame = this.m_frame!;
    const footprint = frame.GetBoard()!.GetFirstFootprint();

    if (footprint) {
      const url = GetFootprintDocumentationURL(footprint);

      if (url === null) {
        this.frame().ShowInfoBarMsg('No datasheet found in the footprint.');
      } else {
        // Only absolute URLs are supported
        GetAssociatedDocument(url, null, [
          frame.GetBoard()!.GetEmbeddedFiles(),
          footprint.GetEmbeddedFiles(),
        ]);
      }
    }

    return 0;
  }

  /** `EditFootprint` (:726-730). */
  EditFootprint(_aEvent: TOOL_EVENT): number {
    const frame = this.m_frame!;

    void frame.LoadFootprintFromLibrary(frame.GetLibTree()?.GetSelectedLibId() ?? new LIB_ID());
    return 0;
  }

  /** `EditLibraryFootprint` (:733-749). */
  EditLibraryFootprint(_aEvent: TOOL_EVENT): number {
    const frame = this.m_frame!;
    const footprint = frame.GetBoard()!.GetFirstFootprint();

    if (!footprint || !frame.IsCurrentFPFromBoard()) {
      // wxBell()
      return 0;
    }

    void frame.LoadFootprintFromLibrary(footprint.GetFPID()).then(() => {
      if (!frame.IsLibraryTreeShown()) frame.ToggleLibraryTree();
    });

    return 0;
  }

  /** `ToggleLayersManager` (:752-756). */
  ToggleLayersManager(_aEvent: TOOL_EVENT): number {
    this.m_frame!.ToggleLayersManager();
    return 0;
  }

  /** `ToggleProperties` (:759-763). */
  ToggleProperties(_aEvent: TOOL_EVENT): number {
    this.m_frame!.ToggleProperties();
    return 0;
  }

  /**
   * `Properties` (:766-791): from the tree's menu on a footprint other than the
   * one on the canvas, its properties straight out of the library; else the
   * loaded footprint's, through OnEditItemRequest.
   */
  Properties(aEvent: TOOL_EVENT): number {
    const frame = this.m_frame!;

    // Check if called from tree context menu
    if (aEvent.IsAction(PCB_ACTIONS.footprintProperties)) {
      const treeLibId = frame.GetLibTree()?.GetSelectedLibId() ?? new LIB_ID();
      const loaded = frame.GetBoard()!.GetFirstFootprint();

      // Check if a different footprint is selected in the tree
      if (treeLibId.IsValid() && (!loaded || !loaded.GetFPID().equals(treeLibId))) {
        // Edit properties directly from library without loading to canvas
        void this.editFootprintPropertiesFromLibrary(treeLibId);
        return 0;
      }
    }

    const footprint = frame.GetBoard()!.GetFirstFootprint();

    if (footprint) {
      this.getEditFrame<FOOTPRINT_EDIT_FRAME>().OnEditItemRequest(footprint);
      frame.GetCanvas()?.Refresh();
    }

    return 0;
  }

  /**
   * `editFootprintPropertiesFromLibrary( aLibId )` (:794-851): the library's
   * footprint on a temporary holder board, the dialog over it, and on OK the
   * edited footprint saved back to its library.
   */
  private async editFootprintPropertiesFromLibrary(aLibId: LIB_ID): Promise<void> {
    const frame = this.m_frame!;

    // Load the footprint from the library (without adding it to the canvas)
    const libraryFootprint = await frame.LoadFootprint(aLibId);

    if (!libraryFootprint) return;

    // Create a temporary board to hold the footprint (required by the dialog)
    const tempBoard = new BOARD();
    tempBoard.SetBoardUse(BOARD_USE.FPHOLDER);

    // Create a copy to work with and add it to the temporary board
    const tempFootprint = FOOTPRINT.copyOfFootprint(libraryFootprint);
    tempBoard.Add(tempFootprint);

    const oldFPID = tempFootprint.GetFPID();
    const dialog = new DIALOG_FOOTPRINT_PROPERTIES_FP_EDITOR(frame, tempFootprint);

    if (!(await frame.ShowFootprintPropertiesFpEditorDialog(dialog))) return;

    // Remove from temporary board before saving (to avoid double-delete)
    tempBoard.Remove(tempFootprint);

    // Save the modified footprint back to the library
    const adapter = frame.FootprintLibAdapter();
    const libName = aLibId.GetLibNickname();

    try {
      adapter?.SaveFootprint?.(libName, tempFootprint, true);

      // Update the tree view: `UpdateLibraryTree( FindItem( oldFPID ), tempFootprint )`.
      void oldFPID;
      frame.SyncLibraryTree(true);
    } catch (ioe) {
      if (!(ioe instanceof IO_ERROR)) throw ioe;

      DisplayErrorMessage(ioe.What());
    }
  }

  RepairFootprint(_aEvent: TOOL_EVENT): number {
    const footprint = this.board().Footprints()[0];

    if (!footprint) return 0;

    let errors = 0;
    let details = '';

    // Repair duplicate IDs and missing nets.
    const ids = new Set<KIID>();
    let duplicates = 0;

    const processItem = (aItem: EDA_ITEM): void => {
      if (ids.has(aItem.m_Uuid)) {
        duplicates++;

        // `boardItem->ResetUuid()`, whose SetUuid also re-keys the board's item
        // index: that half is not committed yet, so the KIID is replaced directly.
        if (aItem instanceof BOARD_ITEM) aItem.ResetUuidDirect();
      }

      ids.add(aItem.m_Uuid);
    };

    // Footprint IDs are the most important, so give them the first crack at "claiming" a
    // particular KIID.

    processItem(footprint);

    // After that the principal use is for DRC marker pointers, which are most likely to pads.

    for (const pad of footprint.Pads()) processItem(pad);

    // From here out I don't think order matters much.

    processItem(footprint.Reference());
    processItem(footprint.Value());

    for (const item of footprint.GraphicalItems()) processItem(item);

    for (const zone of footprint.Zones()) processItem(zone);

    for (const group of footprint.Groups()) processItem(group);

    if (duplicates) {
      errors += duplicates;
      details += `${duplicates} duplicate IDs replaced.\n`;
    }

    if (errors) {
      this.m_frame!.OnModify();

      const msg = `${errors} potential problems repaired.`;
      void DisplayInfoMessage(msg, details);
    } else {
      void DisplayInfoMessage('No footprint problems found.');
    }

    return 0;
  }

  protected override setTransitions(): void {
    const S = SYNC_HANDLER<FOOTPRINT_EDITOR_CONTROL>;

    this.Go(S(this.NewFootprint), PCB_ACTIONS.newFootprint.MakeEvent());
    this.Go(S(this.Save), ACTIONS.save.MakeEvent());
    this.Go(S(this.SaveAs), ACTIONS.saveAs.MakeEvent());
    this.Go(S(this.Revert), ACTIONS.revert.MakeEvent());
    this.Go(S(this.DuplicateFootprint), PCB_ACTIONS.duplicateFootprint.MakeEvent());
    this.Go(S(this.RenameFootprint), PCB_ACTIONS.renameFootprint.MakeEvent());
    this.Go(S(this.DeleteFootprint), PCB_ACTIONS.deleteFootprint.MakeEvent());

    this.Go(S(this.EditFootprint), PCB_ACTIONS.editFootprint.MakeEvent());
    this.Go(S(this.EditLibraryFootprint), PCB_ACTIONS.editLibFpInFpEditor.MakeEvent());
    this.Go(S(this.CutCopyFootprint), PCB_ACTIONS.cutFootprint.MakeEvent());
    this.Go(S(this.CutCopyFootprint), PCB_ACTIONS.copyFootprint.MakeEvent());
    this.Go(S(this.PasteFootprint), PCB_ACTIONS.pasteFootprint.MakeEvent());

    this.Go(S(this.ImportFootprint), PCB_ACTIONS.importFootprint.MakeEvent());
    this.Go(S(this.ExportFootprint), PCB_ACTIONS.exportFootprint.MakeEvent());

    this.Go(S(this.ShowDatasheet), ACTIONS.showDatasheet.MakeEvent());

    this.Go(S(this.RepairFootprint), PCB_ACTIONS.repairFootprint.MakeEvent());

    this.Go(S(this.Properties), PCB_ACTIONS.footprintProperties.MakeEvent());

    this.Go(S(this.ToggleLayersManager), PCB_ACTIONS.showLayersManager.MakeEvent());
    this.Go(S(this.ToggleProperties), ACTIONS.showProperties.MakeEvent());

    // Line modes for the footprint editor: explicit modes, next-mode, and toolbar sync
    this.Go(S(this.ChangeLineMode), PCB_ACTIONS.lineModeFree.MakeEvent());
    this.Go(S(this.ChangeLineMode), PCB_ACTIONS.lineMode90.MakeEvent());
    this.Go(S(this.ChangeLineMode), PCB_ACTIONS.lineMode45.MakeEvent());
    this.Go(S(this.OnAngleSnapModeChanged), PCB_ACTIONS.angleSnapModeChanged.MakeEvent());
  }

  /** `ChangeLineMode` (:1023-1030). */
  ChangeLineMode(aEvent: TOOL_EVENT): number {
    const mode = aEvent.Parameter<LEADER_MODE>();
    this.getEditFrame<FOOTPRINT_EDIT_FRAME>().GetFootprintEditorSettings().m_AngleSnapMode = mode;
    this.m_toolMgr!.PostAction(ACTIONS.refreshPreview);
    this.m_toolMgr!.RunAction(PCB_ACTIONS.angleSnapModeChanged);
    return 0;
  }

  /** `OnAngleSnapModeChanged` (:1032-1050). */
  OnAngleSnapModeChanged(_aEvent: TOOL_EVENT): number {
    const f = this.getEditFrame<FOOTPRINT_EDIT_FRAME>();

    if (!f) return 0;

    const mode = f.GetFootprintEditorSettings().m_AngleSnapMode;

    switch (mode) {
      case LEADER_MODE.DIRECT:
        f.SelectToolbarAction(PCB_ACTIONS.lineModeFree);
        break;
      case LEADER_MODE.DEG90:
        f.SelectToolbarAction(PCB_ACTIONS.lineMode90);
        break;
      default:
        f.SelectToolbarAction(PCB_ACTIONS.lineMode45);
        break;
    }

    return 0;
  }
}
