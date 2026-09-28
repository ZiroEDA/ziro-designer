// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `ARRAY_PAD_NUMBER_PROVIDER` (`pcbnew/array_pad_number_provider.cpp`): the
 * numbers the Array tool gives the pads it copies.
 */
import { describe, expect, it } from 'vitest';
import { ARRAY_PAD_NUMBER_PROVIDER } from '@ziroeda/pcbnew/array_pad_number_provider.js';
import { ARRAY_AXIS } from '@ziroeda/common/array_axis.js';
import { ARRAY_GRID_OPTIONS } from '@ziroeda/common/array_options.js';

/** A 3x3 grid numbered 1,2,3,... from the primary axis. */
const grid = (extra: { shouldNumber?: boolean; numberingStartIsSpecified?: boolean } = {}) => {
  const o = new ARRAY_GRID_OPTIONS();
  o.m_nx = 3;
  o.m_ny = 3;
  o.m_delta = { x: 1000, y: 1000 };
  o.m_pri_axis.SetAxisType(ARRAY_AXIS.NUMBERING_TYPE.NUMBERING_NUMERIC);
  o.m_pri_axis.SetOffset(1);
  o.m_pri_axis.SetStep(1);
  if (extra.shouldNumber) o.SetShouldNumber(true);
  if (extra.numberingStartIsSpecified) o.SetNumberingStartIsSpecified(true);
  return o;
};

const take = (p: ARRAY_PAD_NUMBER_PROVIDER, n: number): string[] =>
  Array.from({ length: n }, () => p.GetNextPadNumber());

describe('ARRAY_PAD_NUMBER_PROVIDER', () => {
  it('runs the sequence from the start when nothing is taken', () => {
    const p = new ARRAY_PAD_NUMBER_PROVIDER(new Set(), grid());
    expect(take(p, 4)).toEqual(['1', '2', '3', '4']);
  });

  it('steps over numbers the footprint already uses', () => {
    const p = new ARRAY_PAD_NUMBER_PROVIDER(new Set(['2', '3']), grid());
    // 2 and 3 are taken, so the second number issued is 4.
    expect(take(p, 3)).toEqual(['1', '4', '5']);
  });

  it('consults the existing numbers only when the start is NOT specified', () => {
    // Both flags set: the user has said where numbering begins, so a collision
    // with an existing pad is their business and the set is ignored.
    const specified = new ARRAY_PAD_NUMBER_PROVIDER(
      new Set(['1', '2']),
      grid({ shouldNumber: true, numberingStartIsSpecified: true }),
    );
    expect(take(specified, 2)).toEqual(['1', '2']);

    // numberingStartIsSpecified alone is not enough -- GetNumberingStartIsSpecified()
    // is `m_shouldNumber && m_numberingStartIsSpecified`, so this one still skips.
    const halfSet = new ARRAY_PAD_NUMBER_PROVIDER(
      new Set(['1', '2']),
      grid({ numberingStartIsSpecified: true }),
    );
    expect(take(halfSet, 1)).toEqual(['3']);
  });
});
