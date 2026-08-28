// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What Find searches in the SYMBOL EDITOR, which is not what it searches in
 * the schematic.
 *
 * Counterpart: `SCH_FIND_REPLACE_TOOL` (`eeschema/tools/sch_find_replace_tool.cpp`),
 * which is ONE tool for both frames because `ShowFindReplaceDialog` and
 * `m_findReplaceDialog` are `SCH_BASE_FRAME` members
 * (`eeschema/sch_base_frame.h:246-248, :318`). It branches on the frame in
 * exactly two places, `UpdateFind`'s `visitAll` (:73-84) and `nextMatch`
 * (:190-198), and both are the same walk:
 *
 *     if( LIB_SYMBOL* symbol = symbolEditor->GetCurSymbol() )
 *         for( SCH_ITEM& item : symbol->GetDrawItems() )
 *             …
 *
 * with `aSheet = nullptr`. `GetDrawItems()` is `m_drawings`, which holds the
 * FIELDS as well (`lib_symbol.cpp:243`, `:1511-1513`), across every unit and
 * body style — not just the one on the canvas.
 *
 * Everything below is a rule read off a per-type `Matches()` override, and
 * each one is the reason a whole class of item behaves differently here than
 * on a sheet. None of them is derived by calling the code under test.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSymbolLib } from '@ziroeda/eeschema';
import type { LibSymbol } from '@ziroeda/eeschema/src/types.js';
import {
  defaultSearchData,
  findMatchesInSymbol,
  replaceInSymbol,
  type SchSearchData,
} from '@ziroeda/eeschema/src/tools/sch_find_replace_tool.js';

/**
 * One symbol carrying one of everything the walk can reach: visible and hidden
 * fields, a Reference field, pins in TWO units, a text item, and shapes of
 * three kinds — all containing the same needle, so a rule that lets the wrong
 * class through shows up as an extra hit rather than as a missing one.
 */
const LIB = `(kicad_symbol_lib (version 20241209) (generator "qa")
  (symbol "NEEDLE"
    (property "Reference" "NEEDLE_ref" (at 0 0 0) (effects (font (size 1.27 1.27))))
    (property "Value" "NEEDLE_value" (at 10 0 0) (effects (font (size 1.27 1.27))))
    (property "Datasheet" "NEEDLE_ds" (at 20 0 0) (effects (font (size 1.27 1.27)) (hide yes)))
    (symbol "NEEDLE_1_1"
      (rectangle (start -1 2.54) (end 1 -2.54)
        (stroke (width 0.254) (type default)) (fill (type none)))
      (circle (center 0 0) (radius 1)
        (stroke (width 0.254) (type default)) (fill (type none)))
      (polyline (pts (xy 0 0) (xy 1 1))
        (stroke (width 0.254) (type default)) (fill (type none)))
      (text "NEEDLE_text" (at 30 0 0) (effects (font (size 1.27 1.27))))
      (pin input line (at 40 0 0) (length 2.54)
        (name "NEEDLE_pinname" (effects (font (size 1.27 1.27))))
        (number "1" (effects (font (size 1.27 1.27)))))
    )
    (symbol "NEEDLE_2_1"
      (pin input line (at 50 0 0) (length 2.54)
        (name "other" (effects (font (size 1.27 1.27))))
        (number "NEEDLE_2" (effects (font (size 1.27 1.27)))))
    )
  )
)`;

const SYM: LibSymbol = readSymbolLib(parse(LIB))[0]!;

/**
 * The search state the Symbol Editor's dialog opens with: `searchAllPins` is
 * SET by the constructor for this frame — `m_findReplaceData->searchAllPins = true`
 * (`dialog_sch_find.cpp:59`) — rather than left at SCH_SEARCH_DATA's `false`,
 * and then the checkbox is hidden.
 */
const symbolFind = (over: Partial<SchSearchData> = {}): SchSearchData => ({
  ...defaultSearchData(),
  findString: 'NEEDLE',
  searchAllPins: true,
  ...over,
});

const hits = (d: SchSearchData): string[] =>
  findMatchesInSymbol(SYM, d).map((m) => `${m.kind}:${m.unitIdx}:${m.itemIdx} ${m.text}`);

// ---------------------------------------------------------------------------
// What matches
// ---------------------------------------------------------------------------

