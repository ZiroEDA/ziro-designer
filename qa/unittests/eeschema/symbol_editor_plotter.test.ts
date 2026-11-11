// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * File > Export > Symbol as SVG: `SYMBOL_EDITOR_CONTROL::ExportSymbolAsSVG`
 * (tools/symbol_editor_control.cpp) sizing a page to the current unit plus a 10% margin and
 * shifting the symbol onto it, then `SYMBOL_EDIT_FRAME::SVGPlotSymbol`
 * (symbol_editor_plotter.cpp) plotting the body, then the fields, of that unit. The plot itself is
 * pinned against kicad-cli in plot_symbol_svg.test.ts; this is the frame's half. The file is
 * handed to the window to download, named as the selector would have offered it.
 */
import { TA_NONE, TC_MESSAGE, TOOL_EVENT } from '@ziroeda/common/tool/tool_event.js';
import { SCH_ACTIONS } from '@ziroeda/eeschema/tools/sch_actions.js';
import { wxID_OK } from '@ziroeda/wx/menu.js';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { _ } from '@ziroeda/wx/translation.js';
import {
  LIB_TEXT,
  type SYMBOL_EDIT_HARNESS,
  symbolEditHarness,
} from './support/symbol_edit_harness.js';

let t: SYMBOL_EDIT_HARNESS;
let outputs: { path: string; text: string; mime: string }[];
let messages: string[];

function harness(aLibText = LIB_TEXT): SYMBOL_EDIT_HARNESS {
  return symbolEditHarness(aLibText, {
    writeOutputFile: (aPath, aBytes, aMime) =>
      outputs.push({ path: aPath, text: new TextDecoder().decode(aBytes), mime: aMime }),
    showModal: async (aName, _aItems, aArg) => {
      if (aName === 'wxMessageBox') messages.push((aArg as { message: string }).message);
      return wxID_OK;
    },
  });
}

beforeEach(() => {
  outputs = [];
  messages = [];
  t = harness();
});

afterEach(() => t.dispose());

async function exportSvg(): Promise<void> {
  const mgr = t.frame.GetToolManager()!;
  mgr.RunAction(SCH_ACTIONS.exportSymbolAsSVG);

  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 0));
    mgr.ProcessEvent(new TOOL_EVENT(TC_MESSAGE, TA_NONE, 'test.flush'));
  }
}

/** The `<rect>` SVG_PLOTTER wrote, in mm. */
const rect = (aSvg: string) => {
  const m = /<rect x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="([-\d.]+)"/.exec(aSvg);
  return m ? m.slice(1).map(Number) : null;
};

it('downloads <name>.svg: the unit, shifted onto a page with a 10% margin', async () => {
  const symbol = t.open();
  await exportSvg();

  expect(outputs.map((o) => [o.path, o.mime])).toEqual([['U.svg', 'image/svg+xml']]);

  // The page's origin is the unit's box (hidden fields included) grown by 10% of its size on
  // each side; the body rectangle (-5.08, -5.08) mm lands that far in from the page corner.
  const box = symbol.GetUnitBoundingBox(1, 1, false);
  const originX = box.GetX() - Math.trunc(box.GetWidth() * 0.1);
  const originY = box.GetY() - Math.trunc(box.GetHeight() * 0.1);
  const [x, y, w, h] = rect(outputs[0]!.text)!;

  expect(x).toBeCloseTo((-50800 - originX) / 10000, 5);
  expect(y).toBeCloseTo((-50800 - originY) / 10000, 5);
  expect([w, h]).toEqual([10.16, 10.16]);
});

it('plots the fields of that unit: the reference with its unit letter', async () => {
  t.open();
  await exportSvg();

  expect(outputs[0]!.text).toContain('<desc>U?A</desc>');

  t.frame.SetUnit(2);
  outputs = [];
  await exportSvg();

  expect(outputs[0]!.text).toContain('<desc>U?B</desc>');
});

it('plots only the current unit: unit 2 has no body rectangle', async () => {
  t.open();
  t.frame.SetUnit(2);
  await exportSvg();

  expect(outputs).toHaveLength(1);
  expect(rect(outputs[0]!.text)).toBeNull();
});

it('puts the screen’s own page back', async () => {
  t.open();
  const before = t.frame.GetScreen()!.GetPageSettings();
  const size = before.GetSizeMils();

  await exportSvg();

  expect(t.frame.GetScreen()!.GetPageSettings()).toBe(before);
  expect(before.GetSizeMils()).toEqual(size);
});

it('with no symbol says so and writes nothing', async () => {
  await exportSvg();

  expect(messages).toEqual([_('No symbol to export')]);
  expect(outputs).toEqual([]);
});

it('plots the background pass first: the body fill, then its outline', async () => {
  t.dispose();
  t = harness(LIB_TEXT.replace('(fill (type none))', '(fill (type background))'));
  t.open();
  await exportSvg();

  // Each rect's group style: the background fill first (no stroke), then the outline.
  const styles = [...outputs[0]!.text.matchAll(/<g style="([^"]*)"[^>]*>\s*<rect /g)].map((m) =>
    m[1]!.includes('stroke:none') ? 'fill' : 'outline',
  );
  expect(styles).toEqual(['fill', 'outline']);
});
