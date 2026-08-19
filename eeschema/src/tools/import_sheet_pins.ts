// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * "Place Pins from Sheet" and "Sync All Sheet Pins": the two tools that pull a
 * sub-sheet's hierarchical labels up onto its parent's sheet symbol.
 *
 * Counterparts: `SCH_DRAWING_TOOLS::importHierLabel` / `importHierLabels`
 * (eeschema/tools/sch_drawing_tools.cpp) and `DIALOG_SYNC_SHEET_PINS`.
 *
 * The distinction that matters: the tool does not ask for a pin name. It reads
 * the *child* schematic, finds the hierarchical labels that have no matching
 * pin on the parent's sheet symbol yet, and makes a pin from each — name and
 * shape carried straight over:
 *
 *     SCH_SHEET_PIN* SCH_DRAWING_TOOLS::createNewSheetPinFromLabel( … )
 *     {
 *         auto pin = createNewSheetPin( aSheet, aPosition );
 *         pin->SetText( aLabel->GetText() );
 *         pin->SetShape( aLabel->GetShape() );
 *         return pin;
 *     }
 *
 * so a pin and its label cannot disagree. Typing the name by hand — which is
 * what ours did — is the *other* gesture, and it lets the two drift apart.
 */

// `StrNumCmp( …, true )`: the natural-order comparison the label sort uses, so
// `D9` comes before `D10`. `sch_drawing_tools.cpp:3917` passes aIgnoreCase =
// true, which is the opposite of StrNumCmp's own default, so it is spelled out.
import { strNumCmp } from '@ziroeda/common/src/string_utils.js';
import type { LabelShape, SchLabel, SchSheet, Schematic } from '../types.js';

/** A label on the child sheet that the parent has no pin for yet. */
export interface ImportableLabel {
  text: string;
  shape: LabelShape;
}

/** `SCH_SHEET::HasPin`: a pin of this sheet already carries that name. */
export function sheetHasPin(sheet: SchSheet, name: string): boolean {
  return sheet.pins.some((p) => p.name === name);
}

/** Every hierarchical label on the child schematic. */
function hierLabels(child: Schematic): SchLabel[] {
  return child.labels.filter((l) => l.kind === 'hierarchical_label');
}

/**
 * `importHierLabels`: every hierarchical label on the child with no matching
 * pin on the sheet, in the order they appear.
 *
 *     if( !aSheet->HasPin( label->GetText() ) )
 *         labels.push_back( label );
 */
export function importableSheetPins(
  sheet: SchSheet,
  child: Schematic | undefined,
): ImportableLabel[] {
  if (!child) return [];
  const seen = new Set<string>();
  const out: ImportableLabel[] = [];
  for (const l of hierLabels(child)) {
    if (!l.text || sheetHasPin(sheet, l.text) || seen.has(l.text)) continue;
    seen.add(l.text);
    out.push({ text: l.text, shape: (l.shape ?? 'bidirectional') as LabelShape });
  }
  return out;
}

/**
 * `importHierLabel`: the *next* label to place — the labels sorted by name, and
 * the first of those the sheet has no pin for.
 *
 *     std::sort( labels.begin(), labels.end(), … StrNumCmp( … ) < 0 );
 *     for( SCH_HIERLABEL* label : labels )
 *         if( !aSheet->HasPin( label->GetText() ) )
 *             return label;
 *     return nullptr;
 *
 * Note the sort covers *all* the labels and the "has no pin" test comes after,
 * so repeated use walks them in name order. Null means "No new hierarchical
 * labels found", which is what ends the tool.
 */
export function nextImportableSheetPin(
  sheet: SchSheet,
  child: Schematic | undefined,
): ImportableLabel | null {
  if (!child) return null;
  const sorted = [...hierLabels(child)].sort((a, b) => strNumCmp(a.text, b.text, true));
  for (const l of sorted) {
    if (!l.text || sheetHasPin(sheet, l.text)) continue;
    return { text: l.text, shape: (l.shape ?? 'bidirectional') as LabelShape };
  }
  return null;
}
