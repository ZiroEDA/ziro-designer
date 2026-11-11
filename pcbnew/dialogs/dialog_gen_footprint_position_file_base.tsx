// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_GEN_FOOTPRINT_POSITION_BASE` (dialog_gen_footprint_position_file_base.cpp): the sizer
 * tree, Add() for Add(). Values, the onUpdateUI* enables and the events are props; the behaviour
 * is DIALOG_GEN_FOOTPRINT_POSITION's (dialog_gen_footprint_position.tsx).
 */
import type { JSX } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { StdBitmapButton } from '@ziroeda/common/widgets/std_bitmap_button.js';
import { HtmlReportPanel } from '@ziroeda/common/widgets/wx_html_report_panel.js';
import type { ReportLine } from '@ziroeda/common/reporter.js';
import { Combo } from '@ziroeda/wx/combobox.js';
import { type CHECK, CheckBox, StaticText, TextCtrl } from '@ziroeda/wx/controls.js';
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
  StdDialogButtonSizer,
} from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

/** `m_formatCtrlChoices`, `m_unitsCtrlChoices`. */
export const POS_FORMAT_CHOICES = [_HKI('Plain text'), _HKI('CSV'), _HKI('Gerber X3')] as const;
export const POS_UNITS_CHOICES = [_HKI('Inches'), _HKI('Millimeters')] as const;

export interface DIALOG_GEN_FOOTPRINT_POSITION_BASE_PROPS {
  /** `m_variantChoiceCtrl`: the board's variants, and whether the choice is live. */
  variants: readonly string[];
  m_variantChoiceCtrl: number;
  onVariant: (aIndex: number) => void;
  variantEnabled: boolean;
  variantTip?: string;
  m_outputDirectoryName: string;
  onOutputDirectoryName: (aValue: string) => void;
  /** `onOutputDirectoryBrowseClicked`. */
  /** Absent: no browse button - the output is downloaded, so there is no folder on disk to pick. */
  onOutputDirectoryBrowseClicked?: () => void;
  /** `m_formatCtrl`: an index into POS_FORMAT_CHOICES. */
  m_formatCtrl: number;
  onFormat: (aIndex: number) => void;
  /** `m_unitsCtrl`, and `onUpdateUIUnits`. */
  m_unitsCtrl: number;
  onUnits: (aIndex: number) => void;
  unitsEnabled: boolean;
  m_onlySMD: CHECK;
  m_excludeTH: CHECK;
  m_excludeDNP: CHECK;
  m_excludeBOM: CHECK;
  m_cbIncludeBoardEdge: CHECK;
  m_useDrillPlaceOrigin: CHECK;
  m_negateXcb: CHECK;
  m_singleFile: CHECK;
  /** `m_messagesPanel`. */
  messages: readonly ReportLine[];
  visibleSeverities: number;
  onVisibleSeveritiesChange: (aSeverities: number) => void;
  /** `onGenerate`. */
  onGenerate: () => void;
  onCancel: () => void;
}

