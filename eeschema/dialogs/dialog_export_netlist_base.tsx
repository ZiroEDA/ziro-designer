// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_EXPORT_NETLIST_BASE` (eeschema/dialogs/dialog_export_netlist_base.cpp): the sizer tree,
 * Add() for Add() - the output path row, m_NoteBook (540 px), the message panel and the button
 * row - plus `EXPORT_NETLIST_PAGE` (dialog_export_netlist.cpp:218-245), the wxPanel each notebook
 * page is: an upper row of left / right / right-options sizers over m_LowBoxSizer.
 *
 * Not here: Add Exporter... / Remove Exporter and the SPICE page's "Run external simulator
 * command", which start a program on the desktop and have no browser counterpart.
 */
import type { JSX, ReactNode } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import type { ReportLine, Severity } from '@ziroeda/common/reporter.js';
import { HtmlReportPanel } from '@ziroeda/common/widgets/wx_html_report_panel.js';
import { CheckBox, type CHECK, StaticText, TextCtrl } from '@ziroeda/wx/controls.js';
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
import { BoxSizer, SizerItem, StdDialogButtonSizer } from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

/** A checkbox an EXPORT_NETLIST_PAGE adds to its m_LeftBoxSizer. */
export interface PAGE_CHECK extends CHECK {
  label: string;
  title: string;
  /** wxGROW for m_CurSheetAsRoot on the SPICE page; the others are added without it. */
  grow?: boolean;
}

/** One EXPORT_NETLIST_PAGE: its tab title, its label, and its options. */
export interface EXPORT_NETLIST_PAGE {
  title: string;
  label: string;
  checks: readonly PAGE_CHECK[];
}

export interface DIALOG_EXPORT_NETLIST_BASE_PROPS {
  /**
   * m_outputPath. Upstream shows it only for a job; here it is the netlist's file name
   * (and folder) as downloaded, what a desktop build's save dialog would choose.
   */
  m_outputPath: string;
  onOutputPath: (aText: string) => void;
  pages: readonly EXPORT_NETLIST_PAGE[];
  selection: number;
  onPageChanged: (aPage: number) => void;
  m_MessagesBox: {
    lines: readonly ReportLine[];
    fileName: string;
    visibleSeverities: Severity;
    onVisibleSeveritiesChange: (aMask: Severity) => void;
  };
  onOK: () => void;
  onCancel: () => void;
}

/** `EXPORT_NETLIST_PAGE`'s sizers, filled the way the Install* methods fill them. */
function NetlistPage({ page }: { page: EXPORT_NETLIST_PAGE }): ReactNode {
  return (
    // MainBoxSizer
    <BoxSizer orient={wxVERTICAL}>
      <SizerItem flag={wxEXPAND | wxALL} border={5}>
        {/* UpperBoxSizer: m_LeftBoxSizer, then the (empty) right and right-options sizers */}
        <BoxSizer orient={wxHORIZONTAL}>
          <SizerItem flag={wxEXPAND | wxALL} border={5}>
            {/* m_LeftBoxSizer */}
            <BoxSizer orient={wxVERTICAL}>
              <SizerItem flag={wxBOTTOM} border={10}>
                <StaticText label={page.label} />
              </SizerItem>
              {page.checks.map((c) => (
                <SizerItem
                  key={c.label}
                  flag={(c.grow ? wxEXPAND : 0) | wxBOTTOM | wxRIGHT}
                  border={5}
                >
                  <CheckBox label={c.label} title={c.title} check={c} />
                </SizerItem>
              ))}
            </BoxSizer>
          </SizerItem>
        </BoxSizer>
      </SizerItem>
    </BoxSizer>
  );
}

export function DIALOG_EXPORT_NETLIST_BASE(p: DIALOG_EXPORT_NETLIST_BASE_PROPS): JSX.Element {
  return (
    <DialogShim title={_('Export Netlist')} onClose={p.onCancel}>
      {/* bMainSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem proportion={1} flag={wxEXPAND | wxRIGHT | wxLEFT} border={5}>
          {/* bUpperSizer */}
          <BoxSizer orient={wxVERTICAL}>
            <SizerItem proportion={1} flag={wxEXPAND} border={5}>
              {/* bSizer8 */}
              <BoxSizer orient={wxHORIZONTAL}>
                <SizerItem flag={wxALL | wxALIGN_CENTER_VERTICAL} border={5}>
                  <StaticText label={_('Output path:')} />
                </SizerItem>
                <SizerItem proportion={1} flag={wxALL} border={5} minSize={[450, -1]}>
                  <TextCtrl
                    value={p.m_outputPath}
                    onChange={p.onOutputPath}
                    hint="(project folder)"
                    ariaLabel={_('Output path')}
                  />
                </SizerItem>
              </BoxSizer>
            </SizerItem>
            <SizerItem flag={wxEXPAND | wxALL} border={5} minSize={[540, -1]}>
              {/* m_NoteBook */}
              <Notebook
                selection={p.selection}
                onPageChanged={p.onPageChanged}
                pages={p.pages.map((page) => ({
                  text: page.title,
                  content: <NetlistPage page={page} />,
                }))}
              />
            </SizerItem>
            <SizerItem proportion={1} flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={5}>
              {/* bSizerMsgPanel */}
              <BoxSizer orient={wxVERTICAL}>
                <SizerItem proportion={1} flag={wxEXPAND | wxTOP} border={5}>
                  <HtmlReportPanel
                    lines={p.m_MessagesBox.lines}
                    fileName={p.m_MessagesBox.fileName}
                    visibleSeverities={p.m_MessagesBox.visibleSeverities}
                    onVisibleSeveritiesChange={p.m_MessagesBox.onVisibleSeveritiesChange}
                    minHeight={0}
                  />
                </SizerItem>
              </BoxSizer>
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxBOTTOM | wxEXPAND | wxLEFT | wxTOP} border={5}>
          {/* m_buttonSizer: SetupStandardButtons relabels OK and Cancel */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem proportion={1} flag={wxEXPAND} border={5}>
              <StdDialogButtonSizer
                okLabel={_('Export Netlist')}
                cancelLabel={_('Close')}
                onOk={p.onOK}
                onCancel={p.onCancel}
              />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
