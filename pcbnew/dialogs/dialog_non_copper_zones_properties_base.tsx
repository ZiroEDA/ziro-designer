// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_NONCOPPER_ZONES_PROPERTIES_BASE`
 * (pcbnew/dialogs/dialog_non_copper_zones_properties_base.cpp): the sizer tree, Add() for Add().
 * The members are props; the behaviour is DIALOG_NON_COPPER_ZONES_EDITOR's
 * (dialog_non_copper_zones_properties.tsx).
 */
import type { JSX, ReactNode } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import {
  type CHECK,
  type CHOICE,
  CheckBox,
  Choice,
  StaticLine,
  StaticText,
  TextCtrl,
} from '@ziroeda/wx/controls.js';
import { type DATAVIEW_TOGGLE_ROW, DataViewListCtrl } from '@ziroeda/wx/dataview_ui.js';
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
  Spacer,
  StaticBoxSizer,
  StdDialogButtonSizer,
} from '@ziroeda/wx/sizer.js';
import { SpinCtrl } from '@ziroeda/wx/spin_ctrl.js';
import { _ } from '@ziroeda/wx/translation.js';

/** A UNIT_BINDER (or a wxTextCtrl and its unit text): text, unit, Enable(). */
export interface UNIT_FIELD {
  value: string;
  units: string;
  enabled?: boolean;
  onChange: (aText: string) => void;
}

export interface DIALOG_NONCOPPER_ZONES_PROPERTIES_BASE_PROPS {
  m_layers: readonly DATAVIEW_TOGGLE_ROW[];
  OnLayerSelection: (aRow: number, aOn: boolean) => void;
  m_cbLocked: CHECK;
  m_OutlineDisplayCtrl: CHOICE;
  m_outlineHatchPitch: UNIT_FIELD;
  m_minWidth: UNIT_FIELD;
  m_cornerSmoothingChoice: CHOICE;
  /** `m_cornerRadiusLabel`, which OnUpdateUI words for the smoothing chosen. */
  cornerRadiusLabel: string;
  m_cornerRadius: UNIT_FIELD;
  m_GridStyleCtrl: CHOICE;
  m_hatchOrient: UNIT_FIELD;
  m_hatchWidth: UNIT_FIELD;
  m_hatchGap: UNIT_FIELD;
  m_spinCtrlSmoothLevel: { value: number; enabled: boolean; onChange: (aValue: number) => void };
  m_spinCtrlSmoothValue: { value: number; enabled: boolean; onChange: (aValue: number) => void };
  onOK: () => void;
  onCancel: () => void;
  /**
   * The "Conversion Settings" box the class Insert()s at 0, its wxStaticLine at 1, when
   * CONVERT_TOOL opens it; null otherwise.
   */
  conversionBox?: ReactNode | null;
  /** `SetTitle( _( "Convert to Non Copper Zone" ) )` when converting. */
  title?: string;
}

const CV = wxALIGN_CENTER_VERTICAL;
const BRL = wxBOTTOM | wxRIGHT | wxLEFT;

