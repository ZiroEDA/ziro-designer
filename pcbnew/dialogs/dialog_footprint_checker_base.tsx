// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_FOOTPRINT_CHECKER_BASE` (pcbnew/dialogs/dialog_footprint_checker_base.cpp): the markers
 * data view (at least 660 x 250 with the severity row), the Show: severity row with its number
 * badges, and Delete Marker / Delete All Markers beside Run Checks / Close. The behaviour is
 * DIALOG_FOOTPRINT_CHECKER's (dialog_footprint_checker.tsx).
 */
import type { JSX } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { NumberBadge } from '@ziroeda/common/widgets/number_badge.js';
import { RcTreeView } from '@ziroeda/common/widgets/rc_tree_view.js';
import { Button, type CHECK, CheckBox, StaticText } from '@ziroeda/wx/controls.js';
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
import { BoxSizer, SizerItem, Spacer, StdDialogButtonSizer } from '@ziroeda/wx/sizer.js';
import {
  RPT_SEVERITY_ERROR,
  RPT_SEVERITY_EXCLUSION,
  RPT_SEVERITY_WARNING,
} from '@ziroeda/common/reporter.js';
import type { BADGE, DATA_VIEW } from './dialog_drc_base.js';
import { _ } from '@ziroeda/wx/translation.js';

export interface DIALOG_FOOTPRINT_CHECKER_BASE_PROPS {
  m_markersDataView: DATA_VIEW;
  m_showAll: CHECK;
  m_showErrors: CHECK;
  m_errorsBadge: BADGE;
  m_showWarnings: CHECK;
  m_warningsBadge: BADGE;
  m_showExclusions: CHECK;
  m_exclusionsBadge: BADGE;
  onDeleteOneClick: () => void;
  onDeleteAllClick: () => void;
  onRunChecksClick: () => void;
  onCancelClick: () => void;
}

const CV = wxALIGN_CENTER_VERTICAL;

export function DIALOG_FOOTPRINT_CHECKER_BASE(p: DIALOG_FOOTPRINT_CHECKER_BASE_PROPS): JSX.Element {
  const severity = (aLabel: string, c: CHECK, b: BADGE, aSeverity: number) => (
    <>
      <SizerItem flag={CV | wxRIGHT | wxLEFT} border={5}>
        <CheckBox label={aLabel} check={c} />
      </SizerItem>
      <SizerItem flag={CV | wxRIGHT} border={25}>
        <NumberBadge number={b.number} max={b.max} severity={aSeverity} />
      </SizerItem>
    </>
  );

  return (
    <DialogShim title={_('Footprint Checker')} onClose={p.onCancelClick} modeless>
      {/* bSizerMain */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem
          proportion={1}
          flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT}
          border={10}
          minSize={[660, 250]}
        >
          {/* bUpperSizer, SetMinSize( wxSize( 660, 250 ) ) */}
          <BoxSizer orient={wxVERTICAL}>
            <SizerItem proportion={1} flag={wxALL | wxEXPAND} border={5}>
              {/* m_markersDataView, wxDV_NO_HEADER */}
              <RcTreeView
                model={p.m_markersDataView.model}
                view={p.m_markersDataView.view}
                onDoubleClick={p.m_markersDataView.onDClick}
                onContextMenu={p.m_markersDataView.onRClick}
              />
            </SizerItem>
            <SizerItem flag={wxEXPAND | wxTOP} border={3}>
              {/* bSizer9 */}
              <BoxSizer orient={wxVERTICAL}>
                <SizerItem flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
                  {/* bSeveritySizer */}
                  <BoxSizer orient={wxHORIZONTAL}>
                    <SizerItem flag={CV | wxRIGHT} border={5}>
                      <StaticText label={_('Show:')} />
                    </SizerItem>
                    <SizerItem flag={CV | wxRIGHT | wxLEFT} border={5}>
                      <CheckBox label={_('All')} check={p.m_showAll} />
                    </SizerItem>
                    <Spacer width={35} height={0} flag={wxEXPAND} border={5} />
                    {severity(_('Errors'), p.m_showErrors, p.m_errorsBadge, RPT_SEVERITY_ERROR)}
                    {severity(
                      _('Warnings'),
                      p.m_showWarnings,
                      p.m_warningsBadge,
                      RPT_SEVERITY_WARNING,
                    )}
                    {severity(
                      _('Exclusions'),
                      p.m_showExclusions,
                      p.m_exclusionsBadge,
                      RPT_SEVERITY_EXCLUSION,
                    )}
                    <Spacer width={5} height={0} proportion={1} flag={wxEXPAND} border={5} />
                  </BoxSizer>
                </SizerItem>
              </BoxSizer>
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxLEFT} border={10}>
          {/* bLowerSizer */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem flag={CV | wxALL} border={5}>
              <Button label={_('Delete Marker')} onClick={p.onDeleteOneClick} />
            </SizerItem>
            <SizerItem flag={wxALL | CV} border={5}>
              <Button label={_('Delete All Markers')} onClick={p.onDeleteAllClick} />
            </SizerItem>
            <SizerItem proportion={1} flag={wxEXPAND | wxALL} border={5}>
              {/* SetupStandardButtons( { wxID_OK, "Run Checks" }, { wxID_CANCEL, "Close" } ) */}
              <StdDialogButtonSizer
                onOk={p.onRunChecksClick}
                onCancel={p.onCancelClick}
                okLabel={_('Run Checks')}
                cancelLabel={_('Close')}
              />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
