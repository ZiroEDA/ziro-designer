// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_ERC_BASE` (eeschema/dialogs/dialog_erc_base.cpp): the sizer tree, Add() for Add() - the
 * info bar; the options gear; m_runningResultsBook (the running notebook with its messages and
 * gauge, or the results notebook with Violations and Ignored Tests); the Show: severity row with
 * its badges and Save...; and Delete Marker / Delete All Markers beside the standard pair. A
 * modeless dialog: the schematic stays live behind it. The behaviour is DIALOG_ERC's.
 */
import type { JSX, MouseEvent, ReactNode } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { NumberBadge } from '@ziroeda/common/widgets/number_badge.js';
import { StdBitmapButton } from '@ziroeda/common/widgets/std_bitmap_button.js';
import { WX_HTML_REPORT_BOX } from '@ziroeda/common/widgets/wx_html_report_box.js';
import { Infobar } from '@ziroeda/common/widgets/wx_infobar.js';
import {
  Button,
  type CHECK,
  CheckBox,
  Gauge,
  HyperlinkCtrl,
  ListCtrl,
  StaticText,
} from '@ziroeda/wx/controls.js';
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
import { Notebook } from '@ziroeda/wx/notebook_ui.js';
import { Simplebook } from '@ziroeda/wx/simplebook.js';
import {
  BoxSizer,
  GridBagSizer,
  SizerItem,
  Spacer,
  StdDialogButtonSizer,
  StretchSpacer,
} from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

/** A severity checkbox and the NUMBER_BADGE after it. */
export interface SEVERITY {
  check: CHECK;
  /** The badge's number; -1 hides it (updateDisplayedCounts before a run). */
  count: number;
  severity: number;
}

export interface DIALOG_ERC_BASE_PROPS {
  /** m_infoBar: the "not fully annotated" message, or null. */
  m_infoBar: string | null;
  /** The info bar's "Show Annotation dialog" link. */
  onShowAnnotate?: () => void;
  onMenu: (aAnchor: HTMLElement) => void;
  /** m_runningResultsBook: 0 running, 1 results. */
  runningResultsPage: number;
  /** m_messages: the phase messages so far. */
  m_messages: readonly string[];
  /** m_gauge's value out of its 1000 range. */
  gauge: number;
  /** m_notebook: 0 Violations, 1 Ignored Tests. */
  resultsPage: number;
  onResultsPageChanged: (aPage: number) => void;
  violationsTitle: string;
  ignoredTitle: string;
  /** m_markerDataView: the marker tree, wxDV_NO_HEADER, 640 x 260 minimum. */
  m_markerDataView: ReactNode;
  /** m_ignoredList: one column, no header. */
  ignoredRows: readonly string[];
  /** wxEVT_LIST_ITEM_RIGHT_CLICK on m_ignoredList: OnIgnoredItemRClick. */
  onIgnoredRightClick?: (aRow: number, aEvent: MouseEvent) => void;
  onEditIgnoredTests?: () => void;
  m_showAll: CHECK;
  m_showErrors: SEVERITY;
  m_showWarnings: SEVERITY;
  m_showExclusions: SEVERITY;
  badgeMax: number;
  saveEnabled: boolean;
  onSaveReport: (aAnchor: HTMLElement) => void;
  deleteEnabled: boolean;
  onDeleteOneMarker: () => void;
  onDeleteAllMarkers: () => void;
  /** wxID_OK, relabelled "Run ERC"; wxID_CANCEL "Close", or "Cancel" while running. */
  runEnabled: boolean;
  cancelLabel: string;
  onRunERC: () => void;
  onCancel: () => void;
}

