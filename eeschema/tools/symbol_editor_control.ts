// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SYMBOL_EDITOR_CONTROL` (eeschema/tools/symbol_editor_control.{h,cpp}): the symbol editor's
 * view toggles, unit stepping, flattening a derived symbol, and the library fields table.
 *
 * Still to come, with the library tree and what they call: Init's tree context menu,
 * OpenWithTextEditor and OpenDirectory. Their actions are not bound until they are.
 */
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import type { COROUTINE_BODY } from '@ziroeda/common/tool/coroutine.js';
import type { TOOL_EVENT } from '@ziroeda/common/tool/tool_event.js';
import { SYNC_HANDLER } from '@ziroeda/common/tool/tool_interactive.js';
import { VIEW_UPDATE_FLAGS } from '@ziroeda/common/view/view_item.js';
import { DisplayErrorMessage } from '@ziroeda/common/confirm.js';
import { ESCAPE_CONTEXT, EscapeString, unescapeString } from '@ziroeda/common/string_utils.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { LIBRARY_EDITOR_CONTROL } from '@ziroeda/common/tool/library_editor_control.js';
import { LIB_SYMBOL } from '../lib_symbol.js';
import { wxBell } from '@ziroeda/wx/utils.js';
import { schIUScale } from '@ziroeda/common/eda_units.js';
import { PAGE_INFO } from '@ziroeda/common/page_info.js';
import { SVGFileExtension } from '@ziroeda/common/wildcards_and_files_ext.js';
import { BITMAP_TYPE } from '@ziroeda/common/bitmap.js';
import { wxICON_ERROR, wxOK } from '@ziroeda/wx/defs.js';
import type { SCH_BASE_FRAME } from '../sch_base_frame.js';
import {
  currentSymbolEditorSettings,
  updateSymbolEditorSettings,
} from '../symbol_editor/symbol_editor_settings.js';
import type { SYMBOL_EDIT_FRAME } from '../symbol_editor/symbol_edit_frame.js';
import type { SYMBOL_VIEWER_FRAME } from '../symbol_viewer_frame.js';
import { type PLACE_SYMBOL_PARAMS, SCH_ACTIONS } from './sch_actions.js';
import type { SCH_EDIT_FRAME } from '../sch_edit_frame.js';
import { SCH_SYMBOL } from '../sch_symbol.js';
import { AUTOPLACE_ALGO } from '../sch_item.js';
import { SCH_TOOL_BASE } from './sch_tool_base.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { _ } from '@ziroeda/wx/translation.js';
import { wxFormat } from '@ziroeda/wx/wxstring.js';

/** `DIALOG_LIB_FIELDS_TABLE::SCOPE`. */
export enum DIALOG_LIB_FIELDS_TABLE_SCOPE {
  SCOPE_LIBRARY = 0,
  SCOPE_RELATED_SYMBOLS = 1,
}

export class SYMBOL_EDITOR_CONTROL extends SCH_TOOL_BASE<SCH_BASE_FRAME> {
  constructor() {
    super('eeschema.SymbolLibraryControl');
  }

  /** `getEditFrame<SYMBOL_EDIT_FRAME>()`. */
  private editFrame(): SYMBOL_EDIT_FRAME {
    return this.m_frame as unknown as SYMBOL_EDIT_FRAME;
  }

  ToggleProperties(_aEvent: TOOL_EVENT): number {
    if (this.m_frame!.IsType(FRAME_T.FRAME_SCH_SYMBOL_EDITOR)) this.editFrame().ToggleProperties();

    return 0;
  }

  ShowElectricalTypes(_aEvent: TOOL_EVENT): number {
    const renderSettings = this.m_frame!.GetRenderSettings()!;
    renderSettings.m_ShowPinsElectricalType = !renderSettings.m_ShowPinsElectricalType;

    // Update canvas
    this.m_frame!.GetCanvas()!.GetView().UpdateAllItems(VIEW_UPDATE_FLAGS.REPAINT);
    this.m_frame!.GetCanvas()!.Refresh();

    return 0;
  }

