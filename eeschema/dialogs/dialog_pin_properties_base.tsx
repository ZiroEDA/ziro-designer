// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_PIN_PROPERTIES_BASE` (eeschema/dialogs/dialog_pin_properties_base.cpp): the sizer tree,
 * Add() for Add(). The behaviour is DIALOG_PIN_PROPERTIES's (dialog_pin_properties.tsx).
 */
import type { JSX, ReactNode, RefObject } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import type { ELECTRICAL_PINTYPE, GRAPHIC_PINSHAPE } from '@ziroeda/common/pin_type.js';
import { StdBitmapButton } from '@ziroeda/common/widgets/std_bitmap_button.js';
import { WxCollapsiblePane } from '@ziroeda/common/widgets/wx_collapsible_pane.js';
import { Infobar } from '@ziroeda/common/widgets/wx_infobar.js';
import { Combo } from '@ziroeda/wx/combobox.js';
import { CheckBox, Panel, StaticText, TextCtrl } from '@ziroeda/wx/controls.js';
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
import { PinShapeComboBox } from '../widgets/pinshape_combobox.js';
import { PinTypeComboBox } from '../widgets/pintype_combobox.js';
import { _ } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

/** A checkbox's value and whether it is enabled, with its tooltip. */
export interface PIN_DIALOG_CHECK {
  value: boolean;
  enabled: boolean;
  tooltip?: string;
}

export interface DIALOG_PIN_PROPERTIES_BASE_PROPS {
  /** `m_infoBar`: its message and its hyperlink button, or null while hidden. */
  infoBar: { message: string; actionLabel?: string; onAction?: () => void } | null;
  m_textPinName: string;
  onPinName: (aText: string) => void;
  m_textPinNumber: string;
  onPinNumber: (aText: string) => void;
  /** `SetInitialFocus( aFocusPinNumber ? m_textPinNumber : m_textPinName )`. */
  initialFocus?: RefObject<HTMLInputElement>;
  nameRef?: RefObject<HTMLInputElement>;
  numberRef?: RefObject<HTMLInputElement>;
  m_choiceElectricalType: ELECTRICAL_PINTYPE;
  onElectricalType: (aType: ELECTRICAL_PINTYPE) => void;
  m_choiceStyle: GRAPHIC_PINSHAPE;
  onStyle: (aShape: GRAPHIC_PINSHAPE) => void;
  /** `m_choiceOrientation`: the orientation names with their icons, and the selected index. */
  orientationOptions: readonly { value: string; label: string; bitmap?: string }[];
  m_choiceOrientation: number;
  onOrientation: (aIndex: number) => void;
  /** The UNIT_BINDERs' texts, and the frame's units they are labelled with. */
  m_posXCtrl: string;
  onPosX: (aText: string) => void;
  m_posYCtrl: string;
  onPosY: (aText: string) => void;
  m_pinLengthCtrl: string;
  onPinLength: (aText: string) => void;
  m_nameSizeCtrl: string;
  onNameSize: (aText: string) => void;
  m_numberSizeCtrl: string;
  onNumberSize: (aText: string) => void;
  units: string;
  m_checkApplyToAllParts: PIN_DIALOG_CHECK;
  onApplyToAllParts: (aChecked: boolean) => void;
  m_checkApplyToAllBodyStyles: PIN_DIALOG_CHECK;
  onApplyToAllBodyStyles: (aChecked: boolean) => void;
  m_checkShow: PIN_DIALOG_CHECK;
  onShow: (aChecked: boolean) => void;
  /** `m_panelShowPin`'s contents: the SYMBOL_PREVIEW_WIDGET. */
  m_panelShowPin: ReactNode;
  m_alternatesTurndown: { collapsed: boolean; enabled: boolean; tooltip?: string };
  onCollapsiblePaneChange: (aCollapsed: boolean) => void;
  /** `m_alternatesGrid`. */
  m_alternatesGrid: ReactNode;
  onAddAlternate: () => void;
  onDeleteAlternate: () => void;
  onOK: () => void;
  onCancel: () => void;
}

