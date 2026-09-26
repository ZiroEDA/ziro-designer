// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `gerbview/gbr_layout.h` + `.cpp`: `GBR_LAYOUT`, "a list of GERBER_DRAW_ITEM
 * objects currently loaded" — GerbView's document: the image list (the
 * process-wide GERBER_FILE_IMAGE_LIST), a title block, and the aux origin.
 */
import { EDA_ITEM, INSPECT_RESULT, type INSPECTOR } from '@ziroeda/common/eda_item.js';
import { TITLE_BLOCK } from '@ziroeda/common/title_block.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { GERBER_FILE_IMAGE_LIST } from './gerber_file_image_list.js';

export class GBR_LAYOUT extends EDA_ITEM {
  private m_BoundingBox = new BOX2I();
  private m_titles = new TITLE_BLOCK();
  private m_originAxisPosition: VECTOR2I = { x: 0, y: 0 };

  constructor() {
    super(null, KICAD_T.GERBER_LAYOUT_T);
  }

  override GetClass(): string {
    return 'GBR_LAYOUT';
  }

  /** The GERBER_FILE_IMAGE_LIST: the gerber (and drill) file images loaded. */
  GetImagesList(): GERBER_FILE_IMAGE_LIST {
    return GERBER_FILE_IMAGE_LIST.GetImagesList();
  }

  GetAuxOrigin(): VECTOR2I {
    return this.m_originAxisPosition;
  }

  SetAuxOrigin(aPosition: VECTOR2I): void {
    this.m_originAxisPosition = aPosition;
  }

  GetTitleBlock(): TITLE_BLOCK {
    return this.m_titles;
  }

  SetTitleBlock(aTitleBlock: TITLE_BLOCK): void {
    this.m_titles = aTitleBlock;
  }

  /** The bounding box containing all Gerber items. */
  ComputeBoundingBox(): BOX2I {
    const bbox = new BOX2I(); // Start with a fresh BOX2I so the Merge algorithm works

    for (let layer = 0; layer < this.GetImagesList().ImagesMaxCount(); ++layer) {
      const gerber = this.GetImagesList().GetGbrImage(layer);

      if (gerber === null) continue; // Graphic layer not yet used

      for (const item of gerber.GetItems()) bbox.Merge(item.GetBoundingBox());
    }

    bbox.Normalize();

    this.m_BoundingBox = bbox;
    return bbox;
  }

  override GetBoundingBox(): BOX2I {
    return this.ComputeBoundingBox();
  }

  SetBoundingBox(aBox: BOX2I): void {
    this.m_BoundingBox = aBox;
  }

  override Visit(
    inspector: INSPECTOR,
    testData: unknown,
    aScanTypes: readonly KICAD_T[],
  ): INSPECT_RESULT {
    for (const scanType of aScanTypes) {
      if (scanType === KICAD_T.GERBER_LAYOUT_T) {
        for (let layer = 0; layer < this.GetImagesList().ImagesMaxCount(); ++layer) {
          const gerber = this.GetImagesList().GetGbrImage(layer);

          if (gerber === null) continue; // Graphic layer not yet used

          if (gerber.Visit(inspector, testData, aScanTypes) === INSPECT_RESULT.QUIT)
            return INSPECT_RESULT.QUIT;
        }
      }
    }

    return INSPECT_RESULT.CONTINUE;
  }
}
