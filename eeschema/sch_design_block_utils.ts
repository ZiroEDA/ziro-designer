// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/sch_design_block_utils.cpp`: the schematic editor's half of design
 * blocks — `SaveSheetAsDesignBlock`, `UpdateDesignBlockFromSheet`,
 * `SaveSelectionAsDesignBlock` and `UpdateDesignBlockFromSelection` — as
 * `SCH_EDIT_FRAME` methods on the live model, mixed into that class like
 * `schematic_undo_redo.ts` is.
 *
 * Each builds a `DESIGN_BLOCK` (from the sheet's fields, or named after the
 * selected group or the screen), confirms it through the properties dialog,
 * writes the sheet (or a temporary sheet of copies of the selection) to a
 * temporary `.kicad_sch`, and saves it into the chosen library through
 * `Prj().DesignBlockLibs()`. Saving a selection that is not already one group
 * then groups it, linked to the new block.
 *
 * The modals are the design block pane's (`DESIGN_BLOCK_PANE_DIALOGS`), all
 * asynchronous here.
 */
import { DESIGN_BLOCK } from '@ziroeda/common/design_block.js';
import { SAVE_T } from '@ziroeda/common/design_block_library_adapter.js';
import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { wxGetTempDir, wxRemoveFile, wxWriteFileSync } from '@ziroeda/common/wx/filefn.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { SCH_COMMIT } from './sch_commit.js';
import type { SCH_EDIT_FRAME } from './sch_edit_frame.js';
import { SCH_GROUP } from './sch_group.js';
import type { SCH_ITEM } from './sch_item.js';
import { SCH_IO_KICAD_SEXPR } from './sch_io/kicad_sexpr/sch_io_kicad_sexpr.js';
import { SCH_SCREEN } from './sch_screen.js';
import { SCH_SHEET } from './sch_sheet.js';
import { SCH_SHEET_PATH } from './sch_sheet_path.js';

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

/** `SCH_EDIT_FRAME`'s `sch_design_block_utils.cpp` half, mixed into that class by `sch_edit_frame.ts`. */
export class SCH_DESIGN_BLOCK_UTILS_MIXIN {
  /** `checkOverwriteDb` (sch_design_block_utils.cpp:46-59). */
  checkOverwriteDb(this: SCH_EDIT_FRAME, aLibname: string, aNewName: string): Promise<boolean> {
    return this.GetDesignBlockPane()!
      .Dialogs()
      .OKOrCancel(
        `Design block '${aNewName}' already exists in library '${aLibname}'.`,
        'Overwrite existing design block?',
        'Overwrite',
      );
  }

  /** `checkOverwriteDbSchematic` (:62-74). */
  checkOverwriteDbSchematic(this: SCH_EDIT_FRAME, aLibId: LIB_ID): Promise<boolean> {
    return this.GetDesignBlockPane()!
      .Dialogs()
      .OKOrCancel(
        `Design block '${aLibId.GetUniStringLibItemName()}' already has a schematic.`,
        'Overwrite existing schematic?',
        'Overwrite',
      );
  }

  /**
   * `SCH_EDIT_FRAME::saveSchematicFile( aSheet, aSavePath )` as these callers
   * use it: the sheet written as a `.kicad_sch` at \a aSavePath.
   */
  saveDesignBlockSchematic(this: SCH_EDIT_FRAME, aSheet: SCH_SHEET, aSavePath: string): boolean {
    try {
      const text = new SCH_IO_KICAD_SEXPR().SaveSchematicFile(aSheet, this.Schematic());
      return wxWriteFileSync(aSavePath, new TextEncoder().encode(text));
    } catch (e) {
      if (!(e instanceof IO_ERROR)) throw e;
      return false;
    }
  }

