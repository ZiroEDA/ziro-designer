// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Attributes submenu: Exclude from Simulation / Bill of Materials / Board /
 * Position Files, and Do not Populate. Counterpart:
 * `SCH_EDIT_TOOL::SetAttribute` (eeschema/tools/sch_edit_tool.cpp).
 *
 * Two things are easy to get wrong and are the reason this is not a one-liner:
 *
 *  - it is not a per-item toggle. The whole selection is set unless *every*
 *    item already carries the attribute, in which case it is cleared. A mixed
 *    selection therefore goes all-on, not half-flipped, which is what makes
 *    the menu's checkmark and the action agree.
 *  - the units of a multi-unit symbol are kept in sync, because they are one
 *    part on the board. Selecting unit B of U1 and excluding it from the board
 *    excludes unit A too.
 *
 * Sheets carry the same attributes as symbols (they apply to everything inside
 * them) and so are included, except for Exclude from Position Files, which
 * upstream offers for symbols alone.
 */

import type { Schematic, SchSymbol, SchSheet } from '../types.js';
import { refId } from './hittest.js';
import type { EditCommand } from './command.js';

/** The five attributes, named as SCH_ACTIONS names them. */
export type Attribute = 'sim' | 'bom' | 'board' | 'posFiles' | 'dnp';

/** Menu labels, in the Attributes submenu's order. */
export const ATTRIBUTE_LABELS: Record<Attribute, string> = {
  sim: 'Exclude from Simulation',
  bom: 'Exclude from Bill of Materials',
  board: 'Exclude from Board',
  posFiles: 'Exclude from Position Files',
  dnp: 'Do not Populate',
};

/** Position files are a symbol-only attribute; the rest apply to sheets too. */
const appliesToSheets = (a: Attribute): boolean => a !== 'posFiles';

/**
 * Whether the item currently carries the attribute. `in_bom` and `on_board` are
 * stored the other way round, so "excluded" is the negation of what is stored.
 */
function symbolHas(s: SchSymbol, a: Attribute): boolean {
  switch (a) {
    case 'sim':
      return !!s.excludedFromSim;
    case 'bom':
      return !s.inBom;
    case 'board':
      return !s.onBoard;
    case 'posFiles':
      return !!s.excludedFromPosFiles;
    case 'dnp':
      return s.dnp;
  }
}

function sheetHas(s: SchSheet, a: Attribute): boolean {
  switch (a) {
    case 'sim':
      return !!s.excludedFromSim;
    case 'bom':
      return !s.inBom;
    case 'board':
      return !s.onBoard;
    case 'dnp':
      return s.dnp;
    case 'posFiles':
      return false; // never reached: sheets are filtered out for this one
  }
}

const withSymbolAttr = (s: SchSymbol, a: Attribute, on: boolean): SchSymbol => {
  switch (a) {
    case 'sim':
      return { ...s, excludedFromSim: on };
    case 'bom':
      return { ...s, inBom: !on };
    case 'board':
      return { ...s, onBoard: !on };
    case 'posFiles':
      return { ...s, excludedFromPosFiles: on };
    case 'dnp':
      return { ...s, dnp: on };
  }
};

const withSheetAttr = (s: SchSheet, a: Attribute, on: boolean): SchSheet => {
  switch (a) {
    case 'sim':
      return { ...s, excludedFromSim: on };
    case 'bom':
      return { ...s, inBom: !on };
    case 'board':
      return { ...s, onBoard: !on };
    case 'dnp':
      return { ...s, dnp: on };
    case 'posFiles':
      return s;
  }
};

/** Identity of a part: reference plus library id, unambiguously joined so a
 *  reference containing the separator cannot collide with another part. */
const partKey = (ref: string, libId: string): string => JSON.stringify([ref, libId]);

const referenceOf = (s: SchSymbol): string =>
  s.fields.find((f) => f.key === 'Reference')?.value ?? '';

/**
 * The symbol indices the change touches: the selected ones, plus every other
 * unit of the same part (CollectOtherUnits).
 *
 * Upstream walks the whole hierarchy for those other units. We only reach the
 * sheet in front of us, so a part split across sheets keeps its units in sync
 * only within one; the same limit the rest of our per-document editing has.
 */
function symbolTargets(doc: Schematic, ids: ReadonlySet<string>): Set<number> {
  const out = new Set<number>();
  const parts = new Set<string>();
  doc.symbols.forEach((s, i) => {
    if (!ids.has(refId('symbol', s.uuid, i))) return;
    out.add(i);
    const ref = referenceOf(s);
    // An unannotated symbol ("R?") has no identity to match other units by.
    if (ref && !ref.endsWith('?')) parts.add(partKey(ref, s.libId));
  });
  if (parts.size)
    doc.symbols.forEach((s, i) => {
      if (parts.has(partKey(referenceOf(s), s.libId))) out.add(i);
    });
  return out;
}

const sheetTargets = (doc: Schematic, ids: ReadonlySet<string>): Set<number> =>
  new Set(doc.sheets.flatMap((s, i) => (ids.has(refId('sheet', s.uuid, i)) ? [i] : [])));

/**
 * Whether the menu shows this attribute checked: true only when everything the
 * action would touch already carries it, which is the same test that decides
 * what the action does.
 */
export function attributeIsSet(doc: Schematic, ids: ReadonlySet<string>, a: Attribute): boolean {
  const symbols = symbolTargets(doc, ids);
  const sheets = appliesToSheets(a) ? sheetTargets(doc, ids) : new Set<number>();
  if (symbols.size === 0 && sheets.size === 0) return false;
  for (const i of symbols) if (!symbolHas(doc.symbols[i]!, a)) return false;
  for (const i of sheets) if (!sheetHas(doc.sheets[i]!, a)) return false;
  return true;
}

/** Whether the action has anything to act on, for greying the menu item. */
export function canSetAttribute(doc: Schematic, ids: ReadonlySet<string>, a: Attribute): boolean {
  return (
    symbolTargets(doc, ids).size > 0 || (appliesToSheets(a) && sheetTargets(doc, ids).size > 0)
  );
}

/** Set the attribute across the selection, or clear it when all already have it. */
export function setAttribute(
  doc: Schematic,
  ids: ReadonlySet<string>,
  a: Attribute,
): EditCommand | null {
  const symbols = symbolTargets(doc, ids);
  const sheets = appliesToSheets(a) ? sheetTargets(doc, ids) : new Set<number>();
  if (symbols.size === 0 && sheets.size === 0) return null;

  // new_state: on unless every target already carries it.
  const on = !attributeIsSet(doc, ids, a);

  return {
    label: 'Toggle Attribute',
    apply(d: Schematic): Schematic {
      return {
        ...d,
        symbols: d.symbols.map((s, i) => (symbols.has(i) ? withSymbolAttr(s, a, on) : s)),
        sheets: d.sheets.map((s, i) => (sheets.has(i) ? withSheetAttr(s, a, on) : s)),
      };
    },
    invert(before: Schematic): EditCommand {
      // Undo restores each item's own previous value, which a second toggle
      // would not: a mixed selection went all-on, so flipping it back would
      // leave the ones that started on turned off.
      return {
        label: 'Toggle Attribute',
        apply: (d: Schematic): Schematic => ({
          ...d,
          symbols: d.symbols.map((s, i) => (symbols.has(i) ? before.symbols[i]! : s)),
          sheets: d.sheets.map((s, i) => (sheets.has(i) ? before.sheets[i]! : s)),
        }),
        invert: () => setAttribute(doc, ids, a)!,
      };
    },
  };
}
