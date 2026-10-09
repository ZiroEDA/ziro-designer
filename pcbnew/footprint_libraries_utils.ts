// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/footprint_libraries_utils.cpp`: FOOTPRINT_EDIT_FRAME's library
 * operations — save, save as, duplicate, delete, revert, import, export —
 * mixed into the frame. The libraries themselves are the frame's
 * FOOTPRINT_LIBRARY_ADAPTER (`footprint_library_adapter.ts`).
 */

import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import { DisplayErrorMessage } from '@ziroeda/common/confirm.js';
import { RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import type { FOOTPRINT } from './footprint.js';
import type { FOOTPRINT_EDIT_FRAME } from './footprint_edit_frame.js';
import { PCB_ACTIONS } from './tools/pcb_actions.js';
import { PAD_TOOL } from './tools/pad_tool.js';
import { niluuid } from '@ziroeda/common/kiid.js';
import { confirmRevertMessage, DisplayInfoMessage, IsOK } from '@ziroeda/common/confirm.js';
import {
  KiCadFootprintFileExtension,
  kicadFootprintLibWildcard,
} from '@ziroeda/common/wildcards_and_files_ext.js';
import { ensureFileExtension as EnsureFileExtension } from '@ziroeda/common/common.js';
import { PCB_FILE_T, PCB_IO_MGR, PLUGIN_REGISTRY } from './pcb_io/pcb_io_mgr.js';
import { fpNameOf } from './footprint_library_adapter.js';
import {
  FormatFootprintForLibrary,
  ParseFootprintFile,
} from './pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';

/** `FOOTPRINT_EDIT_FRAME`'s `footprint_libraries_utils.cpp` half, mixed into that class by `footprint_edit_frame.ts`. */
export class FOOTPRINT_LIBRARIES_UTILS_MIXIN {
  /**
   * `FOOTPRINT_EDIT_FRAME::SaveFootprint` (footprint_libraries_utils.cpp:706-770):
   * into its library, deleting the old name's file first when it was renamed.
   *
   * Not ported: the board-footprint branch (`SaveFootprintToBoard`, a footprint
   * with a link) and Save As for an unnamed one, which are the window's still;
   * and the legacy-library guard — every library here is a .pretty.
   */
  async SaveFootprint(this: FOOTPRINT_EDIT_FRAME, aFootprint: FOOTPRINT | null): Promise<boolean> {
    if (!aFootprint)
      // Happen if no footprint loaded
      return false;

    const padTool = this.m_toolManager?.GetTool(PAD_TOOL);

    if (padTool?.InPadEditMode()) this.m_toolManager!.RunAction(PCB_ACTIONS.recombinePad);

    const libraryName = aFootprint.GetFPID().GetLibNickname();
    const footprintName = aFootprint.GetFPID().GetLibItemName();
    const nameChanged = this.m_footprintNameWhenLoaded !== footprintName;

    if (aFootprint.GetLink() !== niluuid) {
      // Not ported: SaveFootprintToBoard. Nothing here loads a footprint off a
      // board yet (`loadFpFromBoard` is a greyed row), so no footprint has a link.
      return false;
    } else if (libraryName === '' || footprintName === '') {
      if (await this.SaveFootprintAs(aFootprint)) {
        this.m_footprintNameWhenLoaded = footprintName;
        this.SyncLibraryTree(true);
        return true;
      }

      return false;
    }

    // `manager.GetFullURI( FOOTPRINT, libraryName )`: an unknown library is no save.
    // Every library here is a .pretty, so the legacy guard has nothing to refuse.
    if (!this.FootprintLibAdapter()?.GetRow(libraryName)) return false;

    if (nameChanged) {
      const oldFPID = new LIB_ID(libraryName, this.m_footprintNameWhenLoaded);
      await this.DeleteFootprintFromLibrary(oldFPID, false);
    }

    if (!(await this.SaveFootprintInLibrary(aFootprint, libraryName))) return false;

    if (nameChanged) {
      this.m_footprintNameWhenLoaded = footprintName;
      this.SyncLibraryTree(true);
    }

    return true;
  }

  /**
   * `FOOTPRINT_EDIT_FRAME::SaveFootprintInLibrary` (:818-850): the footprint
   * written under its item name alone, every child's flags cleared.
   */
  async SaveFootprintInLibrary(
    this: FOOTPRINT_EDIT_FRAME,
    aFootprint: FOOTPRINT,
    aLibraryName: string,
  ): Promise<boolean> {
    try {
      aFootprint.SetFPID(new LIB_ID('', aFootprint.GetFPID().GetLibItemName()));

      // Clear selected, brightened, temp flags, edit flags, the whole shebang.
      aFootprint.RunOnChildren((child) => {
        child.ClearFlags();
      }, RECURSE_MODE.RECURSE);

      this.FootprintLibAdapter()?.SaveFootprint?.(aLibraryName, aFootprint);

      aFootprint.SetFPID(new LIB_ID(aLibraryName, aFootprint.GetFPID().GetLibItemName()));

      // Not ported: setFPWatcher, the file-system watcher.
      return true;
    } catch (ioe) {
      if (!(ioe instanceof IO_ERROR)) throw ioe;

      DisplayErrorMessage(ioe.What());

      aFootprint.SetFPID(new LIB_ID(aLibraryName, aFootprint.GetFPID().GetLibItemName()));
      return false;
    }
  }

  /**
   * `FOOTPRINT_EDIT_FRAME::DeleteFootprintFromLibrary` (:900-945): the file
   * out of a writable library, after asking when `aConfirm`.
   */
  async DeleteFootprintFromLibrary(
    this: FOOTPRINT_EDIT_FRAME,
    aFPID: LIB_ID,
    aConfirm: boolean,
  ): Promise<boolean> {
    if (!aFPID.IsValid()) return false;

    const adapter = this.FootprintLibAdapter();
    const nickname = aFPID.GetLibNickname();
    const fpname = aFPID.GetLibItemName();

    // `manager.GetFullURI( FOOTPRINT, nickname )`, else no delete. Every library
    // here is a .pretty, so INFO_LEGACY_LIB_WARN_DELETE has nothing to refuse.
    if (!adapter?.GetRow(nickname)) return false;

    if (!(adapter.IsFootprintLibWritable?.(nickname) ?? false)) {
      const msg = `Library '${nickname}' is read only.`;
      this.ShowInfoBarError(msg);
      return false;
    }

    // Confirmation
    const msg = `Delete footprint '${fpname}' from library '${nickname}'?`;

    if (aConfirm && !(await IsOK(msg))) return false;

    try {
      adapter.DeleteFootprint?.(nickname, fpname);
    } catch (ioe) {
      if (!(ioe instanceof IO_ERROR)) throw ioe;

      DisplayErrorMessage(ioe.What());
      return false;
    }

    this.SetStatusText(`Footprint '${fpname}' deleted from library '${nickname}'`);

    return true;
  }

  /**
   * `FOOTPRINT_EDIT_FRAME::DuplicateFootprint` (:776-815): the footprint saved
   * again under the first free `<name>_<n>`, its value following its name.
   */
  async DuplicateFootprint(this: FOOTPRINT_EDIT_FRAME, aFootprint: FOOTPRINT): Promise<boolean> {
    const adapter = this.FootprintLibAdapter();

    const fpID = aFootprint.GetFPID();
    const libraryName = fpID.GetLibNickname();
    const footprintName = fpID.GetLibItemName();

    // `manager.GetFullURI( FOOTPRINT, libraryName )`, else nothing. No library
    // here is legacy, so INFO_LEGACY_LIB_WARN_EDIT is never shown.
    if (!adapter?.GetRow(libraryName)) return false;

    let i = 1;
    let newName = footprintName;

    // Append a number to the name until the name is unique in the library.
    while (adapter.FootprintExists(libraryName, newName)) newName = `${footprintName}_${i++}`;

    aFootprint.SetFPID(new LIB_ID(libraryName, newName));

    if (aFootprint.GetValue() === footprintName) aFootprint.SetValue(newName);

    return this.SaveFootprintInLibrary(aFootprint, libraryName);
  }

  /**
   * `FOOTPRINT_EDIT_FRAME::SaveFootprintAs` (:948-1068): SAVE_AS_DIALOG until it
   * answers, then the footprint under its new name in the library chosen.
   *
   * Not ported: the dialog's New Library... button (`ID_MAKE_NEW_LIBRARY`),
   * which is `CreateNewLibrary` — File > New Library is the way in here.
   */
  async SaveFootprintAs(
    this: FOOTPRINT_EDIT_FRAME,
    aFootprint: FOOTPRINT | null,
  ): Promise<boolean> {
    if (aFootprint === null) return false;

    const adapter = this.FootprintLibAdapter();

    this.SetMsgPanel(aFootprint);

    let libraryName = aFootprint.GetFPID().GetLibNickname();
    let footprintName = aFootprint.GetFPID().GetLibItemName();
    const updateValue = aFootprint.GetValue() === footprintName;
    let footprintExists = false;

    const chosen = await this.ShowSaveAsDialog(
      footprintName,
      libraryName,
      async (newLib: string, newName: string): Promise<boolean> => {
        if (newLib === '') {
          await DisplayInfoMessage('A library must be specified.');
          return false;
        }

        if (newName === '') {
          await DisplayInfoMessage('Footprint must have a name.');
          return false;
        }

        // `manager.GetFullURI( FOOTPRINT, newLib )`, else refuse.
        if (!adapter?.GetRow(newLib)) return false;

        footprintExists = adapter.FootprintExists(newLib, newName);

        if (footprintExists) {
          const msg = `Footprint ${newName} already exists in ${newLib}.`;

          // KIDIALOG errorDlg( this, msg, _( "Confirmation" ), wxOK | wxCANCEL | wxICON_WARNING );
          // errorDlg.SetOKLabel( _( "Overwrite" ) );
          const answer = await this.AskKiDialog({
            caption: 'Confirmation',
            message: msg,
            icon: 'warning',
            labels: { ok: 'Overwrite' },
          });

          return answer === 'ok';
        }

        return true;
      },
    );

    if (!chosen) return false;

    footprintName = chosen.name;
    libraryName = chosen.library;

    aFootprint.SetFPID(new LIB_ID(libraryName, footprintName));

    if (updateValue) aFootprint.SetValue(footprintName);

    if (!(await this.SaveFootprintInLibrary(aFootprint, libraryName))) return false;

    // Once saved-as a board footprint is no longer a board footprint
    aFootprint.SetLink(niluuid);

    const msg = footprintExists
      ? `Footprint '${footprintName}' replaced in '${libraryName}'`
      : `Footprint '${footprintName}' added to '${libraryName}'`;

    this.SetStatusText(msg);
    this.UpdateTitle();
    // ReCreateHToolbar(): the window's top toolbar re-reads the frame on render.

    return true;
  }

  /**
   * `FOOTPRINT_EDIT_FRAME::RevertFootprint` (:1191-1218): the as-loaded copy back
   * on an emptied board, after `ConfirmRevertDialog`.
   */
  async RevertFootprint(this: FOOTPRINT_EDIT_FRAME): Promise<boolean> {
    const original = this.GetOriginalFootprintCopy();

    if (this.GetScreen()?.IsContentModified() && original) {
      const msg = confirmRevertMessage(this.GetLoadedFPID().GetLibItemName());

      if (await this.ConfirmRevertDialog(msg)) {
        await this.Clear_Pcb(false);
        this.AddFootprintToBoard(original.Clone() as FOOTPRINT);

        this.Zoom_Automatique(false);

        this.Update3DView(true, true);

        this.ClearUndoRedoList();
        this.GetScreen()?.SetContentModified(false);

        this.UpdateView();
        this.GetCanvas()?.Refresh();

        return true;
      }
    }

    return false;
  }

  /**
   * `FOOTPRINT_EDIT_FRAME::ImportFootprint( aName )` (:83-233): a footprint file
   * of any format a plugin can read, onto the board — not into a library. It
   * is unnamed until it is saved.
   */
  async ImportFootprint(this: FOOTPRINT_EDIT_FRAME): Promise<FOOTPRINT | null> {
    // Prompt the user for a footprint file to open.
    const file = await this.ShowImportFootprintDialog();

    if (!file) return null;

    const footprintName = { value: '' };
    let footprint: FOOTPRINT | null = null;

    // PCB_IO_KICAD_SEXPR registers first upstream; ours is not a PCB_IO yet
    // (pcb_io_mgr.ts), so its one footprint file is read here directly.
    if (file.path.toLowerCase().endsWith(`.${KiCadFootprintFileExtension}`)) {
      try {
        footprint = ParseFootprintFile(file.text, file.path);
        footprintName.value = footprint.GetFPID().GetLibItemName() || fpNameOf(file.path);
      } catch (ioe) {
        DisplayErrorMessage((ioe as Error).message);
        return null;
      }
    } else {
      const bytes = new TextEncoder().encode(file.text);
      const readFile = (aPath: string): Uint8Array | null => (aPath === file.path ? bytes : null);
      let fileType = PCB_FILE_T.FILE_TYPE_NONE;

      for (const plugin of PLUGIN_REGISTRY.Instance().AllPlugins()) {
        const pi = await plugin.m_createFunc();

        if (pi.GetLibraryFileDesc().m_FileExtensions.length === 0) continue;

        pi.SetFileReader(readFile);

        if (pi.CanReadFootprint(file.path)) {
          fileType = plugin.m_type;
          break;
        }
      }

      if (fileType === PCB_FILE_T.FILE_TYPE_NONE) {
        DisplayErrorMessage('Not a footprint file.');
        return null;
      }

      try {
        const pi = await PCB_IO_MGR.FindPlugin(fileType)!;
        pi.SetFileReader(readFile);

        footprint = pi.ImportFootprint(file.path, footprintName);

        if (!footprint) {
          DisplayErrorMessage(
            `Unable to load footprint '${footprintName.value}' from '${file.path}'`,
          );
          return null;
        }
      } catch (ioe) {
        if (!(ioe instanceof IO_ERROR)) throw ioe;

        DisplayErrorMessage(ioe.What());

        // if the footprint is not loaded, exit.
        if (!footprint) return null;
      }
    }

    this.m_mruPath = file.path.split('/').slice(0, -1).join('/');

    footprint.SetFPID(new LIB_ID('', footprintName.value));

    // Insert footprint in list
    this.AddFootprintToBoard(footprint);

    // Display info :
    this.SetMsgPanel(footprint);
    this.PlaceFootprint(footprint);

    footprint.SetPosition({ x: 0, y: 0 });

    this.GetBoard()!.BuildListOfNets();
    this.UpdateView();

    return footprint;
  }

  /**
   * `FOOTPRINT_EDIT_FRAME::ExportFootprint` (:236-305): the footprint as a
   * `.kicad_mod` where the save dialog says, then "Footprint exported to file".
   */
  async ExportFootprint(this: FOOTPRINT_EDIT_FRAME, aFootprint: FOOTPRINT | null): Promise<void> {
    if (!aFootprint) return;

    const fileName = `${aFootprint.GetFPID().GetLibItemName()}.${KiCadFootprintFileExtension}`;

    const dlg = await this.ShowSaveFileDialog(
      'Export Footprint',
      fileName,
      kicadFootprintLibWildcard(),
    );

    if (!dlg) return;

    const path = EnsureFileExtension(dlg.path, KiCadFootprintFileExtension);

    // Not ported: `cfg->m_LastExportPath`, which fpedit.json does not carry here.

    // Export as *.kicad_pcb format, using a strategy which is specifically chosen
    // as an example on how it could also be used to send it to the system clipboard.
    let prettyData: string;

    try {
      prettyData = FormatFootprintForLibrary(aFootprint);
    } catch (ioe) {
      if (!(ioe instanceof IO_ERROR)) throw ioe;

      DisplayErrorMessage(ioe.What());
      return;
    }

    if (!this.WriteTextFile(path, prettyData)) {
      DisplayErrorMessage(`Insufficient permissions to write file '${path}'.`);
      return;
    }

    await DisplayInfoMessage(`Footprint exported to file '${path}'.`);
  }
}
