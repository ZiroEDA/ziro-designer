// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_GENDRILL_BASE` (dialog_gendrill_base.cpp): the sizer tree, Add() for Add(). Values,
 * enables and events are props; the behaviour is DIALOG_GENDRILL's (dialog_gendrill.tsx).
 */
import type { JSX } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { StdBitmapButton } from '@ziroeda/common/widgets/std_bitmap_button.js';
import { Combo } from '@ziroeda/wx/combobox.js';
import {
  Button,
  type CHECK,
  type CHOICE,
  CheckBox,
  RadioButton,
  StaticLine,
  StaticText,
  TextCtrl,
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
  FlexGridSizer,
  SizerItem,
  Spacer,
  StaticBoxSizer,
  StdDialogButtonSizer,
} from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

/** The base's choice lists. */
export const DRILL_MAP_CHOICES = [
  _HKI('Postscript'),
  _HKI('Gerber X2'),
  _HKI('DXF'),
  _HKI('SVG'),
  _HKI('PDF'),
] as const;
export const DRILL_ORIGIN_CHOICES = [_HKI('Absolute'), _HKI('Drill/place file origin')] as const;
export const DRILL_UNITS_CHOICES = [_HKI('Millimeters'), _HKI('Inches')] as const;
export const DRILL_ZEROS_CHOICES = [
  _HKI('Decimal format (recommended)'),
  _HKI('Suppress leading zeros'),
  _HKI('Suppress trailing zeros'),
  _HKI('Keep zeros'),
] as const;

export interface DIALOG_GENDRILL_BASE_PROPS {
  m_outputDirectoryName: string;
  onOutputDirectoryName: (aValue: string) => void;
  /** `onOutputDirectoryBrowseClicked`. */
  /** Absent: no browse button - the output is downloaded, so there is no folder on disk to pick. */
  onOutputDirectoryBrowseClicked?: () => void;
  /** `m_rbExcellon` / `m_rbGerberX2`, and `onFileFormatSelection`. */
  excellon: boolean;
  onFileFormatSelection: (aExcellon: boolean) => void;
  m_Check_Mirror: CHECK;
  m_Check_Minimal: CHECK;
  m_Check_Merge_PTH_NPTH: CHECK;
  m_altDrillMode: CHECK;
  m_generateTentingLayers: CHECK;
  m_cbGenerateMap: CHECK;
  m_choiceDrillMap: CHOICE;
  m_origin: CHOICE;
  /** `m_units`, `onSelDrillUnitsSelected`. */
  m_units: CHOICE;
  /** `m_zeros`, `onSelZerosFmtSelected`. */
  m_zeros: CHOICE;
  /** `m_staticTextPrecision`, and whether its label pair is enabled. */
  precision: string;
  precisionEnabled: boolean;
  /** `m_messagesBox`. */
  messages: string;
  /** `onGenReportFile`. */
  onGenReportFile: () => void;
  /** wxID_OK ("Generate") and wxID_CANCEL ("Close"). */
  onGenerate: () => void;
  onCancel: () => void;
}

const choiceOptions = (aList: readonly string[]) =>
  aList.map((label, i) => ({ value: String(i), label }));

/** A wxChoice in fgSizer1, with its label. */
function LabelledChoice({
  label,
  labelFlag,
  choiceFlag,
  list,
  choice,
}: {
  label: string;
  labelFlag: number;
  choiceFlag: number;
  list: readonly string[];
  choice: CHOICE;
}): JSX.Element {
  return (
    <>
      <SizerItem flag={labelFlag} border={5}>
        <StaticText label={label} disabled={choice.enabled === false} />
      </SizerItem>
      <SizerItem flag={choiceFlag} border={5}>
        <Combo
          value={String(choice.value)}
          options={choiceOptions(list)}
          onChange={(v) => choice.onChange(Number(v))}
          disabled={choice.enabled === false}
          ariaLabel={label.replace(/:$/, '')}
        />
      </SizerItem>
    </>
  );
}

