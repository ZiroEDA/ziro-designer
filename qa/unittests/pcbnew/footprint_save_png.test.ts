// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Footprint Editor's File > Export > View as PNG: `FOOTPRINT_EDIT_FRAME::OnSaveFootprintAsPng`
 * (footprint_edit_frame.cpp:1549) through `EDA_DRAW_FRAME::SaveCanvasImageToFile`. The image is
 * named after the loaded footprint, as the dialog upstream offers it, and downloaded; with no
 * footprint the frame says so. The screenshot is canvas_screenshot.test.ts's; the canvas here
 * answers it with a known image.
 */
import { SetErrorPresenter } from '@ziroeda/common/confirm.js';
import { installPgm } from '@ziroeda/designer/src/editors/pcb/pcb_canvas.js';
import { FOOTPRINT_EDIT_FRAME } from '@ziroeda/pcbnew/footprint_edit_frame.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { WX_IMAGE } from '@ziroeda/wx/wx_image.js';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { _ } from '@ziroeda/wx/translation.js';

const U = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const BOARD_TEXT = `(kicad_pcb (version 20241229) (generator "test")
  (general (thickness 1.6))
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal))
  (setup)
  (net 0 "")
  (footprint "Lib:R_0603" (layer "F.Cu") (at 0 0) (uuid "${U(1)}")
    (pad "1" smd rect (at 1 0) (size 1 1) (layers "F.Cu") (uuid "${U(2)}")))
)`;

let frame: FOOTPRINT_EDIT_FRAME;
let outputs: { path: string; bytes: Uint8Array; mime: string }[];
let errors: string[];

beforeEach(() => {
  installPgm();
  outputs = [];
  errors = [];
  SetErrorPresenter((aText) => errors.push(aText));
  frame = new FOOTPRINT_EDIT_FRAME({
    fpEdit: () => {},
    writeOutputFile: (aPath, aBytes, aMime) =>
      outputs.push({ path: aPath, bytes: aBytes, mime: aMime }),
  });
});

/** A canvas whose view is one green pixel; attached after loading, which wants a real one. */
const attachScreenshotCanvas = () =>
  frame.SetCanvas({
    GetScreenshot: (aImage: WX_IMAGE) => {
      aImage.SetData(new Uint8Array([0, 200, 0]), 1, 1);
      return true;
    },
  } as never);

afterEach(() => SetErrorPresenter(() => {}));

it('downloads the view as <footprint>.png', () => {
  frame.ReloadFootprint(ParseBoard(BOARD_TEXT).GetFirstFootprint()!);
  attachScreenshotCanvas();
  frame.OnSaveFootprintAsPng();

  expect(errors).toEqual([]);
  expect(outputs.map((o) => [o.path, o.mime])).toEqual([['R_0603.png', 'image/png']]);

  const back = new WX_IMAGE();
  expect(back.LoadFile(outputs[0]!.bytes)).toBe(true);
  expect([...back.GetData()!]).toEqual([0, 200, 0]);
});

it('with no footprint loaded says so and writes nothing', () => {
  attachScreenshotCanvas();
  frame.OnSaveFootprintAsPng();

  expect(errors).toEqual([_('No footprint selected.')]);
  expect(outputs).toEqual([]);
});
