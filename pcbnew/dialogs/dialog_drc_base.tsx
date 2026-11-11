// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_DRC_BASE` (pcbnew/dialogs/dialog_drc_base.cpp): the sizer tree, Add() for Add(), plus
 * the two-field `m_drcStatusBar` DIALOG_DRC's constructor appends to m_MainSizer
 * (dialog_drc.cpp:167-174). The members are props; the behaviour is DIALOG_DRC's
 * (dialog_drc.tsx). Modeless: DRC_TOOL `Show()`s it over the live canvas.
 */
import type { JSX, MouseEvent, Ref } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import type { RC_TREE_MODEL, RC_TREE_NODE, RC_TREE_VIEW_STATE } from '@ziroeda/common/rc_item.js';
import {
  RPT_SEVERITY_ERROR,
  RPT_SEVERITY_EXCLUSION,
  RPT_SEVERITY_WARNING,
} from '@ziroeda/common/reporter.js';
import { NumberBadge } from '@ziroeda/common/widgets/number_badge.js';
import { RcTreeView } from '@ziroeda/common/widgets/rc_tree_view.js';
import { WX_HTML_REPORT_BOX } from '@ziroeda/common/widgets/wx_html_report_box.js';
import { StdBitmapButton } from '@ziroeda/common/widgets/std_bitmap_button.js';
import {
  Button,
  type CHECK,
  CheckBox,
  Gauge,
  HyperlinkCtrl,
  ListCtrl,
  StaticText,
  StatusBar,
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
} from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

/** A wxDataViewCtrl over an RC_TREE_MODEL, with its three connected events. */
export interface DATA_VIEW {
  model: RC_TREE_MODEL;
  view: RC_TREE_VIEW_STATE;
  onDClick: (aNode: RC_TREE_NODE) => void;
  onRClick: (aEvent: MouseEvent, aNode: RC_TREE_NODE) => void;
}

/** A NUMBER_BADGE: `UpdateNumber( number, severity )` and `SetMaximumNumber`. */
export interface BADGE {
  number: number;
  max: number;
}

export interface DIALOG_DRC_BASE_PROPS {
  m_cbRefillZones: CHECK;
  m_cbTestFootprints: CHECK;
  /** `m_cbTestFootprints->Hide()` when `Kiface().IsSingle()`. */
  testFootprintsShown: boolean;
  /** `m_bMenu`'s wxEVT_BUTTON, with the button's rect for the menu. */
  onMenu: (aAnchor: DOMRect) => void;
  /** `m_runningResultsBook->ChangeSelection()`: 0 running, 1 results. */
  runningResultsPage: number;
  /** `m_messages`, a WX_HTML_REPORT_BOX, and its wxEVT_HTML_LINK_CLICKED. */
  messages: readonly string[];
  onErrorLinkClicked: () => void;
  /** `m_gauge->SetValue()`, range 1000. */
  gauge: number;
  m_Notebook: {
    selection: number;
    /** `m_Notebook->SetPageText()`: the templates with their counts. */
    pageTexts: readonly string[];
    onPageChanged: (aPage: number) => void;
  };
  m_markerDataView: DATA_VIEW;
  m_unconnectedDataView: DATA_VIEW;
  m_footprintsDataView: DATA_VIEW;
  /** `m_ignoredList`: one column, DEFAULT_SINGLE_COL_WIDTH wide. */
  ignoredRows: readonly string[];
  ignoredColumnWidth: number;
  onIgnoredItemRClick: (aRow: number, aEvent: MouseEvent) => void;
  onEditViolationSeverities: () => void;
  m_showAll: CHECK;
  m_showErrors: CHECK;
  m_errorsBadge: BADGE;
  m_showWarnings: CHECK;
  m_warningsBadge: BADGE;
  m_showExclusions: CHECK;
  m_exclusionsBadge: BADGE;
  saveReportEnabled: boolean;
  onSaveReport: () => void;
  deleteEnabled: boolean;
  onDeleteOneClick: () => void;
  onDeleteAllClick: () => void;
  /** SetupStandardButtons: "Run DRC" / "Close" ("Cancel" while running). */
  okEnabled: boolean;
  cancelLabel: string;
  onRunDRCClick: () => void;
  onCancelClick: () => void;
  /** `m_drcStatusBar`'s second field. */
  statusText: string;
  /** The window, for the frame's `findDialogRects`. */
  frameRef: Ref<HTMLDivElement>;
}

