// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `EDA_BASE_FRAME` (include/eda_base_frame.h, common/eda_base_frame.cpp): the
 * base of every editor window — here the object the editor holds, not a
 * window: its identity (`FRAME_T`), its TOOLS_HOLDER half, its undo and redo
 * stacks and the modified flag. The wx window, the menu bar and the status
 * bar are the designer's React frame, which subclasses this.
 *
 * `EDA_BASE_FRAME` is also a `UNITS_PROVIDER` in the C++; the provider is
 * held as a member here and its two accessors forwarded, since a class has one
 * base.
 */
import type { EdaIuScale, EdaUnits } from './eda_units.js';
import { FRAME_T } from './frame_type.js';
import { Pgm } from './pgm_base.js';
import type { PROJECT } from './project.js';
import type { TOOL_MANAGER_FRAME_WITH_STATUS_BAR } from './tool/tool_manager.js';
import { TOOLS_HOLDER } from './tool/tools_holder.js';
import { type PICKED_ITEMS_LIST, UNDO_REDO_CONTAINER } from './undo_redo_container.js';
import { UNITS_PROVIDER } from './units_provider.js';
import { RPT_SEVERITY_UNDEFINED, type Severity } from './reporter.js';
import type { TOOL_ACTION } from './tool/tool_action.js';
import type { ACTION_MENU } from './tool/action_menu.js';
import type { APP_SETTINGS_BASE, WINDOW_SETTINGS } from './settings/app_settings.js';

export const DEFAULT_MAX_UNDO_ITEMS = 0;
export const ABS_MAX_UNDO_ITEMS = 65536;

/**
 * Specify whether we are interacting with the undo or redo stacks.
 */
export enum UNDO_REDO_LIST {
  UNDO_LIST,
  REDO_LIST,
}
export const { UNDO_LIST, REDO_LIST } = UNDO_REDO_LIST;

/**
 * `WX_INFOBAR`, as the frames and the draw panel read it: whether the bar is
 * locked open (the canvas keeps its bottom edge fixed under it).
 */
export interface WX_INFOBAR {
  IsLocked(): boolean;
}

/** `wxMenuBar` as `GetRunMenuCommandDescription` reads it. */
export interface MENU_BAR_LIKE {
  GetMenuCount(): number;
  GetMenuLabelText(aIndex: number): string;
  GetMenuItems(aIndex: number): readonly { GetItemLabelText(): string }[];
}

