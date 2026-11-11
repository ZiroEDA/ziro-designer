// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_UPDATE_PCB_BASE` (pcbnew/dialogs/dialog_update_pcb_base.cpp): the sizer tree, Add() for
 * Add(). The members are props; the behaviour is DIALOG_UPDATE_PCB's (dialog_update_pcb.tsx).
 */
import type { JSX } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import type { ReportLine, Severity } from '@ziroeda/common/reporter.js';
import { HtmlReportPanel } from '@ziroeda/common/widgets/wx_html_report_panel.js';
import { type CHECK, CheckBox } from '@ziroeda/wx/controls.js';
import { wxALL, wxBOTTOM, wxEXPAND, wxLEFT, wxRIGHT, wxTOP, wxVERTICAL } from '@ziroeda/wx/defs.js';
import {
  BoxSizer,
  SizerItem,
  Spacer,
  StaticBoxSizer,
  StdDialogButtonSizer,
} from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

export interface DIALOG_UPDATE_PCB_BASE_PROPS {
  m_cbRelinkFootprints: CHECK;
  m_cbTransferGroups: CHECK;
  m_cbApplyDesignBlockLayouts: CHECK;
  applyDesignBlockLayoutsTip: string;
  m_cbUpdateFootprints: CHECK;
  m_cbDeleteExtraFootprints: CHECK;
  m_cbOverrideLocks: CHECK;
  m_cbUpdateFields: CHECK;
  m_cbRemoveExtraFields: CHECK;
  /** `m_messagePanel`, a WX_HTML_REPORT_PANEL. */
  m_messagePanel: {
    label: string;
    lines: readonly ReportLine[];
    severities: Severity;
    onSeveritiesChange: (aSeverities: Severity) => void;
  };
  okEnabled: boolean;
  OnUpdateClick: () => void;
  onCancel: () => void;
}

const BRL = wxBOTTOM | wxRIGHT | wxLEFT;

export function DIALOG_UPDATE_PCB_BASE(p: DIALOG_UPDATE_PCB_BASE_PROPS): JSX.Element {
  const check = (aLabel: string, c: CHECK, aTitle?: string): JSX.Element => (
    <SizerItem flag={BRL} border={5}>
      <CheckBox label={aLabel} check={c} title={aTitle} />
    </SizerItem>
  );

  return (
    <DialogShim title={_('Update PCB from Schematic')} onClose={p.onCancel}>
      {/* bMainSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem flag={wxALL | wxEXPAND} border={5}>
          {/* bUpperSizer */}
          <BoxSizer orient={wxVERTICAL}>
            <SizerItem proportion={1} flag={wxEXPAND | wxALL} border={5}>
              <StaticBoxSizer label={_('Options')} orient={wxVERTICAL}>
                {check(
                  _('Re-link footprints to schematic symbols based on their reference designators'),
                  p.m_cbRelinkFootprints,
                  _(
                    'Normally footprints are linked to their symbols via their Unique IDs.  Select this option only if you want to reset the footprint linkages based on their reference designators.',
                  ),
                )}
                {check(_('Group footprints based on symbol group'), p.m_cbTransferGroups)}
                {check(
                  _('Apply design block layouts to new groups'),
                  p.m_cbApplyDesignBlockLayouts,
                  p.applyDesignBlockLayoutsTip,
                )}
              </StaticBoxSizer>
            </SizerItem>
            <Spacer width={0} height={5} flag={wxEXPAND} border={5} />
            <SizerItem flag={wxEXPAND | wxALL} border={5}>
              <StaticBoxSizer label={_('Update Footprints')} orient={wxVERTICAL}>
                {check(
                  _('Replace footprints with those specified by symbols'),
                  p.m_cbUpdateFootprints,
                  _(
                    "Normally footprints on the board should be changed to match footprint assignment changes made in the schematic. Uncheck this only if you don't want to change existing footprints on the board.",
                  ),
                )}
                {check(
                  _('Delete footprints with no symbols'),
                  p.m_cbDeleteExtraFootprints,
                  _(
                    'Remove from the board unlocked footprints which are not linked to a schematic symbol.',
                  ),
                )}
                {check(_('Override locks'), p.m_cbOverrideLocks)}
              </StaticBoxSizer>
            </SizerItem>
            <Spacer width={0} height={5} flag={wxEXPAND} border={5} />
            <SizerItem flag={wxEXPAND | wxALL} border={5}>
              <StaticBoxSizer label={_('Update Fields')} orient={wxVERTICAL}>
                {check(_('Update footprint fields from symbols'), p.m_cbUpdateFields)}
                {check(_('Remove footprint fields not found in symbols'), p.m_cbRemoveExtraFields)}
              </StaticBoxSizer>
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem
          proportion={1}
          flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT}
          border={5}
          minSize={[660, 300]}
        >
          {/* bLowerSizer, SetMinSize( wxSize( 660,300 ) ) */}
          <BoxSizer orient={wxVERTICAL}>
            <SizerItem proportion={1} flag={wxEXPAND | wxALL} border={5}>
              <HtmlReportPanel
                label={p.m_messagePanel.label}
                lines={p.m_messagePanel.lines}
                fileName="report.txt"
                visibleSeverities={p.m_messagePanel.severities}
                onVisibleSeveritiesChange={p.m_messagePanel.onSeveritiesChange}
                sorted
              />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxALL | wxEXPAND} border={5}>
          <StdDialogButtonSizer
            okLabel={_('Update PCB')}
            okDisabled={!p.okEnabled}
            onOk={p.OnUpdateClick}
            cancelLabel={_('Close')}
            onCancel={p.onCancel}
          />
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
