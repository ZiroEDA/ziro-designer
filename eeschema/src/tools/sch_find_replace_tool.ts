// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Find (and replace) over schematic text. Counterpart:
 * `eeschema/tools/sch_find_replace_tool.cpp` plus the search-settings shape
 * from `include/eda_search_data.h` (EDA_SEARCH_DATA / SCH_SEARCH_DATA).
 *
 * Matching follows EDA_ITEM::Matches: case-insensitive by default, with
 * whole-word and wildcard (`*`/`?`, whole-string) modes. The searched text
 * sources mirror the upstream SCH_ITEM::Matches implementations: labels and
 * text, symbol fields (visible only, unless "search hidden fields"), pin
 * names/numbers (when "search pin names and numbers"), sheet fields
 * (Sheetname/Sheetfile), text boxes, and table cells.
 */

import type { Vec2 } from '@ziroeda/kimath';
import type { LibPin, LibSymbol, SchField, Schematic } from '../types.js';
import type { EditCommand } from './command.js';
import { EdaCombinedMatcher } from '@ziroeda/common/src/eda_pattern_match.js';
import { unescapeString } from '@ziroeda/common/src/string_utils.js';
import { refId } from './hittest.js';
import { schSymbolLibraryName } from '../lib_symbol_compare.js';

/**
 * EDA_SEARCH_MATCH_MODE. `permissive` is the Search panel's mode — upstream's
 * comment for it is "try to handle whatever the user throws at us (substring,
 * wildcards, regex, etc.)", and it is implemented by handing the query to
 * EDA_COMBINED_MATCHER rather than by picking one syntax.
 */
export type MatchMode = 'plain' | 'wholeword' | 'wildcard' | 'regex' | 'permissive';

/** EDA_SEARCH_DATA + the SCH_SEARCH_DATA extras. */
export interface SchSearchData {
  findString: string;
  replaceString: string;
  matchCase: boolean;
  matchMode: MatchMode;
  /** Search hidden fields too (searchAllFields). */
  searchAllFields: boolean;
  /** Search pin names and numbers (searchAllPins). */
  searchAllPins: boolean;
  searchCurrentSheetOnly: boolean;
  /** Restrict matches to the current selection (searchSelectedOnly). */
  searchSelectedOnly: boolean;
  /** Search connected-net names too (searchNetNames). */
  searchNetNames: boolean;
  /** Replace may touch reference designators (replaceReferences). */
  replaceReferences: boolean;
  /** The dialog is in replace mode (searchAndReplace): reference fields are
   *  then excluded from matches unless replaceReferences is set. */
  searchAndReplace: boolean;
}

export const defaultSearchData = (): SchSearchData => ({
  findString: '',
  replaceString: '',
  matchCase: false,
  matchMode: 'plain',
  searchAllFields: false,
  searchAllPins: false,
  searchCurrentSheetOnly: false,
  searchSelectedOnly: false,
  searchNetNames: false,
  replaceReferences: false,
  searchAndReplace: false,
});

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** EDA_ITEM::Matches( text, searchData ). */
export function matchesText(text: string, d: SchSearchData): boolean {
  if (!d.findString) return false;
  const t = d.matchCase ? text : text.toUpperCase();
  const s = d.matchCase ? d.findString : d.findString.toUpperCase();
  switch (d.matchMode) {
    case 'permissive':
      // EDA_COMBINED_MATCHER tries regex, then wildcard, then substring, so a
      // query that is not valid regex still finds what the user meant. It
      // lower-cases internally, which is why the case-folded text is passed.
      return new EdaCombinedMatcher(s.toLowerCase()).find(t.toLowerCase()) >= 0;
    case 'wholeword':
      return new RegExp(`\\b${escapeRe(s)}\\b`).test(t);
    case 'wildcard': {
      // wxString::Matches: whole-string match where * = any run, ? = any char.
      const re = escapeRe(s).replace(/\\\*/g, '.*').replace(/\\\?/g, '.');
      return new RegExp(`^${re}$`).test(t);
    }
    case 'regex':
      // EDA_SEARCH_DATA searchAndReplace regex mode (wxRegEx): an invalid
      // pattern simply matches nothing, like upstream's failed Compile().
      try {
        return new RegExp(d.findString, d.matchCase ? '' : 'i').test(text);
      } catch {
        return false;
      }
    default:
      return t.includes(s);
  }
}

