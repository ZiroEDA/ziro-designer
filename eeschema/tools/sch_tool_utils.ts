// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Selection text helpers, ported from KiCad's `eeschema/tools/sch_tool_utils.cpp`:
 * GetSchItemAsText / GetSelectedItemsAsText, the "Copy as Text" payload.
 * Text-bearing items yield their shown text (labels, text, text boxes; tables
 * as tab-separated rows); everything else yields nothing, exactly upstream.
 *
 * GetSameSymbolMultiUnitSelection on the live model is at the end.
 */

import { KIID_PATH } from '@ziroeda/common/kiid.js';
import type { LIB_ID } from '@ziroeda/common/lib_id.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import type { SELECTION } from '@ziroeda/common/tool/selection.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { type SCH_REFERENCE, SCH_REFERENCE_LIST } from '../sch_reference_list.js';
import { SYMBOL_FILTER } from '../sch_sheet_path.js';
import type { SCHEMATIC } from '../schematic.js';
import type { SCH_PIN } from '../sch_pin.js';
import type { SCH_FIELD } from '../sch_field.js';
import type { SCH_GROUP } from '../sch_group.js';
import type { SCH_ITEM } from '../sch_item.js';
import type { SCH_SCREEN } from '../sch_screen.js';
import type { SCH_SHEET } from '../sch_sheet.js';
import type { SCH_TABLE } from '../sch_table.js';
import type { SCH_TEXT } from '../sch_text.js';
import type { SCH_TEXTBOX } from '../sch_textbox.js';
import { SCH_SYMBOL } from '../sch_symbol.js';
import type { Schematic, SchSymbol } from '../types.js';
import { itemRefById, refId } from './hittest.js';

/** GetSelectedItemsAsText: the selected items' texts joined with newlines. */
export function getSelectedItemsAsText(sch: Schematic, ids: ReadonlySet<string>): string {
  const texts: string[] = [];

  sch.labels.forEach((l, i) => {
    if (ids.has(refId('label', l.uuid, i))) {
      const t = l.text.trim();
      if (t) texts.push(t);
    }
  });
  sch.textBoxes.forEach((tb, i) => {
    if (ids.has(refId('textbox', tb.uuid, i))) {
      const t = tb.text.trim();
      if (t) texts.push(t);
    }
  });
  sch.tables.forEach((table, i) => {
    if (!ids.has(refId('table', table.uuid, i))) return;
    // "A simple tabbed list of the cells": tab-separated columns, one row per line.
    const rows: string[] = [];
    for (let r = 0; r * table.columnCount < table.cells.length; r++) {
      rows.push(
        table.cells
          .slice(r * table.columnCount, (r + 1) * table.columnCount)
          .map((c) => c.text)
          .join('\t'),
      );
    }
    const t = rows.join('\n').trim();
    if (t) texts.push(t);
  });
  sch.graphics.forEach((g, i) => {
    // Schematic-level graphics have no uuid, so the index form is their refId.
    if (ids.has(refId('graphic', undefined, i)) && g.kind === 'text') {
      const t = g.text.trim();
      if (t) texts.push(t);
    }
  });

  return texts.join('\n');
}

/**
 * Whether a unit of this part is already on the sheet under this reference.
 *
 * `IsUnannotatedUnitOccupied` (sch_tool_utils.cpp): a placement occupies a unit
 * when its unit number, its reference string and its library id all match. The
 * library id is the part that matters and the reason upstream wrote a helper
 * for it — before annotation every symbol reads `U?`, so two different
 * multi-unit parts on one sheet share a reference string, and matching on the
 * reference alone would have a 4001 skip units occupied by an unrelated 4011.
 */
export function isUnannotatedUnitOccupied(
  symbols: readonly SchSymbol[],
  reference: string,
  libId: string,
  unit: number,
): boolean {
  return symbols.some(
    (s) =>
      s.unit === unit &&
      s.libId === libId &&
      (s.fields.find((f) => f.key === 'Reference')?.value ?? '') === reference,
  );
}

/**
 * The unit to place next, stepping past the ones already taken.
 *
 * `SCH_DRAWING_TOOLS::PlaceSymbol`'s continuation, for "Place all units":
 *
 *   while( unit <= unitCount && unitOccupied( unit ) ) unit++;
 *   if( unit > unitCount ) unit = 1;
 *
 * Blindly incrementing instead — which is what this replaced — meant reopening
 * the chooser restarted at unit 1, so placing a 4001 twice from the chooser put
 * two unit-A gates on the sheet instead of A and then B.
 *
 * An annotated placement is matched on its own reference, an unannotated one
 * additionally on the library id; both come out of the same predicate here
 * because the reference carries the distinction.
 */
