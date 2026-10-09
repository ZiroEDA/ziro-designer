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

/** A widget on an `AddBlankPage` panel, in the order its sizer adds it. */
export type BOOK_REPORTER_PANEL_ITEM =
  | { kind: 'text'; text: string }
  | {
      kind: 'choice';
      items: readonly string[];
      selection: number;
      select: (aIndex: number) => void;
    }
  | { kind: 'report'; messages: readonly string[] }
  /** A widget a caller constructs on the panel itself (SCH_INSPECTION_TOOL's SYMBOL_DIFF_WIDGET). */
  | { kind: 'widget'; widget: unknown };

/** One page as the window draws it: the notebook caption and what was reported. */
export interface BOOK_REPORTER_PAGE {
  /** `AddHTMLPage( aTitle )`'s caption. */
  title: string;
  /** What the page's reporter was given, in order. */
  messages: readonly string[];
  /** An `AddBlankPage` panel's widgets; absent on an HTML page. */
  panel?: readonly BOOK_REPORTER_PANEL_ITEM[];
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

/** A `wxChoice` on a blank page: its strings, its selection, its `wxEVT_CHOICE` handler. */
export class BOOK_REPORTER_CHOICE {
  private m_items: string[] = [];
  private m_selection = -1;
  private m_handler: ((aSelection: number) => void) | null = null;

  constructor(private readonly m_onChange: () => void) {}

  Append(aItem: string): void {
    this.m_items.push(aItem);
    this.m_onChange();
  }

  SetSelection(aIndex: number): void {
    this.m_selection = aIndex;
    this.m_onChange();
  }

  GetSelection(): number {
    return this.m_selection;
  }

  GetStrings(): readonly string[] {
    return this.m_items;
  }

  /** `Bind( wxEVT_CHOICE, … )`. */
  Bind(aHandler: (aSelection: number) => void): void {
    this.m_handler = aHandler;
  }

  /** The user picked a row: the choice changes, then the event fires. */
  Select(aIndex: number): void {
    this.SetSelection(aIndex);
    this.m_handler?.(aIndex);
  }
}

/**
 * `AddBlankPage( aTitle )`'s wxPanel: the caller adds its own widgets, which
 * the panel's vertical sizer stacks in the order they are added.
 */
export class BOOK_REPORTER_PANEL {
  private readonly m_items: (
    | { kind: 'text'; text: string }
    | { kind: 'choice'; choice: BOOK_REPORTER_CHOICE }
    | { kind: 'report'; box: WX_HTML_REPORT_BOX_REPORTER }
    | { kind: 'widget'; widget: unknown }
  )[] = [];

  constructor(private readonly m_onChange: () => void) {}

  /** `new wxStaticText( panel, wxID_ANY, aText )`, added to the sizer. */
  AddStaticText(aText: string): void {
    this.m_items.push({ kind: 'text', text: aText });
    this.m_onChange();
  }

  /** `new wxChoice( panel, wxID_ANY )`, added to the sizer. */
  AddChoice(): BOOK_REPORTER_CHOICE {
    const choice = new BOOK_REPORTER_CHOICE(this.m_onChange);
    this.m_items.push({ kind: 'choice', choice });
    this.m_onChange();
    return choice;
  }

  /** `new WX_HTML_REPORT_BOX( panel, … )`, added to the sizer. */
  AddReportBox(): WX_HTML_REPORT_BOX_REPORTER {
    const box = new WX_HTML_REPORT_BOX_REPORTER(this.m_onChange);
    this.m_items.push({ kind: 'report', box });
    this.m_onChange();
    return box;
  }

  /** A widget constructed with the panel as its parent, added to the sizer. */
  AddWidget(aWidget: unknown): void {
    this.m_items.push({ kind: 'widget', widget: aWidget });
    this.m_onChange();
  }

  /** The widgets as the window draws them. */
  GetItems(): BOOK_REPORTER_PANEL_ITEM[] {
    return this.m_items.map((i): BOOK_REPORTER_PANEL_ITEM => {
      if (i.kind === 'text' || i.kind === 'widget') return i;
      if (i.kind === 'choice')
        return {
          kind: 'choice',
          items: i.choice.GetStrings(),
          selection: i.choice.GetSelection(),
          select: (aIndex) => i.choice.Select(aIndex),
        };
      return { kind: 'report', messages: i.box.lines.map((l) => l.message) };
    });
  }
}

/** `wxID_OK` / `wxID_APPLY`: which button closed the dialog (`closeEvent.SetId`). */
export type BOOK_REPORTER_CLOSE_ID = 'ok' | 'apply';

export class DIALOG_BOOK_REPORTER {
  private m_pages: (
    | { title: string; reporter: WX_HTML_REPORT_BOX_REPORTER }
    | { title: string; panel: BOOK_REPORTER_PANEL }
  )[] = [];
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

  /** A notebook page holding an empty panel, which the caller fills with widgets. */
  AddBlankPage(aTitle: string): BOOK_REPORTER_PANEL {
    const panel = new BOOK_REPORTER_PANEL(() => this.notify());
    this.m_pages.push({ title: aTitle, panel });
    this.notify();
    return panel;
  }

  GetPageCount(): number {
    return this.m_pages.length;
  }

  /** The pages as the window draws them. */
  GetPages(): BOOK_REPORTER_PAGE[] {
    return this.m_pages.map((p) =>
      'reporter' in p
        ? { title: p.title, messages: p.reporter.lines.map((l) => l.message) }
        : { title: p.title, messages: [], panel: p.panel.GetItems() },
    );
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
