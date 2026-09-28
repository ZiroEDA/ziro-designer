// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PROPERTIES_TOOL` (`common/tool/properties_tool.cpp`,
 * `include/tool/properties_tool.h`): action handler for the Properties panel.
 * Every selection change and every undo/redo asks the frame to
 * `UpdateProperties()`, which refreshes the panel when it is on screen.
 *
 * Registered upstream by `sch_edit_frame.cpp:707`, `symbol_edit_frame.cpp:437`,
 * `pcb_edit_frame.cpp:976` and `footprint_edit_frame.cpp:1252`.
 */
import type { EDA_DRAW_FRAME } from '../eda_draw_frame.js';
import type { RESET_REASON } from './tool_base.js';
import { AS_GLOBAL, EVENTS, TA_UNDO_REDO_POST, TC_MESSAGE, TOOL_EVENT } from './tool_event.js';
import { SYNC_HANDLER, TOOL_INTERACTIVE } from './tool_interactive.js';

/**
 * Action handler for the Properties panel
 */
export class PROPERTIES_TOOL extends TOOL_INTERACTIVE {
  constructor() {
    super('common.Properties');
  }

  override Reset(_aReason: RESET_REASON): void {}

  UpdateProperties(_aEvent: TOOL_EVENT): number {
    const editFrame = this.getEditFrame<EDA_DRAW_FRAME>();

    if (editFrame) editFrame.UpdateProperties();

    return 0;
  }

  setTransitions(): void {
    const undoRedoPostEvt = new TOOL_EVENT(TC_MESSAGE, TA_UNDO_REDO_POST, AS_GLOBAL);
    this.Go(SYNC_HANDLER(this.UpdateProperties), undoRedoPostEvt);
    this.Go(SYNC_HANDLER(this.UpdateProperties), EVENTS.PointSelectedEvent);
    this.Go(SYNC_HANDLER(this.UpdateProperties), EVENTS.SelectedEvent);
    this.Go(SYNC_HANDLER(this.UpdateProperties), EVENTS.UnselectedEvent);
    this.Go(SYNC_HANDLER(this.UpdateProperties), EVENTS.ClearedEvent);
    this.Go(SYNC_HANDLER(this.UpdateProperties), EVENTS.SelectedItemsModified);
  }
}
