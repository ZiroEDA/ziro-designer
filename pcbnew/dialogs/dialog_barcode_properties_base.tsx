// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_BARCODE_PROPERTIES_BASE` (pcbnew/dialogs/dialog_barcode_properties_base.cpp): the sizer
 * tree, Add() for Add(). The members are props; the behaviour is DIALOG_BARCODE_PROPERTIES's
 * (dialog_barcode_properties.tsx).
 */
import type { JSX, ReactNode } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { Combo, type ComboOption, TextCombo } from '@ziroeda/wx/combobox.js';
import { type CHECK, CheckBox, RadioBox, StaticText, TextCtrl } from '@ziroeda/wx/controls.js';
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
  StdDialogButtonSizer,
} from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

/** A UNIT_BINDER over a wxTextCtrl: its label, text, unit and Enable(). */
export interface FIELD {
  label: string;
  value: string;
  units: string;
  enabled?: boolean;
  onChange: (aText: string) => void;
  onBlur?: () => void;
}

export interface DIALOG_BARCODE_PROPERTIES_BASE_PROPS {
  m_textInput: { value: string; onChange: (aText: string) => void };
  m_cbLocked: CHECK;
  m_cbKnockout: CHECK;
  m_cbShowText: CHECK;
  /** `m_cbLayer`, a PCB_LAYER_BOX_SELECTOR. */
  m_cbLayer: { rows: readonly ComboOption[]; value: string; onChange: (aLayer: string) => void };
  m_posX: FIELD;
  m_posY: FIELD;
  m_sizeX: FIELD;
  m_sizeY: FIELD;
  /** `m_orientationCtrl`, a wxComboBox with 0 / 90 / -90 / 180. */
  m_orientation: FIELD;
  m_textSize: FIELD;
  m_marginX: FIELD;
  m_marginY: FIELD;
  m_barcode: { choices: readonly string[]; selection: number; onChange: (aIndex: number) => void };
  m_errorCorrection: {
    choices: readonly string[];
    selection: number;
    enabled: boolean;
    itemEnabled: readonly boolean[];
    onChange: (aIndex: number) => void;
  };
  /** `m_panelShowBarcodeGal`, the preview. */
  m_panelShowBarcodeGal: ReactNode;
  onOK: () => void;
  onCancel: () => void;
}

const CV = wxALIGN_CENTER_VERTICAL;

