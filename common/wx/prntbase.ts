// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `wxPrintout` (`wx/prntbase.h`): a document's pages, drawn one at a time on
 * the DC the printer hands it, and the page-fitting helpers a printout uses to
 * map its own units onto that page.
 *
 * `wxPrinter` (`printer.ts`) sets the page and paper sizes before the pages
 * are drawn. Its pages have no margins, so the paper rectangle is the page and
 * the page is the DC. The arithmetic is measured
 * (`qa/probes/printout_fit_probe.cpp`): `FitThisSizeToPaper`'s scale is a
 * double, and the logical rectangles are the DC's rounded conversions.
 */

import type { wxDC } from './dc.js';

export interface wxRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export abstract class wxPrintout {
  private readonly m_title: string;
  private m_dc: wxDC | null = null;
  private m_pageWidthPixels = 0;
  private m_pageHeightPixels = 0;
  private m_paperRectPixels: wxRect = { x: 0, y: 0, width: 0, height: 0 };
  private m_PPIPrinterX = 0;
  private m_PPIPrinterY = 0;

  constructor(aTitle: string) {
    this.m_title = aTitle;
  }

  GetTitle(): string {
    return this.m_title;
  }

  /** The page the next OnPrintPage draws on (wxPrinter's `SetDC`). */
  SetDC(aDC: wxDC | null): void {
    this.m_dc = aDC;
  }

  GetDC(): wxDC {
    return this.m_dc!;
  }

  SetPageSizePixels(w: number, h: number): void {
    this.m_pageWidthPixels = w;
    this.m_pageHeightPixels = h;
  }

  GetPageSizePixels(): { w: number; h: number } {
    return { w: this.m_pageWidthPixels, h: this.m_pageHeightPixels };
  }

  SetPaperRectPixels(aRect: wxRect): void {
    this.m_paperRectPixels = { ...aRect };
  }

  GetPaperRectPixels(): wxRect {
    return { ...this.m_paperRectPixels };
  }

  SetPPIPrinter(x: number, y: number): void {
    this.m_PPIPrinterX = x;
    this.m_PPIPrinterY = y;
  }

  GetPPIPrinter(): { x: number; y: number } {
    return { x: this.m_PPIPrinterX, y: this.m_PPIPrinterY };
  }

  /**
   * `GetLogicalPageRect()`: the printable page, in the DC's logical units.
   * The DC is the page (`printer.ts`), so this is the DC converted.
   */
  GetLogicalPageRect(): wxRect {
    const dc = this.GetDC();
    const { w, h } = this.GetPageSizePixels();

    return {
      x: dc.DeviceToLogicalX(0),
      y: dc.DeviceToLogicalY(0),
      width: dc.DeviceToLogicalXRel(w || dc.GetSize().x),
      height: dc.DeviceToLogicalYRel(h || dc.GetSize().y),
    };
  }

  /**
   * `GetLogicalPaperRect()`: the paper, in logical units. For a DC that is
   * the printed page, "no scaling": each edge converted by the DC.
   */
  GetLogicalPaperRect(): wxRect {
    const dc = this.GetDC();
    const paperRect = this.GetPaperRectPixels();
    const { w: pw, h: ph } = this.GetPageSizePixels();
    const { x: w, y: h } = dc.GetSize();

    console.assert(w === pw && h === ph, 'wxPrintout: the DC is not the printed page');

    return {
      x: dc.DeviceToLogicalX(paperRect.x),
      y: dc.DeviceToLogicalY(paperRect.y),
      width: dc.DeviceToLogicalXRel(paperRect.width),
      height: dc.DeviceToLogicalYRel(paperRect.height),
    };
  }

  /**
   * Set the DC scale and origin so that the given image size fits within the
   * entire page and the origin is at the top left corner of the page.
   */
  FitThisSizeToPaper(aImageSize: { x: number; y: number }): void {
    const dc = this.m_dc;

    if (!dc) return;

    const paperRect = this.GetPaperRectPixels();
    const { w: pw, h: ph } = this.GetPageSizePixels();
    const { x: w, y: h } = dc.GetSize();

    const scaleX = (paperRect.width * w) / (pw * aImageSize.x);
    const scaleY = (paperRect.height * h) / (ph * aImageSize.y);
    const actualScale = Math.min(scaleX, scaleY);

    dc.SetUserScale(actualScale, actualScale);
    dc.SetDeviceOrigin(0, 0);

    const logicalPaperRect = this.GetLogicalPaperRect();
    this.SetLogicalOrigin(logicalPaperRect.x, logicalPaperRect.y);
  }

  /** Set the device origin by specifying a point in logical coordinates. */
  SetLogicalOrigin(x: number, y: number): void {
    const dc = this.GetDC();
    dc.SetDeviceOrigin(dc.LogicalToDeviceX(x), dc.LogicalToDeviceY(y));
  }

  /** Offset the device origin by a specified distance in logical coordinates. */
  OffsetLogicalOrigin(xoff: number, yoff: number): void {
    const dc = this.GetDC();
    const dev_org = dc.GetDeviceOrigin();

    dc.SetDeviceOrigin(
      dev_org.x + dc.LogicalToDeviceXRel(xoff),
      dev_org.y + dc.LogicalToDeviceYRel(yoff),
    );
  }

  abstract OnPrintPage(aPage: number): boolean;
}
