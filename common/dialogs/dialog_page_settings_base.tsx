// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_PAGES_SETTINGS_BASE` (common/dialogs/dialog_page_settings_base.cpp): the sizer tree, Add()
 * for Add() - bleftSizer (Paper: size, orientation, the custom size pair, Export to other sheets,
 * the Preview), the 15 px gutter, bSizerRight (Drawing Sheet file, Title Block: the sheet tallies
 * and fgSizer2's thirteen rows), and the standard pair. DIALOG_PAGES_SETTINGS (and eeschema's
 * subclass) decide what is shown and enabled; those flags arrive as props.
 */
import type { JSX, ReactNode } from 'react';
import { DialogShim } from '../dialog_shim.js';
import { StdBitmapButton } from '../widgets/std_bitmap_button.js';
import { UnitField } from '../widgets/unit_binder_ui.js';
import { Combo } from '@ziroeda/wx/combobox.js';
import {
  Button,
  type CHECK,
  CheckBox,
  Panel,
  StaticLine,
  StaticText,
  TextCtrl,
} from '@ziroeda/wx/controls.js';
import { DatePickerCtrl } from '@ziroeda/wx/datectrl.js';
import {
  wxALIGN_CENTER_HORIZONTAL,
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
  SizerItem,
  Spacer,
  StdDialogButtonSizer,
} from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

type UNIT_FIELD = Parameters<typeof UnitField>[0];

/** One of fgSizer2's thirteen rows past the date: label, entry and its export checkbox. */
export interface TITLE_BLOCK_ROW {
  label: string;
  value: string;
  onChange: (aText: string) => void;
  /** `SetMinSize( wxSize( 100,-1 ) )` for Revision, 360 for the rest. */
  minWidth: number;
  /** The label's border: Title: is added with 4, the rest with 5. */
  labelBorder: number;
  exportCheck: CHECK;
}

export interface DIALOG_PAGES_SETTINGS_BASE_PROPS {
  title: string;
  /** m_staticTextPaper: "Paper", or pl_editor's "Preview Paper". */
  paperLabel: string;
  paperChoices: readonly { value: string; label: string }[];
  m_paperSizeComboBox: string;
  onPaperSize: (aPaper: string) => void;
  orientationEnabled: boolean;
  /** m_orientationComboBox: 'landscape' or 'portrait'. */
  m_orientationComboBox: string;
  onOrientation: (aValue: string) => void;
  customSizeEnabled: boolean;
  m_userSizeYCtrl: UNIT_FIELD;
  m_userSizeXCtrl: UNIT_FIELD;
  /** The thirteen "Export to other sheets" boxes: Show( false ) unless eeschema. */
  exportsShown: boolean;
  m_PaperExport: CHECK;
  /** m_PageLayoutExampleBitmap's content: the drawn example. */
  preview: ReactNode;
  wksPickerEnabled: boolean;
  m_textCtrlFilePicker: string;
  onFilePicker: (aText: string) => void;
  onBrowse: () => void;
  /** m_staticTextTitleBlock: "Title Block", or pl_editor's "Preview Title Block Data". */
  titleBlockLabel: string;
  /** m_TextSheetCount / m_TextSheetNumber: Show( false ) unless eeschema. */
  talliesShown: boolean;
  sheetCount: number;
  sheetNumber: number;
  m_TextDate: string;
  onDate: (aText: string) => void;
  /** `<<<`: OnDateApplyClick copies the picker's date into m_TextDate. */
  onApplyDate: () => void;
  m_PickDate: string;
  onPickDate: (aIsoDate: string) => void;
  m_DateExport: CHECK;
  /** Revision, Title, Company and Comment1..9, in fgSizer2's order. */
  rows: readonly TITLE_BLOCK_ROW[];
  onOK: () => void;
  onCancel: () => void;
}

/** A centred section heading and its wxLI_HORIZONTAL rule: four of them in this dialog. */
function Heading({ label }: { label: string }): JSX.Element {
  return (
    <>
      <SizerItem flag={wxALIGN_CENTER_HORIZONTAL | wxTOP | wxRIGHT | wxLEFT} border={5}>
        <StaticText label={label} />
      </SizerItem>
      <SizerItem flag={wxEXPAND | wxTOP} border={1}>
        <StaticLine />
      </SizerItem>
    </>
  );
}