  ShowPinNumbers(_aEvent: TOOL_EVENT): number {
    const renderSettings = this.m_frame!.GetRenderSettings()!;
    renderSettings.m_ShowPinNumbers = !renderSettings.m_ShowPinNumbers;

    // Update canvas
    this.m_frame!.GetCanvas()!.GetView().UpdateAllItems(VIEW_UPDATE_FLAGS.REPAINT);
    this.m_frame!.GetCanvas()!.Refresh();

    return 0;
  }

  ToggleSyncedPinsMode(_aEvent: TOOL_EVENT): number {
    if (!this.m_isSymbolEditor) return 0;

    const editFrame = this.editFrame();
    editFrame.m_SyncPinEdit = !editFrame.m_SyncPinEdit;

    return 0;
  }

  ToggleHiddenPins(_aEvent: TOOL_EVENT): number {
    if (!this.m_isSymbolEditor) return 0;

    // cfg->m_ShowHiddenPins = !cfg->m_ShowHiddenPins: the settings are the live symbol_editor.json slice here.
    const show = !currentSymbolEditorSettings().show_hidden_lib_pins;
    updateSymbolEditorSettings((cfg) => {
      cfg.show_hidden_lib_pins = show;
    });

    this.editFrame().GetRenderSettings()!.m_ShowHiddenPins = show;

    this.getView()!.UpdateAllItems(VIEW_UPDATE_FLAGS.REPAINT);
    this.m_frame!.GetCanvas()!.Refresh();
    return 0;
  }

  ToggleHiddenFields(_aEvent: TOOL_EVENT): number {
    if (!this.m_isSymbolEditor) return 0;

    // cfg->m_ShowHiddenFields = !cfg->m_ShowHiddenFields: the settings are the live symbol_editor.json slice here.
    const show = !currentSymbolEditorSettings().show_hidden_lib_fields;
    updateSymbolEditorSettings((cfg) => {
      cfg.show_hidden_lib_fields = show;
    });

    this.editFrame().GetRenderSettings()!.m_ShowHiddenFields = show;

    this.getView()!.UpdateAllItems(VIEW_UPDATE_FLAGS.REPAINT);
    this.m_frame!.GetCanvas()!.Refresh();
    return 0;
  }

  TogglePinAltIcons(_aEvent: TOOL_EVENT): number {
    if (!this.m_isSymbolEditor) return 0;

    // cfg->m_ShowPinAltIcons = !cfg->m_ShowPinAltIcons: the settings are the live symbol_editor.json slice here.
    const show = !currentSymbolEditorSettings().show_pin_alt_icons;
    updateSymbolEditorSettings((cfg) => {
      cfg.show_pin_alt_icons = show;
    });

    this.m_frame!.GetRenderSettings()!.m_ShowPinAltIcons = show;

    this.getView()!.UpdateAllItems(VIEW_UPDATE_FLAGS.REPAINT);
    this.m_frame!.GetCanvas()!.Refresh();
    return 0;
  }

  *AddLibrary(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const createNew = aEvent.IsAction(ACTIONS.newLibrary);

    if (this.m_frame!.IsType(FRAME_T.FRAME_SCH_SYMBOL_EDITOR))
      yield* this.RunMainStackModal(() => this.editFrame().AddLibraryFile(createNew));

    return 0;
  }

  /** `DdAddLibrary( aEvent )` (symbol_editor_control.cpp:254-262): a dropped library file added. */
  *DdAddLibrary(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const libFile = aEvent.Parameter<string>();

    if (this.m_frame!.IsType(FRAME_T.FRAME_SCH_SYMBOL_EDITOR))
      yield* this.RunMainStackModal(() => this.editFrame().DdAddLibrary(libFile));

    return 0;
  }

