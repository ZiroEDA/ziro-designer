// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The browser tab's title. Counterpart: each frame's `UpdateTitle()` (e.g.
 * `pcbnew/footprint_edit_frame.cpp`, `eeschema/sch_edit_frame.cpp`), which
 * names the open document, marks it modified with a leading `*`, and appends
 * the frame's name.
 *
 * Two things differ from a desktop window title. The editors here all stay
 * mounted and are toggled with CSS, so a title effect that just wrote
 * `document.title` left whichever editor ran last owning the tab, open the
 * Footprint Editor once and every other view reads "[no footprint loaded]"
 * forever. And a tab is narrow and truncates from the right, so the useful
 * part has to come first and KiCad's bracketed placeholders ("[no footprint
 * loaded]") are dropped in favour of the editor's own name.
 */

import { useEffect } from 'react';

/** The app name every title ends with, matching index.html's default. */
export const APP_NAME = 'Ziro Designer';

/** `*doc, Editor · Ziro Designer`, or `Editor · Ziro Designer` with no doc. */
export function formatTitle(editor: string, doc?: string | null, modified = false): string {
  const name = doc?.trim();
  const head = name ? `${modified ? '*' : ''}${name}, ${editor}` : editor;
  return `${head} · ${APP_NAME}`;
}

/**
 * Own the tab title while `view` is the one on screen. App stamps the active
 * view on `document.body`, so each editor waits its turn instead of racing the
 * others.
 */
export function useDocumentTitle(view: string, title: string): void {
  useEffect(() => {
    const apply = (): void => {
      if (document.body.dataset.activeView === view) document.title = title;
    };
    apply();
    // The view switches by attribute, not by unmounting, so watch for it.
    const observer = new MutationObserver(apply);
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-active-view'] });
    return () => observer.disconnect();
  }, [view, title]);
}

/**
 * The FRAME title, which is not the tab title. Every KiCad editor builds it the
 * same way — `PL_EDITOR_FRAME::UpdateTitleAndInfo`
 * (pagelayout_editor/pl_editor_frame.cpp:570-586) is the shape:
 *
 *     if( IsContentModified() )  title = "*";
 *     if( file.IsOk() )          title += file.GetName();
 *     else                       title += _( "[no drawing sheet loaded]" );
 *     title += " — " + _( "Drawing Sheet Editor" );
 *
 * Three details that are each easy to get wrong: `wxFileName::GetName()` is the
 * base name WITHOUT its extension, the separator is an EM DASH with a space
 * either side rather than an ASCII hyphen, and an empty file name gets the
 * frame's own bracketed placeholder instead of being left blank.
 *
 * Returned as its parts so a caller can render the document name in bold, the
 * way the real title bar weights it.
 */
export function frameTitleName(fileName: string | null | undefined, placeholder: string): string {
  const name = fileName?.trim();
  // wxFileName::GetName(): drop the last extension, and only a real one - a
  // dot in a directory component is not an extension, and a leading dot is not
  // one either ("*.kicad_wks" keeps its name, ".hidden" stays ".hidden").
  return name ? name.replace(/(?!^)\.[^./\\]*$/, '') : placeholder;
}

/** The em dash, with its spaces, that separates the two halves. */
export const FRAME_TITLE_SEPARATOR = ' — ';
