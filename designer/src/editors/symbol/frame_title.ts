// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SYMBOL_EDIT_FRAME::UpdateTitle` (eeschema/symbol_editor/symbol_editor.cpp:58-88),
 * row 3 of `docs/frame-titles.md`.
 *
 * The shape — star, document, suffixes, em dash, frame name — is shared and
 * lives in `frameTitle()` in `ui/useDocumentTitle.ts`. This module states only
 * the three decisions that are the symbol editor's own, and states nothing the
 * shared function already states.
 *
 * The C++, in full:
 *
 *     wxString title;
 *
 *     if( GetCurSymbol() && IsSymbolFromSchematic() )
 *     {
 *         if( GetScreen() && GetScreen()->IsContentModified() )
 *             title = wxT( "*" );
 *
 *         title += m_reference;
 *         title += wxS( " " ) + _( "[from schematic]" );
 *     }
 *     else if( GetCurSymbol() )
 *     {
 *         if( GetScreen() && GetScreen()->IsContentModified() )
 *             title = wxT( "*" );
 *
 *         title += UnescapeString( GetCurSymbol()->GetLibId().Format() );
 *
 *         if( m_libMgr && m_libMgr->LibraryExists( GetCurLib() )
 *                 && m_libMgr->IsLibraryReadOnly( GetCurLib() ) )
 *             title += wxS( " " ) + _( "[Read Only Library]" );
 *     }
 *     else
 *     {
 *         title = _( "[no symbol loaded]" );
 *     }
 *
 *     title += wxT( " — " ) + _( "Symbol Editor" );
 *
 * Four things that are easy to get wrong, and ours had all four wrong:
 *
 *  - **The document is the symbol, never the project.** Ours printed
 *    `Prj().GetProjectName()` where the LIB_ID goes, which is not a formatting
 *    slip but the wrong document entirely: a user editing `Device:R` read
 *    `MyProject`. `UpdateTitle` does not mention the project in any branch.
 *  - **The read-only suffix is a different string here.** Five frames say
 *    `[Read Only]`; this one alone says `[Read Only Library]`, because the
 *    thing that is not writable is the library, not a file
 *    (`docs/frame-titles.md` note C). {@link READ_ONLY_SUFFIX} is the wrong
 *    constant to reach for.
 *  - **There is no `[Unsaved]` branch**, unlike the footprint editor's. An
 *    unsaved symbol still has a LIB_ID and takes the second branch.
 *  - **The empty branch cannot carry a star.** `title = _( "[no symbol
 *    loaded]" )` is an assignment, and the two `title = wxT( "*" )` lines are
 *    both inside branches that ran already. So a modified library with no
 *    symbol open reads `[no symbol loaded]`, never `*[no symbol loaded]`.
 */

import { frameTitle, type FrameTitleParts } from '../../ui/useDocumentTitle.js';

/** `_( "Symbol Editor" )`, the half after the dash. */
export const SYM_FRAME_NAME = 'Symbol Editor';

/** `_( "[no symbol loaded]" )` — symbol_editor.cpp:83. */
export const SYM_NO_DOCUMENT = '[no symbol loaded]';

/**
 * `_( "[Read Only Library]" )` — symbol_editor.cpp:79.
 *
 * Deliberately not `READ_ONLY_SUFFIX`: this frame is the only one of the
 * thirteen that says "Library" (`docs/frame-titles.md` note C), and collapsing
 * the two would silently retitle it.
 */
export const READ_ONLY_LIBRARY_SUFFIX = '[Read Only Library]';

/** `_( "[from schematic]" )` — symbol_editor.cpp:66. Frame 3 only. */
export const FROM_SCHEMATIC_SUFFIX = '[from schematic]';

export interface SymFrameTitleSpec {
  /**
   * `GetCurSymbol()`. False is the `[no symbol loaded]` branch, and it is the
   * guard on BOTH other branches — `IsSymbolFromSchematic()` alone does not
   * select the first one.
   */
  hasSymbol: boolean;
  /** `IsSymbolFromSchematic()`. */
  fromSchematic?: boolean;
  /**
   * `m_reference` — the document half of the from-schematic branch.
   *
   * Note it is NOT run through `UnescapeString`, where the LIB_ID below is.
   */
  reference?: string;
  /**
   * `GetCurSymbol()->GetLibId().Format()` — `lib:name`, still escaped.
   * {@link symFrameTitle} applies `UnescapeString` itself, so pass the raw
   * LIB_ID rather than unescaping at the call site.
   */
  libId?: string;
  /**
   * `m_libMgr->LibraryExists( GetCurLib() ) && m_libMgr->IsLibraryReadOnly( GetCurLib() )`.
   * Both halves: a library that does not exist is not read-only.
   */
  readOnlyLibrary?: boolean;
  /** `GetScreen() && GetScreen()->IsContentModified()`. */
  modified?: boolean;
}

/**
 * `UnescapeString`, for the subset a LIB_ID can contain.
 *
 * Passed in rather than imported so this module stays free of the symbol
 * editor's library layer; the call site hands it
 * `@ziroeda/common/src/string_utils.js`'s `unescapeString`, which is the port
 * of `common/string_utils.cpp`.
 */
export type Unescape = (s: string) => string;

export function symFrameTitle(spec: SymFrameTitleSpec, unescapeString: Unescape): FrameTitleParts {
  // `else { title = _( "[no symbol loaded]" ); }` — an assignment, so no star.
  if (!spec.hasSymbol) {
    return frameTitle({
      frameName: SYM_FRAME_NAME,
      document: null,
      placeholder: SYM_NO_DOCUMENT,
      modified: false,
    });
  }

  // `if( GetCurSymbol() && IsSymbolFromSchematic() )` — m_reference, unescaped
  // by nobody, with its own suffix.
  if (spec.fromSchematic) {
    return frameTitle({
      frameName: SYM_FRAME_NAME,
      document: spec.reference ?? '',
      modified: spec.modified,
      suffixes: [FROM_SCHEMATIC_SUFFIX],
    });
  }

  return frameTitle({
    frameName: SYM_FRAME_NAME,
    document: unescapeString(spec.libId ?? ''),
    modified: spec.modified,
    suffixes: spec.readOnlyLibrary ? [READ_ONLY_LIBRARY_SUFFIX] : [],
  });
}
