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
  changeFocus,
  closeWindow,
  copyAssoc,
  cutAssoc,
  deleteAll,
  deleteAssoc,
  emptyAssociations,
  footprintOf,
  gotoNA,
  markSaved,
  okCommand,
  pasteAssoc,
  redoAssociation,
  resolveUnsavedChanges,
  saveAndContinueCommand,
  saveToSchematicCommand,
  selectedComponent,
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

const at = (...selected: number[]): CvpcbAssociations => emptyAssociations(selected);

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
    expect(selectedComponent(after)).toBe(0);
  });

  it('selects nothing when there are no symbols', () => {
    // SetSelectedComponent( 0 ) is a no-op past the end of the list.
    expect(selectedComponent(deleteAll(at(0), [], () => true))).toBe(-1);
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
    expect(selectedComponent(after)).toBe(1);
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
    expect(selectedComponent(after)).toBe(2);
  });

  it('ignores an empty footprint (nothing selected in the footprint pane)', () => {
    const before = at(1);
    expect(associate(before, SHEET, '')).toBe(before);
  });

  it('does not wrap past the last unassigned symbol', () => {
    // CVPCB_CONTROL::ToNA leaves the selection alone when the forward scan
    // finds nothing, so finishing the board does not send you back to the top.
    const after = associate(at(2), SHEET, 'Resistor:R_0603');
    expect(selectedComponent(after)).toBe(2);
  });

  it('assigning back to the schematic value keeps the frame modified', () => {
    // m_modified is set by AssociateFootprint before anything else, and only a
    // save clears it.
    const changed = associate(at(0), SHEET, 'Resistor:R_0603');
    const back = associate({ ...changed, selection: [0] }, SHEET, 'Resistor:R_0805');
    expect(footprintOf(back, SHEET[0]!)).toBe('Resistor:R_0805');
    expect(back.modified).toBe(true);
  });
});