export function DIALOG_PAGES_SETTINGS_BASE(p: DIALOG_PAGES_SETTINGS_BASE_PROPS): JSX.Element {
  const exportBox = (c: CHECK, aFlag: number) => (
    <SizerItem flag={aFlag} border={5} shown={p.exportsShown}>
      <CheckBox label={_('Export to other sheets')} check={c} />
    </SizerItem>
  );

  return (
    <DialogShim title={p.title} onClose={p.onCancel}>
      {/* bMainSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem proportion={1} flag={wxEXPAND | wxRIGHT | wxLEFT} border={5}>
          {/* bUpperSizerH */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
              {/* bleftSizer */}
              <BoxSizer orient={wxVERTICAL}>
                <Heading label={p.paperLabel} />
                <Spacer width={0} height={10} flag={wxEXPAND} border={5} />
                <SizerItem flag={wxTOP | wxRIGHT | wxLEFT} border={5}>
                  <StaticText label={_('Size:')} />
                </SizerItem>
                <SizerItem flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
                  {/* m_paperSizeComboBox: wxChoice */}
                  <Combo
                    ariaLabel="Size"
                    value={p.m_paperSizeComboBox}
                    options={p.paperChoices}
                    onChange={p.onPaperSize}
                    autoFocus
                  />
                </SizerItem>
                <Spacer width={0} height={3} flag={wxEXPAND} border={5} />
                <SizerItem flag={wxRIGHT | wxLEFT} border={5}>
                  <StaticText label={_('Orientation:')} disabled={!p.orientationEnabled} />
                </SizerItem>
                <SizerItem flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
                  <Combo
                    ariaLabel="Orientation"
                    value={p.m_orientationComboBox}
                    options={[
                      { value: 'landscape', label: _('Landscape') },
                      { value: 'portrait', label: _('Portrait') },
                    ]}
                    onChange={p.onOrientation}
                    disabled={!p.orientationEnabled}
                  />
                </SizerItem>
                <SizerItem flag={wxTOP | wxRIGHT | wxLEFT} border={5}>
                  <StaticText label={_('Custom paper size:')} disabled={!p.customSizeEnabled} />
                </SizerItem>
                <Spacer width={0} height={2} flag={wxEXPAND} border={5} />
                <SizerItem flag={wxEXPAND | wxBOTTOM} border={5}>
                  {/* fgSizer1 = wxFlexGridSizer( 0, 3, 3, 0 ). UnitField draws the entry and its
                      unit static text together, so the units column's cell is empty. */}
                  <FlexGridSizer cols={3} vgap={3} hgap={0}>
                    <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
                      <StaticText label={_('Height:')} disabled={!p.customSizeEnabled} />
                    </SizerItem>
                    <SizerItem flag={wxEXPAND | wxRIGHT | wxLEFT} border={5}>
                      <UnitField {...p.m_userSizeYCtrl} />
                    </SizerItem>
                    <Spacer width={0} height={0} border={5} />
                    <SizerItem
                      flag={wxALIGN_CENTER_VERTICAL | wxBOTTOM | wxRIGHT | wxLEFT}
                      border={5}
                    >
                      <StaticText label={_('Width:')} disabled={!p.customSizeEnabled} />
                    </SizerItem>
                    <SizerItem flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
                      <UnitField {...p.m_userSizeXCtrl} />
                    </SizerItem>
                    <Spacer width={0} height={0} border={5} />
                  </FlexGridSizer>
                </SizerItem>
                <SizerItem flag={wxALL} border={4} shown={p.exportsShown}>
                  <CheckBox label={_('Export to other sheets')} check={p.m_PaperExport} />
                </SizerItem>
                <Spacer width={0} height={20} flag={wxEXPAND} border={5} />
                <Heading label={_('Preview')} />
                <Spacer width={0} height={12} flag={wxEXPAND} border={5} />
                <SizerItem proportion={1} flag={wxALL | wxEXPAND} border={5}>
                  {/* m_PageLayoutExampleBitmap: wxBORDER_SIMPLE on wxSYS_COLOUR_WINDOW */}
                  <Panel border="simple">{p.preview}</Panel>
                </SizerItem>
              </BoxSizer>
            </SizerItem>
            <Spacer width={15} height={0} flag={wxEXPAND} border={5} />
            <SizerItem proportion={1} flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
              {/* bSizerRight */}
              <BoxSizer orient={wxVERTICAL}>
                <Heading label={_('Drawing Sheet')} />
                <Spacer width={0} height={10} flag={wxEXPAND} border={5} />
                <SizerItem flag={wxEXPAND | wxALL} border={5}>
                  {/* bSizerFilename */}
                  <BoxSizer orient={wxVERTICAL}>
                    <SizerItem proportion={1} flag={wxBOTTOM | wxEXPAND} border={5}>
                      {/* bSizerfileSelection */}
                      <BoxSizer orient={wxHORIZONTAL}>
                        <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT | wxTOP} border={5}>
                          <StaticText label={_('File:')} disabled={!p.wksPickerEnabled} />
                        </SizerItem>
                        <SizerItem
                          proportion={1}
                          flag={wxALIGN_CENTER_VERTICAL | wxLEFT | wxTOP}
                          border={5}
                        >
                          <TextCtrl
                            value={p.m_textCtrlFilePicker}
                            onChange={p.onFilePicker}
                            disabled={!p.wksPickerEnabled}
                            title={p.m_textCtrlFilePicker}
                            ariaLabel="Drawing sheet file"
                          />
                        </SizerItem>
                        <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxTOP} border={5}>
                          <StdBitmapButton
                            bitmap="small_folder"
                            title={_('Drawing Sheet File')}
                            tooltip={null}
                            disabled={!p.wksPickerEnabled}
                            onClick={p.onBrowse}
                          />
                        </SizerItem>
                      </BoxSizer>
                    </SizerItem>
                  </BoxSizer>
                </SizerItem>
                <Spacer width={0} height={10} flag={wxEXPAND} border={5} />
                <Heading label={p.titleBlockLabel} />
                <Spacer width={0} height={10} flag={wxEXPAND} border={5} />
                <SizerItem flag={wxLEFT} border={5}>
                  {/* SheetInfoSizer */}
                  <BoxSizer orient={wxHORIZONTAL}>
                    <SizerItem flag={wxALL} border={5} shown={p.talliesShown}>
                      <StaticText label={`Number of sheets: ${p.sheetCount}`} />
                    </SizerItem>
                    <Spacer width={5} height={5} proportion={1} flag={wxEXPAND} border={5} />
                    <SizerItem flag={wxALL} border={5} shown={p.talliesShown}>
                      <StaticText label={`Sheet number: ${p.sheetNumber}`} />
                    </SizerItem>
                  </BoxSizer>
                </SizerItem>
                <SizerItem flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={5}>
                  {/* fgSizer2 = wxFlexGridSizer( 0, 3, 0, 0 ), AddGrowableCol( 1 ) */}
                  <FlexGridSizer cols={3} vgap={0} hgap={0} growableCols={[1]}>
                    <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
                      <StaticText label={_('Issue Date:')} />
                    </SizerItem>
                    <SizerItem flag={wxBOTTOM | wxEXPAND | wxTOP} border={5}>
                      {/* bSizerDate */}
                      <BoxSizer orient={wxHORIZONTAL}>
                        <SizerItem
                          proportion={3}
                          flag={wxALIGN_CENTER_VERTICAL | wxLEFT}
                          border={5}
                          minSize={[100, -1]}
                        >
                          <TextCtrl
                            value={p.m_TextDate}
                            onChange={p.onDate}
                            ariaLabel="Issue Date"
                          />
                        </SizerItem>
                        <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={5}>
                          {/* m_ApplyDate, wxBU_EXACTFIT */}
                          <Button label="<<<" exactFit onClick={p.onApplyDate} />
                        </SizerItem>
                        <SizerItem
                          proportion={2}
                          flag={wxALIGN_CENTER_VERTICAL | wxLEFT | wxRIGHT}
                          border={5}
                        >
                          <DatePickerCtrl
                            value={p.m_PickDate}
                            onChange={p.onPickDate}
                            ariaLabel="Pick date"
                          />
                        </SizerItem>
                      </BoxSizer>
                    </SizerItem>
                    {exportBox(p.m_DateExport, wxALIGN_CENTER_VERTICAL | wxALL)}
                    {p.rows.map((r, i) => [
                      <SizerItem
                        key={`l${r.label}`}
                        flag={wxALIGN_CENTER_VERTICAL | wxBOTTOM | wxRIGHT | wxLEFT}
                        border={r.labelBorder}
                      >
                        <StaticText label={r.label} />
                      </SizerItem>,
                      <SizerItem
                        key={`e${r.label}`}
                        // m_TextRevision is added at proportion 1; the rest at 0.
                        proportion={i === 0 ? 1 : 0}
                        flag={wxALIGN_CENTER_VERTICAL | wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT}
                        border={5}
                        minSize={[r.minWidth, -1]}
                      >
                        <TextCtrl
                          value={r.value}
                          onChange={r.onChange}
                          ariaLabel={r.label.replace(/:$/, '')}
                        />
                      </SizerItem>,
                      <SizerItem
                        key={`x${r.label}`}
                        flag={wxALIGN_CENTER_VERTICAL | wxBOTTOM | wxLEFT | wxRIGHT}
                        border={5}
                        shown={p.exportsShown}
                      >
                        <CheckBox label={_('Export to other sheets')} check={r.exportCheck} />
                      </SizerItem>,
                    ])}
                  </FlexGridSizer>
                </SizerItem>
              </BoxSizer>
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxALL | wxEXPAND} border={5}>
          {/* m_sdbSizer: OK, Cancel */}
          <StdDialogButtonSizer onOk={p.onOK} onCancel={p.onCancel} />
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
