// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_TUNING_PATTERN_PROPERTIES_BASE`
 * (pcbnew/dialogs/dialog_tuning_pattern_properties_base.cpp): the sizer tree, Add() for Add(). The
 * members are props; the behaviour is DIALOG_TUNING_PATTERN_PROPERTIES's
 * (dialog_tuning_pattern_properties.tsx).
 */
import type { JSX } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import {
  type CHECK,
  type CHOICE,
  CheckBox,
  Choice,
  RadioButton,
  StaticBitmap,
  StaticText,
  TextCtrl,
} from '@ziroeda/wx/controls.js';
import {
  wxALIGN_CENTER_VERTICAL,
  wxALL,
  wxEXPAND,
  wxHORIZONTAL,
  wxLEFT,
  wxRIGHT,
  wxTOP,
  wxVERTICAL,
} from '@ziroeda/wx/defs.js';
import { BoxSizer, GridBagSizer, SizerItem, StdDialogButtonSizer } from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

/** A wxTextCtrl (a UNIT_BINDER's control) and its unit text. */
export interface FIELD {
  value: string;
  units: string;
  enabled?: boolean;
  onChange: (aText: string) => void;
}

export interface DIALOG_TUNING_PATTERN_PROPERTIES_BASE_PROPS {
  title: string;
  /** `m_legend->SetBitmap( … )`: the mode's legend. */
  m_legend: string;
  m_radioBtnLength: { value: boolean; enabled: boolean; onSelect: () => void };
  targetLengthLabel: string;
  m_targetLength: FIELD;
  m_radioBtnDelay: { value: boolean; enabled: boolean; onSelect: () => void };
  targetDelayLabel: string;
  m_targetDelay: FIELD;
  m_overrideCustomRules: CHECK;
  /** `m_sourceInfo`, and whether it is shown. */
  m_sourceInfo: string | null;
  m_minA: FIELD;
  m_maxA: FIELD;
  m_spacing: FIELD;
  m_cornerCtrl: CHOICE;
  m_r: FIELD;
  m_singleSided: CHECK;
  onOK: () => void;
  onCancel: () => void;
}

const CV = wxALIGN_CENTER_VERTICAL;

function Ctrl({ f, name, title }: { f: FIELD; name: string; title?: string }): JSX.Element {
  return (
    <TextCtrl
      value={f.value}
      onChange={f.onChange}
      disabled={f.enabled === false}
      ariaLabel={name}
      title={title}
    />
  );
}

