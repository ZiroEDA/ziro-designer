// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_BOOK_REPORTER` (common/dialogs/dialog_book_reporter.cpp) with its
 * `_base` folded in: a wxNotebook of report pages and the standard buttons,
 * of which only OK shows (`m_sdbSizerApply->Hide()`). It is modeless: the
 * board editor keeps it up while the user goes on selecting.
 *
 * A page is `AddHTMLPage( aTitle )`: a panel holding one WX_HTML_REPORT_BOX
 * (wxEXPAND|wxALL 5, wxBORDER_SIMPLE) that the caller Report()s into.
 * BOARD_INSPECTION_TOOL fills the Clearance and Constraints reports this way.
 *
 * The sizer tree (dialog_book_reporter_base.cpp): the notebook, minimum
 * 550 x 480, wxEXPAND|wxALL 10; the button sizer wxEXPAND|wxALL 5.
 */
import { useEffect, useState, type JSX, type Ref } from 'react';
import { WX_HTML_REPORT_BOX } from '../widgets/wx_html_report_box.js';
import { useModalEscape } from '../dialog_shim.js';
import { Combo } from '../widgets/wx_combobox.js';
import type {
  BOOK_REPORTER_PAGE,
  BOOK_REPORTER_PANEL_ITEM,
  DIALOG_BOOK_REPORTER,
} from './dialog_book_reporter.js';

export type { BOOK_REPORTER_PAGE };

export function DialogBookReporter({
  title,
  pages,
  onClose,
  rootRef,
}: {
  /** `aTitle`: "Clearance Report", "Constraints Report". */
  title: string;
  pages: readonly BOOK_REPORTER_PAGE[];
  /** OK, or the window closed (`OnClose`). */
  onClose: () => void;
  /** The frame measures its modeless dialogs to keep items clear of them. */
  rootRef?: Ref<HTMLDivElement>;
}): JSX.Element {
  const [page, setPage] = useState(0);
  useModalEscape(onClose);
  const shown = Math.min(page, Math.max(0, pages.length - 1));

  return (
    <div ref={rootRef} className="ze-modal ze-bookreporter" role="dialog" aria-label={title}>
      <div className="ze-modal-header">
        {title}
        <span className="x" title="Close" onClick={onClose}>
          ✕
        </span>
      </div>
      <div className="ze-nb-frame ze-bookreporter-notebook">
        <div className="ze-nb-tabs" role="tablist">
          {pages.map((p, i) => (
            <button
              key={p.title}
              type="button"
              role="tab"
              aria-selected={i === shown}
              className={i === shown ? 'active' : undefined}
              onClick={() => setPage(i)}
            >
              {p.title}
            </button>
          ))}
        </div>
        <div className="ze-nb-body ze-bookreporter-body">
          {pages.map((p, i) => (
            <div
              key={p.title}
              role="tabpanel"
              className={p.panel ? 'ze-bookreporter-page blank' : 'ze-bookreporter-page'}
              data-nbhide={i === shown ? undefined : ''}
            >
              {p.panel ? (
                <BlankPagePanel items={p.panel} />
              ) : (
                <WX_HTML_REPORT_BOX messages={p.messages} />
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="ze-modal-footer ze-bookreporter-buttons">
        <button type="button" className="ze-btn primary" onClick={onClose}>
          OK
        </button>
      </div>
    </div>
  );
}

/**
 * An `AddBlankPage` panel: its vbox stacks what the caller added. The
 * clearance report's layer page adds a label (wxLEFT|wxRIGHT|wxTOP, 5), a
 * wxChoice (wxEXPAND|wxALL, 5) and a report box (1, wxEXPAND|wxALL, 5)
 * (board_inspection_tool.cpp:1269-1278).
 */
function BlankPagePanel({ items }: { items: readonly BOOK_REPORTER_PANEL_ITEM[] }): JSX.Element {
  return (
    <>
      {items.map((item, i) => {
        // biome-ignore lint/suspicious/noArrayIndexKey: the panel's widgets never reorder
        const key = i;
        if (item.kind === 'text')
          return (
            <span key={key} className="ze-bookreporter-label">
              {item.text}
            </span>
          );
        if (item.kind === 'choice')
          return (
            <Combo
              key={key}
              className="ze-bookreporter-choice"
              value={String(item.selection)}
              options={item.items.map((label, j) => ({ value: String(j), label }))}
              onChange={(v) => item.select(Number(v))}
            />
          );
        return (
          <div key={key} className="ze-bookreporter-report">
            <WX_HTML_REPORT_BOX messages={item.messages} />
          </div>
        );
      })}
    </>
  );
}

/**
 * One DIALOG_BOOK_REPORTER as the frame hosts it: drawn while `Show(true)`,
 * redrawn on every page change and Flush(), and OK / the close box are its
 * OnClose, which hands the dialog's name to the frame to destroy it.
 */
export function DialogBookReporterModeless({
  dialog,
}: {
  dialog: DIALOG_BOOK_REPORTER;
}): JSX.Element | null {
  const [, setTick] = useState(0);
  useEffect(() => {
    const unsubscribe = dialog.Subscribe(() => setTick((t) => t + 1));
    return () => {
      unsubscribe();
    };
  }, [dialog]);

  if (!dialog.IsShown()) return null;

  return (
    <DialogBookReporter
      title={dialog.GetTitle()}
      pages={dialog.GetPages()}
      onClose={() => dialog.OnClose('ok')}
    />
  );
}
