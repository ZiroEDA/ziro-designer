// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/array_pad_number_provider.h` + `.cpp` (`ARRAY_PAD_NUMBER_PROVIDER`).
 *
 * Hands out pad numbers for the copies the Array tool makes, sequentially from
 * the array options, skipping any number the footprint already uses. Without
 * it an arrayed pad keeps the original's number and the footprint ends up with
 * several pad 1s.
 *
 * The skip set is conditional, and that is the whole subtlety: when the user
 * has said where numbering starts, the existing numbers are *not* consulted —
 * the sequence runs from the stated point even if it collides, because the
 * user asked for that. Only when the start is left open does the provider step
 * over what is already there.
 */
import {
  type ArrayCircularOptions,
  type ArrayGridOptions,
  circularItemNumber,
  gridItemNumber,
  numberingStartIsSpecified,
} from '@ziroeda/common/array_options.js';

/** `const ARRAY_OPTIONS&`: the two kinds, tagged as `create_array.ts` tags them. */
export type ArrayNumberingSpec =
  | { kind: 'grid'; options: ArrayGridOptions }
  | { kind: 'circular'; options: ArrayCircularOptions };

/** `ARRAY_OPTIONS::GetItemNumber( n )`, dispatched on the array kind. */
function itemNumber(aSpec: ArrayNumberingSpec, n: number): string {
  return aSpec.kind === 'grid'
    ? gridItemNumber(aSpec.options, n)
    : circularItemNumber(aSpec.options, n);
}

/**
 * Sequentially provides numbers from an array options object, making sure that
 * they do not conflict with numbers already existing in a footprint.
 */
export class ARRAY_PAD_NUMBER_PROVIDER {
  private readonly m_arrayOpts: ArrayNumberingSpec;
  private m_existing_pad_numbers: ReadonlySet<string>;
  /** Start by numbering the first new item. */
  private m_current_pad_index = 0;

  /**
   * @param aExistingPadNumbers the numbers to gather from the footprint (empty for no footprint)
   * @param aArrayOpts the array options that provide the candidate numbers
   */
  constructor(aExistingPadNumbers: ReadonlySet<string>, aArrayOpts: ArrayNumberingSpec) {
    this.m_arrayOpts = aArrayOpts;

    // construct the set of existing pad numbers
    if (numberingStartIsSpecified(aArrayOpts.options)) {
      // if we start from a specified point, we don't look at existing
      // names, so it's just an empty "reserved" set
      this.m_existing_pad_numbers = new Set<string>();
    } else {
      this.m_existing_pad_numbers = aExistingPadNumbers;
    }
  }

  /** Get the next available pad name. */
  GetNextPadNumber(): string {
    return this.getNextNumber(this.m_existing_pad_numbers);
  }

  /**
   * Get the next number from the current index, skipping `aExisting`.
   *
   * The C++ takes the index by reference so it advances in the caller; the
   * field is the caller here, so it is advanced directly.
   */
  private getNextNumber(aExisting: ReadonlySet<string>): string {
    let next_number: string;

    do {
      next_number = itemNumber(this.m_arrayOpts, this.m_current_pad_index);
      this.m_current_pad_index++;
    } while (aExisting.has(next_number));

    return next_number;
  }
}
