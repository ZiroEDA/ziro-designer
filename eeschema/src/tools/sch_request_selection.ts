// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The scan-type tables every editing command hands to `RequestSelection`, and
 * the two halves of the type test it applies.
 *
 * Counterpart: the `aScanTypes` argument of `SCH_SELECTION_TOOL::RequestSelection`
 * (eeschema/tools/sch_selection_tool.cpp:1945-1994), the `SCH_COLLECTOR` tables
 * in `eeschema/sch_collectors.cpp:38-119`, and the `SCH_EDIT_TOOL::RotatableItems`
 * static at `eeschema/tools/sch_edit_tool.cpp:920-943`.
 *
 *     if( m_selection.Empty() )
 *     {
 *         VECTOR2D cursorPos = getViewControls()->GetCursorPosition( true );
 *         ClearSelection();
 *         SelectPoint( cursorPos, aScanTypes );      <- `selectPoint` here
 *         m_selection.SetIsHover( true );
 *         m_selection.ClearReferencePoint();
 *     }
 *     else        // Trim an existing selection by aFilterList
 *     {
 *         for( … )
 *             if( !item->IsType( aScanTypes ) )      <- `trimToScanTypes` here
 *                 unselect( item );
 *     }
 *
 * The two branches are not the same test applied twice: the pick is limited at
 * *collection* time, so hovering a wire with a symbol-only command picks
 * nothing at all rather than picking the wire and then dropping it. Both are
 * here because both are the same table, and a command that filtered one branch
 * and not the other would behave differently depending on whether something
 * was already selected.
 *
 * **Data, not chrome**: these lists are KiCad's own, hardcoded in the C++, so
 * they are mirrored rather than derived. Each is transcribed against our
 * `ItemRef['kind']` vocabulary, which is coarser than `KICAD_T` in three
 * places — one `label` covers SCH_LABEL_T / SCH_GLOBAL_LABEL_T / SCH_HIER_LABEL_T,
 * one `graphic` covers SCH_SHAPE_T and SCH_TEXT_T, and one `busentry` covers
 * SCH_BUS_WIRE_ENTRY_T and SCH_BUS_BUS_ENTRY_T. Every KiCad list that names one
 * member of such a pair names the other too, except EditableItems, which is not
 * a `RequestSelection` argument anywhere and so is not transcribed here.
 */

import type { Schematic } from '../types.js';
import { itemRefById, type ItemRef } from './hittest.js';
import { tableOfCellId } from './table_cells.js';

/** One `aScanTypes` list: `std::vector<KICAD_T>` in our kind vocabulary. */
export type ScanTypes = ReadonlySet<ItemRef['kind']>;

/** Every selectable kind. `SCH_LOCATE_ANY_T`, the default `RequestSelection()`. */
export const AnyItems: ScanTypes = new Set<ItemRef['kind']>([
  'symbol',
  'line',
  'junction',
  'noconnect',
  'label',
  'sheet',
  'busentry',
  'image',
  'graphic',
  'textbox',
  'table',
  'directive',
  'field',
  'pin',
  'sheetpin',
  'tablecell',
]);

/**
 * `SCH_EDIT_TOOL::RotatableItems` (sch_edit_tool.cpp:920-943), the list Rotate,
 * Mirror and AutoplaceFields pass.
 *
 * SCH_PIN_T is absent upstream — a pin turns with the symbol it belongs to and
 * has no orientation of its own — and so is SCH_MARKER_T, which we do not model
 * as a selectable kind.
 */
export const RotatableItems: ScanTypes = new Set<ItemRef['kind']>([
  'graphic', // SCH_SHAPE_T, SCH_TEXT_T
  'textbox', // SCH_TEXTBOX_T
  'table', // SCH_TABLE_T
  'tablecell', // SCH_TABLECELL_T
  'label', // SCH_LABEL_T, SCH_GLOBAL_LABEL_T, SCH_HIER_LABEL_T
  'directive', // SCH_DIRECTIVE_LABEL_T
  'field', // SCH_FIELD_T
  'symbol', // SCH_SYMBOL_T
  'sheetpin', // SCH_SHEET_PIN_T
  'sheet', // SCH_SHEET_T
  'image', // SCH_BITMAP_T
  'busentry', // SCH_BUS_BUS_ENTRY_T, SCH_BUS_WIRE_ENTRY_T
  'line', // SCH_LINE_T
  'junction', // SCH_JUNCTION_T
  'noconnect', // SCH_NO_CONNECT_T
]);