export function DIALOG_GENDRILL_BASE(p: DIALOG_GENDRILL_BASE_PROPS): JSX.Element {
  return (
    <DialogShim title={_('Generate Drill Files')} onClose={p.onCancel}>
      {/* bMainSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={10}>
          {/* bupperSizer */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT} border={10}>
              {/* staticTextOutputDir */}
              <span>{_('Output folder:')}</span>
            </SizerItem>
            <SizerItem proportion={1} flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={0}>
              {/* m_outputDirectoryName */}
              <TextCtrl
                value={p.m_outputDirectoryName}
                onChange={p.onOutputDirectoryName}
                ariaLabel="Output folder"
              />
            </SizerItem>
            <SizerItem
              flag={wxALIGN_CENTER_VERTICAL}
              border={5}
              shown={p.onOutputDirectoryBrowseClicked !== undefined}
            >
              {/* m_browseButton: small_folder */}
              <StdBitmapButton
                bitmap="small_folder"
                title={_('Browse')}
                tooltip={null}
                onClick={() => p.onOutputDirectoryBrowseClicked?.()}
              />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxTOP} border={8}>
          {/* bmiddlerSizer */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem proportion={1} flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={5}>
              {/* bLeftCol */}
              <BoxSizer orient={wxVERTICAL}>
                <SizerItem flag={wxRIGHT | wxLEFT} border={13}>
                  {/* m_formatLabel */}
                  <span>{_('Format')}</span>
                </SizerItem>
                <SizerItem flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
                  {/* m_staticline1 */}
                  <StaticLine />
                </SizerItem>
                <SizerItem proportion={1} flag={wxEXPAND | wxRIGHT | wxLEFT} border={5}>
                  {/* bSizerMargins */}
                  <BoxSizer orient={wxVERTICAL}>
                    <SizerItem flag={wxALL} border={5}>
                      {/* m_rbExcellon */}
                      <RadioButton
                        label={_('Excellon')}
                        name="ze-gendrill-fmt"
                        checked={p.excellon}
                        onChange={() => p.onFileFormatSelection(true)}
                      />
                    </SizerItem>
                    <SizerItem flag={wxEXPAND | wxLEFT} border={20}>
                      {/* fgSizerExcellonOptions = wxFlexGridSizer( 4, 1, 3, 0 ) */}
                      <FlexGridSizer cols={1} vgap={3} hgap={0}>
                        <SizerItem flag={wxLEFT} border={5}>
                          <CheckBox
                            label={_('Mirror Y axis')}
                            title={_(
                              'Not recommended.\nUsed mostly by users who make the boards themselves.',
                            )}
                            check={p.m_Check_Mirror}
                          />
                        </SizerItem>
                        <SizerItem flag={wxRIGHT | wxLEFT} border={5}>
                          <CheckBox
                            label={_('Minimal header')}
                            title={_(
                              'Not recommended.\nOnly use it for board houses which do not accept fully featured headers.',
                            )}
                            check={p.m_Check_Minimal}
                          />
                        </SizerItem>
                        <SizerItem flag={wxLEFT} border={5}>
                          <CheckBox
                            label={_('PTH and NPTH in single file')}
                            title={_(
                              'Not recommended.\nOnly use for board houses which ask for merged PTH and NPTH into a single file.',
                            )}
                            check={p.m_Check_Merge_PTH_NPTH}
                          />
                        </SizerItem>
                        <SizerItem flag={wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
                          <CheckBox
                            label={_('Use alternate drill mode for oval holes')}
                            check={p.m_altDrillMode}
                          />
                        </SizerItem>
                      </FlexGridSizer>
                    </SizerItem>
                    <Spacer width={0} height={3} proportion={1} flag={wxEXPAND} border={5} />
                    <SizerItem flag={wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
                      {/* m_rbGerberX2 */}
                      <RadioButton
                        label={_('Gerber X2')}
                        name="ze-gendrill-fmt"
                        checked={!p.excellon}
                        onChange={() => p.onFileFormatSelection(false)}
                      />
                    </SizerItem>
                    <SizerItem proportion={1} flag={wxEXPAND | wxLEFT} border={20}>
                      {/* fgSizerGerberX2Options = wxFlexGridSizer( 4, 1, 3, 0 ) */}
                      <FlexGridSizer cols={1} vgap={3} hgap={0}>
                        <SizerItem flag={wxBOTTOM | wxLEFT | wxRIGHT} border={5}>
                          <CheckBox
                            label={_('Generate tenting layers')}
                            check={p.m_generateTentingLayers}
                          />
                        </SizerItem>
                      </FlexGridSizer>
                    </SizerItem>
                    <Spacer width={0} height={6} flag={wxEXPAND} border={5} />
                    <SizerItem flag={wxEXPAND | wxRIGHT | wxLEFT} border={5}>
                      {/* bSizer9 */}
                      <BoxSizer orient={wxHORIZONTAL}>
                        <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxTOP | wxBOTTOM} border={5}>
                          {/* m_cbGenerateMap */}
                          <CheckBox
                            label={_('Generate map:')}
                            checked={p.m_cbGenerateMap.value}
                            onChange={p.m_cbGenerateMap.onChange}
                          />
                        </SizerItem>
                        <SizerItem proportion={1} flag={wxALL} border={5}>
                          {/* m_choiceDrillMap */}
                          <Combo
                            value={String(p.m_choiceDrillMap.value)}
                            options={choiceOptions(DRILL_MAP_CHOICES)}
                            onChange={(v) => p.m_choiceDrillMap.onChange(Number(v))}
                            disabled={p.m_choiceDrillMap.enabled === false}
                            ariaLabel="Generate map format"
                          />
                        </SizerItem>
                      </BoxSizer>
                    </SizerItem>
                  </BoxSizer>
                </SizerItem>
              </BoxSizer>
            </SizerItem>
            <Spacer width={15} height={0} border={5} />
            <SizerItem flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={5}>
              {/* bRightCol */}
              <BoxSizer orient={wxVERTICAL}>
                <SizerItem flag={wxRIGHT | wxLEFT} border={13}>
                  {/* m_optionsLabel */}
                  <span>{_('Options')}</span>
                </SizerItem>
                <SizerItem flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
                  {/* m_staticline2 */}
                  <StaticLine />
                </SizerItem>
                <SizerItem flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={5}>
                  {/* fgSizer1 = wxFlexGridSizer( 0, 2, 5, 5 ), AddGrowableCol( 1 ) */}
                  <FlexGridSizer cols={2} vgap={5} hgap={5} growableCols={[1]}>
                    <LabelledChoice
                      label={_('Origin:')}
                      labelFlag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT}
                      choiceFlag={wxEXPAND | wxALIGN_CENTER_VERTICAL | wxRIGHT}
                      list={DRILL_ORIGIN_CHOICES}
                      choice={p.m_origin}
                    />
                    <LabelledChoice
                      label={_('Units:')}
                      labelFlag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT}
                      choiceFlag={wxEXPAND | wxALIGN_CENTER_VERTICAL | wxRIGHT}
                      list={DRILL_UNITS_CHOICES}
                      choice={p.m_units}
                    />
                    <LabelledChoice
                      label={_('Zeros:')}
                      labelFlag={wxALIGN_CENTER_VERTICAL | wxLEFT}
                      choiceFlag={wxALIGN_CENTER_VERTICAL | wxRIGHT}
                      list={DRILL_ZEROS_CHOICES}
                      choice={p.m_zeros}
                    />
                    <Spacer width={0} height={8} proportion={1} flag={wxEXPAND} border={5} />
                    <Spacer proportion={1} flag={wxEXPAND} border={5} />
                    <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={5}>
                      {/* m_precisionLabel */}
                      <StaticText label={_('Precision:')} disabled={!p.precisionEnabled} />
                    </SizerItem>
                    <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT} border={5}>
                      {/* m_staticTextPrecision */}
                      <StaticText label={p.precision} disabled={!p.precisionEnabled} />
                    </SizerItem>
                    <Spacer proportion={1} flag={wxEXPAND} border={5} />
                  </FlexGridSizer>
                </SizerItem>
              </BoxSizer>
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem proportion={1} flag={wxALL | wxEXPAND} border={10}>
          {/* bMsgSizer */}
          <StaticBoxSizer label={_('Messages')} orient={wxVERTICAL}>
            <SizerItem proportion={1} flag={wxEXPAND} border={5} minSize={[-1, 90]}>
              {/* m_messagesBox: wxTE_MULTILINE|wxTE_READONLY */}
              <TextCtrl value={p.messages} multiLine readOnly ariaLabel={_('Messages')} />
            </SizerItem>
          </StaticBoxSizer>
        </SizerItem>
      </BoxSizer>
      {/* m_buttonsSizer: m_buttonReport (wxEXPAND|wxRIGHT|wxLEFT 10) and m_sdbSizer;
          SetupStandardButtons( { wxID_OK, "Generate" }, { wxID_CANCEL, "Close" } ) */}
      <StdDialogButtonSizer
        onCancel={p.onCancel}
        onOk={p.onGenerate}
        okLabel={_('Generate')}
        cancelLabel={_('Close')}
      >
        <Button label={_('Generate Report File...')} onClick={p.onGenReportFile} />
      </StdDialogButtonSizer>
    </DialogShim>
  );
}
