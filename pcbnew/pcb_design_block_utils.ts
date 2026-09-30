// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_design_block_utils.cpp`: the board editor's half of design
 * blocks - `SaveBoardAsDesignBlock`, `UpdateDesignBlockFromBoard`,
 * `SaveSelectionAsDesignBlock` and `UpdateDesignBlockFromSelection` - as
 * `PCB_EDIT_FRAME` methods on the live BOARD, mixed into that class like
 * `files.ts` is (`eeschema/sch_design_block_utils.ts` is the schematic twin).
 *
 * Each builds a `DESIGN_BLOCK` (named after the board file, or the selected
 * group), confirms it through the properties dialog, writes the board (or a
 * temporary board of copies of the selection) to a temporary `.kicad_pcb`
 * with `PCB_IO_KICAD_SEXPR`, and saves it into the chosen library through
 * `Prj().DesignBlockLibs()`. Saving a selection that is not already one group
 * then groups it, linked to the new block, in one commit.
 *
 * The modals are the design block pane's (`DESIGN_BLOCK_PANE_DIALOGS`), all
 * asynchronous here.
 */
import { DESIGN_BLOCK } from '@ziroeda/common/design_block.js';
import { SAVE_T } from '@ziroeda/common/design_block_library_adapter.js';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { wxGetTempDir, wxRemoveFile, wxWriteFileSync } from '@ziroeda/common/wx/filefn.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { BOARD } from './board.js';
import { BOARD_COMMIT } from './board_commit.js';
import { BOARD_CONNECTED_ITEM } from './board_connected_item.js';
import type { BOARD_ITEM } from './board_item.js';
import { ADD_MODE } from './board_item_container.js';
import type { FOOTPRINT } from './footprint.js';
import { NETINFO_ITEM } from './netinfo_item.js';
import type { PCB_EDIT_FRAME } from './pcb_edit_frame.js';
import { FormatBoard } from './pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { PCB_GROUP } from './pcb_group.js';

let s_tempCounter = 0;

/** `wxFileName::CreateTempFileName( aPrefix )`: a fresh name in the temp directory. */
function createTempFileName(aPrefix: string): string {
  s_tempCounter += 1;
  return `${wxGetTempDir()}/${aPrefix}${Date.now().toString(36)}${s_tempCounter}`;
}

/** `wxFileNameFromPath( aPath )` then `GetName()`: the base name without its extension. */
function baseName(aPath: string): string {
  const full = aPath.slice(Math.max(aPath.lastIndexOf('/'), aPath.lastIndexOf('\\')) + 1);
  const dot = full.lastIndexOf('.');
  return dot > 0 ? full.slice(0, dot) : full;
}

/** `PCB_EDIT_FRAME`'s `pcb_design_block_utils.cpp` half, mixed into that class by `pcb_edit_frame.ts`. */
export class PCB_DESIGN_BLOCK_UTILS_MIXIN {
  /** `checkOverwriteDb` (pcb_design_block_utils.cpp:62-74). */
  checkOverwriteDb(this: PCB_EDIT_FRAME, aLibname: string, aNewName: string): Promise<boolean> {
    return this.GetDesignBlockPane()!
      .Dialogs()
      .OKOrCancel(
        `Design block '${aNewName}' already exists in library '${aLibname}'.`,
        'Overwrite existing design block?',
        'Overwrite',
      );
  }

  /** `checkOverwriteDbLayout` (:77-89). */
  checkOverwriteDbLayout(this: PCB_EDIT_FRAME, aLibId: LIB_ID): Promise<boolean> {
    return this.GetDesignBlockPane()!
      .Dialogs()
      .OKOrCancel(
        `Design block '${aLibId.GetUniStringLibItemName()}' already has a layout.`,
        'Overwrite existing layout?',
        'Overwrite',
      );
  }