export function DIALOG_BARCODE_PROPERTIES_BASE(
  p: DIALOG_BARCODE_PROPERTIES_BASE_PROPS,
): JSX.Element {
  const row = (aRow: number, f: FIELD, aMin?: readonly [number, number]): JSX.Element => (
    <>
      <SizerItem pos={[aRow, 0]} flag={CV} border={5}>
        <StaticText label={f.label} disabled={f.enabled === false} />
      </SizerItem>
      <SizerItem pos={[aRow, 1]} flag={CV | wxEXPAND} border={5} minSize={aMin}>
        <TextCtrl
          value={f.value}
          onChange={f.onChange}
          onBlur={f.onBlur}
          disabled={f.enabled === false}
          ariaLabel={f.label.replace(/:$/, '')}
        />
      </SizerItem>
      <SizerItem pos={[aRow, 2]} flag={CV | wxRIGHT} border={5}>
        <StaticText label={f.units} disabled={f.enabled === false} />
      </SizerItem>
    </>
  );

  return (
    <DialogShim title={_('Barcode Properties')} onClose={p.onCancel}>
      {/* m_MainSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem proportion={1} flag={wxEXPAND | wxTOP | wxLEFT} border={5}>
          {/* bSizerUpper */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem proportion={1} flag={wxEXPAND | wxRIGHT} border={5}>
              {/* bGeneralSizer */}
              <BoxSizer orient={wxVERTICAL}>
                <SizerItem flag={wxEXPAND} border={5}>
                  {/* bSizer10 */}
                  <BoxSizer orient={wxHORIZONTAL}>
                    <SizerItem flag={wxTOP | wxRIGHT | wxLEFT} border={5}>
                      <StaticText label={_('Text:')} />
                    </SizerItem>
                    <Spacer width={0} height={3} flag={wxEXPAND} border={5} />
                    <SizerItem
                      proportion={1}
                      flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT}
                      border={5}
                    >
                      <TextCtrl
                        value={p.m_textInput.value}
                        onChange={p.m_textInput.onChange}
                        ariaLabel="Text"
                      />
                    </SizerItem>
                  </BoxSizer>
                </SizerItem>
                <SizerItem proportion={1} flag={wxEXPAND} border={5}>
                  {/* bSizer8 */}
                  <BoxSizer orient={wxHORIZONTAL}>
                    <SizerItem flag={wxEXPAND} border={5}>
                      {/* bSizer9 */}
                      <BoxSizer orient={wxVERTICAL}>
                        <SizerItem flag={wxEXPAND | wxTOP | wxRIGHT} border={5}>
                          {/* m_LeftBoxSizer */}
                          <BoxSizer orient={wxVERTICAL}>
                            <SizerItem proportion={1} flag={wxALL | wxEXPAND} border={5}>
                              {/* bSizerCheckboxes */}
                              <BoxSizer orient={wxHORIZONTAL}>
                                <SizerItem proportion={1} border={5}>
                                  <CheckBox label={_('Locked')} check={p.m_cbLocked} />
                                </SizerItem>
                                <SizerItem proportion={1} flag={wxLEFT} border={10}>
                                  <CheckBox
                                    label={_('Knockout')}
                                    check={p.m_cbKnockout}
                                    title={_(
                                      'If checked, the barcode will be inverted with a margin around it',
                                    )}
                                  />
                                </SizerItem>
                                <SizerItem proportion={1} flag={wxLEFT} border={25}>
                                  <CheckBox label={_('Show text')} check={p.m_cbShowText} />
                                </SizerItem>
                              </BoxSizer>
                            </SizerItem>
                          </BoxSizer>
                        </SizerItem>
                        <SizerItem flag={wxALL | wxEXPAND} border={5}>
                          {/* m_middleBoxSizer */}
                          <BoxSizer orient={wxVERTICAL}>
                            <SizerItem
                              proportion={1}
                              flag={wxEXPAND | wxBOTTOM | wxLEFT}
                              border={5}
                            >
                              {/* gbSizer1 = wxGridBagSizer( 3, 3 ), SetEmptyCellSize( wxSize( 20,10 ) ) */}
                              <GridBagSizer
                                vgap={3}
                                hgap={3}
                                emptyCellSize={[20, 10]}
                                growableCols={[1]}
                              >
                                <SizerItem pos={[0, 0]} flag={CV | wxTOP} border={6}>
                                  <StaticText label={_('Layer:')} />
                                </SizerItem>
                                <SizerItem
                                  pos={[0, 1]}
                                  span={[1, 2]}
                                  flag={CV | wxEXPAND | wxTOP | wxRIGHT}
                                  border={6}
                                >
                                  <Combo
                                    value={p.m_cbLayer.value}
                                    options={p.m_cbLayer.rows}
                                    onChange={p.m_cbLayer.onChange}
                                    ariaLabel="Layer"
                                  />
                                </SizerItem>
                                {row(1, p.m_posX, [155, -1])}
                                {row(2, p.m_posY)}
                                {row(3, p.m_sizeX)}
                                {row(4, p.m_sizeY)}
                                <SizerItem pos={[6, 0]} flag={CV} border={5}>
                                  <StaticText label={p.m_orientation.label} />
                                </SizerItem>
                                <SizerItem pos={[6, 1]} flag={CV | wxEXPAND} border={5}>
                                  <TextCombo
                                    value={p.m_orientation.value}
                                    options={['0', '90', '-90', '180']}
                                    onChange={p.m_orientation.onChange}
                                    ariaLabel="Orientation"
                                  />
                                </SizerItem>
                                <SizerItem pos={[6, 2]} flag={CV | wxRIGHT} border={5}>
                                  <StaticText label={p.m_orientation.units} />
                                </SizerItem>
                                {row(8, p.m_textSize)}
                                {row(10, p.m_marginX)}
                                {row(11, p.m_marginY)}
                                <SizerItem
                                  pos={[0, 4]}
                                  span={[6, 1]}
                                  flag={wxALL | wxEXPAND}
                                  border={5}
                                >
                                  <RadioBox
                                    label={_('Code')}
                                    choices={p.m_barcode.choices}
                                    selection={p.m_barcode.selection}
                                    onChange={p.m_barcode.onChange}
                                  />
                                </SizerItem>
                                <SizerItem
                                  pos={[6, 4]}
                                  span={[6, 1]}
                                  flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT}
                                  border={5}
                                >
                                  <RadioBox
                                    label={_('Error Correction')}
                                    choices={p.m_errorCorrection.choices}
                                    selection={p.m_errorCorrection.selection}
                                    onChange={p.m_errorCorrection.onChange}
                                    disabled={!p.m_errorCorrection.enabled}
                                    itemEnabled={p.m_errorCorrection.itemEnabled}
                                  />
                                </SizerItem>
                              </GridBagSizer>
                            </SizerItem>
                          </BoxSizer>
                        </SizerItem>
                      </BoxSizer>
                    </SizerItem>
                    <SizerItem proportion={1} flag={wxEXPAND | wxLEFT} border={10}>
                      {/* bSizerDisplayPad */}
                      <BoxSizer orient={wxVERTICAL}>
                        <SizerItem
                          proportion={12}
                          flag={wxEXPAND | wxALL}
                          border={5}
                          minSize={[280, -1]}
                        >
                          {p.m_panelShowBarcodeGal}
                        </SizerItem>
                      </BoxSizer>
                    </SizerItem>
                  </BoxSizer>
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