  *EditSymbol(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    if (!this.m_isSymbolEditor) return 0;

    const editFrame = this.editFrame();
    const unit = { value: 0 };
    const partId = editFrame.GetTreeLIBID(unit);

    yield* this.RunMainStackModal(() =>
      editFrame.LoadSymbol(partId.GetLibItemName(), partId.GetLibNickname(), unit.value),
    );
    return 0;
  }

  *EditLibrarySymbol(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const editFrame = this.editFrame();
    const symbol = editFrame.GetCurSymbol();

    if (!symbol || !editFrame.IsSymbolFromSchematic()) {
      wxBell();
      return 0;
    }

    const libId = symbol.GetLibId();

    const loaded = yield* this.RunMainStackModal(() =>
      editFrame.LoadSymbol(libId, editFrame.GetUnit(), editFrame.GetBodyStyle()),
    );

    if (loaded === true) {
      if (!editFrame.IsLibraryTreeShown()) editFrame.ToggleLibraryTree();
    } else {
      const libName = libId.GetLibNickname();
      const symbolName = libId.GetLibItemName();

      DisplayErrorMessage(
        wxFormat(
          _('Failed to load symbol %s from library %s.'),
          unescapeString(symbolName),
          unescapeString(libName),
        ),
      );
    }
    return 0;
  }

  *AddSymbol(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    if (!this.m_isSymbolEditor) return 0;

    const editFrame = this.editFrame();
    const target = editFrame.GetTargetLibId();
    const libName = target.GetLibNickname();

    if (libName === '') {
      this.m_frame!.ShowInfoBarError(_('No symbol library selected.'));
      return 0;
    }

    if (!editFrame.GetLibManager().LibraryExists(libName)) {
      this.m_frame!.ShowInfoBarError(wxFormat(_("Symbol library '%s' not found."), libName));
      return 0;
    }

    if (editFrame.GetLibManager().IsLibraryReadOnly(libName)) {
      this.m_frame!.ShowInfoBarError(wxFormat(_("Symbol library '%s' is not writable."), libName));
      return 0;
    }

    if (aEvent.IsAction(SCH_ACTIONS.newSymbol))
      yield* this.RunMainStackModal(() => editFrame.CreateNewSymbol());
    else if (aEvent.IsAction(SCH_ACTIONS.deriveFromExistingSymbol))
      yield* this.RunMainStackModal(() => editFrame.CreateNewSymbol(target.GetLibItemName()));
    else if (aEvent.IsAction(SCH_ACTIONS.importSymbol))
      yield* this.RunMainStackModal(() => editFrame.ImportSymbol());

    return 0;
  }

  *Save(aEvt: TOOL_EVENT): COROUTINE_BODY<number> {
    if (!this.m_isSymbolEditor) return 0;

    const editFrame = this.editFrame();

    if (aEvt.IsAction(ACTIONS.save)) yield* this.RunMainStackModal(() => editFrame.Save());
    else if (aEvt.IsAction(SCH_ACTIONS.saveLibraryAs))
      yield* this.RunMainStackModal(() => editFrame.SaveLibraryAs());
    else if (aEvt.IsAction(SCH_ACTIONS.saveSymbolAs))
      yield* this.RunMainStackModal(() => editFrame.SaveSymbolCopyAs(true));
    else if (aEvt.IsAction(SCH_ACTIONS.saveSymbolCopyAs))
      yield* this.RunMainStackModal(() => editFrame.SaveSymbolCopyAs(false));
    else if (aEvt.IsAction(ACTIONS.saveAll))
      yield* this.RunMainStackModal(() => editFrame.SaveAll());

    return 0;
  }

  *Revert(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    if (this.m_frame!.IsType(FRAME_T.FRAME_SCH_SYMBOL_EDITOR))
      yield* this.RunMainStackModal(() => this.editFrame().Revert());

    return 0;
  }

