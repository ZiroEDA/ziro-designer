// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/sync_sheet_pin/sheet_synchronization_agent.h` / `.cpp`: what the Synchronize Sheet
 * Pins dialog asks of the editor - modify, delete or place an item - through the three callbacks
 * SCH_DRAWING_TOOLS::doSyncSheetsPins hands it. A sheet pin lives on the parent sheet, so its
 * path loses the last sheet before the callback sees it.
 */
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import type { SCH_EDIT_FRAME } from '../sch_edit_frame.js';
import type { SCH_ITEM } from '../sch_item.js';
import type { SCH_SHEET } from '../sch_sheet.js';
import type { SCH_SHEET_PATH } from '../sch_sheet_path.js';
import type { TOOL_MANAGER } from '@ziroeda/common/tool/tool_manager.js';
import {
  type SHEET_SYNCHRONIZATION_ITEM,
  SHEET_SYNCHRONIZATION_ITEM_KIND,
} from './sheet_synchronization_item.js';

export enum SHEET_SYNCHRONIZATION_PLACEMENT {
  PLACE_SHEET_PIN,
  PLACE_HIERLABEL,
}

export type DO_DELETE_ITEM = (aItem: EDA_ITEM, aPath: SCH_SHEET_PATH) => void;
export type MODIFICATION = () => void;
export type DO_MODIFY_ITEM = (
  aItem: EDA_ITEM,
  aPath: SCH_SHEET_PATH,
  aModify: MODIFICATION,
) => void;
export type DO_PLACE_ITEM = (
  aSheet: SCH_SHEET,
  aPath: SCH_SHEET_PATH,
  aOp: SHEET_SYNCHRONIZATION_PLACEMENT,
  aTemplates: ReadonlySet<EDA_ITEM>,
) => void;

/** `SCH_SHEET_PATH path_cp = aPath; path_cp.pop_back();` */
function parentPath(aPath: SCH_SHEET_PATH): SCH_SHEET_PATH {
  const cp = aPath.Clone();
  cp.pop_back();
  return cp;
}

export class SHEET_SYNCHRONIZATION_AGENT {
  private readonly m_doModify: DO_MODIFY_ITEM;
  private readonly m_doDelete: DO_DELETE_ITEM;
  private readonly m_doPlaceItem: DO_PLACE_ITEM;

  constructor(
    aDoModify: DO_MODIFY_ITEM,
    aDoDelete: DO_DELETE_ITEM,
    aPlaceItem: DO_PLACE_ITEM,
    _aToolManager: TOOL_MANAGER | null,
    _aFrame: SCH_EDIT_FRAME | null,
  ) {
    this.m_doModify = aDoModify;
    this.m_doDelete = aDoDelete;
    this.m_doPlaceItem = aPlaceItem;
  }

  /**
   * `ModifyItem( SHEET_SYNCHRONIZATION_ITEM&, aDoModify, aPath )` - which reads the item and its
   * kind off the row - and `ModifyItem( SCH_ITEM*, aDoModify, aPath, aKind )`.
   */
  ModifyItem(
    aItem: SHEET_SYNCHRONIZATION_ITEM,
    aDoModify: MODIFICATION,
    aPath: SCH_SHEET_PATH,
  ): void;
  ModifyItem(
    aItem: SCH_ITEM,
    aDoModify: MODIFICATION | null,
    aPath: SCH_SHEET_PATH,
    aKind: SHEET_SYNCHRONIZATION_ITEM_KIND,
  ): void;
  ModifyItem(
    aItem: SHEET_SYNCHRONIZATION_ITEM | SCH_ITEM,
    aDoModify: MODIFICATION | null,
    aPath: SCH_SHEET_PATH,
    aKind?: SHEET_SYNCHRONIZATION_ITEM_KIND,
  ): void {
    if (aKind === undefined) {
      const row = aItem as SHEET_SYNCHRONIZATION_ITEM;
      const item = row.GetItem();

      if (item) this.ModifyItem(item, aDoModify, aPath, row.GetKind());

      return;
    }

    if (!aDoModify) return;

    const sch_item = aItem as SCH_ITEM;

    switch (aKind) {
      case SHEET_SYNCHRONIZATION_ITEM_KIND.HIERLABEL:
        this.m_doModify(sch_item, aPath, aDoModify);
        break;

      case SHEET_SYNCHRONIZATION_ITEM_KIND.SHEET_PIN:
        this.m_doModify(sch_item, parentPath(aPath), aDoModify);
        break;

      case SHEET_SYNCHRONIZATION_ITEM_KIND.HIERLABEL_AND_SHEET_PIN:
        break;
    }
  }

  RemoveItem(
    aItem: SHEET_SYNCHRONIZATION_ITEM,
    aSheet: SCH_SHEET | null,
    aPath: SCH_SHEET_PATH,
  ): void {
    if (!aSheet) return;

    switch (aItem.GetKind()) {
      case SHEET_SYNCHRONIZATION_ITEM_KIND.HIERLABEL:
        this.m_doDelete(aItem.GetItem()!, aPath);
        break;

      case SHEET_SYNCHRONIZATION_ITEM_KIND.SHEET_PIN:
        this.m_doDelete(aItem.GetItem()!, parentPath(aPath));
        break;

      case SHEET_SYNCHRONIZATION_ITEM_KIND.HIERLABEL_AND_SHEET_PIN:
        break;
    }
  }

  PlaceSheetPin(aSheet: SCH_SHEET, aPath: SCH_SHEET_PATH, aLabels: ReadonlySet<EDA_ITEM>): void {
    this.m_doPlaceItem(
      aSheet,
      parentPath(aPath),
      SHEET_SYNCHRONIZATION_PLACEMENT.PLACE_SHEET_PIN,
      aLabels,
    );
  }

  PlaceHieraLable(aSheet: SCH_SHEET, aPath: SCH_SHEET_PATH, aPins: ReadonlySet<EDA_ITEM>): void {
    this.m_doPlaceItem(aSheet, aPath, SHEET_SYNCHRONIZATION_PLACEMENT.PLACE_HIERLABEL, aPins);
  }
}
