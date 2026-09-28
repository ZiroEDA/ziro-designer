// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `NET_SELECTOR` and `NET_SELECTOR_COMBOPOPUP` (`include/widgets/net_selector.h`,
 * `common/widgets/net_selector.cpp`): a `FILTER_COMBOBOX` over a board's nets,
 * with `<no net>` at the top, the indeterminate label (a multi-selection whose
 * nets differ) at the bottom, and `<create net>: <filter>` when the filter
 * names a net the board lacks.
 *
 * Upstream it reads a `NETINFO_LIST*`, which common cannot see here; the caller
 * passes the same thing as a netcode -> (escaped) netname map, and adding the
 * net `<create net>` asks for is the caller's `onCreateNet`, because that is a
 * board edit (`board->Add( newnet )`). Without `onCreateNet` the row is not
 * offered.
 */

import type { JSX } from 'react';
import { strNumCmp, unescapeString, wildCompareString } from '../string_utils.js';
import { FilterComboCtrl, type FilterComboCtrlProps } from './filter_combobox.js';

export const NO_NET = '<no net>';
export const CREATE_NET = '<create net>';

/** What `NET_SELECTOR` reads of a `NETINFO_LIST`: netcode -> escaped netname. */
export type NetInfoList = ReadonlyMap<number, string>;

/**
 * `NET_SELECTOR_COMBOPOPUP::getListContent`, and the `m_unescapedNetNameMap`
 * it rebuilds on the way (shown name -> escaped name).
 */
export function netSelectorListContent(
  aNetinfoList: NetInfoList,
  aFilter: string,
  aIndeterminateLabel: string,
  aCanCreate: boolean,
): { names: string[]; unescaped: Map<string, string> } {
  const netstring = aFilter;
  let filter = netstring.toLowerCase();
  const unescaped = new Map<string, string>();
  const names: string[] = [];

  if (filter !== '') filter = `*${filter}*`;

  for (const [netcode, netname] of aNetinfoList) {
    if (netcode > 0) {
      const shown = unescapeString(netname);

      if (filter === '' || wildCompareString(filter, shown.toLowerCase(), true)) {
        names.push(shown);
        unescaped.set(shown, netname);
      }
    }
  }

  names.sort((lhs, rhs) => strNumCmp(lhs, rhs, true /* ignore case */));

  // Special handling for <no net>
  if (filter === '' || wildCompareString(filter, NO_NET.toLowerCase(), true)) names.unshift(NO_NET);

  if (aCanCreate && filter !== '' && ![...aNetinfoList.values()].includes(netstring))
    names.push(`${CREATE_NET}: ${netstring}`);

  if (aIndeterminateLabel !== '') names.push(aIndeterminateLabel);

  return { names, unescaped };
}

/**
 * `NET_SELECTOR_COMBOPOPUP::GetStringValue`, unescaped as `SetSelectedNetcode`
 * shows it: the indeterminate label for -1, `<no net>` for 0 or an unknown code.
 */
export function netSelectorValue(
  aNetinfoList: NetInfoList,
  aNetcode: number,
  aIndeterminateLabel: string,
): string {
  if (aNetcode === -1) return aIndeterminateLabel;

  const netname = aNetinfoList.get(aNetcode);

  if (aNetcode > 0 && netname !== undefined) return unescapeString(netname);

  return NO_NET;
}

export interface NetSelectorProps
  extends Omit<FilterComboCtrlProps, 'value' | 'getListContent' | 'onAccept'> {
  /** `SetNetInfo( aNetInfoList )`. */
  netInfo: NetInfoList;
  /** `GetSelectedNetcode()`; -1 is indeterminate. */
  netcode: number;
  /** `SetIndeterminateString`; '' disallows indeterminate settings. */
  indeterminateString?: string;
  /** `FILTERED_ITEM_SELECTED`, with the new `GetSelectedNetcode()`. */
  onChange: (aNetcode: number) => void;
  /**
   * `board->Add( new NETINFO_ITEM( board, aName, 0 ) )`: add the net and
   * return its netcode, or 0 when it could not be added.
   */
  onCreateNet?: (aName: string) => number;
}

export function NetSelector({
  netInfo,
  netcode,
  indeterminateString = '',
  onChange,
  onCreateNet,
  ...rest
}: NetSelectorProps): JSX.Element {
  let unescapedNetNameMap = new Map<string, string>();

  return (
    <FilterComboCtrl
      {...rest}
      value={netSelectorValue(netInfo, netcode, indeterminateString)}
      getListContent={(aFilter) => {
        const content = netSelectorListContent(
          netInfo,
          aFilter,
          indeterminateString,
          onCreateNet !== undefined,
        );
        unescapedNetNameMap = content.unescaped;
        return content.names;
      }}
      onAccept={(selectedNetName) => {
        // NET_SELECTOR_COMBOPOPUP::Accept
        const escapedNetName = unescapedNetNameMap.get(selectedNetName) ?? selectedNetName;
        const createPrefix = `${CREATE_NET}:`;

        if (escapedNetName === '' || escapedNetName === indeterminateString) {
          onChange(-1);
        } else if (escapedNetName === NO_NET) {
          onChange(0);
        } else if (onCreateNet && escapedNetName.startsWith(createPrefix)) {
          // Remove the first character ':' and all whitespace
          const remainingName = escapedNetName.slice(createPrefix.length).trim();
          if (remainingName === '') return;

          const newcode = onCreateNet(remainingName);
          if (newcode > 0) onChange(newcode);
        } else {
          let code = 0;
          for (const [c, name] of netInfo) {
            if (name === escapedNetName) code = c;
          }
          onChange(code);
        }
      }}
    />
  );
}