  *CutCopyDelete(aEvt: TOOL_EVENT): COROUTINE_BODY<number> {
    if (!this.m_isSymbolEditor) return 0;

    const editFrame = this.editFrame();

    if (aEvt.IsAction(SCH_ACTIONS.cutSymbol) || aEvt.IsAction(SCH_ACTIONS.copySymbol))
      editFrame.CopySymbolToClipboard();

    if (aEvt.IsAction(SCH_ACTIONS.cutSymbol) || aEvt.IsAction(SCH_ACTIONS.deleteSymbol)) {
      let hasWritableLibs = false;
      let msg = '';

      for (const sel of editFrame.GetSelectedLibIds()) {
        const libName = sel.GetLibNickname();

        if (!editFrame.GetLibManager().LibraryExists(libName))
          msg = wxFormat(_("Symbol library '%s' not found."), libName);
        else if (editFrame.GetLibManager().IsLibraryReadOnly(libName))
          msg = wxFormat(_("Symbol library '%s' is not writable."), libName);
        else hasWritableLibs = true;
      }

      if (msg !== '') this.m_frame!.ShowInfoBarError(msg);

      if (!hasWritableLibs) return 0;

      yield* this.RunMainStackModal(() => editFrame.DeleteSymbolFromLibrary());
    }

    return 0;
  }

  *DuplicateSymbol(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    if (!this.m_isSymbolEditor) return 0;

    const editFrame = this.editFrame();
    const sel = editFrame.GetTargetLibId();
    // DuplicateSymbol() is called to duplicate a symbol, or to paste a previously
    // saved symbol in clipboard
    const isPasteAction = aEvent.IsAction(SCH_ACTIONS.pasteSymbol);

    if (!sel.IsValid() && !isPasteAction) {
      // When duplicating a symbol, a source symbol must exists.
      this.m_frame!.ShowInfoBarError(_('No symbol selected'));
      return 0;
    }

    const libName = sel.GetLibNickname();

    if (!editFrame.GetLibManager().LibraryExists(libName)) {
      this.m_frame!.ShowInfoBarError(wxFormat(_("Symbol library '%s' not found."), libName));
      return 0;
    }

    if (editFrame.GetLibManager().IsLibraryReadOnly(libName)) {
      this.m_frame!.ShowInfoBarError(wxFormat(_("Symbol library '%s' is not writable."), libName));
      return 0;
    }

    yield* this.RunMainStackModal(() => editFrame.DuplicateSymbol(isPasteAction));
    return 0;
  }

