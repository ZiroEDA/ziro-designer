// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_PRINT_GERBVIEW's window (`gerbview/dialogs/dialog_print_gerbview.cpp`),
 * drawing the state {@link DIALOG_PRINT_GERBVIEW} holds through the shared
 * DIALOG_PRINT_GENERIC view:
 *
 *  - createLeftPanel (`:171-203`): "Include Layers", a wxStaticBoxSizer
 *    Insert()ed at 0 of the upper sizer, wxEXPAND|wxALL 5, holding the two
 *    wxCheckListBoxes side by side (proportion 1, wxEXPAND) over "Select all"
 *    and "Deselect all" (proportion 1, wxALL 5 each);
 *  - createExtraOptions (`:158-168`): "Print mirrored", one row under the
 *    generic options.
 */

import { Button, CheckBox, StaticBox } from '@ziroeda/common/wx/controls.js';
import { type JSX, useState } from 'react';
import { DIALOG_PRINT_GENERIC } from '@ziroeda/common/dialogs/dialog_print_generic_ui.js';
import type { DIALOG_PRINT_GERBVIEW } from './dialog_print_gerbview.js';

export function DialogPrintGerbview({
  dlg,
  onMessage,
  onPrint,
  onClose,
}: {
  /** Already through TransferDataToWindow (and ForcePrintBorder). */
  dlg: DIALOG_PRINT_GERBVIEW;
  /**
   * DisplayError / DisplayInfoMessage over the dialog, which stays open:
   * "Nothing to print", or getScaleValue's warning that the custom scale was
   * corrected.
   */
  onMessage: (aMessage: string, aIsError: boolean) => void;
  /** Print: onPrintButtonClick found pages to print. The dialog stays open. */
  onPrint: () => void;
  /** Close (wxID_CANCEL, relabelled), after saveSettings. */
  onClose: () => void;
}): JSX.Element {
  // One render counter: the state lives on `dlg`, as the controls' does.
  const [, setTick] = useState(0);
  const changed = (): void => setTick((t) => t + 1);

  return (
    <DIALOG_PRINT_GENERIC
      blackWhite={dlg.m_outputMode === 1}
      onBlackWhite={(v) => {
        dlg.m_outputMode = v ? 1 : 0;
        changed();
      }}
      titleBlock={dlg.m_titleBlock}
      titleBlockShown={dlg.m_titleBlockShown}
      onTitleBlock={(v) => {
        dlg.m_titleBlock = v;
        changed();
      }}
      scaleMode={dlg.m_scaleMode}
      onScaleMode={(m) => {
        dlg.m_scaleMode = m;
        changed();
      }}
      customScale={dlg.m_customScale}
      onCustomScale={(t) => {
        dlg.m_customScale = t;
        changed();
      }}
      leading={
        <StaticBox label="Include Layers" className="ze-printdlg-layers">
          <div className="ze-gbrprint-lists">
            {dlg.m_layerLists.map((list, li) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: the two lists are fixed slots
                key={li}
                className="ze-checklistbox ze-printdlg-layerlist ze-gbrprint-list"
              >
                {list.items.map((name, i) => (
                  <label
                    // biome-ignore lint/suspicious/noArrayIndexKey: rows are positions, names repeat
                    key={i}
                    className="ze-check"
                  >
                    <input
                      type="checkbox"
                      checked={list.checked[i] === true}
                      onChange={() => {
                        list.checked[i] = !list.checked[i];
                        changed();
                      }}
                    />
                    {name}
                  </label>
                ))}
              </div>
            ))}
          </div>
          <div className="ze-gbrprint-buttons">
            <Button
              label="Select all"
              className="ze-gbrprint-button"
              onClick={() => {
                dlg.onSelectAllClick();
                changed();
              }}
            />
            <Button
              label="Deselect all"
              className="ze-gbrprint-button"
              onClick={() => {
                dlg.onDeselectAllClick();
                changed();
              }}
            />
          </div>
        </StaticBox>
      }
      extraOptions={
        <CheckBox
          label="Print mirrored"
          checked={dlg.m_checkboxMirror}
          className="ze-printdlg-span"
          onChange={(aChecked) => {
            dlg.m_checkboxMirror = aChecked;
            changed();
          }}
        />
      }
      onPrint={() => {
        const { info, error } = dlg.onPrintButtonClick();
        changed();

        // getScaleValue's DisplayInfoMessage comes first, from saveSettings.
        if (info !== null) onMessage(info, false);

        if (error !== null) {
          onMessage(error, true);
          return;
        }

        onPrint();
      }}
      onClose={() => {
        // onCancelButtonClick / onClose: saveSettings first.
        const info = dlg.saveSettings();

        if (info !== null) onMessage(info, false);

        onClose();
      }}
    />
  );
}
