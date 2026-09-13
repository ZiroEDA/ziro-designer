// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The enums and the `LAYER` struct of `pcbnew/board.h` that `BOARD_ITEM`
 * reads. They are declared beside `BOARD` in C++; here they are a leaf module
 * so `board_item.ts` can use them without importing `board.ts`, which
 * extends it. `board.ts` re-exports them.
 */

/**
 * The allowed types of layers, same as Specctra DSN spec.
 */
export enum LAYER_T {
  LT_UNDEFINED = -1,
  LT_SIGNAL = 0,
  LT_POWER = 1,
  LT_MIXED = 2,
  LT_JUMPER = 3,
  LT_AUX = 4,
  LT_FRONT = 5,
  LT_BACK = 6,
}

export const { LT_UNDEFINED, LT_SIGNAL, LT_POWER, LT_MIXED, LT_JUMPER, LT_AUX, LT_FRONT, LT_BACK } =
  LAYER_T;

/**
 * Container to hold information pertinent to a layer of a BOARD.
 */
export class LAYER {
  m_name!: string; ///< The canonical name of the layer. @see #LSET::Name
  m_userName!: string; ///< The user defined name of the layer.
  m_type!: LAYER_T; ///< The type of the layer. @see #LAYER_T
  m_visible!: boolean;
  m_number!: number; ///< The layer ID. @see PCB_LAYER_ID
  m_opposite!: number; ///< Similar layer on opposite side of the board, if any.

  constructor() {
    this.clear();
  }

  /** The compiler-generated copy (`m_layers[aIndex] = aLayer`). */
  static copyOf(aOther: LAYER): LAYER {
    const l = new LAYER();
    l.m_name = aOther.m_name;
    l.m_userName = aOther.m_userName;
    l.m_type = aOther.m_type;
    l.m_visible = aOther.m_visible;
    l.m_number = aOther.m_number;
    l.m_opposite = aOther.m_opposite;
    return l;
  }

  clear(): void {
    this.m_type = LAYER_T.LT_SIGNAL;
    this.m_visible = true;
    this.m_number = 0;
    this.m_name = '';
    this.m_userName = '';
    this.m_opposite = this.m_number;
  }

  /**
   * Convert a #LAYER_T enum to a string representation of the layer type.
   *
   * @param aType The #LAYER_T to convert
   * @return The string representation of the layer type.
   */
  static ShowType(aType: LAYER_T): string {
    switch (aType) {
      default:
      case LAYER_T.LT_SIGNAL:
        return 'signal';
      case LAYER_T.LT_POWER:
        return 'power';
      case LAYER_T.LT_MIXED:
        return 'mixed';
      case LAYER_T.LT_JUMPER:
        return 'jumper';
      case LAYER_T.LT_AUX:
        return 'auxiliary';
      case LAYER_T.LT_FRONT:
        return 'front';
      case LAYER_T.LT_BACK:
        return 'back';
    }
  }

  /**
   * Convert a string to a #LAYER_T
   *
   * @param aType The layer name to convert.
   * @return The binary representation of the layer type or LT_UNDEFINED if not found.
   */
  static ParseType(aType: string): LAYER_T {
    if (aType === 'signal') return LAYER_T.LT_SIGNAL;
    else if (aType === 'power') return LAYER_T.LT_POWER;
    else if (aType === 'mixed') return LAYER_T.LT_MIXED;
    else if (aType === 'jumper') return LAYER_T.LT_JUMPER;
    else if (aType === 'auxiliary') return LAYER_T.LT_AUX;
    else if (aType === 'front') return LAYER_T.LT_FRONT;
    else if (aType === 'back') return LAYER_T.LT_BACK;
    else return LAYER_T.LT_UNDEFINED;
  }
}

/**
 * Flags to specify how the board is being used.
 */
export enum BOARD_USE {
  NORMAL = 0, // A normal board
  FPHOLDER = 1, // A board that holds a single footprint
}
