// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DESIGN_BLOCK_PANE` (common/widgets/design_block_pane.{h,cpp}), the logic
 * half: the base of the schematic's and the board's Design Blocks dock — the
 * chooser's selection, reloading the tree, and the library and block commands
 * (new / add / delete library, delete block, edit properties) with their
 * confirmations and errors.
 *
 * The window half is `design_block_pane_ui.tsx` (the dock) over
 * `panel_design_block_chooser_ui.tsx`; each editor's subclass adds its own
 * placement checkboxes. Every modal upstream shows is a promise here, answered
 * by the window through {@link DESIGN_BLOCK_PANE_DIALOGS}.
 */
import type { DESIGN_BLOCK } from '../design_block.js';
import { DESIGN_BLOCK_FILE_T, DESIGN_BLOCK_IO_MGR } from '../design_block_io.js';
import type { DESIGN_BLOCK_LIBRARY_ADAPTER } from '../design_block_library_adapter.js';
import { IO_ERROR } from '../exceptions.js';
import { LIB_ID } from '../lib_id.js';
import type { LIBRARY_MANAGER } from '../libraries/library_manager.js';
import { LIBRARY_TABLE_SCOPE, LIBRARY_TABLE_TYPE } from '../libraries/library_table.js';
import { KiCadDesignBlockLibPathExtension } from '../wildcards_and_files_ext.js';
import { wxDirExists, wxFileExists } from '../wx/filefn.js';

/** The modals the pane raises, each answered by the window. */
export interface DESIGN_BLOCK_PANE_DIALOGS {
  /** `IsOK( m_frame, msg )`. */
  IsOK(aMessage: string): Promise<boolean>;
  /** `OKOrCancelDialog( …, _( "Confirmation" ), msg, detail, _( "Overwrite" ) ) == wxID_OK`. */
  OKOrCancel(aMessage: string, aDetail: string, aOKLabel: string): Promise<boolean>;
  /** `KIDIALOG( …, wxOK|wxCANCEL|wxICON_WARNING )` with "Overwrite": true unless cancelled. */
  ConfirmOverwriteLibrary(aMessage: string): Promise<boolean>;
  /** `DisplayError` / `DisplayErrorMessage( m_frame, msg, detail )`. */
  DisplayError(aMessage: string, aDetail?: string): void;
  /** `wxGetTextFromUser( aMessage, aTitle, "", m_frame )`; null on Cancel. */
  GetTextFromUser(aMessage: string, aTitle: string): Promise<string | null>;
  /**
   * `EDA_DRAW_FRAME::LibraryFileBrowser( aTitle, false, fn, KiCadDesignBlockLibPathWildcard(), … )`
   * with `FILEDLG_HOOK_NEW_LIBRARY`: the new library's path and whether it goes
   * in the global table; null on Cancel.
   */
  NewLibraryBrowser(aTitle: string): Promise<{ path: string; global: boolean } | null>;
  /** `DIALOG_DESIGN_BLOCK_PROPERTIES( m_frame, aDesignBlock, aDisableName ).ShowModal() == wxID_OK`. */
  DesignBlockProperties(aDesignBlock: DESIGN_BLOCK, aDisableName: boolean): Promise<boolean>;
}

/** What the pane asks of its frame. */
export interface DESIGN_BLOCK_PANE_FRAME {
  /** `Prj().DesignBlockLibs()`. */
  DesignBlockLibs(): DESIGN_BLOCK_LIBRARY_ADAPTER;
  /** `Pgm().GetLibraryManager()`. */
  GetLibraryManager(): LIBRARY_MANAGER;
  /** `NormalizePath( libPath, &Pgm().GetLocalEnvVariables(), &Prj() )`. */
  NormalizePath(aPath: string): string;
  ShowInfoBarError(aMessage: string): void;
  SetStatusText(aMessage: string): void;
}

export class DESIGN_BLOCK_PANE {
  protected readonly m_frame: DESIGN_BLOCK_PANE_FRAME;
  protected readonly m_dialogs: DESIGN_BLOCK_PANE_DIALOGS;
  /** `m_chooserPanel->GetSelectedLibId()`: the chooser writes it as the user selects. */
  private m_selectedLibId = new LIB_ID();
  /** `RefreshLibs` / `SelectLibId` reach the tree through these. */
  private readonly m_refreshListeners = new Set<() => void>();
  private readonly m_selectListeners = new Set<(aLibId: LIB_ID) => void>();
  /** The history the chooser's "-- Recently Used --" group shows (`aHistoryList`). */
  readonly m_historyList: LIB_ID[];

  constructor(
    aFrame: DESIGN_BLOCK_PANE_FRAME,
    aDialogs: DESIGN_BLOCK_PANE_DIALOGS,
    aHistoryList: LIB_ID[],
  ) {
    this.m_frame = aFrame;
    this.m_dialogs = aDialogs;
    this.m_historyList = aHistoryList;
  }

  /** The chooser reports its selection here. */
  SetSelectedLibId(aLibId: LIB_ID): void {
    this.m_selectedLibId = aLibId;
  }

