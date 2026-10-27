// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from wxWidgets (wxWindows Library Licence).
/**
 * `wxAuiNotebook`, drawn: one window, its tab row and then the selected page. A tab's close
 * button is `wxAUI_NB_CLOSE_ON_ALL_TABS`', hidden where the art provider hides it (KiCad's
 * `WX_AUI_TAB_ART::DrawTab` hides it on a `PANEL_NOTEBOOK_BASE` that is not closable).
 * `wxEVT_AUINOTEBOOK_PAGE_CLOSE` is `onPageClose`, which deletes the page itself or vetoes by
 * doing nothing.
 */
import { type JSX, type ReactNode, useLayoutEffect, useReducer } from 'react';
import type { wxAuiNotebook } from './aui_notebook.js';

export function AuiNotebookView<PAGE>({
  notebook,
  closable,
  onPageChanging,
  onPageClose,
  children,
  className,
  ariaLabel,
}: {
  notebook: wxAuiNotebook<PAGE>;
  /** Whether the tab of page \a aPage draws its close button. */
  closable?: (aPage: number) => boolean;
  /** `wxEVT_AUINOTEBOOK_PAGE_CHANGING`, before the selection moves. */
  onPageChanging?: (aPage: number) => void;
  /** `wxEVT_AUINOTEBOOK_PAGE_CLOSE` on page \a aPage. */
  onPageClose?: (aPage: number) => void;
  /** The selected page. */
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
}): JSX.Element {
  const [, bump] = useReducer((n: number) => n + 1, 0);

  useLayoutEffect(() => notebook.AddRefreshListener(bump), [notebook]);

  const selection = notebook.GetSelection();

  return (
    <div className={className}>
      <div className="ze-tabbar" role="tablist" aria-label={ariaLabel}>
        {Array.from({ length: notebook.GetPageCount() }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a page is its index in the notebook
          <span key={i} className={`ze-tab${i === selection ? ' active' : ''}`}>
            <button
              type="button"
              role="tab"
              aria-selected={i === selection}
              onClick={() => {
                if (i === selection) return;
                onPageChanging?.(i);
                notebook.SetSelection(i);
              }}
            >
              {notebook.GetPageText(i)}
            </button>
            {closable?.(i) && (
              <button
                type="button"
                className="ze-tab-close"
                aria-label={`Close ${notebook.GetPageText(i)}`}
                onClick={() => onPageClose?.(i)}
              >
                ×
              </button>
            )}
          </span>
        ))}
      </div>
      {children}
    </div>
  );
}