describe('the searched set is LIB_SYMBOL::GetDrawItems()', () => {
  /**
   * The whole hit list, in `nextMatch`'s order, written out. Named
   * item-by-item because the interesting content is what is ABSENT: the
   * Reference field and all three shapes carry the needle too.
   *
   * `nextMatch`'s sort (`:203-216`) is X, then Y, then the UUID — X FIRST,
   * which is not the reading order the schematic's `findMatches` uses. So:
   * Value at x=10, Datasheet(hidden, off) …, text at x=30, pin at x=40,
   * pin at x=50. The Y coordinate is negated on read, so these are the file's
   * X values unchanged.
   */
  it('finds the fields, the pins and the text — and nothing else', () => {
    expect(hits(symbolFind())).toEqual([
      'field:0:1 NEEDLE_value',
      'gfx:0:3 NEEDLE_text',
      'pin:0:0 NEEDLE_pinname',
      'pin:1:0 other',
    ]);
  });

  /**
   * SCH_SHAPE declares no `Matches` override, so it takes
   * `EDA_ITEM::Matches`'s default `return false` (`include/eda_item.h:419`).
   * Stated on its own, and by kind, because the fixture's rectangle, circle
   * and polyline are the only three items in it that must never be found.
   */
  it('never matches a shape, whatever it is called', () => {
    const shapes = SYM.units[0]!.graphics.filter((g) => g.kind !== 'text');
    expect(shapes.map((g) => g.kind)).toEqual(['rectangle', 'circle', 'polyline']);
    const gfx = findMatchesInSymbol(SYM, symbolFind()).filter((m) => m.kind === 'gfx');
    // Not vacuous: the text item IS found, so "every gfx hit is a text" is a
    // claim about a non-empty list rather than one that holds for an empty one.
    expect(gfx).toHaveLength(1);
    for (const m of gfx) expect(SYM.units[m.unitIdx]!.graphics[m.itemIdx]!.kind).toBe('text');
  });

  /**
   * `SCH_FIELD::Matches` (`sch_field.cpp:633-641`): the Reference arm needs
   * `dyn_cast<SCH_SYMBOL*>( m_parent )` and returns false when there is none.
   * In this frame the parent is always a LIB_SYMBOL, so a symbol's Reference
   * is unfindable — which is also why `DIALOG_SCH_FIND` hides "Replace matches
   * in reference designators" here.
   */
  it('never matches the Reference field, even with hidden fields on', () => {
    for (const d of [symbolFind(), symbolFind({ searchAllFields: true })])
      expect(hits(d).some((h) => h.includes('NEEDLE_ref'))).toBe(false);
    // The needle really is in there, so this is not passing on a typo.
    expect(SYM.properties[0]).toMatchObject({ key: 'Reference', value: 'NEEDLE_ref' });
  });

  /** `if( !IsVisible() && !searchHiddenFields ) return false;` (:630-631). */
  it('skips a hidden field until "Include hidden fields" is on', () => {
    expect(hits(symbolFind()).some((h) => h.includes('NEEDLE_ds'))).toBe(false);
    expect(hits(symbolFind({ searchAllFields: true }))).toEqual([
      'field:0:1 NEEDLE_value',
      'field:0:2 NEEDLE_ds',
      'gfx:0:3 NEEDLE_text',
      'pin:0:0 NEEDLE_pinname',
      'pin:1:0 other',
    ]);
  });

  /**
   * `SCH_PIN::Matches` (`sch_pin.cpp:502-513`) is gated on `searchAllPins`,
   * and matches EITHER the name or the number: unit 1's pin matches by name,
   * unit 2's by number.
   */
  it('matches a pin by its name or by its number, only under searchAllPins', () => {
    expect(hits(symbolFind()).filter((h) => h.startsWith('pin:'))).toEqual([
      'pin:0:0 NEEDLE_pinname',
      'pin:1:0 other',
    ]);
    expect(hits(symbolFind({ searchAllPins: false })).some((h) => h.startsWith('pin:'))).toBe(
      false,
    );
  });

  /** Both units, because `GetDrawItems()` is not filtered by the unit shown. */
  it('reaches every unit, not just the one on the canvas', () => {
    expect(hits(symbolFind()).map((h) => h.split(':')[1])).toContain('1');
  });

  /**
   * `EDA_ITEM::Matches( aText, … )` opens with
   * `if( aSearchData.searchAndReplace && !IsReplaceable() ) return false`
   * (`common/eda_item.cpp:192-194`), and SCH_PIN declares no `IsReplaceable()`
   * override, so it keeps EDA_ITEM's `false`. Fields and text override it to
   * true (`sch_field.cpp:801-807`, `sch_text.h:139`), so they stay.
   */
  it('drops pins, and only pins, once searchAndReplace is set', () => {
    expect(hits(symbolFind({ searchAndReplace: true }))).toEqual([
      'field:0:1 NEEDLE_value',
      'gfx:0:3 NEEDLE_text',
    ]);
  });

  /** No search string is no search: `!data.findString.IsEmpty()` guards every
   *  visit (`sch_find_replace_tool.cpp:57`). */
  it('finds nothing for an empty search string', () => {
    expect(hits(symbolFind({ findString: '' }))).toEqual([]);
  });

  /** `EDA_ITEM::Matches` folds both sides unless `matchCase`. */
  it('is case-insensitive until Match case is ticked', () => {
    expect(hits(symbolFind({ findString: 'needle_value' }))).toEqual(['field:0:1 NEEDLE_value']);
    expect(hits(symbolFind({ findString: 'needle_value', matchCase: true }))).toEqual([]);
  });

  /** `searchSelectedOnly` (`nextMatch:185-189`), the one scope box the dialog
   *  leaves visible in this frame. */
  it('honours "search the current selection only"', () => {
    const d = symbolFind({ searchSelectedOnly: true });
    const only = [{ kind: 'pin' as const, unitIdx: 0, itemIdx: 0 }];
    expect(findMatchesInSymbol(SYM, d, only).map((m) => m.text)).toEqual(['NEEDLE_pinname']);
  });
});

