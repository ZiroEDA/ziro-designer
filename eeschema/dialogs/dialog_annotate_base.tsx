// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_ANNOTATE_BASE` (eeschema/dialogs/dialog_annotate_base.cpp): the sizer tree, Add() for
 * Add() - the info bar, Scope | Order over Options | Numbering, the message panel, and Clear
 * Annotation beside the standard pair. The behaviour is DIALOG_ANNOTATE's (dialog_annotate.tsx).
 */
import type { JSX } from 'react';
import { bitmapUrl } from '@ziroeda/common/bitmap_store.js';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import type { ReportLine, Severity } from '@ziroeda/common/reporter.js';
import { HtmlReportPanel } from '@ziroeda/common/widgets/wx_html_report_panel.js';
import { Infobar } from '@ziroeda/common/widgets/wx_infobar.js';
import { Button, type CHECK, CheckBox, RadioButton, TextCtrl } from '@ziroeda/wx/controls.js';
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
  StaticBoxSizer,
  StdDialogButtonSizer,
  StretchSpacer,
} from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

/** A radio group: which button is set, and which (if any) is disabled. */
export interface RADIO_GROUP {
  value: number;
  onChange: (aIndex: number) => void;
  disabled?: readonly boolean[];
}

export interface DIALOG_ANNOTATE_BASE_PROPS {
  m_infoBar: string | null;
  /** m_rbScope_Schematic, m_rbScope_Sheet, m_rbScope_Selection. */
  scope: RADIO_GROUP;
  m_checkRecursive: CHECK;
  /** m_rbSortBy_X_Position, m_rbSortBy_Y_Position. */
  order: RADIO_GROUP;
  /** m_rbKeep_Annotations, m_rbReset_Annotations. */
  keepReset: RADIO_GROUP;
  m_checkRegroupUnits: CHECK;
  /** m_rbFirstFree, m_rbSheetX100, m_rbSheetX1000. */
  numbering: RADIO_GROUP;
  m_textNumberAfter: string;
  onNumberAfter: (aText: string) => void;
  m_MessageWindow: {
    label: string;
    fileName: string;
    lines: readonly ReportLine[];
    visibleSeverities: Severity;
    onVisibleSeveritiesChange: (aMask: Severity) => void;
    /** `MsgPanelSetMinSize( wxSize( -1, h ) )`. */
    minHeight: number;
  };
  onClearAnnotationClick: () => void;
  /** wxID_OK, relabelled "Annotate". */
  onAnnotateClick: () => void;
  /** wxID_CANCEL, relabelled "Close". */
  onCancel: () => void;
}

function Radio({
  g,
  i,
  name,
  label,
}: {
  g: RADIO_GROUP;
  i: number;
  name: string;
  label: string;
}): JSX.Element {
  return (
    <RadioButton
      label={label}
      name={name}
      checked={g.value === i}
      disabled={g.disabled?.[i] ?? false}
      onChange={() => g.onChange(i)}
    />
  );
}

function OrderBitmap({ name }: { name: string }): JSX.Element | null {
  const url = bitmapUrl(name);
  return url ? <img src={url} alt="" /> : null;
}