export function DIALOG_PIN_PROPERTIES_BASE(p: DIALOG_PIN_PROPERTIES_BASE_PROPS): JSX.Element {
  const check = (
    aLabel: string,
    aCheck: PIN_DIALOG_CHECK,
    aOnChange: (aChecked: boolean) => void,
  ) => (
    <CheckBox
      label={aLabel}
      checked={aCheck.value}
      disabled={!aCheck.enabled}
      onChange={aOnChange}
      title={aCheck.tooltip}
    />
  );

  return (
    <DialogShim title={_('Pin Properties')} onClose={p.onCancel} initialFocus={p.initialFocus}>
      {/* mainSizer */}
      <BoxSizer orient={wxVERTICAL}>
        {p.infoBar !== null && (
          <SizerItem flag={wxEXPAND} border={5}>
            <Infobar
              message={p.infoBar.message}
              icon="information"
              {...(p.infoBar.actionLabel === undefined
                ? {}
                : { actionLabel: p.infoBar.actionLabel, onAction: p.infoBar.onAction })}
            />
          </SizerItem>
        )}
        <SizerItem flag={wxEXPAND | wxRIGHT | wxLEFT} border={5}>
          {/* bUpperSizer */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem proportion={1} flag={wxEXPAND | wxALL} border={15}>
              {/* bLeftSizer */}
              <BoxSizer orient={wxVERTICAL}>
                <SizerItem proportion={1} flag={wxEXPAND} border={5}>
                  {/* gbSizer1 = wxGridBagSizer( 5, 5 ), AddGrowableCol( 1 ) */}
                  <GridBagSizer vgap={5} hgap={5} growableCols={[1]}>
                    <SizerItem pos={[0, 0]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
                      <StaticText label={_('Pin name:')} />
                    </SizerItem>
                    <SizerItem
                      pos={[0, 1]}
                      span={[1, 2]}
                      flag={wxALIGN_CENTER_VERTICAL | wxEXPAND}
                      border={5}
                    >
                      <TextCtrl
                        value={p.m_textPinName}
                        onChange={p.onPinName}
                        inputRef={p.nameRef}
                        ariaLabel="Pin name"
                      />
                    </SizerItem>
                    <SizerItem pos={[1, 0]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
                      <StaticText
                        label={_('Pin number:')}
                        title={_('Pin number: 1 to 4 ASCII letters and/or digits')}
                      />
                    </SizerItem>
                    <SizerItem
                      pos={[1, 1]}
                      span={[1, 2]}
                      flag={wxALIGN_CENTER_VERTICAL | wxEXPAND}
                      border={5}
                    >
                      <TextCtrl
                        value={p.m_textPinNumber}
                        onChange={p.onPinNumber}
                        inputRef={p.numberRef}
                        ariaLabel="Pin number"
                      />
                    </SizerItem>
                    <SizerItem pos={[2, 0]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
                      <StaticText label={_('Electrical type:')} title={_('Used by the ERC.')} />
                    </SizerItem>
                    <SizerItem
                      pos={[2, 1]}
                      span={[1, 2]}
                      flag={wxALIGN_CENTER_VERTICAL | wxEXPAND}
                      border={5}
                    >
                      <PinTypeComboBox
                        value={p.m_choiceElectricalType}
                        onChange={p.onElectricalType}
                        ariaLabel="Electrical type"
                      />
                    </SizerItem>
                    <SizerItem pos={[3, 0]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
                      <StaticText label={_('Graphic style:')} />
                    </SizerItem>
                    <SizerItem
                      pos={[3, 1]}
                      span={[1, 2]}
                      flag={wxALIGN_CENTER_VERTICAL | wxEXPAND}
                      border={5}
                    >
                      <PinShapeComboBox
                        value={p.m_choiceStyle}
                        onChange={p.onStyle}
                        ariaLabel="Graphic style"
                      />
                    </SizerItem>
                    <SizerItem pos={[4, 0]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
                      <StaticText label={_('X position:')} />
                    </SizerItem>
                    <SizerItem
                      pos={[4, 1]}
                      flag={wxALIGN_CENTER_VERTICAL | wxEXPAND}
                      border={5}
                      minSize={[110, -1]}
                    >
                      <TextCtrl value={p.m_posXCtrl} onChange={p.onPosX} ariaLabel="X position" />
                    </SizerItem>
                    <SizerItem pos={[4, 2]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
                      <StaticText label={p.units} />
                    </SizerItem>
                    <SizerItem pos={[5, 0]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
                      <StaticText label={_('Y position:')} />
                    </SizerItem>
                    <SizerItem pos={[5, 1]} flag={wxALIGN_CENTER_VERTICAL | wxEXPAND} border={5}>
                      <TextCtrl value={p.m_posYCtrl} onChange={p.onPosY} ariaLabel="Y position" />
                    </SizerItem>
                    <SizerItem pos={[5, 2]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
                      <StaticText label={p.units} />
                    </SizerItem>
                    <SizerItem pos={[6, 0]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
                      <StaticText label={_('Orientation:')} />
                    </SizerItem>
                    <SizerItem
                      pos={[6, 1]}
                      span={[1, 2]}
                      flag={wxALIGN_CENTER_VERTICAL | wxEXPAND}
                      border={5}
                    >
                      {/* WX_BITMAP_COMBOBOX */}
                      <Combo
                        value={String(p.m_choiceOrientation)}
                        options={p.orientationOptions}
                        onChange={(v) => p.onOrientation(Number(v))}
                        ariaLabel="Orientation"
                      />
                    </SizerItem>
                    <SizerItem pos={[7, 0]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
                      <StaticText label={_('Pin length:')} />
                    </SizerItem>
                    <SizerItem pos={[7, 1]} flag={wxALIGN_CENTER_VERTICAL | wxEXPAND} border={5}>
                      <TextCtrl
                        value={p.m_pinLengthCtrl}
                        onChange={p.onPinLength}
                        ariaLabel={_HKI('Pin length')}
                      />
                    </SizerItem>
                    <SizerItem pos={[7, 2]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
                      <StaticText label={p.units} />
                    </SizerItem>
                    <SizerItem pos={[8, 0]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
                      <StaticText label={_('Name text size:')} />
                    </SizerItem>
                    <SizerItem pos={[8, 1]} flag={wxALIGN_CENTER_VERTICAL | wxEXPAND} border={5}>
                      <TextCtrl
                        value={p.m_nameSizeCtrl}
                        onChange={p.onNameSize}
                        ariaLabel="Name text size"
                      />
                    </SizerItem>
                    <SizerItem pos={[8, 2]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
                      <StaticText label={p.units} />
                    </SizerItem>
                    <SizerItem pos={[9, 0]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
                      <StaticText label={_('Number text size:')} />
                    </SizerItem>
                    <SizerItem pos={[9, 1]} flag={wxALIGN_CENTER_VERTICAL | wxEXPAND} border={5}>
                      <TextCtrl
                        value={p.m_numberSizeCtrl}
                        onChange={p.onNumberSize}
                        ariaLabel="Number text size"
                      />
                    </SizerItem>
                    <SizerItem pos={[9, 2]} flag={wxALIGN_CENTER_VERTICAL} border={5}>
                      <StaticText label={p.units} />
                    </SizerItem>
                  </GridBagSizer>
                </SizerItem>
              </BoxSizer>
            </SizerItem>
            <SizerItem proportion={1} flag={wxEXPAND | wxALL} border={15}>
              {/* bRightSizer */}
              <BoxSizer orient={wxVERTICAL}>
                <SizerItem flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
                  {/* checkboxesSizer */}
                  <BoxSizer orient={wxVERTICAL}>
                    <SizerItem flag={wxBOTTOM} border={3}>
                      {check(
                        _('Common to all units in symbol'),
                        p.m_checkApplyToAllParts,
                        p.onApplyToAllParts,
                      )}
                    </SizerItem>
                    <SizerItem flag={wxBOTTOM} border={3}>
                      {check(
                        _('Common to all body styles'),
                        p.m_checkApplyToAllBodyStyles,
                        p.onApplyToAllBodyStyles,
                      )}
                    </SizerItem>
                    <SizerItem flag={wxEXPAND | wxTOP | wxBOTTOM} border={5}>
                      <Spacer width={0} height={0} />
                    </SizerItem>
                    <SizerItem flag={wxBOTTOM} border={3}>
                      {check('Visible', p.m_checkShow, p.onShow)}
                    </SizerItem>
                  </BoxSizer>
                </SizerItem>
                <SizerItem flag={wxTOP | wxRIGHT | wxLEFT} border={5}>
                  <StaticText label={_('Preview:')} />
                </SizerItem>
                <SizerItem proportion={1} flag={wxEXPAND | wxLEFT} border={5} minSize={[150, 150]}>
                  {/* m_panelShowPin: wxBORDER_SIMPLE */}
                  <Panel border="simple">{p.m_panelShowPin}</Panel>
                </SizerItem>
              </BoxSizer>
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem proportion={1} flag={wxEXPAND | wxLEFT} border={10}>
          {/* bLowerSizer */}
          <BoxSizer orient={wxVERTICAL}>
            <SizerItem proportion={1} flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
              <WxCollapsiblePane
                label={_('Alternate pin function definitions')}
                collapsed={p.m_alternatesTurndown.collapsed}
                disabled={!p.m_alternatesTurndown.enabled}
                title={p.m_alternatesTurndown.tooltip}
                onChange={p.onCollapsiblePaneChange}
              >
                {/* bAlternatesSizer */}
                <BoxSizer orient={wxVERTICAL}>
                  <SizerItem proportion={1} flag={wxEXPAND | wxRIGHT} border={5}>
                    {/* bRightMargin */}
                    <BoxSizer orient={wxVERTICAL}>
                      <SizerItem
                        proportion={1}
                        flag={wxEXPAND | wxRIGHT | wxLEFT}
                        border={5}
                        minSize={[-1, 100]}
                      >
                        {p.m_alternatesGrid}
                      </SizerItem>
                    </BoxSizer>
                  </SizerItem>
                  <SizerItem flag={wxTOP} border={5}>
                    {/* bButtonSizer */}
                    <BoxSizer orient={wxHORIZONTAL}>
                      <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
                        <StdBitmapButton
                          bitmap="small_plus"
                          title="Add alternate"
                          tooltip={null}
                          onClick={p.onAddAlternate}
                        />
                      </SizerItem>
                      <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                        <Spacer width={20} height={0} />
                      </SizerItem>
                      <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
                        <StdBitmapButton
                          bitmap="small_trash"
                          title="Delete alternate"
                          tooltip={null}
                          onClick={p.onDeleteAlternate}
                        />
                      </SizerItem>
                    </BoxSizer>
                  </SizerItem>
                </BoxSizer>
              </WxCollapsiblePane>
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxALL | wxEXPAND} border={5}>
          {/* m_sdbSizerButtons: OK, Cancel */}
          <StdDialogButtonSizer onOk={p.onOK} onCancel={p.onCancel} />
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
