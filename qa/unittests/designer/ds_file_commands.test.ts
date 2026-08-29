// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What the Drawing Sheet Editor says when you use its File menu.
 *
 * **Every expectation below was read off the running pl_editor**, not off the
 * C++ and not off our own code. The harness is `qa/probes/pl_e2e`: it drives
 * /usr/bin/pl_editor over AT-SPI and XTEST and photographs the status bar,
 * because a KISTATUSBAR paints its panes itself and publishes none of their
 * text over the accessibility bus. The path in the fixtures is the one that was
 * actually opened during that session, and the sentences are transcriptions.
 *
 * This is the level `docs/editor-status.md` calls E4, and it is here because
 * E1 had already been done twice and missed all of it: three prior audits read
 * `files.cpp` and none of them noticed that our five status strings were
 * invented, that New writes none at all, or that a failed load raises two
 * modals and leaves the status line alone.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DS_APPEND_DIALOG_TITLE,
  DS_OPEN_DIALOG_TITLE,
  DS_OUTDATED_FORMAT_INFOBAR,
  DS_SAVE_AS_DIALOG_TITLE,
  dsErrorLoadingMsg,
  dsFailedToCreateMsg,
  dsFileInsertedMsg,
  dsFileLoadedMsg,
  dsFileSavedMsg,
  dsNeedsUnsavedGuard,
  dsSaveBecomesSaveAs,
  dsUnableToLoadMsg,
  dsUnableToWriteMsg,
} from '@ziroeda/designer/src/editors/drawingsheet/file_commands.js';

/** The sheet that was open in the driven session. */
const SHEET = '/home/akshay/pl_audit_home/sheets/probe.kicad_wks';

describe('status pane 0, transcribed from a driven pl_editor', () => {
  it('Open reports a SAVE, which is upstream’s own slip', () => {
    // files.cpp:179 really is `_( "File '%s' saved." )` inside the wxID_OPEN
    // arm. Photographed after opening probe.kicad_wks.
    expect(dsFileSavedMsg(SHEET)).toBe(
      "File '/home/akshay/pl_audit_home/sheets/probe.kicad_wks' saved.",
    );
  });

  it('Append says "inserted", with no full stop', () => {
    expect(dsFileInsertedMsg(SHEET)).toBe(
      "File '/home/akshay/pl_audit_home/sheets/probe.kicad_wks' inserted",
    );
  });

  it('Open Recent says "loaded", also with no full stop', () => {
    expect(dsFileLoadedMsg(SHEET)).toBe(
      "File '/home/akshay/pl_audit_home/sheets/probe.kicad_wks' loaded",
    );
  });

  it('names the full path, never the leaf', () => {
    // The bug this replaces printed `Opened probe.kicad_wks (3 items)`.
    for (const msg of [dsFileSavedMsg(SHEET), dsFileInsertedMsg(SHEET), dsFileLoadedMsg(SHEET)]) {
      expect(msg).toContain('/home/akshay/pl_audit_home/sheets/');
      expect(msg).not.toContain('items');
    }
  });
});

describe('the modals a failure raises', () => {
  it('quotes the path in the loader’s message and not in Files_io’s', () => {
    // Both photographed, in this order, after opening a file with a bad token.
    expect(dsErrorLoadingMsg(SHEET)).toBe(
      "Error loading drawing sheet '/home/akshay/pl_audit_home/sheets/probe.kicad_wks'.",
    );
    expect(dsUnableToLoadMsg(SHEET)).toBe(
      'Unable to load /home/akshay/pl_audit_home/sheets/probe.kicad_wks file',
    );
  });

  it('has a different sentence for a failed write and a failed create', () => {
    expect(dsUnableToWriteMsg(SHEET)).toBe(
      "Unable to write '/home/akshay/pl_audit_home/sheets/probe.kicad_wks'.",
    );
    expect(dsFailedToCreateMsg(SHEET)).toBe(
      "Failed to create file '/home/akshay/pl_audit_home/sheets/probe.kicad_wks'.",
    );
  });
});

