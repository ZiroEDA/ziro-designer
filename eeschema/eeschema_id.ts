// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/eeschema_id.h`: the schematic editor's own command ids, after common/id.ts's.
 */
import { main_id } from '@ziroeda/common/id.js';

/**
 * The maximum number of units per package.
 * While counts approaching 100 start to make the unit-selection popup menu
 * difficult to use, the limit is currently 'ZZ' (26 * 26).
 */
export const MAX_UNIT_COUNT_PER_PACKAGE = 676;

/** Purely arbitrary limit. */
export const MAX_BODY_STYLE_PER_PACKAGE = 100;

export const MAX_ALT_PIN_FUNCTION_ITEMS = 1024;

/**
 * While it would seem that an unfold-from-bus menu with over 100 items would be
 * hard to deal with, we've already had one user who wants 256.
 */
export const MAX_BUS_UNFOLD_MENU_ITEMS = 1024;

const ID_END_LIST = main_id.ID_END_LIST;
const ID_POPUP_MENU_START = main_id.ID_POPUP_MENU_START;

/** `enum id_eeschema_frm`: command IDs for the schematic editor. */
export enum id_eeschema_frm {
  /* Library editor horizontal toolbar IDs. */
  ID_LIBEDIT_SELECT_UNIT_NUMBER = ID_END_LIST,
  ID_LIBEDIT_SELECT_BODY_STYLE,

  /* Library viewer horizontal toolbar IDs */
  ID_LIBVIEW_SELECT_UNIT_NUMBER,
  ID_LIBVIEW_SELECT_BODY_STYLE,
  ID_LIBVIEW_LIB_FILTER,
  ID_LIBVIEW_LIB_LIST,
  ID_LIBVIEW_SYM_FILTER,
  ID_LIBVIEW_SYM_LIST,

  ID_END_EESCHEMA_ID_LIST, // End of IDs specific to Eeschema

  // These ID are used in context menus,
  // and must not clash with any other menu ID inside Kicad
  // So used ID inside the reserved popup ID
  //
  // Dynamically bound in AddMenusForBus():
  ID_POPUP_SCH_UNFOLD_BUS = ID_POPUP_MENU_START,
  ID_POPUP_SCH_UNFOLD_BUS_END = ID_POPUP_SCH_UNFOLD_BUS + MAX_BUS_UNFOLD_MENU_ITEMS,

  // Unit select context menus command IDs.
  ID_POPUP_SCH_SELECT_UNIT,
  ID_POPUP_SCH_SELECT_UNIT1,
  // ... leave room for MAX_UNIT_COUNT_PER_PACKAGE IDs ,
  // to select one unit among MAX_UNIT_COUNT_PER_PACKAGE in popup menu
  ID_POPUP_SCH_SELECT_UNIT_END = ID_POPUP_SCH_SELECT_UNIT1 + MAX_UNIT_COUNT_PER_PACKAGE,

  ID_POPUP_SCH_PLACE_UNIT,
  ID_POPUP_SCH_PLACE_UNIT1,
  ID_POPUP_SCH_PLACE_UNIT_END = ID_POPUP_SCH_PLACE_UNIT1 + MAX_UNIT_COUNT_PER_PACKAGE,

  ID_POPUP_SCH_SELECT_BODY_STYLE,
  ID_POPUP_SCH_SELECT_BODY_STYLE1,
  ID_POPUP_SCH_SELECT_BODY_STYLE_END = ID_POPUP_SCH_SELECT_BODY_STYLE1 + MAX_BODY_STYLE_PER_PACKAGE,

  ID_POPUP_SCH_PIN_TRICKS_START,
  ID_POPUP_SCH_PIN_TRICKS_NO_CONNECT = ID_POPUP_SCH_PIN_TRICKS_START,
  ID_POPUP_SCH_PIN_TRICKS_WIRE,
  ID_POPUP_SCH_PIN_TRICKS_NET_LABEL,
  ID_POPUP_SCH_PIN_TRICKS_HIER_LABEL,
  ID_POPUP_SCH_PIN_TRICKS_GLOBAL_LABEL,
  ID_POPUP_SCH_PIN_TRICKS_END = ID_POPUP_SCH_PIN_TRICKS_GLOBAL_LABEL,

  ID_POPUP_SCH_ALT_PIN_FUNCTION,
  ID_POPUP_SCH_ALT_PIN_FUNCTION_END = ID_POPUP_SCH_ALT_PIN_FUNCTION + MAX_ALT_PIN_FUNCTION_ITEMS,

  ID_TOOLBAR_SCH_SELECT_VARAIANT,
}