  *RenameSymbol(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    if (!this.m_isSymbolEditor) return 0;

    const editFrame = this.editFrame();
    const libMgr = editFrame.GetLibManager();
    const libTool = this.m_toolMgr!.GetTool(LIBRARY_EDITOR_CONTROL);

    const libId = editFrame.GetTreeLIBID();
    const libName = libId.GetLibNickname();
    const oldName = libId.GetLibItemName();
    let newName = '';

    if (!libMgr.LibraryExists(libName)) return 0;

    const renamed = yield* this.RunMainStackModal(() =>
      libTool!.RenameLibrary(_('Change Symbol Name'), oldName, async (aNewName: string) => {
        newName = EscapeString(aNewName, ESCAPE_CONTEXT.CTX_LIBID);

        if (newName === '') {
          await editFrame.wxMessageBox(_('Symbol must have a name.'));
          return false;
        }

        // If no change, accept it without prompting
        if (newName !== oldName && libMgr.SymbolNameInUse(newName, libName)) {
          const msg = wxFormat(
            _("Symbol '%s' already exists in library '%s'."),
            unescapeString(newName),
            libName,
          );

          return (
            (await editFrame.ShowKiDialog({
              caption: _('Confirmation'),
              message: msg,
              icon: 'warning',
              labels: { ok: _('Overwrite') },
            })) === 'ok'
          );
        }

        return true;
      }),
    );

    if (renamed !== true) return 0; // cancelled by user

    if (newName === oldName) return 0;

    let libSymbol = libMgr.GetBufferedSymbol(oldName, libName);

    if (!libSymbol) return 0;

    // Renaming the current symbol
    const isCurrentSymbol = editFrame.IsCurrentSymbol(libId);
    let overwritingCurrentSymbol = false;

    if (libMgr.SymbolExists(newName, libName)) {
      // Overwriting the current symbol also need to update the open symbol
      const overwrittenSymbol = libMgr.GetBufferedSymbol(newName, libName)!;
      overwritingCurrentSymbol = editFrame.IsCurrentSymbol(overwrittenSymbol.GetLibId());
      libMgr.RemoveSymbol(newName, libName);
    }

    libSymbol.SetName(newName);

    if (libSymbol.GetValueField().GetText() === oldName) libSymbol.GetValueField().SetText(newName);

    libMgr.UpdateSymbolAfterRename(libSymbol, newName, libName);
    libMgr.SetSymbolModified(newName, libName);

    if (overwritingCurrentSymbol) {
      // We overwrite the old current symbol with the renamed one, so show
      // the renamed one now
      editFrame.SetCurSymbol(LIB_SYMBOL.copyOf(libSymbol), false);
    } else if (isCurrentSymbol && editFrame.GetCurSymbol()) {
      // Renamed the current symbol - follow it
      libSymbol = editFrame.GetCurSymbol()!;

      libSymbol.SetName(newName);

      if (libSymbol.GetValueField().GetText() === oldName)
        libSymbol.GetValueField().SetText(newName);

      editFrame.RebuildView();
      editFrame.OnModify();
      editFrame.UpdateTitle();

      // N.B. The view needs to be rebuilt first as the Symbol Properties change may
      // invalidate the view pointers by rebuilting the field table
      editFrame.UpdateMsgPanel();
    }

    // libMgr.GetAdapter()->FindItem( libId ): the tree is the window's.
    editFrame.UpdateLibraryTree(libId, libSymbol);
    editFrame.FocusOnLibId(new LIB_ID(libName, newName));
    return 0;
  }

  AddSymbolToSchematic(_aEvent: TOOL_EVENT): number {
    let libSymbol: LIB_SYMBOL | null = null;
    let libId = new LIB_ID();
    let unit = 0;
    let bodyStyle = 0;

    if (this.m_isSymbolEditor) {
      const editFrame = this.editFrame();

      libSymbol = editFrame.GetCurSymbol();
      unit = editFrame.GetUnit();
      bodyStyle = editFrame.GetBodyStyle();

      if (libSymbol) libId = libSymbol.GetLibId();
    } else {
      const viewerFrame = this.m_frame as unknown as SYMBOL_VIEWER_FRAME;

      libSymbol = viewerFrame.GetSelectedSymbol();
      unit = viewerFrame.GetUnit();
      bodyStyle = viewerFrame.GetBodyStyle();

      if (libSymbol) libId = libSymbol.GetLibId();
    }

    if (libSymbol) {
      const schframe = this.m_frame!.Kiway()?.GetPlayerFrame(
        FRAME_T.FRAME_SCH,
      ) as SCH_EDIT_FRAME | null;

      if (!schframe) {
        // happens when the schematic editor is not active (or closed)
        DisplayErrorMessage(_('No schematic currently open.'));
        return 0;
      }

      // `Kiway().GetBlockingDialog()`: a page has no window-modal dialog over the other frame.

      const symbol = new SCH_SYMBOL(libSymbol, libId, schframe.GetCurrentSheet(), unit, bodyStyle);

      symbol.SetParent(schframe.GetScreen());

      if (schframe.eeconfig()?.autoplace_fields.enable) {
        // Not placed yet, so pass a nullptr screen reference
        symbol.AutoplaceFields(null, AUTOPLACE_ALGO.AUTOPLACE_AUTO);
      }

      schframe.Raise();
      schframe.GetToolManager()!.PostAction<PLACE_SYMBOL_PARAMS>(SCH_ACTIONS.placeSymbol, {
        m_Symbol: symbol,
        m_Reannotate: true,
      });
    }

    return 0;
  }