export function DIALOG_NONCOPPER_ZONES_PROPERTIES_BASE(
  p: DIALOG_NONCOPPER_ZONES_PROPERTIES_BASE_PROPS,
): JSX.Element {
  /** One label / control / unit row of fgSizer1. */
  const fillRow = (aLabel: string, f: UNIT_FIELD, aName: string): JSX.Element => (
    <>
      <SizerItem flag={CV | BRL} border={5}>
        <StaticText label={aLabel} disabled={f.enabled === false} />
      </SizerItem>
      <SizerItem flag={BRL | wxEXPAND | CV} border={5}>
        <TextCtrl
          value={f.value}
          onChange={f.onChange}
          disabled={f.enabled === false}
          ariaLabel={aName}
        />
      </SizerItem>
      <SizerItem flag={wxBOTTOM | wxRIGHT | CV} border={5}>
        <StaticText label={f.units} disabled={f.enabled === false} />
      </SizerItem>
    </>
  );

  return (
    <DialogShim title={p.title ?? _('Non Copper Zone Properties')} onClose={p.onCancel}>
      {/* m_MainSizer */}
      <BoxSizer orient={wxVERTICAL}>
        {p.conversionBox != null && (
          <SizerItem flag={wxALL | wxEXPAND} border={10}>
            {p.conversionBox}
          </SizerItem>
        )}
        {p.conversionBox != null && (
          <SizerItem flag={wxLEFT | wxRIGHT | wxEXPAND} border={10}>
            <StaticLine />
          </SizerItem>
        )}
        <SizerItem proportion={1} flag={wxEXPAND | wxALL} border={5}>
          {/* m_UpperSizer */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem proportion={1} flag={wxEXPAND} border={5}>
              {/* bSizerLeft */}
              <BoxSizer orient={wxVERTICAL}>
                <SizerItem flag={wxLEFT | wxRIGHT | wxTOP} border={7}>
                  <StaticText label={_('Layers')} />
                </SizerItem>
                <Spacer width={0} height={2} flag={wxEXPAND} border={5} />
                <SizerItem proportion={1} flag={wxEXPAND | BRL} border={5} minSize={[100, -1]}>
                  <DataViewListCtrl
                    rows={p.m_layers}
                    onToggle={p.OnLayerSelection}
                    ariaLabel={_('Layers')}
                  />
                </SizerItem>
                <Spacer width={0} height={5} flag={wxEXPAND} border={5} />
              </BoxSizer>
            </SizerItem>
            <SizerItem flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={10}>
              {/* bSizerMiddle */}
              <BoxSizer orient={wxVERTICAL}>
                <SizerItem flag={wxEXPAND | wxBOTTOM} border={5}>
                  <StaticBoxSizer label={_('Shape')} orient={wxVERTICAL}>
                    <SizerItem flag={wxEXPAND} border={5}>
                      {/* gbSizer1 = wxGridBagSizer( 0, 0 ), SetEmptyCellSize( wxSize( -1,6 ) ) */}
                      <GridBagSizer vgap={0} hgap={0} emptyCellSize={[-1, 6]} growableCols={[1]}>
                        <SizerItem pos={[0, 0]} flag={wxALL} border={5}>
                          <CheckBox label={_('Locked')} check={p.m_cbLocked} />
                        </SizerItem>
                        <SizerItem pos={[2, 0]} flag={CV | wxALL} border={5}>
                          <StaticText label={_('Outline style:')} />
                        </SizerItem>
                        <SizerItem pos={[2, 1]} flag={wxALL | wxEXPAND | CV} border={5}>
                          <Choice
                            choices={[_('Line'), _('Hatched'), _('Fully hatched')]}
                            choice={p.m_OutlineDisplayCtrl}
                            ariaLabel={_('Outline style')}
                          />
                        </SizerItem>
                        <SizerItem pos={[3, 0]} flag={wxALL | CV} border={5}>
                          <StaticText label={_('Outline hatch pitch:')} />
                        </SizerItem>
                        <SizerItem pos={[3, 1]} flag={wxEXPAND | CV | BRL} border={5}>
                          <TextCtrl
                            value={p.m_outlineHatchPitch.value}
                            onChange={p.m_outlineHatchPitch.onChange}
                            ariaLabel={_('Outline hatch pitch')}
                          />
                        </SizerItem>
                        <SizerItem pos={[3, 2]} flag={wxTOP | wxBOTTOM | wxRIGHT | CV} border={5}>
                          <StaticText label={p.m_outlineHatchPitch.units} />
                        </SizerItem>
                        <SizerItem pos={[4, 0]} flag={CV | BRL} border={5}>
                          <StaticText label={_('Minimum width:')} />
                        </SizerItem>
                        <SizerItem pos={[4, 1]} flag={wxEXPAND | CV | wxALL} border={5}>
                          <TextCtrl
                            value={p.m_minWidth.value}
                            onChange={p.m_minWidth.onChange}
                            ariaLabel={_('Minimum width')}
                          />
                        </SizerItem>
                        <SizerItem pos={[4, 2]} flag={CV | wxBOTTOM | wxRIGHT} border={5}>
                          <StaticText label={p.m_minWidth.units} />
                        </SizerItem>
                        <SizerItem pos={[5, 0]} flag={BRL | CV} border={5}>
                          <StaticText label={_('Corner smoothing:')} />
                        </SizerItem>
                        <SizerItem pos={[5, 1]} flag={BRL | CV | wxEXPAND} border={5}>
                          <Choice
                            choices={[_('None'), _('Chamfer'), _('Fillet')]}
                            choice={p.m_cornerSmoothingChoice}
                            ariaLabel={_('Corner smoothing')}
                          />
                        </SizerItem>
                        <SizerItem pos={[6, 0]} flag={BRL | CV} border={5}>
                          <StaticText
                            label={p.cornerRadiusLabel}
                            disabled={p.m_cornerRadius.enabled === false}
                          />
                        </SizerItem>
                        <SizerItem pos={[6, 1]} flag={BRL | CV | wxEXPAND} border={5}>
                          <TextCtrl
                            value={p.m_cornerRadius.value}
                            onChange={p.m_cornerRadius.onChange}
                            disabled={p.m_cornerRadius.enabled === false}
                            ariaLabel={_('Corner radius')}
                          />
                        </SizerItem>
                        <SizerItem pos={[6, 2]} flag={CV | wxBOTTOM | wxRIGHT} border={5}>
                          <StaticText
                            label={p.m_cornerRadius.units}
                            disabled={p.m_cornerRadius.enabled === false}
                          />
                        </SizerItem>
                      </GridBagSizer>
                    </SizerItem>
                  </StaticBoxSizer>
                </SizerItem>
                <SizerItem flag={wxEXPAND | wxTOP | wxBOTTOM} border={5}>
                  <StaticBoxSizer label={_('Fill')} orient={wxVERTICAL}>
                    <SizerItem flag={wxEXPAND} border={5}>
                      {/* fgSizer1 = wxFlexGridSizer( 0, 3, 0, 0 ) */}
                      <FlexGridSizer cols={3} vgap={0} hgap={0} growableCols={[1]}>
                        <SizerItem flag={BRL | CV} border={5}>
                          <StaticText label={_('Fill type:')} />
                        </SizerItem>
                        <SizerItem flag={BRL | wxEXPAND | CV} border={5}>
                          <Choice
                            choices={[_('Solid fill'), _('Hatch pattern')]}
                            choice={p.m_GridStyleCtrl}
                            ariaLabel={_('Fill type')}
                          />
                        </SizerItem>
                        <Spacer width={0} height={0} proportion={1} flag={wxEXPAND} border={5} />
                        {fillRow(_('Orientation:'), p.m_hatchOrient, 'Orientation')}
                        {fillRow(_('Hatch width:'), p.m_hatchWidth, 'Hatch width')}
                        {fillRow(_('Hatch gap:'), p.m_hatchGap, 'Hatch gap')}
                        <SizerItem flag={BRL | CV} border={5}>
                          <StaticText
                            label={_('Smoothing effort:')}
                            disabled={!p.m_spinCtrlSmoothLevel.enabled}
                            title={_(
                              'Value of smoothing effort\n0 = no smoothing\n1 = chamfer\n2 = round corners\n3 = round corners (finer shape)',
                            )}
                          />
                        </SizerItem>
                        <SizerItem flag={BRL | wxEXPAND | CV} border={5}>
                          <SpinCtrl
                            value={p.m_spinCtrlSmoothLevel.value}
                            onChange={p.m_spinCtrlSmoothLevel.onChange}
                            min={0}
                            max={3}
                            disabled={!p.m_spinCtrlSmoothLevel.enabled}
                            ariaLabel={_('Smoothing effort')}
                          />
                        </SizerItem>
                        <Spacer width={0} height={0} proportion={1} flag={wxEXPAND} border={5} />
                        <SizerItem flag={CV | wxBOTTOM | wxLEFT} border={5}>
                          <StaticText
                            label={_('Smoothing amount:')}
                            disabled={!p.m_spinCtrlSmoothValue.enabled}
                            title={_(
                              'Ratio between smoothed corners size and the gap between lines\n0 = no smoothing\n1.0 = max radius/chamfer size (half gap value)',
                            )}
                          />
                        </SizerItem>
                        <SizerItem flag={wxEXPAND | CV | BRL} border={5}>
                          <SpinCtrl
                            value={p.m_spinCtrlSmoothValue.value}
                            onChange={p.m_spinCtrlSmoothValue.onChange}
                            min={0}
                            max={1}
                            step={0.1}
                            digits={2}
                            disabled={!p.m_spinCtrlSmoothValue.enabled}
                            ariaLabel={_('Smoothing amount')}
                          />
                        </SizerItem>
                      </FlexGridSizer>
                    </SizerItem>
                  </StaticBoxSizer>
                </SizerItem>
              </BoxSizer>
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxALL} border={5}>
          <StdDialogButtonSizer onOk={p.onOK} onCancel={p.onCancel} />
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