export abstract class EDA_BASE_FRAME
  extends TOOLS_HOLDER
  implements TOOL_MANAGER_FRAME_WITH_STATUS_BAR
{
  protected m_ident: FRAME_T; // Id Type (pcb, schematic, library..)
  protected m_unitsProvider: UNITS_PROVIDER;

  protected m_autoSaveRequired = false; // true to trigger an auto save on the next update

  protected m_undoRedoCountMax: number; // undo/Redo command Max depth

  protected m_undoList = new UNDO_REDO_CONTAINER(); // Objects list for the undo command (old data)
  protected m_redoList = new UNDO_REDO_CONTAINER(); // Objects list for the redo command (old data)

  protected m_isClosing = false; // Set by the close window event handler after frames are asked if they can close
  // Allows other functions when called to know our state is cleanup

  protected m_infoBar: WX_INFOBAR | null = null; // Infobar for the frame

  /**
   * `KIWAY_HOLDER::Prj()`: the active project, through `KIWAY::Prj()` which is
   * `Pgm().GetSettingsManager().Prj()`. KIWAY_HOLDER is not a class here; a
   * frame is the only holder ported.
   */
  Prj(): PROJECT {
    return Pgm().GetSettingsManager().Prj();
  }

  constructor(aFrameType: FRAME_T, aIuScale: EdaIuScale, aUnits: EdaUnits) {
    super();

    this.m_ident = aFrameType;
    this.m_unitsProvider = new UNITS_PROVIDER(aIuScale, aUnits);
    this.m_undoRedoCountMax = DEFAULT_MAX_UNDO_ITEMS;
  }

  IsType(aType: FRAME_T): boolean {
    return this.m_ident === aType;
  }

  /** `WX_INFOBAR* GetInfoBar()`: the frame's infobar; the designer's frames hold one when shown. */
  GetInfoBar(): WX_INFOBAR | null {
    return this.m_infoBar;
  }

  GetFrameType(): FRAME_T {
    return this.m_ident;
  }

  /* UNITS_PROVIDER, the C++'s second base */
  GetUserUnits(): EdaUnits {
    return this.m_unitsProvider.GetUserUnits();
  }

  SetUserUnits(aUnits: EdaUnits): void {
    this.m_unitsProvider.SetUserUnits(aUnits);
  }

  GetIuScale(): EdaIuScale {
    return this.m_unitsProvider.GetIuScale();
  }

  GetUnitsProvider(): UNITS_PROVIDER {
    return this.m_unitsProvider;
  }

  GetSeverity(_aErrorCode: number): Severity {
    return RPT_SEVERITY_UNDEFINED;
  }

  /** `wxMenuBar* GetMenuBar()`: the window's menu bar as a label model, or null. */
  GetMenuBar(): MENU_BAR_LIKE | null {
    return null;
  }

  /**
   * Get the description of the menu command for the given action, to be used in a tooltip or
   * message box, e.g. "Run: File > Import > Netlist"
   */
  GetRunMenuCommandDescription(aAction: TOOL_ACTION): string {
    let menuItemLabel = aAction.GetMenuLabel();
    const menuBar = this.GetMenuBar();

    if (menuBar) {
      for (let ii = 0; ii < menuBar.GetMenuCount(); ++ii) {
        for (const menuItem of menuBar.GetMenuItems(ii)) {
          if (menuItem.GetItemLabelText() === menuItemLabel) {
            let menuTitleLabel = menuBar.GetMenuLabelText(ii);

            menuTitleLabel = menuTitleLabel.replaceAll('&', '&&');
            menuItemLabel = menuItemLabel.replaceAll('&', '&&');

            return `Run: ${menuTitleLabel} > ${menuItemLabel}`;
          }
        }
      }
    }

    return `Run: ${aAction.GetFriendlyName()}`;
  }

  /**
   * Remove the \a aItemCount of old commands from \a aList and delete commands, pickers
   * and picked items if needed.
   *
   * Because picked items must be deleted only if they are not in use, this is a virtual
   * pure function that must be created for #SCH_SCREEN and #PCB_SCREEN.
   *
   * @param aList which #UNDO_REDO_CONTAINER of commands.
   * @param aItemCount number of old commands to delete. -1 to remove all old commands
   *                   this will empty the list of commands.
   */
  ClearUndoORRedoList(_aList: UNDO_REDO_LIST, _aItemCount = -1): void {}

  /**
   * Clear the undo and redo list using #ClearUndoORRedoList()
   *
   * Picked items are deleted by ClearUndoORRedoList() according to their status.
   */
  ClearUndoRedoList(): void {
    this.ClearUndoORRedoList(UNDO_REDO_LIST.UNDO_LIST);
    this.ClearUndoORRedoList(UNDO_REDO_LIST.REDO_LIST);
  }

  /**
   * Add a command to undo in the undo list.
   *
   * Delete the very old commands when the max count of undo commands is reached.
   */
  PushCommandToUndoList(aNewitem: PICKED_ITEMS_LIST): void {
    this.m_undoList.PushCommand(aNewitem);

    // Delete the extra items, if count max reached
    if (this.m_undoRedoCountMax > 0) {
      const extraitems = this.GetUndoCommandCount() - this.m_undoRedoCountMax;

      if (extraitems > 0) this.ClearUndoORRedoList(UNDO_REDO_LIST.UNDO_LIST, extraitems);
    }
  }

  /**
   * Add a command to redo in the redo list.
   *
   * Delete the very old commands when the max count of redo commands is reached.
   */
  PushCommandToRedoList(aNewitem: PICKED_ITEMS_LIST): void {
    this.m_redoList.PushCommand(aNewitem);

    // Delete the extra items, if count max reached
    if (this.m_undoRedoCountMax > 0) {
      const extraitems = this.GetRedoCommandCount() - this.m_undoRedoCountMax;

      if (extraitems > 0) this.ClearUndoORRedoList(UNDO_REDO_LIST.REDO_LIST, extraitems);
    }
  }

  /**
   * Return the last command to undo and remove it from list, nothing is deleted.
   */
  PopCommandFromUndoList(): PICKED_ITEMS_LIST | null {
    return this.m_undoList.PopCommand();
  }

  /**
   * Return the last command to undo and remove it from list, nothing is deleted.
   */
  PopCommandFromRedoList(): PICKED_ITEMS_LIST | null {
    return this.m_redoList.PopCommand();
  }

  GetUndoCommandCount(): number {
    return this.m_undoList.m_CommandsList.length;
  }
  GetRedoCommandCount(): number {
    return this.m_redoList.m_CommandsList.length;
  }

  GetUndoActionDescription(): string {
    if (this.GetUndoCommandCount() > 0)
      return this.m_undoList.m_CommandsList[
        this.m_undoList.m_CommandsList.length - 1
      ]!.GetDescription();

    return '';
  }

  GetRedoActionDescription(): string {
    if (this.GetRedoCommandCount() > 0)
      return this.m_redoList.m_CommandsList[
        this.m_redoList.m_CommandsList.length - 1
      ]!.GetDescription();

    return '';
  }

  GetMaxUndoItems(): number {
    return this.m_undoRedoCountMax;
  }

  /**
   * Must be called after a model change in order to set the "modify" flag and
   * do other frame-specific processing.
   */
  OnModify(): void {
    this.m_autoSaveRequired = true;
  }

  IsAutoSaveRequired(): boolean {
    return this.m_autoSaveRequired;
  }

  ClearAutoSaveRequired(): void {
    this.m_autoSaveRequired = false;
  }

  IsClosing(): boolean {
    return this.m_isClosing;
  }

  /**
   * Update the status bar information.
   *
   * The status bar can draw itself.  This is not a drawing function per se, but rather
   * updates lines of text held by the components within the status bar which is owned
   * by the wxFrame.
   */
  UpdateStatusBar(): void {}

  GetToolCanvas(): unknown {
    return null;
  }

  // ---- settings -----------------------------------------------------------

  /**
   * Return the settings object used in SaveSettings(), and is overloaded in
   * KICAD_MANAGER_FRAME. Upstream it is `Kiface().KifaceSettings()`: the
   * settings of the kiface the frame belongs to, which each frame's package
   * supplies by overriding this.
   */
  config(): APP_SETTINGS_BASE | null {
    return null;
  }

  /**
   * Return a pointer to the window settings for this frame.
   *
   * By default, points to aCfg->m_Window for top-level frames.
   */
  GetWindowSettings(aCfg: APP_SETTINGS_BASE): WINDOW_SETTINGS {
    return aCfg.m_Window;
  }

  /**
   * Load common frame parameters from a configuration file.
   *
   * The window geometry, AUI perspective and file history are the page's
   * own; nothing of `LoadWindowSettings` has a model here.
   */
  LoadSettings(_aCfg: APP_SETTINGS_BASE): void {}

  /** Save common frame parameters to a configuration data file. */
  SaveSettings(_aCfg: APP_SETTINGS_BASE): void {}

  // ---- wxFrame's status bar ---------------------------------------------

  /** The fields `SetStatusText` writes, by index. */
  private m_statusText: string[] = [];
  private m_statusSink: ((aText: string, aField: number) => void) | null = null;

  /**
   * `wxFrame::SetStatusText( text, number )`. The page's status bar installs
   * a sink with {@link SetStatusTextSink} and writes the field itself, as a
   * wxStatusBar repaints only the field that changed.
   */
  SetStatusText(aText: string, aNumber = 0): void {
    if (this.m_statusText[aNumber] === aText) return;

    this.m_statusText[aNumber] = aText;
    this.m_statusSink?.(aText, aNumber);
  }

  /** `wxStatusBar::GetStatusText( number )`. */
  GetStatusText(aNumber = 0): string {
    return this.m_statusText[aNumber] ?? '';
  }

  /** The page's half of the status bar: where a changed field goes. */
  SetStatusTextSink(aSink: ((aText: string, aField: number) => void) | null): void {
    this.m_statusSink = aSink;
  }

  // ---- wxEvtHandler / window services ----------------------------------

  /**
   * `wxEvtHandler::CallAfter( fn )`: run `fn` once the current event has
   * been handled - a queued event, which a macrotask is.
   */
  CallAfter(aFn: () => void): void {
    setTimeout(aFn, 0);
  }

  private m_popupMenuPresenter: ((aMenu: ACTION_MENU, aOnClose: () => void) => void) | null = null;

  /**
   * `wxWindow::PopupMenu( menu, pos )`: show a context menu at the pointer.
   * Upstream it blocks until the menu closes; here `aOnClose` runs then. The
   * popup is the page's (`common/tool/action_menu_popup.tsx`); a frame with
   * none closes the menu at once, unselected.
   */
  PopupMenu(aMenu: ACTION_MENU, aOnClose: () => void): void {
    if (this.m_popupMenuPresenter) this.m_popupMenuPresenter(aMenu, aOnClose);
    else aOnClose();
  }

  SetPopupMenuPresenter(
    aPresenter: ((aMenu: ACTION_MENU, aOnClose: () => void) => void) | null,
  ): void {
    this.m_popupMenuPresenter = aPresenter;
  }

  private m_preferencesPresenter: ((aStartPage: string, aStartParentPage: string) => void) | null =
    null;

  /**
   * `EDA_BASE_FRAME::ShowPreferences`: the Preferences dialog, opened at a
   * page. The dialog is the page's (`prefs/PreferencesDialog.tsx`), installed
   * with {@link SetPreferencesPresenter}.
   */
  ShowPreferences(aStartPage: string, aStartParentPage: string): void {
    this.m_preferencesPresenter?.(aStartPage, aStartParentPage);
  }

  SetPreferencesPresenter(
    aPresenter: ((aStartPage: string, aStartParentPage: string) => void) | null,
  ): void {
    this.m_preferencesPresenter = aPresenter;
  }
}

export { FRAME_T };
