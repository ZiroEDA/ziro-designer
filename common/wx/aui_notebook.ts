// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `wxAuiNotebook`, the model half: pages, their tab text and the selection.
 * wxWidgets, not KiCad code; only what the library-table panels call. A view
 * draws the tabs and the selected page, and redraws when a refresh listener fires.
 */
export class wxAuiNotebook<PAGE> {
  private m_pages: { page: PAGE; text: string }[] = [];
  private m_selection = -1;
  private readonly m_refresh = new Set<() => void>();

  /** `AddPage( page, caption, select )`; the first page is selected regardless. */
  AddPage(aPage: PAGE, aCaption: string, aSelect = false): boolean {
    this.m_pages.push({ page: aPage, text: aCaption });

    if (aSelect || this.m_selection < 0) this.m_selection = this.m_pages.length - 1;

    this.Refresh();
    return true;
  }

  GetPageCount(): number {
    return this.m_pages.length;
  }

  GetPage(aPage: number): PAGE {
    const entry = this.m_pages[aPage];

    if (!entry) throw new RangeError(`wxAuiNotebook: no page ${aPage}`);

    return entry.page;
  }

  /** `GetPageIndex( page )`: wxNOT_FOUND (-1) when it is not a page here. */
  GetPageIndex(aPage: PAGE): number {
    return this.m_pages.findIndex((p) => p.page === aPage);
  }

  GetPageText(aPage: number): string {
    return this.m_pages[aPage]?.text ?? '';
  }

  SetPageText(aPage: number, aText: string): boolean {
    const entry = this.m_pages[aPage];

    if (!entry) return false;

    entry.text = aText;
    this.Refresh();
    return true;
  }

  GetSelection(): number {
    return this.m_selection;
  }

  /** `SetSelection`; the page-changing events are the view's to send. */
  SetSelection(aPage: number): number {
    const old = this.m_selection;

    if (aPage >= 0 && aPage < this.m_pages.length) this.m_selection = aPage;

    this.Refresh();
    return old;
  }

  ChangeSelection(aPage: number): number {
    return this.SetSelection(aPage);
  }

  /** A view's redraw, called on every change; returns its removal. */
  AddRefreshListener(aListener: () => void): () => void {
    this.m_refresh.add(aListener);
    return () => this.m_refresh.delete(aListener);
  }

  Refresh(): void {
    for (const listener of this.m_refresh) listener();
  }
}
