// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Assign Footprints (cvpcb) commands: what the OK button, the save button, the
 * unsaved-changes prompt, Delete All and Enter actually do.
 *
 * These are the commands, not the helpers under them. The four defects this
 * covers all lived in closures inside the dialog component and all read as
 * "working" from the helper level: the association helper was fine, it was
 * `Associate` that had grown a guard `AssociateFootprint` does not have; the
 * save helper was fine, it was the OK button that asked it to write files.
 *
 * Counterparts: `cvpcb/tools/cvpcb_association_tool.cpp`,
 * `cvpcb/tools/cvpcb_control.cpp`, `cvpcb/cvpcb_mainframe.cpp` and
 * `cvpcb/readwrite_dlgs.cpp`.
 */
import { describe, it, expect, vi } from 'vitest';
import type { CvpcbComponent } from '@ziroeda/designer/src/editors/schematic/cvpcb_components.js';
import {
  associate,
  closeWindow,
  deleteAll,
  deleteAssoc,
  emptyAssociations,
  footprintOf,
  gotoNA,
  markSaved,
  okCommand,
  redoAssociation,
  resolveUnsavedChanges,
  saveAndContinueCommand,
  saveToSchematicCommand,
  undoAssociation,
  DELETE_ALL_CONFIRMATION,
  SCHEMATIC_SAVED_STATUS,
  UNSAVED_ASSOCIATIONS_MESSAGE,
  type CvpcbAssociations,
} from '@ziroeda/designer/src/editors/schematic/cvpcb_commands.js';
import {
  handleUnsavedChanges,
  UNSAVED_CHANGES_DISCARD_LABEL,
  UNSAVED_CHANGES_EXTENDED,
  UNSAVED_CHANGES_SAVE_LABEL,
  UNSAVED_CHANGES_TITLE,
} from '@ziroeda/designer/src/ui/confirm.js';

const comp = (reference: string, footprint = ''): CvpcbComponent => ({
  reference,
  value: '',
  footprint,
  fpFilters: [],
  pinCount: 0,
  instances: [{ file: 'sheet.kicad_sch', id: reference }],
});

/** R1 assigned, R2 and R3 not. */
const SHEET: CvpcbComponent[] = [comp('R1', 'Resistor:R_0805'), comp('R2'), comp('R3')];

const at = (selected: number): CvpcbAssociations => emptyAssociations(selected);

const fpids = (state: CvpcbAssociations, components: readonly CvpcbComponent[]): string[] =>
  components.map((c) => footprintOf(state, c));

// ---------------------------------------------------------------------------
// A1: what "save" means, and what OK is allowed to do
// ---------------------------------------------------------------------------