// ---------------------------------------------------------------------------
// Replace
// ---------------------------------------------------------------------------

describe('replacing inside a LIB_SYMBOL', () => {
  const replaced = (d: Partial<SchSearchData>, only?: Parameters<typeof replaceInSymbol>[2]) =>
    replaceInSymbol(SYM, symbolFind({ replaceString: 'PIN', ...d }), only);

  /**
   * `SCH_PIN::Replace`'s LIB_SYMBOL arm (`sch_pin.cpp:530-534`) replaces BOTH
   * the name and the number, `isReplaced` OR'd across the two. Unit 2's pin
   * matched by number, so the number is what changes there.
   */
  it('replaces a pin name and a pin number', () => {
    const out = replaced({});
    expect(out).not.toBeNull();
    expect(out!.units[0]!.pins[0]!.name).toBe('PIN_pinname');
    expect(out!.units[1]!.pins[0]!.number).toBe('PIN_2');
  });

  /** The field and the text item, `EDA_TEXT::Replace` in both cases. */
  it('replaces a field value and a text item', () => {
    const out = replaced({})!;
    expect(out.properties[1]!.value).toBe('PIN_value');
    const text = out.units[0]!.graphics[3]!;
    expect(text.kind === 'text' && text.text).toBe('PIN_text');
  });

  /** The Reference is unfindable here, so it is unreplaceable here. */
  it('leaves the Reference field alone', () => {
    expect(replaced({})!.properties[0]!.value).toBe('NEEDLE_ref');
  });

  /** A hidden field is not searched, so it is not replaced either. */
  it('leaves a hidden field alone unless it is being searched', () => {
    expect(replaced({})!.properties[2]!.value).toBe('NEEDLE_ds');
    expect(replaced({ searchAllFields: true })!.properties[2]!.value).toBe('PIN_ds');
  });

  /** Replace (as opposed to Replace All) touches exactly the current match. */
  it('scopes to the items it is given', () => {
    const out = replaced({}, [{ kind: 'field', unitIdx: 0, itemIdx: 1 }])!;
    expect(out.properties[1]!.value).toBe('PIN_value');
    expect(out.units[0]!.pins[0]!.name).toBe('NEEDLE_pinname');
  });

  /**
   * `if( !commit.Empty() ) commit.Push( … )` — nothing to replace means no
   * undo entry, which is why this returns null rather than a fresh copy.
   */
  it('returns null when nothing changed', () => {
    expect(replaceInSymbol(SYM, symbolFind({ findString: 'nothing here' }))).toBeNull();
    expect(replaceInSymbol(SYM, symbolFind({ findString: '' }))).toBeNull();
  });

  /** Shapes have no text to replace, so the graphics that are not text come
   *  back identical — by reference, since nothing rebuilt them. */
  it('does not touch a shape', () => {
    const out = replaced({})!;
    for (const i of [0, 1, 2]) expect(out.units[0]!.graphics[i]).toBe(SYM.units[0]!.graphics[i]);
  });
});

// ---------------------------------------------------------------------------
// The order Find Next walks in
// ---------------------------------------------------------------------------

