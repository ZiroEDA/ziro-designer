// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `wxPrinter::Print( parent, printout, prompt )` for a browser: the pages a
 * `wxPrintout` draws, each on its own page-sized canvas (the `wxDC` a
 * printout draws on - `common/gal/gal_print.ts`), handed to the browser's
 * print dialog, which is the page's printer dialog and page setup.
 *
 * The paper is `wxPrintData`'s: A4 portrait here, what wxGTK's default paper
 * is outside the letter-paper locales; the resolution is the printer's, a
 * stated 300 PPI.
 */

import type { wxDC } from '../gal/gal_print.js';

/** What `Print` asks of a printout: `wxPrintout`'s page loop. */
export interface wxPrintoutPages {
  SetDC(aDC: wxDC | null): void;
  GetPageInfo(): { minPage: number; maxPage: number };
  HasPage(aPage: number): boolean;
  OnPrintPage(aPage: number): boolean;
}

/** A4, in inches. */
export const A4_INCHES = { x: 210 / 25.4, y: 297 / 25.4 } as const;

export const PRINTER_PPI = 300;

/** A page-sized canvas as the printout's `wxDC`. */
export function pageDC(
  aSizeInches: { x: number; y: number },
  aPPI: number,
): wxDC & {
  canvas: HTMLCanvasElement;
} {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(aSizeInches.x * aPPI);
  canvas.height = Math.round(aSizeInches.y * aPPI);
  const ctx = canvas.getContext('2d')!;

  return {
    canvas,
    ctx,
    image: canvas,
    GetSize: () => ({ x: canvas.width, y: canvas.height }),
    GetPPI: () => aPPI,
  };
}

export class wxPrinter {
  /**
   * Draw every page of `aPrintout` and open the browser's print dialog on
   * them. False when there is no page, or the print window cannot open.
   */
  Print(
    aPrintout: wxPrintoutPages,
    aPaperInches: { x: number; y: number } = A4_INCHES,
    aPPI: number = PRINTER_PPI,
  ): boolean {
    const { minPage, maxPage } = aPrintout.GetPageInfo();
    const pages: string[] = [];

    for (let page = minPage; page <= maxPage && aPrintout.HasPage(page); ++page) {
      const dc = pageDC(aPaperInches, aPPI);
      aPrintout.SetDC(dc);

      if (aPrintout.OnPrintPage(page)) pages.push(dc.canvas.toDataURL('image/png'));
    }

    aPrintout.SetDC(null);

    if (pages.length === 0) return false;

    const win = window.open('', '_blank');

    if (!win) return false;

    const orient = aPaperInches.x >= aPaperInches.y ? 'landscape' : 'portrait';
    win.document.write(
      `<html><head><title>Print</title><style>@page{size:${orient};margin:0}body{margin:0}img{width:100%;page-break-after:always}</style></head><body>${pages
        .map((p) => `<img src="${p}"/>`)
        .join('')}</body></html>`,
    );
    win.document.close();

    const img = win.document.images[pages.length - 1];

    if (img)
      img.onload = () => {
        win.focus();
        win.print();
      };

    return true;
  }
}