/** One hit: the selectable item id, where to centre the view, and the text. */
export interface FindMatch {
  id: string;
  kind: 'symbol' | 'label' | 'sheet' | 'textbox' | 'table';
  pos: Vec2;
  text: string;
}

/**
 * All matches in one document, in reading order (top-to-bottom then
 * left-to-right) so repeated Find Next progresses predictably.
 */
export interface FindContext {
  /** Current selection ids, required to honour "search the current selection only". */
  selection?: ReadonlySet<string>;
  /** Net name -> a locatable item id + position, for "search net names". Pass
   *  the computeNetlist result; each net is located at one of its wire/label
   *  items so Find Next can centre the view on it. */
  nets?: readonly { name: string; items: readonly string[] }[];
}

export function findMatches(
  doc: Schematic,
  libById: ReadonlyMap<string, LibSymbol>,
  d: SchSearchData,
  ctx: FindContext = {},
): FindMatch[] {
  const out: FindMatch[] = [];
  if (!d.findString) return out;

  // Search connected-net names (SCH_FIND_REPLACE_TOOL search-net-names): a
  // matching net is located at its first wire/label item.
  if (d.searchNetNames && ctx.nets) {
    const posById = new Map<string, { pos: Vec2; kind: 'label' | 'line' }>();
    doc.labels.forEach((l, i) =>
      posById.set(refId('label', l.uuid, i), { pos: l.at, kind: 'label' }),
    );
    doc.lines.forEach((l, i) => {
      if (l.kind === 'wire') posById.set(refId('line', l.uuid, i), { pos: l.start, kind: 'line' });
    });
    for (const net of ctx.nets) {
      if (!matchesText(net.name, d)) continue;
      for (const itemId of net.items) {
        const at = posById.get(itemId);
        if (at) {
          // The item id selects the right wire/label; kind only drives view
          // centring, so 'label' (a point-located kind) is fine for both.
          out.push({ id: itemId, kind: 'label', pos: at.pos, text: net.name });
          break;
        }
      }
    }
  }

  // Labels cover every SCH_LABEL_BASE plus plain text (kind 'text').
  doc.labels.forEach((l, i) => {
    if (matchesText(l.text, d))
      out.push({ id: refId('label', l.uuid, i), kind: 'label', pos: l.at, text: l.text });
  });

  doc.symbols.forEach((sym, i) => {
    const id = refId('symbol', sym.uuid, i);
    for (const f of sym.fields) {
      const hidden = f.effects?.hidden === true;
      if (hidden && !d.searchAllFields) continue;
      // SCH_FIELD::Matches: in replace mode a reference designator only
      // matches when "Replace matches in reference designators" is on.
      if (f.key === 'Reference' && d.searchAndReplace && !d.replaceReferences) continue;
      if (matchesText(f.value, d)) {
        out.push({ id, kind: 'symbol', pos: f.at ?? sym.at, text: f.value });
        break; // one hit per symbol is enough to select it
      }
    }
    if (d.searchAllPins && !out.some((m) => m.id === id)) {
      const lib = libById.get(schSymbolLibraryName(sym));
      const pins = lib?.units.flatMap((u) => u.pins) ?? [];
      if (pins.some((p) => matchesText(p.name, d) || matchesText(p.number, d)))
        out.push({ id, kind: 'symbol', pos: sym.at, text: sym.libId });
    }
  });

  doc.sheets.forEach((sh, i) => {
    for (const f of sh.fields) {
      if (matchesText(f.value, d)) {
        out.push({
          id: refId('sheet', sh.uuid, i),
          kind: 'sheet',
          pos: sh.at,
          text: f.value,
        });
        break;
      }
    }
  });

  doc.textBoxes.forEach((tb, i) => {
    if (matchesText(tb.text, d))
      out.push({ id: refId('textbox', tb.uuid, i), kind: 'textbox', pos: tb.start, text: tb.text });
  });

  doc.tables.forEach((t, i) => {
    const hit = t.cells.find((c) => matchesText(c.text, d));
    if (hit)
      out.push({
        id: refId('table', t.uuid, i),
        kind: 'table',
        pos: hit.start,
        text: hit.text,
      });
  });

  // "Search the current selection only": drop matches outside the selection.
  const scoped =
    d.searchSelectedOnly && ctx.selection ? out.filter((m) => ctx.selection!.has(m.id)) : out;

  scoped.sort((a, b) => a.pos.y - b.pos.y || a.pos.x - b.pos.x);
  return scoped;
}

