// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What pl_editor prints, and how many sheets of paper it is.
 *
 * `PLEDITOR_PRINTOUT` (pagelayout_editor/dialogs/dialogs_for_printing.cpp) is
 * a two-page printout and says so twice:
 *
 *     bool HasPage( int aPageNum ) override { return ( aPageNum <= 2 ); }      // :62
 *     *minPage = *selPageFrom = 1;                                            // :155
 *     *maxPage = *selPageTo   = 2;                                            // :156
 *
 * and `InvokeDialogPrint` seeds the dialog with `printDialogData.SetMaxPage( 2 )`
 * and enables the page-number controls because of it (:227-233). The GTK print
 * dialog a driven pl_editor opens really does show the two-page collate icon.
 *
 * Two pages is the point of the editor rather than a detail of it. Every item
 * carries a page option — `(option page1only)` or `(option notonpage1)` — and
 * `PrintPage` sets `screen->SetVirtualPageNumber( aPageNum )` before rendering
 * (:189) so that each page shows its own set. A one-page print can show at most
 * half of any sheet that uses the feature, and ours printed whichever page the
 * toolbar's `Page 1 / Other pages` selector happened to be on.
 *
 * Kept out of `DrawingSheetEditor.tsx` so `qa` can hold it: the frame is a
 * `.tsx` and `qa`'s tsconfig sets no `--jsx`.
 */

/**
 * `HasPage( aPageNum ) => aPageNum <= 2`. The pages are numbered from 1, so
 * this is `[1, 2]`.
 */
export const PL_EDITOR_PRINT_PAGES: readonly number[] = [1, 2];

/**
 * The document handed to the print window: one image per page, each on its own
 * sheet.
 *
 * `page-break-after: always` on every image but the last is what makes the
 * browser's print pipeline emit `PL_EDITOR_PRINT_PAGES.length` sheets; without
 * it two images flow onto one page and the printout is not what `HasPage`
 * promised. The `load` listener waits for the whole document rather than the
 * first image's `onload`, which can fire before the second has been laid out
 * and prints a blank second sheet.
 */
export function printDocumentHtml(title: string, pageImages: readonly string[]): string {
  const style =
    'img{width:100%;display:block;page-break-after:always}img:last-child{page-break-after:auto}';
  return (
    `<title>${title}</title><style>${style}</style>` +
    pageImages.map((src) => `<img src="${src}">`).join('') +
    // Split so this source string cannot close the enclosing document early.
    '<script>window.addEventListener("load",function(){window.print()})</scr' +
    'ipt>'
  );
}