/** One of bSizerLower's checkboxes: wxBOTTOM|wxRIGHT|wxLEFT 5. */
function Option({ label, check }: { label: string; check: CHECK }): JSX.Element {
  return (
    <SizerItem flag={wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
      <CheckBox
        label={label}
        checked={check.value}
        disabled={check.enabled === false}
        onChange={check.onChange}
      />
    </SizerItem>
  );
}

export function DIALOG_GEN_FOOTPRINT_POSITION_BASE(
  p: DIALOG_GEN_FOOTPRINT_POSITION_BASE_PROPS,
): JSX.Element {
  const choice = (aList: readonly string[]) =>
    aList.map((label, i) => ({ value: String(i), label }));

  return (
    <DialogShim title={_('Generate Placement Files')} onClose={p.onCancel}>
      {/* m_MainSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem flag={wxALL | wxEXPAND} border={5}>
          {/* fgSizerTop = wxFlexGridSizer( 0, 2, 5, 5 ) */}
          <FlexGridSizer cols={2} vgap={5} hgap={5}>
            <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={5}>
              {/* m_variantLabel */}
              <span title={p.variantTip}>{_('Design variant:')}</span>
            </SizerItem>
            <SizerItem flag={wxEXPAND} border={5}>
              {/* m_variantChoiceCtrl */}
              <Combo
                value={String(p.m_variantChoiceCtrl)}
                options={choice(p.variants)}
                onChange={(v) => p.onVariant(Number(v))}
                disabled={!p.variantEnabled}
                ariaLabel="Design variant"
              />
            </SizerItem>
            <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={5}>
              {/* m_staticTextDir */}
              <span>{_('Output directory:')}</span>
            </SizerItem>
            <SizerItem proportion={1} flag={wxEXPAND} border={10}>
              {/* bSizerdirBrowse */}
              <BoxSizer orient={wxHORIZONTAL}>
                <SizerItem
                  proportion={1}
                  flag={wxALIGN_CENTER_VERTICAL}
                  border={5}
                  minSize={[350, -1]}
                >
                  {/* m_outputDirectoryName */}
                  <TextCtrl
                    value={p.m_outputDirectoryName}
                    onChange={p.onOutputDirectoryName}
                    ariaLabel={_('Output directory')}
                    title={_(
                      'Target directory for plot files. Can be absolute or relative to the board file location.',
                    )}
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
          </FlexGridSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={5}>
          {/* bSizerMiddle */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem proportion={1} flag={wxEXPAND | wxBOTTOM | wxLEFT} border={5}>
              {/* fgSizer1 = wxFlexGridSizer( 0, 2, 5, 5 ), AddGrowableCol( 1 ) */}
              <FlexGridSizer cols={2} vgap={5} hgap={5} growableCols={[1]}>
                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT} border={5}>
                  {/* m_formatLabel */}
                  <span>{_('Format:')}</span>
                </SizerItem>
                <SizerItem flag={wxRIGHT | wxLEFT | wxEXPAND} border={5}>
                  {/* m_formatCtrl */}
                  <Combo
                    value={String(p.m_formatCtrl)}
                    options={choice(POS_FORMAT_CHOICES)}
                    onChange={(v) => p.onFormat(Number(v))}
                    ariaLabel={_('Format')}
                  />
                </SizerItem>
                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT} border={5}>
                  {/* m_unitsLabel: enabled with the units (onUpdateUIUnits) */}
                  <StaticText label={_('Units:')} disabled={!p.unitsEnabled} />
                </SizerItem>
                <SizerItem flag={wxEXPAND | wxRIGHT | wxLEFT} border={5}>
                  {/* m_unitsCtrl */}
                  <Combo
                    value={String(p.m_unitsCtrl)}
                    options={choice(POS_UNITS_CHOICES)}
                    onChange={(v) => p.onUnits(Number(v))}
                    disabled={!p.unitsEnabled}
                    ariaLabel="Units"
                  />
                </SizerItem>
              </FlexGridSizer>
            </SizerItem>
            <SizerItem proportion={1} flag={wxEXPAND} border={5}>
              {/* bSizer6: an empty column */}
              <BoxSizer orient={wxVERTICAL}>
                <Spacer proportion={1} flag={wxEXPAND} border={5} />
              </BoxSizer>
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem proportion={1} flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={5}>
          {/* bSizerLower */}
          <BoxSizer orient={wxVERTICAL}>
            <Option label={_('Include only SMD footprints')} check={p.m_onlySMD} />
            <Option
              label={_('Exclude all footprints with through hole pads')}
              check={p.m_excludeTH}
            />
            <Option
              label={_('Exclude all footprints with the Do Not Populate flag set')}
              check={p.m_excludeDNP}
            />
            <Option
              label={_('Exclude all footprints with the Exclude from BOM flag set')}
              check={p.m_excludeBOM}
            />
            <Option label={_('Include board edge layer')} check={p.m_cbIncludeBoardEdge} />
            <Option label={_('Use drill/place file origin')} check={p.m_useDrillPlaceOrigin} />
            <Option
              label={_('Use negative X coordinates for footprints on bottom layer')}
              check={p.m_negateXcb}
            />
            <Option
              label={_('Generate single file with both front and back positions')}
              check={p.m_singleFile}
            />
            <Spacer width={0} height={5} flag={wxEXPAND} border={5} />
            <SizerItem proportion={1} flag={wxEXPAND | wxTOP} border={10} minSize={[350, 120]}>
              {/* m_messagesPanel */}
              <HtmlReportPanel
                lines={p.messages}
                fileName="report.txt"
                minHeight={120}
                visibleSeverities={p.visibleSeverities}
                onVisibleSeveritiesChange={p.onVisibleSeveritiesChange}
              />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
      </BoxSizer>
      {/* m_sdbSizer; SetupStandardButtons( { wxID_OK, "Generate Position File" },
          { wxID_CANCEL, "Close" } ) */}
      <StdDialogButtonSizer
        onCancel={p.onCancel}
        onOk={p.onGenerate}
        okLabel={_('Generate Position File')}
        cancelLabel="Close"
      />
    </DialogShim>
  );
}
