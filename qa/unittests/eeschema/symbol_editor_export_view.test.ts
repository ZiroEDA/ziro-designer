// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * File > Export > View as PNG: `SYMBOL_EDITOR_CONTROL::ExportView` (symbol_editor_control.cpp:758)
 * through `EDA_DRAW_FRAME::SaveCanvasImageToFile` (eda_draw_frame.cpp:1449): the canvas's
 * screenshot, encoded as PNG, under the symbol's name. Upstream writes where a wxFileDialog
 * points; outputs download here, so the bytes go to the window. The screenshot itself is pinned
 * in canvas_screenshot.test.ts; here the canvas answers it with a known image.
 */
import { TA_NONE, TC_MESSAGE, TOOL_EVENT } from '@ziroeda/common/tool/tool_event.js';
import { SCH_ACTIONS } from '@ziroeda/eeschema/tools/sch_actions.js';
import { wxID_OK } from '@ziroeda/wx/menu.js';
import { WX_IMAGE } from '@ziroeda/wx/wx_image.js';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { _ } from '@ziroeda/wx/translation.js';
import { wxFormat } from '@ziroeda/wx/wxstring.js';
import { type SYMBOL_EDIT_HARNESS, symbolEditHarness } from './support/symbol_edit_harness.js';

let t: SYMBOL_EDIT_HARNESS;
let outputs: { path: string; bytes: Uint8Array; mime: string }[];
let messages: string[];
let screenshot: ((aImage: WX_IMAGE) => boolean) | null;

beforeEach(() => {
  outputs = [];
  messages = [];
  t = symbolEditHarness(undefined, {
    writeOutputFile: (aPath, aBytes, aMime) =>
      outputs.push({ path: aPath, bytes: aBytes, mime: aMime }),
    showModal: async (aName, _aItems, aArg) => {
      if (aName === 'wxMessageBox') messages.push((aArg as { message: string }).message);
      return wxID_OK;
    },
  });

  // A 2 x 1 view: one red pixel, one half-transparent blue one.
  screenshot = (aImage) => {
    aImage.SetData(new Uint8Array([255, 0, 0, 0, 0, 255]), 2, 1);
    aImage.SetAlpha(new Uint8Array([255, 128]));
    return true;
  };
  const canvas = t.frame.GetCanvas()! as unknown as { GetScreenshot(aImage: WX_IMAGE): boolean };
  canvas.GetScreenshot = (aImage) => screenshot?.(aImage) ?? false;
});

afterEach(() => t.dispose());

async function exportView(): Promise<void> {
  const mgr = t.frame.GetToolManager()!;
  mgr.RunAction(SCH_ACTIONS.exportSymbolView);

  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 0));
    mgr.ProcessEvent(new TOOL_EVENT(TC_MESSAGE, TA_NONE, 'test.flush'));
  }
}

it('downloads the view as <name>.png, pixels and alpha intact', async () => {
  t.open();
  await exportView();

  expect(outputs.map((o) => [o.path, o.mime])).toEqual([['U.png', 'image/png']]);
  expect(messages).toEqual([]);

  const back = new WX_IMAGE();
  expect(back.LoadFile(outputs[0]!.bytes)).toBe(true);
  expect([back.GetWidth(), back.GetHeight()]).toEqual([2, 1]);
  expect([...back.GetData()!]).toEqual([255, 0, 0, 0, 0, 255]);
  expect([...back.GetAlpha()!]).toEqual([255, 128]);
});

it('says it cannot save when the canvas has no screenshot', async () => {
  t.open();
  screenshot = null;
  await exportView();

  expect(outputs).toEqual([]);
  expect(messages).toEqual([wxFormat(_("Can't save file '%s'."), 'U.png')]);
});

it('with no symbol says so and writes nothing', async () => {
  await exportView();

  expect(messages).toEqual([_('No symbol to export')]);
  expect(outputs).toEqual([]);
});