export function DIALOG_TUNING_PATTERN_PROPERTIES_BASE(
  p: DIALOG_TUNING_PATTERN_PROPERTIES_BASE_PROPS,
): JSX.Element {
  return (
    <DialogShim title={p.title} onClose={p.onCancel}>
      {/* bMainSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem proportion={1} flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={10}>
          {/* singleTrackSizer */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem flag={wxEXPAND | wxRIGHT | wxLEFT} border={15}>
              <StaticBitmap bitmap={p.m_legend} />
            </SizerItem>
            <SizerItem proportion={1} flag={wxEXPAND} border={5}>
              {/* gbSizer1 = wxGridBagSizer( 4, 4 ), SetEmptyCellSize( wxSize( 10,8 ) ) */}
              <GridBagSizer vgap={4} hgap={4} emptyCellSize={[10, 8]} growableCols={[1, 5]}>
                <SizerItem pos={[0, 0]} border={5}>
                  {/* bSizer3 */}
                  <BoxSizer orient={wxHORIZONTAL}>
                    <SizerItem flag={wxALL} border={5}>
                      <RadioButton
                        label=""
                        name="m_targetDomain"
                        checked={p.m_radioBtnLength.value}
                        disabled={!p.m_radioBtnLength.enabled}
                        onChange={p.m_radioBtnLength.onSelect}
                      />
                    </SizerItem>
                    <SizerItem flag={wxALL} border={5}>
                      <StaticText label={p.targetLengthLabel} />
                    </SizerItem>
                  </BoxSizer>
                </SizerItem>
                <SizerItem pos={[0, 1]} flag={wxEXPAND} border={5}>
                  <Ctrl f={p.m_targetLength} name="Target length" />
                </SizerItem>
                <SizerItem pos={[0, 2]} flag={CV} border={5}>
                  <StaticText label={p.m_targetLength.units} />
                </SizerItem>
                <SizerItem pos={[1, 0]} border={5}>
                  {/* bSizer31 */}
                  <BoxSizer orient={wxHORIZONTAL}>
                    <SizerItem flag={wxALL} border={5}>
                      <RadioButton
                        label=""
                        name="m_targetDomain"
                        checked={p.m_radioBtnDelay.value}
                        disabled={!p.m_radioBtnDelay.enabled}
                        onChange={p.m_radioBtnDelay.onSelect}
                      />
                    </SizerItem>
                    <SizerItem flag={wxALL} border={5}>
                      <StaticText label={p.targetDelayLabel} />
                    </SizerItem>
                  </BoxSizer>
                </SizerItem>
                <SizerItem pos={[1, 1]} flag={wxEXPAND} border={5}>
                  <Ctrl f={p.m_targetDelay} name="Target delay" />
                </SizerItem>
                <SizerItem pos={[1, 2]} flag={CV} border={5}>
                  <StaticText label={p.m_targetDelay.units} />
                </SizerItem>
                <SizerItem pos={[0, 4]} span={[1, 3]} flag={CV} border={5}>
                  <CheckBox label={_('Override custom rules')} check={p.m_overrideCustomRules} />
                </SizerItem>
                <SizerItem
                  pos={[2, 1]}
                  span={[1, 6]}
                  flag={CV}
                  border={5}
                  shown={p.m_sourceInfo !== null}
                >
                  <StaticText label={p.m_sourceInfo ?? ''} />
                </SizerItem>
                <SizerItem pos={[5, 0]} flag={CV | wxLEFT} border={1}>
                  <StaticText label={_('Minimum amplitude (A):')} />
                </SizerItem>
                <SizerItem pos={[5, 1]} flag={wxEXPAND} border={5}>
                  <Ctrl f={p.m_minA} name="Minimum amplitude" />
                </SizerItem>
                <SizerItem pos={[5, 2]} flag={CV} border={5}>
                  <StaticText label={p.m_minA.units} />
                </SizerItem>
                <SizerItem pos={[5, 4]} flag={CV} border={5}>
                  <StaticText label={_('Maximum amplitude (A):')} />
                </SizerItem>
                <SizerItem pos={[5, 5]} flag={wxEXPAND} border={5}>
                  <Ctrl f={p.m_maxA} name="Maximum amplitude" />
                </SizerItem>
                <SizerItem pos={[5, 6]} flag={CV} border={5}>
                  <StaticText label={p.m_maxA.units} />
                </SizerItem>
                <SizerItem pos={[6, 0]} flag={CV | wxLEFT} border={1}>
                  <StaticText label={_('Spacing (s):')} />
                </SizerItem>
                <SizerItem pos={[6, 1]} flag={wxEXPAND} border={5}>
                  <Ctrl
                    f={p.m_spacing}
                    name="Spacing"
                    title={_(
                      'Minimum spacing between adjacent tuning segments. The resulting spacing may be greater based on design rules.',
                    )}
                  />
                </SizerItem>
                <SizerItem pos={[6, 2]} flag={CV} border={5}>
                  <StaticText label={p.m_spacing.units} />
                </SizerItem>
                <SizerItem pos={[8, 0]} flag={CV | wxLEFT} border={1}>
                  <StaticText label={_('Corner style:')} />
                </SizerItem>
                <SizerItem pos={[8, 1]} span={[1, 2]} flag={wxEXPAND} border={5}>
                  <Choice
                    choices={[_('Chamfer'), _('Fillet')]}
                    choice={p.m_cornerCtrl}
                    ariaLabel={_('Corner style')}
                  />
                </SizerItem>
                <SizerItem pos={[8, 4]} flag={CV} border={5}>
                  <StaticText label={_('Radius (r):')} />
                </SizerItem>
                <SizerItem pos={[8, 5]} flag={wxEXPAND} border={5}>
                  <Ctrl f={p.m_r} name={_('Radius')} />
                </SizerItem>
                <SizerItem pos={[8, 6]} flag={CV} border={5}>
                  <StaticText label={p.m_r.units} />
                </SizerItem>
                <SizerItem pos={[9, 1]} span={[1, 2]} flag={CV} border={5}>
                  <CheckBox label={_('Single-sided')} check={p.m_singleSided} />
                </SizerItem>
              </GridBagSizer>
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