describe('save commands (SaveFootprintAssociation)', () => {
  it('OK hands the links to eeschema and does NOT write the schematic files', () => {
    // cvpcb_mainframe.cpp:341-346 runs saveAssociationsToSchematic, which is
    // SaveFootprintAssociation( false ): MAIL_ASSIGN_FOOTPRINTS only. Writing
    // the files here would take the assignment off eeschema's undo stack.
    const cmd = okCommand();
    expect(cmd.effect.assign).toBe(true);
    expect(cmd.effect.saveSchematic).toBe(false);
    expect(cmd.close).toBe(true);
  });

  it('"Apply, Save Schematic & Continue" is the only command that writes files', () => {
    // cvpcb_mainframe.cpp:330-336 -> saveAssociationsToFile ->
    // SaveFootprintAssociation( true ), which also mails MAIL_SCH_SAVE.
    const cmd = saveAndContinueCommand();
    expect(cmd.effect.saveSchematic).toBe(true);
    expect(cmd.close).toBe(false);

    // Every other save path leaves the files alone.
    expect(okCommand().effect.saveSchematic).toBe(false);
    expect(saveToSchematicCommand().effect.saveSchematic).toBe(false);
    expect(resolveUnsavedChanges('save').effect?.saveSchematic).toBe(false);
  });

  it('File > Save to Schematic assigns without closing', () => {
    const cmd = saveToSchematicCommand();
    expect(cmd.effect.assign).toBe(true);
    expect(cmd.close).toBe(false);
  });

  // C7
  it('a save-and-continue reports "Schematic saved" on status line 2', () => {
    // readwrite_dlgs.cpp:297-301, inside the doSaveSchematic branch.
    expect(saveAndContinueCommand().effect.status).toBe(SCHEMATIC_SAVED_STATUS);
    expect(SCHEMATIC_SAVED_STATUS).toBe('Schematic saved');
  });

  it('a save that does not write the files reports nothing', () => {
    expect(okCommand().effect.status).toBeNull();
    expect(saveToSchematicCommand().effect.status).toBeNull();
  });

  it('a save clears the modified flag', () => {
    const saved = markSaved(associate(at(0), SHEET, 'Resistor:R_0603'));
    expect(saved.modified).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// A2: the unsaved-changes prompt
// ---------------------------------------------------------------------------

describe('canCloseWindow / HandleUnsavedChanges', () => {
  it('closes without asking when nothing was modified', () => {
    expect(closeWindow(false)).toEqual({ prompt: false, close: true });
  });

  it('asks before closing when the links were modified', () => {
    // cvpcb_mainframe.cpp:391-403.
    expect(closeWindow(true)).toEqual({ prompt: true, close: false });
  });

  it('modifying an association is what makes it ask', () => {
    const before = at(0);
    expect(closeWindow(before.modified).prompt).toBe(false);
    const after = associate(before, SHEET, 'Resistor:R_0603');
    expect(closeWindow(after.modified).prompt).toBe(true);
  });

  it('Cancel keeps the window open and saves nothing', () => {
    expect(resolveUnsavedChanges('cancel')).toEqual({ close: false, effect: null });
  });

  it('Discard Changes closes and saves nothing', () => {
    expect(resolveUnsavedChanges('discard')).toEqual({ close: true, effect: null });
  });

  it('Save closes after handing the links to eeschema', () => {
    const { close, effect } = resolveUnsavedChanges('save');
    expect(close).toBe(true);
    expect(effect).not.toBeNull();
    expect(effect?.assign).toBe(true);
    // canCloseWindow's save function is SaveFootprintAssociation( false ).
    expect(effect?.saveSchematic).toBe(false);
  });

  it('HandleUnsavedChanges runs the save only for Save, and only proceeds if it worked', () => {
    const save = vi.fn(() => true);
    expect(handleUnsavedChanges('save', save)).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);

    expect(handleUnsavedChanges('discard', save)).toBe(true);
    expect(handleUnsavedChanges('cancel', save)).toBe(false);
    expect(save).toHaveBeenCalledTimes(1);

    // A failed save must not close the window on the user's behalf.
    expect(handleUnsavedChanges('save', () => false)).toBe(false);
  });

  it("asks upstream's question, with a Save answer among the buttons", () => {
    expect(UNSAVED_ASSOCIATIONS_MESSAGE).toBe(
      'Symbol to Footprint links have been modified. Save changes?',
    );
    expect(UNSAVED_CHANGES_TITLE).toBe('Save Changes?');
    expect(UNSAVED_CHANGES_EXTENDED).toBe(
      "If you don't save, all your changes will be permanently lost.",
    );
    expect(UNSAVED_CHANGES_SAVE_LABEL).toBe('Save');
    expect(UNSAVED_CHANGES_DISCARD_LABEL).toBe('Discard Changes');
  });
});

// ---------------------------------------------------------------------------
// A3: Delete All
// ---------------------------------------------------------------------------

describe('DeleteAll', () => {
  it('does nothing when the confirmation is declined', () => {
    const before = associate(at(1), SHEET, 'Resistor:R_0603');
    const isOk = vi.fn(() => false);
    const after = deleteAll(before, SHEET, isOk);
    expect(isOk).toHaveBeenCalledWith(DELETE_ALL_CONFIRMATION);
    expect(DELETE_ALL_CONFIRMATION).toBe('Delete all associations?');
    expect(after).toBe(before);
    expect(fpids(after, SHEET)).toEqual(['Resistor:R_0805', 'Resistor:R_0603', '']);
  });

  it('asks even when nothing is assigned', () => {
    // cvpcb_association_tool.cpp:230 has no "is there anything to delete"
    // guard; ours returned early and the button silently did nothing.
    const nothing = [comp('R1'), comp('R2')];
    const isOk = vi.fn(() => false);
    deleteAll(at(0), nothing, isOk);
    expect(isOk).toHaveBeenCalledWith(DELETE_ALL_CONFIRMATION);
  });

  it('clears every association as one undo step once confirmed', () => {
    const before = associate(at(1), SHEET, 'Resistor:R_0603');
    const after = deleteAll(before, SHEET, () => true);
    expect(fpids(after, SHEET)).toEqual(['', '', '']);
    expect(after.undoStack.length).toBe(before.undoStack.length + 1);
    expect(after.undoStack[after.undoStack.length - 1]?.length).toBe(SHEET.length);
  });

  it('selects the first symbol afterwards', () => {
    // SetSelectedComponent( -1, true ) then SetSelectedComponent( 0 ).
    const after = deleteAll(at(2), SHEET, () => true);
    expect(after.selected).toBe(0);
  });

  it('selects nothing when there are no symbols', () => {
    // SetSelectedComponent( 0 ) is a no-op past the end of the list.
    expect(deleteAll(at(0), [], () => true).selected).toBe(-1);
  });

  it('one undo puts every association back', () => {
    const before = associate(at(1), SHEET, 'Resistor:R_0603');
    const cleared = deleteAll(before, SHEET, () => true);
    const undone = undoAssociation(cleared, SHEET);
    expect(fpids(undone, SHEET)).toEqual(['Resistor:R_0805', 'Resistor:R_0603', '']);
    expect(fpids(redoAssociation(undone, SHEET), SHEET)).toEqual(['', '', '']);
  });
});

// ---------------------------------------------------------------------------
// A4: Associate, and the gotoNextNA it posts
// ---------------------------------------------------------------------------

describe('Associate', () => {
  it('advances even when the symbol already has that footprint', () => {
    // AssociateFootprint has no "already assigned" guard, and
    // CVPCB_ASSOCIATION_TOOL::Associate posts gotoNextNA unconditionally, so
    // Enter on the footprint R1 already has accepts it and moves to R2.
    const after = associate(at(0), SHEET, 'Resistor:R_0805');
    expect(after.selected).toBe(1);
    expect(fpids(after, SHEET)).toEqual(['Resistor:R_0805', '', '']);
  });

  it('records the re-assignment rather than dropping it', () => {
    const after = associate(at(0), SHEET, 'Resistor:R_0805');
    expect(after.modified).toBe(true);
    expect(after.undoStack.length).toBe(1);
    expect(after.undoStack[0]).toEqual([
      { reference: 'R1', from: 'Resistor:R_0805', to: 'Resistor:R_0805' },
    ]);
  });

  it('assigns a new footprint and moves to the next unassigned symbol', () => {
    const after = associate(at(1), SHEET, 'Resistor:R_0603');
    expect(fpids(after, SHEET)).toEqual(['Resistor:R_0805', 'Resistor:R_0603', '']);
    expect(after.selected).toBe(2);
  });

  it('ignores an empty footprint (nothing selected in the footprint pane)', () => {
    const before = at(1);
    expect(associate(before, SHEET, '')).toBe(before);
  });

  it('does not wrap past the last unassigned symbol', () => {
    // CVPCB_CONTROL::ToNA leaves the selection alone when the forward scan
    // finds nothing, so finishing the board does not send you back to the top.
    const after = associate(at(2), SHEET, 'Resistor:R_0603');
    expect(after.selected).toBe(2);
  });

  it('assigning back to the schematic value keeps the frame modified', () => {
    // m_modified is set by AssociateFootprint before anything else, and only a
    // save clears it.
    const changed = associate(at(0), SHEET, 'Resistor:R_0603');
    const back = associate({ ...changed, selected: 0 }, SHEET, 'Resistor:R_0805');
    expect(footprintOf(back, SHEET[0]!)).toBe('Resistor:R_0805');
    expect(back.modified).toBe(true);
  });
});

describe('DeleteAssoc and ToNA', () => {
  it('clears the selected symbol without moving the selection', () => {
    const after = deleteAssoc(at(0), SHEET);
    expect(fpids(after, SHEET)).toEqual(['', '', '']);
    expect(after.selected).toBe(0);
  });

  it('walks the unassigned symbols in both directions without wrapping', () => {
    expect(gotoNA(at(0), SHEET, 1).selected).toBe(1);
    expect(gotoNA(at(1), SHEET, 1).selected).toBe(2);
    expect(gotoNA(at(2), SHEET, 1).selected).toBe(2);
    expect(gotoNA(at(2), SHEET, -1).selected).toBe(1);
    expect(gotoNA(at(1), SHEET, -1).selected).toBe(1);
  });
});
