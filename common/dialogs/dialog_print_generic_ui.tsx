// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_PRINT_GENERIC` (common/dialogs/dialog_print_generic.cpp) with its
 * `_base` folded in: the print dialog pcbnew's DIALOG_PRINT_PCBNEW (and
 * gerbview's) derive from.
 *
 * The sizer tree (dialog_print_generic_base.cpp):
 *
 *   bMainSizer (V)
 *     m_panelPrinters                  PANEL_PRINTER_LIST - see below
 *     m_bUpperSizer (H)                wxEXPAND|wxALL 5
 *       [the derived dialog's Insert( 0, ... ): pcbnew's "Include Layers"]
 *       bRightCol (V)
 *         "Options" wxStaticBoxSizer   wxEXPAND|wxALL 5, proportion 1
 *           m_gbOptionsSizer( 3, 0 )   Output mode: [Color|Black and white]
 *                                      [x] Print drawing sheet   (span 2)
 *                                      [the derived dialog's rows]
 *         "Scale" wxStaticBoxSizer     wxALL|wxEXPAND 5
 *           (o) 1:1 / 5 px / (o) Fit to page / 3 px / (o) Custom: [____]
 *     m_infoText (hidden)              wxLEFT 10
 *     bButtonsSizer                    wxLEFT 10: Page Setup..., the std buttons
 *
 * The std buttons are relabelled Print / Print Preview / Close, and on GTK
 * Print Preview is hidden (`m_sdbSizer1Apply->Hide()` under __WXGTK__), which
 * is the parity target - so ours has Close and Print.
 *
 * Two controls a browser cannot back, removed rather than greyed: the printer
 * list (upstream shows it only when there are printers to list, and a page
 * cannot enumerate any - the browser's print dialog chooses the printer), and
 * Page Setup... (the browser's print dialog is the page setup).
 */
import { CheckBox, RadioButton, StaticBox, TextCtrl } from '../wx/controls.js';
import type { JSX, ReactNode } from 'react';
import { DialogShim, StdDialogButtons } from '../dialog_shim.js';
import { Combo } from '../widgets/wx_combobox.js';
import { useModalEscape } from '../dialog_shim.js';
import type { PrintScaleMode } from './dialog_print_generic.js';

export function DIALOG_PRINT_GENERIC({
  blackWhite,
  onBlackWhite,
  titleBlock,
  onTitleBlock,
  titleBlockShown = true,
  scaleMode,
  onScaleMode,
  customScale,
  onCustomScale,
  leading,
  extraOptions,
  infoText,
  onPrint,
  onClose,
}: {
  /** `m_outputMode`: 0 Color, 1 Black and white. */
  blackWhite: boolean;
  onBlackWhite: (v: boolean) => void;
  /** `m_titleBlock`, "Print drawing sheet". */
  titleBlock: boolean;
  onTitleBlock: (v: boolean) => void;
  /** False after `ForcePrintBorder`, which hides the checkbox (`:113-117`). */
  titleBlockShown?: boolean;
  scaleMode: PrintScaleMode;
  onScaleMode: (m: PrintScaleMode) => void;
  customScale: string;
  onCustomScale: (text: string) => void;
  /** What the derived dialog Insert()s at the front of m_bUpperSizer. */
  leading?: ReactNode;
  /** The rows the derived dialog appends to the Options box's gridbag. */
  extraOptions?: ReactNode;
  /** `m_infoText`, hidden unless the derived dialog shows it. */
  infoText?: string;
  /** wxID_OK, relabelled "Print". */
  onPrint: () => void;
  /** wxID_CANCEL, relabelled "Close" (`onCancelButtonClick` saves first). */
  onClose: () => void;
}): JSX.Element {
  return (
    <DialogShim title="Print" onClose={onClose} className="ze-printdlg">
      <div className="ze-printdlg-upper">
        {leading}
        <div className="ze-printdlg-rightcol">
          <StaticBox label="Options" className="ze-printdlg-options">
            <div className="ze-printdlg-optgrid">
              <span className="ze-printdlg-label">Output mode:</span>
              <Combo
                className="ze-printdlg-choice"
                value={blackWhite ? 'bw' : 'color'}
                onChange={(v) => onBlackWhite(v === 'bw')}
                options={[
                  { value: 'color', label: 'Color' },
                  { value: 'bw', label: 'Black and white' },
                ]}
              />
              {titleBlockShown && (
                <CheckBox
                  label="Print drawing sheet"
                  checked={titleBlock}
                  title="Print Frame references."
                  className="ze-printdlg-span"
                  onChange={(aChecked) => onTitleBlock(aChecked)}
                />
              )}
              {extraOptions}
            </div>
          </StaticBox>
          <StaticBox label="Scale" className="ze-printdlg-scale">
            <RadioButton
              label="1:1"
              name="ze-print-scale"
              checked={scaleMode === '1:1'}
              className="ze-printdlg-radio"
              onChange={() => onScaleMode('1:1')}
            />
            <span className="ze-printdlg-gap5" />
            <RadioButton
              label="Fit to page"
              name="ze-print-scale"
              checked={scaleMode === 'fit'}
              className="ze-printdlg-radio"
              onChange={() => onScaleMode('fit')}
            />
            <span className="ze-printdlg-gap3" />
            <div className="ze-printdlg-custom">
              <RadioButton
                label="Custom:"
                name="ze-print-scale"
                checked={scaleMode === 'custom'}
                className="ze-printdlg-radio"
                onChange={() => onScaleMode('custom')}
              />
              <TextCtrl
                value={customScale}
                onChange={(aValue) => {
                  // onSetCustomScale: typing selects the Custom radio.
                  onCustomScale(aValue);
                  onScaleMode('custom');
                }}
                className="ze-search ze-printdlg-customtext"
                ariaLabel="Custom scale"
              />
            </div>
          </StaticBox>
        </div>
      </div>
      {infoText && <div className="ze-printdlg-info">{infoText}</div>}
      <StdDialogButtons okLabel="Print" cancelLabel="Close" onCancel={onClose} onOk={onPrint} />
    </DialogShim>
  );
}