  /**
   * `PCB_EDIT_FRAME::saveBoardAsFile( aBoard, aFileName, aHeadless )` (:92-129):
   * the board written by `PCB_IO_KICAD_SEXPR` at \a aFileName; false, after an
   * error box unless headless, when it could not be.
   */
  saveBoardAsFile(
    this: PCB_EDIT_FRAME,
    aBoard: BOARD,
    aFileName: string,
    aHeadless: boolean,
  ): boolean {
    try {
      const text = FormatBoard(aBoard);

      if (!wxWriteFileSync(aFileName, new TextEncoder().encode(text))) {
        if (!aHeadless)
          this.GetDesignBlockPane()!
            .Dialogs()
            .DisplayError(`Insufficient permissions to write file '${aFileName}'.`);

        return false;
      }
    } catch (e) {
      if (!(e instanceof IO_ERROR)) throw e;

      if (!aHeadless)
        this.GetDesignBlockPane()!
          .Dialogs()
          .DisplayError(`Error saving board file '${aFileName}'.\n${e.message}`);

      return false;
    }

    return true;
  }

  /** `SaveBoardAsDesignBlock( aLibraryName )` (:132-198). */
  async SaveBoardAsDesignBlock(this: PCB_EDIT_FRAME, aLibraryName: string): Promise<boolean> {
    const pane = this.GetDesignBlockPane()!;
    const dialogs = pane.Dialogs();

    // Make sure the user has selected a library to save into
    if (pane.GetSelectedLibId().GetLibNickname() === '') {
      dialogs.DisplayError('Please select a library to save the design block to.');
      return false;
    }

    const blk = new DESIGN_BLOCK();

    blk.SetLibId(new LIB_ID(aLibraryName, baseName(this.GetBoard()!.GetFileName())));

    if (!(await dialogs.DesignBlockProperties(blk, false))) return false;

    const libName = blk.GetLibId().GetLibNickname();
    const newName = blk.GetLibId().GetLibItemName();
    const libs = this.Prj().DesignBlockLibs();

    if (
      libs.DesignBlockExists(libName, newName) &&
      !(await this.checkOverwriteDb(libName, newName))
    )
      return false;

    // Save a temporary copy of the board file, as the plugin is just going to move it
    const tempFile = createTempFileName('design_block');

    if (!this.saveBoardAsFile(this.GetBoard()!, tempFile, false)) {
      dialogs.DisplayError('Error saving temporary board file to create design block.');
      wxRemoveFile(tempFile);
      return false;
    }

    blk.SetBoardFile(tempFile);

    let success = false;

    try {
      success = libs.SaveDesignBlock(aLibraryName, blk) === SAVE_T.SAVE_OK;
    } catch (e) {
      if (!(e instanceof IO_ERROR)) throw e;
      dialogs.DisplayError(e.message);
    }

    // Clean up the temporary file
    wxRemoveFile(tempFile);

    pane.RefreshLibs();
    pane.SelectLibId(blk.GetLibId());

    return success;
  }

