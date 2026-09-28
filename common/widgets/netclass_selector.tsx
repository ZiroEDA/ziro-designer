// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `NETCLASS_SELECTOR` (`include/widgets/netclass_selector.h`,
 * `common/widgets/netclass_selector.cpp`): a `FILTER_COMBOBOX` over the
 * board's netclass names.
 *
 * Its popup's `getListContent` lists every netclass, sorted, and does **not**
 * consult the filter text: typing in the popup's filter box changes nothing.
 * That is upstream's behaviour and is kept. Upstream reads the names from
 * `m_board->GetDesignSettings().m_NetSettings->GetNetclasses()`; the caller
 * passes them.
 */

import type { JSX } from 'react';
import { FilterComboCtrl, type FilterComboCtrlProps, sortStringList } from './filter_combobox.js';

/** `NETCLASS_SELECTOR_POPUP::getListContent`: the names, sorted, unfiltered. */
export function netclassSelectorListContent(aNetclasses: readonly string[]): string[] {
  return sortStringList(aNetclasses);
}

export interface NetclassSelectorProps
  extends Omit<FilterComboCtrlProps, 'value' | 'getListContent' | 'onAccept'> {
  /** `SetBoard( aBoard )`: the board's netclass names. */
  netclasses: readonly string[];
  /** `GetSelectedNetclass()`. */
  value: string;
  /** `FILTERED_ITEM_SELECTED`. */
  onChange: (aNetclass: string) => void;
}

export function NetclassSelector({
  netclasses,
  value,
  onChange,
  ...rest
}: NetclassSelectorProps): JSX.Element {
  return (
    <FilterComboCtrl
      {...rest}
      value={value}
      getListContent={() => netclassSelectorListContent(netclasses)}
      onAccept={(selectedString) => {
        // FILTER_COMBOPOPUP::Accept: no update on empty, nor on no change.
        if (selectedString !== '' && selectedString !== value) onChange(selectedString);
      }}
    />
  );
}