  /** The chooser subscribes to `RefreshLibs`; returns the unsubscribe. */
  OnRefresh(aListener: () => void): () => void {
    this.m_refreshListeners.add(aListener);
    return () => this.m_refreshListeners.delete(aListener);
  }

  /** The chooser subscribes to `SelectLibId`; returns the unsubscribe. */
  OnSelect(aListener: (aLibId: LIB_ID) => void): () => void {
    this.m_selectListeners.add(aListener);
    return () => this.m_selectListeners.delete(aListener);
  }

  GetSelectedLibId(): LIB_ID {
    return this.m_selectedLibId;
  }

  SelectLibId(aLibId: LIB_ID): void {
    this.m_selectedLibId = aLibId;

    for (const l of this.m_selectListeners) l(aLibId);
  }

  RefreshLibs(): void {
    for (const l of this.m_refreshListeners) l();
  }

  /** `GetDesignBlock` (design_block_pane.cpp:95-117). */
  GetDesignBlock(
    aLibId: LIB_ID,
    _aUseCacheLib: boolean,
    aShowErrorMsg: boolean,
  ): DESIGN_BLOCK | null {
    const prjLibs = this.m_frame.DesignBlockLibs();
    let designBlock: DESIGN_BLOCK | null = null;

    try {
      designBlock = prjLibs.DesignBlockLoadWithOptionalNickname(aLibId, true);
    } catch (e) {
      if (!(e instanceof IO_ERROR)) throw e;

      if (aShowErrorMsg) {
        this.m_dialogs.DisplayError(
          `Error loading design block ${aLibId.GetLibItemName()} from library '${aLibId.GetLibNickname()}'.`,
          e.message,
        );
      }
    }

    return designBlock;
  }

  /** `GetSelectedDesignBlock` (:120-126). */
  GetSelectedDesignBlock(aUseCacheLib: boolean, aShowErrorMsg: boolean): DESIGN_BLOCK | null {
    if (!this.GetSelectedLibId().IsValid()) return null;

    return this.GetDesignBlock(this.GetSelectedLibId(), aUseCacheLib, aShowErrorMsg);
  }

  /** `CreateNewDesignBlockLibrary` (:129-132). */
  CreateNewDesignBlockLibrary(aDialogTitle: string): Promise<string> {
    return this.createNewDesignBlockLibrary(aDialogTitle);
  }

  /** `createNewDesignBlockLibrary` (:135-206). */
  private async createNewDesignBlockLibrary(aDialogTitle: string): Promise<string> {
    const picked = await this.m_dialogs.NewLibraryBrowser(aDialogTitle);

    if (!picked) return '';

    const libPath = picked.path;
    const scope = picked.global ? LIBRARY_TABLE_SCOPE.GLOBAL : LIBRARY_TABLE_SCOPE.PROJECT;

    // We can save libs only using DESIGN_BLOCK_IO_MGR::KICAD_SEXP format (.pretty libraries)
    const pi = DESIGN_BLOCK_IO_MGR.FindPlugin(DESIGN_BLOCK_FILE_T.KICAD_SEXP)!;

    try {
      let writable = false;
      let exists = false;

      try {
        writable = pi.IsLibraryWritable(libPath);
        exists = wxFileExists(libPath) || wxDirExists(libPath);
      } catch {
        // best efforts....
      }

      if (exists) {
        if (!writable) {
          this.m_frame.ShowInfoBarError(`Library ${libPath} is read only.`);
          return '';
        }

        if (!(await this.m_dialogs.ConfirmOverwriteLibrary(`Library ${libPath} already exists.`)))
          return '';

        pi.DeleteLibrary(libPath);
      }

      pi.CreateLibrary(libPath);
    } catch (e) {
      if (!(e instanceof IO_ERROR)) throw e;

      this.m_dialogs.DisplayError(e.message);
      return '';
    }

    await this.AddDesignBlockLibrary(aDialogTitle, libPath, scope);

    return libPath;
  }

