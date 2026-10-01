// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `TOOL_EVT_UTILS` (pcbnew/tools/tool_event_utils.h, .cpp): helpers for reading
 * the tool events pcbnew's tools share.
 */
import type { TOOL_EVENT } from '@ziroeda/common/tool/tool_event.js';
import type { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { PCB_BASE_EDIT_FRAME } from '../pcb_base_edit_frame.js';
import { PCB_ACTIONS } from './pcb_actions.js';

/** `TOOL_EVT_UTILS::IsRotateToolEvt`. */
export function IsRotateToolEvt(aEvt: TOOL_EVENT): boolean {
  return aEvt.IsAction(PCB_ACTIONS.rotateCw) || aEvt.IsAction(PCB_ACTIONS.rotateCcw);
}

/**
 * `TOOL_EVT_UTILS::GetEventRotationAngle`: the frame's rotation step, signed by
 * the action's parameter (1 or -1).
 */
export function GetEventRotationAngle(aFrame: PCB_BASE_EDIT_FRAME, aEvent: TOOL_EVENT): EDA_ANGLE {
  console.assert(IsRotateToolEvt(aEvent), 'Expected rotation event');

  const rotAngle = aFrame.GetRotationAngle();
  const angleMultiplier = aEvent.Parameter<number>();

  console.assert(angleMultiplier === 1 || angleMultiplier === -1, 'Expected 1 or -1');

  return angleMultiplier > 0 ? rotAngle : rotAngle.negate();
}
