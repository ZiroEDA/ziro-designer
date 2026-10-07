// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SCH_INSPECTION_TOOL` (eeschema/tools/sch_inspection_tool.{h,cpp}): ERC dialog and marker
 * navigation, cross-probing a selected marker, excluding markers, the symbol-vs-library diff,
 * datasheets, bus syntax help and the message panel for the selection.
 *
 * The ERC dialog, the bus syntax help and the diff's canvas are the window's; the frame hands
 * them over (SCH_EDIT_FRAME::GetErcDialog and friends).
 */
import type { EMBEDDED_FILES } from '@ziroeda/common/embedded_files.js';
import { GetAssociatedDocument } from '@ziroeda/common/eda_doc.js';
import type { EDA_TEXT } from '@ziroeda/common/eda_text.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import type { RC_ITEM } from '@ziroeda/common/rc_item.js';
import { EscapeHTML } from '@ziroeda/common/string_utils.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { ACTIONS, EVENTS } from '@ziroeda/common/tool/actions.js';
import type { COROUTINE_BODY } from '@ziroeda/common/tool/coroutine.js';
import { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import type { TOOL_EVENT } from '@ziroeda/common/tool/tool_event.js';
import { SYNC_HANDLER } from '@ziroeda/common/tool/tool_interactive.js';
import { GetMsgPanelDisplayUuid, MSG_PANEL_ITEM } from '@ziroeda/common/widgets/msgpanel.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { ERCE_T } from '../erc/erc_settings.js';
import type { LIB_SYMBOL } from '../lib_symbol.js';
import type { SCH_BASE_FRAME } from '../sch_base_frame.js';
import { SCH_EDIT_FRAME } from '../sch_edit_frame.js';
import { SCH_FIELD } from '../sch_field.js';
import { SCH_ITEM } from '../sch_item.js';
import type { SCH_MARKER } from '../sch_marker.js';
import { SCH_SYMBOL } from '../sch_symbol.js';
import { SYMBOL_EDIT_FRAME } from '../symbol_editor/symbol_edit_frame.js';
import { SYMBOL_DIFF_WIDGET } from '../widgets/symbol_diff_widget.js';
import { SCH_ACTIONS } from './sch_actions.js';
import { SCH_CONDITIONS, SCH_SELECTION_TOOL } from './sch_selection_tool.js';
import { SCH_TOOL_BASE } from './sch_tool_base.js';

export class SCH_INSPECTION_TOOL extends SCH_TOOL_BASE<SCH_BASE_FRAME> {
  constructor() {
    super('eeschema.InspectionTool');
  }

  override Init(): boolean {
    super.Init();

    // Add inspection actions to the selection tool menu
    //
    const selToolMenu = this.m_selectionTool!.GetToolMenu().GetMenu();

    selToolMenu.AddItem(SCH_ACTIONS.excludeMarker, SCH_CONDITIONS.SingleNonExcludedMarker, 100);

    selToolMenu.AddItem(
      ACTIONS.showDatasheet,
      SCH_CONDITIONS.And(SCH_CONDITIONS.SingleSymbol, SCH_CONDITIONS.Idle),
      220,
    );

    return true;
  }

  override Reset(aReason: RESET_REASON): void {
    super.Reset(aReason);

    // wxQueueEvent( m_frame, EDA_EVT_CLOSE_ERC_DIALOG )
    if (aReason === RESET_REASON.SUPERMODEL_RELOAD || aReason === RESET_REASON.SHUTDOWN) {
      if (this.m_frame instanceof SCH_EDIT_FRAME) this.m_frame.CloseErcDialog();
    }
  }

  RunERC(_aEvent: TOOL_EVENT): number {
    this.ShowERCDialog();
    return 0;
  }

  ShowERCDialog(): void {
    const frame = this.m_frame instanceof SCH_EDIT_FRAME ? this.m_frame : null;

    if (!frame) return; // wxCHECK

    const dlg = frame.GetErcDialog();

    if (!dlg) return; // wxCHECK

    // Needed at least on Windows. Raise() is not enough
    dlg.Show(true);

    // Bring it to the top if already open.  Dual monitor users need this.
    dlg.Raise();

    // KIPLATFORM::UI::ForceFocus( okButton ); okButton->SetDefault(): the dialog's own.
    dlg.FocusOkButton();
  }

  PrevMarker(_aEvent: TOOL_EVENT): number {
    const frame = this.m_frame instanceof SCH_EDIT_FRAME ? this.m_frame : null;

    if (!frame) return 0; // wxCHECK

    const dlg = frame.GetErcDialog();

    if (dlg) {
      dlg.Show(true);
      dlg.Raise();
      dlg.PrevMarker();
    }

    return 0;
  }

  NextMarker(_aEvent: TOOL_EVENT): number {
    const frame = this.m_frame instanceof SCH_EDIT_FRAME ? this.m_frame : null;

    if (!frame) return 0; // wxCHECK

    const dlg = frame.GetErcDialog();

    if (!dlg) return 0; // wxCHECK

    dlg.Show(true);
    dlg.Raise();
    dlg.NextMarker();

    return 0;
  }

  /** `CrossProbe( const TOOL_EVENT& )`: the selected marker in the ERC dialog, and the message panel. */
  CrossProbe(aEvent: TOOL_EVENT): number {
    const selectionTool = this.m_toolMgr!.GetTool(SCH_SELECTION_TOOL);

    if (!selectionTool) return 0; // wxCHECK

    const selection = selectionTool.GetSelection();

    if (selection.GetSize() === 1 && selection.Front()!.Type() === KICAD_T.SCH_MARKER_T) {
      const frame = this.m_frame instanceof SCH_EDIT_FRAME ? this.m_frame : null;
      const dlg = frame ? frame.GetErcDialog() : null;

      if (dlg?.IsShownOnScreen()) dlg.SelectMarker(selection.Front() as SCH_MARKER);
    }

    // Show the item info on a left click on this item
    this.UpdateMessagePanel(aEvent);

    return 0;
  }

  /** `CrossProbe( const SCH_MARKER* )`: show \a aMarker in the ERC dialog. */
  CrossProbeMarker(aMarker: SCH_MARKER): void {
    const frame = this.m_frame instanceof SCH_EDIT_FRAME ? this.m_frame : null;

    if (!frame) return; // wxCHECK

    const dlg = frame.GetErcDialog();

    if (dlg) {
      if (!dlg.IsShownOnScreen()) {
        dlg.Show(true);
        dlg.Raise();
      }

      dlg.SelectMarker(aMarker);
    }
  }

  InspectERCErrorMenuText(aERCItem: RC_ITEM): string {
    if (aERCItem.GetErrorCode() === ERCE_T.ERCE_BUS_TO_NET_CONFLICT) {
      return this.m_frame!.GetRunMenuCommandDescription(SCH_ACTIONS.showBusSyntaxHelp);
    } else if (aERCItem.GetErrorCode() === ERCE_T.ERCE_LIB_SYMBOL_MISMATCH) {
      return this.m_frame!.GetRunMenuCommandDescription(SCH_ACTIONS.diffSymbol);
    }

    return '';
  }

  *InspectERCError(aERCItem: RC_ITEM): COROUTINE_BODY<void> {
    const frame = this.m_frame instanceof SCH_EDIT_FRAME ? this.m_frame : null;

    if (!frame) return; // wxCHECK

    const a = frame.ResolveItem(aERCItem.GetMainItemID());

    if (aERCItem.GetErrorCode() === ERCE_T.ERCE_BUS_TO_NET_CONFLICT) {
      this.m_toolMgr!.RunAction(SCH_ACTIONS.showBusSyntaxHelp);
    } else if (aERCItem.GetErrorCode() === ERCE_T.ERCE_LIB_SYMBOL_MISMATCH) {
      if (a instanceof SCH_SYMBOL) yield* this.DiffSymbolItem(a);
    }
  }

  ExcludeMarker(_aEvent: TOOL_EVENT): number {
    const selTool = this.m_toolMgr!.GetTool(SCH_SELECTION_TOOL)!;
    const selection = selTool.GetSelection();
    let marker: SCH_MARKER | null = null;

    if (selection.GetSize() === 1 && selection.Front()!.Type() === KICAD_T.SCH_MARKER_T)
      marker = selection.Front() as SCH_MARKER;

    const frame = this.m_frame instanceof SCH_EDIT_FRAME ? this.m_frame : null;

    if (!frame) return 0; // wxCHECK

    const dlg = frame.GetErcDialog();

    if (!dlg) return 0; // wxCHECK

    // Let the ERC dialog handle it since it owns the marker provider's cached counts and view
    // updates. If marker is nullptr the dialog excludes whichever marker is selected in the
    // dialog itself.
    dlg.ExcludeMarker(marker);

    return 0;
  }

  ShowBusSyntaxHelp(_aEvent: TOOL_EVENT): number {
    // m_busSyntaxHelp: SCH_TEXT::ShowSyntaxHelp( m_frame ) is a modeless HTML window the frame
    // keeps; raising an open one is the window's.
    this.m_frame!.ShowBusSyntaxHelp();
    return 0;
  }

  *DiffSymbol(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const schEditorFrame = this.m_frame instanceof SCH_EDIT_FRAME ? this.m_frame : null;

    if (!schEditorFrame) return 0; // wxCHECK

    const selection = this.m_selectionTool!.RequestSelection([KICAD_T.SCH_SYMBOL_T]);

    if (selection.Empty()) {
      this.m_frame!.ShowInfoBarError('Select a symbol to diff against its library equivalent.');
      return 0;
    }

    yield* this.DiffSymbolItem(selection.Front() as SCH_SYMBOL);
    return 0;
  }

  /**
   * `DiffSymbol( SCH_SYMBOL* )`: the schematic copy against the library's, reported into the
   * frame's Compare Symbol with Library dialog. The library loads asynchronously here, so the
   * coroutine waits on it.
   */
  *DiffSymbolItem(symbol: SCH_SYMBOL): COROUTINE_BODY<void> {
    const schEditorFrame = this.m_frame instanceof SCH_EDIT_FRAME ? this.m_frame : null;

    if (!schEditorFrame) return; // wxCHECK

    const dialog = schEditorFrame.GetSymbolDiffDialog();

    dialog.DeleteAllPages();
    dialog.SetUserItemID(symbol.m_Uuid);

    const symbolDesc = `Symbol ${symbol.GetField(FIELD_T.REFERENCE)!.GetText()}`;
    const libId = symbol.GetLibId();
    const libName = libId.GetLibNickname();
    const symbolName = libId.GetLibItemName();

    const r = dialog.AddHTMLPage('Summary');

    r.Report('<h7>' + 'Schematic vs library diff for:' + '</h7>');
    r.Report(
      '<ul><li>' +
        EscapeHTML(symbolDesc) +
        '</li>' +
        '<li>' +
        'Library: ' +
        EscapeHTML(libName) +
        '</li>' +
        '<li>' +
        'Library item: ' +
        EscapeHTML(symbolName) +
        '</li></ul>',
    );

    r.Report('');

    if (!schEditorFrame.SymbolLibHasLibrary(libName, false)) {
      r.Report(
        'The library is not included in the current configuration.' +
          '&nbsp;&nbsp;&nbsp' +
          "<a href='$CONFIG'>" +
          'Manage Symbol Libraries' +
          '</a>',
      );
    } else if (!schEditorFrame.SymbolLibHasLibrary(libName, true)) {
      r.Report(
        'The library is not enabled in the current configuration.' +
          '&nbsp;&nbsp;&nbsp' +
          "<a href='$CONFIG'>" +
          'Manage Symbol Libraries' +
          '</a>',
      );
    } else {
      let flattenedLibSymbol: LIB_SYMBOL | null = null;
      const flattenedSchSymbol = symbol.GetLibSymbolRef()!.Flatten();

      // libs->LoadSymbol( libName, symbolName ); an IO_ERROR leaves it null
      const libAlias = yield* this.RunMainStackModal(() => schEditorFrame.GetLibSymbol(libId));

      if (libAlias) flattenedLibSymbol = libAlias.Flatten();

      if (!flattenedLibSymbol) {
        r.Report(`The library no longer contains the item ${symbolName}.`);
      } else {
        const fields: SCH_FIELD[] = [];

        for (const field of symbol.GetFields()) {
          const copy = new SCH_FIELD(flattenedLibSymbol, field.GetId(), field.GetName(false));
          copy.CopyText(field as unknown as EDA_TEXT);
          copy.SetAttributes(field as unknown as EDA_TEXT);
          const pos = symbol.GetPosition();
          copy.Move({ x: -pos.x, y: -pos.y });
          fields.push(copy);
        }

        flattenedSchSymbol.SetFields(fields);

        if (flattenedSchSymbol.Compare(flattenedLibSymbol, SCH_ITEM.COMPARE_FLAGS.ERC, r) === 0) {
          r.Report('No relevant differences detected.');
        }

        const panel = dialog.AddBlankPage('Visual');
        const diff = this.constructDiffPanel(panel);

        diff.DisplayDiff(
          flattenedSchSymbol,
          flattenedLibSymbol,
          symbol.GetUnit(),
          symbol.GetBodyStyle(),
        );
      }
    }

    r.Flush();

    // dialog->Raise(); dialog->Show( true )
    dialog.Show(true);
  }

  private constructDiffPanel(aParentPanel: { content: unknown }): SYMBOL_DIFF_WIDGET {
    const diffWidget = new SYMBOL_DIFF_WIDGET();
    aParentPanel.content = diffWidget;
    return diffWidget;
  }

  ShowDatasheet(_aEvent: TOOL_EVENT): number {
    let datasheet = '';
    const filesStack: EMBEDDED_FILES[] = [];

    if (this.m_frame!.IsType(FRAME_T.FRAME_SCH_SYMBOL_EDITOR)) {
      const symbol = (this.m_frame as unknown as SYMBOL_EDIT_FRAME).GetCurSymbol();

      if (!symbol) return 0;

      datasheet = symbol.GetDatasheetField().GetText();
      filesStack.push(symbol.GetEmbeddedFiles());
    } else if (this.m_frame!.IsType(FRAME_T.FRAME_SCH_VIEWER)) {
      // SYMBOL_VIEWER_FRAME::GetSelectedSymbol(): the viewer is not on the live model yet.
      return 0;
    } else if (this.m_frame!.IsType(FRAME_T.FRAME_SCH)) {
      const selection = this.m_selectionTool!.RequestSelection([KICAD_T.SCH_SYMBOL_T]);

      if (selection.Empty()) return 0;

      const symbol = selection.Front() as SCH_SYMBOL;
      const field = symbol.GetField(FIELD_T.DATASHEET)!;

      // Use GetShownText() to resolve any text variables, but don't allow adding extra text
      // (ie: the field name)
      datasheet = field.GetShownText(symbol.Schematic()!.CurrentSheet(), false);
      filesStack.push(symbol.Schematic()!.GetEmbeddedFiles());

      if (symbol.GetLibSymbolRef()) filesStack.push(symbol.GetLibSymbolRef()!.GetEmbeddedFiles());
    }

    if (datasheet === '' || datasheet === '~') {
      this.m_frame!.ShowInfoBarError('No datasheet defined.');
    } else {
      // PROJECT_SCH::SchSearchS( &Prj() ): no search stack here (see project_sch.ts).
      GetAssociatedDocument(
        datasheet,
        (token) => this.m_frame!.Prj().TextVarResolver(token),
        filesStack,
      );
    }

    return 0;
  }

  UpdateMessagePanel(_aEvent: TOOL_EVENT): number {
    const symbolEditFrame = this.m_frame instanceof SYMBOL_EDIT_FRAME ? this.m_frame : null;
    const schEditFrame = this.m_frame instanceof SCH_EDIT_FRAME ? this.m_frame : null;
    const selTool = this.m_toolMgr!.GetTool(SCH_SELECTION_TOOL)!;
    const selection = selTool.GetSelection();

    // Note: the symbol viewer manages its own message panel

    if (symbolEditFrame || schEditFrame) {
      if (selection.GetSize() === 1) {
        const item = selection.Front()!;
        const msgItems: MSG_PANEL_ITEM[] = [];

        const uuid = GetMsgPanelDisplayUuid(item.m_Uuid);

        if (uuid !== undefined) msgItems.push(new MSG_PANEL_ITEM('UUID', uuid));

        item.GetMsgPanelInfo(this.m_frame!.AsDrawFrameLike(), msgItems);
        this.m_frame!.SetMsgPanel(msgItems);
      } else {
        this.m_frame!.ClearMsgPanel();
      }
    }

    if (schEditFrame) {
      schEditFrame.UpdateNetHighlightStatus();
      schEditFrame.UpdateHierarchySelection();
    }

    return 0;
  }

  protected override setTransitions(): void {
    this.Go(SYNC_HANDLER(this.RunERC), SCH_ACTIONS.runERC.MakeEvent());
    this.Go(SYNC_HANDLER(this.PrevMarker), SCH_ACTIONS.prevMarker.MakeEvent());
    this.Go(SYNC_HANDLER(this.NextMarker), SCH_ACTIONS.nextMarker.MakeEvent());
    // See note 1:
    this.Go(SYNC_HANDLER(this.CrossProbe), EVENTS.PointSelectedEvent);
    this.Go(SYNC_HANDLER(this.CrossProbe), EVENTS.SelectedEvent);
    this.Go(SYNC_HANDLER(this.ExcludeMarker), SCH_ACTIONS.excludeMarker.MakeEvent());

    // CheckSymbol (the Symbol Editor's checker) and RunSimulation (the simulator frame) come with
    // their frames.
    this.Go(this.DiffSymbol, SCH_ACTIONS.diffSymbol.MakeEvent());
    this.Go(SYNC_HANDLER(this.ShowBusSyntaxHelp), SCH_ACTIONS.showBusSyntaxHelp.MakeEvent());

    this.Go(SYNC_HANDLER(this.ShowDatasheet), ACTIONS.showDatasheet.MakeEvent());

    // Note 1: tUpdateMessagePanel is called by CrossProbe. So uncomment this line if
    // call to CrossProbe is modifiied
    // Go( &SCH_INSPECTION_TOOL::UpdateMessagePanel, EVENTS::SelectedEvent );
    this.Go(SYNC_HANDLER(this.UpdateMessagePanel), EVENTS.UnselectedEvent);
    this.Go(SYNC_HANDLER(this.UpdateMessagePanel), EVENTS.ClearedEvent);
    this.Go(SYNC_HANDLER(this.UpdateMessagePanel), EVENTS.SelectedItemsModified);
  }
}
