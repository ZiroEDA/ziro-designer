// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `BOARD_LISTENER` (pcbnew/board.h:284): the observer a BOARD notifies of its
 * changes. Every method has an empty default, so a listener overrides the
 * ones it cares about — the editor's React state is one such listener.
 */
import type { BOARD } from './board.js';
import type { BOARD_ITEM } from './board_item.js';

export class BOARD_LISTENER {
  OnBoardItemAdded(_aBoard: BOARD, _aBoardItem: BOARD_ITEM): void {}
  OnBoardItemsAdded(_aBoard: BOARD, _aBoardItems: BOARD_ITEM[]): void {}
  OnBoardItemRemoved(_aBoard: BOARD, _aBoardItem: BOARD_ITEM): void {}
  OnBoardItemsRemoved(_aBoard: BOARD, _aBoardItems: BOARD_ITEM[]): void {}
  OnBoardNetSettingsChanged(_aBoard: BOARD): void {}
  OnBoardItemChanged(_aBoard: BOARD, _aBoardItem: BOARD_ITEM): void {}
  OnBoardItemsChanged(_aBoard: BOARD, _aBoardItems: BOARD_ITEM[]): void {}
  OnBoardHighlightNetChanged(_aBoard: BOARD): void {}
  OnBoardRatsnestChanged(_aBoard: BOARD): void {}
  OnBoardCompositeUpdate(
    _aBoard: BOARD,
    _aAddedItems: BOARD_ITEM[],
    _aRemovedItems: BOARD_ITEM[],
    _aChangedItems: BOARD_ITEM[],
  ): void {}
}

/**
 * `HIGH_LIGHT_INFO` (board.h:256): the nets a board is highlighting.
 */
export class HIGH_LIGHT_INFO {
  m_netCodes = new Set<number>(); // net(s) selected for highlight (-1 when no net selected )
  m_highLightOn = false; // highlight active

  Clear(): void {
    this.m_netCodes.clear();
    this.m_highLightOn = false;
  }
}
