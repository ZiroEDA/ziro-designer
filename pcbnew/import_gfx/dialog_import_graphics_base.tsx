// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_IMPORT_GRAPHICS_BASE` (pcbnew/import_gfx/dialog_import_graphics_base.cpp): the sizer
 * tree, Add() for Add(). The members are props; the behaviour is DIALOG_IMPORT_GRAPHICS's
 * (dialog_import_graphics.tsx).
 */
import type { JSX } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { StdBitmapButton } from '@ziroeda/common/widgets/std_bitmap_button.js';
import { Combo, type ComboOption } from '@ziroeda/wx/combobox.js';
import {
  type CHECK,
  type CHOICE,
  CheckBox,
  Choice,
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
  GridBagSizer,
  SizerItem,
  Spacer,
  StdDialogButtonSizer,
} from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

type ENTRY = {
  value: string;
  enabled?: boolean;
  onChange: (aText: string) => void;
  onBlur?: () => void;
};

export interface DIALOG_IMPORT_GRAPHICS_BASE_PROPS {
  m_textCtrlFileName: ENTRY;
  onBrowseFiles: () => void;
  m_importScaleCtrl: ENTRY;
  /** m_defaultLineWidth's text, and onFilename's Enable() for a DXF. */
  m_lineWidthCtrl: ENTRY;
  units: string;
  m_dxfUnitsChoice: CHOICE & { choices: readonly string[] };
  m_placeAtCheckbox: CHECK;
  m_xCtrl: ENTRY;
  m_yCtrl: ENTRY;
  m_setLayerCheckbox: CHECK;
  m_SelLayerBox: {
    rows: readonly ComboOption[];
    value: string;
    enabled: boolean;
    onChange: (aLayer: string) => void;
  };
  m_cbGroupItems: CHECK;
  m_rbFixDiscontinuities: CHECK;
  m_toleranceCtrl: ENTRY;
  onOK: () => void;
  onCancel: () => void;
}

const CV = wxALIGN_CENTER_VERTICAL;
const FILE_TIP = _HKI('Only vectors will be imported.  Bitmaps and fonts will be ignored.');

