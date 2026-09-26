// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/board_item_container.h`: `BOARD_ITEM_CONTAINER`, the abstract
 * interface for BOARD_ITEMs capable of storing other items inside.
 * @see FOOTPRINT
 * @see BOARD
 */

import type { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { BOARD_ITEM } from './board_item.js';

export enum ADD_MODE {
  INSERT = 0,
  APPEND = 1,
  BULK_APPEND = 2,
  BULK_INSERT = 3,
}

export enum REMOVE_MODE {
  NORMAL = 0,
  BULK = 1,
}

export abstract class BOARD_ITEM_CONTAINER extends BOARD_ITEM {
  constructor(aParent: BOARD_ITEM | null, aType: KICAD_T) {
    super(aParent, aType);
  }

  /**
   * @brief Adds an item to the container.
   * @param aMode decides whether the item is added in the beginning or at the end of the list.
   * @param aSkipConnectivity skip connectivity update (useful for file loading, when
   * the connectivity is updated after end of loading).
   */
  abstract Add(aItem: BOARD_ITEM, aMode?: ADD_MODE, aSkipConnectivity?: boolean): void;

  /**
   * @brief Removes an item from the container.
   */
  abstract Remove(aItem: BOARD_ITEM, aMode?: REMOVE_MODE): void;

  /**
   * @brief Removes an item from the container and deletes it.
   */
  Delete(aItem: BOARD_ITEM): void {
    this.Remove(aItem);
    // delete aItem;
  }
}
