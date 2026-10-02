// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/drawing_sheet/ds_proxy_undo_item.h` + `common/drawing_sheet/ds_proxy_undo_item.cpp`:
 * `DS_PROXY_UNDO_ITEM`, one undo step of the drawing sheet editor — the whole
 * layout serialised, which item was selected, and (the `_PLUS` type) the page
 * settings and title block.
 */

import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { EDA_ITEM } from '../eda_item.js';
import { PAGE_INFO } from '../page_info.js';
import { TITLE_BLOCK } from '../title_block.js';
import type { VIEW } from '../view/view.js';
import { DS_DATA_MODEL } from './ds_data_model.js';

/** `INT_MAX`, "no item selected". */
const INT_MAX = 2147483647;

/** The `EDA_DRAW_FRAME` members the undo item reads and restores. */
export interface DS_PROXY_UNDO_FRAME {
  GetPageSettings(): PAGE_INFO;
  SetPageSettings(aPageSettings: PAGE_INFO): void;
  GetTitleBlock(): TITLE_BLOCK;
  SetTitleBlock(aTitleBlock: TITLE_BLOCK): void;
}

export class DS_PROXY_UNDO_ITEM extends EDA_ITEM {
  protected m_titleBlock = new TITLE_BLOCK();
  protected m_pageInfo = new PAGE_INFO();
  protected m_layoutSerialization: string;
  protected m_selectedDataItem: number;
  protected m_selectedDrawItem: number;

  constructor(aFrame: DS_PROXY_UNDO_FRAME | null) {
    super(aFrame ? KICAD_T.WS_PROXY_UNDO_ITEM_PLUS_T : KICAD_T.WS_PROXY_UNDO_ITEM_T);
    this.m_selectedDataItem = INT_MAX;
    this.m_selectedDrawItem = INT_MAX;

    if (aFrame) {
      this.m_pageInfo = new PAGE_INFO().assign(aFrame.GetPageSettings());
      this.m_titleBlock = aFrame.GetTitleBlock().clone();
    }

    const model = DS_DATA_MODEL.GetTheInstance();
    this.m_layoutSerialization = model.SaveInString();

    for (let ii = 0; ii < model.GetItems().length; ++ii) {
      const dataItem = model.GetItem(ii)!;

      for (let jj = 0; jj < dataItem.GetDrawItems().length; ++jj) {
        const drawItem = dataItem.GetDrawItems()[jj]!;

        if (drawItem.IsSelected()) {
          this.m_selectedDataItem = ii;
          this.m_selectedDrawItem = jj;
          break;
        }
      }
    }
  }

  /**
   * Restores the saved drawing sheet layout to the global drawing sheet record, and the saved
   * page info and title blocks to the given frame.  The WS_DRAW_ITEMs are rehydrated and
   * installed in aView if it is not null (ie: if we're in the PageLayout Editor).
   */
  Restore(aFrame: DS_PROXY_UNDO_FRAME, aView: VIEW | null = null): void {
    if (this.Type() === KICAD_T.WS_PROXY_UNDO_ITEM_PLUS_T) {
      aFrame.SetPageSettings(this.m_pageInfo);
      aFrame.SetTitleBlock(this.m_titleBlock);
    }

    DS_DATA_MODEL.GetTheInstance().SetPageLayout(this.m_layoutSerialization);

    if (aView) {
      aView.Clear();

      const model = DS_DATA_MODEL.GetTheInstance();

      for (let ii = 0; ii < model.GetItems().length; ++ii) {
        const dataItem = model.GetItem(ii)!;

        dataItem.SyncDrawItems(null, aView);

        if (
          ii === this.m_selectedDataItem &&
          this.m_selectedDrawItem < dataItem.GetDrawItems().length
        ) {
          const drawItem = dataItem.GetDrawItems()[this.m_selectedDrawItem]!;
          drawItem.SetSelected();
        }
      }
    }
  }

  /** `DS_PROXY_UNDO_ITEM& operator=( DS_PROXY_UNDO_ITEM&& )`: the saved state of another. */
  override assign(aItem: EDA_ITEM): this {
    super.assign(aItem);
    const aOther = aItem as DS_PROXY_UNDO_ITEM;
    this.m_titleBlock = aOther.m_titleBlock;
    this.m_pageInfo = aOther.m_pageInfo;
    this.m_layoutSerialization = aOther.m_layoutSerialization;
    this.m_selectedDataItem = aOther.m_selectedDataItem;
    this.m_selectedDrawItem = aOther.m_selectedDrawItem;
    return this;
  }

  override GetClass(): string {
    return 'DS_PROXY_UNDO_ITEM';
  }
}
