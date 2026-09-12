// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** `qa/tests/common/test_base_set.cpp`, transcribed (the `std::hash` case aside). */
import { describe, expect, it } from 'vitest';
import { BASE_SET } from '@ziroeda/common/src/base_set.js';

describe('BaseSet', () => {
  it('ConstructionAndSize', () => {
    const bs = new BASE_SET(10);
    expect(bs.size()).toBe(10);
    expect(bs.count()).toBe(0);

    bs.resize(20);
    expect(bs.size()).toBe(20);
    expect(bs.count()).toBe(0);
  });

  it('BitSettingAndResetting', () => {
    const bs = new BASE_SET(10);
    bs.set(2);
    expect(bs.test(2)).toBe(true);
    expect(bs.count()).toBe(1);

    bs.reset(2);
    expect(bs.test(2)).toBe(false);
    expect(bs.count()).toBe(0);
  });

  it('SetOutOfRange', () => {
    const bs = new BASE_SET(10);
    expect(bs.size()).toBe(10);
    expect(bs.count()).toBe(0);

    bs.set(10);
    expect(bs.size()).toBe(11);
    expect(bs.count()).toBe(1);

    bs.reset(10);
    expect(bs.size()).toBe(11);
    expect(bs.count()).toBe(0);

    bs.reset(20);
    expect(bs.size()).toBe(21);
    expect(bs.count()).toBe(0);
  });

  it('IteratingSetBits', () => {
    const bs = new BASE_SET(10);
    bs.set(2);
    bs.set(4);

    const it = bs.setBits();
    expect(it.next().value).toBe(2);
    expect(it.next().value).toBe(4);
    expect(it.next().done).toBe(true);

    // Custom reverse iterator test
    const reverse_set_bits = [...bs.setBitsReverse()];

    expect(reverse_set_bits.length).toBe(2);
    expect(reverse_set_bits[0]).toBe(4);
    expect(reverse_set_bits[1]).toBe(2);
  });

  // Test equality operator
  it('BASE_SETEqualityOperator', () => {
    const set1 = new BASE_SET(10);
    const set2 = new BASE_SET(10);
    const set3 = new BASE_SET(15);

    set1.set(2);
    set1.set(4);

    set2.set(2);
    set2.set(4);

    set3.set(2);

    expect(set1.equals(set2)).toBe(true);
    expect(set1.equals(set3)).toBe(false);
    expect(set2.equals(set3)).toBe(false);
  });

  // Test less-than operator
  it('BASE_SETComparisonOperator', () => {
    const set1 = new BASE_SET(10);
    const set2 = new BASE_SET(10);
    const set3 = new BASE_SET(15);

    set1.set(2);
    set1.set(5);

    set2.set(2);

    set3.set(2);

    expect(set3.lt(set1)).toBe(true); // Although set3 is larger, set1 has a 1 at position 5, so set3 is less
    expect(set2.lt(set3)).toBe(true); // set2 and set3 both have the same values set but set3 has more positions available
    expect(set1.lt(set3)).toBe(false);
    expect(set1.lt(set2)).toBe(false); // Although sizes are equal, elements in set2 are subsets of set1
  });

  // Test compare function
  it('BASE_SETCompareFunction', () => {
    const set1 = new BASE_SET(10);
    const set2 = new BASE_SET(10);
    const set3 = new BASE_SET(10);
    const set4 = new BASE_SET(15);

    set1.set(2);
    set1.set(4);

    set2.set(2);
    set2.set(4);

    set3.set(2);

    set4.set(2);

    expect(set1.compare(set2)).toBe(0); // set1 and set2 are equal
    expect(set1.compare(set3)).toBe(1); // set1 is greater than set3
    expect(set3.compare(set1)).toBe(-1); // set3 is less than set1
    expect(set3.compare(set4)).toBe(-1); // set3 is less than set4
    expect(set4.compare(set3)).toBe(1); // set4 is greater than set3
  });

  // Test boolean operator&=
  it('BASE_SETAndAssignment', () => {
    const bs1 = new BASE_SET(10);
    const bs2 = new BASE_SET(10);
    bs1.set(1);
    bs1.set(3);
    bs2.set(2);
    bs2.set(3);

    bs1.andAssign(bs2);
    expect(bs1.test(1)).toBe(false);
    expect(bs1.test(2)).toBe(false);
    expect(bs1.test(3)).toBe(true);
  });

  // Test boolean operator|=
  it('BASE_SETOrAssignment', () => {
    const bs1 = new BASE_SET(10);
    const bs2 = new BASE_SET(10);
    bs1.set(1);
    bs2.set(2);
    bs2.set(3);

    bs1.orAssign(bs2);
    expect(bs1.test(1)).toBe(true);
    expect(bs1.test(2)).toBe(true);
    expect(bs1.test(3)).toBe(true);
  });

  // Test boolean operator^=
  it('BASE_SETXorAssignment', () => {
    const bs1 = new BASE_SET(10);
    const bs2 = new BASE_SET(10);
    bs1.set(1);
    bs1.set(3);
    bs2.set(2);
    bs2.set(3);

    bs1.xorAssign(bs2);
    expect(bs1.test(1)).toBe(true);
    expect(bs1.test(2)).toBe(true);
    expect(bs1.test(3)).toBe(false);
  });

  // Test boolean operator~
  it('BASE_SETNotOperator', () => {
    const bs1 = new BASE_SET(4);
    bs1.set(1);
    bs1.set(3);

    const bs2 = bs1.not();
    expect(bs2.test(0)).toBe(true);
    expect(bs2.test(1)).toBe(false);
    expect(bs2.test(2)).toBe(true);
    expect(bs2.test(3)).toBe(false);
  });

  // Test non-member operator&
  it('BASE_SETAndOperator', () => {
    const bs1 = new BASE_SET(10);
    const bs2 = new BASE_SET(10);
    bs1.set(1);
    bs1.set(3);
    bs2.set(2);
    bs2.set(3);

    const result = bs1.and(bs2);
    expect(result.test(1)).toBe(false);
    expect(result.test(2)).toBe(false);
    expect(result.test(3)).toBe(true);
  });

  // Test non-member operator|
  it('BASE_SETOrOperator', () => {
    const bs1 = new BASE_SET(10);
    const bs2 = new BASE_SET(10);
    bs1.set(1);
    bs2.set(2);
    bs2.set(3);

    const result = bs1.or(bs2);
    expect(result.test(1)).toBe(true);
    expect(result.test(2)).toBe(true);
    expect(result.test(3)).toBe(true);
  });

  // Test non-member operator^
  it('BASE_SETXorOperator', () => {
    const bs1 = new BASE_SET(10);
    const bs2 = new BASE_SET(10);
    bs1.set(1);
    bs1.set(3);
    bs2.set(2);
    bs2.set(3);

    const result = bs1.xor(bs2);
    expect(result.test(1)).toBe(true);
    expect(result.test(2)).toBe(true);
    expect(result.test(3)).toBe(false);
  });
});