/** `SCH_COLLECTOR::MovableItems` (sch_collectors.cpp:60-85), Move and Drag. */
export const MovableItems: ScanTypes = new Set<ItemRef['kind']>([
  'junction',
  'noconnect',
  'busentry',
  'line',
  'image',
  'graphic',
  'textbox',
  'table',
  'tablecell',
  'label',
  'directive',
  'field',
  'symbol',
  'sheetpin',
  'sheet',
]);

/** `SCH_COLLECTOR::DeletableItems` (sch_collectors.cpp:95-119), Delete. */
export const DeletableItems: ScanTypes = new Set<ItemRef['kind']>([
  'junction',
  'line',
  'busentry',
  'graphic',
  'textbox',
  'tablecell',
  'table',
  'label',
  'directive',
  'noconnect',
  'sheet',
  'sheetpin',
  'symbol',
  'field',
  'image',
]);

/** `RequestSelection( { SCH_SYMBOL_T } )`: Show Datasheet, unit and body style. */
export const SymbolItems: ScanTypes = new Set<ItemRef['kind']>(['symbol']);

/** `RequestSelection( { SCH_SHEET_T } )`: CleanupSheetPins, EditPageNumber. */
export const SheetItems: ScanTypes = new Set<ItemRef['kind']>(['sheet']);

/**
 * `SCH_EDIT_TOOL::SetAttribute`'s list (sch_edit_tool.cpp:3533), which is what
 * the lock/unlock/toggle-lock rows go through:
 *
 *     RequestSelection( { SCH_SYMBOL_T, SCH_SHEET_T, SCH_RULE_AREA_T } )
 *
 * SCH_RULE_AREA_T has no kind of ours yet, so the pair that does is listed.
 */
export const AttributeItems: ScanTypes = new Set<ItemRef['kind']>(['symbol', 'sheet']);

/**
 * `EDA_ITEM::IsType( aScanTypes )` for one of our selection ids.
 *
 * An id nothing in the document answers to has no type, and upstream's
 * `IsType` on a live item always answers: an unresolvable id is a stale
 * selection entry, so it is dropped rather than kept.
 */
export function isScanType(doc: Schematic, id: string, scanTypes: ScanTypes): boolean {
  const kind = schItemKind(doc, id);
  return kind !== null && scanTypes.has(kind);
}

/** The kind an id resolves to, or null when the document has no such item. */
export function schItemKind(doc: Schematic, id: string): ItemRef['kind'] | null {
  // A table cell is addressed by a composite id its table does not answer to,
  // and `itemRefById` stops at the top-level arrays, so it is resolved first.
  const table = tableOfCellId(id);
  if (table !== null) return itemRefById(doc, table)?.kind === 'table' ? 'tablecell' : null;
  return itemRefById(doc, id)?.kind ?? null;
}

/**
 * `SCH_SELECTION_TOOL::SelectPoint( aWhere, aScanTypes )`: which of the items
 * under the cursor the pick lands on.
 *
 * `candidates` is `collectAndGuess`' output, closest first — the collector plus
 * the `GuessSelectionCandidates` heuristics. The scan types are applied here
 * rather than by the caller because upstream applies them to the *collector*:
 * a symbol-only command hovering a wire that crosses a symbol picks the symbol,
 * and one hovering a bare wire picks nothing.
 */
export function selectPoint(candidates: readonly ItemRef[], scanTypes: ScanTypes): ItemRef | null {
  for (const c of candidates) if (scanTypes.has(c.kind)) return c;
  return null;
}

/** The `else` branch: an existing selection keeps only the admitted types. */
export function trimToScanTypes(
  doc: Schematic,
  ids: ReadonlySet<string>,
  scanTypes: ScanTypes,
): ReadonlySet<string> {
  let dropped = false;
  const kept = new Set<string>();
  for (const id of ids) {
    if (isScanType(doc, id, scanTypes)) kept.add(id);
    else dropped = true;
  }
  // Identity is meaningful to the hover flag's owner, so an untrimmed
  // selection comes back as the very set that went in.
  return dropped ? kept : ids;
}
