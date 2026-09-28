// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `WX_HTML_REPORT_BOX` (common/widgets/wx_html_report_box.cpp): a REPORTER
 * that is an HTML_WINDOW. Each `Report( line )` is kept, and `Flush()` sets the
 * page to every line through `generateHtml`:
 *
 *     <img align=texttop height=%d width=0 src=#>LINE<br>
 *
 * - an invisible strut 0.6 of the font's pixel height, the "egregious hack"
 * upstream uses to force a minimum line spacing wxHTML will not let it set.
 * `.ze-report-strut` is that strut.
 *
 * The lines are HTML the caller built; a caller escapes anything it did not
 * write itself (BOARD_INSPECTION_TOOL runs every item description through
 * EscapeHTML), as upstream's callers do.
 */
import type { JSX } from 'react';
import { HtmlWindow } from './html_window.js';

/** `generateHtml`, over every kept line: what `Flush()` sets the page to. */
export function reportBoxHtml(aMessages: readonly string[]): string {
  return aMessages.map((line) => `<span class="ze-report-strut"></span>${line}<br>`).join('');
}

export function WX_HTML_REPORT_BOX({
  messages,
  className,
}: {
  /** `m_messages`, in `Report()` order. */
  messages: readonly string[];
  className?: string;
}): JSX.Element {
  return (
    <HtmlWindow
      html={reportBoxHtml(messages)}
      className={`ze-html-report-box${className ? ` ${className}` : ''}`}
    />
  );
}