  /** `SaveSheetAsDesignBlock( aLibraryName, aSheetPath )` (:77-152). */
  async SaveSheetAsDesignBlock(
    this: SCH_EDIT_FRAME,
    aLibraryName: string,
    aSheetPath: SCH_SHEET_PATH,
  ): Promise<boolean> {
    const pane = this.GetDesignBlockPane()!;
    const dialogs = pane.Dialogs();

    // Make sure the user has selected a library to save into
    if (pane.GetSelectedLibId().GetLibNickname() === '') {
      dialogs.DisplayError('Please select a library to save the design block to.');
      return false;
    }

    // Just block all attempts to create design blocks with nested sheets at this point
    const sheets: SCH_ITEM[] = [];
    aSheetPath.LastScreen()!.GetSheets(sheets);

    if (sheets.length > 0) {
      dialogs.DisplayError('Design blocks with nested sheets are not supported.');
      return false;
    }

    const blk = new DESIGN_BLOCK();

    blk.SetLibId(new LIB_ID(aLibraryName, baseName(aSheetPath.Last()!.GetName())));

    // Copy all fields from the sheet to the design block
    for (const field of aSheetPath.Last()!.GetFields()) {
      if (field.GetId() === FIELD_T.SHEET_NAME || field.GetId() === FIELD_T.SHEET_FILENAME)
        continue;

      blk.GetFields().set(field.GetCanonicalName(), field.GetText());
    }

    if (!(await dialogs.DesignBlockProperties(blk, false))) return false;

    const libName = blk.GetLibId().GetLibNickname();
    const newName = blk.GetLibId().GetLibItemName();
    const libs = this.Prj().DesignBlockLibs();

    if (
      libs.DesignBlockExists(libName, newName) &&
      !(await this.checkOverwriteDb(libName, newName))
    )
      return false;

    // Save a temporary copy of the schematic file, as the plugin is just going to move it
    const tempFile = createTempFileName('design_block');

    if (!this.saveDesignBlockSchematic(aSheetPath.Last()!, tempFile)) {
      dialogs.DisplayError('Error saving temporary schematic file to create design block.');
      wxRemoveFile(tempFile);
      return false;
    }

    blk.SetSchematicFile(tempFile);

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

  /** `UpdateDesignBlockFromSheet( aLibId, aSheetPath )` (:155-242). */
  async UpdateDesignBlockFromSheet(
    this: SCH_EDIT_FRAME,
    aLibId: LIB_ID,
    aSheetPath: SCH_SHEET_PATH,
  ): Promise<boolean> {
    const pane = this.GetDesignBlockPane()!;
    const dialogs = pane.Dialogs();
    const libs = this.Prj().DesignBlockLibs();

    // Make sure the user has selected a library to save into
    if (!libs.DesignBlockExists(aLibId.GetLibNickname(), aLibId.GetLibItemName())) {
      dialogs.DisplayError('Please select a design block to save the schematic to.');
      return false;
    }

    // Just block all attempts to create design blocks with nested sheets at this point
    const sheets: SCH_ITEM[] = [];
    aSheetPath.LastScreen()!.GetSheets(sheets);

    if (sheets.length > 0) {
      dialogs.DisplayError('Design blocks with nested sheets are not supported.');
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

    if (blk.GetSchematicFile() !== '' && !(await this.checkOverwriteDbSchematic(aLibId)))
      return false;

    // Copy all fields from the sheet to the design block.
    // Note: this will overwrite any existing fields in the design block, but
    // will leave extra fields not in this source sheet alone.
    for (const field of aSheetPath.Last()!.GetFields()) {
      if (field.GetId() === FIELD_T.SHEET_NAME || field.GetId() === FIELD_T.SHEET_FILENAME)
        continue;

      blk.GetFields().set(field.GetCanonicalName(), field.GetText());
    }

    if (!(await dialogs.DesignBlockProperties(blk, true))) return false;

    // Save a temporary copy of the schematic file, as the plugin is just going to move it
    const tempFile = createTempFileName('design_block');

    if (!this.saveDesignBlockSchematic(aSheetPath.Last()!, tempFile)) {
      dialogs.DisplayError('Error saving temporary schematic file to create design block.');
      wxRemoveFile(tempFile);
      return false;
    }

    blk.SetSchematicFile(tempFile);

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
   * The temporary sheet `SaveSelectionAsDesignBlock` and
   * `UpdateDesignBlockFromSelection` write: copies of \a aSelection (a group
   * deep-copied with its children, a symbol with its fields and pins, pins and
   * fields on their own skipped) on a fresh screen.
   */
  selectionSheet(this: SCH_EDIT_FRAME, aSelection: readonly EDA_ITEM[]): SCH_SHEET {
    // Create a temporary screen
    const tempScreen = new SCH_SCREEN(this.Schematic());

    // Copy the selected items to the temporary screen
    for (const item of aSelection) {
      // We need to deep copy since selections of groups will not have the children
      if (item.Type() === KICAD_T.SCH_GROUP_T) {
        const clonedGroup = (item as SCH_GROUP).DeepClone();

        tempScreen.Append(clonedGroup);

        clonedGroup.RunOnChildren(
          (child) => tempScreen.Append(child as SCH_ITEM),
          RECURSE_MODE.RECURSE,
        );
      } else if (item.Type() === KICAD_T.SCH_SYMBOL_T) {
        tempScreen.Append(item.Clone() as SCH_ITEM);
      } else if (item.Type() === KICAD_T.SCH_PIN_T || item.Type() === KICAD_T.SCH_FIELD_T) {
        // Handled as symbol children
        continue;
      } else {
        tempScreen.Append(item.Clone() as SCH_ITEM);
      }
    }

    // Create a sheet for the temporary screen
    const tempSheet = new SCH_SHEET(this.Schematic());
    tempSheet.SetScreen(tempScreen);
    return tempSheet;
  }

  /** `SaveSelectionAsDesignBlock( aLibraryName )` (:245-453). */
  async SaveSelectionAsDesignBlock(this: SCH_EDIT_FRAME, aLibraryName: string): Promise<boolean> {
    const pane = this.GetDesignBlockPane()!;
    const dialogs = pane.Dialogs();

    // Get all selected items
    const selection = [...this.GetCurrentSelection().Items()];

    if (selection.length === 0) {
      dialogs.DisplayError('Please select some items to save as a design block.');
      return false;
    }

    // Make sure the user has selected a library to save into
    if (pane.GetSelectedLibId().GetLibNickname() === '') {
      dialogs.DisplayError('Please select a library to save the design block to.');
      return false;
    }

    // Just block all attempts to create design blocks with nested sheets at this point
    if (selection.some((i) => i.Type() === KICAD_T.SCH_SHEET_T)) {
      if (selection.length === 1) {
        const curPath = new SCH_SHEET_PATH(this.GetCurrentSheet());

        curPath.push_back(selection[0] as SCH_SHEET);
        await this.SaveSheetAsDesignBlock(aLibraryName, curPath);
      } else {
        dialogs.DisplayError('Design blocks with nested sheets are not supported.');
      }

      return false;
    }

    const blk = new DESIGN_BLOCK();
    let group: SCH_GROUP | null = null;

    if (selection.length === 1 && selection[0]!.Type() === KICAD_T.SCH_GROUP_T)
      group = selection[0] as SCH_GROUP;

    if (group && group.GetName() !== '') {
      // If the user has selected a single group, they probably want the design block named after the group
      blk.SetLibId(new LIB_ID(aLibraryName, group.GetName()));
    } else {
      // Otherwise, use the current screen name
      blk.SetLibId(new LIB_ID(aLibraryName, baseName(this.GetScreen()!.GetFileName())));
    }

    if (!(await dialogs.DesignBlockProperties(blk, false))) return false;

    const libName = blk.GetLibId().GetLibNickname();
    const newName = blk.GetLibId().GetLibItemName();
    const libs = this.Prj().DesignBlockLibs();

    if (
      libs.DesignBlockExists(libName, newName) &&
      !(await this.checkOverwriteDb(libName, newName))
    )
      return false;

    // If we have a single group, we want to strip the group and select the children
    if (group) {
      selection.splice(selection.indexOf(group), 1);

      // Don't recurse; if we have a group of groups the user probably intends the inner groups to be saved
      group.RunOnChildren((child) => selection.push(child), RECURSE_MODE.NO_RECURSE);
    }

    const tempSheet = this.selectionSheet(selection);

    // Save a temporary copy of the schematic file, as the plugin is just going to move it
    const tempFile = createTempFileName('design_block');

    if (!this.saveDesignBlockSchematic(tempSheet, tempFile)) {
      dialogs.DisplayError('Error saving temporary schematic file to create design block.');
      wxRemoveFile(tempFile);
      return false;
    }

    blk.SetSchematicFile(tempFile);

    let success = false;

    try {
      success = libs.SaveDesignBlock(aLibraryName, blk) === SAVE_T.SAVE_OK;
    } catch (e) {
      if (!(e instanceof IO_ERROR)) throw e;
      dialogs.DisplayError(e.message);
    }

    if (success && !group) {
      this.groupSelectionAsDesignBlock(selection, blk.GetLibId());
    } else if (success && group && !group.HasDesignBlockLink()) {
      const commit = new SCH_COMMIT(this.GetToolManager()!);

      commit.Modify(group, this.GetScreen());
      group.SetDesignBlockLibId(blk.GetLibId());

      commit.Push('Set Group Design Block Link');
    }

    // Clean up the temporaries
    wxRemoveFile(tempFile);

    pane.RefreshLibs();
    pane.SelectLibId(blk.GetLibId());

    return success;
  }

  /** `UpdateDesignBlockFromSelection( aLibId )` (:456-667). */
  async UpdateDesignBlockFromSelection(this: SCH_EDIT_FRAME, aLibId: LIB_ID): Promise<boolean> {
    const pane = this.GetDesignBlockPane()!;
    const dialogs = pane.Dialogs();
    const libs = this.Prj().DesignBlockLibs();

    // Get all selected items
    const selection = [...this.GetCurrentSelection().Items()];

    if (selection.length === 0) {
      dialogs.DisplayError('Please select some items to save as a design block.');
      return false;
    }

    // Make sure the user has selected a library to save into
    if (!libs.DesignBlockExists(aLibId.GetLibNickname(), aLibId.GetLibItemName())) {
      dialogs.DisplayError('Please select a design block to save the schematic to.');
      return false;
    }

    // Just block all attempts to create design blocks with nested sheets at this point
    if (selection.some((i) => i.Type() === KICAD_T.SCH_SHEET_T)) {
      if (selection.length === 1) {
        const curPath = new SCH_SHEET_PATH(this.GetCurrentSheet());

        curPath.push_back(selection[0] as SCH_SHEET);
        await this.UpdateDesignBlockFromSheet(aLibId, curPath);
      } else {
        dialogs.DisplayError('Design blocks with nested sheets are not supported.');
      }

      return false;
    }

    // If we have a single group, we want to strip the group and select the children
    let group: SCH_GROUP | null = null;

    if (selection.length === 1 && selection[0]!.Type() === KICAD_T.SCH_GROUP_T) {
      group = selection[0] as SCH_GROUP;

      selection.splice(0, 1);

      // Don't recurse; if we have a group of groups the user probably intends the inner groups to be saved
      group.RunOnChildren((child) => selection.push(child), RECURSE_MODE.NO_RECURSE);
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

    if (blk.GetSchematicFile() !== '' && !(await this.checkOverwriteDbSchematic(aLibId)))
      return false;

    // Create a temporary screen
    const tempScreen = new SCH_SCREEN(this.Schematic());

    const cloneAndAdd = (aItem: EDA_ITEM): SCH_ITEM | null => {
      if (!aItem.IsSCH_ITEM()) return null;

      const copy = aItem.Clone() as SCH_ITEM;
      tempScreen.Append(copy);
      return copy;
    };

    // Copy the selected items to the temporary board
    for (const item of selection) {
      // Remove parent group membership since we strip the first group layer
      cloneAndAdd(item)?.SetParentGroup(null);

      if (item.Type() === KICAD_T.SCH_GROUP_T) {
        // Groups also need their children copied
        (item as SCH_GROUP).RunOnChildren((child) => void cloneAndAdd(child), RECURSE_MODE.RECURSE);
      }
    }

    // Create a sheet for the temporary screen
    const tempSheet = new SCH_SHEET(this.Schematic());
    tempSheet.SetScreen(tempScreen);

    // Save a temporary copy of the schematic file, as the plugin is just going to move it
    const tempFile = createTempFileName('design_block');

    if (!this.saveDesignBlockSchematic(tempSheet, tempFile)) {
      dialogs.DisplayError('Error saving temporary schematic file to create design block.');
      wxRemoveFile(tempFile);
      return false;
    }

    blk.SetSchematicFile(tempFile);

    let success = false;

    try {
      success = libs.SaveDesignBlock(aLibId.GetLibNickname(), blk) === SAVE_T.SAVE_OK;

      // If we had a group, we need to reselect it
      if (group) {
        selection.length = 0;
        selection.push(group);

        // If we didn't have a design block link before, add one for convenience
        if (!group.HasDesignBlockLink()) {
          const commit = new SCH_COMMIT(this.GetToolManager()!);

          commit.Modify(group, this.GetScreen());
          group.SetDesignBlockLibId(aLibId);

          commit.Push('Set Group Design Block Link');
        }
      }
    } catch (e) {
      if (!(e instanceof IO_ERROR)) throw e;
      dialogs.DisplayError(e.message);
    }

    if (success && !group) this.groupSelectionAsDesignBlock(selection, aLibId);

    // Clean up the temporaries
    wxRemoveFile(tempFile);

    pane.RefreshLibs();
    pane.SelectLibId(blk.GetLibId());

    return success;
  }

  /**
   * The tail both "save selection" commands share (:376-420, :614-653): the
   * groupable, parentless items of \a aSelection put in a new group named and
   * linked after \a aLibId, as one "Group Items" commit, and selected.
   */
  groupSelectionAsDesignBlock(
    this: SCH_EDIT_FRAME,
    aSelection: readonly EDA_ITEM[],
    aLibId: LIB_ID,
  ): void {
    const commit = new SCH_COMMIT(this.GetToolManager()!);
    const screen = this.GetScreen()!;

    const newGroup = new SCH_GROUP();
    newGroup.SetParent(screen);
    newGroup.SetName(aLibId.GetUniStringLibItemName());
    newGroup.SetDesignBlockLibId(aLibId);

    let addedCount = 0;

    for (const edaItem of aSelection) {
      if (!edaItem.IsSCH_ITEM()) continue;

      const item = edaItem as SCH_ITEM;

      if (item.GetParentSymbol()) continue;

      if (!item.IsGroupableType()) continue;

      const existingGroup = item.GetParentGroup();

      if (existingGroup) commit.Modify(existingGroup.AsEdaItem(), screen, RECURSE_MODE.NO_RECURSE);

      commit.Modify(item, screen, RECURSE_MODE.NO_RECURSE);
      newGroup.AddItem(item);
      addedCount++;
    }

    if (addedCount > 0) {
      commit.Add(newGroup, screen);
      commit.Push('Group Items');

      // ACTIONS::selectionClear, then ACTIONS::selectItem( newGroup )
      this.OnDesignBlockGrouped(newGroup);
    } else {
      newGroup.RemoveAll();
    }
  }
}