export function nextFreeUnit(
  symbols: readonly SchSymbol[],
  reference: string,
  libId: string,
  unitCount: number,
  from: number,
): number {
  let unit = from;
  while (unit <= unitCount && isUnannotatedUnitOccupied(symbols, reference, libId, unit)) unit++;
  return unit > unitCount ? 1 : unit;
}

/**
 * `SCH_EDIT_FRAME::setupUIConditions`' `hasElements`, without its selection
 * half: does the current screen hold anything at all?
 *
 *     return GetScreen() && ( !GetScreen()->Items().empty() || !Idle( aSel ) );
 *
 * It gates Cut / Copy / Delete / Duplicate, which is why a menu can offer
 * Duplicate over empty canvas: the test is about the sheet, not the selection.
 */
export function screenHasItems(sch: Schematic): boolean {
  return (
    sch.symbols.length > 0 ||
    sch.lines.length > 0 ||
    sch.junctions.length > 0 ||
    sch.noConnects.length > 0 ||
    sch.labels.length > 0 ||
    sch.sheets.length > 0 ||
    sch.busEntries.length > 0 ||
    sch.images.length > 0 ||
    sch.graphics.length > 0 ||
    sch.textBoxes.length > 0 ||
    sch.tables.length > 0 ||
    (sch.directiveLabels?.length ?? 0) > 0
  );
}

/**
 * `SCH_CONDITIONS::HasTypes( expandConnectionGraphTypes )`, the condition on
 * Select/Expand Connection (sch_selection_tool.cpp:531).
 *
 * The list is the connectivity-carrying kinds. A hierarchical sheet is not one
 * of them — a sheet's connections are its pins — so the entry is absent from a
 * sheet's menu even though a sheet is very much connected to things.
 */
export function selectionIsExpandable(sch: Schematic, ids: ReadonlySet<string>): boolean {
  const EXPANDABLE = new Set([
    'symbol',
    'pin',
    'line',
    'busentry',
    'label',
    'directive',
    'sheetpin',
    'junction',
    'noconnect',
    'graphic',
  ]);
  for (const id of ids) {
    const ref = itemRefById(sch, id);
    if (ref && EXPANDABLE.has(ref.kind)) return true;
  }
  return false;
}

/**
 * `canCopyText` (sch_edit_tool.cpp), an **Only**Types condition: Copy as Text is
 * offered when everything selected carries text. One symbol or sheet in the
 * selection removes it, since there would be nothing to put on the clipboard
 * for that item.
 */
export function selectionCanCopyAsText(sch: Schematic, ids: ReadonlySet<string>): boolean {
  const TEXTUAL = new Set([
    'label',
    'directive',
    'textbox',
    'table',
    'tablecell',
    'field',
    'pin',
    'sheetpin',
  ]);
  if (ids.size === 0) return false;
  for (const id of ids) {
    const ref = itemRefById(sch, id);
    if (!ref || !TEXTUAL.has(ref.kind)) return false;
  }
  return true;
}

/**
 * `GetSameSymbolMultiUnitSelection` (sch_tool_utils.cpp:227) on the live model: the selected
 * units, in selection order, when they are two or more units of one symbol (same reference, same
 * library symbol, same pin count); otherwise none.
 */
export function GetSameSymbolMultiUnitSelection(aSel: SELECTION): SCH_SYMBOL[] {
  let result: SCH_SYMBOL[] = [];

  if (aSel.GetSize() < 2 || !aSel.OnlyContains([KICAD_T.SCH_SYMBOL_T])) return result;

  let rootRef = '';
  let rootLibId: LIB_ID | null = null;
  let rootPinCount = 0;
  let haveRootPinCount = false;

  // Preserve selection order for cyclical swaps A->B->C
  const itemsInOrder = aSel.GetItemsSortedBySelectionOrder();

  for (const it of itemsInOrder) {
    const sym = it instanceof SCH_SYMBOL ? it : null;

    if (!sym || !sym.GetLibSymbolRef() || sym.GetLibSymbolRef()!.GetUnitCount() < 2) return [];

    const sheet = sym.Schematic()!.CurrentSheet();

    // Get unit-less reference
    const ref = sym.GetRef(sheet, false);

    if (rootRef === '') rootRef = ref;

    if (ref !== rootRef) return [];

    // Make sure the user isn't selecting units that are misreferenced such that
    // they have U1A and U1B that are actually from different library symbols.
    const libId = sym.GetLibId();

    if (!rootLibId) rootLibId = libId;

    if (!libId.equals(rootLibId)) return [];

    // Ensure same pin count across selected units
    const pinCount = sym.GetPins(sheet).length;

    if (!haveRootPinCount) {
      rootPinCount = pinCount;
      haveRootPinCount = true;
    }

    if (pinCount !== rootPinCount) return [];

    result.push(sym);
  }

  if (result.length < 2) result = [];

  return result;
}