  *ExportSymbol(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    if (this.m_frame!.IsType(FRAME_T.FRAME_SCH_SYMBOL_EDITOR))
      yield* this.RunMainStackModal(() => this.editFrame().ExportSymbol());

    return 0;
  }

  *ExportView(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    if (!this.m_isSymbolEditor) return 0;

    const editFrame = this.editFrame();
    const symbol = editFrame.GetCurSymbol();

    if (!symbol) {
      yield* this.RunMainStackModal(() => editFrame.wxMessageBox(_('No symbol to export')));
      return 0;
    }

    // `wxFileName fn( symbol->GetName() ); fn.SetExt( "png" );`
    const fn = `${symbol.GetName()}.png`;

    // `wxFileDialog( editFrame, _( "Export View as PNG" ), projectPath, fn.GetFullName(), ...,
    // wxFD_SAVE | wxFD_OVERWRITE_PROMPT )`: the image is downloaded, never written into the
    // project, so there is no folder to pick and it keeps the offered name. wxYield() refreshed
    // the screen under the closed dialog; GetScreenshot repaints anyway.
    const path = fn;

    if (!editFrame.SaveCanvasImageToFile(path, BITMAP_TYPE.PNG)) {
      yield* this.RunMainStackModal(() =>
        editFrame.wxMessageBox(wxFormat(_("Can't save file '%s'."), path)),
      );
    }

    return 0;
  }

  *ExportSymbolAsSVG(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    if (!this.m_isSymbolEditor) return 0;

    const editFrame = this.editFrame();
    const symbol = editFrame.GetCurSymbol();

    if (!symbol) {
      yield* this.RunMainStackModal(() => editFrame.wxMessageBox(_('No symbol to export')));
      return 0;
    }

    // `wxFileName fn( symbol->GetName() ); fn.SetExt( FILEEXT::SVGFileExtension );`
    const fn = `${symbol.GetName()}.${SVGFileExtension}`;

    // `wxFileSelector( _( "SVG File Name" ), pro_dir, fn.GetFullName(), ..., wxFD_SAVE )`: a
    // generated output is downloaded, never written into the project, so there is no folder to
    // pick and the file keeps the name the selector would have offered.
    const fullFileName = fn;

    if (fullFileName !== '') {
      const pageSave = editFrame.GetScreen()!.GetPageSettings();
      const pageTemp = PAGE_INFO.copyOf(pageSave);

      const symbolBBox = symbol.GetUnitBoundingBox(
        editFrame.GetUnit(),
        editFrame.GetBodyStyle(),
        false,
      );

      // Add a small margin (10% of size)to the plot bounding box
      // (BOX2I::Inflate takes coord_type, so the double margins truncate.)
      symbolBBox.Inflate(
        Math.trunc(symbolBBox.GetSize().x * 0.1),
        Math.trunc(symbolBBox.GetSize().y * 0.1),
      );

      pageTemp.SetWidthMils(schIUScale.iuToMils(symbolBBox.GetSize().x));
      pageTemp.SetHeightMils(schIUScale.iuToMils(symbolBBox.GetSize().y));

      // Add an offet to plot the symbol centered on the page.
      const plot_offset = symbolBBox.GetOrigin();

      editFrame.GetScreen()!.SetPageSettings(pageTemp);
      editFrame.SVGPlotSymbol(fullFileName, { x: -plot_offset.x, y: -plot_offset.y });
      editFrame.GetScreen()!.SetPageSettings(pageSave);
    }

    return 0;
  }