  /** `UpdateDesignBlockFromBoard( aLibId )` (:201-262). */
  async UpdateDesignBlockFromBoard(this: PCB_EDIT_FRAME, aLibId: LIB_ID): Promise<boolean> {
    const pane = this.GetDesignBlockPane()!;
    const dialogs = pane.Dialogs();
    const libs = this.Prj().DesignBlockLibs();

    // Make sure the user has selected a library to save into
    if (pane.GetSelectedLibId().GetLibNickname() === '') {
      dialogs.DisplayError('Please select a library to save the design block to.');
      return false;
    }

    let blk: DESIGN_BLOCK | null;

    try {
      blk = libs.LoadDesignBlock(aLibId.GetLibNickname(), aLibId.GetLibItemName());
    } catch (e) {
      if (!(e instanceof IO_ERROR)) throw e;
      dialogs.DisplayError(e.message);
      return false;
    }

    if (!blk) {
      dialogs.DisplayError(`Design block '${aLibId.GetUniStringLibItemName()}' does not exist.`);
      return false;
    }

    if (blk.GetBoardFile() !== '' && !(await this.checkOverwriteDbLayout(aLibId))) return false;

    // Save a temporary copy of the board file, as the plugin is just going to move it
    const tempFile = createTempFileName('design_block');

    if (!this.saveBoardAsFile(this.GetBoard()!, tempFile, false)) {
      dialogs.DisplayError('Error saving temporary board file to create design block.');
      wxRemoveFile(tempFile);
      return false;
    }

    blk.SetBoardFile(tempFile);

    let success = false;

    try {
      success = libs.SaveDesignBlock(aLibId.GetLibNickname(), blk) === SAVE_T.SAVE_OK;
    } catch (e) {
      if (!(e instanceof IO_ERROR)) throw e;
      dialogs.DisplayError(e.message);
    }

    // Clean up the temporary file
    wxRemoveFile(tempFile);

    pane.RefreshLibs();
    pane.SelectLibId(blk.GetLibId());

    return success;
  }

  /**
   * `saveSelectionToDesignBlock( aNickname, aSelection, aBlock )` (:265-390):
   * the selection copied onto a temporary board (nets recreated by name, a
   * group deep-cloned with its children), written to a temporary
   * `.kicad_pcb` and saved into the library.
   */
  async saveSelectionToDesignBlock(
    this: PCB_EDIT_FRAME,
    aNickname: string,
    aSelection: readonly EDA_ITEM[],
    aBlock: DESIGN_BLOCK,
  ): Promise<boolean> {
    const pane = this.GetDesignBlockPane()!;
    const dialogs = pane.Dialogs();

    // Create a temporary board
    const tempBoard = new BOARD();
    tempBoard.SetDesignSettings(this.GetBoard()!.GetDesignSettings());
    tempBoard.SetProject(this.Prj(), true);
    tempBoard.SynchronizeProperties();

    // For copying net info of selected items into the new board
    const addNetIfNeeded = (aItem: EDA_ITEM): void => {
      if (!(aItem instanceof BOARD_CONNECTED_ITEM)) return;

      const netinfo = aItem.GetNet();

      if (netinfo) {
        const existingInfo = tempBoard.FindNet(netinfo.GetNetname());

        // If the net has already been added to the new board, update our info to match
        if (existingInfo) aItem.SetNet(existingInfo);
        else {
          const newNet = new NETINFO_ITEM(tempBoard, netinfo.GetNetname());
          tempBoard.Add(newNet);
          aItem.SetNet(newNet);
        }
      }
    };

    const cloneAndAdd = (aItem: EDA_ITEM): BOARD_ITEM | null => {
      if (!aItem.IsBOARD_ITEM()) return null;

      const copy = aItem.Clone() as BOARD_ITEM;
      tempBoard.Add(copy, ADD_MODE.APPEND, false);
      return copy;
    };

    // Copy the selected items to the temporary board
    for (const item of aSelection) {
      const copy = cloneAndAdd(item);

      if (!copy) continue;

      copy.SetParentGroup(null);

      if (copy.Type() === KICAD_T.PCB_FOOTPRINT_T) {
        (copy as FOOTPRINT).RunOnChildren(addNetIfNeeded, RECURSE_MODE.NO_RECURSE);
      } else if (copy.Type() === KICAD_T.PCB_GROUP_T || copy.Type() === KICAD_T.PCB_GENERATOR_T) {
        // Clone() produces a shallow copy whose m_items still references original
        // children. Replace with DeepClone() which recursively clones all children
        // with correct group membership.
        tempBoard.Remove(copy);

        const deepCopy = (item as PCB_GROUP).DeepClone();

        deepCopy.SetParentGroup(null);
        tempBoard.Add(deepCopy, ADD_MODE.APPEND, false);

        deepCopy.RunOnChildren((child) => {
          tempBoard.Add(child, ADD_MODE.APPEND, false);
          addNetIfNeeded(child);
        }, RECURSE_MODE.RECURSE);
      } else {
        addNetIfNeeded(copy);
      }
    }

    const tempFile = createTempFileName('design_block');

    if (!this.saveBoardAsFile(tempBoard, tempFile, false)) {
      dialogs.DisplayError('Error saving temporary board file to create design block.');
      wxRemoveFile(tempFile);
      return false;
    }

    aBlock.SetBoardFile(tempFile);

    let success = false;

    try {
      success = this.Prj().DesignBlockLibs().SaveDesignBlock(aNickname, aBlock) === SAVE_T.SAVE_OK;
    } catch (e) {
      if (!(e instanceof IO_ERROR)) throw e;
      dialogs.DisplayError(e.message);
    }

    // Clean up the temporary file
    wxRemoveFile(tempFile);

    pane.RefreshLibs();
    pane.SelectLibId(aBlock.GetLibId());

    return success;
  }

