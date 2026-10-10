// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_GENCAD_EXPORT_OPTIONS's window. The sizer tree, built in code
 * (`dialog_gencad_export_options.cpp:43-79`):
 *
 *     m_mainSizer (V)
 *       m_fileSizer (H): "Output File:" (LEFT 5), m_outputFileName
 *         (proportion 1, ALL|EXPAND 5, min width 350), m_browseButton (RIGHT 5)
 *       m_optsSizer (wxGridSizer, 1 column, gaps 3/3; proportion 1): the
 *         five option checkboxes
 *       CreateSeparatedButtonSizer( wxOK | wxCANCEL )
 *
 * Browse asks the frame's save dialog for `<board>-gencad` with
 * `GencadFileWildcard`, as `onBrowseClicked` does.
 */

import { CheckBox, TextCtrl } from '@ziroeda/common/wx/controls.js';
import { type JSX, useEffect, useState } from 'react';
import { DialogShim, StdDialogButtons } from '@ziroeda/common/dialog_shim.js';
import { Icon } from '@ziroeda/common/widgets/icons.js';
import {
  type DIALOG_GENCAD_EXPORT_OPTIONS,
  GENCAD_EXPORT_OPT_LABELS,
} from './dialog_gencad_export_options.js';

export function DialogGencadExportOptions({
  dialog,
  onBrowse,
  onResult,
}: {
  dialog: DIALOG_GENCAD_EXPORT_OPTIONS;
  /** `onBrowseClicked`: the save dialog's path, or null when cancelled. */
  onBrowse: () => Promise<string | null>;
  onResult: (aOk: boolean) => void;
}): JSX.Element {
  // One render counter: the state lives on `dialog`, as the controls' does.
  const [, setTick] = useState(0);
  const changed = (): void => setTick((t) => t + 1);

  useEffect(() => {
    dialog.TransferDataToWindow();
    changed();
  }, [dialog]);

  const ok = (): void => {
    void dialog.TransferDataFromWindow().then((aOk) => {
      if (aOk) onResult(true);
    });
  };

  return (
    <DialogShim title={dialog.m_title} onClose={() => onResult(false)} className="ze-gencad">
      <div className="ze-modal-body ze-gencad-body">
        <div className="ze-gencad-file">
          <label htmlFor="ze-gencad-output">Output File:</label>
          <TextCtrl
            value={dialog.m_outputFileName}
            onChange={(aValue) => {
              dialog.m_outputFileName = aValue;
              changed();
            }}
            title="Enter a filename if you do not want to use default file names"
            id="ze-gencad-output"
            className="ze-search"
          />
          <button
            type="button"
            className="ze-btn sm"
            aria-label="Browse"
            onClick={() => {
              void onBrowse().then((aPath) => {
                if (aPath === null) return;

                dialog.m_outputFileName = aPath;
                changed();
              });
            }}
          >
            <Icon name="folder" size={14} />
          </button>
        </div>
        <div className="ze-gencad-opts">
          {GENCAD_EXPORT_OPT_LABELS.map(([opt, label]) => (
            <CheckBox
              key={opt}
              label={label}
              checked={dialog.GetOption(opt)}
              onChange={(aChecked) => {
                dialog.SetOption(opt, aChecked);
                changed();
              }}
            />
          ))}
        </div>
      </div>
      <StdDialogButtons onCancel={() => onResult(false)} onOk={ok} />
    </DialogShim>
  );
}