const isWordChar = (c: string): boolean => /\w/.test(c);

/**
 * EDA_ITEM::Replace( aSearchData, aText ): substitute every occurrence of the
 * search string (positions found case-folded, whole-word boundaries checked
 * per occurrence) while keeping the untouched parts of the original text.
 * Returns the new text, or null when nothing was replaced.
 */
export function replaceText(text: string, d: SchSearchData): string | null {
  if (!d.findString) return null;
  // Regex mode replaces every pattern match (wxRegEx::ReplaceAll).
  if (d.matchMode === 'regex') {
    try {
      const re = new RegExp(d.findString, d.matchCase ? 'g' : 'gi');
      const result = text.replace(re, d.replaceString);
      return result !== text ? result : null;
    } catch {
      return null;
    }
  }
  const folded = d.matchCase ? text : text.toUpperCase();
  const search = d.matchCase ? d.findString : d.findString.toUpperCase();
  let result = '';
  let ii = 0;
  let replaced = false;

  while (ii < folded.length) {
    const next = folded.indexOf(search, ii);
    if (next === -1) {
      result += text.slice(ii);
      break;
    }
    if (next > ii) result += text.slice(ii, next);
    const end = next + search.length;
    let startOK = true;
    let endOK = true;
    if (d.matchMode === 'wholeword') {
      startOK = next === 0 || !isWordChar(folded[next - 1]!);
      endOK = end === folded.length || !isWordChar(folded[end]!);
    }
    if (startOK && endOK) {
      result += d.replaceString;
      replaced = true;
      ii = end;
    } else {
      result += text[next]!;
      ii = next + 1;
    }
  }

  return replaced ? result : null;
}

/**
 * The Replace / Replace All command (SCH_FIND_REPLACE_TOOL::ReplaceAndFindNext
 * / ReplaceAll): substitute in every replaceable matched item of one document,
 * or only in the items listed in `ids` (Replace = just the current match).
 *
 * Replaceability mirrors upstream SCH_FIELD::IsReplaceable/Matches: reference
 * designators only with "Replace matches in reference designators", hidden
 * fields only when they are searched, and never a sheet's Sheetfile (renaming
 * the file a sheet points at is not a text edit).
 */