  /** `SaveSelectionAsDesignBlock( aLibraryName )` (:393-505). */
  async SaveSelectionAsDesignBlock(this: PCB_EDIT_FRAME, aLibraryName: string): Promise<boolean> {
    const pane = this.GetDesignBlockPane()!;
    const dialogs = pane.Dialogs();

    // Make sure the user has selected a library to save into
    if (pane.GetSelectedLibId().GetLibNickname() === '') {
      dialogs.DisplayError('Please select a library to save the design block to.');
      return false;
    }

    // Get all selected items
    const selection = [...this.GetCurrentSelection().Items()];

    if (selection.length === 0) {
      dialogs.DisplayError('Please select some items to save as a design block.');
      return false;
    }

    const blk = new DESIGN_BLOCK();
    let group: PCB_GROUP | null = null;

    if (selection.length === 1 && selection[0]!.Type() === KICAD_T.PCB_GROUP_T)
      group = selection[0] as PCB_GROUP;

    if (group && group.GetName() !== '') {
      // If the user has selected a single group, they probably want the design block named after the group
      blk.SetLibId(new LIB_ID(aLibraryName, group.GetName()));
    } else {
      // Otherwise, use the current screen name
      blk.SetLibId(new LIB_ID(aLibraryName, baseName(this.GetBoard()!.GetFileName())));
    }

    if (!(await dialogs.DesignBlockProperties(blk, false))) return false;

    const libName = blk.GetLibId().GetLibNickname();
    const newName = blk.GetLibId().GetLibItemName();

    if (
      this.Prj().DesignBlockLibs().DesignBlockExists(libName, newName) &&
      !(await this.checkOverwriteDb(libName, newName))
    )
      return false;

    // If we have a single group, we want to strip the group and select the children
    if (group) {
      selection.splice(selection.indexOf(group), 1);

      // Don't recurse; if we have a group of groups the user probably intends the inner groups to be saved
      group.RunOnChildren((child) => selection.push(child), RECURSE_MODE.NO_RECURSE);
    }

    const success = await this.saveSelectionToDesignBlock(libName, selection, blk);

    if (success && !group) {
      this.groupSelectionAsDesignBlock(selection, blk.GetLibId());
    }

    if (success && group && !group.HasDesignBlockLink()) {
      const commit = new BOARD_COMMIT(this.GetToolManager()!);

      commit.Modify(group, null, RECURSE_MODE.NO_RECURSE);
      group.SetDesignBlockLibId(blk.GetLibId());

      commit.Push('Set Group Design Block Link');
    }

    return success;
  }