  /** `AddDesignBlockLibrary` (:209-273). */
  async AddDesignBlockLibrary(
    aDialogTitle: string,
    aFilename: string,
    aScope: LIBRARY_TABLE_SCOPE,
  ): Promise<boolean> {
    const adapter = this.m_frame.DesignBlockLibs();
    const manager = this.m_frame.GetLibraryManager();

    const libPath = aFilename.replace(/\/+$/, '');
    const fullName = libPath.slice(libPath.lastIndexOf('/') + 1);
    const dot = fullName.lastIndexOf('.');
    const ext = dot > 0 ? fullName.slice(dot + 1) : '';
    let libName = dot > 0 ? fullName.slice(0, dot) : fullName;

    if (libName === '') return false;

    // Open a dialog to ask for a description
    const description =
      (await this.m_dialogs.GetTextFromUser(
        'Enter a description for the library:',
        aDialogTitle,
      )) ?? '';

    let libType = DESIGN_BLOCK_IO_MGR.GuessPluginTypeFromLibPath(libPath);

    if (libType === DESIGN_BLOCK_FILE_T.FILE_TYPE_NONE) libType = DESIGN_BLOCK_FILE_T.KICAD_SEXP;

    const type = DESIGN_BLOCK_IO_MGR.ShowType(libType);

    // KiCad lib is our default guess.  So it might not have the .kicad_blocks extension
    // In this case, the extension is part of the library name
    if (libType === DESIGN_BLOCK_FILE_T.KICAD_SEXP && ext !== KiCadDesignBlockLibPathExtension)
      libName = fullName;

    // try to use path normalized to an environmental variable or project path
    const normalizedPath = this.m_frame.NormalizePath(libPath);

    const table = manager.Table(LIBRARY_TABLE_TYPE.DESIGN_BLOCK, aScope);

    if (!table) return false;

    const newRow = table.InsertRow();
    newRow.SetNickname(libName);
    newRow.SetURI(normalizedPath);
    newRow.SetType(type);
    newRow.SetDescription(description);

    const saved = table.Save();

    if (!saved.ok) {
      this.m_dialogs.DisplayError(`Error saving library table:\n\n${saved.error.message}`);
    } else {
      adapter.LoadOneByName(libName);
      this.RefreshLibs();
      this.SelectLibId(new LIB_ID(libName, ''));
    }

    return true;
  }

  /** `DeleteDesignBlockLibrary` (:276-315). */
  async DeleteDesignBlockLibrary(aLibName: string, aConfirm: boolean): Promise<boolean> {
    if (aLibName === '') {
      this.m_dialogs.DisplayError('Please select a library to delete.');
      return false;
    }

    if (!this.m_frame.DesignBlockLibs().IsDesignBlockLibWritable(aLibName)) {
      this.m_frame.ShowInfoBarError(`Library '${aLibName}' is read only.`);
      return false;
    }

    // Confirmation
    const msg = `Delete design block library '${aLibName}' from disk? This will delete all design blocks within the library.`;

    if (aConfirm && !(await this.m_dialogs.IsOK(msg))) return false;

    if (!this.m_frame.DesignBlockLibs().DeleteLibrary(aLibName)) return false;

    this.m_frame.SetStatusText(`Design block library '${aLibName}' deleted`);
    this.RefreshLibs();

    return true;
  }

  /** `DeleteDesignBlockFromLibrary` (:318-363). */
  async DeleteDesignBlockFromLibrary(aLibId: LIB_ID, aConfirm: boolean): Promise<boolean> {
    if (!aLibId.IsValid()) return false;

    const libname = aLibId.GetLibNickname();
    const dbname = aLibId.GetLibItemName();

    if (!this.m_frame.DesignBlockLibs().IsDesignBlockLibWritable(libname)) {
      this.m_frame.ShowInfoBarError(`Library '${libname}' is read only.`);
      return false;
    }

    // Confirmation
    const msg = `Delete design block '${dbname}' in library '${libname}' from disk?`;

    if (aConfirm && !(await this.m_dialogs.IsOK(msg))) return false;

    try {
      this.m_frame.DesignBlockLibs().DeleteDesignBlock(libname, dbname);
    } catch (e) {
      if (!(e instanceof IO_ERROR)) throw e;

      this.m_dialogs.DisplayError(e.message);
      return false;
    }

    this.m_frame.SetStatusText(`Design block '${dbname}' deleted from library '${libname}'`);
    this.RefreshLibs();

    return true;
  }

  /** `EditDesignBlockProperties` (:366-420). */
  async EditDesignBlockProperties(aLibId: LIB_ID): Promise<boolean> {
    if (!aLibId.IsValid()) return false;

    const libname = aLibId.GetLibNickname();
    const libs = this.m_frame.DesignBlockLibs();

    if (!libs.IsDesignBlockLibWritable(libname)) {
      this.m_frame.ShowInfoBarError(`Library '${libname}' is read only.`);
      return false;
    }

    const designBlock = this.GetDesignBlock(aLibId, true, true);

    if (!designBlock) return false;

    const originalName = designBlock.GetLibId().GetLibItemName();

    if (!(await this.m_dialogs.DesignBlockProperties(designBlock, false))) return false;

    const newName = designBlock.GetLibId().GetLibItemName();

    try {
      if (originalName !== newName) {
        if (libs.DesignBlockExists(libname, newName)) {
          if (!(await this.checkOverwrite(libname, newName))) return false;
        }

        libs.SaveDesignBlock(libname, designBlock);
        libs.DeleteDesignBlock(libname, originalName);
      } else {
        libs.SaveDesignBlock(libname, designBlock);
      }
    } catch (e) {
      if (!(e instanceof IO_ERROR)) throw e;

      this.m_dialogs.DisplayError(e.message);
      return false;
    }

    this.RefreshLibs();
    this.SelectLibId(designBlock.GetLibId());

    return true;
  }

  /** `checkOverwrite` (:423-433). */
  protected checkOverwrite(aLibname: string, aNewName: string): Promise<boolean> {
    return this.m_dialogs.OKOrCancel(
      `Design block '${aNewName}' already exists in library '${aLibname}'.`,
      'Overwrite existing design block?',
      'Overwrite',
    );
  }
}
