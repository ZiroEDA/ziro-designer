// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_LIB_EDIT_PIN_TABLE_BASE` (eeschema/dialogs/dialog_lib_edit_pin_table_base.cpp): the sizer
 * tree, Add() for Add() - the summary line and the pin grid on the left; grouping, refresh and
 * the menu button, the three filters, Export and Import on the right; add / delete and the
 * standard pair below. The behaviour is DIALOG_LIB_EDIT_PIN_TABLE's (dialog_lib_edit_pin_table.tsx).
 */
import type { JSX, ReactNode } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { StdBitmapButton } from '@ziroeda/common/widgets/std_bitmap_button.js';
import {
  Button,
  type CHECK,
  CheckBox,
  type CHOICE,
  Choice,
  RadioButton,
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
import {
  BoxSizer,
  GridBagSizer,
  SizerItem,
  Spacer,
  StaticBoxSizer,
  StdDialogButtonSizer,
  StretchSpacer,
} from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

/**
 * [data] `summaryW = GetCharWidth() * 30`, the min and max width the derived constructor gives the
 * two wxST_ELLIPSIZE_END summaries. GetCharWidth() is 8 at Ubuntu Sans 11, asked of a real
 * wxPanel by qa/probes/swatch_probe.cpp (the --swatch-* tokens in shell.css derive from the same).
 */
const SUMMARY_SIZE = [8 * 30, -1] as const;

export interface DIALOG_LIB_EDIT_PIN_TABLE_BASE_PROPS {
  /** updateSummary(): the three summary values. */
  m_pin_numbers_summary: string;
  m_pin_count: string;
  m_duplicate_pins: string;

  /** m_grid, at its SetMinSize( 690, 200 ). */
  m_grid: ReactNode;

  m_cbGroup: CHECK;
  /** m_groupSelected's Enable() (OnUpdateUI). */
  groupSelectedEnabled: boolean;
  onGroupSelected: () => void;
  onRebuildRows: () => void;
  onMenu: () => void;

  m_cbFilterByUnit: CHECK;
  unitFilterChoices: readonly string[];
  m_unitFilter: CHOICE;
  m_cbFilterByBodyStyle: CHECK;
  bodyStyleFilterChoices: readonly string[];
  m_bodyStyleFilter: CHOICE;
  m_cbFilterSelected: CHECK;

  /** m_rbExportAllPins (true) or m_rbExportOnlyShownPins. */
  exportAllPins: boolean;
  onExportAllPins: (aAll: boolean) => void;
  onExportToFile: () => void;
  onExportToClipboard: () => void;

  /** m_rbReplaceAll (true) or m_radioBtn1, "Append to existing pins". */
  replaceAll: boolean;
  onReplaceAll: (aReplace: boolean) => void;
  onImportFromFile: () => void;
  onImportFromClipboard: () => void;

  onAddRow: () => void;
  onDeleteRow: () => void;

  /** "Read Only": OK relabelled and disabled (the symbol is not editable, or is derived). */
  readOnly: boolean;
  onOK: () => void;
  onCancel: () => void;
}

export function DIALOG_LIB_EDIT_PIN_TABLE_BASE(
  p: DIALOG_LIB_EDIT_PIN_TABLE_BASE_PROPS,
): JSX.Element {
  return (
    <DialogShim title={_('Pin Table')} onClose={p.onCancel}>
      {/* top_sizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem proportion={1} flag={wxEXPAND} border={5}>
          {/* bSizer6 */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem proportion={1} flag={wxEXPAND} border={5}>
              {/* bLeftGridSizer */}
              <BoxSizer orient={wxVERTICAL}>
                <SizerItem flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={10}>
                  {/* bSummarySizer */}
                  <BoxSizer orient={wxHORIZONTAL}>
                    <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={5}>
                      <StaticText label={_('Pin numbers:')} />
                    </SizerItem>
                    <SizerItem
                      flag={wxRIGHT | wxLEFT | wxALIGN_CENTER_VERTICAL}
                      border={5}
                      minSize={SUMMARY_SIZE}
                      maxSize={SUMMARY_SIZE}
                    >
                      <StaticText
                        label={p.m_pin_numbers_summary}
                        title={p.m_pin_numbers_summary}
                        ellipsize
                      />
                    </SizerItem>
                    <StretchSpacer />
                    <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={10}>
                      <StaticText label={_('Pin count:')} />
                    </SizerItem>
                    <SizerItem flag={wxRIGHT | wxLEFT | wxALIGN_CENTER_VERTICAL} border={5}>
                      <StaticText label={p.m_pin_count} />
                    </SizerItem>
                    <StretchSpacer />
                    <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={10}>
                      <StaticText label={_('Duplicate pins:')} />
                    </SizerItem>
                    <SizerItem
                      flag={wxRIGHT | wxLEFT | wxALIGN_CENTER_VERTICAL}
                      border={5}
                      minSize={SUMMARY_SIZE}
                      maxSize={SUMMARY_SIZE}
                    >
                      <StaticText label={p.m_duplicate_pins} title={p.m_duplicate_pins} ellipsize />
                    </SizerItem>
                  </BoxSizer>
                </SizerItem>
                <SizerItem proportion={1} flag={wxEXPAND | wxLEFT} border={5}>
                  {/* bGridMarginsSizer */}
                  <BoxSizer orient={wxVERTICAL}>
                    <SizerItem
                      proportion={1}
                      flag={wxEXPAND | wxLEFT | wxRIGHT | wxTOP}
                      border={10}
                      minSize={[690, 200]}
                    >
                      {/* [data] m_grid->SetMinSize( wxSize( 690,200 ) ) */}
                      {p.m_grid}
                    </SizerItem>
                  </BoxSizer>
                </SizerItem>
              </BoxSizer>
            </SizerItem>
            <SizerItem flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={5}>
              {/* bRightPaneSizer */}
              <BoxSizer orient={wxVERTICAL}>
                <SizerItem proportion={1} flag={wxEXPAND | wxBOTTOM | wxLEFT} border={5}>
                  {/* bSizerCols */}
                  <BoxSizer orient={wxHORIZONTAL}>
                    <SizerItem flag={wxEXPAND} border={5}>
                      {/* bSizerLeftCol */}
                      <BoxSizer orient={wxVERTICAL}>
                        <SizerItem flag={wxALL} border={5}>
                          <CheckBox label={_('Group by name')} check={p.m_cbGroup} />
                        </SizerItem>
                        <SizerItem flag={wxALL} border={5}>
                          <Button
                            label={_('Group Selected Pins')}
                            disabled={!p.groupSelectedEnabled}
                            onClick={p.onGroupSelected}
                          />
                        </SizerItem>
                      </BoxSizer>
                    </SizerItem>
                    <StretchSpacer />
                    <SizerItem flag={wxEXPAND} border={5}>
                      {/* bSizerRightCol */}
                      <BoxSizer orient={wxHORIZONTAL}>
                        <SizerItem border={5}>
                          <StdBitmapButton
                            bitmap="small_refresh"
                            title=""
                            onClick={p.onRebuildRows}
                          />
                        </SizerItem>
                        <SizerItem flag={wxLEFT} border={5}>
                          <StdBitmapButton bitmap="config" title="" onClick={p.onMenu} />
                        </SizerItem>
                      </BoxSizer>
                    </SizerItem>
                  </BoxSizer>
                </SizerItem>
                <SizerItem flag={wxEXPAND | wxALL} border={5}>
                  {/* gbSizer1 = wxGridBagSizer( 5, 0 ), AddGrowableCol( 1 ) */}
                  <GridBagSizer vgap={5} hgap={0} growableCols={[1]}>
                    <SizerItem
                      pos={[0, 0]}
                      span={[1, 1]}
                      flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT}
                      border={5}
                    >
                      <CheckBox label={_('Filter by unit:')} check={p.m_cbFilterByUnit} />
                    </SizerItem>
                    <SizerItem pos={[0, 1]} span={[1, 1]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
                      <Choice
                        ariaLabel="Unit filter"
                        choices={p.unitFilterChoices}
                        choice={p.m_unitFilter}
                      />
                    </SizerItem>
                    <SizerItem
                      pos={[1, 0]}
                      span={[1, 1]}
                      flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT}
                      border={5}
                    >
                      <CheckBox
                        label={_('Filter by body style:')}
                        check={p.m_cbFilterByBodyStyle}
                      />
                    </SizerItem>
                    <SizerItem pos={[1, 1]} span={[1, 1]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
                      <Choice
                        ariaLabel="Body style filter"
                        choices={p.bodyStyleFilterChoices}
                        choice={p.m_bodyStyleFilter}
                      />
                    </SizerItem>
                    <SizerItem
                      pos={[2, 0]}
                      span={[1, 2]}
                      flag={wxRIGHT | wxLEFT | wxALIGN_CENTER_VERTICAL}
                      border={5}
                    >
                      <CheckBox label={_('Filter by selection')} check={p.m_cbFilterSelected} />
                    </SizerItem>
                  </GridBagSizer>
                </SizerItem>
                <Spacer width={0} height={35} proportion={1} flag={wxEXPAND} border={5} />
                <SizerItem flag={wxEXPAND | wxALL} border={5}>
                  <StaticBoxSizer label={_('Export')} orient={wxVERTICAL}>
                    <SizerItem proportion={1} flag={wxEXPAND} border={5}>
                      {/* bExportSizer */}
                      <BoxSizer orient={wxVERTICAL}>
                        <SizerItem flag={wxBOTTOM | wxLEFT} border={5}>
                          <RadioButton
                            name="pinTableExport"
                            label={_('Export all pins')}
                            checked={p.exportAllPins}
                            onChange={() => p.onExportAllPins(true)}
                          />
                        </SizerItem>
                        <SizerItem flag={wxBOTTOM | wxLEFT} border={5}>
                          <RadioButton
                            name="pinTableExport"
                            label={_('Export only shown pins')}
                            checked={!p.exportAllPins}
                            onChange={() => p.onExportAllPins(false)}
                          />
                        </SizerItem>
                        <SizerItem flag={wxEXPAND} border={5}>
                          {/* bExportBtnSizer */}
                          <BoxSizer orient={wxHORIZONTAL}>
                            <SizerItem proportion={1} flag={wxALL} border={5}>
                              <Button label={_('To File...')} onClick={p.onExportToFile} />
                            </SizerItem>
                            <Spacer width={5} height={0} flag={wxEXPAND} border={5} />
                            <SizerItem proportion={1} flag={wxALL} border={5}>
                              <Button label={_('To Clipboard')} onClick={p.onExportToClipboard} />
                            </SizerItem>
                          </BoxSizer>
                        </SizerItem>
                      </BoxSizer>
                    </SizerItem>
                  </StaticBoxSizer>
                </SizerItem>
                <SizerItem flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={5}>
                  <StaticBoxSizer label={_('Import')} orient={wxVERTICAL}>
                    <SizerItem proportion={1} flag={wxEXPAND} border={5}>
                      {/* bImportSizer */}
                      <BoxSizer orient={wxVERTICAL}>
                        <SizerItem flag={wxBOTTOM | wxLEFT} border={5}>
                          <RadioButton
                            name="pinTableImport"
                            label={_('Replace all existing pins')}
                            checked={p.replaceAll}
                            onChange={() => p.onReplaceAll(true)}
                          />
                        </SizerItem>
                        <SizerItem flag={wxBOTTOM | wxLEFT} border={5}>
                          <RadioButton
                            name="pinTableImport"
                            label={_('Append to existing pins')}
                            checked={!p.replaceAll}
                            onChange={() => p.onReplaceAll(false)}
                          />
                        </SizerItem>
                      </BoxSizer>
                    </SizerItem>
                    <SizerItem flag={wxBOTTOM | wxEXPAND} border={5}>
                      {/* bImportBtnSizer */}
                      <BoxSizer orient={wxHORIZONTAL}>
                        <SizerItem proportion={1} flag={wxTOP | wxRIGHT | wxLEFT} border={5}>
                          <Button label={_('From File...')} onClick={p.onImportFromFile} />
                        </SizerItem>
                        <Spacer width={5} height={0} flag={wxEXPAND} border={5} />
                        <SizerItem proportion={1} flag={wxTOP | wxRIGHT | wxLEFT} border={5}>
                          <Button label={_('From Clipboard')} onClick={p.onImportFromClipboard} />
                        </SizerItem>
                      </BoxSizer>
                    </SizerItem>
                  </StaticBoxSizer>
                </SizerItem>
              </BoxSizer>
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxLEFT | wxEXPAND} border={10}>
          {/* bBottomSizer */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem flag={wxEXPAND | wxTOP | wxRIGHT} border={5}>
              {/* bSizer5 */}
              <BoxSizer orient={wxHORIZONTAL}>
                <SizerItem flag={wxRIGHT | wxLEFT} border={5}>
                  <StdBitmapButton bitmap="small_plus" title="" onClick={p.onAddRow} />
                </SizerItem>
                <SizerItem flag={wxRIGHT | wxLEFT} border={15}>
                  <StdBitmapButton bitmap="small_trash" title="" onClick={p.onDeleteRow} />
                </SizerItem>
              </BoxSizer>
            </SizerItem>
            <Spacer width={30} height={0} proportion={1} flag={wxEXPAND} border={5} />
            <SizerItem flag={wxEXPAND | wxALL} border={5}>
              {/* m_Buttons: OK, Cancel */}
              <StdDialogButtonSizer
                onOk={p.onOK}
                okLabel={p.readOnly ? _('Read Only') : undefined}
                okDisabled={p.readOnly}
                onCancel={p.onCancel}
              />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
