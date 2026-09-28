// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_REFERENCE_IMAGE_PROPERTIES on a live PCB_REFERENCE_IMAGE
 * (dialog_reference_image_properties.cpp, panel_image_editor.cpp).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import { BOARD_USE } from '@ziroeda/pcbnew/board_types.js';
import { DIALOG_REFERENCE_IMAGE_PROPERTIES } from '@ziroeda/pcbnew/dialogs/dialog_reference_image_properties.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import type { PCB_REFERENCE_IMAGE } from '@ziroeda/pcbnew/pcb_reference_image.js';
import { TEST_PCB_FRAME } from '../support/test_pcb_frame.js';

const MM = (n: number): number => pcbIUScale.mmToIU(n);

/** A 100 x 50 greyscale PNG with no pHYs chunk, so 300 ppi. */
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAGQAAAAyCAAAAACPXiFiAAAALElEQVR4nO3NMQEAAAwCIKMb3Qx7dkEB0geRSCQSiUQikUgkEolEIpFIJDcD7NPEiNYtp+MAAAAASUVORK5CYII=';

let board: BOARD;
let frame: TEST_PCB_FRAME;
const image = (): PCB_REFERENCE_IMAGE => board.Drawings()[0] as PCB_REFERENCE_IMAGE;
const dlg = () => new DIALOG_REFERENCE_IMAGE_PROPERTIES(frame, image());

beforeEach(() => {
  board = ParseBoard(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (5 "F.SilkS" user "F.Silkscreen") (7 "B.SilkS" user "B.Silkscreen"))
  (image (at 10 20) (layer "F.SilkS") (scale 2) (uuid "50000000-0000-4000-8000-000000000001")
    (data "${PNG}")))`);
  frame = new TEST_PCB_FRAME(board);
});

describe('DIALOG_REFERENCE_IMAGE_PROPERTIES', () => {
  it('reads the image; width and height are the scaled pixel size', () => {
    const v = dlg().TransferDataToWindow();
    expect(v).toMatchObject({ x: MM(10), y: MM(20), layer: 'F.SilkS', locked: false, scale: 2 });
    // 100 x 50 px at 300 ppi, doubled: 200/300 in by 100/300 in.
    expect(v.width).toBeCloseTo((200 / 300) * MM(25.4), -1);
    expect(v.height).toBeCloseTo((100 / 300) * MM(25.4), -1);
  });

  it('reads back what it wrote', () => {
    dlg().TransferDataFromWindow({ ...dlg().TransferDataToWindow(), layer: 'B.SilkS', scale: 3 });
    expect(dlg().TransferDataToWindow()).toMatchObject({ layer: 'B.SilkS', scale: 3 });
  });

  it('writes position, layer, lock and scale as one undo entry', () => {
    const r = dlg().TransferDataFromWindow({
      ...dlg().TransferDataToWindow(),
      x: MM(30),
      y: MM(40),
      layer: 'B.SilkS',
      locked: true,
      scale: 3,
    });
    expect(r.ok).toBe(true);
    const b = image();
    expect(b.GetPosition()).toEqual({ x: MM(30), y: MM(40) });
    expect(b.GetLayer()).toBe(PCB_LAYER_ID.B_SilkS);
    expect(b.IsLocked()).toBe(true);
    expect(b.GetReferenceImage().GetImageScale()).toBe(3);
    expect(frame.GetUndoCommandCount()).toBe(1);
    frame.RestoreCopyFromUndoList();
    expect(image().GetPosition()).toEqual({ x: MM(10), y: MM(20) });
    expect(image().GetReferenceImage().GetImageScale()).toBe(2);
  });

  it('scales about the centre: the position does not move', () => {
    // Even with a transform origin off-centre, which SetImageScale would scale about.
    image()
      .GetReferenceImage()
      .SetTransformOriginOffset({ x: MM(1), y: MM(1) });
    dlg().TransferDataFromWindow({ ...dlg().TransferDataToWindow(), scale: 5 });
    expect(image().GetPosition()).toEqual({ x: MM(10), y: MM(20) });
    expect(image().GetReferenceImage().GetTransformOriginOffset()).toEqual({ x: MM(1), y: MM(1) });
  });

  it('refuses a negative scale', () => {
    expect(dlg().TransferDataFromWindow({ ...dlg().TransferDataToWindow(), scale: -1 })).toEqual({
      ok: false,
      message: 'Scale must be a positive number.',
    });
    expect(frame.GetUndoCommandCount()).toBe(0);
  });

  it('refuses an image under 15 scaled pixels on its short side', () => {
    // 50 px * 0.28 = 14 px.
    const r = dlg().TransferDataFromWindow({ ...dlg().TransferDataToWindow(), scale: 0.28 });
    expect(r).toEqual({
      ok: false,
      message: 'This scale results in an image which is too small (1.19 mm or 46.7 mil).',
    });
    // 50 px * 0.3 = 15 px is enough.
    expect(dlg().TransferDataFromWindow({ ...dlg().TransferDataToWindow(), scale: 0.3 }).ok).toBe(
      true,
    );
  });

  it('asks before an image over 6000 scaled pixels, and No refuses', () => {
    const asked: string[] = [];
    const no = (m: string) => {
      asked.push(m);
      return false;
    };
    // 100 px * 61 = 6100 px.
    expect(
      dlg().TransferDataFromWindow({ ...dlg().TransferDataToWindow(), scale: 61 }, no).ok,
    ).toBe(false);
    expect(asked).toEqual([
      'This scale results in an image which is very large (516.5 mm or 20.33 in). Are you sure?',
    ]);
    expect(image().GetReferenceImage().GetImageScale()).toBe(2);
    // 100 px * 60 = 6000 px is not asked about.
    expect(
      dlg().TransferDataFromWindow({ ...dlg().TransferDataToWindow(), scale: 60 }, no).ok,
    ).toBe(true);
    expect(asked).toHaveLength(1);
  });

  it('takes the converted image the window hands back', () => {
    const OTHER =
      'iVBORw0KGgoAAAANSUhEUgAAAMgAAAAyCAAAAAA8Oss9AAAAoklEQVR4nN3OAQkAAAzDsEqbf1U3USg8CsKeoA5YqAMW6oCFOmChDlioAxbqgIU6YKEOWKgDFuqAhTpgoQ5YqAMW6oCFOmChDlioAxbqgIU6YKEOWKgDFuqAhTpgoQ5YqAMW6oCFOmChDlioAxbqgIU6YKEOWKgDFuqAhTpgoQ5YqAMW6oCFOmChDlioAxbqgIU6YKEOWKgDFuqAhTpgoQ5YDqc3xIghBGcQAAAAAElFTkSuQmCC';
    dlg().TransferDataFromWindow({ ...dlg().TransferDataToWindow(), data: OTHER });
    expect(image().GetReferenceImage().GetImage().GetSizePixels()).toEqual({ x: 200, y: 50 });
    expect(image().GetReferenceImage().GetImageScale()).toBe(2);
  });

  it('keeps the lock in a footprint holder', () => {
    board.SetBoardUse(BOARD_USE.FPHOLDER);
    dlg().TransferDataFromWindow({ ...dlg().TransferDataToWindow(), locked: true });
    // IsLocked() is always false in a footprint holder; look from a board.
    board.SetBoardUse(BOARD_USE.NORMAL);
    expect(image().IsLocked()).toBe(false);
  });
});
