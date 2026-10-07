// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SCH_EDITOR_CONTROL` (eeschema/tools/sch_editor_control.{h,cpp}): the schematic editor's
 * actions - setup and output dialogs, undo and redo, cross-probing, annotation, the view toggles,
 * the line modes.
 *
 * Ported a section at a time; setTransitions lists what each section has not reached yet.
 */
import { DS_PROXY_UNDO_ITEM } from '@ziroeda/common/drawing_sheet/ds_proxy_undo_item.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { PgmOrNull } from '@ziroeda/common/pgm_base.js';
import type { APP_SETTINGS_BASE } from '@ziroeda/common/settings/app_settings.js';
import { ACTIONS, EVENTS } from '@ziroeda/common/tool/actions.js';
import type { COROUTINE_BODY } from '@ziroeda/common/tool/coroutine.js';
import {
  AS_GLOBAL,
  TA_UNDO_REDO_PRE,
  TC_MESSAGE,
  TOOL_EVENT,
} from '@ziroeda/common/tool/tool_event.js';
import { SYNC_HANDLER } from '@ziroeda/common/tool/tool_interactive.js';
import { ITEM_PICKER, PICKED_ITEMS_LIST, UNDO_REDO } from '@ziroeda/common/undo_redo_container.js';
import { VIEW_UPDATE_FLAGS } from '@ziroeda/common/view/view_item.js';
import { wxID_OK } from '@ziroeda/common/wx/menu.js';
import { updateEeschemaSettings } from '../eeschema_settings.js';
import { SCH_COMMIT } from '../sch_commit.js';
import type { SCH_EDIT_FRAME } from '../sch_edit_frame.js';
import { RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import { SCH_REFERENCE, SCH_REFERENCE_LIST } from '../sch_reference_list.js';
import { SYMBOL_FILTER } from '../sch_sheet_path.js';
import { LINE_MODE, SCH_ACTIONS } from './sch_actions.js';
import { SCH_SELECTION_TOOL } from './sch_selection_tool.js';
import { SCH_TOOL_BASE } from './sch_tool_base.js';

/** `MAX_PAGE_SIZE_EESCHEMA_MILS` (page_info.h). [data] */
const MAX_PAGE_SIZE_EESCHEMA_MILS = 120000;

/** `NET_PLUGIN_CHANGE` (dialog_netlist.h): what InvokeDialogNetList returns after a plugin edit. [data] */
const NET_PLUGIN_CHANGE = 1;

/** `DIALOG_INCREMENT_ANNOTATIONS_BASE`'s three controls, which the window fills on OK. */
export interface INCREMENT_ANNOTATIONS_VALUES {
  /** `m_FirstRefDes->GetValue()`. */
  firstRefDes: string;
  /** `m_AllSheets->GetValue()`. */
  allSheets: boolean;
  /** `m_Increment->GetValue()`. */
  increment: number;
}

export class SCH_EDITOR_CONTROL extends SCH_TOOL_BASE<SCH_EDIT_FRAME> {
  private m_probingPcbToSch = false; // Recursion guard for PCB to schematic cross-probing

  constructor() {
    super('eeschema.EditorControl');
  }

  *ShowSchematicSetup(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    yield* this.RunMainStackModal(() => this.m_frame!.ShowSchematicSetupDialog());
    return 0;
  }

  *PageSetup(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const undoCmd = new PICKED_ITEMS_LIST();
    const undoItem = new DS_PROXY_UNDO_ITEM(this.m_frame!);
    const wrapper = new ITEM_PICKER(this.m_frame!.GetScreen(), undoItem, UNDO_REDO.PAGESETTINGS);

    undoCmd.PushItem(wrapper);
    undoCmd.SetDescription('Page Settings');
    this.m_frame!.SaveCopyInUndoList(undoCmd, UNDO_REDO.PAGESETTINGS, false);

    const result = yield* this.RunMainStackModal(() =>
      this.m_frame!.ShowModalDialog('DIALOG_EESCHEMA_PAGE_SETTINGS', [], {
        embeddedFiles: this.m_frame!.Schematic().GetEmbeddedFiles(),
        maxUserSizeMils: { x: MAX_PAGE_SIZE_EESCHEMA_MILS, y: MAX_PAGE_SIZE_EESCHEMA_MILS },
      }),
    );

    if (result === wxID_OK) {
      // Update text variables
      this.m_frame!.GetCanvas()?.GetView()?.MarkDirty();
      this.m_frame!.GetCanvas()?.GetView()?.UpdateAllItems(VIEW_UPDATE_FLAGS.REPAINT);
      this.m_frame!.GetCanvas()?.Refresh();

      this.m_frame!.OnModify();
    } else {
      this.m_frame!.RollbackSchematicFromUndo();
    }

    return 0;
  }

  *RemapSymbols(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    yield* this.RunMainStackModal(() => this.m_frame!.ShowModalDialog('DIALOG_SYMBOL_REMAP', []));

    this.m_frame!.GetCanvas()?.Refresh(true);

    return 0;
  }

  *Print(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    yield* this.RunMainStackModal(() => this.m_frame!.ShowModalDialog('DIALOG_PRINT', []));

    return 0;
  }

  *Plot(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    yield* this.RunMainStackModal(() => this.m_frame!.ShowModalDialog('DIALOG_PLOT_SCHEMATIC', []));

    return 0;
  }

  CrossProbeToPcb(aEvent: TOOL_EVENT): number {
    this.doCrossProbeSchToPcb(aEvent, false);
    return 0;
  }

  ExplicitCrossProbeToPcb(aEvent: TOOL_EVENT): number {
    this.doCrossProbeSchToPcb(aEvent, true);
    return 0;
  }

  private doCrossProbeSchToPcb(_aEvent: TOOL_EVENT, aForce: boolean): void {
    // Don't get in an infinite loop SCH -> PCB -> SCH -> PCB -> SCH -> ...
    if (this.m_probingPcbToSch || this.m_frame!.IsSyncingSelection()) return;

    const selTool = this.m_toolMgr!.GetTool(SCH_SELECTION_TOOL)!;
    const selection = aForce ? selTool.RequestSelection() : selTool.GetSelection();

    this.m_frame!.SendSelectItemsToPcb(selection.GetItemsSortedBySelectionOrder(), aForce);
  }

  Undo(_aEvent: TOOL_EVENT): number {
    if (!this.m_frame) return 0; // wxCHECK

    if (this.m_frame.GetUndoCommandCount() <= 0) return 0;

    // Inform tools that undo command was issued
    this.m_toolMgr!.ProcessEvent(new TOOL_EVENT(TC_MESSAGE, TA_UNDO_REDO_PRE, AS_GLOBAL));

    // Get the old list
    const undo_list = this.m_frame.PopCommandFromUndoList();

    if (!undo_list) return 0; // wxCHECK

    this.m_frame.PutDataInPreviousState(undo_list);

    // Now push the old command to the RedoList
    undo_list.ReversePickersListOrder();
    this.m_frame.PushCommandToRedoList(undo_list);

    this.m_toolMgr!.GetTool(SCH_SELECTION_TOOL)!.RebuildSelection();

    this.m_frame.GetCanvas()?.Refresh();
    this.m_frame.OnModify();

    return 0;
  }

  Redo(_aEvent: TOOL_EVENT): number {
    if (!this.m_frame) return 0; // wxCHECK

    if (this.m_frame.GetRedoCommandCount() === 0) return 0;

    // Inform tools that undo command was issued
    this.m_toolMgr!.ProcessEvent(new TOOL_EVENT(TC_MESSAGE, TA_UNDO_REDO_PRE, AS_GLOBAL));

    /* Get the old list */
    const list = this.m_frame.PopCommandFromRedoList();

    if (!list) return 0; // wxCHECK

    /* Redo the command: */
    this.m_frame.PutDataInPreviousState(list);

    /* Put the old list in UndoList */
    list.ReversePickersListOrder();
    this.m_frame.PushCommandToUndoList(list);

    this.m_toolMgr!.GetTool(SCH_SELECTION_TOOL)!.RebuildSelection();

    this.m_frame.GetCanvas()?.Refresh();
    this.m_frame.OnModify();

    return 0;
  }

  Annotate(_aEvent: TOOL_EVENT): number {
    this.m_frame!.OnAnnotate();
    return 0;
  }

  *IncrementAnnotations(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const dlg: INCREMENT_ANNOTATIONS_VALUES = { firstRefDes: '', allSheets: false, increment: 1 };

    const result = yield* this.RunMainStackModal(() =>
      this.m_frame!.ShowModalDialog('DIALOG_INCREMENT_ANNOTATIONS_BASE', [], dlg),
    );

    if (result === wxID_OK) {
      const startRef = new SCH_REFERENCE();
      startRef.SetRef(dlg.firstRefDes);

      if (startRef.IsSplitNeeded()) startRef.Split();
      else return 0;

      // atoi(): the leading digits, 0 when there are none
      const startNum = Number.parseInt(startRef.GetRefNumber(), 10) || 0;

      const commit = new SCH_COMMIT(this.m_frame!);
      const schematic = this.m_frame!.Schematic();
      const references = new SCH_REFERENCE_LIST();

      if (dlg.allSheets)
        schematic.Hierarchy().GetSymbols(references, SYMBOL_FILTER.SYMBOL_FILTER_ALL);
      else schematic.CurrentSheet().GetSymbols(references, SYMBOL_FILTER.SYMBOL_FILTER_ALL);

      references.SplitReferences();

      for (const ref of references) {
        if (ref.GetRef() === startRef.GetRef()) {
          let num = Number.parseInt(ref.GetRefNumber(), 10) || 0;

          if (num >= startNum) {
            const sheet = ref.GetSheetPath();
            let fullRef = ref.GetRef();

            num += dlg.increment;
            fullRef += String(num);

            commit.Modify(ref.GetSymbol(), sheet.LastScreen(), RECURSE_MODE.NO_RECURSE);
            ref.GetSymbol().SetRef(sheet, fullRef);
          }
        }
      }

      if (!commit.Empty()) commit.Push('Increment Annotations');
    }

    return 0;
  }

  EditSymbolFields(_aEvent: TOOL_EVENT): number {
    const dlg = this.m_frame!.GetSymbolFieldsTableDialog();

    if (!dlg) return 0; // wxCHECK

    // Needed at least on Windows. Raise() is not enough
    dlg.Show(true);

    // Bring it to the top if already open.  Dual monitor users need this.
    dlg.Raise();

    dlg.ShowEditTab();

    return 0;
  }

  *EditSymbolLibraryLinks(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    // InvokeDialogEditSymbolsLibId: true when the dialog changed something
    const result = yield* this.RunMainStackModal(() =>
      this.m_frame!.ShowModalDialog('DIALOG_EDIT_SYMBOLS_LIBID', []),
    );

    if (result === wxID_OK) this.m_frame!.HardRedraw();

    return 0;
  }

  UpdatePCB(_aEvent: TOOL_EVENT): number {
    this.m_frame!.OnUpdatePCB();
    return 0;
  }

  *UpdateFromPCB(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    yield* this.RunMainStackModal(() =>
      this.m_frame!.ShowModalDialog('DIALOG_UPDATE_FROM_PCB', []),
    );
    return 0;
  }

  *ExportNetlist(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    let result: number | null = NET_PLUGIN_CHANGE;

    // If a plugin is removed or added, rebuild and reopen the new dialog
    while (result === NET_PLUGIN_CHANGE)
      result = yield* this.RunMainStackModal(() =>
        this.m_frame!.ShowModalDialog('DIALOG_EXPORT_NETLIST', []),
      );

    return 0;
  }

  GenerateBOM(_aEvent: TOOL_EVENT): number {
    const dlg = this.m_frame!.GetSymbolFieldsTableDialog();

    if (!dlg) return 0; // wxCHECK

    // Needed at least on Windows. Raise() is not enough
    dlg.Show(true);

    // Bring it to the top if already open.  Dual monitor users need this.
    dlg.Raise();

    dlg.ShowExportTab();

    return 0;
  }

  *GenerateBOMLegacy(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    yield* this.RunMainStackModal(() => this.m_frame!.ShowModalDialog('DIALOG_BOM', []));
    return 0;
  }

  ShowSearch(_aEvent: TOOL_EVENT): number {
    this.getEditFrame<SCH_EDIT_FRAME>().ToggleSearch();
    return 0;
  }

  ShowHierarchy(_aEvent: TOOL_EVENT): number {
    this.getEditFrame<SCH_EDIT_FRAME>().ToggleSchematicHierarchy();
    return 0;
  }

  ShowNetNavigator(_aEvent: TOOL_EVENT): number {
    this.getEditFrame<SCH_EDIT_FRAME>().ToggleNetNavigator();
    return 0;
  }

  ToggleProperties(_aEvent: TOOL_EVENT): number {
    this.getEditFrame<SCH_EDIT_FRAME>().ToggleProperties();
    return 0;
  }

  ToggleLibraryTree(_aEvent: TOOL_EVENT): number {
    this.getEditFrame<SCH_EDIT_FRAME>().ToggleLibraryTree();
    return 0;
  }

  ToggleRemoteSymbolPanel(_aEvent: TOOL_EVENT): number {
    this.getEditFrame<SCH_EDIT_FRAME>().ToggleRemoteSymbolPanel();
    return 0;
  }

  // The toggles below assign into EESCHEMA_SETTINGS upstream; the store here replaces, so each
  // computes the new value, writes it through the updater and uses it.

  ToggleHiddenPins(_aEvent: TOOL_EVENT): number {
    const show = !this.m_frame!.eeconfig()!.appearance.show_hidden_pins;
    updateEeschemaSettings((s) => (s.appearance.show_hidden_pins = show));

    this.getView()!.UpdateAllItems(VIEW_UPDATE_FLAGS.REPAINT);
    this.m_frame!.GetCanvas()?.Refresh();

    return 0;
  }

  ToggleHiddenFields(_aEvent: TOOL_EVENT): number {
    const show = !this.m_frame!.eeconfig()!.appearance.show_hidden_fields;
    updateEeschemaSettings((s) => (s.appearance.show_hidden_fields = show));

    this.m_frame!.GetRenderSettings()!.m_ShowHiddenFields = show;

    this.getView()!.UpdateAllItems(VIEW_UPDATE_FLAGS.REPAINT);
    this.m_frame!.GetCanvas()?.Refresh();

    return 0;
  }

  ToggleDirectiveLabels(_aEvent: TOOL_EVENT): number {
    const show = !this.m_frame!.eeconfig()!.appearance.show_directive_labels;
    updateEeschemaSettings((s) => (s.appearance.show_directive_labels = show));

    this.getView()!.UpdateAllItems(VIEW_UPDATE_FLAGS.REPAINT);
    this.m_frame!.GetCanvas()?.Refresh();

    return 0;
  }

  ToggleERCWarnings(_aEvent: TOOL_EVENT): number {
    const show = !this.m_frame!.eeconfig()!.appearance.show_erc_warnings;
    updateEeschemaSettings((s) => (s.appearance.show_erc_warnings = show));

    this.getView()!.SetLayerVisible(SCH_LAYER_ID.LAYER_ERC_WARN, show);
    this.m_frame!.GetCanvas()?.Refresh();

    return 0;
  }

  ToggleERCErrors(_aEvent: TOOL_EVENT): number {
    const show = !this.m_frame!.eeconfig()!.appearance.show_erc_errors;
    updateEeschemaSettings((s) => (s.appearance.show_erc_errors = show));

    this.getView()!.SetLayerVisible(SCH_LAYER_ID.LAYER_ERC_ERR, show);
    this.m_frame!.GetCanvas()?.Refresh();

    return 0;
  }

  ToggleERCExclusions(_aEvent: TOOL_EVENT): number {
    const show = !this.m_frame!.eeconfig()!.appearance.show_erc_exclusions;
    updateEeschemaSettings((s) => (s.appearance.show_erc_exclusions = show));

    this.m_frame!.GetCanvas()?.Refresh();

    return 0;
  }

  TogglePinAltIcons(_aEvent: TOOL_EVENT): number {
    const show = !this.m_frame!.eeconfig()!.appearance.show_pin_alt_icons;
    updateEeschemaSettings((s) => (s.appearance.show_pin_alt_icons = show));

    this.m_frame!.GetRenderSettings()!.m_ShowPinAltIcons = show;

    this.getView()!.UpdateAllItems(VIEW_UPDATE_FLAGS.REPAINT);
    this.m_frame!.GetCanvas()?.Refresh();

    return 0;
  }

  ChangeLineMode(aEvent: TOOL_EVENT): number {
    const mode = aEvent.Parameter<LINE_MODE>();
    updateEeschemaSettings((s) => (s.drawing.line_mode = mode as 0 | 1 | 2));
    this.m_toolMgr!.PostAction(ACTIONS.refreshPreview);
    // Notify toolbar to update selection
    this.m_toolMgr!.RunAction(SCH_ACTIONS.angleSnapModeChanged);
    return 0;
  }

  NextLineMode(_aEvent: TOOL_EVENT): number {
    const mode = (this.m_frame!.eeconfig()!.drawing.line_mode + 1) % LINE_MODE.LINE_MODE_COUNT;
    updateEeschemaSettings((s) => (s.drawing.line_mode = mode as 0 | 1 | 2));
    this.m_toolMgr!.PostAction(ACTIONS.refreshPreview);
    // Notify toolbar to update selection
    this.m_toolMgr!.RunAction(SCH_ACTIONS.angleSnapModeChanged);
    return 0;
  }

  ToggleAnnotateAuto(_aEvent: TOOL_EVENT): number {
    const automatic = !this.m_frame!.eeconfig()!.annotation.automatic;
    updateEeschemaSettings((s) => (s.annotation.automatic = automatic));
    return 0;
  }

  OnAngleSnapModeChanged(_aEvent: TOOL_EVENT): number {
    // Update the left toolbar Line modes group icon to match current mode
    switch (this.m_frame!.eeconfig()!.drawing.line_mode as LINE_MODE) {
      case LINE_MODE.LINE_MODE_FREE:
        this.m_frame!.SelectToolbarAction(SCH_ACTIONS.lineModeFree);
        break;
      case LINE_MODE.LINE_MODE_90:
        this.m_frame!.SelectToolbarAction(SCH_ACTIONS.lineMode90);
        break;
      default:
        this.m_frame!.SelectToolbarAction(SCH_ACTIONS.lineMode45);
        break;
    }

    return 0;
  }

  GridFeedback(_aEvent: TOOL_EVENT): number {
    if (!PgmOrNull()?.GetCommonSettings()?.m_Input.hotkey_feedback) return 0;

    const settings = this.m_toolMgr!.GetSettings() as APP_SETTINGS_BASE;
    const gridSettings = settings.m_Window.grid;
    const currentIdx = settings.m_Window.grid.last_size_idx;

    const gridsLabels: string[] = [];

    for (const grid of gridSettings.grids)
      gridsLabels.push(grid.UserUnitsMessageText(this.m_frame!));

    if (!this.m_frame!.GetHotkeyPopup()) this.m_frame!.CreateHotkeyPopup();

    const popup = this.m_frame!.GetHotkeyPopup();

    if (popup) popup.Popup('Grid', gridsLabels, currentIdx);

    return 0;
  }

  protected override setTransitions(): void {
    // Not ported yet, in KiCad's order: New, Open, Save, SaveAs, SaveCurrSheetCopyAs, Revert
    // (files-io), RescueSymbols, ExportSymbolsToLibrary, the highlight-net and netclass handlers,
    // the clipboard, EditWithSymbolEditor, ShowCvpcb, ImportFPAssignments,
    // ImportNonKicadSchematic, ShowPcbNew, DrawSheetOnClipboard, the linked design blocks and
    // the variants. Left out, as the simulator is: SimProbe, SimTune, MarkSimExclusions,
    // ToggleOPVoltages, ToggleOPCurrents.
    this.Go(this.ShowSchematicSetup, SCH_ACTIONS.schematicSetup.MakeEvent());
    this.Go(this.PageSetup, ACTIONS.pageSettings.MakeEvent());
    this.Go(this.Print, ACTIONS.print.MakeEvent());
    this.Go(this.Plot, ACTIONS.plot.MakeEvent());

    this.Go(this.RemapSymbols, SCH_ACTIONS.remapSymbols.MakeEvent());

    this.Go(SYNC_HANDLER(this.CrossProbeToPcb), EVENTS.PointSelectedEvent);
    this.Go(SYNC_HANDLER(this.CrossProbeToPcb), EVENTS.SelectedEvent);
    this.Go(SYNC_HANDLER(this.CrossProbeToPcb), EVENTS.UnselectedEvent);
    this.Go(SYNC_HANDLER(this.CrossProbeToPcb), EVENTS.ClearedEvent);
    this.Go(SYNC_HANDLER(this.ExplicitCrossProbeToPcb), SCH_ACTIONS.selectOnPCB.MakeEvent());

    this.Go(SYNC_HANDLER(this.Undo), ACTIONS.undo.MakeEvent());
    this.Go(SYNC_HANDLER(this.Redo), ACTIONS.redo.MakeEvent());

    this.Go(SYNC_HANDLER(this.GridFeedback), EVENTS.GridChangedByKeyEvent);

    this.Go(SYNC_HANDLER(this.Annotate), SCH_ACTIONS.annotate.MakeEvent());
    this.Go(this.IncrementAnnotations, SCH_ACTIONS.incrementAnnotations.MakeEvent());
    this.Go(SYNC_HANDLER(this.EditSymbolFields), SCH_ACTIONS.editSymbolFields.MakeEvent());
    this.Go(this.EditSymbolLibraryLinks, SCH_ACTIONS.editSymbolLibraryLinks.MakeEvent());
    this.Go(SYNC_HANDLER(this.UpdatePCB), ACTIONS.updatePcbFromSchematic.MakeEvent());
    this.Go(this.UpdateFromPCB, ACTIONS.updateSchematicFromPcb.MakeEvent());
    this.Go(this.ExportNetlist, SCH_ACTIONS.exportNetlist.MakeEvent());
    this.Go(SYNC_HANDLER(this.GenerateBOM), SCH_ACTIONS.generateBOM.MakeEvent());
    this.Go(this.GenerateBOMLegacy, SCH_ACTIONS.generateBOMLegacy.MakeEvent());

    this.Go(SYNC_HANDLER(this.ShowSearch), ACTIONS.showSearch.MakeEvent());
    this.Go(SYNC_HANDLER(this.ShowHierarchy), SCH_ACTIONS.showHierarchy.MakeEvent());
    this.Go(SYNC_HANDLER(this.ShowNetNavigator), SCH_ACTIONS.showNetNavigator.MakeEvent());
    this.Go(SYNC_HANDLER(this.ToggleProperties), ACTIONS.showProperties.MakeEvent());
    this.Go(SYNC_HANDLER(this.ToggleLibraryTree), SCH_ACTIONS.showDesignBlockPanel.MakeEvent());
    this.Go(
      SYNC_HANDLER(this.ToggleRemoteSymbolPanel),
      SCH_ACTIONS.showRemoteSymbolPanel.MakeEvent(),
    );

    this.Go(SYNC_HANDLER(this.ToggleHiddenPins), SCH_ACTIONS.toggleHiddenPins.MakeEvent());
    this.Go(SYNC_HANDLER(this.ToggleHiddenFields), SCH_ACTIONS.toggleHiddenFields.MakeEvent());
    this.Go(
      SYNC_HANDLER(this.ToggleDirectiveLabels),
      SCH_ACTIONS.toggleDirectiveLabels.MakeEvent(),
    );
    this.Go(SYNC_HANDLER(this.ToggleERCWarnings), SCH_ACTIONS.toggleERCWarnings.MakeEvent());
    this.Go(SYNC_HANDLER(this.ToggleERCErrors), SCH_ACTIONS.toggleERCErrors.MakeEvent());
    this.Go(SYNC_HANDLER(this.ToggleERCExclusions), SCH_ACTIONS.toggleERCExclusions.MakeEvent());
    this.Go(SYNC_HANDLER(this.TogglePinAltIcons), SCH_ACTIONS.togglePinAltIcons.MakeEvent());
    this.Go(SYNC_HANDLER(this.ChangeLineMode), SCH_ACTIONS.lineModeFree.MakeEvent());
    this.Go(SYNC_HANDLER(this.ChangeLineMode), SCH_ACTIONS.lineMode90.MakeEvent());
    this.Go(SYNC_HANDLER(this.ChangeLineMode), SCH_ACTIONS.lineMode45.MakeEvent());
    this.Go(SYNC_HANDLER(this.NextLineMode), SCH_ACTIONS.lineModeNext.MakeEvent());
    this.Go(
      SYNC_HANDLER(this.OnAngleSnapModeChanged),
      SCH_ACTIONS.angleSnapModeChanged.MakeEvent(),
    );
    this.Go(SYNC_HANDLER(this.ToggleAnnotateAuto), SCH_ACTIONS.toggleAnnotateAuto.MakeEvent());
  }
}
