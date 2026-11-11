// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_UPDATE_FROM_PCB_BASE` (eeschema/dialogs/dialog_update_from_pcb_base.cpp): the sizer
 * tree, Add() for Add(). The controls' values and events are props; the behaviour is
 * DIALOG_UPDATE_FROM_PCB's (dialog_update_from_pcb.tsx).
 */
import type { JSX } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import type { ReportLine, Severity } from '@ziroeda/common/reporter.js';
import { HtmlReportPanel } from '@ziroeda/common/widgets/wx_html_report_panel.js';
import { type CHECK, CheckBox } from '@ziroeda/wx/controls.js';
import { wxALL, wxBOTTOM, wxEXPAND, wxLEFT, wxRIGHT, wxTOP, wxVERTICAL } from '@ziroeda/wx/defs.js';
import {
  BoxSizer,
  FlexGridSizer,
  SizerItem,
  StaticBoxSizer,
  StdDialogButtonSizer,
} from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

export interface DIALOG_UPDATE_FROM_PCB_BASE_PROPS {
  m_cbRelinkFootprints: CHECK;
  m_cbUpdateReferences: CHECK;
  m_cbUpdateFootprints: CHECK;
  m_cbUpdateValues: CHECK;
  m_cbUpdateNetNames: CHECK;
  m_cbUpdateAttributes: CHECK;
  m_cbPreferUnitSwaps: CHECK;
  m_cbUpdateOtherFields: CHECK;
  m_cbPreferPinSwaps: CHECK;
  /** `m_messagePanel`: a WX_HTML_REPORT_PANEL. */
  m_messagePanel: {
    label: string;
    fileName: string;
    lines: readonly ReportLine[];
    visibleSeverities: Severity;
    onVisibleSeveritiesChange: (aMask: Severity) => void;
  };
  /** `SetupStandardButtons( { { wxID_OK, … }, { wxID_CANCEL, … } } )`. */
  okLabel: string;
  cancelLabel: string;
  /** `m_sdbSizerOK->Enable( … )`. */
  okEnabled: boolean;
  onUpdateClick: () => void;
  onCancel: () => void;
}

/** One `wxCheckBox` added `0, wxBOTTOM|wxRIGHT|wxLEFT, 5`, as every one here is. */
function Check({ label, tip, c }: { label: string; tip: string; c: CHECK }): JSX.Element {
  return (
    <SizerItem flag={wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
      <CheckBox label={label} title={tip} check={c} />
    </SizerItem>
  );
}

export function DIALOG_UPDATE_FROM_PCB_BASE(p: DIALOG_UPDATE_FROM_PCB_BASE_PROPS): JSX.Element {
  return (
    <DialogShim title={_('Update Schematic from PCB')} onClose={p.onCancel}>
      {/* bMainSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem flag={wxALL | wxEXPAND} border={5}>
          {/* bUpperSizer */}
          <BoxSizer orient={wxVERTICAL}>
            <SizerItem flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={5}>
              {/* sbSizerOptions */}
              <StaticBoxSizer label={_('Options')} orient={wxVERTICAL}>
                <SizerItem proportion={1} flag={wxEXPAND | wxBOTTOM} border={5}>
                  {/* fgSizer1 = wxFlexGridSizer( 0, 1, 0, 0 ) */}
                  <FlexGridSizer cols={1} vgap={0} hgap={0}>
                    <Check
                      label={_(
                        'Re-link footprints to schematic symbols based on their reference designators',
                      )}
                      tip={_(
                        'Normally footprints are linked to their symbols via their Unique IDs.  Select this option only if you want to reset the footprint linkages based on their reference designators.',
                      )}
                      c={p.m_cbRelinkFootprints}
                    />
                  </FlexGridSizer>
                </SizerItem>
              </StaticBoxSizer>
            </SizerItem>
            <SizerItem proportion={1} flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={5}>
              {/* sbSizer2 */}
              <StaticBoxSizer label={_('Update')} orient={wxVERTICAL}>
                <SizerItem proportion={1} flag={wxEXPAND} border={5}>
                  {/* fgSizer2 = wxFlexGridSizer( 0, 2, 0, 0 ), AddGrowableCol( 0 ), ( 1 ) */}
                  <FlexGridSizer cols={2} vgap={0} hgap={0} growableCols={[0, 1]}>
                    <Check
                      label={_('Reference designators')}
                      tip={_(
                        'Update references of symbols that have been changed in the PCB editor.',
                      )}
                      c={p.m_cbUpdateReferences}
                    />
                    <Check
                      label={_('Footprint assignments')}
                      tip={_(
                        'Update footprint associations of symbols whose footprints have been replaced with different footprints in PCB.',
                      )}
                      c={p.m_cbUpdateFootprints}
                    />
                    <Check
                      label={_('Values')}
                      tip={_('Update symbols values that have been replaced in the PCB editor.')}
                      c={p.m_cbUpdateValues}
                    />
                    <Check
                      label={_('Net names')}
                      tip={_('Update schematic net labels to match net names from the PCB editor.')}
                      c={p.m_cbUpdateNetNames}
                    />
                    <Check
                      label={_('Attributes')}
                      tip={_(
                        'Update symbol attribute flags like Do Not Populate to match the footprint.',
                      )}
                      c={p.m_cbUpdateAttributes}
                    />
                    <Check
                      label={_('Prefer symbol unit swaps over label swaps')}
                      tip={_(
                        'When possible, detect footprint gate swaps and apply corresponding symbol unit swaps instead of changing net labels.',
                      )}
                      c={p.m_cbPreferUnitSwaps}
                    />
                    <Check
                      label={_('Other fields')}
                      tip={_('Update all other fields in the symbol from the footprint')}
                      c={p.m_cbUpdateOtherFields}
                    />
                    <Check
                      label={_('Prefer symbol pin swaps over label swaps')}
                      tip={_(
                        'When possible, swap symbol pins to match footprint pad net swaps instead of changing net labels.',
                      )}
                      c={p.m_cbPreferPinSwaps}
                    />
                  </FlexGridSizer>
                </SizerItem>
              </StaticBoxSizer>
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem
          proportion={1}
          flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT}
          border={5}
          minSize={[600, 260]}
        >
          {/* bLowerSizer, SetMinSize( wxSize( 600,260 ) ) */}
          <BoxSizer orient={wxVERTICAL}>
            <SizerItem proportion={1} flag={wxEXPAND | wxALL} border={5}>
              {/* m_messagePanel */}
              <HtmlReportPanel
                label={p.m_messagePanel.label}
                lines={p.m_messagePanel.lines}
                fileName={p.m_messagePanel.fileName}
                visibleSeverities={p.m_messagePanel.visibleSeverities}
                onVisibleSeveritiesChange={p.m_messagePanel.onVisibleSeveritiesChange}
              />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxALL | wxEXPAND} border={5}>
          {/* m_sdbSizer: OK, Cancel */}
          <StdDialogButtonSizer
            okLabel={p.okLabel}
            cancelLabel={p.cancelLabel}
            okDisabled={!p.okEnabled}
            onOk={p.onUpdateClick}
            onCancel={p.onCancel}
          />
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
