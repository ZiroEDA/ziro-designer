// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Net Inspector's rows.
 * Counterpart: `PCB_NET_INSPECTOR_PANEL` (pcb_net_inspector_panel.cpp) and its
 * data model's LIST_ITEM (pcb_net_inspector_panel_data_model.h).
 *
 * The rows are upstream's: `buildNetsList` filters the board's NETINFO_LIST
 * with `netFilterMatches`, and `calculateNets` measures each net through the
 * board's LENGTH_DELAY_CALCULATION over its connectivity items, so every count
 * and length is the one KiCad shows for the same board.
 */
import { unescapeString, valueStringCompare } from '@ziroeda/common/string_utils.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { BOARD } from '../board.js';
import type { BOARD_CONNECTED_ITEM } from '../board_connected_item.js';
import {
  LENGTH_DELAY_DOMAIN_OPT,
  LENGTH_DELAY_LAYER_OPT,
  type PATH_OPTIMISATIONS,
} from '../length_delay_calculation/length_delay_calculation.js';
import type { LENGTH_DELAY_CALCULATION_ITEM } from '../length_delay_calculation/length_delay_calculation_item.js';
import type { NETINFO_ITEM } from '../netinfo_item.js';

/** One LIST_ITEM built from a net. */
export interface NetRow {
  net: number;
  /** `m_net_name`: `UnescapeString( aNet->GetNetname() )`. */
  name: string;
  /** `m_net_class`: `UnescapeString( aNet->GetNetClass()->GetHumanReadableName() )`. */
  netclass: string;
  padCount: number;
  viaCount: number;
  viaLength: number;
  /** `GetBoardWireLength()`: the per-layer wire lengths summed. */
  boardLength: number;
  padDieLength: number;
  /** `GetTotalLength()`: board wire + via + pad-to-die. */
  totalLength: number;
}

/** The PANEL_NET_INSPECTOR_SETTINGS the rows depend on (project_local_settings.cpp:218-236). */
export interface NetInspectorFilter {
  filterText: string;
  filterByNetName: boolean;
  filterByNetclass: boolean;
  showZeroPadNets: boolean;
  showUnconnectedNets: boolean;
}

export const DEFAULT_NET_INSPECTOR_FILTER: NetInspectorFilter = {
  filterText: '',
  filterByNetName: true,
  filterByNetclass: true,
  showZeroPadNets: false,
  showUnconnectedNets: false,
};

/** `PCB_NET_INSPECTOR_PANEL::netFilterMatches` (pcb_net_inspector_panel.cpp:591-631). */
export function netFilterMatches(aNet: NETINFO_ITEM, aCfg: NetInspectorFilter): boolean {
  // Never show an unconnected net
  if (aNet.GetNetCode() <= 0) return false;

  const filterString = unescapeString(aCfg.filterText).toUpperCase();
  const netName = unescapeString(aNet.GetNetname()).toUpperCase();
  const netClassName = unescapeString(aNet.GetNetClass().GetName()).toUpperCase();

  let matched = false;

  // No filter - match all
  if (filterString.length === 0) matched = true;

  // Search on net class
  if (!matched && aCfg.filterByNetclass && netClassName.includes(filterString)) matched = true;

  // Search on net name
  if (!matched && aCfg.filterByNetName && netName.includes(filterString)) matched = true;

  // Remove unconnected nets if required
  if (matched) {
    if (!aCfg.showUnconnectedNets) matched = !netName.startsWith('UNCONNECTED-(');
  }

  return matched;
}

/**
 * `relevantConnectivityItems` (:644-666): the valid tracks, arcs, vias and pads
 * of the connectivity, by net code.
 */
function relevantConnectivityItems(aBoard: BOARD): BOARD_CONNECTED_ITEM[] {
  const types = new Set([
    KICAD_T.PCB_TRACE_T,
    KICAD_T.PCB_ARC_T,
    KICAD_T.PCB_VIA_T,
    KICAD_T.PCB_PAD_T,
  ]);
  const items: { net: number; parent: BOARD_CONNECTED_ITEM }[] = [];

  for (const cnItem of aBoard.GetConnectivity().GetConnectivityAlgo().ItemList()) {
    if (cnItem.Valid() && types.has(cnItem.Parent().Type()))
      items.push({ net: cnItem.Net(), parent: cnItem.Parent() });
  }

  // std::ranges::sort is not stable; within one net the order does not reach
  // a result, since the length calculation re-orders by position.
  items.sort((a, b) => a.net - b.net);

  return items.map((i) => i.parent);
}

/** `calculateNets` (:668-760) over nets sorted by code. */
function calculateNets(
  aBoard: BOARD,
  aNets: readonly NETINFO_ITEM[],
  aIncludeZeroPadNets: boolean,
): NetRow[] {
  const calc = aBoard.GetLengthCalculation();
  const wanted = new Set(aNets.map((n) => n.GetNetCode()));
  const netItemsMap = new Map<number, LENGTH_DELAY_CALCULATION_ITEM[]>();

  for (const item of relevantConnectivityItems(aBoard)) {
    const code = item.GetNetCode();

    if (!wanted.has(code)) continue;

    let list = netItemsMap.get(code);

    if (!list) {
      list = [];
      netItemsMap.set(code, list);
    }

    list.push(calc.GetLengthCalculationItem(item));
  }

  const opts: PATH_OPTIMISATIONS = {
    OptimiseVias: true,
    MergeTracks: true,
    OptimiseTracesInPads: true,
    InferViaInPad: false,
  };

  const results: NetRow[] = [];

  // foundNets: only a net with at least one connectivity item is measured.
  for (const net of aNets) {
    const items = netItemsMap.get(net.GetNetCode());

    if (!items) continue;

    const lengthDetails = calc.CalculateLengthDetails(
      items,
      opts,
      null,
      null,
      LENGTH_DELAY_LAYER_OPT.WITH_LAYER_DETAIL,
      LENGTH_DELAY_DOMAIN_OPT.NO_DELAY_DETAIL,
    );

    if (aIncludeZeroPadNets || lengthDetails.NumPads > 0) {
      let boardLength = 0;

      for (const length of lengthDetails.LayerLengths?.values() ?? []) boardLength += length;

      results.push({
        net: net.GetNetCode(),
        name: unescapeString(net.GetNetname()),
        netclass: unescapeString(net.GetNetClass().GetHumanReadableName()),
        padCount: lengthDetails.NumPads,
        viaCount: lengthDetails.NumVias,
        viaLength: lengthDetails.ViaLength,
        boardLength,
        padDieLength: lengthDetails.PadToDieLength,
        totalLength: boardLength + lengthDetails.ViaLength + lengthDetails.PadToDieLength,
      });
    }
  }

  return results;
}

/**
 * `buildNetsList`'s rows (:513-536), in the order the list opens:
 * `restoreSortColumn( COLUMN_NAME, true )`, the data model's `Compare` on the
 * name column (`ValueStringCompare`).
 */
export function netInspectorRows(
  aBoard: BOARD,
  aCfg: NetInspectorFilter = DEFAULT_NET_INSPECTOR_FILTER,
): NetRow[] {
  const nets: NETINFO_ITEM[] = [];

  for (const ni of aBoard.GetNetInfo()) {
    if (netFilterMatches(ni, aCfg)) nets.push(ni);
  }

  nets.sort((a, b) => a.GetNetCode() - b.GetNetCode());

  // "when the item values compare equal resort to pointer comparison": net
  // code stands in for the pointer.
  return calculateNets(aBoard, nets, aCfg.showZeroPadNets).sort(
    (a, b) => valueStringCompare(a.name, b.name) || a.net - b.net,
  );
}
