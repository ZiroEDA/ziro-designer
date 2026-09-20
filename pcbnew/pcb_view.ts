// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_view.h` + `.cpp`: `KIGFX::PCB_VIEW`, the VIEW that knows a
 * footprint's children ride along with it.
 */

import type { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { INT_MAX, INT_MIN } from '@ziroeda/kimath/src/math/util.js';
import { RECURSE_MODE } from '@ziroeda/common/src/eda_item.js';
import { VIEW } from '@ziroeda/common/src/view/view.js';
import { type VIEW_ITEM, VIEW_UPDATE_FLAGS } from '@ziroeda/common/src/view/view_item.js';
import type { KICAD_T } from '@ziroeda/core/src/typeinfo.js';
import { KICAD_T as T } from '@ziroeda/core/src/typeinfo.js';
import type { BOARD_ITEM } from './board_item.js';
import type { FOOTPRINT } from './footprint.js';
import type { PCB_DISPLAY_OPTIONS, PCB_PAINTER } from './pcb_painter.js';

export class PCB_VIEW extends VIEW {
  constructor() {
    super();

    // Set m_boundary to define the max area size. The default value is acceptable for Pcbnew
    // and Gerbview.
    // However, ensure this area has the right size (max size allowed by integer coordinates) in
    // case of the default value is changed. Could be a size depending on the drawing-sheet size.
    // coord_limits::epsilon() of an int is 0
    const pos = INT_MIN + 0;
    const size = INT_MAX - 0 - (INT_MIN + 0);
    this.m_boundary.SetOrigin(pos, pos);
    this.m_boundary.SetSize({ x: size, y: size });
  }

  /// @copydoc VIEW::Add()
  override Add(aItem: VIEW_ITEM, aDrawPriority = -1): void {
    if (aItem.IsBOARD_ITEM()) {
      const boardItem = aItem as unknown as BOARD_ITEM;

      if (boardItem.Type() === T.PCB_FOOTPRINT_T) {
        (boardItem as FOOTPRINT).RunOnChildren(
          (child: BOARD_ITEM) => this.Add(child, aDrawPriority),
          RECURSE_MODE.NO_RECURSE,
        );
      }
    }

    super.Add(aItem, aDrawPriority);
  }

  /// @copydoc VIEW::Remove()
  override Remove(aItem: VIEW_ITEM | null): void {
    if (aItem?.IsBOARD_ITEM()) {
      const boardItem = aItem as unknown as BOARD_ITEM;

      if (boardItem.Type() === T.PCB_FOOTPRINT_T) {
        (boardItem as FOOTPRINT).RunOnChildren(
          (child: BOARD_ITEM) => this.Remove(child),
          RECURSE_MODE.NO_RECURSE,
        );
      }
    }

    super.Remove(aItem);
  }

  /// @copydoc VIEW::Update()
  override Update(aItem: VIEW_ITEM, aUpdateFlags: number = VIEW_UPDATE_FLAGS.ALL): void {
    if (aItem.IsBOARD_ITEM()) {
      const boardItem = aItem as unknown as BOARD_ITEM;

      if (boardItem.Type() === T.PCB_TABLECELL_T) {
        super.Update(boardItem.GetParent()!);
      } else {
        boardItem.RunOnChildren((child: BOARD_ITEM) => {
          super.Update(child, aUpdateFlags);
        }, RECURSE_MODE.NO_RECURSE);
      }
    }

    super.Update(aItem, aUpdateFlags);
  }

  UpdateCollidingItems(aStaleAreas: readonly BOX2I[], aTypes: readonly KICAD_T[]): void {
    this.UpdateAllItemsConditionally((aItem: VIEW_ITEM): number => {
      if (aItem.IsBOARD_ITEM()) {
        const item = aItem as unknown as BOARD_ITEM;

        if (item.IsType(aTypes)) {
          const itemBBox = item.GetBoundingBox();

          for (const bbox of aStaleAreas) {
            if (itemBBox.Intersects(bbox)) return VIEW_UPDATE_FLAGS.REPAINT;
          }
        }
      }

      return 0;
    });
  }

  UpdateDisplayOptions(aOptions: PCB_DISPLAY_OPTIONS): void {
    const painter = this.GetPainter() as PCB_PAINTER;
    const settings = painter.GetSettings();
    settings.LoadDisplayOptions(aOptions);
  }
}