export function replaceCommand(d: SchSearchData, ids?: ReadonlySet<string>): EditCommand {
  const want = (id: string): boolean => !ids || ids.has(id);
  const replaceFields = (
    fields: readonly SchField[],
    opts: { isSheet: boolean },
  ): readonly SchField[] => {
    let changed = false;
    const next = fields.map((f) => {
      if (opts.isSheet && f.key === 'Sheetfile') return f;
      if (!opts.isSheet && f.key === 'Reference' && !d.replaceReferences) return f;
      if (f.effects?.hidden === true && !d.searchAllFields) return f;
      const t = replaceText(f.value, d);
      if (t === null) return f;
      changed = true;
      return { ...f, value: t };
    });
    return changed ? next : fields;
  };

  return {
    label: 'Find and Replace',
    apply(doc: Schematic): Schematic {
      return {
        ...doc,
        labels: doc.labels.map((l, i) => {
          if (!want(refId('label', l.uuid, i))) return l;
          const t = replaceText(l.text, d);
          return t === null ? l : { ...l, text: t };
        }),
        symbols: doc.symbols.map((s, i) => {
          if (!want(refId('symbol', s.uuid, i))) return s;
          const fields = replaceFields(s.fields, { isSheet: false });
          return fields === s.fields ? s : { ...s, fields };
        }),
        sheets: doc.sheets.map((sh, i) => {
          if (!want(refId('sheet', sh.uuid, i))) return sh;
          const fields = replaceFields(sh.fields, { isSheet: true });
          return fields === sh.fields ? sh : { ...sh, fields };
        }),
        textBoxes: doc.textBoxes.map((tb, i) => {
          if (!want(refId('textbox', tb.uuid, i))) return tb;
          const t = replaceText(tb.text, d);
          return t === null ? tb : { ...tb, text: t };
        }),
        tables: doc.tables.map((t, i) => {
          if (!want(refId('table', t.uuid, i))) return t;
          let changed = false;
          const cells = t.cells.map((c) => {
            const nt = replaceText(c.text, d);
            if (nt === null) return c;
            changed = true;
            return { ...c, text: nt };
          });
          return changed ? { ...t, cells } : t;
        }),
      };
    },
    invert(before: Schematic): EditCommand {
      return restoreTextItems(before);
    },
  };
}

/** Inverse of a replace: put back the pre-replace text-bearing collections. */
function restoreTextItems(before: Schematic): EditCommand {
  return {
    label: 'Find and Replace',
    apply(doc: Schematic): Schematic {
      return {
        ...doc,
        labels: before.labels,
        symbols: before.symbols,
        sheets: before.sheets,
        textBoxes: before.textBoxes,
        tables: before.tables,
      };
    },
    invert(b: Schematic): EditCommand {
      return restoreTextItems(b);
    },
  };
}

// ---------------------------------------------------------------------------
// The LIB_SYMBOL branch — SYMBOL_EDIT_FRAME's half of the same tool
// ---------------------------------------------------------------------------
//
// `SCH_FIND_REPLACE_TOOL` is one tool serving two frames, because
// `ShowFindReplaceDialog`, `GetFindReplaceDialog` and `m_findReplaceDialog`
// are all on `SCH_BASE_FRAME` (`eeschema/sch_base_frame.h:246-248, :318`), the
// class `SCH_EDIT_FRAME` and `SYMBOL_EDIT_FRAME` both inherit. The tool then
// branches on the frame in exactly two places, and they are the whole of the
// difference:
//
//     // UpdateFind's visitAll (sch_find_replace_tool.cpp:73-84)
//     if( SYMBOL_EDIT_FRAME* symbolEditor = dynamic_cast<SYMBOL_EDIT_FRAME*>( m_frame ) )
//     {
//         if( LIB_SYMBOL* symbol = symbolEditor->GetCurSymbol() )
//         {
//             for( SCH_ITEM& item : symbol->GetDrawItems() )
//                 visit( &item, nullptr );
//         }
//     }
//
//     // nextMatch (sch_find_replace_tool.cpp:190-198), the same walk
//
// so the searched set is `LIB_SYMBOL::GetDrawItems()` — `m_drawings`, which
// holds the FIELDS too (`lib_symbol.cpp:243`, `:1511-1513`), across every unit
// and body style, not just the one on the canvas. Both walks pass
// `aSheet = nullptr`, which is what turns the net-name half of every
// `Matches()` off in this frame.
//
// Which of those items can actually match is decided by the per-type
// `Matches()` overrides, and they do NOT come out the same as the schematic's:
//
//   * SCH_SHAPE has no `Matches` override at all, so it takes
//     `EDA_ITEM::Matches`'s default `return false` (`include/eda_item.h:419`).
//     Rectangles, circles, arcs, polylines and beziers are unsearchable.
//   * SCH_TEXT (`sch_text.h:129-131`) is `SCH_ITEM::Matches( GetText(), … )`,
//     with no UnescapeString — unlike the field below.
//   * SCH_FIELD (`sch_field.cpp:612-667`) searches `UnescapeString( GetText() )`,
//     skips an invisible field unless `searchAllFields`, and — the rule that
//     only bites in THIS frame — returns false outright for the Reference
//     field, because `dyn_cast<SCH_SYMBOL*>( m_parent )` is null when the
//     parent is a LIB_SYMBOL (:637-641). A symbol's Reference is never found
//     in the Symbol Editor.
//   * SCH_PIN (`sch_pin.cpp:502-527`) matches its name or its number, and only
//     when `searchAllPins` — which `DIALOG_SCH_FIND`'s constructor FORCES on
//     for this frame and then hides the checkbox for
//     (`dialog_sch_find.cpp:57-67`). Its other arm needs a sheet path for the
//     connection, and this walk passes nullptr, so net names never apply.
//
// and `EDA_ITEM::Matches( text, … )` gates all of them on
// `if( aSearchData.searchAndReplace && !IsReplaceable() ) return false`
// (`common/eda_item.cpp:192-194`). SCH_TEXT and SCH_FIELD override
// `IsReplaceable()` to true; **SCH_PIN does not**, so it keeps EDA_ITEM's
// `false` and drops out of the match list whenever `searchAndReplace` is set.

