// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A freshly opened Drawing Sheet Editor has no document.
 *
 * pl_editor draws its default page from the moment it opens, and that is NOT a
 * loaded file. A live KiCad with nothing opened, captured beside ours:
 *
 *     title          [no drawing sheet loaded] — Drawing Sheet Editor
 *     message pane   (empty)
 *     message panel  (empty — no Page Width / Page Height)
 *
 * Ours claimed a document in all three places, because the state was seeded
 * with a filename nobody opened and a status line announcing a load that never
 * happened. The placeholder branch in the title was already written and
 * correct; it simply could not run.
 *
 * Each of these is a one-line initial value, so this reads the source. That is
 * the honest granularity: the bug WAS the initial value, and the functions
 * consuming it were right.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** The editor's source with comments blanked — prose must not read as code. */
const EDITOR = readFileSync(
  fileURLToPath(
    new URL('../../../designer/src/editors/drawingsheet/DrawingSheetEditor.tsx', import.meta.url),
  ),
  'utf8',
)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '');

describe('nothing is loaded until something is opened', () => {
  it('found the editor, so this cannot pass by reading an empty string', () => {
    expect(EDITOR.length).toBeGreaterThan(1000);
    expect(EDITOR).toContain('useState');
  });

  it('starts with no current file name', () => {
    // `GetCurrentFileName()` is empty until a file is opened, which is what
    // makes `UpdateTitleAndInfo` print the placeholder
    // (`pl_editor_frame.cpp:575-585`).
    expect(EDITOR).toMatch(/const \[fileName, setFileName\] = useState\(''\)/);
    expect(EDITOR).not.toMatch(/useState\('drawing_sheet\.kicad_wks'\)/);
  });

  it('and therefore titles the frame with the placeholder', () => {
    // The consumer was always right; it is here so that removing the
    // placeholder is also caught, not only the state that reaches it.
    expect(EDITOR).toContain("frameTitleName(fileName, '[no drawing sheet loaded]')");
  });

  it('starts with an empty message pane', () => {
    expect(EDITOR).toMatch(/const \[status, setStatus\] = useState\(''\)/);
    expect(EDITOR).not.toMatch(/useState\('Loaded default drawing sheet'\)/);
  });

  it('shows no message panel until a selection change', () => {
    // `UpdateMsgPanelInfo` has exactly two call sites upstream and both are
    // selection-change handlers (`pl_editor_frame.cpp:834`,
    // `pl_editor_control.cpp:171`), so the panel is empty until you click.
    expect(EDITOR).toMatch(/if \(!selectionSeen\) return \[\];/);
    // And the flag has to actually be set by a selection change, or the panel
    // would never appear at all — the opposite bug.
    expect(EDITOR).toMatch(/setSelectionSeen\(true\)/);
  });

  it('turns Save into Save As while there is no name', () => {
    // `if( filename.IsEmpty() && id == wxID_SAVE ) id = wxID_SAVEAS;`
    // (`pagelayout_editor/files.cpp:105`). Without this, an empty name would
    // make Save write to nothing.
    expect(EDITOR).toMatch(/if \(!fileName\) \{\s*saveAsRef\.current\?\.\(\);/);
  });
});

/**
 * File > New makes the SAME "nothing is loaded" state, and it is the same four
 * calls upstream (`pagelayout_editor/files.cpp:123-128`):
 *
 *     pglayout.AllowVoidList( true );
 *     SetCurrentFileName( wxEmptyString );
 *     pglayout.ClearList();
 *     OnNewDrawingSheet();
 *
 * A live pl_editor after New shows a BLANK page — no border, no title block —
 * and titles the frame `[no drawing sheet loaded]`. Ours loaded the default
 * sheet and named the file `drawing_sheet.kicad_wks`, so New produced the
 * document the editor opens with rather than an empty one.
 */
describe('File > New clears the sheet rather than reloading the default', () => {
  /** The body of `newSheet`, so a stray match elsewhere cannot satisfy these. */
  const newSheetBody = ((): string => {
    const at = EDITOR.indexOf('const newSheet = useCallback');
    expect(at, 'newSheet must exist').toBeGreaterThan(-1);
    return EDITOR.slice(at, EDITOR.indexOf('}, []);', at));
  })();

  it('empties the item list', () => {
    // `ClearList()` under `AllowVoidList( true )`: the list is void and STAYS
    // void, where the flag's default of false would reload the default sheet
    // (ds_data_model.h:188).
    expect(newSheetBody).toContain('items: []');
  });

  it('does not load the default sheet', () => {
    // The bug in one line: `defaultDrawingSheet()` is what the editor OPENS
    // with, and New is not an open.
    expect(newSheetBody).not.toContain('defaultDrawingSheet');
  });

  it('keeps the setup, because ClearList touches only the items', () => {
    // `ClearList` deletes the DS_DATA_ITEMs and nothing else, so the margins
    // and default text sizes survive. Replacing the whole sheet would reset
    // them, which upstream does not do.
    expect(newSheetBody).toMatch(/setSheet\(\(s\) => \(\{ \.\.\.s, items: \[\] \}\)\)/);
  });

  it('clears the current file name', () => {
    // `SetCurrentFileName( wxEmptyString )` — this is what puts the placeholder
    // back in the title bar.
    expect(newSheetBody).toMatch(/setFileName\(''\)/);
    expect(newSheetBody).not.toMatch(/setFileName\('[^']+'\)/);
  });

  it('still clears undo, the selection and the modified flag', () => {
    // `ClearUndoRedoList()` and `SetContentModified( false )` in
    // OnNewDrawingSheet (pl_editor_frame.cpp:908-909), and
    // `CopyPrmsFromItemToPanel( nullptr )` at :912 — which an empty selection
    // is here. Without these the assertions above could pass on a New that
    // left the old document's history and dirty flag behind.
    expect(newSheetBody).toContain('undoStack.current = []');
    expect(newSheetBody).toContain('redoStack.current = []');
    expect(newSheetBody).toContain('setSelection(new Set())');
    expect(newSheetBody).toContain('setDirty(false)');
  });
});
