// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_EXPORT_ODBPP_BASE` (dialog_export_odbpp_base.cpp): the sizer tree, Add() for Add().
 * The controls' values and the events Connect()ed in the base are props; the behaviour is
 * DIALOG_EXPORT_ODBPP's (dialog_export_odbpp.tsx).
 */
import type { JSX } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { SpinCtrl } from '@ziroeda/wx/spin_ctrl.js';
import { StdBitmapButton } from '@ziroeda/common/widgets/std_bitmap_button.js';
import { Combo } from '@ziroeda/wx/combobox.js';
import { TextCtrl } from '@ziroeda/wx/controls.js';
import {
  wxALIGN_CENTER_VERTICAL,
  wxALL,
  wxEXPAND,
  wxHORIZONTAL,
  wxLEFT,
  wxRIGHT,
  wxVERTICAL,
} from '@ziroeda/wx/defs.js';
import {
  BoxSizer,
  FlexGridSizer,
  SizerItem,
  Spacer,
  StdDialogButtonSizer,
} from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

/** `m_choiceUnitsChoices`. */
export const UNITS_CHOICES = [_HKI('Millimeters'), _HKI('Inches')] as const;
/** `m_choiceCompressChoices`. */
export const COMPRESS_CHOICES = [_HKI('None'), _HKI('ZIP'), _HKI('TGZ')] as const;

export interface DIALOG_EXPORT_ODBPP_BASE_PROPS {
  /** The window title; `_("Export ODB++")` unless the job version sets its own. */
  title?: string;
  m_outputFileName: string;
  onOutputFileName: (aValue: string) => void;
  /** `m_browseButton->Hide()` in the job version. */
  browseShown?: boolean;
  /** `m_choiceUnits`: an index into UNITS_CHOICES. */
  m_choiceUnits: number;
  onChoiceUnits: (aIndex: number) => void;
  /** `m_precision`. */
  m_precision: number;
  onPrecision: (aValue: number) => void;
  /** `m_choiceCompress`: an index into COMPRESS_CHOICES. */
  m_choiceCompress: number;
  /** `onFormatChoice` (wxEVT_COMMAND_CHOICE_SELECTED). */
  onFormatChoice: (aIndex: number) => void;
  /** `onBrowseClicked`. */
  /** Absent: no browse button - the output is downloaded, so there is no folder on disk to pick. */
  onBrowseClicked?: () => void;
  /** `onOKClick`. */
  onOKClick: () => void;
  /** wxID_CANCEL. */
  onCancel: () => void;
}

const choiceOptions = (aChoices: readonly string[]) =>
  aChoices.map((label, i) => ({ value: String(i), label }));

export function DIALOG_EXPORT_ODBPP_BASE(p: DIALOG_EXPORT_ODBPP_BASE_PROPS): JSX.Element {
  const precisionTip = _('The number of values following the decimal separator');

  return (
    <DialogShim title={p.title ?? _('Export ODB++')} onClose={p.onCancel}>
      {/* bMainSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem flag={wxALL | wxEXPAND} border={5}>
          {/* bSizerTop */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={5}>
              {/* m_lblBrdFile */}
              <span>{_('Output file:')}</span>
            </SizerItem>
            <SizerItem proportion={1} flag={wxALL | wxEXPAND} border={5} minSize={[350, -1]}>
              {/* m_outputFileName */}
              <TextCtrl
                value={p.m_outputFileName}
                onChange={p.onOutputFileName}
                ariaLabel={_('Output file')}
                title={
                  'Enter a filename if you do not want to use default file names\n' +
                  'Can be used only when printing the current sheet'
                }
              />
            </SizerItem>
            <SizerItem
              flag={wxALIGN_CENTER_VERTICAL | wxRIGHT}
              border={5}
              shown={p.browseShown !== false && p.onBrowseClicked !== undefined}
            >
              {/* m_browseButton: small_folder (DIALOG_EXPORT_ODBPP's constructor) */}
              <StdBitmapButton
                bitmap="small_folder"
                title={_('Browse')}
                tooltip={null}
                onClick={() => p.onBrowseClicked?.()}
              />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxALL} border={5}>
          {/* bSizer3 */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem proportion={3} flag={wxEXPAND | wxRIGHT | wxLEFT} border={5}>
              {/* fgSizer = wxFlexGridSizer( 0, 2, 5, 5 ), AddGrowableCol( 1 ) */}
              <FlexGridSizer cols={2} vgap={5} hgap={5} growableCols={[1]}>
                <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                  {/* m_lblUnits */}
                  <span>{_('Units:')}</span>
                </SizerItem>
                <SizerItem flag={wxEXPAND} border={5}>
                  {/* m_choiceUnits */}
                  <Combo
                    value={String(p.m_choiceUnits)}
                    options={choiceOptions(UNITS_CHOICES)}
                    onChange={(v) => p.onChoiceUnits(Number(v))}
                    ariaLabel="Units"
                  />
                </SizerItem>
                <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                  {/* m_lblPrecision */}
                  <span title={precisionTip}>{_('Precision:')}</span>
                </SizerItem>
                <SizerItem flag={wxEXPAND} border={5}>
                  {/* m_precision: wxSpinCtrl( 2, 16, 6 ) */}
                  <SpinCtrl
                    value={p.m_precision}
                    onChange={p.onPrecision}
                    min={2}
                    max={16}
                    ariaLabel="Precision"
                  />
                </SizerItem>
                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT} border={5}>
                  {/* m_lblCompress */}
                  <span title={_('Select the format to compress the output ODB++ files')}>
                    {_('Compression format:')}
                  </span>
                </SizerItem>
                <SizerItem flag={wxEXPAND} border={5}>
                  {/* m_choiceCompress */}
                  <Combo
                    value={String(p.m_choiceCompress)}
                    options={choiceOptions(COMPRESS_CHOICES)}
                    onChange={(v) => p.onFormatChoice(Number(v))}
                    ariaLabel="Compression format"
                  />
                </SizerItem>
              </FlexGridSizer>
            </SizerItem>
            <SizerItem proportion={2} flag={wxEXPAND} border={5}>
              {/* bSizer4: an empty column */}
              <BoxSizer orient={wxVERTICAL}>
                <Spacer proportion={1} flag={wxEXPAND} border={5} />
              </BoxSizer>
            </SizerItem>
          </BoxSizer>
        </SizerItem>
      </BoxSizer>
      {/* m_stdButtons: wxALL|wxEXPAND 5 */}
      <StdDialogButtonSizer onCancel={p.onCancel} onOk={p.onOKClick} />
    </DialogShim>
  );
}