describe('dialog captions', () => {
  it('Open is not the wxFileDialog default', () => {
    expect(DS_OPEN_DIALOG_TITLE).toBe('Open Drawing Sheet');
    expect(DS_OPEN_DIALOG_TITLE).not.toBe('Open');
  });

  it('Append and Save As carry their own', () => {
    expect(DS_APPEND_DIALOG_TITLE).toBe('Append Existing Drawing Sheet');
    expect(DS_SAVE_AS_DIALOG_TITLE).toBe('Save Drawing Sheet As');
  });
});

describe('the infobar an out-of-date file raises', () => {
  it('is upstream’s sentence', () => {
    expect(DS_OUTDATED_FORMAT_INFOBAR).toBe(
      'This file was created by an older version of KiCad. ' +
        'It will be converted to the new format when saved.',
    );
  });
});

describe('Files_io’s dispatch rules', () => {
  it('turns Save into Save As only when there is no name', () => {
    expect(dsSaveBecomesSaveAs('')).toBe(true);
    expect(dsSaveBecomesSaveAs('/Templates/frame.kicad_wks')).toBe(false);
  });

  it('guards New and Open but never Append', () => {
    expect(dsNeedsUnsavedGuard('new')).toBe(true);
    expect(dsNeedsUnsavedGuard('open')).toBe(true);
    // Append ADDS to the sheet; there is nothing to lose, and files.cpp:108
    // leaves it out of the condition.
    expect(dsNeedsUnsavedGuard('append')).toBe(false);
  });
});

const EDITOR = readFileSync(
  fileURLToPath(
    new URL('../../../designer/src/editors/drawingsheet/DrawingSheetEditor.tsx', import.meta.url),
  ),
  'utf8',
);

/** Statements only: a `//`-commented line must not satisfy any of these. */
function statements(src: string, needle: string): string[] {
  return src
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => !l.startsWith('//') && !l.startsWith('*') && !l.startsWith('/*'))
    .filter((l) => l.includes(needle));
}

describe('pane 0 belongs to the file commands and to nothing else', () => {
  /*
   * `SetStatusText` with no field index appears exactly three times in
   * pl_editor and all three are in files.cpp (:83, :153, :180/:195/:230 — the
   * save arms share a sentence). Placing an item, copying, resizing, opening
   * Page Preview Settings and File > New all leave the pane alone, which was
   * checked by driving each one: after New, the pane still read
   * `File '…' saved.` from the Save As before it.
   *
   * This is a file-scoped count because the rule is file-scoped: it is not
   * "this call site is right", it is "there are no other call sites".
   */
  it('writes the status line in exactly three places', () => {
    expect(statements(EDITOR, 'setStatus(')).toHaveLength(3);
  });

  it('writes it with the transcribed sentences, not invented ones', () => {
    const calls = statements(EDITOR, 'setStatus(').join('\n');
    expect(calls).toContain('setStatus(aStatus(name));');
    expect(calls).toContain('setStatus(dsFileInsertedMsg(name));');
    expect(calls).toContain('setStatus(dsFileSavedMsg(aPath));');
  });

  it('has dropped the five inventions by name', () => {
    for (const invented of [
      'New drawing sheet',
      'Item placed',
      "setStatus('Resize')",
      'Failed to open',
      'Failed to append',
    ]) {
      expect(statements(EDITOR, invented)).toHaveLength(0);
    }
  });
});

describe('the file history is written by the loader alone', () => {
  /*
   * `UpdateFileHistory` is called from `LoadDrawingSheetFile` (files.cpp:261)
   * and nowhere else; `SaveDrawingSheetFile` (:305-338) does not call it.
   * Driven: after Save As to saved2.kicad_wks, Open Recent listed
   * `1 probe.kicad_wks` and the file just written was absent.
   */
  it('does not add a row on save', () => {
    const write = EDITOR.slice(
      EDITOR.indexOf('const writeSheet = useCallback'),
      EDITOR.indexOf('const save = useCallback'),
    );
    expect(write.length).toBeGreaterThan(200);
    expect(statements(write, 'addRecent(')).toHaveLength(0);
  });

  it('adds one on open', () => {
    const open = EDITOR.slice(
      EDITOR.indexOf('const openText = useCallback'),
      EDITOR.indexOf('const openRecent = useCallback'),
    );
    expect(statements(open, 'addRecent(')).toHaveLength(1);
  });
});

