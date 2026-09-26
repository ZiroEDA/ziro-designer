// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pagelayout_editor/tools/pl_editor_control.h` + `pl_editor_control.cpp`:
 * `PL_EDITOR_CONTROL`, the actions specific to the drawing sheet editor — the
 * file commands, page setup, print and plot, the inspector, the title block's
 * display mode, and keeping the message panel and the properties panel in
 * step with the selection.
 */
import type { DS_DRAW_ITEM_BASE } from '@ziroeda/common/drawing_sheet/ds_draw_item.js';
import { DS_DATA_MODEL } from '@ziroeda/common/drawing_sheet/ds_data_model.js';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import { EVENTS, type TOOL_EVENT } from '@ziroeda/common/tool/tool_event.js';
import { SYNC_HANDLER, TOOL_INTERACTIVE } from '@ziroeda/common/tool/tool_interactive.js';
import { GetMsgPanelDisplayUuid, MSG_PANEL_ITEM } from '@ziroeda/common/widgets/msgpanel.js';
import type { PL_EDITOR_FRAME } from '../pl_editor_frame.js';
import { PL_ACTIONS } from './pl_actions.js';
import { PL_SELECTION_TOOL } from './pl_selection_tool.js';

/**
 * Handle actions specific to the drawing sheet editor.
 */
export class PL_EDITOR_CONTROL extends TOOL_INTERACTIVE {
  private m_frame: PL_EDITOR_FRAME | null;

  constructor() {
    super('plEditor.EditorControl');
    this.m_frame = null;
  }

  /// @copydoc TOOL_INTERACTIVE::Init()
  override Init(): boolean {
    this.m_frame = this.getEditFrame<PL_EDITOR_FRAME>();
    return true;
  }

  /// @copydoc TOOL_INTERACTIVE::Reset()
  Reset(aReason: RESET_REASON): void {
    if (aReason === RESET_REASON.MODEL_RELOAD) this.m_frame = this.getEditFrame<PL_EDITOR_FRAME>();
  }

  New(_aEvent: TOOL_EVENT): number {
    this.m_frame!.Files_io('wxID_NEW');
    return 0;
  }

  Open(_aEvent: TOOL_EVENT): number {
    this.m_frame!.Files_io('wxID_OPEN');
    return 0;
  }

  Save(_aEvent: TOOL_EVENT): number {
    this.m_frame!.Files_io('wxID_SAVE');
    return 0;
  }

  SaveAs(_aEvent: TOOL_EVENT): number {
    this.m_frame!.Files_io('wxID_SAVEAS');
    return 0;
  }

  PageSetup(_aEvent: TOOL_EVENT): number {
    const frame = this.m_frame!;

    frame.SaveCopyInUndoList();

    // DIALOG_PAGES_SETTINGS dlg( m_frame, nullptr, IU_PER_MILS, MAX_PAGE_SIZE_EESCHEMA );
    // dlg.SetWksFileName( GetCurrentFileName() ); dlg.EnableWksFileNamePicker( false );
    if (!frame.ShowPageSettingsDialog()) {
      // Nothing to roll back but we have to at least pop the stack
      frame.RollbackFromUndo();
    } else {
      frame.OnModify();
      frame.HardRedraw();
    }

    return 0;
  }

  Print(_aEvent: TOOL_EVENT): number {
    this.m_frame!.ToPrinter(false);
    return 0;
  }

  Plot(_aEvent: TOOL_EVENT): number {
    this.m_frame!.GetHost()?.DisplayErrorMessage('Not yet available');
    return 0;
  }

  ShowInspector(_aEvent: TOOL_EVENT): number {
    this.m_frame!.ShowDesignInspector();
    return 0;
  }

  TitleBlockDisplayMode(aEvent: TOOL_EVENT): number {
    if (aEvent.IsAction(PL_ACTIONS.layoutEditMode))
      DS_DATA_MODEL.GetTheInstance().m_EditMode = true;
    else DS_DATA_MODEL.GetTheInstance().m_EditMode = false;

    this.m_frame!.HardRedraw();
    return 0;
  }

  /**
   * Update the message panel *and* the Properties frame, after change
   * (selection, move, edit ...) of a wks item
   */
  UpdateMessagePanel(_aEvent: TOOL_EVENT): number {
    const frame = this.m_frame!;
    const selTool = this.m_toolMgr!.GetTool(PL_SELECTION_TOOL)!;
    const selection = selTool.GetSelection();

    // The Properties frame will be updated. Avoid flicker during update: wxWindowUpdateLocker, n/a.

    if (selection.GetSize() === 1) {
      const item = selection.Front() as EDA_ITEM;
      const msgItems: MSG_PANEL_ITEM[] = [];

      const uuid = GetMsgPanelDisplayUuid(item.m_Uuid);

      if (uuid !== undefined) msgItems.push(new MSG_PANEL_ITEM('UUID', uuid));

      item.GetMsgPanelInfo(frame.AsDrawFrameLike(), msgItems);
      frame.SetMsgPanel(msgItems);

      const dataItem = (item as DS_DRAW_ITEM_BASE).GetPeer();
      frame.GetPropertiesFrame()?.CopyPrmsFromItemToPanel(dataItem);
    } else {
      frame.UpdateMsgPanelInfo();
      frame.GetPropertiesFrame()?.CopyPrmsFromItemToPanel(null);
    }

    frame.GetPropertiesFrame()?.CopyPrmsFromGeneralToPanel();

    return 0;
  }

  GridResetOrigin(_aEvent: TOOL_EVENT): number {
    this.m_frame!.SetGridOrigin({ x: 0, y: 0 });
    this.m_frame!.GetCanvas()!.ForceRefresh();
    return 0;
  }

  ///< Set up handlers for various events.
  protected setTransitions(): void {
    this.Go(SYNC_HANDLER(this.New), ACTIONS.doNew.MakeEvent());
    this.Go(SYNC_HANDLER(this.Open), ACTIONS.open.MakeEvent());
    this.Go(SYNC_HANDLER(this.Save), ACTIONS.save.MakeEvent());
    this.Go(SYNC_HANDLER(this.SaveAs), ACTIONS.saveAs.MakeEvent());
    this.Go(SYNC_HANDLER(this.Print), ACTIONS.print.MakeEvent());
    this.Go(SYNC_HANDLER(this.Plot), ACTIONS.plot.MakeEvent());

    this.Go(SYNC_HANDLER(this.PageSetup), PL_ACTIONS.previewSettings.MakeEvent());
    this.Go(SYNC_HANDLER(this.ShowInspector), PL_ACTIONS.showInspector.MakeEvent());
    this.Go(SYNC_HANDLER(this.TitleBlockDisplayMode), PL_ACTIONS.layoutEditMode.MakeEvent());
    this.Go(SYNC_HANDLER(this.TitleBlockDisplayMode), PL_ACTIONS.layoutNormalMode.MakeEvent());

    this.Go(SYNC_HANDLER(this.GridResetOrigin), ACTIONS.gridResetOrigin.MakeEvent());

    this.Go(SYNC_HANDLER(this.UpdateMessagePanel), EVENTS.SelectedEvent);
    this.Go(SYNC_HANDLER(this.UpdateMessagePanel), EVENTS.UnselectedEvent);
    this.Go(SYNC_HANDLER(this.UpdateMessagePanel), EVENTS.ClearedEvent);
    this.Go(SYNC_HANDLER(this.UpdateMessagePanel), EVENTS.SelectedItemsModified);
  }
}
