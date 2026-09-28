// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `HTML_WINDOW` (`common/widgets/html_window.cpp`): KiCad's wxHtmlWindow, the
 * one every dialog that shows markup uses.
 *
 * What it adds to wxHtmlWindow, each carried here:
 *
 *   - `SetPage` wraps the source in `<body text=WINDOWTEXT bgcolor=WINDOW
 *     link=HOTLIGHT>`, so a page takes the theme's colours rather than black
 *     on white. Those are `--view-fg`, `--chrome-bg2` and `--link-fg`, set on
 *     `.ze-html-window`.
 *   - a right-click popup with Copy and Select All;
 *   - Ctrl+A / Ctrl+C in a char hook, doing the same two things.
 *
 * `wxHW_NO_SELECTION` is `selectable={false}`: the text cannot be selected,
 * and Select All then does nothing, as wxHtmlWindow's does.
 *
 * A clicked link goes to the browser, which is what every KiCad caller does
 * with `wxEVT_COMMAND_HTML_LINK_CLICKED` (`::wxLaunchDefaultBrowser`), so it is
 * done here once instead of at each call site.
 *
 * The markup is rendered as HTML, so only a constant of ours may reach it:
 * never a report, a file name or anything else a user or a board supplied.
 * `HTML_MESSAGE_BOX`'s `messages` path exists for those.
 */
import { type JSX, useRef, useState } from 'react';
import { ContextMenu } from '../tool/action_menu_bar.js';

export function HtmlWindow({
  html,
  selectable = true,
  className,
}: {
  /** `SetPage( aSource )`: the body's markup. A compiled-in constant only. */
  html: string;
  /** false is `wxHW_NO_SELECTION`. */
  selectable?: boolean;
  className?: string;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  // HTML_WINDOW::SelectAll, i.e. wxHtmlWindow's: the whole page, and nothing
  // when selection is disabled.
  const selectAll = (): void => {
    if (!selectable || !ref.current) return;
    const sel = window.getSelection();
    if (!sel) return;
    const range = document.createRange();
    range.selectNodeContents(ref.current);
    sel.removeAllRanges();
    sel.addRange(range);
  };

  // HTML_WINDOW::doCopySelection: the selection as text, nothing when empty.
  const copySelection = (): void => {
    const text = window.getSelection()?.toString() ?? '';
    if (text === '') return;
    void navigator.clipboard?.writeText(text).catch(() => {
      // wxLogNull: a failed clipboard write is not reported.
    });
  };

  return (
    <>
      {/* The markup is a compiled-in constant; see this file's header. */}
      <div
        ref={ref}
        className={`ze-html-window${selectable ? '' : ' no-select'}${className ? ` ${className}` : ''}`}
        tabIndex={0}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: a compiled-in constant, never user content
        dangerouslySetInnerHTML={{ __html: html }}
        onClick={(e) => {
          const a = (e.target as HTMLElement).closest('a');
          if (!a) return;
          e.preventDefault();
          window.open(a.href, '_blank', 'noopener,noreferrer');
        }}
        onKeyDown={(e) => {
          if (!(e.ctrlKey || e.metaKey)) return;
          const k = e.key.toLowerCase();
          if (k === 'a') {
            e.preventDefault();
            selectAll();
          } else if (k === 'c') {
            e.preventDefault();
            copySelection();
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      />
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: 'Copy', action: copySelection },
            { label: 'Select All', action: selectAll },
          ]}
        />
      )}
    </>
  );
}