/** A results page: `bSizer…Box` holding the data view (1, wxALL|wxEXPAND, 5) and an 8 px spacer. */
function DataViewPage({
  dv,
  testId,
  minHeight,
}: {
  dv: DATA_VIEW;
  testId: string;
  minHeight?: number;
}): JSX.Element {
  return (
    <SizerItem proportion={1} flag={wxEXPAND} minSize={[-1, minHeight ?? -1]}>
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem proportion={1} flag={wxALL | wxEXPAND} border={5}>
          <RcTreeView
            model={dv.model}
            view={dv.view}
            onDoubleClick={dv.onDClick}
            onContextMenu={dv.onRClick}
            testId={testId}
          />
        </SizerItem>
        <Spacer width={0} height={8} flag={wxEXPAND} border={5} />
      </BoxSizer>
    </SizerItem>
  );
}

function SeverityBox({
  label,
  check,
  badge,
  severity,
}: {
  label: string;
  check: CHECK;
  badge: BADGE;
  severity: number;
}): JSX.Element {
  return (
    <>
      <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
        <CheckBox label={label} check={check} />
      </SizerItem>
      <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT} border={25}>
        <NumberBadge number={badge.number} max={badge.max} severity={severity} />
      </SizerItem>
    </>
  );
}

export function DIALOG_DRC_BASE(p: DIALOG_DRC_BASE_PROPS): JSX.Element {
  return (
    <DialogShim title="DRC Control" onClose={p.onCancelClick} modeless frameRef={p.frameRef}>
      {/* m_MainSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem flag={wxEXPAND | wxTOP | wxBOTTOM | wxLEFT} border={3}>
          {/* bSizerOptions: two empty columns, bSizer12 and bSizerOptSettings */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem proportion={1} flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={5}>
              <BoxSizer orient={wxVERTICAL} />
            </SizerItem>
            <SizerItem proportion={1} flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={5}>
              <BoxSizer orient={wxVERTICAL} />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxTOP | wxLEFT} border={10}>
          {/* gbSizerOptions = wxGridBagSizer( 0, 0 ) */}
          <GridBagSizer vgap={0} hgap={0} growableCols={[0, 1]} growableRows={[0, 1]}>
            <SizerItem
              pos={[0, 0]}
              flag={wxALIGN_CENTER_VERTICAL | wxTOP | wxRIGHT | wxLEFT}
              border={5}
            >
              <CheckBox
                label={_('Refill all zones before performing DRC')}
                check={p.m_cbRefillZones}
              />
            </SizerItem>
            <SizerItem
              pos={[0, 1]}
              flag={wxALIGN_CENTER_VERTICAL | wxTOP | wxRIGHT | wxLEFT}
              border={5}
              shown={p.testFootprintsShown}
            >
              <CheckBox
                label={_('Test for parity between PCB and schematic')}
                check={p.m_cbTestFootprints}
              />
            </SizerItem>
            <SizerItem
              pos={[0, 2]}
              span={[2, 1]}
              flag={wxALIGN_CENTER_VERTICAL | wxRIGHT}
              border={10}
            >
              {/* m_bMenu, a STD_BITMAP_BUTTON: SetBitmap( KiBitmapBundle( BITMAPS::config ) ) */}
              <StdBitmapButton
                bitmap="config"
                title="DRC options"
                tooltip={null}
                onClick={(e) => p.onMenu(e.currentTarget.getBoundingClientRect())}
              />
            </SizerItem>
          </GridBagSizer>
        </SizerItem>
        <SizerItem proportion={1} flag={wxEXPAND} border={5}>
          <Simplebook
            selection={p.runningResultsPage}
            pages={[
              // running: bSizer14 > m_runningNotebook
              <BoxSizer key="running" orient={wxVERTICAL}>
                <SizerItem proportion={1} flag={wxEXPAND} border={5}>
                  <Notebook
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
                              <WX_HTML_REPORT_BOX
                                messages={p.messages}
                                onLinkClicked={p.onErrorLinkClicked}
                              />
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
                  />
                </SizerItem>
              </BoxSizer>,
              // results: bSizer13 > m_Notebook
              <BoxSizer key="results" orient={wxVERTICAL}>
                <SizerItem
                  proportion={1}
                  flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT}
                  border={10}
                  minSize={[640, -1]}
                >
                  <Notebook
                    selection={p.m_Notebook.selection}
                    onPageChanged={p.m_Notebook.onPageChanged}
                    ariaLabel="DRC results"
                    pages={[
                      {
                        text: p.m_Notebook.pageTexts[0]!,
                        content: (
                          // bSizerViolationsBox->SetMinSize( wxSize( -1,320 ) )
                          <BoxSizer orient={wxVERTICAL}>
                            <DataViewPage
                              dv={p.m_markerDataView}
                              testId="drc-violation-list"
                              minHeight={320}
                            />
                          </BoxSizer>
                        ),
                      },
                      {
                        text: p.m_Notebook.pageTexts[1]!,
                        content: (
                          <BoxSizer orient={wxVERTICAL}>
                            <DataViewPage
                              dv={p.m_unconnectedDataView}
                              testId="drc-unconnected-list"
                            />
                          </BoxSizer>
                        ),
                      },
                      {
                        text: p.m_Notebook.pageTexts[2]!,
                        content: (
                          <BoxSizer orient={wxVERTICAL}>
                            <DataViewPage dv={p.m_footprintsDataView} testId="drc-parity-list" />
                          </BoxSizer>
                        ),
                      },
                      {
                        text: p.m_Notebook.pageTexts[3]!,
                        content: (
                          // bSizer15
                          <BoxSizer orient={wxVERTICAL}>
                            <SizerItem proportion={1} flag={wxALL | wxEXPAND} border={5}>
                              <ListCtrl
                                rows={p.ignoredRows.map((r) => [r])}
                                columnWidths={[p.ignoredColumnWidth]}
                                onRightClick={p.onIgnoredItemRClick}
                                ariaLabel="Ignored tests"
                              />
                            </SizerItem>
                            <SizerItem flag={wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
                              <HyperlinkCtrl
                                label={_('Edit ignored tests')}
                                onClick={p.onEditViolationSeverities}
                              />
                            </SizerItem>
                            <Spacer width={0} height={7} flag={wxEXPAND} border={5} />
                          </BoxSizer>
                        ),
                      },
                    ]}
                  />
                </SizerItem>
              </BoxSizer>,
            ]}
          />
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
          {/* bSizer9 */}
          <BoxSizer orient={wxVERTICAL}>
            <SizerItem flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={5}>
              {/* bSeveritySizer */}
              <BoxSizer orient={wxHORIZONTAL}>
                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
                  <StaticText label={_('Show:')} />
                </SizerItem>
                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
                  <CheckBox label={_('All')} check={p.m_showAll} />
                </SizerItem>
                <Spacer width={35} height={0} flag={wxEXPAND} border={5} />
                <SeverityBox
                  label={_('Errors')}
                  check={p.m_showErrors}
                  badge={p.m_errorsBadge}
                  severity={RPT_SEVERITY_ERROR}
                />
                <SeverityBox
                  label={_('Warnings')}
                  check={p.m_showWarnings}
                  badge={p.m_warningsBadge}
                  severity={RPT_SEVERITY_WARNING}
                />
                <SeverityBox
                  label={_('Exclusions')}
                  check={p.m_showExclusions}
                  badge={p.m_exclusionsBadge}
                  severity={RPT_SEVERITY_EXCLUSION}
                />
                <Spacer width={5} height={0} proportion={1} flag={wxEXPAND} border={5} />
                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
                  <Button
                    label={_('Save...')}
                    disabled={!p.saveReportEnabled}
                    onClick={p.onSaveReport}
                  />
                </SizerItem>
              </BoxSizer>
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxLEFT} border={5}>
          {/* m_sizerButtons */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={10}>
              <Button
                label={_('Delete Marker')}
                disabled={!p.deleteEnabled}
                onClick={p.onDeleteOneClick}
              />
            </SizerItem>
            <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT} border={5}>
              <Button
                label={_('Delete All Markers')}
                disabled={!p.deleteEnabled}
                onClick={p.onDeleteAllClick}
              />
            </SizerItem>
            <SizerItem proportion={1} flag={wxEXPAND | wxALL} border={5}>
              <StdDialogButtonSizer
                onOk={p.onRunDRCClick}
                onCancel={p.onCancelClick}
                okLabel={_('Run DRC')}
                cancelLabel={p.cancelLabel}
                okDisabled={!p.okEnabled}
              />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND} border={0}>
          {/* m_drcStatusBar: SetStatusWidths( 2, { FromDIP( 12 ), -1 } ) */}
          <StatusBar widths={[12, -1]} texts={['', p.statusText]} />
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
