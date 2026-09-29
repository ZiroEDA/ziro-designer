// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/symbol_editor/symbol_editor.cpp`: the pieces of `SYMBOL_EDIT_FRAME`
 * that are plain data/logic rather than wx UI — the delete-symbol confirmation
 * prompts and the frame title. Merged into one file here because both are a
 * handful of lines split out of the same C++ file for testability; KiCad has
 * no `delete_symbol_prompt.cpp` or `frame_title.cpp` of its own.
 */

// ============================================================================
// Delete-symbol confirmation prompts
//
// What `SYMBOL_EDIT_FRAME::DeleteSymbolFromLibrary` asks before it deletes
// (`eeschema/symbol_editor/symbol_editor.cpp:1252-1301`).
//
// Two prompts, in this order, and **neither fires for an unmodified leaf
// symbol** — upstream deletes that one without asking at all. Ours always
// asked, with a string of our own invention ("Delete symbol 'R' from library
// 'Device'?"), and never warned that deleting a base takes its children.
//
// 1. MODIFIED (`:1261-1266`)
//
// ```cpp
// if( m_libMgr->IsSymbolModified( … )
//     && !IsOK( this, wxString::Format( _( "The symbol '%s' has been modified.\n"
//                                          "Do you want to remove it from the library?" ),
//                                       libId.GetUniStringLibItemName() ) ) )
//     continue;
// ```
//
// 2. HAS DERIVED SYMBOLS (`:1269-1286`)
//
// ```cpp
// wxString msg = _( "Deleting a base symbol will delete all symbols derived from it.\n\n" );
// msg += libId.GetLibItemName().wx_str() + _( " (base)\n" );
//
// for( const wxString& name : derived )
//     msg += name + wxT( "\n" );
// ```
//
// shown as a `KICAD_MESSAGE_DIALOG` titled "Warning", `wxYES_NO | wxICON_WARNING`,
// with `SetYesNoLabels( _( "Delete All Listed Symbols" ), _( "Cancel" ) )`.
//
// Both are `continue` on refusal — that symbol is skipped, the loop goes on.
// ============================================================================

/** One prompt to put in front of the user before a delete proceeds. */
export interface DeletePrompt {
  /** `wxMessageDialog`'s caption; upstream leaves the modified one to `IsOK`. */
  title?: string;
  /** The message body, newlines and all, exactly as upstream builds it. */
  message: string;
  /** `SetYesNoLabels`' first argument, where upstream sets one. */
  confirmLabel?: string;
  /** `SetYesNoLabels`' second argument. */
  cancelLabel?: string;
}

/**
 * The prompts for deleting `symName`, in the order upstream raises them.
 *
 * An empty array means delete without asking — which is what upstream does for
 * an unmodified symbol with no children.
 */
export function deleteSymbolPrompts(opts: {
  /** `libId.GetUniStringLibItemName()`. */
  symName: string;
  /** `m_libMgr->IsSymbolModified( … )`. */
  modified: boolean;
  /** `m_libMgr->GetDerivedSymbolNames( … )`, in the order it returns them. */
  derived: readonly string[];
}): DeletePrompt[] {
  const prompts: DeletePrompt[] = [];

  if (opts.modified) {
    prompts.push({
      message: `The symbol '${opts.symName}' has been modified.\nDo you want to remove it from the library?`,
    });
  }

  if (opts.derived.length > 0) {
    // `msg += libId.GetLibItemName().wx_str() + _( " (base)\n" )`, then one
    // line per derived name — each with its OWN trailing newline, so the body
    // ends with one.
    let message = 'Deleting a base symbol will delete all symbols derived from it.\n\n';
    message += `${opts.symName} (base)\n`;
    for (const name of opts.derived) message += `${name}\n`;
    prompts.push({
      title: 'Warning',
      message,
      confirmLabel: 'Delete All Listed Symbols',
      cancelLabel: 'Cancel',
    });
  }

  return prompts;
}

// ============================================================================
// Frame title
//
// `SYMBOL_EDIT_FRAME::UpdateTitle` (eeschema/symbol_editor/symbol_editor.cpp:58-88),
// row 3 of `docs/frame-titles.md`.
//
// The shape — star, document, suffixes, em dash, frame name — is shared and
// lives in `frameTitle()` in `ui/useDocumentTitle.ts`. This section states only
// the three decisions that are the symbol editor's own, and states nothing the
// shared function already states.
//
// The C++, in full:
//
//     wxString title;
//
//     if( GetCurSymbol() && IsSymbolFromSchematic() )
//     {
//         if( GetScreen() && GetScreen()->IsContentModified() )
//             title = wxT( "*" );
//
//         title += m_reference;
//         title += wxS( " " ) + _( "[from schematic]" );
//     }
//     else if( GetCurSymbol() )
//     {
//         if( GetScreen() && GetScreen()->IsContentModified() )
//             title = wxT( "*" );
//
//         title += UnescapeString( GetCurSymbol()->GetLibId().Format() );
//
//         if( m_libMgr && m_libMgr->LibraryExists( GetCurLib() )
//                 && m_libMgr->IsLibraryReadOnly( GetCurLib() ) )
//             title += wxS( " " ) + _( "[Read Only Library]" );
//     }
//     else
//     {
//         title = _( "[no symbol loaded]" );
//     }
//
//     title += wxT( " — " ) + _( "Symbol Editor" );
//
// Four things that are easy to get wrong, and ours had all four wrong:
//
//  - **The document is the symbol, never the project.** Ours printed
//    `Prj().GetProjectName()` where the LIB_ID goes, which is not a formatting
//    slip but the wrong document entirely: a user editing `Device:R` read
//    `MyProject`. `UpdateTitle` does not mention the project in any branch.
//  - **The read-only suffix is a different string here.** Five frames say
//    `[Read Only]`; this one alone says `[Read Only Library]`, because the
//    thing that is not writable is the library, not a file
//    (`docs/frame-titles.md` note C). {@link READ_ONLY_SUFFIX} is the wrong
//    constant to reach for.
//  - **There is no `[Unsaved]` branch**, unlike the footprint editor's. An
//    unsaved symbol still has a LIB_ID and takes the second branch.
//  - **The empty branch cannot carry a star.** `title = _( "[no symbol
//    loaded]" )` is an assignment, and the two `title = wxT( "*" )` lines are
//    both inside branches that ran already. So a modified library with no
//    symbol open reads `[no symbol loaded]`, never `*[no symbol loaded]`.
// ============================================================================

import { frameTitle, type FrameTitleParts } from '@ziroeda/common/use_document_title.js';

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
 * `@ziroeda/common/string_utils.js`'s `unescapeString`, which is the port
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
