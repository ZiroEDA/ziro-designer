// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/tools/sch_selection.h` + `.cpp`: the schematic editor's SELECTION, the VIEW_GROUP the
 * selection tool puts on the overlay, whose draw list is the selected items.
 */
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { SELECTION } from '@ziroeda/common/tool/selection.js';
import type { VIEW_ITEM } from '@ziroeda/common/view/view_item.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { SCH_ITEM } from '../sch_item.js';
import { SCH_PIN } from '../sch_pin.js';
import type { SCH_SCREEN } from '../sch_screen.js';
import type { SCH_SHEET } from '../sch_sheet.js';
import type { SCH_SYMBOL } from '../sch_symbol.js';

export class SCH_SELECTION extends SELECTION {
  /** Screen of selected objects.  Usually the current screen. */
  m_screen: SCH_SCREEN | null;

  constructor(aScreen: SCH_SCREEN | null = null) {
    super();
    this.m_screen = aScreen;
  }

  /** `operator=`: a copy of \a aOther's items and state, screen included. */
  override assign(aOther: SELECTION): this {
    super.assign(aOther);

    if (aOther instanceof SCH_SELECTION) this.m_screen = aOther.m_screen;

    return this;
  }

  /**
   * The leftmost (smallest x) and highest (smallest y with that x) item, preferring connection
   * points, which should remain on grid.
   */
  override GetTopLeftItem(_onlyModules = false): EDA_ITEM | null {
    let topLeftConnectedItem: EDA_ITEM | null = null;
    let topLeftConnectedPos: VECTOR2I = { x: 0, y: 0 };

    let topLeftItem: EDA_ITEM | null = null;
    let topLeftPos: VECTOR2I = { x: 0, y: 0 };

    const processItem = (
      aItem: EDA_ITEM,
      aCurrent: EDA_ITEM | null,
      aCurrentPos: VECTOR2I,
    ): [EDA_ITEM | null, VECTOR2I] => {
      const pos = aItem.GetPosition();

      if (
        aCurrent === null ||
        pos.x < aCurrentPos.x ||
        (pos.x === aCurrentPos.x && pos.y < aCurrentPos.y)
      ) {
        return [aItem, pos];
      }

      return [aCurrent, aCurrentPos];
    };

    // Find the leftmost (smallest x coord) and highest (smallest y with the smallest x) item
    // in the selection

    for (const item of this.m_items) {
      const sch_item = item instanceof SCH_ITEM ? item : null;
      const pin = item instanceof SCH_PIN ? item : null;

      // Prefer connection points (which should remain on grid)

      if (sch_item?.IsConnectable() || pin)
        [topLeftConnectedItem, topLeftConnectedPos] = processItem(
          item,
          topLeftConnectedItem,
          topLeftConnectedPos,
        );

      [topLeftItem, topLeftPos] = processItem(item, topLeftItem, topLeftPos);
    }

    if (topLeftConnectedItem) return topLeftConnectedItem;
    else return topLeftItem;
  }

  override GetBoundingBox(): BOX2I {
    const bbox = new BOX2I();

    for (const item of this.m_items) {
      if (item.Type() === KICAD_T.SCH_SYMBOL_T) {
        bbox.Merge((item as SCH_SYMBOL).GetBoundingBox());
      } else if (item.Type() === KICAD_T.SCH_SHEET_T) {
        bbox.Merge((item as SCH_SHEET).GetBodyBoundingBox());
      } else {
        bbox.Merge(item.GetBoundingBox());
      }
    }

    return bbox;
  }

  protected override updateDrawList(): VIEW_ITEM[] {
    const items: VIEW_ITEM[] = [];

    const addItem = (item: EDA_ITEM): void => {
      items.push(item);
    };

    for (const item of this.m_items) addItem(item);

    return items;
  }
}