describe('the seams the strings above have to reach', () => {
  /*
   * A constant that is right and a frame that ignores it is the failure this
   * whole pass exists to catch — the Preferences panel that displayed a value
   * and then discarded it. The frame is a `.tsx` and `qa`'s tsconfig sets no
   * `--jsx`, so each seam is read rather than run.
   */
  it('titles the Open chooser from the constant, not "Open"', () => {
    // `_( "Open Drawing Sheet" )` (files.cpp:161). "Open" is the wxFileDialog
    // DEFAULT, which is why upstream took the trouble to replace it.
    expect(statements(EDITOR, 'DS_OPEN_DIALOG_TITLE')).toHaveLength(2); // import + use
    expect(statements(EDITOR, "title={openDlg === 'append' ? 'Append")).toHaveLength(0);
  });

  it('starts Save As in the user templates directory', () => {
    // `wxString dir = PATHS::GetUserTemplatesPath();` is the chooser's
    // `defaultDir` (files.cpp:202-204), and a driven pl_editor with a sheet
    // already loaded still opens Save As there rather than beside the sheet.
    // Our places list puts the open project first, so without this the dialog
    // starts on the wrong one of the two.
    expect(statements(EDITOR, 'initialPlace="templates"')).toHaveLength(1);
    expect(statements(EDITOR, 'title={DS_SAVE_AS_DIALOG_TITLE}')).toHaveLength(1);
  });

  it('raises the outdated-format infobar rather than only computing it', () => {
    // `m_infoBar->ShowMessage( …, OUTDATED_SAVE )` (files.cpp:267-274). The
    // flag has to reach the DOM: a state nothing renders is the shape of bug
    // this file is here for.
    expect(statements(EDITOR, '{outdatedFormat && (')).toHaveLength(1);
    expect(statements(EDITOR, '{DS_OUTDATED_FORMAT_INFOBAR}')).toHaveLength(1);
    // Set on load, cleared by a successful save (:265, :329-330).
    expect(statements(EDITOR, 'setOutdatedFormat(')).toHaveLength(3);
  });

  it('shows the queued modals one at a time, in order', () => {
    // A bad file raises TWO. A single slot would have shown the second only.
    expect(statements(EDITOR, 'errorDialogs[0]?.kind ===')).toHaveLength(2);
    expect(statements(EDITOR, 'setErrorDialogs((q) => q.slice(1))')).toHaveLength(2);
  });

  it('lets Append set the modified flag without retitling', () => {
    // `GetScreen()->SetContentModified()` and not `OnModify()`
    // (files.cpp:150). A driven pl_editor shows `probe — Drawing Sheet Editor`
    // straight after an Append, not `*probe`, so the title takes
    // `titleModified` and the Append path sets only `setDirty`.
    expect(statements(EDITOR, 'titleModified)')).toHaveLength(1);
    const insert = EDITOR.slice(
      EDITOR.indexOf('const insertDrawingSheetFile = useCallback'),
      EDITOR.indexOf('/** Silent update used while dragging'),
    );
    expect(insert.length).toBeGreaterThan(200);
    expect(statements(insert, 'setDirty(true)')).toHaveLength(1);
    expect(statements(insert, 'onModify()')).toHaveLength(0);
  });

  it('opens the shared About dialog instead of writing the status line', () => {
    expect(statements(EDITOR, '<AboutDialog title={ABOUT_TITLES.drawingSheet}')).toHaveLength(1);
    // The whole call, not the phrase: the phrase survives in the JSX comment
    // that records why the status write was wrong, and `statements` cannot see
    // inside a `{/* … */}` block's continuation lines.
    expect(statements(EDITOR, "setStatus('ZiroEDA Drawing Sheet Editor')")).toHaveLength(0);
    expect(statements(EDITOR, 'showAbout: () => setAboutOpen(true)')).toHaveLength(1);
  });
});