/** Which of a LIB_SYMBOL's draw items a hit is, in our storage's terms. */
export type SymbolItemKind = 'pin' | 'gfx' | 'field';

/**
 * One draw item of a LIB_SYMBOL, addressed the way this port stores them:
 * `sym.units[unitIdx].pins[itemIdx]`, `sym.units[unitIdx].graphics[itemIdx]`,
 * or `sym.properties[itemIdx]` with `unitIdx` 0 for a field.
 *
 * A structural ref rather than a joined string so nothing here has to know the
 * Symbol Editor's id format; the frame joins it with its own `symItemId`.
 */
export interface SymbolItemRef {
  kind: SymbolItemKind;
  unitIdx: number;
  itemIdx: number;
}

/** One hit inside a LIB_SYMBOL: which item, where to centre, and the text. */
export interface SymbolFindMatch extends SymbolItemRef {
  pos: Vec2;
  text: string;
}

const sameRef = (a: SymbolItemRef, b: SymbolItemRef): boolean =>
  a.kind === b.kind && a.unitIdx === b.unitIdx && a.itemIdx === b.itemIdx;

/**
 * `EDA_ITEM::Matches( aText, aSearchData )` including the guard the plain
 * `matchesText` above leaves out, because for the schematic every caller is
 * already replaceable and here two of the three types are not:
 *
 *     if( aSearchData.searchAndReplace && !IsReplaceable() )
 *         return false;
 */
function matchesReplaceable(text: string, d: SchSearchData, replaceable: boolean): boolean {
  if (d.searchAndReplace && !replaceable) return false;
  return matchesText(text, d);
}

/** `SCH_FIELD::IsReplaceable()` (`sch_field.cpp:801-807`) — false only for the
 *  Sheetfile and Intersheet References fields, neither of which a LIB_SYMBOL
 *  has, so every field of a symbol is replaceable. */
const FIELD_IS_REPLACEABLE = true;

/**
 * `SCH_TEXT::IsReplaceable()` (`sch_text.h:139`) and `SCH_TEXTBOX::IsReplaceable()`
 * (`sch_textbox.h:140`), both `return true`.
 */
const TEXT_IS_REPLACEABLE = true;

