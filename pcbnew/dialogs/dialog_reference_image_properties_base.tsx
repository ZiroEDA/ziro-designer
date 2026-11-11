// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_REFERENCE_IMAGE_PROPERTIES_BASE`
 * (pcbnew/dialogs/dialog_reference_image_properties_base.cpp): the sizer tree, Add() for Add().
 * The members are props; the behaviour is DIALOG_REFERENCE_IMAGE_PROPERTIES's
 * (dialog_reference_image_properties.tsx).
 *
 * The grid bag is upstream's as it stands: the layer is row 2, Height row 3 and Width row 4, and
 * the width's unit text sits at (2, 2), on the layer's row, leaving the Width row without one.
 */
import type { JSX, ReactNode } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { Combo, type ComboOption } from '@ziroeda/wx/combobox.js';
import { type CHECK, CheckBox, StaticText, TextCtrl } from '@ziroeda/wx/controls.js';
import {
  wxALIGN_CENTER_VERTICAL,
  wxALL,
  wxBOTTOM,
  wxEXPAND,
  wxLEFT,
  wxRIGHT,
  wxVERTICAL,
} from '@ziroeda/wx/defs.js';
import { BoxSizer, GridBagSizer, SizerItem, StdDialogButtonSizer } from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

/** A UNIT_BINDER over a wxTextCtrl: its label, text and unit. */
export interface UNIT_FIELD {
  label: string;
  value: string;
  units: string;
  onChange: (aText: string) => void;
  onBlur: () => void;
}

export interface DIALOG_REFERENCE_IMAGE_PROPERTIES_BASE_PROPS {
  m_posX: UNIT_FIELD;
  m_posY: UNIT_FIELD;
  m_width: UNIT_FIELD;
  m_height: UNIT_FIELD;
  /** `m_LayerSelectionCtrl`, a PCB_LAYER_BOX_SELECTOR. */
  layerRows: readonly ComboOption[];
  layer: string;
  onLayerChange: (aLayer: string) => void;
  m_cbLocked: CHECK;
  /** `m_cbLocked->Show( false )` in the footprint editor. */
  lockedShown: boolean;
  lockedTip?: string;
  /** What the dialog Add()s to `m_imageSizer`: its PANEL_IMAGE_EDITOR. */
  m_imageEditor: ReactNode;
  onOK: () => void;
  onCancel: () => void;
}

const CV = wxALIGN_CENTER_VERTICAL;

export function DIALOG_REFERENCE_IMAGE_PROPERTIES_BASE(
  p: DIALOG_REFERENCE_IMAGE_PROPERTIES_BASE_PROPS,
): JSX.Element {
  const field = (aRow: number, f: UNIT_FIELD, aName: string): JSX.Element => (
    <>
      <SizerItem pos={[aRow, 0]} flag={CV} border={5}>
        <StaticText label={f.label} />
      </SizerItem>
      <SizerItem pos={[aRow, 1]} flag={CV | wxEXPAND} border={5}>
        <TextCtrl value={f.value} onChange={f.onChange} onBlur={f.onBlur} ariaLabel={aName} />
      </SizerItem>
    </>
  );
  const unit = (aRow: number, f: UNIT_FIELD): JSX.Element => (
    <SizerItem pos={[aRow, 2]} flag={CV} border={5}>
      <StaticText label={f.units} />
    </SizerItem>
  );

  return (
    <DialogShim title={_('Reference Image Properties')} onClose={p.onCancel}>
      {/* bMainSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem flag={wxEXPAND | wxRIGHT | wxLEFT} border={8}>
          {/* bMargins */}
          <BoxSizer orient={wxVERTICAL}>
            <SizerItem flag={wxEXPAND | wxALL} border={5}>
              {/* gbSizer1 = wxGridBagSizer( 3, 5 ), SetEmptyCellSize( wxSize( -1,5 ) ) */}
              <GridBagSizer
                vgap={3}
                hgap={5}
                growableCols={[1]}
                growableRows={[0]}
                emptyCellSize={[-1, 5]}
              >
                {field(0, p.m_posX, _HKI('Position X'))}
                {unit(0, p.m_posX)}
                {field(1, p.m_posY, _HKI('Position Y'))}
                {unit(1, p.m_posY)}
                {field(4, p.m_width, 'Width')}
                {unit(2, p.m_width)}
                {field(3, p.m_height, 'Height')}
                {unit(3, p.m_height)}
                <SizerItem pos={[2, 0]} flag={CV} border={5}>
                  <StaticText label={_('Associated layer:')} />
                </SizerItem>
                <SizerItem pos={[2, 1]} flag={CV | wxEXPAND} border={5}>
                  <Combo
                    value={p.layer}
                    options={p.layerRows}
                    onChange={p.onLayerChange}
                    ariaLabel="Associated layer"
                  />
                </SizerItem>
                <SizerItem pos={[6, 0]} span={[1, 3]} flag={CV} border={5} shown={p.lockedShown}>
                  <CheckBox label={_('Locked')} check={p.m_cbLocked} title={p.lockedTip} />
                </SizerItem>
              </GridBagSizer>
            </SizerItem>
            <SizerItem proportion={1} flag={wxEXPAND} border={5}>
              {/* m_imageSizer */}
              <BoxSizer orient={wxVERTICAL}>{p.m_imageEditor}</BoxSizer>
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
          <StdDialogButtonSizer onOk={p.onOK} onCancel={p.onCancel} />
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
