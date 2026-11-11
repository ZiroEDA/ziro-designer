// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_IMPORT_SETTINGS` (pcbnew/dialogs/dialog_import_settings.cpp): Board Setup's Import
 * Settings from Another Board, one checkbox per importable group in the base file's order.
 *
 *  - "Import Settings" (OK) stays disabled until at least one group is checked
 *    (UpdateImportSettingsButton).
 *  - "Select All" toggles on its own flag (m_showSelectAllOnBtn), not on what is checked;
 *    clearing the last checkbox puts it back to "Select All".
 *  - The chosen file is remembered for the session (static m_filePath).
 *
 * KiCad browses for the other `.kicad_pcb` and finds its `.kicad_pro` beside it. A browser has no
 * sibling lookup, so Browse picks the board, its project and the optional `.kicad_dru` together,
 * and the path field shows their names. A path typed there names no file this page can read, so
 * OK then says "File not found.", as upstream does for a path that does not exist.
 *
 * `DialogImportSettings` below is the window, DIALOG_IMPORT_SETTINGS_BASE over the class.
 */
import { type JSX, useReducer, useRef, useState } from 'react';
import { MessageDialogError } from '@ziroeda/common/dialogs/dialog_message.js';
import type { CHECK } from '@ziroeda/wx/controls.js';
import { DIALOG_IMPORT_SETTINGS_BASE } from './dialog_import_settings_base.js';
import { _ } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

/** The checkboxes, as BOARD_SETUP's OnAuxiliaryAction reads them. */
export interface ImportSettingsOpts {
  layers: boolean;
  maskAndPaste: boolean;
  zoneHatchingOffsets: boolean;
  textAndGraphics: boolean;
  formatting: boolean;
  constraints: boolean;
  tracksAndVias: boolean;
  teardrops: boolean;
  tuningPatterns: boolean;
  netclasses: boolean;
  componentClasses: boolean;
  tuningProfiles: boolean;
  customRules: boolean;
  severities: boolean;
}

/** A file Browse picked: its name and text. */
export interface IMPORT_FILE {
  name: string;
  text: string;
}

const OPTS: readonly [keyof ImportSettingsOpts, OPT][] = [
  ['layers', 'm_LayersOpt'],
  ['maskAndPaste', 'm_MaskAndPasteOpt'],
  ['zoneHatchingOffsets', 'm_ZoneHatchingOffsetsOpt'],
  ['textAndGraphics', 'm_TextAndGraphicsOpt'],
  ['formatting', 'm_FormattingOpt'],
  ['constraints', 'm_ConstraintsOpt'],
  ['tracksAndVias', 'm_TracksAndViasOpt'],
  ['teardrops', 'm_TeardropsOpt'],
  ['tuningPatterns', 'm_TuningPatternsOpt'],
  ['netclasses', 'm_NetclassesOpt'],
  ['componentClasses', 'm_ComponentClassesOpt'],
  ['tuningProfiles', 'm_TuningProfilesOpt'],
  ['customRules', 'm_CustomRulesOpt'],
  ['severities', 'm_SeveritiesOpt'],
];

type OPT =
  | 'm_LayersOpt'
  | 'm_MaskAndPasteOpt'
  | 'm_ZoneHatchingOffsetsOpt'
  | 'm_TextAndGraphicsOpt'
  | 'm_FormattingOpt'
  | 'm_ConstraintsOpt'
  | 'm_TracksAndViasOpt'
  | 'm_TeardropsOpt'
  | 'm_TuningPatternsOpt'
  | 'm_NetclassesOpt'
  | 'm_ComponentClassesOpt'
  | 'm_TuningProfilesOpt'
  | 'm_CustomRulesOpt'
  | 'm_SeveritiesOpt';

export class DIALOG_IMPORT_SETTINGS {
  /** `static wxString m_filePath`: remember for session. */
  private static m_filePath: IMPORT_FILE[] = [];

  m_filePathCtrl = '';
  /** The files behind m_filePathCtrl while it shows what Browse picked. */
  m_files: IMPORT_FILE[] = [];

  m_LayersOpt = false;
  m_MaskAndPasteOpt = false;
  m_ZoneHatchingOffsetsOpt = false;
  m_TextAndGraphicsOpt = false;
  m_FormattingOpt = false;
  m_ConstraintsOpt = false;
  m_TracksAndViasOpt = false;
  m_TeardropsOpt = false;
  m_TuningPatternsOpt = false;
  m_NetclassesOpt = false;
  m_ComponentClassesOpt = false;
  m_TuningProfilesOpt = false;
  m_CustomRulesOpt = false;
  m_SeveritiesOpt = false;

  m_selectAllLabel = _HKI('Select All');
  /** Disable "Import Settings" button until user selects at least one import option */
  m_okEnabled = false;
  /** Store state to toggle message/usage of "Select All" button */
  m_showSelectAllOnBtn = true;
  /** `DisplayError( this, … )`, answered by the window. */
  m_error: string | null = null;