export function DIALOG_ANNOTATE_BASE(p: DIALOG_ANNOTATE_BASE_PROPS): JSX.Element {
  return (
    <DialogShim title={_('Annotate Schematic')} onClose={p.onCancel}>
      {/* bmainSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem flag={wxEXPAND | wxBOTTOM} border={5} shown={p.m_infoBar !== null}>
          <Infobar message={p.m_infoBar ?? ''} />
        </SizerItem>
        <SizerItem proportion={1} flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={6}>
          {/* bupperSizer */}
          <BoxSizer orient={wxVERTICAL}>
            <SizerItem flag={wxBOTTOM | wxEXPAND} border={5}>
              {/* fgSizer1 = wxFlexGridSizer( 2, 2, 0, 0 ), AddGrowableCol( 0 ), ( 1 ) */}
              <FlexGridSizer cols={2} vgap={0} hgap={0} growableCols={[0, 1]}>
                <SizerItem proportion={1} flag={wxALL | wxEXPAND} border={5}>
                  <StaticBoxSizer label={_('Scope')} orient={wxVERTICAL}>
                    <SizerItem flag={wxLEFT | wxRIGHT} border={5}>
                      <Radio
                        g={p.scope}
                        i={0}
                        name="annotate-scope"
                        label={_('Entire schematic')}
                      />
                    </SizerItem>
                    <SizerItem flag={wxLEFT | wxRIGHT} border={5}>
                      <Radio
                        g={p.scope}
                        i={1}
                        name="annotate-scope"
                        label={_('Current sheet only')}
                      />
                    </SizerItem>
                    <SizerItem flag={wxLEFT | wxRIGHT | wxBOTTOM} border={5}>
                      <Radio g={p.scope} i={2} name="annotate-scope" label={_('Selection')} />
                    </SizerItem>
                    <SizerItem flag={wxALL} border={5}>
                      <CheckBox label={_('Recurse into subsheets')} check={p.m_checkRecursive} />
                    </SizerItem>
                  </StaticBoxSizer>
                </SizerItem>
                <SizerItem flag={wxALL | wxEXPAND} border={5}>
                  <StaticBoxSizer label={_('Order')} orient={wxVERTICAL}>
                    <SizerItem flag={wxBOTTOM | wxEXPAND} border={5}>
                      {/* bSizerXpos */}
                      <BoxSizer orient={wxHORIZONTAL}>
                        <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxALL} border={3}>
                          <Radio
                            g={p.order}
                            i={0}
                            name="annotate-order"
                            label={_('Sort symbols by X position')}
                          />
                        </SizerItem>
                        <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT | wxRIGHT} border={5}>
                          <OrderBitmap name="annotate_down_right" />
                        </SizerItem>
                      </BoxSizer>
                    </SizerItem>
                    <SizerItem flag={wxEXPAND} border={5}>
                      {/* bSizerYpos */}
                      <BoxSizer orient={wxHORIZONTAL}>
                        <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxALL} border={3}>
                          <Radio
                            g={p.order}
                            i={1}
                            name="annotate-order"
                            label={_('Sort symbols by Y position')}
                          />
                        </SizerItem>
                        <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT | wxRIGHT} border={5}>
                          <OrderBitmap name="annotate_right_down" />
                        </SizerItem>
                      </BoxSizer>
                    </SizerItem>
                  </StaticBoxSizer>
                </SizerItem>
                <SizerItem flag={wxALL | wxEXPAND} border={5}>
                  <StaticBoxSizer label={_('Options')} orient={wxVERTICAL}>
                    <SizerItem flag={wxLEFT | wxRIGHT} border={5}>
                      <Radio
                        g={p.keepReset}
                        i={0}
                        name="annotate-reset"
                        label={_('Keep existing annotations')}
                      />
                    </SizerItem>
                    <SizerItem flag={wxLEFT | wxRIGHT} border={5}>
                      <Radio
                        g={p.keepReset}
                        i={1}
                        name="annotate-reset"
                        label={_('Reset existing annotations')}
                      />
                    </SizerItem>
                    <SizerItem flag={wxALL | wxEXPAND} border={5}>
                      <CheckBox label={_('Regroup symbol units')} check={p.m_checkRegroupUnits} />
                    </SizerItem>
                  </StaticBoxSizer>
                </SizerItem>
                <SizerItem proportion={1} flag={wxALL | wxEXPAND} border={5}>
                  <StaticBoxSizer label={_('Numbering')} orient={wxVERTICAL}>
                    <SizerItem proportion={1} flag={wxEXPAND} border={5}>
                      {/* gbSizer1 = wxGridBagSizer( 0, 0 ) */}
                      <GridBagSizer vgap={0} hgap={0}>
                        <SizerItem
                          pos={[0, 0]}
                          span={[1, 1]}
                          flag={wxALIGN_CENTER_VERTICAL}
                          border={2}
                        >
                          <Radio
                            g={p.numbering}
                            i={0}
                            name="annotate-numbering"
                            label={_('Use first free number after:')}
                          />
                        </SizerItem>
                        <SizerItem
                          pos={[0, 1]}
                          span={[1, 1]}
                          flag={wxLEFT | wxRIGHT}
                          border={2}
                          minSize={[60, -1]}
                        >
                          {/* m_textNumberAfter, wxSize( 60,-1 ) */}
                          <TextCtrl
                            value={p.m_textNumberAfter}
                            onChange={p.onNumberAfter}
                            ariaLabel="First free number after"
                          />
                        </SizerItem>
                        <SizerItem pos={[1, 0]} span={[1, 2]} flag={wxBOTTOM | wxTOP} border={2}>
                          <Radio
                            g={p.numbering}
                            i={1}
                            name="annotate-numbering"
                            label={_('First free after sheet number X 100')}
                          />
                        </SizerItem>
                        <SizerItem pos={[2, 0]} span={[1, 2]} flag={wxBOTTOM | wxTOP} border={2}>
                          <Radio
                            g={p.numbering}
                            i={2}
                            name="annotate-numbering"
                            label={_('First free after sheet number X 1000')}
                          />
                        </SizerItem>
                      </GridBagSizer>
                    </SizerItem>
                  </StaticBoxSizer>
                </SizerItem>
              </FlexGridSizer>
            </SizerItem>
            <SizerItem
              proportion={5}
              flag={wxEXPAND | wxRIGHT | wxLEFT}
              border={5}
              minSize={[-1, 120]}
            >
              {/* m_MessageWindow, SetMinSize( wxSize( -1,120 ) ) */}
              <HtmlReportPanel
                label={p.m_MessageWindow.label}
                lines={p.m_MessageWindow.lines}
                fileName={p.m_MessageWindow.fileName}
                visibleSeverities={p.m_MessageWindow.visibleSeverities}
                onVisibleSeveritiesChange={p.m_MessageWindow.onVisibleSeveritiesChange}
                minHeight={p.m_MessageWindow.minHeight}
                sorted
              />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxLEFT} border={5}>
          {/* m_buttonsSizer */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem flag={wxEXPAND | wxALL} border={10}>
              <Button label={_('Clear Annotation')} onClick={p.onClearAnnotationClick} />
            </SizerItem>
            <StretchSpacer />
            <SizerItem flag={wxALL | wxEXPAND} border={5}>
              <StdDialogButtonSizer
                okLabel={_('Annotate')}
                cancelLabel={_('Close')}
                onOk={p.onAnnotateClick}
                onCancel={p.onCancel}
              />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
