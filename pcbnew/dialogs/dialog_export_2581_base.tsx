// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_EXPORT_2581_BASE` (dialog_export_2581_base.cpp): the sizer tree, Add() for Add().
 * The controls' values and events are props; the behaviour is DIALOG_EXPORT_2581's
 * (dialog_export_2581.tsx).
 */
import type { JSX } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { StdBitmapButton } from '@ziroeda/common/widgets/std_bitmap_button.js';
import { HtmlReportPanel } from '@ziroeda/common/widgets/wx_html_report_panel.js';
import type { ReportLine } from '@ziroeda/common/reporter.js';
import { Combo, type ComboOption } from '@ziroeda/wx/combobox.js';
import { CheckBox, StaticLine, TextCtrl } from '@ziroeda/wx/controls.js';
import {
  wxALIGN_CENTER_VERTICAL,
  wxALL,
  wxBOTTOM,
  wxEXPAND,
  wxHORIZONTAL,
  wxLEFT,
  wxRIGHT,
  wxTOP,
  wxVERTICAL,
} from '@ziroeda/wx/defs.js';
import {
  BoxSizer,
  FlexGridSizer,
  GridBagSizer,
  SizerItem,
  Spacer,
  StdDialogButtonSizer,
} from '@ziroeda/wx/sizer.js';
import { SpinCtrl } from '@ziroeda/wx/spin_ctrl.js';
import { _ } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

/** `m_choiceUnitsChoices`, `m_versionChoiceChoices`. */
export const IPC_UNITS_CHOICES = [_HKI('Millimeters'), _HKI('Inches')] as const;
export const IPC_VERSION_CHOICES = ['B', 'C'] as const;

export interface DIALOG_EXPORT_2581_BASE_PROPS {
  m_outputFileName: string;
  onOutputFileName: (aValue: string) => void;
  /** Absent: no browse button - the output is downloaded, so there is no folder on disk to pick. */
  onBrowseClicked?: () => void;
  /** `m_choiceUnits` / `m_versionChoice`: indices into the choices above. */
  m_choiceUnits: number;
  onChoiceUnits: (aIndex: number) => void;
  /** `m_precision`: wxSpinCtrl( 4, 10, 6 ). */
  m_precision: number;
  onPrecision: (aValue: number) => void;
  m_versionChoice: number;
  onVersionChoice: (aIndex: number) => void;
  m_cbCompress: boolean;
  /** `onCompressCheck`. */
  onCompressCheck: (aOn: boolean) => void;
  m_textBomRev: string;
  onBomRev: (aValue: string) => void;
  /** The column choices; each list's first entry is the base's own ("Generate unique", ...). */
  m_oemRef: string;
  oemRefOptions: readonly ComboOption[];
  onOemRef: (aValue: string) => void;
  m_choiceMPN: string;
  mpnOptions: readonly ComboOption[];
  /** `onMfgPNChange`. */
  onMfgPNChange: (aValue: string) => void;
  m_choiceMfg: string;
  mfgOptions: readonly ComboOption[];
  onMfg: (aValue: string) => void;
  /** `m_choiceMfg->Enable( false )` until a manufacturer P/N column is chosen. */
  mfgEnabled: boolean;
  m_choiceDistPN: string;
  distPNOptions: readonly ComboOption[];
  /** `onDistPNChange`. */
  onDistPNChange: (aValue: string) => void;
  m_textDistributor: string;
  onDistributor: (aValue: string) => void;
  distributorEnabled: boolean;
  /** `m_messagesPanel`. */
  messages: readonly ReportLine[];
  visibleSeverities: number;
  onVisibleSeveritiesChange: (aSeverities: number) => void;
  onOKClick: () => void;
  onCancel: () => void;
}

