// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from wxWidgets, copyright the wxWidgets team (wxWindows Library Licence).
/**
 * `wxNotebook` (wxBookCtrlBase), the model half: pages, their text, their image from the
 * assigned image list, and the selection. A view draws the tabs and the selected page and
 * redraws when a refresh listener fires, as `aui_notebook.ts` does for wxAuiNotebook.
 */
export class wxNotebook<PAGE> {
  private m_pages: { page: PAGE; text: string; image: number }[] = [];
  private m_images: string[] = [];
  private m_selection = -1;
  private readonly m_refresh = new Set<() => void>();

  /** `AssignImageList( imageList )`: the bitmaps, by name, a page's image indexes. */
  AssignImageList(aImages: readonly string[]): void {
    this.m_images = aImages.slice();
  }

  GetImageList(): readonly string[] {
    return this.m_images;
  }

  /** `AddPage( page, text, select, imageId )`; the first page is selected regardless. */
  AddPage(aPage: PAGE, aText: string, aSelect = false, aImageId = -1): boolean {
    this.m_pages.push({ page: aPage, text: aText, image: aImageId });

    if (aSelect || this.m_selection < 0) this.m_selection = this.m_pages.length - 1;

    this.Refresh();
    return true;
  }

  GetPageCount(): number {
    return this.m_pages.length;
  }

  GetPage(aPage: number): PAGE {
    const entry = this.m_pages[aPage];

    if (!entry) throw new RangeError(`wxNotebook: no page ${aPage}`);

    return entry.page;
  }

  GetPageText(aPage: number): string {
    return this.m_pages[aPage]?.text ?? '';
  }

  SetPageImage(aPage: number, aImage: number): boolean {
    const entry = this.m_pages[aPage];

    if (!entry) return false;

    entry.image = aImage;
    this.Refresh();
    return true;
  }

  GetPageImage(aPage: number): number {
    return this.m_pages[aPage]?.image ?? -1;
  }

  GetSelection(): number {
    return this.m_selection;
  }

  SetSelection(aPage: number): number {
    const old = this.m_selection;

    if (aPage >= 0 && aPage < this.m_pages.length) this.m_selection = aPage;

    this.Refresh();
    return old;
  }

  AddRefreshListener(aListener: () => void): () => void {
    this.m_refresh.add(aListener);
    return () => this.m_refresh.delete(aListener);
  }

  Refresh(): void {
    for (const listener of this.m_refresh) listener();
  }
}
