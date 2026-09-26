// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pagelayout_editor/pl_editor_layout.h` + `pl_editor_layout.cpp`:
 * `PL_EDITOR_LAYOUT`, what the editor previews the sheet on — the page
 * settings and the title block — and its draw item list.
 */
import { DS_DRAW_ITEM_LIST } from '@ziroeda/common/drawing_sheet/ds_draw_item.js';
import { drawSheetIUScale } from '@ziroeda/common/eda_units.js';
import { PAGE_INFO, PAGE_SIZE_TYPE } from '@ziroeda/common/page_info.js';
import { TITLE_BLOCK } from '@ziroeda/common/title_block.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';

export class PL_EDITOR_LAYOUT {
  private m_boundingBox = new BOX2I();
  private m_paper = new PAGE_INFO();
  private m_titles = new TITLE_BLOCK();
  private m_drawItemList: DS_DRAW_ITEM_LIST;

  constructor() {
    this.m_drawItemList = new DS_DRAW_ITEM_LIST(drawSheetIUScale);
    const pageInfo = new PAGE_INFO(PAGE_SIZE_TYPE.A4);
    this.SetPageSettings(pageInfo);
  }

  GetPageSettings(): PAGE_INFO {
    return this.m_paper;
  }

  /** `m_paper = aPageSettings`: a copy. */
  SetPageSettings(aPageSettings: PAGE_INFO): void {
    this.m_paper = new PAGE_INFO().assign(aPageSettings);
  }

  GetAuxOrigin(): VECTOR2I {
    return { x: 0, y: 0 };
  }

  GetTitleBlock(): TITLE_BLOCK {
    return this.m_titles;
  }

  /** `m_titles = aTitleBlock`: a copy. */
  SetTitleBlock(aTitleBlock: TITLE_BLOCK): void {
    this.m_titles = aTitleBlock.clone();
  }

  GetDrawItems(): DS_DRAW_ITEM_LIST {
    return this.m_drawItemList;
  }

  /**
   * Calculate the bounding box containing all Gerber items.
   *
   * @return the full item list bounding box.
   */
  ComputeBoundingBox(): BOX2I {
    const bbox = new BOX2I();

    this.SetBoundingBox(bbox);
    return bbox;
  }

  /**
   * Called soon after ComputeBoundingBox() to return the same BOX2I, as long as the
   * CLASS_PL_EDITOR_LAYOUT has not changed.
   */
  GetBoundingBox(): BOX2I {
    return this.m_boundingBox;
  }

  SetBoundingBox(aBox: BOX2I): void {
    this.m_boundingBox = aBox;
  }
}
