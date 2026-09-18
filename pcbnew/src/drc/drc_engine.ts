// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/drc/drc_engine.h` + `drc_engine.cpp`: the rule engine on the live
 * BOARD (#636 stage 4). This module holds the class; the rule loading,
 * compilation and evaluation land in stage 4c. The view-based engine the
 * dialog still runs is `drc_engine_view.ts`.
 */
import type { BOARD } from '../board.js';
import type { NETINFO_ITEM } from '../netinfo.js';

/** The three out-parameters of `DRC_ENGINE::MatchDpSuffix`, plus its return. */
export interface DP_SUFFIX_MATCH {
  /** The C++ return value: 1 for P/+, -1 for N/-, 0 for no match. */
  polarity: number;
  /** `aComplementNet` */
  complementNet: string;
  /** `aBaseDpName` */
  baseDpName: string;
}

export class DRC_ENGINE {
  /**
   * Check if the given net is a diff pair, returning its polarity and complement if so.
   *
   * @param aNetName is the input net name, like DIFF_P
   * @param aComplementNet will be filled with the complement, like DIFF_N
   * @param aBaseDpName will be filled with the base name, like DIFF
   * @return 1 if the net is the P side of a pair, -1 if the N side, 0 if not a diff pair
   */
  static MatchDpSuffix(aNetName: string): DP_SUFFIX_MATCH {
    let rv = 0;
    let count = 0;
    let aComplementNet = '';
    let aBaseDpName = '';

    for (let i = aNetName.length - 1; i >= 0 && rv === 0; --i, ++count) {
      const ch = aNetName[i]!;

      if ((ch >= '0' && ch <= '9') || ch === '_') {
      } else if (ch === '+') {
        aComplementNet = '-';
        rv = 1;
      } else if (ch === '-') {
        aComplementNet = '+';
        rv = -1;
      } else if (ch === 'N') {
        aComplementNet = 'P';
        rv = -1;
      } else if (ch === 'P') {
        aComplementNet = 'N';
        rv = 1;
      } else {
        break;
      }
    }

    if (rv !== 0 && count >= 1) {
      aBaseDpName = aNetName.slice(0, aNetName.length - count);
      aComplementNet = aBaseDpName + aComplementNet + aNetName.slice(aNetName.length - (count - 1));
    }

    return { polarity: rv, complementNet: aComplementNet, baseDpName: aBaseDpName };
  }

  /** `IsNetADiffPair( aBoard, aNet, aNetP, aNetN )`: the two out-params, or null for `false`. */
  static IsNetADiffPair(aBoard: BOARD, aNet: NETINFO_ITEM): { netP: number; netN: number } | null {
    const refName = aNet.GetNetname();
    const match = DRC_ENGINE.MatchDpSuffix(refName);
    const polarity = match.polarity;

    if (polarity) {
      const coupledNetName = match.complementNet;
      const net = aBoard.FindNet(coupledNetName);

      if (!net) return null;

      if (polarity > 0) {
        return { netP: aNet.GetNetCode(), netN: net.GetNetCode() };
      } else {
        return { netP: net.GetNetCode(), netN: aNet.GetNetCode() };
      }
    }

    return null;
  }
}
