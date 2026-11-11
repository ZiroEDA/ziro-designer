// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_LIB_NEW_SYMBOL_BASE` (eeschema/dialogs/dialog_lib_new_symbol_base.cpp): the sizer tree,
 * Add() for Add(). The behaviour is DIALOG_LIB_NEW_SYMBOL's (dialog_lib_new_symbol.tsx).
 */
import type { JSX, RefObject } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { Infobar } from '@ziroeda/common/widgets/wx_infobar.js';
import { CheckBox, StaticText, TextCtrl } from '@ziroeda/wx/controls.js';
import {
  wxALIGN_CENTER_VERTICAL,
  wxALL,
  wxBOTTOM,
  wxEXPAND,
  wxLEFT,
  wxRIGHT,
  wxTOP,
  wxVERTICAL,
} from '@ziroeda/wx/defs.js';
import { BoxSizer, FlexGridSizer, SizerItem, StdDialogButtonSizer } from '@ziroeda/wx/sizer.js';
import { SpinCtrl } from '@ziroeda/wx/spin_ctrl.js';
import { SymbolFilterComboBox } from '../widgets/symbol_filter_combobox.js';
import { _ } from '@ziroeda/wx/translation.js';

/** A control's value and, after DIALOG_LIB_NEW_SYMBOL's handlers, whether it is enabled. */
export interface NEW_SYMBOL_CONTROL<T> {
  value: T;
  enabled: boolean;
}

export interface DIALOG_LIB_NEW_SYMBOL_BASE_PROPS {
  /** `m_infoBar->ShowMessage( …, wxICON_INFORMATION )`, or null when dismissed. */
  infoBarMessage: string | null;
  m_textName: string;
  onName: (aText: string) => void;
  /** `m_textName->SetFocus()`. */
  nameRef?: RefObject<HTMLInputElement>;
  /** `m_comboInheritanceSelect`: its string list, and the string it shows. */
  symbolNames: readonly string[];
  m_comboInheritanceSelect: string;
  onParentSymbolSelect: (aSelected: string) => void;
  m_textReference: NEW_SYMBOL_CONTROL<string>;
  onReference: (aText: string) => void;
  m_spinPartCount: NEW_SYMBOL_CONTROL<number>;
  onPartCount: (aValue: number) => void;
  m_checkUnitsInterchangeable: NEW_SYMBOL_CONTROL<boolean>;
  onUnitsInterchangeable: (aChecked: boolean) => void;
  m_checkHasAlternateBodyStyle: NEW_SYMBOL_CONTROL<boolean>;
  onAlternateBodyStyle: (aChecked: boolean) => void;
  m_checkIsPowerSymbol: NEW_SYMBOL_CONTROL<boolean>;
  onPowerCheckBox: (aChecked: boolean) => void;
  m_excludeFromBomCheckBox: NEW_SYMBOL_CONTROL<boolean>;
  onExcludeFromBom: (aChecked: boolean) => void;
  m_excludeFromBoardCheckBox: NEW_SYMBOL_CONTROL<boolean>;
  onExcludeFromBoard: (aChecked: boolean) => void;
  m_checkKeepDatasheet: NEW_SYMBOL_CONTROL<boolean>;
  onKeepDatasheet: (aChecked: boolean) => void;
  m_checkKeepFootprint: NEW_SYMBOL_CONTROL<boolean>;
  onKeepFootprint: (aChecked: boolean) => void;
  m_checkTransferUserFields: NEW_SYMBOL_CONTROL<boolean>;
  onCheckTransferUserFields: (aChecked: boolean) => void;
  m_checkKeepContentUserFields: NEW_SYMBOL_CONTROL<boolean>;
  onKeepContentUserFields: (aChecked: boolean) => void;
  /** `m_textPinTextPosition`, through its UNIT_BINDER; `units` is m_staticPinTextPositionUnits. */
  m_textPinTextPosition: NEW_SYMBOL_CONTROL<string>;
  onPinTextPosition: (aText: string) => void;
  units: string;
  m_checkShowPinNumber: NEW_SYMBOL_CONTROL<boolean>;
  onShowPinNumber: (aChecked: boolean) => void;
  m_checkShowPinName: NEW_SYMBOL_CONTROL<boolean>;
  onShowPinName: (aChecked: boolean) => void;
  m_checkShowPinNameInside: NEW_SYMBOL_CONTROL<boolean>;
  onShowPinNameInside: (aChecked: boolean) => void;
  onOK: () => void;
  onCancel: () => void;
}

