// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Clicking a grouped symbol's text selects the group, not the text.
 *
 * `SCH_SELECTION_TOOL::filterCollectedItems` promotes twice, in this order:
 *
 *   SCH_ITEM* start = item;
 *   if( !m_isSymbolEditor && sym ) start = sym;      // child -> its symbol
 *   if( EDA_GROUP* top = SCH_GROUP::TopLevelGroup( start, … ) )
 *       … replace the item with the group …          // symbol -> its group
 *
 * We had the second and not the first. A field is not a group member — the
 * symbol is — so a click on a grouped symbol's reference selected the text on
 * its own, and it could then be dragged out of the group it was supposed to be
 * held in.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { expandSelectionToGroups, readSchematic } from '@ziroeda/eeschema';

const SYM_UUID = '11111111-2222-3333-4444-555555555555';
const OTHER_UUID = '99999999-8888-7777-6666-555555555555';
const GROUP_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const SHEET = `(kicad_sch (version 20250114) (generator "eeschema")
  (uuid "0f1e2d3c-0000-0000-0000-000000000000")
  (lib_symbols
    (symbol "Device:R"
      (property "Reference" "R" (at 0 0 0) (effects (font (size 1.27 1.27))))
      (symbol "R_1_1"
        (pin passive line (at 0 3.81 270) (length 1.27)
          (name "~" (effects (font (size 1.27 1.27))))
          (number "1" (effects (font (size 1.27 1.27))))))))
  (symbol (lib_id "Device:R") (at 100 100 0) (unit 1)
    (uuid "${SYM_UUID}")
    (property "Reference" "R1" (at 100 95 0) (effects (font (size 1.27 1.27))))
    (property "Value" "10k" (at 100 105 0) (effects (font (size 1.27 1.27)))))
  (symbol (lib_id "Device:R") (at 150 100 0) (unit 1)
    (uuid "${OTHER_UUID}")
    (property "Reference" "R2" (at 150 95 0) (effects (font (size 1.27 1.27)))))
  (group "g" (uuid "${GROUP_UUID}") (members "${SYM_UUID}"))
  (sheet_instances (path "/" (page "1"))))
`;

const doc = readSchematic(parse(SHEET));

describe('selecting inside a group', () => {
  it('promotes a click on a grouped symbol’s field to the group', () => {
    const out = expandSelectionToGroups(doc, new Set([`${SYM_UUID}:field0`]));

    expect(out.has(GROUP_UUID), 'the group is selected').toBe(true);
    expect(out.has(SYM_UUID), 'and so is the symbol it holds').toBe(true);
  });

  it('promotes a pin the same way', () => {
    const out = expandSelectionToGroups(doc, new Set([`${SYM_UUID}:pin1`]));
    expect(out.has(GROUP_UUID)).toBe(true);
  });

  it('still promotes a click on the symbol body', () => {
    const out = expandSelectionToGroups(doc, new Set([SYM_UUID]));
    expect(out.has(GROUP_UUID)).toBe(true);
  });

  it('leaves an ungrouped symbol’s field alone', () => {
    // The promotion must not drag unrelated things in: R2 is in no group, so a
    // click on its reference stays a click on that field, and nothing else.
    // Upstream uses the parent only as the lookup key for TopLevelGroup — an
    // ungrouped symbol's reference is still dragged on its own, which is how
    // you position it.
    const out = expandSelectionToGroups(doc, new Set([`${OTHER_UUID}:field0`]));

    expect([...out]).toEqual([`${OTHER_UUID}:field0`]);
  });

  it('keeps the field itself in the selection', () => {
    // Upstream replaces the item with the group in the *collector*; the field is
    // still part of what moves, because the symbol carries it.
    const out = expandSelectionToGroups(doc, new Set([`${SYM_UUID}:field1`]));
    expect(out.has(`${SYM_UUID}:field1`)).toBe(true);
  });

  it('does nothing at all on a sheet with no groups', () => {
    const noGroups = { ...doc, groups: [] };
    const ids = new Set([`${SYM_UUID}:field0`]);
    expect(expandSelectionToGroups(noGroups, ids)).toBe(ids);
  });
});
