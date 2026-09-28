// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What `SYMBOL_EDIT_FRAME::DeleteSymbolFromLibrary` asks before it deletes
 * (`eeschema/symbol_editor/symbol_editor.cpp:1252-1301`).
 *
 * Two prompts, in this order, and **neither fires for an unmodified leaf
 * symbol** — upstream deletes that one without asking at all. Ours always
 * asked, with a string of our own invention ("Delete symbol 'R' from library
 * 'Device'?"), and never warned that deleting a base takes its children.
 *
 * 1. MODIFIED (`:1261-1266`)
 *
 * ```cpp
 * if( m_libMgr->IsSymbolModified( … )
 *     && !IsOK( this, wxString::Format( _( "The symbol '%s' has been modified.\n"
 *                                          "Do you want to remove it from the library?" ),
 *                                       libId.GetUniStringLibItemName() ) ) )
 *     continue;
 * ```
 *
 * 2. HAS DERIVED SYMBOLS (`:1269-1286`)
 *
 * ```cpp
 * wxString msg = _( "Deleting a base symbol will delete all symbols derived from it.\n\n" );
 * msg += libId.GetLibItemName().wx_str() + _( " (base)\n" );
 *
 * for( const wxString& name : derived )
 *     msg += name + wxT( "\n" );
 * ```
 *
 * shown as a `KICAD_MESSAGE_DIALOG` titled "Warning", `wxYES_NO | wxICON_WARNING`,
 * with `SetYesNoLabels( _( "Delete All Listed Symbols" ), _( "Cancel" ) )`.
 *
 * Both are `continue` on refusal — that symbol is skipped, the loop goes on.
 */

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