/**
 * `SCH_PIN` declares no `IsReplaceable()` override, so it inherits
 * `EDA_ITEM::IsReplaceable()`'s `return false` (`include/eda_item.h:457`).
 *
 * That is not a slip to be tidied: it is why `SCH_PIN::Replace`'s LIB_SYMBOL
 * arm (`sch_pin.cpp:528-546`) only ever runs while `searchAndReplace` is
 * clear. Nothing in `DIALOG_SCH_FIND` sets that flag — it is read and written
 * only by `EDA_DRAW_FRAME`'s config load/save (`common/eda_draw_frame.cpp:892`,
 * `:915`, `common/settings/app_settings.cpp:61-62`) — so opening Find and
 * Replace does not set it, and a pin name IS replaceable in a stock KiCad.
 */
const PIN_IS_REPLACEABLE = false;

/** `SCH_FIELD::Matches` for a field whose parent is a LIB_SYMBOL. */
function fieldMatches(f: SchField, d: SchSearchData): boolean {
  // `if( !IsVisible() && !searchHiddenFields ) return false;` (:630-631)
  if (f.effects?.hidden === true && !d.searchAllFields) return false;
  // `if( m_id == FIELD_T::REFERENCE ) { … if( !parentSymbol ) return false; }`
  // (:633-641). In the Symbol Editor the parent is a LIB_SYMBOL, never a
  // SCH_SYMBOL, so the Reference field falls out before the text is compared.
  if (f.key === 'Reference') return false;
  return matchesReplaceable(unescapeString(f.value), d, FIELD_IS_REPLACEABLE);
}

/** `SCH_PIN::Matches` with `aAuxData` null, as both symbol walks pass it. */
function pinMatches(p: LibPin, d: SchSearchData): boolean {
  if (!d.searchAllPins) return false;
  return (
    matchesReplaceable(p.name, d, PIN_IS_REPLACEABLE) ||
    matchesReplaceable(p.number, d, PIN_IS_REPLACEABLE)
  );
}

/**
 * Every match in one LIB_SYMBOL, in `SCH_FIND_REPLACE_TOOL::nextMatch`'s order
 * (`sch_find_replace_tool.cpp:203-216`):
 *
 *     if( a->GetPosition().x == b->GetPosition().x )
 *     {
 *         if( a->GetPosition().y == b->GetPosition().y )
 *             return a->m_Uuid < b->m_Uuid;
 *         return a->GetPosition().y < b->GetPosition().y;
 *     }
 *     return a->GetPosition().x < b->GetPosition().x;
 *
 * X first, then Y — not the reading order `findMatches` above sorts the
 * schematic into. A LIB_SYMBOL's draw items carry no UUID in this port, so the
 * last tiebreak is the item's own address in the symbol, which is stable for
 * the same reason `m_Uuid` is: it does not move while the list is walked.
 *
 * `only` is `searchSelectedOnly` (`nextMatch:185-189`), the one scope box
 * `DIALOG_SCH_FIND` leaves visible in this frame.
 */
export function findMatchesInSymbol(
  sym: LibSymbol,
  d: SchSearchData,
  only?: readonly SymbolItemRef[],
): SymbolFindMatch[] {
  const out: SymbolFindMatch[] = [];
  if (!d.findString) return out;

  // The fields, which live in `m_drawings[SCH_FIELD_T]` upstream and so are
  // walked by the same loop as everything else.
  sym.properties.forEach((f, itemIdx) => {
    if (fieldMatches(f, d))
      out.push({
        kind: 'field',
        unitIdx: 0,
        itemIdx,
        pos: f.at ?? { x: 0, y: 0 },
        text: f.value,
      });
  });

  // Every unit and every body style: `GetDrawItems()` is not filtered by the
  // unit on the canvas.
  sym.units.forEach((u, unitIdx) => {
    u.pins.forEach((p, itemIdx) => {
      if (pinMatches(p, d)) out.push({ kind: 'pin', unitIdx, itemIdx, pos: p.at, text: p.name });
    });
    u.graphics.forEach((g, itemIdx) => {
      // SCH_SHAPE has no Matches override; only SCH_TEXT does.
      if (g.kind !== 'text') return;
      if (matchesReplaceable(g.text, d, TEXT_IS_REPLACEABLE))
        out.push({ kind: 'gfx', unitIdx, itemIdx, pos: g.at, text: g.text });
    });
  });

  const scoped = only ? out.filter((m) => only.some((r) => sameRef(r, m))) : out;
  scoped.sort(
    (a, b) =>
      a.pos.x - b.pos.x ||
      a.pos.y - b.pos.y ||
      a.unitIdx - b.unitIdx ||
      a.itemIdx - b.itemIdx ||
      a.kind.localeCompare(b.kind),
  );
  return scoped;
}

