// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PCB_CONTROL::DoSetGridOrigin` and `BOARD_EDITOR_CONTROL::DoSetDrillOrigin`,
 * the two statics `PCB_BASE_EDIT_FRAME::PutDataInPreviousState` calls to undo
 * an origin move. Their own module, so the undo code can reach them without
 * importing the tools (which import the frame).
 */
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import type { VIEW } from '@ziroeda/common/view/view.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { Vec2 as VECTOR2D } from '@ziroeda/kimath/src/math/vector2.js';
import type { PCB_BASE_FRAME } from '../pcb_base_frame.js';

/** `PCB_CONTROL::DoSetGridOrigin` (pcb_control.cpp:757-765). */
export function DoSetGridOrigin(
  aView: VIEW | null,
  aFrame: PCB_BASE_FRAME,
  originViewItem: EDA_ITEM,
  aPoint: VECTOR2D,
): void {
  aFrame.GetDesignSettings().SetGridOrigin({ x: KiROUND(aPoint.x), y: KiROUND(aPoint.y) });
  aView?.GetGAL()?.SetGridOrigin(aPoint);
  originViewItem.SetPosition(aPoint);
  aView?.MarkDirty();
  aFrame.OnModify();
}

/** `BOARD_EDITOR_CONTROL::DoSetDrillOrigin` (board_editor_control.cpp:2235-2242). */
export function DoSetDrillOrigin(
  aView: VIEW | null,
  aFrame: PCB_BASE_FRAME,
  originViewItem: EDA_ITEM,
  aPosition: VECTOR2D,
): void {
  aFrame.GetDesignSettings().SetAuxOrigin({ x: KiROUND(aPosition.x), y: KiROUND(aPosition.y) });
  originViewItem.SetPosition(aPosition);
  aView?.MarkDirty();
  aFrame.OnModify();
}
