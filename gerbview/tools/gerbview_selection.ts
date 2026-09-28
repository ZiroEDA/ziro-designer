// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `GERBVIEW_SELECTION` (gerbview/tools/gerbview_selection.h,
 * gerbview_selection.cpp): a SELECTION whose centre and view box come from
 * its items' bounding boxes, or the one item's position.
 */
import { SELECTION } from '@ziroeda/common/tool/selection.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';

export class GERBVIEW_SELECTION extends SELECTION {
  override GetCenter(): VECTOR2I {
    let centre: VECTOR2I;

    if (this.Size() === 1) {
      centre = (this.Front() as NonNullable<ReturnType<SELECTION['Front']>>).GetPosition();
    } else {
      const bbox = new BOX2I();

      for (const item of this.m_items) bbox.Merge(item.GetBoundingBox());

      centre = bbox.Centre();
    }

    return centre;
  }

  override ViewBBox(): BOX2I {
    let bbox = new BOX2I();

    if (this.Size() === 1) {
      bbox = (this.Front() as NonNullable<ReturnType<SELECTION['Front']>>).GetBoundingBox();
    } else if (this.Size() > 1) {
      for (const item of this.m_items) bbox.Merge(item.GetBoundingBox());
    }

    return bbox;
  }
}
