// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A drawing sheet lives outside any project, as it does in KiCad.
 *
 * `PL_EDITOR_FRAME::Files_io` saves one into `PATHS::GetUserTemplatesPath()`
 * (pagelayout_editor/files.cpp:199-202), and `DIALOG_PAGES_SETTINGS` names one
 * by PATH — a wxTextCtrl and a browse button whose own default is that same
 * directory (dialog_page_settings.cpp:686-716). Those two facts are one design:
 * a sheet in a shared folder is reusable by every project, and a sheet inside a
 * project is reachable from that project alone.
 *
 * That directory is not a guess. `qa/probes/savedlg_probe.cpp` builds the very
 * wxFileDialog `Files_io` builds and asks it:
 *
 *     PATHS::GetUserTemplatesPath() = /home/akshay/.local/share/kicad/10.0/template/
 *       exists on this machine: yes
 *     wx:  GetDirectory() = '/home/akshay/.local/share/kicad/10.0/template/'
 *          GetFilename()  = ''
 *     GTK: current folder = '/home/akshay/.local/share/kicad/10.0/template'
 *          current name   = ''
 *
 * The first version of that probe transcribed `getUserDocumentPath` with
 * wxWidgets' documents dir and reported `~/Documents/kicad/...`, a folder that
 * does not exist here. `KIPLATFORM::ENV::GetDocumentsPath()` on Linux is
 * `g_get_user_data_dir()` (libs/kiplatform/os/unix/environment.cpp:93-105).
 * Transcribing a call is not running it.
 *
 * Ours saved into the open project and opened the chooser on Recent — a row
 * nothing can be saved into at all.
 */
import { describe, expect, it } from 'vitest';
import { chooserPlacesFor } from '@ziroeda/designer/src/fs/chooser_places.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const PL = read('../../../designer/src/editors/drawingsheet/DrawingSheetEditor.tsx');
const SAVEAS = read('../../../designer/src/fs/SaveAsDialog.tsx');
const SCH = read('../../../designer/src/editors/schematic/SchematicEditor.tsx');

describe('the drawing sheet editor asks for the right folders', () => {
  it('names Templates as its kind, in both Open and Save As', () => {
    // `PATHS::GetUserTemplatesPath()` is pl_editor's defaultDir
    // (pagelayout_editor/files.cpp:199); here that is the Templates folder of
    // the one account tree.
    expect([...PL.matchAll(/kind="templates"/g)]).toHaveLength(2);
  });

  it('hands Save As the open project, so the offer is this board or Templates', () => {
    expect(PL).toContain('{...(projectName ? { projectDir: `/${projectName}` } : {})}');
  });

  it('does NOT hand it to Open, which is not gated', () => {
    // A sheet opens from any project, with or without one open.
    const open = PL.slice(PL.indexOf('<OpenFileDialog'));
    expect(open.slice(0, open.indexOf('/>'))).not.toContain('projectDir');
  });

  it('suggests no filename, as pl_editor does not', () => {
    // `wxFileDialog( ..., dir, wxEmptyString, ... )` — confirmed by building
    // that dialog: wx's GetFilename() and GTK's current-name are both empty
    // (qa/probes/savedlg_probe.cpp).
    expect(PL).toContain('initialName=""');
  });
});

describe('Open reads through the account tree, which is now the only tree', () => {
  /**
   * This used to be a bug and is now impossible by construction.
   *
   * `OpenFileDialog` read every accepted path through `projectStoreFileSystem()`
   * whatever place it came from, and Templates and Demos each brought a tree of
   * their own — so a path from one of those threw and came back as
   * `onDone(null)`, indistinguishable from Cancel. No editor, no error, nothing.
   *
   * Every place is a FOLDER of the account tree now: Projects is the tree, and
   * Templates/Symbols/Footprints are folders in it. One read serves all of
   * them, and there is no second tree left to read from the wrong one.
   */
  const OPEN = read('../../../designer/src/fs/OpenFileDialog.tsx');

  it('reads through the account tree for every place', () => {
    // `rest` joined the signature when GerbView needed wxFD_MULTIPLE
    // (gerbview/files.cpp:151-152); the tree it reads from did not change.
    expect(OPEN).toContain('onAccept={(path, rest) => readAndDone(fs, path, rest)}');
  });

  it('takes the filesystem as an argument rather than assuming one', () => {
    expect(OPEN).toContain(
      'const readAndDone = (from: FileSystem, path: string, rest: readonly string[] = []): void => {',
    );
    expect(OPEN).toContain('const bytes = await from.read(path);');
  });

  it('asks for no place with a tree of its own', () => {
    // The shape that caused it. If a place ever brings its own `fs` again, the
    // read has to travel with it - see ChooserPlace.onAccept.
    const places = chooserPlacesFor({ mode: 'open', kind: 'templates' });
    expect(places.filter((p) => p.fs)).toStrictEqual([]);
  });

  it('reports a failed read as a cancel, not a half-open document', () => {
    // Upstream's wxFileDialog hands back a path and the frame's loader reports
    // its own error.
    expect(OPEN).toContain('onDone(null);');
  });
});
