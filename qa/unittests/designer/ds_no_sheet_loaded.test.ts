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
