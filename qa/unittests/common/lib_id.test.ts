// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `qa/tests/common/test_lib_id.cpp` (LibId), transcribed against `LIB_ID`.
 */
import { describe, expect, it } from 'vitest';
import { LIB_ID } from '@ziroeda/common/src/lib_id.js';

describe('LibId', () => {
  it('ParseFullyQualified', () => {
    const id = new LIB_ID();
    expect(id.Parse('Package_SO:DGG56')).toBe(-1);
    expect(id.GetLibNickname()).toBe('Package_SO');
    expect(id.GetLibItemName()).toBe('DGG56');
    expect(id.IsValid()).toBe(true);
    expect(id.IsLegacy()).toBe(false);
    expect(id.empty()).toBe(false);
  });

  it('ParseLegacy', () => {
    const id = new LIB_ID();
    expect(id.Parse('DGG56')).toBe(-1);
    expect(id.GetLibNickname()).toBe('');
    expect(id.GetLibItemName()).toBe('DGG56');
    expect(id.IsValid()).toBe(false);
    expect(id.IsLegacy()).toBe(true);
    expect(id.empty()).toBe(false);
  });

  it('EqualityFullyQualified', () => {
    const a = new LIB_ID('Package_SO', 'DGG56');
    const b = new LIB_ID('Package_SO', 'DGG56');
    const c = new LIB_ID('OtherLib', 'DGG56');

    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
  });

  it('EqualityLegacyVsFullyQualified', () => {
    const legacy = new LIB_ID();
    legacy.Parse('DGG56');

    const qualified = new LIB_ID('Package_SO', 'DGG56');

    // Standard equality requires both library and item name to match
    expect(legacy.equals(qualified)).toBe(false);

    // Legacy matching (item name only) should match when we explicitly compare just item names
    expect(legacy.IsLegacy()).toBe(true);
    expect(legacy.GetLibItemName()).toBe(qualified.GetLibItemName());
  });

  it('FormatRoundTrip', () => {
    const qualified = new LIB_ID('Package_SO', 'DGG56');
    expect(qualified.Format()).toBe('Package_SO:DGG56');

    const legacy = new LIB_ID();
    legacy.Parse('DGG56');
    expect(legacy.Format()).toBe('DGG56');

    // Re-parse the formatted strings
    const reparsed = new LIB_ID();
    reparsed.Parse(qualified.Format());
    expect(reparsed.equals(qualified)).toBe(true);

    const reparsedLegacy = new LIB_ID();
    reparsedLegacy.Parse(legacy.Format());
    expect(reparsedLegacy.IsLegacy()).toBe(true);
    expect(reparsedLegacy.GetLibItemName()).toBe(legacy.GetLibItemName());
  });

  it('EmptyId', () => {
    const empty = new LIB_ID();
    expect(empty.empty()).toBe(true);
    expect(empty.IsValid()).toBe(false);
    expect(empty.IsLegacy()).toBe(false);
  });

  // the illegal-character paths of lib_id.cpp
  it('IllegalChars', () => {
    const id = new LIB_ID();
    // 'b:c' is the item name and ':' at its offset 1 is illegal; the offset is
    // relative to the item name, as lib_id.cpp returns it
    expect(id.Parse('a:b:c')).toBe(1);
    expect(LIB_ID.HasIllegalChars('ok name')).toBe(-1);
    expect(LIB_ID.HasIllegalChars('bad:name')).toBe(3);
    expect(LIB_ID.HasIllegalChars('bad\tname')).toBe(3);
    expect(LIB_ID.FixIllegalChars('bad:na\nme', false)).toBe('bad_na_me');
    expect(LIB_ID.FixIllegalChars('lib\\name', true)).toBe('lib_name');
    expect(LIB_ID.FindIllegalLibraryNameChar('fine lib')).toBe(0);
    expect(LIB_ID.FindIllegalLibraryNameChar('bad:lib')).toBe(0x3a);
    expect(() => LIB_ID.FormatParts('bad:lib', 'x')).toThrow();
    expect(LIB_ID.FormatParts('lib', 'x')).toBe('lib:x');
    expect(LIB_ID.FormatParts('', 'x')).toBe('x');
  });
});