  OnCheckboxClicked(): void {
    const importButtonEnabled = this.UpdateImportSettingsButton();

    // If clicking this checkbox clears the last of the import selection checkboxes,
    // then make sure the "Select All" button is actually going to select all.
    if (!importButtonEnabled) {
      this.m_showSelectAllOnBtn = true;
      this.UpdateSelectAllButton();
    }
  }

  UpdateImportSettingsButton(): boolean {
    // Enable "Import Settings" button if at least one import option is selected
    const buttonEnableState = OPTS.some(([, m]) => this[m]);

    this.m_okEnabled = buttonEnableState;
    return buttonEnableState;
  }

  UpdateSelectAllButton(): void {
    // Update message on button
    this.m_selectAllLabel = this.m_showSelectAllOnBtn ? _('Select All') : _('Deselect All');
  }

  TransferDataToWindow(): boolean {
    this.SetFiles(DIALOG_IMPORT_SETTINGS.m_filePath);
    return true;
  }

  /** OnBrowseClicked, after the files were picked. */
  SetFiles(aFiles: IMPORT_FILE[]): void {
    this.m_files = aFiles;
    this.m_filePathCtrl = aFiles.map((f) => f.name).join(', ');
  }

  /** The path field typed into: it no longer names what Browse picked. */
  SetFilePathText(aText: string): void {
    this.m_filePathCtrl = aText;
    this.m_files = [];
  }

  TransferDataFromWindow(): boolean {
    if (this.m_files.length === 0) {
      this.m_error = _('File not found.');
      return false;
    }

    DIALOG_IMPORT_SETTINGS.m_filePath = this.m_files;
    return true;
  }

  OnSelectAll(): void {
    // Select or deselect all options based on internal flag
    for (const [, m] of OPTS) this[m] = this.m_showSelectAllOnBtn;

    // Ensure "Import Settings" button state is enabled as appropriate
    this.UpdateImportSettingsButton();

    // Toggle whether button selects or deselects all.
    this.m_showSelectAllOnBtn = !this.m_showSelectAllOnBtn;
    this.UpdateSelectAllButton();
  }

  /** The checkboxes, for BOARD_SETUP's OnAuxiliaryAction. */
  GetOptions(): ImportSettingsOpts {
    return Object.fromEntries(OPTS.map(([k, m]) => [k, this[m]])) as unknown as ImportSettingsOpts;
  }
}

/** `DIALOG_IMPORT_SETTINGS importDlg( this, m_frame ); importDlg.ShowModal() == wxID_OK`. */
export function DialogImportSettings({
  onImport,
  onClose,
}: {
  onImport: (aFiles: IMPORT_FILE[], aOpts: ImportSettingsOpts) => void;
  onClose: () => void;
}): JSX.Element {
  const [dialog] = useState(() => {
    const d = new DIALOG_IMPORT_SETTINGS();
    d.TransferDataToWindow();
    return d;
  });
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const fileInput = useRef<HTMLInputElement>(null);

  const opt = (aMember: OPT): CHECK => ({
    value: dialog[aMember],
    onChange: (aOn) => {
      dialog[aMember] = aOn;
      dialog.OnCheckboxClicked();
      redraw();
    },
  });
  const checks = Object.fromEntries(OPTS.map(([, m]) => [m, opt(m)])) as Record<OPT, CHECK>;

  return (
    <>
      <DIALOG_IMPORT_SETTINGS_BASE
        m_filePathCtrl={{
          value: dialog.m_filePathCtrl,
          onChange: (aText) => {
            dialog.SetFilePathText(aText);
            redraw();
          },
        }}
        OnBrowseClicked={() => fileInput.current?.click()}
        {...checks}
        selectAllLabel={dialog.m_selectAllLabel}
        OnSelectAll={() => {
          dialog.OnSelectAll();
          redraw();
        }}
        okEnabled={dialog.m_okEnabled}
        onOK={() => {
          if (dialog.TransferDataFromWindow()) onImport(dialog.m_files, dialog.GetOptions());
          redraw();
        }}
        onCancel={onClose}
      />
      {/* OnBrowseClicked's wxFileDialog: FILEEXT::PcbFileWildcard(), with the sibling project
          files a browser cannot look up beside it. */}
      <input
        ref={fileInput}
        type="file"
        accept=".kicad_pcb,.kicad_pro,.kicad_dru"
        multiple
        hidden
        onChange={(e) => {
          const list = e.target.files;
          if (!list || list.length === 0) return;
          void Promise.all(
            [...list].map(
              async (f): Promise<IMPORT_FILE> => ({ name: f.name, text: await f.text() }),
            ),
          ).then((aFiles) => {
            dialog.SetFiles(aFiles);
            redraw();
          });
        }}
      />
      {dialog.m_error !== null && (
        <MessageDialogError
          message={dialog.m_error}
          onClose={() => {
            dialog.m_error = null;
            redraw();
          }}
        />
      )}
    </>
  );
}