/**
 * `SCH_FIND_REPLACE_TOOL::ReplaceAndFindNext` / `ReplaceAll` over a LIB_SYMBOL:
 * substitute in every item that both matches and can be replaced, or only in
 * the items `only` names (Replace = just the current match).
 *
 * Returns the new symbol, or null when nothing changed — the frame needs that
 * to decide whether to push an undo entry, as upstream's `commit.Empty()` does.
 *
 * The per-type `Replace` implementations, all of which reduce to
 * `EDA_ITEM::Replace( aSearchData, aText )` = our `replaceText`:
 *   * `SCH_FIELD::Replace` (`sch_field.cpp:810-853`) — the Reference arm needs
 *     `m_parent->Type() == SCH_SYMBOL_T`, so on a LIB_SYMBOL field it always
 *     takes the `else`, `EDA_TEXT::Replace` (`common/eda_text.cpp:470-480`).
 *   * `SCH_TEXT::Replace` (`sch_text.h:134-137`) — `EDA_TEXT::Replace`.
 *   * `SCH_PIN::Replace` (`sch_pin.cpp:528-546`) — for a LIB_SYMBOL parent,
 *     BOTH the name and the number, `isReplaced` OR'd across the two. (The
 *     schematic arm is an empty `TODO` upstream.)
 */
export function replaceInSymbol(
  sym: LibSymbol,
  d: SchSearchData,
  only?: readonly SymbolItemRef[],
): LibSymbol | null {
  if (!d.findString) return null;
  const wanted = (r: SymbolItemRef): boolean => !only || only.some((o) => sameRef(o, r));
  let changed = false;

  const properties = sym.properties.map((f, itemIdx) => {
    const ref: SymbolItemRef = { kind: 'field', unitIdx: 0, itemIdx };
    if (!wanted(ref) || !fieldMatches(f, d)) return f;
    const t = replaceText(f.value, d);
    if (t === null) return f;
    changed = true;
    return { ...f, value: t };
  });

  const units = sym.units.map((u, unitIdx) => {
    let unitChanged = false;
    const pins = u.pins.map((p, itemIdx) => {
      const ref: SymbolItemRef = { kind: 'pin', unitIdx, itemIdx };
      if (!wanted(ref) || !pinMatches(p, d)) return p;
      const name = replaceText(p.name, d);
      const number = replaceText(p.number, d);
      if (name === null && number === null) return p;
      unitChanged = true;
      return { ...p, name: name ?? p.name, number: number ?? p.number };
    });
    const graphics = u.graphics.map((g, itemIdx) => {
      const ref: SymbolItemRef = { kind: 'gfx', unitIdx, itemIdx };
      if (g.kind !== 'text' || !wanted(ref)) return g;
      if (!matchesReplaceable(g.text, d, TEXT_IS_REPLACEABLE)) return g;
      const t = replaceText(g.text, d);
      if (t === null) return g;
      unitChanged = true;
      return { ...g, text: t };
    });
    if (!unitChanged) return u;
    changed = true;
    return { ...u, pins, graphics };
  });

  return changed ? { ...sym, properties, units } : null;
}