export function DIALOG_EXPORT_2581_BASE(p: DIALOG_EXPORT_2581_BASE_PROPS): JSX.Element {
  const choice = (aList: readonly string[]): ComboOption[] =>
    aList.map((label, i) => ({ value: String(i), label }));
  const precisionTip = _('The number of values following the decimal separator');
  const bomRevTip = _(
    'Revision string for the BOM section. Auto-populated from schematic title block revision',
  );
  const oemTip = _(
    'Part ID number used internally during design.\nThis number must be unique to each part.',
  );
  const mpnTip = _('Column containing the manufacturer part number');

  return (
    <DialogShim title={_('Export IPC-2581')} onClose={p.onCancel}>
      {/* bMainSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem flag={wxEXPAND | wxALL} border={10}>
          {/* bSizerTop */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT} border={5}>
              {/* m_lblBrdFile */}
              <span>{_('File:')}</span>
            </SizerItem>
            <SizerItem proportion={1} flag={wxALIGN_CENTER_VERTICAL} border={5} minSize={[350, -1]}>
              {/* m_outputFileName */}
              <TextCtrl
                value={p.m_outputFileName}
                onChange={p.onOutputFileName}
                ariaLabel={_('File')}
                title={
                  'Enter a filename if you do not want to use default file names\n' +
                  'Can be used only when printing the current sheet'
                }
              />
            </SizerItem>
            <SizerItem
              flag={wxALIGN_CENTER_VERTICAL}
              border={10}
              shown={p.onBrowseClicked !== undefined}
            >
              {/* m_browseButton: small_folder */}
              <StdBitmapButton
                bitmap="small_folder"
                title={_('Browse')}
                tooltip={null}
                onClick={() => p.onBrowseClicked?.()}
              />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxBOTTOM} border={5}>
          {/* bSizerMiddle */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem proportion={1} flag={wxEXPAND | wxRIGHT | wxLEFT} border={10}>
              {/* bSizerLeftCol */}
              <BoxSizer orient={wxVERTICAL}>
                <SizerItem flag={wxTOP | wxRIGHT | wxLEFT} border={8}>
                  {/* m_fileFormatLabel */}
                  <span>{_('File Format')}</span>
                </SizerItem>
                <SizerItem flag={wxEXPAND | wxBOTTOM} border={5}>
                  {/* m_staticline1 */}
                  <StaticLine />
                </SizerItem>
                <SizerItem proportion={1} flag={wxEXPAND | wxTOP | wxRIGHT} border={5}>
                  {/* gbSizer1 = wxGridBagSizer( 5, 5 ), AddGrowableCol( 1 ) */}
                  <GridBagSizer vgap={5} hgap={5} growableCols={[1]}>
                    <SizerItem pos={[0, 0]} flag={wxALIGN_CENTER_VERTICAL | wxRIGHT} border={5}>
                      {/* m_lblUnits */}
                      <span>{_('Units:')}</span>
                    </SizerItem>
                    <SizerItem
                      pos={[0, 1]}
                      flag={wxALIGN_CENTER_VERTICAL | wxEXPAND | wxRIGHT}
                      border={10}
                    >
                      {/* m_choiceUnits */}
                      <Combo
                        value={String(p.m_choiceUnits)}
                        options={choice(IPC_UNITS_CHOICES)}
                        onChange={(v) => p.onChoiceUnits(Number(v))}
                        ariaLabel="Units"
                      />
                    </SizerItem>
                    <SizerItem pos={[1, 0]} flag={wxALIGN_CENTER_VERTICAL | wxRIGHT} border={15}>
                      {/* m_lblPrecision */}
                      <span title={precisionTip}>{_('Precision:')}</span>
                    </SizerItem>
                    <SizerItem
                      pos={[1, 1]}
                      flag={wxALIGN_CENTER_VERTICAL | wxEXPAND | wxRIGHT}
                      border={10}
                    >
                      {/* m_precision */}
                      <SpinCtrl
                        value={p.m_precision}
                        onChange={p.onPrecision}
                        min={4}
                        max={10}
                        ariaLabel="Precision"
                      />
                    </SizerItem>
                    <SizerItem pos={[2, 0]} flag={wxALIGN_CENTER_VERTICAL | wxRIGHT} border={5}>
                      {/* m_lblVersion */}
                      <span>{_('Version:')}</span>
                    </SizerItem>
                    <SizerItem
                      pos={[2, 1]}
                      flag={wxALIGN_CENTER_VERTICAL | wxEXPAND | wxRIGHT}
                      border={10}
                    >
                      {/* m_versionChoice */}
                      <Combo
                        value={String(p.m_versionChoice)}
                        options={choice(IPC_VERSION_CHOICES)}
                        onChange={(v) => p.onVersionChoice(Number(v))}
                        ariaLabel="Version"
                      />
                    </SizerItem>
                    <SizerItem pos={[3, 0]} span={[1, 2]} flag={wxTOP} border={5}>
                      {/* m_cbCompress */}
                      <CheckBox
                        label={_('Compress output')}
                        title={_("Compress output into 'zip' file")}
                        checked={p.m_cbCompress}
                        onChange={p.onCompressCheck}
                      />
                    </SizerItem>
                  </GridBagSizer>
                </SizerItem>
              </BoxSizer>
            </SizerItem>
            <Spacer width={10} height={0} flag={wxEXPAND} border={5} />
            <SizerItem proportion={1} flag={wxEXPAND | wxRIGHT | wxLEFT} border={10}>
              {/* bSizerRightCol */}
              <BoxSizer orient={wxVERTICAL}>
                <SizerItem flag={wxTOP | wxRIGHT | wxLEFT} border={8}>
                  {/* m_columnsLabel */}
                  <span>{_('BOM Columns')}</span>
                </SizerItem>
                <SizerItem flag={wxEXPAND | wxBOTTOM} border={5}>
                  {/* m_staticline2 */}
                  <StaticLine />
                </SizerItem>
                <SizerItem proportion={1} flag={wxALL | wxEXPAND} border={5}>
                  {/* fgSizer4 = wxFlexGridSizer( 0, 2, 5, 5 ), AddGrowableCol( 1 ) */}
                  <FlexGridSizer cols={2} vgap={5} hgap={5} growableCols={[1]}>
                    <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxEXPAND} border={5}>
                      <span title={bomRevTip}>{_('BOM revision:')}</span>
                    </SizerItem>
                    <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxEXPAND | wxRIGHT} border={5}>
                      <TextCtrl
                        value={p.m_textBomRev}
                        onChange={p.onBomRev}
                        title={bomRevTip}
                        ariaLabel={_('BOM revision')}
                      />
                    </SizerItem>
                    <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxEXPAND} border={5}>
                      <span title={oemTip}>{_('Internal ID:')}</span>
                    </SizerItem>
                    <SizerItem flag={wxEXPAND | wxRIGHT} border={5}>
                      <Combo
                        value={p.m_oemRef}
                        options={p.oemRefOptions}
                        onChange={p.onOemRef}
                        ariaLabel={_('Internal ID')}
                      />
                    </SizerItem>
                    <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxEXPAND} border={5}>
                      <span title={mpnTip}>{_('Manufacturer P/N:')}</span>
                    </SizerItem>
                    <SizerItem flag={wxEXPAND | wxRIGHT} border={5}>
                      <Combo
                        value={p.m_choiceMPN}
                        options={p.mpnOptions}
                        onChange={p.onMfgPNChange}
                        ariaLabel={_('Manufacturer P/N')}
                      />
                    </SizerItem>
                    <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxEXPAND} border={5}>
                      <span>{_('Manufacturer:')}</span>
                    </SizerItem>
                    <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxEXPAND | wxRIGHT} border={5}>
                      <Combo
                        value={p.m_choiceMfg}
                        options={p.mfgOptions}
                        onChange={p.onMfg}
                        disabled={!p.mfgEnabled}
                        ariaLabel="Manufacturer"
                      />
                    </SizerItem>
                    <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                      <span>{_('Distributor P/N:')}</span>
                    </SizerItem>
                    <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxEXPAND | wxRIGHT} border={5}>
                      <Combo
                        value={p.m_choiceDistPN}
                        options={p.distPNOptions}
                        onChange={p.onDistPNChange}
                        ariaLabel={_('Distributor P/N')}
                      />
                    </SizerItem>
                    <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                      <span>{_('Distributor:')}</span>
                    </SizerItem>
                    <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxEXPAND | wxRIGHT} border={5}>
                      <TextCtrl
                        value={p.m_textDistributor}
                        onChange={p.onDistributor}
                        disabled={!p.distributorEnabled}
                        ariaLabel={_('Distributor')}
                      />
                    </SizerItem>
                  </FlexGridSizer>
                </SizerItem>
              </BoxSizer>
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem proportion={1} flag={wxEXPAND | wxLEFT | wxRIGHT} border={5} minSize={[-1, 150]}>
          {/* m_messagesPanel: WX_HTML_REPORT_PANEL, SetMinSize( wxSize( -300,150 ) ) */}
          <HtmlReportPanel
            lines={p.messages}
            fileName="report.txt"
            minHeight={150}
            visibleSeverities={p.visibleSeverities}
            onVisibleSeveritiesChange={p.onVisibleSeveritiesChange}
          />
        </SizerItem>
      </BoxSizer>
      {/* m_stdButtons; SetupStandardButtons( { wxID_OK, "Export" }, { wxID_CANCEL, "Close" } ) */}
      <StdDialogButtonSizer
        onCancel={p.onCancel}
        onOk={p.onOKClick}
        okLabel={_('Export')}
        cancelLabel={_('Close')}
      />
    </DialogShim>
  );
}