/**
 * `FindSymbolByRefAndUnit` (sch_tool_utils.cpp:209): the symbol unit \a aUnit of reference
 * \a aRef anywhere in \a aSchematic's hierarchy, or null.
 */
export function FindSymbolByRefAndUnit(
  aSchematic: SCHEMATIC,
  aRef: string,
  aUnit: number,
): SCH_REFERENCE | null {
  const refs = new SCH_REFERENCE_LIST();
  aSchematic.Hierarchy().GetSymbols(refs, SYMBOL_FILTER.SYMBOL_FILTER_ALL);

  for (let i = 0; i < refs.GetCount(); i++) {
    const ref = refs.at(i);

    if (ref.GetRef() === aRef && ref.GetUnit() === aUnit) return ref;
  }

  return null;
}

/**
 * `GetUnplacedUnitsForSymbol` (sch_tool_utils.cpp:168): the units of \a aSym's part that are not
 * placed anywhere in the hierarchy. An unannotated reference ("U?") also has to match the library
 * symbol, or two different unannotated parts would be taken for one.
 */
export function GetUnplacedUnitsForSymbol(aSym: SCH_SYMBOL): Set<number> {
  const schematic = aSym.Schematic();

  if (!schematic) return new Set();

  const symRefDes = aSym.GetRef(schematic.CurrentSheet(), false);

  // Pre-annotation references all share the same "U?" form regardless of which library symbol
  // they came from, so an unannotated AD8620 and an unannotated OPA1664 would otherwise be
  // collapsed into one logical part. Match library identity as a tie-breaker when the
  // reference is still unannotated.
  const refIsUnannotated = symRefDes !== '' && symRefDes.endsWith('?');
  const symLibId = aSym.GetLibId();

  // Get a list of all references in the schematic
  const hierarchy = schematic.Hierarchy();
  const existingRefs = new SCH_REFERENCE_LIST();
  hierarchy.GetSymbols(existingRefs, SYMBOL_FILTER.SYMBOL_FILTER_ALL);

  const missingUnits = new Set<number>();

  for (let unit = 1; unit <= aSym.GetUnitCount(); ++unit) missingUnits.add(unit);

  for (let i = 0; i < existingRefs.GetCount(); i++) {
    const ref = existingRefs.at(i);

    if (symRefDes !== ref.GetRef()) continue;

    if (refIsUnannotated && ref.GetSymbol() && !ref.GetSymbol()!.GetLibId().equals(symLibId))
      continue;

    missingUnits.delete(ref.GetUnit());
  }

  return missingUnits;
}

/**
 * `SwapPinGeometry` (sch_tool_utils.cpp:296): exchange the position, orientation, length and
 * operating point of two pins. A pin still backed by its library definition swaps that library
 * pin; true when one did, so the caller can clone the library data into the schematic.
 */
export function SwapPinGeometry(aFirst: SCH_PIN, aSecond: SCH_PIN): boolean {
  const firstPin = aFirst.GetLibPin() ?? aFirst;
  const secondPin = aSecond.GetLibPin() ?? aSecond;

  const firstLocal = firstPin.GetLocalPosition();
  const secondLocal = secondPin.GetLocalPosition();
  firstPin.SetPosition(secondLocal);
  secondPin.SetPosition(firstLocal);

  const firstOrientation = firstPin.GetOrientation();
  const secondOrientation = secondPin.GetOrientation();
  firstPin.SetOrientation(secondOrientation);
  secondPin.SetOrientation(firstOrientation);

  const firstLength = firstPin.GetLength();
  const secondLength = secondPin.GetLength();
  firstPin.SetLength(secondLength);
  secondPin.SetLength(firstLength);

  const firstOp = firstPin.GetOperatingPoint();
  const secondOp = secondPin.GetOperatingPoint();
  firstPin.SetOperatingPoint(secondOp);
  secondPin.SetOperatingPoint(firstOp);

  // Return true if we touched the library-backed copy so callers can refresh the schematic symbol
  // cache once the swap completes.
  return firstPin !== aFirst || secondPin !== aSecond;
}

