// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_IMAGE_PROPERTIES (dialog_image_properties.cpp) on a live bitmap: position, scale, the
 * image as the editor's PNG; OK as one "Image Properties" commit, a changed PNG read back.
 */
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { WX_IMAGE } from '@ziroeda/common/wx/wx_image.js';
import { DIALOG_IMAGE_PROPERTIES } from '@ziroeda/eeschema/dialogs/dialog_image_properties.js';
import { SCH_BITMAP } from '@ziroeda/eeschema/sch_bitmap.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { schFrame, schToolHarness } from './support/sch_tool_harness.js';

beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => SetPgm(null));

function setUp() {
  const h = schToolHarness(schFrame({}));
  const bitmap = new SCH_BITMAP({ x: 2540, y: 5080 });
  bitmap.GetReferenceImage().SetImage(new WX_IMAGE(8, 6));
  h.frame.AddToScreen(bitmap, h.frame.GetScreen());
  return { h, bitmap, dlg: new DIALOG_IMAGE_PROPERTIES(h.frame, bitmap) };
}

describe('DIALOG_IMAGE_PROPERTIES', () => {
  it('shows the position, the scale, the pixel size and the image as PNG', () => {
    const { dlg } = setUp();
    const shown = dlg.TransferDataToWindow();
    expect(shown.at).toEqual({ x: 2540, y: 5080 });
    expect(shown.pixelSize).toEqual({ w: 8, h: 6 });
    expect(atob(shown.data).startsWith('\x89PNG')).toBe(true);
  });

  it('OK moves and scales the bitmap as one undo step', () => {
    const { h, bitmap, dlg } = setUp();
    const undo = h.frame.GetUndoCommandCount();

    dlg.TransferDataFromWindow({ at: { x: 0, y: 12700 }, scale: 2 });

    expect(bitmap.GetPosition()).toEqual({ x: 0, y: 12700 });
    expect(bitmap.GetImageScale()).toBe(2);
    expect(h.frame.GetUndoCommandCount()).toBe(undo + 1);
  });

  it('reads a changed PNG back into the bitmap', () => {
    const { bitmap, dlg } = setUp();
    const other = new WX_IMAGE(3, 4).SaveFilePng()!;
    let bin = '';
    for (const b of other) bin += String.fromCharCode(b);

    dlg.TransferDataFromWindow({ at: { x: 2540, y: 5080 }, scale: 1, data: btoa(bin) });

    const pixels = bitmap.GetReferenceImage().GetImage().GetImageData()!;
    expect([pixels.GetWidth(), pixels.GetHeight()]).toEqual([3, 4]);
  });
});
