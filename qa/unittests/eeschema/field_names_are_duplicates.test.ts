// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `FieldNamesAreDuplicates` (common/template_fieldnames.cpp:99-125), the test
 * every dialog that lets a field be renamed has to apply before it accepts one.
 *
 * The whole function is one asymmetry, and both halves of it are load-bearing:
 * a plain `==` would let a symbol be written with a "Reference" and a
 * "reference", which the s-expression parser folds together; a plain
 * `CmpNoCase` would refuse "PartNo" beside "partno", which are two legal user
 * fields. Either mistake passes a test that only checks the equal case.
 */
import { describe, expect, it } from 'vitest';
import { fieldNamesAreDuplicates } from '@ziroeda/eeschema/src/tools/properties.js';

describe('FieldNamesAreDuplicates', () => {
  it('identical names collide', () => {
    expect(fieldNamesAreDuplicates('MPN', 'MPN')).toBe(true);
    expect(fieldNamesAreDuplicates('Reference', 'Reference')).toBe(true);
  });

  it('unrelated names do not', () => {
    expect(fieldNamesAreDuplicates('MPN', 'Value')).toBe(false);
    expect(fieldNamesAreDuplicates('', 'Reference')).toBe(false);
  });

  it('a case variant of a MANDATORY name collides', () => {
    // "Mandatory field names are folded case-insensitively by the s-expression
    // parser, so any case variant of a mandatory canonical name collides with
    // the canonical mandatory field." All five, not just the first.
    for (const name of ['Reference', 'Value', 'Footprint', 'Datasheet', 'Description']) {
      expect(fieldNamesAreDuplicates(name.toLowerCase(), name)).toBe(true);
      expect(fieldNamesAreDuplicates(name.toUpperCase(), name)).toBe(true);
    }
  });

  it('a case variant of a USER name does NOT', () => {
    expect(fieldNamesAreDuplicates('partno', 'PartNo')).toBe(false);
    expect(fieldNamesAreDuplicates('MPN', 'mpn')).toBe(false);
  });

  it('the mandatory test looks at the NAME, not at the other side', () => {
    // `aLhs.CmpNoCase( GetCanonicalFieldName( fieldId ) )` compares the LEFT
    // operand against each mandatory name; by then the two already match
    // case-insensitively, so which side is checked cannot matter — and a rule
    // that checked only `aRhs` would still pass every case above.
    expect(fieldNamesAreDuplicates('VALUE', 'value')).toBe(true);
    expect(fieldNamesAreDuplicates('value', 'VALUE')).toBe(true);
  });
});
