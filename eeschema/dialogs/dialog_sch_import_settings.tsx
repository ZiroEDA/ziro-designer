// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_SCH_IMPORT_SETTINGS` (eeschema/dialogs/dialog_sch_import_settings.cpp): Schematic
 * Setup's "Import Settings from Another Project". Every option starts unchecked (the .fbp's);
 * Select All checks all but Annotation preferences, as upstream's OnSelectAll does. OK hands the
 * chosen project file's text and the options to Schematic Setup, whose onAuxiliaryAction copies
 * the checked slices.
 *
 * The file is chosen in the app's file dialog (wxFileDialog). `wxFileExists` has no answer for a
 * typed path here, so a path the dialog did not choose is "File not found.", as a missing file is
 * upstream. Schematic Setup has no project folder to give it yet, so the chooser opens at its
 * default (upstream opens in the schematic's folder).
 */
import { type JSX, useState } from 'react';
import { DisplayErrorMessage } from '@ziroeda/common/confirm.js';
import { projectFileWildcard } from '@ziroeda/common/wildcards_and_files_ext.js';
import type { CHECK } from '@ziroeda/wx/controls.js';
import { WxFileDialog } from '@ziroeda/wx/filedlg.js';
import { DIALOG_SCH_IMPORT_SETTINGS_BASE } from './dialog_sch_import_settings_base.js';
import { _ } from '@ziroeda/wx/translation.js';

export interface SchImportOptions {
  formatting: boolean;
  annotation: boolean;
  fieldNameTemplates: boolean;
  bomPresets: boolean;
  bomFmtPresets: boolean;
  severities: boolean;
  pinMap: boolean;
  netClasses: boolean;
  busAliases: boolean;
  textVars: boolean;
}

/** The .fbp's: every checkbox `checked` 0. */
const UNCHECKED: SchImportOptions = {
  formatting: false,
  annotation: false,
  fieldNameTemplates: false,
  bomPresets: false,
  bomFmtPresets: false,
  severities: false,
  pinMap: false,
  netClasses: false,
  busAliases: false,
  textVars: false,
};

interface Props {
  /** The project folder the chooser opens in (`Root().GetFileName()`'s path). */
  projectDir?: string | null;
  onImport: (proText: string, opts: SchImportOptions) => void;
  onCancel: () => void;
}

export function DialogSchImportSettings({ projectDir, onImport, onCancel }: Props): JSX.Element {
  const [opts, setOpts] = useState<SchImportOptions>(UNCHECKED);
  const [filePath, setFilePath] = useState('');
  const [chosen, setChosen] = useState<{ path: string; text: string } | null>(null);
  const [browsing, setBrowsing] = useState(false);

  const check = (aKey: keyof SchImportOptions): CHECK => ({
    value: opts[aKey],
    onChange: (aOn) => setOpts((o) => ({ ...o, [aKey]: aOn })),
  });

  /** `OnSelectAll()`: m_annotationOpt is not in upstream's list. */
  const onSelectAll = (): void =>
    setOpts((o) => ({
      ...o,
      formatting: true,
      fieldNameTemplates: true,
      pinMap: true,
      severities: true,
      netClasses: true,
      bomPresets: true,
      bomFmtPresets: true,
      busAliases: true,
      textVars: true,
    }));

  /** `TransferDataFromWindow()`, then the caller's ShowModal() == wxID_OK. */
  const onOK = (): void => {
    if (!chosen || chosen.path !== filePath) {
      DisplayErrorMessage(_('File not found.'));
      return;
    }

    onImport(chosen.text, opts);
  };

  return (
    <>
      <DIALOG_SCH_IMPORT_SETTINGS_BASE
        m_filePathCtrl={filePath}
        onFilePath={setFilePath}
        onBrowseClicked={() => setBrowsing(true)}
        m_FormattingOpt={check('formatting')}
        m_annotationOpt={check('annotation')}
        m_FieldNameTemplatesOpt={check('fieldNameTemplates')}
        m_BomPresetsOpt={check('bomPresets')}
        m_BomFmtPresetsOpt={check('bomFmtPresets')}
        m_SeveritiesOpt={check('severities')}
        m_PinMapOpt={check('pinMap')}
        m_NetClassesOpt={check('netClasses')}
        m_BusAliasesOpt={check('busAliases')}
        m_TextVarsOpt={check('textVars')}
        onSelectAll={onSelectAll}
        okLabel={_('Import Settings')}
        onOK={onOK}
        onCancel={onCancel}
      />
      {browsing && (
        // `OnBrowseClicked()`: wxFileDialog( "Import Settings From", …, ProjectFileWildcard(),
        // wxFD_OPEN | wxFD_FILE_MUST_EXIST ).
        <WxFileDialog
          title={_('Import Settings From')}
          filters={[projectFileWildcard()]}
          projectDir={projectDir}
          initialPath={projectDir ?? undefined}
          onDone={(file) => {
            setBrowsing(false);

            if (file) {
              setChosen({ path: file.path, text: file.text });
              setFilePath(file.path);
            }
          }}
        />
      )}
    </>
  );
}