/**
 * Two text items placed so that X-first and reading order DISAGREE: `left` is
 * at file (0, -10) and `right` at (10, 0). Y is negated on read, so in model
 * space `left` is (0, 10) and `right` is (10, 0).
 *
 *   X first  (upstream `nextMatch`):  left  (x 0), then right (x 10)
 *   Y first  (reading order):         right (y 0), then left  (y 10)
 *
 * Without a pair like this every item in the fixture above sits at y = 0 and
 * the two orders coincide, so the sort would be pinned by a test that cannot
 * fail.
 */
const ORDER_LIB = `(kicad_symbol_lib (version 20241209) (generator "qa")
  (symbol "ORDER"
    (property "Reference" "O" (at 0 0 0) (effects (font (size 1.27 1.27))))
    (symbol "ORDER_1_1"
      (text "NEEDLE_right" (at 10 0 0) (effects (font (size 1.27 1.27))))
      (text "NEEDLE_left" (at 0 -10 0) (effects (font (size 1.27 1.27))))
    )
  )
)`;
const ORDER: LibSymbol = readSymbolLib(parse(ORDER_LIB))[0]!;

/**
 * A field whose stored value carries KiCad's `{slash}` escape. `SCH_FIELD::Matches`
 * compares `UnescapeString( GetText() )` (`sch_field.cpp:628`) — unlike
 * `SCH_TEXT::Matches`, which compares `GetText()` raw (`sch_text.h:129-131`).
 * So the user searches for what they SEE, `A/B`, not for what is on disk.
 */
const ESCAPED_LIB = `(kicad_symbol_lib (version 20241209) (generator "qa")
  (symbol "ESC"
    (property "Reference" "E" (at 0 0 0) (effects (font (size 1.27 1.27))))
    (property "Value" "A{slash}B" (at 0 0 0) (effects (font (size 1.27 1.27))))
    (symbol "ESC_1_1"
      (text "C{slash}D" (at 10 0 0) (effects (font (size 1.27 1.27))))
    )
  )
)`;
const ESCAPED: LibSymbol = readSymbolLib(parse(ESCAPED_LIB))[0]!;

describe('UnescapeString, on the field but not on the text', () => {
  /** The premise, so this is not passing because the parser already unescaped. */
  it('stores the escape as written', () => {
    expect(ESCAPED.properties[1]!.value).toBe('A{slash}B');
  });

  it('finds a field by its unescaped text', () => {
    const got = findMatchesInSymbol(ESCAPED, symbolFind({ findString: 'A/B' }));
    expect(got.map((m) => m.kind)).toEqual(['field']);
  });

  /**
   * And the raw form does NOT match, which is the half that says the compare
   * really happened on the unescaped string rather than on both.
   */
  it('does not find that field by its raw stored text', () => {
    expect(findMatchesInSymbol(ESCAPED, symbolFind({ findString: 'A{slash}B' }))).toEqual([]);
  });

  /** SCH_TEXT has no UnescapeString, so a text item is the other way round. */
  it('finds a text item by its raw text and not by the unescaped form', () => {
    expect(
      findMatchesInSymbol(ESCAPED, symbolFind({ findString: 'C{slash}D' })).map((m) => m.kind),
    ).toEqual(['gfx']);
    expect(findMatchesInSymbol(ESCAPED, symbolFind({ findString: 'C/D' }))).toEqual([]);
  });
});

describe("nextMatch's sort (sch_find_replace_tool.cpp:203-216)", () => {
  /**
   *     if( a->GetPosition().x == b->GetPosition().x ) { … y … }
   *     return a->GetPosition().x < b->GetPosition().x;
   *
   * X is the outer key. The schematic's `findMatches` in the same module sorts
   * `y || x` instead — a pre-existing divergence there, and the reason this is
   * asserted on the symbol walk rather than assumed to be shared.
   */
  it('orders by X before Y, not in reading order', () => {
    const got = findMatchesInSymbol(ORDER, symbolFind());
    expect(got.map((m) => m.text)).toEqual(['NEEDLE_left', 'NEEDLE_right']);
    // The premise: the two really do disagree, i.e. left is further UP the
    // page (larger model Y) while sitting further LEFT (smaller model X).
    const left = got.find((m) => m.text === 'NEEDLE_left')!;
    const right = got.find((m) => m.text === 'NEEDLE_right')!;
    expect(left.pos.x).toBeLessThan(right.pos.x);
    expect(left.pos.y).toBeGreaterThan(right.pos.y);
  });
});
