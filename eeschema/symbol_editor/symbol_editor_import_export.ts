// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SYMBOL_EDIT_FRAME::ImportSymbol` (eeschema/symbol_editor/symbol_editor_import_export.cpp): symbols
 * from a library file of any format a schematic plugin reads, chosen through
 * DIALOG_IMPORT_SYMBOL_SELECT, added to the target library.
 *
 * A mixin, applied to SYMBOL_EDIT_FRAME by symbol_edit_frame.ts like the other files that hold its
 * methods. DIALOG_IMPORT_SYMBOL_SELECT is the window's: it fills the selection and the conflict
 * resolutions of the IMPORT_SYMBOL_SELECT this hands it (SYMBOL_IMPORT_MANAGER is its logic).
 */
import { DisplayErrorMessage, DisplayInfoMessage } from '@ziroeda/common/confirm.js';
import { PARSE_ERROR } from '@ziroeda/common/dsnlexer.js';
import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import { ESCAPE_CONTEXT, EscapeString } from '@ziroeda/common/string_utils.js';
import { wxFD_FILE_MUST_EXIST, wxFD_OPEN } from '@ziroeda/wx/defs.js';
import type { ChooserFilter } from '@ziroeda/wx/filedlg.js';
import { wxID_OK } from '@ziroeda/wx/menu.js';
import { SCH_FILE_T, SCH_FILE_T_vector, SCH_IO_MGR } from '../sch_io/sch_io_mgr.js';
import { CONFLICT_RESOLUTION } from '../symbol_import_manager.js';
import type { SYMBOL_EDIT_FRAME } from './symbol_edit_frame.js';
import { _ } from '@ziroeda/wx/translation.js';
import { wxFormat } from '@ziroeda/wx/wxstring.js';

/**
 * `DIALOG_IMPORT_SYMBOL_SELECT( this, aFilePath, aDestLibrary, aPluginType )`'s inputs, and what its
 * `GetSelectedSymbols()` / `GetConflictResolutions()` return once the window has filled them.
 */
export interface DIALOG_IMPORT_SYMBOL_SELECT_ARG {
  filePath: string;
  destLibrary: string;
  pluginType: SCH_FILE_T;
  selectedSymbols: string[];
  conflictResolutions: Map<string, CONFLICT_RESOLUTION>;
}

export class SYMBOL_EDITOR_IMPORT_EXPORT_MIXIN {
  /** `ImportSymbol()`. */
  async ImportSymbol(this: SYMBOL_EDIT_FRAME): Promise<void> {
    const libMgr = this.GetLibManager();
    let libName = this.getTargetLib();

    if (!libMgr.LibraryExists(libName))
      libName = await this.SelectLibrary(_('Import Symbol'), _('Import symbol to library:'));

    if (!libMgr.LibraryExists(libName)) return;

    // fileFiltersStr / allWildcardsStr: the chooser's filters, "All supported formats" first.
    const fileFilters: ChooserFilter[] = [];
    const allExtensions: string[] = [];

    for (const fileType of SCH_FILE_T_vector) {
      const pi = SCH_IO_MGR.FindPlugin(fileType);

      if (!pi) continue;

      const desc = pi.GetLibraryFileDesc();

      if (desc.m_FileExtensions.length === 0) continue;

      fileFilters.push(desc.Chooser());

      for (const ext of desc.m_FileExtensions) allExtensions.push(ext.toLowerCase());
    }

    fileFilters.unshift({ label: _('All supported formats'), extensions: allExtensions });

    const path = await this.FileDialog(
      _('Import Symbol'),
      this.GetMruPath(),
      '',
      fileFilters,
      wxFD_OPEN | wxFD_FILE_MUST_EXIST,
    );

    if (path === null) return;

    const slash = path.lastIndexOf('/');
    this.SetMruPath(slash < 0 ? '' : path.slice(0, slash));

    const piType = SCH_IO_MGR.GuessPluginTypeFromLibPath(path);

    if (piType === SCH_FILE_T.SCH_FILE_UNKNOWN) {
      DisplayErrorMessage(wxFormat(_("Unable to find a reader for '%s'."), path));
      return;
    }

    const selectDlg: DIALOG_IMPORT_SYMBOL_SELECT_ARG = {
      filePath: path,
      destLibrary: libName,
      pluginType: piType,
      selectedSymbols: [],
      conflictResolutions: new Map(),
    };

    if ((await this.ShowModalDialog('DIALOG_IMPORT_SYMBOL_SELECT', [], selectDlg)) !== wxID_OK)
      return;

    const selectedSymbols = selectDlg.selectedSymbols;

    if (selectedSymbols.length === 0) return;

    const conflictResolutions = selectDlg.conflictResolutions;

    // Load and import each selected symbol
    const pi = SCH_IO_MGR.FindPlugin(piType)!;
    let firstImported = '';
    let importedCount = 0;
    let skippedCount = 0;

    for (const symbolName of selectedSymbols) {
      if (conflictResolutions.get(symbolName) === CONFLICT_RESOLUTION.SKIP) {
        skippedCount++;
        continue;
      }

      try {
        const entry = pi.LoadSymbol(path, symbolName);

        if (entry) {
          entry.SetName(EscapeString(entry.GetName(), ESCAPE_CONTEXT.CTX_LIBID));
          libMgr.UpdateSymbol(entry, libName);

          if (firstImported === '') firstImported = entry.GetName();

          importedCount++;
        }
      } catch (ioe) {
        // catch( const IO_ERROR& ), which upstream's PARSE_ERROR derives from (ours does not yet).
        if (!(ioe instanceof IO_ERROR) && !(ioe instanceof PARSE_ERROR)) throw ioe;

        DisplayErrorMessage(
          wxFormat(
            _("Cannot import symbol '%s': %s"),
            symbolName,
            ioe instanceof IO_ERROR ? ioe.What() : ioe.message,
          ),
        );
      }
    }

    if (importedCount > 0) {
      this.SyncLibraries(false);
      await this.LoadSymbol(firstImported, libName, 1);

      if (skippedCount > 0)
        await DisplayInfoMessage(
          wxFormat(_('Imported %d symbol(s), skipped %d.'), importedCount, skippedCount),
        );
    }
  }
}
