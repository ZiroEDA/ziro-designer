// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Attributes submenu (SCH_EDIT_TOOL::SetAttribute).
 *
 * The behaviour worth pinning is that it is *not* a per-item toggle: the whole
 * selection is set unless every item already carries the attribute, in which
 * case it is cleared. That is what makes the menu's checkmark and the action
 * agree on a mixed selection.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic, serializeSchematic } from '@ziroeda/eeschema';
import { refId } from '@ziroeda/eeschema/src/tools/hittest.js';
import {
  setAttribute,
  attributeIsSet,
  canSetAttribute,
} from '@ziroeda/eeschema/src/tools/set_attribute.js';

const SYM = (uuid: string, ref: string, unit: number, extra = '') =>
  `(symbol (lib_id "Device:R") (at 10 10 0) (unit ${unit}) ${extra} (uuid "${uuid}")
     (property "Reference" "${ref}" (at 10 8 0))
     (property "Value" "10k" (at 10 12 0)))`;

const DOC = `(kicad_sch (version 20250114) (generator "x") (lib_symbols)
  ${SYM('s1', 'U1', 1)}
  ${SYM('s2', 'U1', 2)}
  ${SYM('s3', 'R5', 1, '(dnp yes)')}
  (sheet (at 50 50) (size 30 20) (uuid "sh1")
    (property "Sheetname" "Sub" (at 50 49.4 0))
    (property "Sheetfile" "sub.kicad_sch" (at 50 70.6 0)))
)`;

const sch = readSchematic(parse(DOC));
const S1 = refId('symbol', 's1', 0);
const S3 = refId('symbol', 's3', 2);
const SHEET = refId('sheet', 'sh1', 0);

describe('setting an attribute', () => {
  it('sets it across a selection that does not all have it', () => {
    const out = setAttribute(sch, new Set([S1, S3]), 'dnp')!.apply(sch);
    // s3 already had dnp; s1 did not, so both end up set rather than flipped.
    expect(out.symbols[0]!.dnp).toBe(true);
    expect(out.symbols[2]!.dnp).toBe(true);
  });

  it('clears it when everything already has it', () => {
    const on = setAttribute(sch, new Set([S1, S3]), 'dnp')!.apply(sch);
    const off = setAttribute(on, new Set([S1, S3]), 'dnp')!.apply(on);
    expect(off.symbols[0]!.dnp).toBe(false);
    expect(off.symbols[2]!.dnp).toBe(false);
  });

  it('keeps the units of a multi-unit symbol in sync', () => {
    // U1 has two units; they are one part on the board, so excluding one
    // excludes the other (CollectOtherUnits).
    const out = setAttribute(sch, new Set([S1]), 'board')!.apply(sch);
    expect(out.symbols[0]!.onBoard).toBe(false);
    expect(out.symbols[1]!.onBoard).toBe(false);
    // A different part is untouched.
    expect(out.symbols[2]!.onBoard).toBe(true);
  });

  it('stores exclusion inverted for in_bom and on_board', () => {
    const out = setAttribute(sch, new Set([S3]), 'bom')!.apply(sch);
    expect(out.symbols[2]!.inBom).toBe(false);
    expect(serializeSchematic(out)).toMatch(/\(in_bom\s+no\)/);
  });

  it('applies to sheets too, except position files', () => {
    expect(setAttribute(sch, new Set([SHEET]), 'dnp')!.apply(sch).sheets[0]!.dnp).toBe(true);
    // Exclude from Position Files is offered for symbols alone.
    expect(canSetAttribute(sch, new Set([SHEET]), 'posFiles')).toBe(false);
    expect(setAttribute(sch, new Set([SHEET]), 'posFiles')).toBeNull();
    expect(canSetAttribute(sch, new Set([SHEET]), 'dnp')).toBe(true);
  });

  it('does nothing for a selection with no symbol or sheet in it', () => {
    expect(setAttribute(sch, new Set(['nope']), 'dnp')).toBeNull();
  });
});

describe('the menu checkmark', () => {
  it('is set only when everything the action would touch has it', () => {
    expect(attributeIsSet(sch, new Set([S3]), 'dnp')).toBe(true);
    // Mixed: one has it, one does not.
    expect(attributeIsSet(sch, new Set([S1, S3]), 'dnp')).toBe(false);
    expect(attributeIsSet(sch, new Set(), 'dnp')).toBe(false);
  });

  it('accounts for the other units the action would also touch', () => {
    // Selecting only unit 1 of U1 still reports unchecked until both units
    // carry it, because the action sets both.
    const one = { ...sch, symbols: sch.symbols.map((s, i) => (i === 0 ? { ...s, dnp: true } : s)) };
    expect(attributeIsSet(one, new Set([S1]), 'dnp')).toBe(false);
  });
});

describe('the undo step', () => {
  it('restores each item’s own previous value, not a second toggle', () => {
    // A mixed selection went all-on; flipping it back would leave the item
    // that started on turned off.
    const cmd = setAttribute(sch, new Set([S1, S3]), 'dnp')!;
    const back = cmd.invert(sch).apply(cmd.apply(sch));
    expect(back.symbols[0]!.dnp).toBe(false);
    expect(back.symbols[2]!.dnp).toBe(true);
  });
});
