// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What File > Print produces in the Drawing Sheet Editor.
 *
 * Two things are being held here and they are not the same size.
 *
 * **Two pages.** `PLEDITOR_PRINTOUT::HasPage` is `return ( aPageNum <= 2 )` and
 * `GetPageInfo` reports `maxPage = selPageTo = 2`
 * (pagelayout_editor/dialogs/dialogs_for_printing.cpp:62, :152-157), and
 * `PrintPage` sets `screen->SetVirtualPageNumber( aPageNum )` before rendering
 * (:189). That is the whole reason the editor has a `Page 1 / Other pages`
 * selector: an item marked `(option page1only)` is on the first sheet only and
 * one marked `(option notonpage1)` is on the second only, so a one-page print
 * can never show both. Ours printed one page — whichever the toolbar happened
 * to be showing. Opening the print dialog on a driven pl_editor shows the
 * two-page collate icon, which is `SetMaxPage( 2 )` (:230).
 *
 * **A blocked popup.** KiCad's Ctrl+P goes to the GTK system print dialog and
 * prints vectors; a browser cannot, and the raster-to-`window.print` route is
 * the honest substitute. `window.open` returns null when the popup is blocked,
 * and `if (!w) return;` once turned that into a command that did nothing and
 * said nothing.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  PL_EDITOR_PRINT_PAGES,
  printDocumentHtml,
} from '@ziroeda/designer/src/editors/drawingsheet/print_document.js';

describe('the printout is two pages', () => {
  it('numbers them 1 and 2, as HasPage does', () => {
    expect(PL_EDITOR_PRINT_PAGES).toEqual([1, 2]);
  });

  it('emits one image per page', () => {
    const html = printDocumentHtml('frame', [
      'data:image/png;base64,AAA',
      'data:image/png;base64,BBB',
    ]);
    expect(html.match(/<img /g) ?? []).toHaveLength(2);
    expect(html).toContain('data:image/png;base64,AAA');
    expect(html).toContain('data:image/png;base64,BBB');
  });

  it('puts each image on its own sheet of paper', () => {
    // Without the break the two images flow onto one page and the printout is
    // one sheet again, which is the bug with the fix's shape.
    const html = printDocumentHtml('frame', ['a', 'b']);
    expect(html).toContain('page-break-after:always');
    expect(html).toContain('img:last-child{page-break-after:auto}');
  });

  it('prints after the whole document has loaded, not after the first image', () => {
    // An `onload` on image 1 can fire before image 2 has been laid out, and
    // then the second sheet comes out blank.
    const html = printDocumentHtml('frame', ['a', 'b']);
    expect(html).toContain('window.addEventListener("load"');
    expect(html).not.toContain('onload=');
  });

  it('titles the window with the sheet', () => {
    expect(printDocumentHtml('frame.kicad_wks', [])).toContain('<title>frame.kicad_wks</title>');
  });
});

const EDITOR = readFileSync(
  fileURLToPath(
    new URL('../../../designer/src/editors/drawingsheet/DrawingSheetEditor.tsx', import.meta.url),
  ),
  'utf8',
);

const PRINT = (() => {
  const at = EDITOR.indexOf('const printSheet');
  expect(at, 'no printSheet').toBeGreaterThan(-1);
  return EDITOR.slice(at, EDITOR.indexOf('w.document.close();', at));
})();

/** Statements only: a commented-out line must not satisfy any of these. */
function statements(src: string, needle: string): string[] {
  return src
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => !l.startsWith('//') && !l.startsWith('*') && !l.startsWith('/*'))
    .filter((l) => l.includes(needle));
}

describe('the page the print renders', () => {
  it('lays each page out at its own page number', () => {
    // `screen->SetVirtualPageNumber( aPageNum )`: without this both sheets come
    // out identical and the page options are ignored.
    expect(statements(PRINT, 'pageNumber: aPageNum')).toHaveLength(1);
  });

  it('forces the black pen, as GRForceBlackPen( true ) does', () => {
    // dialogs_for_printing.cpp:184. Without it a coloured `(tbtext … (color …))`
    // prints in its screen colour.
    expect(statements(PRINT, 'forceBlackPen: true')).toHaveLength(1);
  });
});

describe('Print with popups blocked', () => {
  it('does not return silently', () => {
    expect(PRINT).toContain("window.open('', '_blank'");
    expect(statements(PRINT, 'if (!w) return;')).toHaveLength(0);
  });

  it('raises DisplayErrorMessage’s dialog and names the cause', () => {
    expect(statements(PRINT, 'displayErrorMessage(')).toHaveLength(1);
    expect(PRINT).toContain('pop-up');
  });

  it('uses the shared message dialog rather than a private one', () => {
    // common/confirm.cpp's DisplayErrorMessage is one dialog for every frame;
    // ui/dialog_message.tsx is that one component here.
    expect(EDITOR).toContain("from '../../ui/dialog_message.js'");
  });

  it('does not borrow upstream’s printer-error sentence for a browser refusal', () => {
    // `An error occurred attempting to print the drawing sheet.`
    // (dialogs_for_printing.cpp:241) reports a printer that refused the job.
    // A blocked popup is a different event and pointing the user at the printer
    // would be worse than saying nothing.
    expect(EDITOR).not.toContain('An error occurred attempting to print');
  });
});
