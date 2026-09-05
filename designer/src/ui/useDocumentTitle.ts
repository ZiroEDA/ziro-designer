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
import { PRODUCT } from './about_titles.js';

/** The app name every title ends with, matching index.html's default. */
export const APP_NAME = PRODUCT;

/** `*doc, Editor · ZiroEDA`, or `Editor · ZiroEDA` with no doc. */
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
  const full = fileName?.trim();
  if (!full) return placeholder;
  // wxFileName::GetName() is the NAME half alone — no directory and no
  // extension. Every frame here holds `GetCurrentFileName()`, which upstream is
  // a full path (`SetCurrentFileName( filename )` takes what the Save As dialog
  // returned, pagelayout_editor/files.cpp:232), so a title built from it has to
  // drop the directory as well. This dropped only the extension, which was
  // invisible while the editors held bare leaf names and became a title reading
  // `/Templates/frame` the moment one of them held a real path.
  const name = full.split(/[/\\]/).filter(Boolean).pop() ?? '';
  // Only a real extension goes: a leading dot is not one, so ".hidden" stays
  // ".hidden" and "*.kicad_wks" keeps its name.
  return name.replace(/(?!^)\.[^.]*$/, '') || placeholder;
}

/** The em dash, with its spaces, that separates the two halves. */
export const FRAME_TITLE_SEPARATOR = ' — ';

/**
 * The WHOLE frame-title rule, not just the name half.
 *
 * `docs/frame-titles.md` records every `SetTitle` in KiCad 10.0.5 that builds a
 * frame title — thirteen of them. Twelve share one shape:
 *
 *     title  = "*"                     if IsContentModified()
 *     title += <document part>
 *     title += " " + "[Read Only]"     if the file is not writable
 *     title += " " + "[Unsaved]"       if it does not exist yet
 *     title += " — " + <Frame Name>
 *
 * Four things this has to be parameterised for, none guessable from one frame:
 *
 *  - **`GetName()` vs `GetFullName()`.** Nine frames drop the extension.
 *    Exactly two keep it — Gerber Viewer (`gerbview_frame.cpp:684`) and the
 *    Image Converter (`bitmap2cmp_frame.cpp:359`) — so {@link frameTitleName}
 *    alone cannot serve either.
 *  - **The empty state has three forms.** Most frames substitute a bracketed
 *    placeholder and still append the dash. Gerber Viewer and the Image
 *    Converter print the frame name **alone, with no dash at all**:
 *    `SetTitle( _( "Gerber Viewer" ) )` is one string at
 *    `gerbview_frame.cpp:667`, and the converter builds its `" — "` *inside*
 *    `if( !m_srcFileName.IsEmpty() )` (`:357-360`). The PCB editor and the
 *    simulator have no empty branch at all and lean on `[Unsaved]`.
 *  - **The suffixes are five strings**, not two, and each carries its own
 *    leading space where `*` carries none.
 *  - **Order.** `*` first with nothing after it, then the name, then the
 *    suffixes in the order the frame adds them.
 *
 * Returned as parts so a caller can weight the document half, which the real
 * title bar does.
 */
export interface FrameTitleParts {
  /** `"*"` when modified, else `""`. Prefix of the document half, no space. */
  modified: string;
  /** The document half, already carrying its `[...]` suffixes. */
  document: string;
  /** `" — "`, or `""` when there is no document half to separate. */
  separator: string;
  /** The frame's own name, e.g. `"Gerber Viewer"`. */
  frameName: string;
  /** The three joined, for a tab title or a test. */
  full: string;
}

export interface FrameTitleSpec {
  /** `_( "Gerber Viewer" )` — the half after the dash. */
  frameName: string;
  /**
   * The document half before any suffix: `fn.GetName()`, `fn.GetFullName()`,
   * an FPID, a library URI. Empty or absent means there is no document.
   */
  document?: string | null;
  /** `IsContentModified()`. */
  modified?: boolean;
  /**
   * What to show with no document.
   *
   * A bracketed string — `"[no schematic loaded]"` — is substituted and the
   * dash still appended. Leaving it undefined is the Gerber Viewer / Image
   * Converter case: the frame name stands **alone**, with no dash and no
   * placeholder.
   */
  placeholder?: string;
  /** Suffixes in the order the frame appends them, each without its space. */
  suffixes?: readonly string[];
}

/** `_( "[Read Only]" )`, on frames 1, 2, 4, 7 and 11 of `docs/frame-titles.md`. */
export const READ_ONLY_SUFFIX = '[Read Only]';
/** `_( "[Unsaved]" )`, on frames 1, 2, 4 and 7. */
export const UNSAVED_SUFFIX = '[Unsaved]';

export function frameTitle(spec: FrameTitleSpec): FrameTitleParts {
  const doc = spec.document?.trim() ?? '';
  const name = doc || (spec.placeholder ?? '');

  // No document and no placeholder: the frame name alone, no separator. This
  // is the branch Gerber Viewer and the Image Converter take, and it is why
  // ours read "Gerber Viewer  -  Gerber Viewer" — the call site passed the
  // frame name AS the placeholder and then appended it again.
  if (!name) {
    return {
      modified: '',
      document: '',
      separator: '',
      frameName: spec.frameName,
      full: spec.frameName,
    };
  }

  // `title += wxS( " " ) + _( "[Read Only]" )` — the suffix owns its space.
  const document = name + (spec.suffixes ?? []).map((s) => ` ${s}`).join('');
  // `if( IsContentModified() ) title = wxT( "*" );` then `title += ...` — no
  // space between the star and the name.
  const modified = spec.modified ? '*' : '';

  return {
    modified,
    document,
    separator: FRAME_TITLE_SEPARATOR,
    frameName: spec.frameName,
    full: `${modified}${document}${FRAME_TITLE_SEPARATOR}${spec.frameName}`,
  };
}
