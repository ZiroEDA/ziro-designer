// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SCH_EDIT_TOOL::editFieldText` (eeschema/tools/sch_edit_tool.cpp:2328-2372),
 * the one function every route into DIALOG_FIELD_PROPERTIES goes through:
 * the E hotkey and the context menu (`Properties`' `case SCH_FIELD_T`,
 * sch_edit_tool.cpp:2880-2890), the U / V / F keys (`EditField`, :2411-2427),
 * and a double-click on the field text.
 *
 * Two things live here rather than in the dialog, because upstream computes
 * them in the tool and hands them over: the window caption, and the
 * re-autoplace that runs after OK.
 */

import { titleCaps } from '@ziroeda/common';
import type { LibSymbol, SchSymbol, Schematic } from '../types.js';
import { isMandatoryField } from './properties.js';
import { refId } from './hittest.js';
import { autoplacedFields, type AutoplaceOptions, type AutoplaceSheet } from './autoplace_fields.js';

/**
 * Resolve a `field` item id — `"<symbolRefId>:field<k>"`, what `collectAndGuess`
 * hands back for a click on a symbol's reference / value / footprint text — to
 * the symbol and field it names, or null when it names something else.
 *
 * This is the `static_cast<SCH_FIELD*>( aItem )` that `Properties`' `case
 * SCH_FIELD_T` does for free (sch_edit_tool.cpp:2882): upstream's collector
 * hands the tool a typed pointer, ours hands it a string, so the cast is a
 * lookup. It returns null for a symbol id, which is what keeps a double-click
 * on the BODY on the symbol-dialog branch.
 */
export function fieldEditTarget(
  sch: Schematic,
  id: string,
): { symbol: number; index: number } | null {
  const parsed = /^(.*):field(\d+)$/.exec(id);
  if (!parsed) return null;

  const symId = parsed[1]!;
  const index = Number(parsed[2]);

  const symbol = sch.symbols.findIndex((s, i) => refId('symbol', s.uuid, i) === symId);
  if (symbol < 0 || !sch.symbols[symbol]!.fields[index]) return null;

  return { symbol, index };
}

/**
 * The dialog's caption (sch_edit_tool.cpp:2338-2350).
 *
 * ```
 * // Use title caps for mandatory fields.  "Edit Sheet name Field" looks dorky.
 * if( aField->IsMandatory() )
 * {
 *     wxString fieldName = GetDefaultFieldName( aField->GetId(), DO_TRANSLATE );
 *     caption.Printf( _( "Edit %s Field" ), TitleCaps( fieldName ) );
 * }
 * else
 * {
 *     caption.Printf( _( "Edit '%s' Field" ), aField->GetName() );
 * }
 * ```
 *
 * A mandatory field is named by its `FIELD_T` id, not by whatever the file
 * spelled it: `GetDefaultFieldName` returns the canonical English name
 * ("Reference", "Value", "Footprint", "Datasheet", "Description" —
 * common/template_fieldnames.cpp:55-88). We key fields by that same canonical
 * string, so `isMandatoryField` matching IS the id lookup, and `titleCaps` of
 * it is upstream's `TitleCaps( GetDefaultFieldName( … ) )`.
 *
 * A user field keeps its own name and gains the quotes, which is the whole
 * visible difference: "Edit Value Field" against "Edit 'MPN' Field".
 */
export function fieldEditCaption(fieldName: string): string {
  if (isMandatoryField(fieldName)) return `Edit ${titleCaps(fieldName)} Field`;
  return `Edit '${fieldName}' Field`;
}

/**
 * The tail of `editFieldText` (sch_edit_tool.cpp:2357-2365):
 *
 * ```
 * if( m_frame->eeconfig()->m_AutoplaceFields.enable || parentType == SCH_SHEET_T )
 * {
 *     SCH_ITEM*      parent = static_cast<SCH_ITEM*>( aField->GetParent() );
 *     AUTOPLACE_ALGO fieldsAutoplaced = parent->GetFieldsAutoplaced();
 *
 *     if( fieldsAutoplaced == AUTOPLACE_AUTO || fieldsAutoplaced == AUTOPLACE_MANUAL )
 *         parent->AutoplaceFields( m_frame->GetScreen(), fieldsAutoplaced );
 * }
 * ```
 *
 * This is why editing one field can move the others: a longer Value shoves the
 * Reference along, but only on a symbol whose fields the autoplacer already
 * owns. A symbol the user has dragged fields on by hand has no
 * `fields_autoplaced` token, so it is left exactly where it is.
 *
 * `AutoplaceFields( aScreen, aAlgo )` re-runs with the parent's EXISTING algo
 * rather than forcing AUTOPLACE_MANUAL, and `AUTOPLACER::DoAutoplace` only
 * sifts colliding sides `if( aAlgo == AUTOPLACE_MANUAL )`
 * (autoplace_fields.cpp:141-146) — which our `autoplacedFields` expresses by
 * being given, or not given, the sheet.
 *
 * Returns the symbol unchanged when the guard does not fire, so the caller can
 * always apply the result.
 */
export function autoplaceAfterFieldEdit(
  sym: SchSymbol,
  lib: LibSymbol | undefined,
  enable: boolean,
  opts: AutoplaceOptions,
  sheet: Omit<AutoplaceSheet, 'doc' | 'libById'> & { doc: Schematic; libById: Map<string, LibSymbol> },
): SchSymbol {
  if (!enable) return sym;

  const mode = sym.fieldsAutoplaced;
  if (mode !== 'auto' && mode !== 'manual') return sym;

  return {
    ...sym,
    fields: autoplacedFields(sym, lib, opts, mode === 'manual' ? sheet : undefined),
  };
}