/**
 * `SymbolHasSheetInstances` (sch_tool_utils.cpp:332): whether \a aSymbol is placed through more
 * than one sheet path, or by another project. The out-sets receive the paths / project names
 * only when that kind of sharing is the case.
 */
export function SymbolHasSheetInstances(
  aSymbol: SCH_SYMBOL,
  aCurrentProject: string,
  aSheetPaths: Set<string> | null,
  aProjectNames: Set<string> | null,
): boolean {
  const uniquePaths = new Set<string>();
  const sheetPaths = new Set<string>();
  const otherProjects = new Set<string>();

  for (const instance of aSymbol.GetInstances()) {
    uniquePaths.add(instance.m_Path.AsString());

    if (!instance.m_Path.empty()) sheetPaths.add(instance.m_Path.AsString());

    if (instance.m_ProjectName !== '') {
      if (aCurrentProject === '' || instance.m_ProjectName !== aCurrentProject)
        otherProjects.add(instance.m_ProjectName);
    }
  }

  const sharedWithinProject = uniquePaths.size > 1;
  const sharedWithOtherProjects = otherProjects.size > 0;

  if (aSheetPaths) {
    aSheetPaths.clear();

    if (sharedWithinProject) for (const p of sheetPaths) aSheetPaths.add(p);
  }

  if (aProjectNames) {
    aProjectNames.clear();

    if (sharedWithOtherProjects) for (const p of otherProjects) aProjectNames.add(p);
  }

  return sharedWithinProject || sharedWithOtherProjects;
}

/**
 * `GetSheetNamesFromPaths` (sch_tool_utils.cpp:376): each KIID path as the "/"-joined names of
 * its sheets, or its human-readable path when they have none, or the raw string.
 */
export function GetSheetNamesFromPaths(
  aSheetPaths: ReadonlySet<string>,
  aSchematic: SCHEMATIC,
): Set<string> {
  const friendlyNames = new Set<string>();

  if (aSheetPaths.size === 0) return friendlyNames;

  const hierarchy = aSchematic.Hierarchy();

  for (const pathStr of aSheetPaths) {
    let display = pathStr;
    const kiidPath = new KIID_PATH(pathStr);

    for (const sheetPath of hierarchy) {
      if (sheetPath.Path().equals(kiidPath)) {
        let sheetNames = '';

        for (let ii = 0; ii < sheetPath.size(); ++ii) {
          const sheet = sheetPath.at(ii);

          if (!sheet) continue;

          const nameField = sheet.GetField(FIELD_T.SHEET_NAME);

          if (!nameField) continue;

          const name = nameField.GetShownText(false);

          if (name === '') continue;

          if (sheetNames !== '') sheetNames += '/';

          sheetNames += name;
        }

        if (sheetNames === '') display = sheetPath.PathHumanReadable(false, true);
        else display = sheetNames;

        break;
      }
    }

    friendlyNames.add(display);
  }

  return friendlyNames;
}

/**
 * `IsUnannotatedUnitOccupied` (sch_tool_utils.cpp:145): whether \a aRefs holds unit \a aUnit of
 * reference \a aRef from library symbol \a aLibId. Before annotation every part reads "U?", so the
 * library id is what tells two different multi-unit parts apart.
 */
export function IsUnannotatedUnitOccupied(
  aRefs: SCH_REFERENCE_LIST,
  aRef: string,
  aLibId: LIB_ID,
  aUnit: number,
): boolean {
  for (let i = 0; i < aRefs.GetCount(); ++i) {
    const ref = aRefs.at(i);

    if (ref.GetUnit() !== aUnit) continue;

    if (ref.GetRef() !== aRef) continue;

    const refSym = ref.GetSymbol();

    if (refSym?.GetLibId().equals(aLibId)) return true;
  }

  return false;
}