export function DIALOG_ERC_BASE(p: DIALOG_ERC_BASE_PROPS): JSX.Element {
  const severity = (aLabel: string, s: SEVERITY) => (
    <>
      <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
        <CheckBox label={aLabel} check={s.check} />
      </SizerItem>
      <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT} border={25}>
        <NumberBadge number={s.count} severity={s.severity} max={p.badgeMax} />
      </SizerItem>
    </>
  );

  return (
    <DialogShim title={_('Electrical Rules Checker')} onClose={p.onCancel} modeless>
      {/* bSizer1 */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem flag={wxEXPAND} border={5} shown={p.m_infoBar !== null}>
          <Infobar
            message={p.m_infoBar ?? ''}
            {...(p.onShowAnnotate
              ? { actionLabel: _('Show Annotation dialog'), onAction: p.onShowAnnotate }
              : {})}
          />
        </SizerItem>
        <SizerItem proportion={1} flag={wxEXPAND | wxALL} border={5}>
          {/* bMainSizer */}
          <BoxSizer orient={wxVERTICAL}>
            <SizerItem flag={wxEXPAND | wxLEFT} border={5}>
              {/* gbSizerOptions: AddGrowableCol( 0 / 1 ), AddGrowableRow( 0 / 1 ) */}
              <GridBagSizer vgap={0} hgap={0} growableCols={[0, 1]} growableRows={[0, 1]}>
                <SizerItem pos={[0, 2]} span={[2, 1]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
                  <StdBitmapButton
                    bitmap="config"
                    title="Options"
                    tooltip={null}
                    onClick={(e) => p.onMenu(e.currentTarget as HTMLElement)}
                  />
                </SizerItem>
              </GridBagSizer>
            </SizerItem>
            <SizerItem proportion={1} flag={wxEXPAND | wxTOP | wxRIGHT} border={5}>
              <Simplebook
                selection={p.runningResultsPage}
                pages={[
                  // running > bSizer14 > m_runningNotebook
                  <Notebook
                    key="running"
                    selection={0}
                    onPageChanged={() => {}}
                    pages={[
                      {
                        text: _('Tests Running...'),
                        content: (
                          // bSizer10
                          <BoxSizer orient={wxVERTICAL}>
                            <SizerItem
                              proportion={1}
                              flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT}
                              border={5}
                            >
                              <WX_HTML_REPORT_BOX messages={p.m_messages} />
                            </SizerItem>
                            <SizerItem flag={wxEXPAND | wxRIGHT | wxLEFT} border={5}>
                              {/* bGaugeMargins */}
                              <BoxSizer orient={wxVERTICAL}>
                                <SizerItem flag={wxALL | wxEXPAND} border={5}>
                                  <Gauge value={p.gauge} range={1000} />
                                </SizerItem>
                              </BoxSizer>
                            </SizerItem>
                          </BoxSizer>
                        ),
                      },
                    ]}
                  />,
                  // results > bSizer13 > m_notebook
                  <Notebook
                    key="results"
                    selection={p.resultsPage}
                    onPageChanged={p.onResultsPageChanged}
                    pages={[
                      {
                        text: p.violationsTitle,
                        content: (
                          // bViolationsSizer
                          <BoxSizer orient={wxVERTICAL}>
                            <SizerItem
                              proportion={2}
                              flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT}
                              border={5}
                              minSize={[640, 260]}
                            >
                              {p.m_markerDataView}
                            </SizerItem>
                            <Spacer width={0} height={8} flag={wxEXPAND} border={5} />
                          </BoxSizer>
                        ),
                      },
                      {
                        text: p.ignoredTitle,
                        content: (
                          // bSizer15
                          <BoxSizer orient={wxVERTICAL}>
                            <SizerItem
                              proportion={1}
                              flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT}
                              border={5}
                            >
                              <ListCtrl
                                rows={p.ignoredRows.map((r) => [r])}
                                onRightClick={p.onIgnoredRightClick}
                                columnWidths={[660]}
                                ariaLabel="Ignored tests"
                              />
                            </SizerItem>
                            <SizerItem flag={wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
                              <HyperlinkCtrl
                                label={_('Edit ignored tests')}
                                onClick={p.onEditIgnoredTests ?? (() => {})}
                              />
                            </SizerItem>
                            <Spacer width={0} height={8} flag={wxEXPAND} border={5} />
                          </BoxSizer>
                        ),
                      },
                    ]}
                  />,
                ]}
              />
            </SizerItem>
            <SizerItem flag={wxEXPAND | wxRIGHT | wxLEFT} border={5}>
              {/* bSizer11 > bSeveritySizer */}
              <BoxSizer orient={wxVERTICAL}>
                <SizerItem flag={wxEXPAND | wxALL} border={5}>
                  <BoxSizer orient={wxHORIZONTAL}>
                    <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT} border={5}>
                      <StaticText label={_('Show:')} />
                    </SizerItem>
                    <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
                      <CheckBox label={_('All')} check={p.m_showAll} />
                    </SizerItem>
                    <Spacer width={35} height={0} flag={wxEXPAND} border={5} />
                    {severity(_('Errors'), p.m_showErrors)}
                    {severity(_('Warnings'), p.m_showWarnings)}
                    {severity(_('Exclusions'), p.m_showExclusions)}
                    <StretchSpacer />
                    <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
                      <Button
                        label={_('Save...')}
                        disabled={!p.saveEnabled}
                        onClick={(e) => p.onSaveReport(e.currentTarget)}
                      />
                    </SizerItem>
                  </BoxSizer>
                </SizerItem>
              </BoxSizer>
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxLEFT} border={10}>
          {/* m_buttonsSizer */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem flag={wxALL | wxALIGN_CENTER_VERTICAL} border={5}>
              <Button
                label={_('Delete Marker')}
                disabled={!p.deleteEnabled}
                onClick={p.onDeleteOneMarker}
              />
            </SizerItem>
            <SizerItem flag={wxRIGHT | wxLEFT | wxALIGN_CENTER_VERTICAL} border={8}>
              <Button
                label={_('Delete All Markers')}
                disabled={!p.deleteEnabled}
                onClick={p.onDeleteAllMarkers}
              />
            </SizerItem>
            <StretchSpacer />
            <SizerItem flag={wxEXPAND | wxALL} border={5}>
              <StdDialogButtonSizer
                okLabel={_('Run ERC')}
                cancelLabel={p.cancelLabel}
                okDisabled={!p.runEnabled}
                onOk={p.onRunERC}
                onCancel={p.onCancel}
              />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