  /** `UpdateDesignBlockFromSelection( aLibId )` (:508-641). */
  async UpdateDesignBlockFromSelection(this: PCB_EDIT_FRAME, aLibId: LIB_ID): Promise<boolean> {
    const pane = this.GetDesignBlockPane()!;
    const dialogs = pane.Dialogs();

    // Make sure the user has selected a library to save into
    if (!aLibId.IsValid()) {
      dialogs.DisplayError('Please select a library to save the design block to.');
      return false;
    }

    // Get all selected items
    const selection = [...this.GetCurrentSelection().Items()];

    if (selection.length === 0) {
      dialogs.DisplayError('Please select some items to save as a design block.');
      return false;
    }

    // If we have a single group, we want to strip the group and select the children
    let group: PCB_GROUP | null = null;

    if (selection.length === 1) {
      const item = selection[0]!;

      if (item.Type() === KICAD_T.PCB_GROUP_T || item.Type() === KICAD_T.PCB_GENERATOR_T) {
        group = item as PCB_GROUP;

        selection.splice(0, 1);

        // Don't recurse; if we have a group of groups the user probably intends the inner groups to be saved
        group.RunOnChildren((child) => selection.push(child), RECURSE_MODE.NO_RECURSE);
      }
    }

    let blk: DESIGN_BLOCK | null;

    try {
      blk = this.Prj()
        .DesignBlockLibs()
        .LoadDesignBlock(aLibId.GetLibNickname(), aLibId.GetLibItemName());
    } catch (e) {
      if (!(e instanceof IO_ERROR)) throw e;
      dialogs.DisplayError(e.message);
      return false;
    }

    if (!blk) {
      dialogs.DisplayError(`Design block '${aLibId.GetUniStringLibItemName()}' does not exist.`);
      return false;
    }

    if (blk.GetBoardFile() !== '' && !(await this.checkOverwriteDbLayout(aLibId))) return false;

    if (!(await this.saveSelectionToDesignBlock(aLibId.GetLibNickname(), selection, blk)))
      return false;

    // If we had a group, we need to reselect it
    if (group) {
      this.OnDesignBlockGrouped(group);

      // If we didn't have a design block link before, add one for convenience
      if (!group.HasDesignBlockLink()) {
        const commit = new BOARD_COMMIT(this.GetToolManager()!);

        commit.Modify(group, null, RECURSE_MODE.NO_RECURSE);
        group.SetDesignBlockLibId(aLibId);

        commit.Push('Set Group Design Block Link');
      }
    } else {
      this.groupSelectionAsDesignBlock(selection, aLibId);
    }

    return true;
  }

  /**
   * The tail both "save selection" commands share (:449-491, :583-635): the
   * groupable items of \a aSelection that are not a footprint's children put
   * in a new group named and linked after \a aLibId, as one "Group Items"
   * commit, and selected.
   */
  groupSelectionAsDesignBlock(
    this: PCB_EDIT_FRAME,
    aSelection: readonly EDA_ITEM[],
    aLibId: LIB_ID,
  ): void {
    const commit = new BOARD_COMMIT(this.GetToolManager()!);

    const newGroup = new PCB_GROUP(this.GetBoard());
    newGroup.SetName(aLibId.GetUniStringLibItemName());
    newGroup.SetDesignBlockLibId(aLibId);

    let addedCount = 0;

    for (const edaItem of aSelection) {
      if (!edaItem.IsBOARD_ITEM()) continue;

      const item = edaItem as BOARD_ITEM;

      if (item.GetParentFootprint()) continue;

      if (!item.IsGroupableType()) continue;

      const existingGroup = item.GetParentGroup();

      if (existingGroup) commit.Modify(existingGroup.AsEdaItem(), null, RECURSE_MODE.NO_RECURSE);

      commit.Modify(item, null, RECURSE_MODE.NO_RECURSE);
      newGroup.AddItem(item);
      addedCount++;
    }

    if (addedCount > 0) {
      commit.Add(newGroup);
      commit.Push('Group Items');

      // ACTIONS::selectionClear, then ACTIONS::selectItem( newGroup )
      this.OnDesignBlockGrouped(newGroup);
    } else {
      newGroup.RemoveAll();
    }
  }
}