export function DIALOG_LIB_NEW_SYMBOL_BASE(p: DIALOG_LIB_NEW_SYMBOL_BASE_PROPS): JSX.Element {
  const check = (
    aLabel: string,
    aControl: NEW_SYMBOL_CONTROL<boolean>,
    aOnChange: (aChecked: boolean) => void,
    aTitle?: string,
  ) => (
    <CheckBox
      label={aLabel}
      checked={aControl.value}
      disabled={!aControl.enabled}
      onChange={aOnChange}
      title={aTitle}
    />
  );

  return (
    // onParentSymbolSelect ends `Fit()`: "The banner changes the size of the dialog box".
    <DialogShim
      title={_('New Symbol')}
      onClose={p.onCancel}
      initialFocus={p.nameRef}
      fitKey={p.m_comboInheritanceSelect}
    >
      {/* bSizerMain */}
      <BoxSizer orient={wxVERTICAL}>
        {p.infoBarMessage !== null && (
          <SizerItem flag={wxBOTTOM | wxEXPAND} border={5}>
            <Infobar message={p.infoBarMessage} icon="information" />
          </SizerItem>
        )}
        <SizerItem flag={wxALL | wxEXPAND} border={5}>
          {/* bSizerTop */}
          <BoxSizer orient={wxVERTICAL}>
            <SizerItem proportion={1} flag={wxALL | wxEXPAND} border={5}>
              {/* fgSizer31 = wxFlexGridSizer( 0, 2, 6, 6 ), AddGrowableCol( 1 ) */}
              <FlexGridSizer cols={2} vgap={6} hgap={6} growableCols={[1]}>
                <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                  <StaticText
                    label={_('Symbol name:')}
                    title={
                      'The symbol name in library and also the default\n' +
                      'symbol value when loaded in the schematic.'
                    }
                  />
                </SizerItem>
                <SizerItem proportion={1} flag={wxALIGN_CENTER_VERTICAL | wxEXPAND} border={5}>
                  <TextCtrl
                    value={p.m_textName}
                    onChange={p.onName}
                    inputRef={p.nameRef}
                    ariaLabel={_('Symbol name')}
                  />
                </SizerItem>
                <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                  <StaticText label={_('Derive from existing symbol:')} />
                </SizerItem>
                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxEXPAND} border={5}>
                  <SymbolFilterComboBox
                    stringList={p.symbolNames}
                    value={p.m_comboInheritanceSelect}
                    onChange={p.onParentSymbolSelect}
                    ariaLabel="Derive from existing symbol"
                  />
                </SizerItem>
                <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                  <StaticText
                    label={_('Default reference designator:')}
                    disabled={!p.m_textReference.enabled}
                  />
                </SizerItem>
                <SizerItem flag={wxEXPAND} border={5}>
                  <TextCtrl
                    value={p.m_textReference.value}
                    onChange={p.onReference}
                    disabled={!p.m_textReference.enabled}
                    ariaLabel="Default reference designator"
                  />
                </SizerItem>
                <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                  <StaticText
                    label={_('Number of units per package:')}
                    disabled={!p.m_spinPartCount.enabled}
                  />
                </SizerItem>
                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxEXPAND} border={5}>
                  {/* wxSP_ARROW_KEYS, 1, 64, 0 */}
                  <SpinCtrl
                    value={p.m_spinPartCount.value}
                    onChange={p.onPartCount}
                    min={1}
                    max={64}
                    disabled={!p.m_spinPartCount.enabled}
                    ariaLabel="Number of units per package"
                  />
                </SizerItem>
              </FlexGridSizer>
            </SizerItem>
            <SizerItem flag={wxBOTTOM | wxEXPAND} border={5}>
              {/* bSizer17 */}
              <BoxSizer orient={wxVERTICAL}>
                <SizerItem flag={wxRIGHT | wxLEFT} border={5}>
                  {check(
                    _('All units are interchangeable'),
                    p.m_checkUnitsInterchangeable,
                    p.onUnitsInterchangeable,
                    _(
                      'Check this option when all symbol units are identical except\nfor pin numbers.',
                    ),
                  )}
                </SizerItem>
                <SizerItem flag={wxTOP | wxRIGHT | wxLEFT} border={5}>
                  {check(
                    _('Create symbol with alternate body style (De Morgan)'),
                    p.m_checkHasAlternateBodyStyle,
                    p.onAlternateBodyStyle,
                  )}
                </SizerItem>
                <SizerItem flag={wxTOP | wxRIGHT | wxLEFT} border={5}>
                  {check(
                    _('Create symbol as power symbol'),
                    p.m_checkIsPowerSymbol,
                    p.onPowerCheckBox,
                  )}
                </SizerItem>
                <SizerItem flag={wxLEFT | wxRIGHT | wxTOP} border={5}>
                  {check(
                    _('Exclude from bill of materials'),
                    p.m_excludeFromBomCheckBox,
                    p.onExcludeFromBom,
                  )}
                </SizerItem>
                <SizerItem flag={wxLEFT | wxRIGHT | wxTOP} border={5}>
                  {check(
                    _('Exclude from board'),
                    p.m_excludeFromBoardCheckBox,
                    p.onExcludeFromBoard,
                  )}
                </SizerItem>
                <SizerItem flag={wxLEFT | wxRIGHT | wxTOP} border={5}>
                  {check(_('Keep linked datasheet'), p.m_checkKeepDatasheet, p.onKeepDatasheet)}
                </SizerItem>
                <SizerItem flag={wxLEFT | wxRIGHT | wxTOP} border={5}>
                  {check(_('Keep linked footprint'), p.m_checkKeepFootprint, p.onKeepFootprint)}
                </SizerItem>
                <SizerItem flag={wxLEFT | wxRIGHT | wxTOP} border={5}>
                  {check(
                    _('Transfer user-defined fields'),
                    p.m_checkTransferUserFields,
                    p.onCheckTransferUserFields,
                  )}
                </SizerItem>
                <SizerItem flag={wxLEFT | wxRIGHT | wxTOP} border={5}>
                  {check(
                    _('Keep content of user-defined fields'),
                    p.m_checkKeepContentUserFields,
                    p.onKeepContentUserFields,
                  )}
                </SizerItem>
              </BoxSizer>
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem proportion={1} flag={wxALL | wxEXPAND} border={5}>
          {/* bSizerBottom */}
          <BoxSizer orient={wxVERTICAL}>
            <SizerItem flag={wxALL | wxEXPAND} border={5}>
              {/* fgSizer4 = wxFlexGridSizer( 0, 3, 6, 6 ), AddGrowableCol( 1 ) */}
              <FlexGridSizer cols={3} vgap={6} hgap={6} growableCols={[1]}>
                <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                  <StaticText
                    label={_('Pin name position offset:')}
                    disabled={!p.m_textPinTextPosition.enabled}
                  />
                </SizerItem>
                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxEXPAND} border={5}>
                  <TextCtrl
                    value={p.m_textPinTextPosition.value}
                    onChange={p.onPinTextPosition}
                    disabled={!p.m_textPinTextPosition.enabled}
                    ariaLabel="Pin name position offset"
                  />
                </SizerItem>
                <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                  <StaticText label={p.units} disabled={!p.m_textPinTextPosition.enabled} />
                </SizerItem>
              </FlexGridSizer>
            </SizerItem>
            <SizerItem flag={wxEXPAND} border={5}>
              {/* bSizer19 */}
              <BoxSizer orient={wxVERTICAL}>
                <SizerItem flag={wxRIGHT | wxLEFT} border={5}>
                  {check(_('Show pin number text'), p.m_checkShowPinNumber, p.onShowPinNumber)}
                </SizerItem>
                <SizerItem flag={wxTOP | wxRIGHT | wxLEFT} border={5}>
                  {check(_('Show pin name text'), p.m_checkShowPinName, p.onShowPinName)}
                </SizerItem>
                <SizerItem flag={wxLEFT | wxRIGHT | wxTOP} border={5}>
                  {check(_('Pin name inside'), p.m_checkShowPinNameInside, p.onShowPinNameInside)}
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
