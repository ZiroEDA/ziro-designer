// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `PLEDITOR_PRINTOUT` (pagelayout_editor/dialogs/dialogs_for_printing.cpp): two
 * pages, each fitted to the paper by wxPrintout, drawn black on the wxDC print
 * path - `PrintDrawingSheet`, `DS_DRAW_ITEM_LIST::Print`, `gr_basic`.
 *
 * The page-fit expectations are wxWidgets' own answers for the same sizes,
 * from `qa/probes/printout_fit_probe.cpp` - not read back off the port.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DS_DATA_MODEL } from '@ziroeda/common/drawing_sheet/ds_data_model.js';
import { DS_DRAW_ITEM_LIST } from '@ziroeda/common/drawing_sheet/ds_draw_item.js';
import { GetGRForceBlackPenState } from '@ziroeda/common/gr_basic.js';
import { PAGE_INFO, PAGE_SIZE_TYPE } from '@ziroeda/common/page_info.js';
import { PGM_BASE, SetPgm } from '@ziroeda/common/pgm_base.js';
import { EDA_UNITS_INT } from '@ziroeda/common/settings/app_settings.js';
import { wxDC } from '@ziroeda/common/wx/dc.js';
import { LEGACY_COLORS } from '@ziroeda/common/color4d.js';
import { PLEDITOR_PRINTOUT } from '@ziroeda/pagelayout_editor/dialogs/dialogs_for_printing.js';
import { makeHarness } from './pl_editor_fixture.js';

/** A 2D context that records every stroke: its colour and width. */
class RECORDING_CTX {
  strokes: { style: string; width: number }[] = [];
  fills = 0;
  strokeStyle: string | CanvasGradient | CanvasPattern = '';
  fillStyle: string | CanvasGradient | CanvasPattern = '';
  lineWidth = 1;
  lineCap: CanvasLineCap = 'butt';
  lineJoin: CanvasLineJoin = 'miter';
  miterLimit = 10;
  globalAlpha = 1;
  globalCompositeOperation: GlobalCompositeOperation = 'source-over';
  beginPath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  bezierCurveTo(): void {}
  arc(): void {}
  closePath(): void {}
  setTransform(): void {}
  fillRect(): void {}
  clearRect(): void {}
  drawImage(): void {}
  createImageData(): ImageData {
    return {} as ImageData;
  }
  putImageData(): void {}
  getImageData(): ImageData {
    return {} as ImageData;
  }
  stroke(): void {
    this.strokes.push({ style: String(this.strokeStyle), width: this.lineWidth });
  }
  fill(): void {
    this.fills++;
  }
}

/** A4 portrait at 300 PPI: 2480 x 3508 device units, the probe's page. */
function a4Page(): { ctx: RECORDING_CTX; dc: wxDC } {
  const ctx = new RECORDING_CTX();
  const dc = new wxDC(ctx as never, {} as CanvasImageSource, { x: 2480, y: 3508 }, 300);
  return { ctx, dc };
}

/** What wxPrinter does before each page: the page is the DC, no margins. */
function printPage(aPrintout: PLEDITOR_PRINTOUT, aDC: wxDC, aPage: number): void {
  const size = aDC.GetSize();
  aPrintout.SetPageSizePixels(size.x, size.y);
  aPrintout.SetPaperRectPixels({ x: 0, y: 0, width: size.x, height: size.y });
  aPrintout.SetDC(aDC);
  aPrintout.OnPrintPage(aPage);
}

let model: DS_DATA_MODEL;

beforeEach(() => {
  SetPgm(new PGM_BASE());
  model = new DS_DATA_MODEL();
  DS_DATA_MODEL.SetAltInstance(model);
});

afterEach(() => {
  DS_DATA_MODEL.SetAltInstance(null);
  SetPgm(null);
});

