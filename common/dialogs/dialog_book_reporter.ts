// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_BOOK_REPORTER` (common/dialogs/dialog_book_reporter.cpp), the object
 * a tool fills: `DeleteAllPages()`, then `AddHTMLPage( title )` per report,
 * `Report()`ing into the WX_HTML_REPORT_BOX each one returns, then `Show()`.
 * The window that draws it is `DialogBookReporter` in dialog_book_reporter_ui.tsx;
 * the frame owns one instance per name (`GetInspectDrcErrorDialog()` and its
 * siblings) and subscribes the window to it.
 *
 * Modeless: OK and the close box queue EDA_EVT_CLOSE_DIALOG_BOOK_REPORTER to
 * the parent with the dialog's name, and the frame's
 * onCloseModelessBookReporterDialogs destroys the instance. `OnClose` here
 * calls the handler the frame passed in, carrying the same name and button id.
 */
import { Reporter } from '../reporter.js';

/** One page as the window draws it: the notebook caption and what was reported. */
export interface BOOK_REPORTER_PAGE {
  /** `AddHTMLPage( aTitle )`'s caption. */
  title: string;
  /** What the page's reporter was given, in order. */
  messages: readonly string[];
  /** An `AddBlankPage` page's content (a widget the caller put on it); absent on an HTML page. */
  panel?: BOOK_REPORTER_BLANK_PAGE;
}

/** `AddBlankPage( aTitle )`'s wxPanel: the caller sets what it holds, the window draws it. */
export interface BOOK_REPORTER_BLANK_PAGE {
  content: unknown;
}

/**
 * WX_HTML_REPORT_BOX as the tool sees it: a REPORTER whose lines are the page.
 * `Flush()` is where the C++ box renders what it was given; here it tells the
 * dialog's window to draw the page again.
 */
export class WX_HTML_REPORT_BOX_REPORTER extends Reporter {
  constructor(private readonly m_onFlush: () => void) {
    super();
  }

  Flush(): void {
    this.m_onFlush();
  }
}

/** `wxID_OK` / `wxID_APPLY`: which button closed the dialog (`closeEvent.SetId`). */
export type BOOK_REPORTER_CLOSE_ID = 'ok' | 'apply';

export class DIALOG_BOOK_REPORTER {
  private m_pages: {
    title: string;
    reporter: WX_HTML_REPORT_BOX_REPORTER;
    panel?: BOOK_REPORTER_BLANK_PAGE;
  }[] = [];
  private m_shown = false;
  private m_userItemID: string | null = null;
  private readonly m_listeners = new Set<() => void>();
  /** `m_sdbSizerApply`: hidden unless a caller shows it (the footprint diff does). */
  private m_applyLabel: string | null = null;

  /**
   * @param aName `SetName( aName )`: what the close event carries.
   * @param aTitle the dialog's caption.
   * @param aOnClose the parent's EDA_EVT_CLOSE_DIALOG_BOOK_REPORTER handler.
   */
  constructor(
    private readonly aName: string,
    private readonly aTitle: string,
    private readonly aOnClose: (aName: string, aId: BOOK_REPORTER_CLOSE_ID) => void = () => {},
  ) {}

  GetName(): string {
    return this.aName;
  }

  GetTitle(): string {
    return this.aTitle;
  }

  /** `m_notebook->DeleteAllPages()`. */
  DeleteAllPages(): void {
    this.m_pages = [];
    this.notify();
  }

  /** A notebook page holding one WX_HTML_REPORT_BOX, which the caller reports into. */
  AddHTMLPage(aTitle: string): WX_HTML_REPORT_BOX_REPORTER {
    const reporter = new WX_HTML_REPORT_BOX_REPORTER(() => this.notify());
    this.m_pages.push({ title: aTitle, reporter });
    this.notify();
    return reporter;
  }

  /** `AddBlankPage( aTitle )`: a notebook page with an empty panel for the caller to fill. */
  AddBlankPage(aTitle: string): BOOK_REPORTER_BLANK_PAGE {
    const panel: BOOK_REPORTER_BLANK_PAGE = { content: null };
    this.m_pages.push({
      title: aTitle,
      reporter: new WX_HTML_REPORT_BOX_REPORTER(() => this.notify()),
      panel,
    });
    this.notify();
    return panel;
  }

  GetPageCount(): number {
    return this.m_pages.length;
  }

  /** The pages as the window draws them. */
  GetPages(): BOOK_REPORTER_PAGE[] {
    return this.m_pages.map((p) => ({
      title: p.title,
      messages: p.reporter.lines.map((l) => l.message),
      ...(p.panel ? { panel: p.panel } : {}),
    }));
  }

  GetUserItemID(): string | null {
    return this.m_userItemID;
  }

  SetUserItemID(aID: string | null): void {
    this.m_userItemID = aID;
  }

  /** `m_sdbSizerApply->SetLabel( … ); m_sdbSizerApply->Show()`; null hides it again. */
  SetApplyLabel(aLabel: string | null): void {
    this.m_applyLabel = aLabel;
    this.notify();
  }

  GetApplyLabel(): string | null {
    return this.m_applyLabel;
  }

  Show(aShow = true): boolean {
    this.m_shown = aShow;
    this.notify();
    return true;
  }

  IsShown(): boolean {
    return this.m_shown;
  }

  /** `OnOK` / `OnApply` / `OnClose`: hand the dialog's name to the parent. */
  OnClose(aId: BOOK_REPORTER_CLOSE_ID = 'ok'): void {
    this.m_shown = false;
    this.notify();
    this.aOnClose(this.aName, aId);
  }

  /** The window's subscription; returns the unsubscribe. */
  Subscribe(aListener: () => void): () => void {
    this.m_listeners.add(aListener);
    return () => this.m_listeners.delete(aListener);
  }

  private notify(): void {
    for (const l of this.m_listeners) l();
  }
}