/** `wxString::Trim( false ).Trim( true )`: ASCII whitespace off both ends (wxIsspace). */
function wxTrim(aText: string): string {
  return aText.replace(/^[ \t\n\v\f\r]+|[ \t\n\v\f\r]+$/g, '');
}

/** `GetSchItemAsText( aItem )` (sch_tool_utils.cpp:45): the text an item shows, for Copy as Text. */
export function GetSchItemAsText(aItem: SCH_ITEM): string {
  switch (aItem.Type()) {
    case KICAD_T.SCH_TEXT_T:
    case KICAD_T.SCH_LABEL_T:
    case KICAD_T.SCH_HIER_LABEL_T:
    case KICAD_T.SCH_GLOBAL_LABEL_T:
    case KICAD_T.SCH_DIRECTIVE_LABEL_T:
    case KICAD_T.SCH_SHEET_PIN_T: {
      const text = aItem as unknown as SCH_TEXT;
      return text.GetShownText(true);
    }

    case KICAD_T.SCH_FIELD_T: {
      // Goes via EDA_TEXT
      const field = aItem as unknown as SCH_FIELD;
      return field.GetShownText(true);
    }

    case KICAD_T.SCH_TEXTBOX_T:
    case KICAD_T.SCH_TABLECELL_T: {
      // Also EDA_TEXT
      const textbox = aItem as unknown as SCH_TEXTBOX;

      // Call the correct GetShownText overload with nullptr for settings/path and aDepth=0
      // This ensures proper variable expansion and escape marker conversion
      return textbox.GetShownText(null, null, true, 0);
    }

    case KICAD_T.SCH_PIN_T: {
      // This is a choice - probably the name makes more sense than the number
      // (or should it be name/number?)
      const pin = aItem as unknown as SCH_PIN;
      return pin.GetShownName();
    }

    case KICAD_T.SCH_TABLE_T: {
      // A simple tabbed list of the cells seems like a place to start here
      const table = aItem as unknown as SCH_TABLE;
      let s = '';

      for (let row = 0; row < table.GetRowCount(); ++row) {
        for (let col = 0; col < table.GetColCount(); ++col) {
          const cell = table.GetCell(row, col)!;
          s += cell.GetShownText(true);

          if (col < table.GetColCount() - 1) s += '\t';
        }

        if (row < table.GetRowCount() - 1) s += '\n';
      }

      return s;
    }

    default:
      break;
  }

  return '';
}

/** `GetSelectedItemsAsText( aSel )` (sch_tool_utils.cpp:121): one item's text per line. */
export function GetSelectedItemsAsText(aSel: SELECTION): string {
  const itemTexts: string[] = [];

  for (const item of aSel) {
    if (item.IsSCH_ITEM()) {
      const itemText = wxTrim(GetSchItemAsText(item as SCH_ITEM));

      if (itemText !== '') itemTexts.push(itemText);
    }
  }

  // wxJoin( itemTexts, '\n', '\0' ): no escape character.
  return itemTexts.join('\n');
}

/** `UniqueSheetName( aScreen, aBaseName )` (sch_tool_utils.cpp:443): case-insensitively unused. */
export function UniqueSheetName(aScreen: SCH_SCREEN | null, aBaseName: string): string {
  if (!aScreen) return aBaseName;

  const existing = new Set<string>();

  for (const item of aScreen.Items().OfType(KICAD_T.SCH_SHEET_T))
    existing.add((item as unknown as SCH_SHEET).GetShownName(false).toLowerCase());

  if (!existing.has(aBaseName.toLowerCase())) return aBaseName;

  for (let n = 1; n < 2147483647; ++n) {
    const candidate = `${aBaseName}${n}`;

    if (!existing.has(candidate.toLowerCase())) return candidate;
  }

  return aBaseName;
}

/** `UniqueGroupName( aScreen, aBaseName )` (sch_tool_utils.cpp:468): a group name the screen lacks. */
export function UniqueGroupName(aScreen: SCH_SCREEN | null, aBaseName: string): string {
  if (!aScreen) return aBaseName;

  const existing = new Set<string>();

  for (const item of aScreen.Items().OfType(KICAD_T.SCH_GROUP_T))
    existing.add((item as unknown as SCH_GROUP).GetName());

  if (!existing.has(aBaseName)) return aBaseName;

  for (let n = 1; n < 2147483647; ++n) {
    const candidate = `${aBaseName}${n}`;

    if (!existing.has(candidate)) return candidate;
  }

  return aBaseName;
}