describe('PLEDITOR_PRINTOUT', () => {
  it('is two pages (HasPage, GetPageInfo)', () => {
    const h = makeHarness(EDA_UNITS_INT.MM);
    const printout = new PLEDITOR_PRINTOUT(h.frame, 'Print Drawing Sheet');

    expect([1, 2, 3].map((n) => printout.HasPage(n))).toEqual([true, true, false]);
    expect(printout.GetPageInfo()).toEqual({
      minPage: 1,
      selPageFrom: 1,
      maxPage: 2,
      selPageTo: 2,
    });
  });

  it('fits an A4 sheet to A4 paper as wxPrintout does', () => {
    const h = makeHarness(EDA_UNITS_INT.MM);
    h.frame.SetPageSettings(new PAGE_INFO(PAGE_SIZE_TYPE.A4, true));
    const { dc } = a4Page();

    printPage(new PLEDITOR_PRINTOUT(h.frame, 'Print'), dc, 1);

    // KiCad's A4 is 8268 x 11693 mils, 210007 x 297002 IU. The probe, for
    // that size: "scale 0.0118091302", "offset 0 28 -> devOrg 0 0".
    expect(dc.GetUserScale().x).toBeCloseTo(0.0118091302, 10);
    expect(dc.GetDeviceOrigin()).toEqual({ x: 0, y: 0 });
  });

  it('centres an A3 landscape sheet on A4 portrait paper as wxPrintout does', () => {
    const h = makeHarness(EDA_UNITS_INT.MM);
    // The default sheet is A3 landscape: 420 x 297 mm.
    const { dc } = a4Page();

    printPage(new PLEDITOR_PRINTOUT(h.frame, 'Print'), dc, 1);

    // A3 is 16535 x 11693 mils, 419989 x 297002 IU. The probe, for that
    // size: "scale 0.00590491656", "offset 0 148539 -> devOrg 0 877".
    expect(dc.GetUserScale().x).toBeCloseTo(0.00590491656, 10);
    expect(dc.GetDeviceOrigin()).toEqual({ x: 0, y: 877 });
  });

  it('prints black whatever the layer colour, and puts the pen back after', () => {
    const h = makeHarness(EDA_UNITS_INT.MM);
    const { ctx, dc } = a4Page();

    printPage(new PLEDITOR_PRINTOUT(h.frame, 'Print'), dc, 1);

    expect(ctx.strokes.length).toBeGreaterThan(0);
    expect(new Set(ctx.strokes.map((s) => s.style))).toEqual(new Set(['rgb(0, 0, 0)']));
    expect(GetGRForceBlackPenState()).toBe(false);
  });

  it('prints on white and restores the frame background after', () => {
    const h = makeHarness(EDA_UNITS_INT.MM, 0, (cfg) => {
      cfg.m_BlackBackground = true;
    });
    const seen: unknown[] = [];
    const original = DS_DRAW_ITEM_LIST.prototype.Print;
    DS_DRAW_ITEM_LIST.prototype.Print = function (this: DS_DRAW_ITEM_LIST, aSettings) {
      seen.push(h.frame.GetDrawBgColor());
      original.call(this, aSettings);
    };

    try {
      printPage(new PLEDITOR_PRINTOUT(h.frame, 'Print'), a4Page().dc, 1);
    } finally {
      DS_DRAW_ITEM_LIST.prototype.Print = original;
    }

    expect(seen).toEqual([LEGACY_COLORS.WHITE]);
    expect(h.frame.GetDrawBgColor()).toEqual(LEGACY_COLORS.BLACK);
  });

  it('numbers the printed sheets 1/1 and 2/1: the page is the sheet, the count stays 1', () => {
    // `screen->SetVirtualPageNumber( aPageNum )` (:189), then PrintDrawingSheet
    // passes GetPageNumber() - the virtual page, nothing having set one - and
    // GetPageCount(), which nothing in pl_editor moves from 1.
    const h = makeHarness(EDA_UNITS_INT.MM);
    const numbering: [string, number][] = [];
    const original = DS_DRAW_ITEM_LIST.prototype.BuildDrawItemsList;
    DS_DRAW_ITEM_LIST.prototype.BuildDrawItemsList = function (this: DS_DRAW_ITEM_LIST, a, b) {
      const self = this as unknown as { m_pageNumber: string; m_sheetCount: number };
      numbering.push([self.m_pageNumber, self.m_sheetCount]);
      original.call(this, a, b);
    };

    try {
      const printout = new PLEDITOR_PRINTOUT(h.frame, 'Print');
      printPage(printout, a4Page().dc, 1);
      printPage(printout, a4Page().dc, 2);
    } finally {
      DS_DRAW_ITEM_LIST.prototype.BuildDrawItemsList = original;
    }

    expect(numbering).toEqual([
      ['1', 1],
      ['2', 1],
    ]);
  });
});