  *FlattenSymbol(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    if (!this.m_isSymbolEditor) return 0;

    const editFrame = this.editFrame();
    const libMgr = editFrame.GetLibManager();
    const symId = editFrame.GetTargetLibId();

    const messageBox = (aMessage: string) =>
      this.RunMainStackModal(() =>
        editFrame.ShowModalDialog('wxMessageBox', [], {
          message: aMessage,
          caption: 'Message',
          style: wxOK,
        }),
      );

    if (!symId.IsValid()) {
      yield* messageBox(_('No symbol to flatten'));
      return 0;
    }

    const symbol = libMgr.GetBufferedSymbol(symId.GetLibItemName(), symId.GetLibNickname());

    if (!symbol) return 0;

    const flatSymbol = symbol.Flatten();

    if (!flatSymbol) {
      // wxCHECK_MSG( flatSymbol, 0, _( "Failed to flatten symbol" ) )
      console.assert(false, _('Failed to flatten symbol'));
      return 0;
    }

    if (!libMgr.UpdateSymbol(flatSymbol, symId.GetLibNickname())) {
      yield* this.RunMainStackModal(() =>
        editFrame.ShowModalDialog('wxMessageBox', [], {
          message: _('Failed to update library with flattened symbol'),
          caption: 'Message',
          style: wxOK | wxICON_ERROR,
        }),
      );
      return 0;
    }

    editFrame.UpdateLibraryTree(symId, flatSymbol);

    return 0;
  }

  ChangeUnit(aEvent: TOOL_EVENT): number {
    if (!this.m_isSymbolEditor) return 0;

    const editFrame = this.editFrame();
    const deltaUnit = aEvent.Parameter<number>();

    const nUnits = editFrame.GetCurSymbol()!.GetUnitCount();
    const newUnit = ((editFrame.GetUnit() - 1 + deltaUnit + nUnits) % nUnits) + 1;

    editFrame.SetUnit(newUnit);

    return 0;
  }

  /**
   * `PreviousSymbol( aEvent )`. Upstream static_casts the tool holder to SYMBOL_VIEWER_FRAME
   * whatever it is; only the browser binds the action, so here that frame is checked for.
   */
  PreviousSymbol(_aEvent: TOOL_EVENT): number {
    if (this.m_frame!.IsType(FRAME_T.FRAME_SCH_VIEWER))
      (this.m_frame as unknown as SYMBOL_VIEWER_FRAME).SelectPreviousSymbol();

    return 0;
  }

  /** `NextSymbol( aEvent )`; see PreviousSymbol. */
  NextSymbol(_aEvent: TOOL_EVENT): number {
    if (this.m_frame!.IsType(FRAME_T.FRAME_SCH_VIEWER))
      (this.m_frame as unknown as SYMBOL_VIEWER_FRAME).SelectNextSymbol();

    return 0;
  }

  *ShowLibraryTable(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    let scope = DIALOG_LIB_FIELDS_TABLE_SCOPE.SCOPE_LIBRARY;

    if (aEvent.IsAction(SCH_ACTIONS.showRelatedLibFieldsTable))
      scope = DIALOG_LIB_FIELDS_TABLE_SCOPE.SCOPE_RELATED_SYMBOLS;

    // DIALOG_LIB_FIELDS_TABLE dlg( getEditFrame<SYMBOL_EDIT_FRAME>(), scope ): the window's.
    yield* this.RunMainStackModal(() =>
      this.editFrame().ShowModalDialog('DIALOG_LIB_FIELDS_TABLE', [], { scope }),
    );
    return 0;
  }

