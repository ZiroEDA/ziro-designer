// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `FOOTPRINT_EDIT_FRAME::ImportFootprint` (`footprint_libraries_utils.cpp:83-233`):
 * a footprint file goes onto the editor's board — not into a library — named
 * by the file's own footprint, with no library nickname until it is saved,
 * at the origin.
 */
import { describe, expect, it } from 'vitest';
import { FOOTPRINT_EDIT_FRAME } from '@ziroeda/pcbnew/footprint_edit_frame.js';
import { FOOTPRINT_LIBRARY_STORE } from '@ziroeda/pcbnew/footprint_library_adapter.js';
import { SetErrorPresenter } from '@ziroeda/common/confirm.js';
import { attachFootprintFrameCanvas } from './support/footprint_frame_canvas.js';

const mod = (name: string): string => `(footprint "${name}" (layer "F.Cu") (at 5 7)
  (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu")))`;

function frameImporting(aFile: { path: string; text: string } | null): {
  frame: FOOTPRINT_EDIT_FRAME;
  store: FOOTPRINT_LIBRARY_STORE;
} {
  const store = new FOOTPRINT_LIBRARY_STORE({
    footprintText: () => Promise.reject(new Error('none')),
    flipLeftRight: () => false,
  });
  store.AddProjectLibrary('Lib', 'Lib.pretty', []);
  const frame = new FOOTPRINT_EDIT_FRAME({
    fpEdit: () => {},
    showImportFootprintDialog: () => Promise.resolve(aFile),
  });
  frame.SetFootprintLibAdapter(store);
  attachFootprintFrameCanvas(frame);
  return { frame, store };
}

describe('ImportFootprint', () => {
  it("puts the file's footprint on the board, unnamed in any library, at the origin", async () => {
    const { frame, store } = frameImporting({ path: 'dl/file.kicad_mod', text: mod('R_0805') });

    const fp = await frame.ImportFootprint();

    expect(fp).not.toBeNull();
    expect(frame.GetBoard()!.GetFirstFootprint()).toBe(fp);
    expect(fp!.GetFPID().GetLibNickname()).toBe('');
    expect(fp!.GetFPID().GetLibItemName()).toBe('R_0805');
    expect(fp!.GetPosition()).toEqual({ x: 0, y: 0 });
    // Imported, not saved: the library is untouched.
    expect(store.GetFootprintNames('Lib')).toEqual([]);
  });

  it('a file whose footprint has no name is named for the file', async () => {
    const { frame } = frameImporting({ path: 'dl/Fallback.kicad_mod', text: mod('') });

    expect((await frame.ImportFootprint())!.GetFPID().GetLibItemName()).toBe('Fallback');
  });

  it('a file that is not a footprint is refused with "Not a footprint file."', async () => {
    const errors: string[] = [];
    SetErrorPresenter((aText) => errors.push(aText));
    const { frame } = frameImporting({ path: 'dl/notes.txt', text: 'hello' });

    expect(await frame.ImportFootprint()).toBeNull();
    expect(errors).toEqual(['Not a footprint file.']);
    expect(frame.GetBoard()!.GetFirstFootprint()).toBeNull();
  });

  it('Cancel imports nothing', async () => {
    const { frame } = frameImporting(null);

    expect(await frame.ImportFootprint()).toBeNull();
  });
});
