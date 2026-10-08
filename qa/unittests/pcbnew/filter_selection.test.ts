// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Filter Selection.
 * Counterparts: `itemIsIncludedByFilter` / `PCB_SELECTION_TOOL::filterSelection`
 * and `DIALOG_FILTER_SELECTION::GetSuggestedAllItemsState`.
 *
 * The filter is inclusive, not exclusive: a kind the dialog does not offer is
 * *dropped*, not kept. Upstream says so on the default branch, and it is what
 * makes the dialog mean "keep only what I ticked".
 */
import { describe, expect, it } from 'vitest';
import {
  allItemsState,
  DEFAULT_SELECTION_FILTER,
  setAllFilterItems,
  type SelectionFilter,
} from '@ziroeda/pcbnew/dialogs/dialog_filter_selection.js';

/** Nothing ticked but the boxes named. */
const _only = (over: Partial<SelectionFilter>): SelectionFilter => ({
  ...setAllFilterItems(false),
  ...over,
});

describe('the All items tri-state', () => {
  it('is checked only when every box is ticked', () => {
    expect(allItemsState(setAllFilterItems(true))).toBe('checked');
  });

  it('is unchecked when none is', () => {
    expect(allItemsState(setAllFilterItems(false))).toBe('unchecked');
  });

  it('reads mixed for the dialog’s own default', () => {
    // Locked footprints off, everything else on: seven of eight. Worth
    // knowing rather than "fixing" — it is what upstream shows on open.
    expect(allItemsState(DEFAULT_SELECTION_FILTER)).toBe('mixed');
  });

  it('does not count the locked box while footprints is off', () => {
    // Everything ticked but the footprints pair: six of eight, so mixed.
    const noFootprints = { ...setAllFilterItems(true), footprints: false, lockedFootprints: false };
    expect(allItemsState(noFootprints)).toBe('mixed');

    // And a lone locked-footprints tick counts for nothing, since its parent
    // is off: unchecked, not mixed.
    expect(allItemsState({ ...setAllFilterItems(false), lockedFootprints: true })).toBe(
      'unchecked',
    );
  });
});