describe('DeleteAssoc and ToNA', () => {
  it('clears the selected symbol without moving the selection', () => {
    const after = deleteAssoc(at(0), SHEET);
    expect(fpids(after, SHEET)).toEqual(['', '', '']);
    expect(selectedComponent(after)).toBe(0);
  });

  it('walks the unassigned symbols in both directions without wrapping', () => {
    expect(selectedComponent(gotoNA(at(0), SHEET, 1))).toBe(1);
    expect(selectedComponent(gotoNA(at(1), SHEET, 1))).toBe(2);
    expect(selectedComponent(gotoNA(at(2), SHEET, 1))).toBe(2);
    expect(selectedComponent(gotoNA(at(2), SHEET, -1))).toBe(1);
    expect(selectedComponent(gotoNA(at(1), SHEET, -1))).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// B3: the symbols pane is multi-select, and the commands honour it
// ---------------------------------------------------------------------------

describe('a multi-row symbol selection', () => {
  // Twelve decoupling capacitors and a resistor, none assigned.
  const CAPS: CvpcbComponent[] = [];
  for (let i = 1; i <= 12; i++) CAPS.push(comp(`C${i}`));
  CAPS.push(comp('R1'));

  it('assigns the footprint to every selected symbol', () => {
    // CVPCB_ASSOCIATION_TOOL::Associate loops over
    // GetComponentIndices( SEL_COMPONENTS ). Testing the selection *state*
    // instead would pass while this loop still read only the first row.
    const after = associate(at(0, 1, 2, 3), CAPS, 'Capacitor_SMD:C_0805');
    expect(fpids(after, CAPS).slice(0, 5)).toEqual([
      'Capacitor_SMD:C_0805',
      'Capacitor_SMD:C_0805',
      'Capacitor_SMD:C_0805',
      'Capacitor_SMD:C_0805',
      '',
    ]);
  });

  it('records the whole batch as ONE undo entry', () => {
    // `bool firstAssoc = true; … firstAssoc = false;` is AssociateFootprint's
    // aNewEntry, so twelve capacitors are one Ctrl+Z, not twelve.
    const after = associate(at(0, 1, 2, 3, 4, 5), CAPS, 'Capacitor_SMD:C_0805');
    expect(after.undoStack.length).toBe(1);
    expect(after.undoStack[0]?.length).toBe(6);
  });

  it('and one undo puts all of them back', () => {
    const after = associate(at(0, 1, 2), CAPS, 'Capacitor_SMD:C_0805');
    expect(fpids(undoAssociation(after, CAPS), CAPS).slice(0, 3)).toEqual(['', '', '']);
  });

  it('still advances to the next unassigned symbol afterwards', () => {
    // gotoNextNA runs after the whole loop and off GetFirstSelected, the
    // lowest selected row — so from 0, skipping the three it just assigned.
    const after = associate(at(0, 1, 2), CAPS, 'Capacitor_SMD:C_0805');
    expect(selectedComponent(after)).toBe(3);
  });

  it('clears every selected link as one undo entry', () => {
    // "Delete all the selected components' associations", the same loop.
    const assigned = associate(at(0, 1, 2), CAPS, 'Capacitor_SMD:C_0805');
    const cleared = deleteAssoc({ ...assigned, selection: [0, 1, 2] }, CAPS);
    expect(fpids(cleared, CAPS).slice(0, 3)).toEqual(['', '', '']);
    expect(cleared.undoStack.length).toBe(assigned.undoStack.length + 1);
    expect(cleared.undoStack[cleared.undoStack.length - 1]?.length).toBe(3);
  });

  it('does nothing at all with no selection', () => {
    // `if( idx.empty() )` — the loop body never runs, and ToNA has nowhere to
    // go because newSel keeps its UINT_MAX initial value. Reachable now that
    // the window can open with nothing selected.
    const empty = emptyAssociations();
    expect(associate(empty, CAPS, 'Capacitor_SMD:C_0805')).toBe(empty);
    expect(deleteAssoc(empty, CAPS)).toBe(empty);
    expect(gotoNA(empty, CAPS, 1)).toBe(empty);
    expect(gotoNA(empty, CAPS, -1)).toBe(empty);
  });

  it('follows the lowest selected row, which is GetFirstSelected', () => {
    expect(selectedComponent(at(5, 2, 9))).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// B7: CVPCB_CONTROL::ChangeFocus
// ---------------------------------------------------------------------------

describe('ChangeFocus', () => {
  it('cycles library to symbol to footprint and back', () => {
    expect(changeFocus('library', 'right')).toBe('symbol');
    expect(changeFocus('symbol', 'right')).toBe('footprint');
    expect(changeFocus('footprint', 'right')).toBe('library');
  });

  it('cycles the other way for Shift+Tab and the left arrow', () => {
    expect(changeFocus('library', 'left')).toBe('footprint');
    expect(changeFocus('footprint', 'left')).toBe('symbol');
    expect(changeFocus('symbol', 'left')).toBe('library');
  });

  it('does nothing from CONTROL_NONE', () => {
    // The focus is in the toolbar's search box, or nowhere: both switches fall
    // through their default label.
    expect(changeFocus(null, 'right')).toBe(null);
    expect(changeFocus(null, 'left')).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// A6: cut / copy / paste (CVPCB_ASSOCIATION_TOOL::CopyAssoc / CutAssoc /
//     PasteAssoc, cvpcb_association_tool.cpp:50-165)
// ---------------------------------------------------------------------------

/** R1 assigned, R2 assigned to something else, R3 not assigned. */
const PASTE_SHEET: CvpcbComponent[] = [
  comp('R1', 'Resistor:R_0805'),
  comp('R2', 'Capacitor:C_0603'),
  comp('R3'),
];

describe('CopyAssoc: what Copy puts on the clipboard', () => {
  it('is the FPID as plain text, which is GetUniStringLibId()', () => {
    // `wxTheClipboard->SetData( new wxTextDataObject( fpid.GetUniStringLibId() ) )`,
    // and GetUniStringLibId is `Format().wx_str()` — nickname, colon, item
    // name. Written out in full rather than read back off the component, so a
    // payload that grew a prefix or lost the nickname would fail here.
    expect(copyAssoc(at(0), PASTE_SHEET, 'symbol', '')).toBe('Resistor:R_0805');
  });

  it('takes the FOOTPRINT PANE’s row when that pane has the focus', () => {
    // `if( GetFocusedControl() == CONTROL_FOOTPRINT ) fpid.Parse( GetSelectedFootprint() )`
    // — the row the pane points at, which need not be assigned to anything.
    expect(copyAssoc(at(0), PASTE_SHEET, 'footprint', 'Package_SO:SOIC-8')).toBe(
      'Package_SO:SOIC-8',
    );
  });

  it('takes the SYMBOL’s FPID from every other focus, including none', () => {
    // The `else if( GetSelectedComponent() )` branch: the library pane, the
    // filter box and CONTROL_NONE all land in it, so the selected footprint
    // is ignored there even when there is one.
    for (const focus of ['symbol', 'library', null] as const)
      expect(copyAssoc(at(0), PASTE_SHEET, focus, 'Package_SO:SOIC-8')).toBe('Resistor:R_0805');
  });

  it('copies the LOWEST selected row of a multi-row selection', () => {
    // GetSelectedComponent() is GetSelection(), i.e. GetFirstSelected().
    expect(copyAssoc(at(1, 2), PASTE_SHEET, 'symbol', '')).toBe('Capacitor:C_0603');
  });

  it('copies nothing from an unassigned symbol, rather than an empty string', () => {
    // `if( !fpid.IsValid() ) return 0;` — both halves must be non-empty, so
    // the clipboard keeps whatever was already on it.
    expect(copyAssoc(at(2), PASTE_SHEET, 'symbol', '')).toBe(null);
  });

  it('copies nothing with no symbol selected', () => {
    // The bare `else return 0;`.
    expect(copyAssoc(at(), PASTE_SHEET, 'symbol', '')).toBe(null);
  });

  it('copies nothing from an unparseable footprint row', () => {
    // Parse trips on the second colon, leaving the item name unset.
    expect(copyAssoc(at(0), PASTE_SHEET, 'footprint', 'a:b:c')).toBe(null);
  });

  it('copies the PENDING assignment, not the one the schematic still holds', () => {
    const assigned = associate(at(2), PASTE_SHEET, 'Package_SO:SOIC-8');
    expect(copyAssoc({ ...assigned, selection: [2] }, PASTE_SHEET, 'symbol', '')).toBe(
      'Package_SO:SOIC-8',
    );
  });
});

describe('CutAssoc: copy, then clear ONE association', () => {
  it('puts the same text on the clipboard that Copy would', () => {
    expect(cutAssoc(at(0), PASTE_SHEET, 'symbol').clipboard).toBe('Resistor:R_0805');
  });

  it('clears idx.front() ONLY, leaving the rest of the selection assigned', () => {
    // `AssociateFootprint( CVPCB_ASSOCIATION( idx.front(), "" ) )` — one call,
    // no loop, unlike Copy and Associate and DeleteAssoc.
    const { state } = cutAssoc(at(0, 1), PASTE_SHEET, 'symbol');
    expect(fpids(state, PASTE_SHEET)).toEqual(['', 'Capacitor:C_0603', '']);
  });

  it('does nothing at all when the focus is another pane', () => {
    // "If using the keyboard, only cut in the component frame": a truthy focus
    // that is not CONTROL_COMPONENT bails before the clipboard is touched.
    for (const focus of ['footprint', 'library'] as const) {
      const cut = cutAssoc(at(0), PASTE_SHEET, focus);
      expect(cut.clipboard).toBe(null);
      expect(fpids(cut.state, PASTE_SHEET)).toEqual(['Resistor:R_0805', 'Capacitor:C_0603', '']);
    }
  });

  it('still cuts with the focus NOWHERE, because CONTROL_NONE is falsy', () => {
    // `if( GetFocusedControl() && GetFocusedControl() != CONTROL_COMPONENT )`
    // — CONTROL_NONE is 0 and fails the first half of the &&.
    expect(cutAssoc(at(0), PASTE_SHEET, null).clipboard).toBe('Resistor:R_0805');
  });

  it('leaves an unassigned symbol alone rather than clearing it', () => {
    // The IsValid guard comes BEFORE the clear, so Cut on an unassigned symbol
    // is a no-op and not a clear-and-lose.
    const cut = cutAssoc(at(2), PASTE_SHEET, 'symbol');
    expect(cut.clipboard).toBe(null);
    expect(cut.state.undoStack).toEqual([]);
    expect(cut.state.modified).toBe(false);
  });

  it('does nothing with no selection', () => {
    expect(cutAssoc(at(), PASTE_SHEET, 'symbol').clipboard).toBe(null);
  });

  it('is one undo step, and undo puts the footprint back', () => {
    const { state } = cutAssoc(at(0), PASTE_SHEET, 'symbol');
    expect(state.undoStack).toHaveLength(1);
    expect(fpids(undoAssociation(state, PASTE_SHEET), PASTE_SHEET)).toEqual([
      'Resistor:R_0805',
      'Capacitor:C_0603',
      '',
    ]);
  });
});

describe('PasteAssoc: assign the clipboard onto the whole selection', () => {
  it('assigns to every selected symbol, as ONE undo entry', () => {
    const state = pasteAssoc(at(1, 2), PASTE_SHEET, 'Package_SO:SOIC-8');
    expect(fpids(state, PASTE_SHEET)).toEqual([
      'Resistor:R_0805',
      'Package_SO:SOIC-8',
      'Package_SO:SOIC-8',
    ]);
    expect(state.undoStack).toHaveLength(1);
  });

  it('does nothing with no symbol selected', () => {
    // `if( idx.empty() ) return 0;` runs before the clipboard is even read.
    expect(pasteAssoc(at(), PASTE_SHEET, 'Package_SO:SOIC-8').modified).toBe(false);
  });

  it('drops text that is not a parseable LIB_ID, without touching anything', () => {
    // `if( fpid.Parse( data.GetText() ) >= 0 ) return 0;` — a tab, a newline, a
    // second colon or one of \ < > " in the item name is a parse error.
    for (const junk of [
      'Lib:foot print\tname',
      'Lib:two\nlines',
      'Lib:a:b',
      'Lib:back\\slash',
      'Lib:ang<le',
      'Lib:ang>le',
      'Lib:quo"te',
    ]) {
      const state = pasteAssoc(at(2), PASTE_SHEET, junk);
      expect(fpids(state, PASTE_SHEET)[2]).toBe('');
      expect(state.modified).toBe(false);
    }
  });

  it('accepts a bare item name with no nickname, which Copy would never make', () => {
    // Parse leaves partNdx at 0 and the whole string is the item name, so this
    // is IsLegacy(), not invalid — and Paste asks Parse, not IsValid.
    expect(fpids(pasteAssoc(at(2), PASTE_SHEET, 'R_0805'), PASTE_SHEET)[2]).toBe('R_0805');
  });

  it('drops the leading colon of ":R", because Format() writes it only for a nickname', () => {
    expect(fpids(pasteAssoc(at(2), PASTE_SHEET, ':R_0805'), PASTE_SHEET)[2]).toBe('R_0805');
  });

  it('CLEARS the selection when the clipboard is empty, because "" parses', () => {
    // HasIllegalChars( "" ) is -1 and SetLibItemName cannot fail, so Parse("")
    // succeeds with an empty LIB_ID and the loop assigns it. Surprising, and
    // upstream: the asymmetry with Copy's IsValid guard is the code.
    const state = pasteAssoc(at(0, 1), PASTE_SHEET, '');
    expect(fpids(state, PASTE_SHEET)).toEqual(['', '', '']);
    expect(state.undoStack).toHaveLength(1);
  });

  it('a space is a legal character, so "Lib:foot print" is assigned', () => {
    // `bool const space_allowed = true;` in isLegalChar, beside the
    // illegal_filename_chars_allowed = false that rejects \ < > ".
    expect(fpids(pasteAssoc(at(2), PASTE_SHEET, 'Lib:foot print'), PASTE_SHEET)[2]).toBe(
      'Lib:foot print',
    );
  });

  it('round-trips what Copy produced', () => {
    const payload = copyAssoc(at(0), PASTE_SHEET, 'symbol', '');
    const state = pasteAssoc(at(2), PASTE_SHEET, payload!);
    expect(fpids(state, PASTE_SHEET)[2]).toBe('Resistor:R_0805');
  });
});
