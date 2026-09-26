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
import type { JSX, ReactNode } from 'react';
import { StdDialogButtons } from '../dialog_shim_buttons.js';
import { Combo } from '../widgets/wx_combobox.js';
import { useModalEscape } from './use_modal_escape.js';

/** dialog_print_generic.cpp:34-35. */
export const MIN_SCALE = 0.01;
export const MAX_SCALE = 100.0;

export type PrintScaleMode = '1:1' | 'fit' | 'custom';

/**
 * `setScaleValue` (:172-196): 0 selects Fit to page, 1 selects 1:1, anything
 * else is clamped silently and written into Custom with `%f`.
 */
export function setScaleValue(aValue: number): { mode: PrintScaleMode; text?: string } {
  if (aValue === 0.0) return { mode: 'fit' };
  if (aValue === 1.0) return { mode: '1:1' };
  const v = Math.min(MAX_SCALE, Math.max(MIN_SCALE, aValue));
  return { mode: 'custom', text: v.toFixed(6) };
}

/**
 * `getScaleValue` (:128-170): the scale, what the controls become when the
 * custom text had to be corrected, and the DisplayInfoMessage upstream shows
 * for it.
 */
export function getScaleValue(
  aMode: PrintScaleMode,
  aCustomText: string,
): { scale: number; reset?: { mode: PrintScaleMode; text?: string }; info?: string } {
  if (aMode === '1:1') return { scale: 1.0 };
  if (aMode === 'fit') return { scale: 0.0 };

  const t = aCustomText.trim();
  let scale = t === '' ? Number.NaN : Number(t);

  if (!Number.isFinite(scale)) {
    return {
      scale: 1.0,
      reset: setScaleValue(1.0),
      info: 'Warning: custom scale is not a number.',
    };
  }

  if (scale > MAX_SCALE) {
    scale = MAX_SCALE;
    return {
      scale,
      reset: setScaleValue(scale),
      info: `Warning: custom scale is too large.\nIt will be clamped to ${scale.toFixed(6)}.`,
    };
  }
  if (scale < MIN_SCALE) {
    scale = MIN_SCALE;
    return {
      scale,
      reset: setScaleValue(scale),
      info: `Warning: custom scale is too small.\nIt will be clamped to ${scale.toFixed(6)}.`,
    };
  }
  return { scale };
}

export function DIALOG_PRINT_GENERIC({
  blackWhite,
  onBlackWhite,
  titleBlock,
  onTitleBlock,
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
  useModalEscape(onClose);

  return (
    <div className="ze-modal-backdrop">
      <div className="ze-modal ze-printdlg" role="dialog" aria-modal="true" aria-label="Print">
        <div className="ze-modal-header">Print</div>
        <div className="ze-printdlg-upper">
          {leading}
          <div className="ze-printdlg-rightcol">
            <fieldset className="ze-sbox ze-printdlg-options">
              <legend>Options</legend>
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
                <label className="ze-check ze-printdlg-span" title="Print Frame references.">
                  <input
                    type="checkbox"
                    checked={titleBlock}
                    onChange={(e) => onTitleBlock(e.target.checked)}
                  />
                  Print drawing sheet
                </label>
                {extraOptions}
              </div>
            </fieldset>
            <fieldset className="ze-sbox ze-printdlg-scale">
              <legend>Scale</legend>
              <label className="ze-check ze-printdlg-radio">
                <input
                  type="radio"
                  name="ze-print-scale"
                  checked={scaleMode === '1:1'}
                  onChange={() => onScaleMode('1:1')}
                />
                1:1
              </label>
              <span className="ze-printdlg-gap5" />
              <label className="ze-check ze-printdlg-radio">
                <input
                  type="radio"
                  name="ze-print-scale"
                  checked={scaleMode === 'fit'}
                  onChange={() => onScaleMode('fit')}
                />
                Fit to page
              </label>
              <span className="ze-printdlg-gap3" />
              <div className="ze-printdlg-custom">
                <label className="ze-check ze-printdlg-radio">
                  <input
                    type="radio"
                    name="ze-print-scale"
                    checked={scaleMode === 'custom'}
                    onChange={() => onScaleMode('custom')}
                  />
                  Custom:
                </label>
                <input
                  className="ze-search ze-printdlg-customtext"
                  aria-label="Custom scale"
                  value={customScale}
                  onChange={(e) => {
                    // onSetCustomScale: typing selects the Custom radio.
                    onCustomScale(e.target.value);
                    onScaleMode('custom');
                  }}
                />
              </div>
            </fieldset>
          </div>
        </div>
        {infoText && <div className="ze-printdlg-info">{infoText}</div>}
        <StdDialogButtons okLabel="Print" cancelLabel="Close" onCancel={onClose} onOk={onPrint} />
      </div>
    </div>
  );
}