export function DIALOG_IMPORT_GRAPHICS_BASE(p: DIALOG_IMPORT_GRAPHICS_BASE_PROPS): JSX.Element {
  const dxf = p.m_lineWidthCtrl.enabled !== false;
  const placeAt = p.m_xCtrl.enabled !== false;
  const tolerance = p.m_toleranceCtrl.enabled !== false;

  return (
    <DialogShim title={_('Import Vector Graphics File')} onClose={p.onCancel}>
      {/* bSizerMain */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem flag={wxBOTTOM | wxEXPAND | wxLEFT | wxRIGHT | wxTOP} border={10}>
          {/* bSizerFile */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem flag={CV | wxRIGHT} border={5}>
              <StaticText label={_('File:')} title={FILE_TIP} />
            </SizerItem>
            <SizerItem proportion={1} flag={CV | wxLEFT} border={5} minSize={[300, -1]}>
              <TextCtrl
                autoFocus
                value={p.m_textCtrlFileName.value}
                onChange={p.m_textCtrlFileName.onChange}
                title={FILE_TIP}
                ariaLabel={_('File')}
              />
            </SizerItem>
            <SizerItem flag={CV} border={5}>
              <StdBitmapButton
                bitmap="small_folder"
                title={_('Browse')}
                tooltip={null}
                onClick={p.onBrowseFiles}
              />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
          {/* fgSizer3 = wxFlexGridSizer( 0, 3, 5, 3 ) */}
          <FlexGridSizer cols={3} vgap={5} hgap={3} growableCols={[1]}>
            <SizerItem flag={CV | wxLEFT} border={5}>
              <StaticText label={_('Import scale:')} />
            </SizerItem>
            <SizerItem flag={CV} border={5} minSize={[120, -1]}>
              <TextCtrl
                value={p.m_importScaleCtrl.value}
                onChange={p.m_importScaleCtrl.onChange}
                ariaLabel={_('Import scale')}
              />
            </SizerItem>
            <Spacer width={0} height={0} proportion={1} flag={wxEXPAND} border={5} />
            <SizerItem flag={CV | wxLEFT} border={5}>
              <StaticText
                label={_('DXF default line width:')}
                title={_('Used when the DXF items in file have no line thickness set')}
                disabled={!dxf}
              />
            </SizerItem>
            <SizerItem flag={CV | wxEXPAND} border={5}>
              <TextCtrl
                value={p.m_lineWidthCtrl.value}
                onChange={p.m_lineWidthCtrl.onChange}
                onBlur={p.m_lineWidthCtrl.onBlur}
                disabled={!dxf}
                ariaLabel={_('DXF default line width')}
              />
            </SizerItem>
            <SizerItem flag={CV | wxRIGHT} border={5}>
              <StaticText label={p.units} disabled={!dxf} />
            </SizerItem>
            <SizerItem flag={CV | wxLEFT} border={5}>
              <StaticText
                label={_('DXF default units:')}
                title={_('Used when the DXF file has no unit set')}
                disabled={!dxf}
              />
            </SizerItem>
            <SizerItem flag={CV | wxEXPAND} border={5}>
              <Choice
                choices={p.m_dxfUnitsChoice.choices}
                choice={p.m_dxfUnitsChoice}
                ariaLabel={_('DXF default units')}
              />
            </SizerItem>
          </FlexGridSizer>
        </SizerItem>
        <Spacer width={0} height={5} flag={wxEXPAND} border={5} />
        <SizerItem flag={wxEXPAND | wxALL} border={5}>
          <StaticLine />
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={5}>
          {/* gbSizer2 */}
          <GridBagSizer vgap={0} hgap={0} growableCols={[2, 4]}>
            <SizerItem pos={[0, 0]} flag={CV | wxLEFT} border={5}>
              <CheckBox
                label={_('Place at:')}
                check={p.m_placeAtCheckbox}
                title={_('If not checked: use interactive placement.')}
              />
            </SizerItem>
            <SizerItem pos={[0, 1]} flag={CV | wxALL} border={5}>
              <StaticText label="X:" disabled={!placeAt} />
            </SizerItem>
            <SizerItem pos={[0, 2]} flag={CV | wxEXPAND} border={5}>
              <TextCtrl
                value={p.m_xCtrl.value}
                onChange={p.m_xCtrl.onChange}
                onBlur={p.m_xCtrl.onBlur}
                disabled={!placeAt}
                maxLength={10}
                title={_('DXF origin on PCB Grid, X Coordinate')}
                ariaLabel="X"
              />
            </SizerItem>
            <SizerItem pos={[0, 3]} flag={CV | wxLEFT} border={18}>
              <StaticText label="Y:" disabled={!placeAt} />
            </SizerItem>
            <SizerItem pos={[0, 4]} flag={CV | wxEXPAND | wxLEFT} border={5}>
              <TextCtrl
                value={p.m_yCtrl.value}
                onChange={p.m_yCtrl.onChange}
                onBlur={p.m_yCtrl.onBlur}
                disabled={!placeAt}
                maxLength={10}
                title={_('DXF origin on PCB Grid, Y Coordinate')}
                ariaLabel="Y"
              />
            </SizerItem>
            <SizerItem pos={[0, 5]} flag={CV | wxRIGHT | wxLEFT} border={5}>
              <StaticText label={p.units} disabled={!placeAt} />
            </SizerItem>
            <SizerItem pos={[1, 0]} flag={CV | wxLEFT} border={5}>
              <CheckBox
                label={_('Layer:')}
                check={p.m_setLayerCheckbox}
                title={_(
                  'If checked, use the selected layer in this dialog\nIf unchecked, use the Board Editor active layer',
                )}
              />
            </SizerItem>
            <SizerItem pos={[1, 2]} span={[1, 3]} flag={wxEXPAND | CV} border={5}>
              <Combo
                value={p.m_SelLayerBox.value}
                options={p.m_SelLayerBox.rows}
                disabled={!p.m_SelLayerBox.enabled}
                onChange={p.m_SelLayerBox.onChange}
                ariaLabel="Layer"
              />
            </SizerItem>
          </GridBagSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
          {/* bSizerGroupOpt */}
          <BoxSizer orient={wxVERTICAL}>
            <SizerItem flag={wxTOP | wxBOTTOM | wxLEFT} border={5}>
              <CheckBox
                label={_('Group imported items')}
                check={p.m_cbGroupItems}
                title={_('Add all imported items to a new group')}
              />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxALL} border={5}>
          <StaticLine />
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxRIGHT | wxLEFT} border={10}>
          {/* bSizer11 */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem flag={CV} border={5}>
              <CheckBox
                label={_('Fix discontinuities')}
                check={p.m_rbFixDiscontinuities}
                title={_(
                  'Trim/extend open shapes or add segments to make vertices of shapes coincide',
                )}
              />
            </SizerItem>
            <SizerItem flag={wxLEFT | CV} border={30}>
              <StaticText label={_('Tolerance:')} disabled={!tolerance} />
            </SizerItem>
            <SizerItem flag={CV | wxTOP | wxBOTTOM | wxLEFT} border={5}>
              <TextCtrl
                value={p.m_toleranceCtrl.value}
                onChange={p.m_toleranceCtrl.onChange}
                onBlur={p.m_toleranceCtrl.onBlur}
                disabled={!tolerance}
                ariaLabel="Tolerance"
              />
            </SizerItem>
            <SizerItem flag={CV | wxLEFT | wxRIGHT} border={5}>
              <StaticText label={p.units} disabled={!tolerance} />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <Spacer width={0} height={3} proportion={1} flag={wxEXPAND} border={5} />
        <SizerItem flag={wxEXPAND | wxALL} border={5}>
          <StdDialogButtonSizer onOk={p.onOK} onCancel={p.onCancel} />
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
