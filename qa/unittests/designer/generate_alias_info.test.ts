// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The chooser's details pane, `eeschema/generate_alias_info.cpp`.
 *
 * Nothing covered this file, and two things in it were wrong in ways a person
 * reading the dialog beside KiCad could see:
 *
 *  - a symbol with no description lost the blank line above the <hr>, because
 *    we guarded the <br> on there being a description. `SetHtmlDesc` applies
 *    DescFormat ("<br>%s") unconditionally (:140-151) where `SetHtmlKeywords`
 *    directly below it substitutes an empty string when there are none
 *    (:153-161). The asymmetry is deliberate: keywords carry a label, a
 *    description does not.
 *
 *  - the Reference row never got its "?", and gained a unit letter whenever a
 *    unit was passed. `SCH_FIELD::GetFullText( unit )` (sch_field.cpp:282-294)
 *    appends "?" to the REFERENCE field always, and the unit display name only
 *    when the symbol `IsMultiUnit()`.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic } from '@ziroeda/eeschema';
import { generateAliasInfo } from '@ziroeda/designer/src/editors/schematic/generate_alias_info.js';
import type { LibSymbol } from '@ziroeda/eeschema';

/** One unit, no description, no keywords: the 4006 case from the screenshots. */
const BARE = `(symbol "4xxx_IEEE:4006" (pin_names (offset 0))
    (property "Reference" "U" (at 0 2.54 0))
    (property "Value" "4006" (at 0 -2.54 0))
    (symbol "4006_1_1" (rectangle (start -5.08 5.08) (end 5.08 -5.08))))`;

/** Two units, and a description and keywords to go with them. */
const RICH = `(symbol "Device:Dual" (pin_names (offset 0))
    (property "Reference" "U" (at 0 2.54 0))
    (property "Value" "Dual" (at 0 -2.54 0))
    (property "Description" "A dual something")
    (property "ki_keywords" "dual thing")
    (symbol "Dual_1_1" (rectangle (start -5.08 5.08) (end 5.08 -5.08)))
    (symbol "Dual_2_1" (rectangle (start -5.08 5.08) (end 5.08 -5.08))))`;

const libOf = (body: string): LibSymbol => {
  const doc = readSchematic(
    parse(`(kicad_sch (version 20250114) (generator "x") (lib_symbols ${body}))`),
  );
  return doc.libSymbols[0]!;
};
const bare = libOf(BARE);
const rich = libOf(RICH);

/** Everything before the <hr>, which is the description and keywords block. */
const head = (html: string): string => html.split('<hr>')[0] ?? '';
/** The <td> value of one field row. */
const rowValue = (html: string, key: string): string => {
  const m = new RegExp(`<td><b>${key}</b></td><td>([^<]*)</td>`).exec(html.replace(/\s+/g, ''));
  return m?.[1] ?? '';
};

describe('the block above the rule', () => {
  it('keeps an empty line for a symbol with no description', () => {
    // `<b>4006</b>` then DescFormat over an empty string, then the rule. That
    // <br> is the space KiCad shows above the <hr> and we were dropping.
    expect(head(generateAliasInfo(bare))).toBe('<b>4006</b><br>');
  });

  it('carries the description when there is one', () => {
    expect(head(generateAliasInfo(rich))).toContain('<br>A dual something');
  });

  it('adds no line for absent keywords, which is the other half of the rule', () => {
    // The control beside the test above: if BOTH were emitted unconditionally
    // the first test would still pass, and the pane would gain a line KiCad
    // does not draw. `SetHtmlKeywords` substitutes nothing when empty.
    expect(head(generateAliasInfo(bare))).not.toContain('Keywords');
  });

  it('labels keywords when there are some', () => {
    expect(head(generateAliasInfo(rich))).toContain('<br>Keywords: dual thing');
  });
});

describe('the Reference row', () => {
  it('appends "?" on a single-unit symbol, and nothing else', () => {
    expect(rowValue(generateAliasInfo(bare), 'Reference')).toBe('U?');
  });

  it('still appends "?" when a unit is passed for a single-unit symbol', () => {
    // The old code keyed the suffix off `unit > 0`, so asking for unit 1 of a
    // one-unit part produced "UA". IsMultiUnit() is what upstream tests.
    expect(rowValue(generateAliasInfo(bare, 1), 'Reference')).toBe('U?');
  });

  it('adds the unit letter after the "?" on a multi-unit symbol', () => {
    expect(rowValue(generateAliasInfo(rich, 1), 'Reference')).toBe('U?A');
    expect(rowValue(generateAliasInfo(rich, 2), 'Reference')).toBe('U?B');
  });

  it('treats unit 0 as unit 1, as GenerateInfo does', () => {
    // `aField.GetFullText( m_unit > 0 ? m_unit : 1 )`.
    expect(rowValue(generateAliasInfo(rich, 0), 'Reference')).toBe('U?A');
  });
});

describe('the Value row', () => {
  it('is omitted, because it just repeats the name', () => {
    expect(generateAliasInfo(bare)).not.toContain('<b>Value</b>');
  });
});
