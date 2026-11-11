// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_IMPORT_NETLIST_BASE` (pcbnew/dialogs/dialog_import_netlist_base.cpp): the sizer tree,
 * Add() for Add(). The members are props; the behaviour is DIALOG_IMPORT_NETLIST's
 * (dialog_import_netlist.tsx).
 */
import type { JSX } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import type { ReportLine, Severity } from '@ziroeda/common/reporter.js';
import { StdBitmapButton } from '@ziroeda/common/widgets/std_bitmap_button.js';
import { HtmlReportPanel } from '@ziroeda/common/widgets/wx_html_report_panel.js';
import { type CHECK, CheckBox, RadioBox, StaticText, TextCtrl } from '@ziroeda/wx/controls.js';
import {
  wxALIGN_CENTER_VERTICAL,
  wxALIGN_TOP,
  wxALL,
  wxBOTTOM,
  wxEXPAND,
  wxHORIZONTAL,
  wxLEFT,
  wxRIGHT,
  wxTOP,
  wxVERTICAL,
} from '@ziroeda/wx/defs.js';
import { BoxSizer, SizerItem, StaticBoxSizer, StdDialogButtonSizer } from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

export interface DIALOG_IMPORT_NETLIST_BASE_PROPS {
  m_NetlistFilenameCtrl: { value: string; onChange: (aText: string) => void };
  onBrowseNetlistFiles: () => void;
  /** `m_matchByTimestamp->GetSelection()`. */
  m_matchByTimestamp: number;
  OnMatchChanged: (aSelection: number) => void;
  m_cbDeleteExtraFootprints: CHECK;
  m_cbUpdateFootprints: CHECK;
  m_cbTransferGroups: CHECK;
  m_cbOverrideLocks: CHECK;
  m_cbDeleteShortingTracks: CHECK;
  /** `m_MessageWindow`, a WX_HTML_REPORT_PANEL: its label, file name and lines. */
  m_MessageWindow: {
    label: string;
    fileName: string;
    lines: readonly ReportLine[];
    severities: Severity;
    onSeveritiesChange: (aSeverities: Severity) => void;
  };
  /** SetupStandardButtons' labels. */
  okLabel: string;
  applyLabel: string;
  cancelLabel: string;
  onImportNetlist: () => void;
  onUpdatePCB: () => void;
  onCancel: () => void;
}

const LRT = wxLEFT | wxRIGHT | wxTOP;

export function DIALOG_IMPORT_NETLIST_BASE(p: DIALOG_IMPORT_NETLIST_BASE_PROPS): JSX.Element {
  const check = (aLabel: string, c: CHECK, aFlag = wxBOTTOM): JSX.Element => (
    <SizerItem flag={aFlag} border={5}>
      <CheckBox label={aLabel} check={c} />
    </SizerItem>
  );

  return (
    <DialogShim title={_('Import Netlist')} onClose={p.onCancel}>
      {/* bMainSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem flag={wxEXPAND | wxALL} border={10}>
          {/* bSizerNetlistFilename */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT | wxRIGHT} border={5}>
              <StaticText label={_('Netlist file:')} />
            </SizerItem>
            <SizerItem proportion={1} flag={wxALIGN_CENTER_VERTICAL} border={5}>
              <TextCtrl
                value={p.m_NetlistFilenameCtrl.value}
                onChange={p.m_NetlistFilenameCtrl.onChange}
                ariaLabel="Netlist file"
              />
            </SizerItem>
            <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={2}>
              {/* m_browseButton->SetBitmap( KiBitmapBundle( BITMAPS::small_folder ) ) */}
              <StdBitmapButton
                bitmap="small_folder"
                title={_('Browse')}
                tooltip={null}
                onClick={p.onBrowseNetlistFiles}
              />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={5}>
          {/* bUpperSizer */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem proportion={1} flag={wxALIGN_TOP | wxEXPAND | LRT} border={5}>
              <RadioBox
                label={_('Link Method')}
                choices={[
                  _('Link footprints using component tstamps (unique ids)'),
                  _('Link footprints using reference designators'),
                ]}
                selection={p.m_matchByTimestamp}
                onChange={p.OnMatchChanged}
                title={_(
                  'Select whether to update footprint references to match their currently-assigned symbols, or to re-assign footprints to symbols which match their current references.',
                )}
              />
            </SizerItem>
            <SizerItem proportion={1} flag={wxEXPAND | LRT} border={5}>
              <StaticBoxSizer label={_('Options')} orient={wxVERTICAL}>
                {check(
                  _('Delete footprints with no components in netlist'),
                  p.m_cbDeleteExtraFootprints,
                )}
                {check(
                  _('Replace footprints with those specified in netlist'),
                  p.m_cbUpdateFootprints,
                )}
                {check(_('Group footprints based on symbol group'), p.m_cbTransferGroups)}
                {check(
                  _('Delete/replace footprints even if locked'),
                  p.m_cbOverrideLocks,
                  wxBOTTOM | wxRIGHT,
                )}
                {check(_('Delete tracks shorting multiple nets'), p.m_cbDeleteShortingTracks)}
              </StaticBoxSizer>
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem proportion={1} flag={wxEXPAND | LRT} border={5} minSize={[-1, 250]}>
          {/* bLowerSizer, SetMinSize( wxSize( -1,250 ) ) */}
          <BoxSizer orient={wxVERTICAL}>
            <SizerItem proportion={1} flag={wxEXPAND | wxALL} border={5}>
              <HtmlReportPanel
                label={p.m_MessageWindow.label}
                lines={p.m_MessageWindow.lines}
                fileName={p.m_MessageWindow.fileName}
                visibleSeverities={p.m_MessageWindow.severities}
                onVisibleSeveritiesChange={p.m_MessageWindow.onSeveritiesChange}
                sorted
              />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxALL} border={5}>
          {/* m_buttonsSizer */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem proportion={1} flag={wxEXPAND} border={5}>
              <StdDialogButtonSizer
                okLabel={p.okLabel}
                onOk={p.onImportNetlist}
                applyLabel={p.applyLabel}
                onApply={p.onUpdatePCB}
                cancelLabel={p.cancelLabel}
                onCancel={p.onCancel}
              />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