  protected override setTransitions(): void {
    this.Go(this.AddLibrary, ACTIONS.newLibrary.MakeEvent());
    this.Go(this.AddLibrary, ACTIONS.addLibrary.MakeEvent());
    this.Go(this.DdAddLibrary, ACTIONS.ddAddLibrary.MakeEvent());
    this.Go(this.AddSymbol, SCH_ACTIONS.newSymbol.MakeEvent());
    this.Go(this.AddSymbol, SCH_ACTIONS.deriveFromExistingSymbol.MakeEvent());
    this.Go(this.AddSymbol, SCH_ACTIONS.importSymbol.MakeEvent());
    this.Go(this.EditSymbol, SCH_ACTIONS.editSymbol.MakeEvent());
    this.Go(this.EditLibrarySymbol, SCH_ACTIONS.editLibSymbolWithLibEdit.MakeEvent());

    this.Go(this.Save, ACTIONS.save.MakeEvent());
    this.Go(this.Save, SCH_ACTIONS.saveLibraryAs.MakeEvent());
    this.Go(this.Save, SCH_ACTIONS.saveSymbolAs.MakeEvent());
    this.Go(this.Save, SCH_ACTIONS.saveSymbolCopyAs.MakeEvent());
    this.Go(this.Save, ACTIONS.saveAll.MakeEvent());
    this.Go(this.Revert, ACTIONS.revert.MakeEvent());

    this.Go(this.DuplicateSymbol, SCH_ACTIONS.duplicateSymbol.MakeEvent());
    this.Go(this.RenameSymbol, SCH_ACTIONS.renameSymbol.MakeEvent());
    this.Go(this.CutCopyDelete, SCH_ACTIONS.deleteSymbol.MakeEvent());
    this.Go(this.CutCopyDelete, SCH_ACTIONS.cutSymbol.MakeEvent());
    this.Go(this.CutCopyDelete, SCH_ACTIONS.copySymbol.MakeEvent());
    this.Go(this.DuplicateSymbol, SCH_ACTIONS.pasteSymbol.MakeEvent());
    this.Go(this.ExportSymbol, SCH_ACTIONS.exportSymbol.MakeEvent());
    this.Go(this.ExportView, SCH_ACTIONS.exportSymbolView.MakeEvent());
    this.Go(this.ExportSymbolAsSVG, SCH_ACTIONS.exportSymbolAsSVG.MakeEvent());
    this.Go(SYNC_HANDLER(this.AddSymbolToSchematic), SCH_ACTIONS.addSymbolToSchematic.MakeEvent());

    this.Go(this.FlattenSymbol, SCH_ACTIONS.flattenSymbol.MakeEvent());

    this.Go(SYNC_HANDLER(this.ShowElectricalTypes), SCH_ACTIONS.showElectricalTypes.MakeEvent());
    this.Go(SYNC_HANDLER(this.ShowPinNumbers), SCH_ACTIONS.showPinNumbers.MakeEvent());
    this.Go(SYNC_HANDLER(this.ToggleSyncedPinsMode), SCH_ACTIONS.toggleSyncedPinsMode.MakeEvent());

    this.Go(SYNC_HANDLER(this.ToggleProperties), ACTIONS.showProperties.MakeEvent());
    this.Go(SYNC_HANDLER(this.ToggleHiddenPins), SCH_ACTIONS.showHiddenPins.MakeEvent());
    this.Go(SYNC_HANDLER(this.ToggleHiddenFields), SCH_ACTIONS.showHiddenFields.MakeEvent());
    this.Go(SYNC_HANDLER(this.TogglePinAltIcons), SCH_ACTIONS.togglePinAltIcons.MakeEvent());

    this.Go(this.ShowLibraryTable, SCH_ACTIONS.showLibFieldsTable.MakeEvent());
    this.Go(this.ShowLibraryTable, SCH_ACTIONS.showRelatedLibFieldsTable.MakeEvent());

    this.Go(SYNC_HANDLER(this.ChangeUnit), SCH_ACTIONS.previousUnit.MakeEvent());
    this.Go(SYNC_HANDLER(this.ChangeUnit), SCH_ACTIONS.nextUnit.MakeEvent());

    this.Go(SYNC_HANDLER(this.PreviousSymbol), SCH_ACTIONS.previousSymbol.MakeEvent());
    this.Go(SYNC_HANDLER(this.NextSymbol), SCH_ACTIONS.nextSymbol.MakeEvent());
  }
}
