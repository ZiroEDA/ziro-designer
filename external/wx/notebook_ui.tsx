// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from wxWidgets (wxWindows Library Licence).
/**
 * `wxNotebook`, drawn: the frame, the GtkNotebook tab strip, and the pages. Every page stays
 * in the layout, sharing one grid cell, so the notebook is as large as its largest page and
 * changing the tab never resizes the dialog - which is what `SetSizeHints` over a wxNotebook
 * gives KiCad. The styling is the measured `.ze-nb-*` set in shell.css.
 */
import type { JSX, ReactNode } from 'react';
import { _ } from './translation.js';
import { useTranslations } from './translation_ui.js';

export interface NotebookPage {
  /** The tab's text (`AddPage( page, text )`). */
  text: string;
  /** `AddPage( page, text, select, imageId )`: the image list's picture before the text. */
  image?: ReactNode;
  content: ReactNode;
}

export function Notebook({
  pages,
  selection,
  onPageChanging,
  onPageChanged,
  ariaLabel,
}: {
  pages: readonly NotebookPage[];
  /** `GetSelection()`. */
  selection: number;
  /** `wxEVT_NOTEBOOK_PAGE_CHANGING`: false vetoes the change. */
  onPageChanging?: (aPage: number) => boolean;
  /** `wxEVT_NOTEBOOK_PAGE_CHANGED`, with the new selection. */
  onPageChanged: (aPage: number) => void;
  ariaLabel?: string;
}): JSX.Element {
  // `AddPage( page, _( "Text" ) )`: the tab's text is translated where it is drawn.
  useTranslations();
  return (
    <div className="ze-nb-frame">
      <div className="ze-nb-tabs" role="tablist" aria-label={ariaLabel}>
        {pages.map((p, i) => (
          <button
            key={p.text}
            type="button"
            role="tab"
            aria-selected={i === selection}
            className={i === selection ? 'active' : ''}
            onClick={() => {
              if (i === selection) return;
              if (onPageChanging && !onPageChanging(i)) return;
              onPageChanged(i);
            }}
          >
            {p.image !== undefined && <span className="ze-nb-tab-image">{p.image}</span>}
            {_(p.text)}
          </button>
        ))}
      </div>
      <div className="ze-nb-body">
        {pages.map((p, i) => (
          <div
            key={p.text}
            className="ze-nb-page"
            role="tabpanel"
            aria-label={_(p.text)}
            data-nbhide={i === selection ? undefined : ''}
          >
            {p.content}
          </div>
        ))}
      </div>
    </div>
  );
}
