// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_LIB_SYMBOL_PROPERTIES_BASE` (eeschema/dialogs/dialog_lib_symbol_properties_base.cpp):
 * the sizer tree, Add() for Add() - m_NoteBook with General (the Fields grid and its buttons, the
 * name / keywords / parent rows, then General | Pin Text Options | Attributes), Units & Body
 * Styles, Footprint Filters and Pin Connections, the Embedded Files page the derived constructor
 * adds, then bSizer101 (Edit Simulation Model..., the standard pair). The behaviour is
 * DIALOG_LIB_SYMBOL_PROPERTIES's.
 */
import type { JSX, MouseEvent, ReactNode } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { StdBitmapButton } from '@ziroeda/common/widgets/std_bitmap_button.js';
import { WxListBox } from '@ziroeda/common/widgets/wx_listbox.js';
import { Combo } from '@ziroeda/wx/combobox.js';
import {
  Button,
  type CHECK,
  CheckBox,
  RadioButton,
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
import { Notebook } from '@ziroeda/wx/notebook_ui.js';
import {
  BoxSizer,
  FlexGridSizer,
  SizerItem,
  Spacer,
  StaticBoxSizer,
  StdDialogButtonSizer,
  StretchSpacer,
} from '@ziroeda/wx/sizer.js';
import { SpinCtrl } from '@ziroeda/wx/spin_ctrl.js';
import { _ } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

/** A wxTextCtrl member: its text, enable and change. */
export interface TEXT {
  value: string;
  enabled?: boolean;
  onChange: (aText: string) => void;
}

export interface DIALOG_LIB_SYMBOL_PROPERTIES_BASE_PROPS {
  title: string;
  /** m_NoteBook's selection. */
  selection: number;
  onPageChanging: (aPage: number) => boolean;
  onPageChanged: (aPage: number) => void;

  m_grid: ReactNode;
  onAddField: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDeleteField: () => void;

  m_SymbolNameCtrl: TEXT & { onBlur: () => void };
  m_KeywordCtrl: TEXT;
  /** m_inheritanceSelectCombo: its strings, the selected one, whether it (and its label) is enabled. */
  inheritanceChoices: readonly string[];
  m_inheritanceSelectCombo: { value: string; enabled: boolean; onChange: (aName: string) => void };
  /** `bSizerLowerBasicPanel->Show( !aIsAlias )`. */
  lowerBasicPanelShown: boolean;

  m_OptionPower: CHECK;
  m_OptionLocalPower: CHECK;
  m_ShowPinNumButt: CHECK;
  m_ShowPinNameButt: CHECK;
  m_PinsNameInsideButt: CHECK;
  /** m_pinNameOffset's UNIT_BINDER: label, text, units label. */
  m_nameOffsetCtrl: TEXT;
  nameOffsetUnits: string;
  m_excludeFromSimCheckBox: CHECK;
  m_excludeFromBomCheckBox: CHECK;
  m_excludeFromBoardCheckBox: CHECK;
  m_excludeFromPosFilesCheckBox: CHECK;

  m_unitSpinCtrl: { value: number; onChange: (aValue: number) => void; onBlur: () => void };
  m_OptionPartsInterchangeable: CHECK;
  m_unitNamesGrid: ReactNode;
  /** The body-style radios: 0 single, 1 De Morgan, 2 custom. */
  bodyStyleRadio: number;
  onBodyStyle: (aRadio: number) => void;
  m_bodyStyleNamesGrid: ReactNode;
  /** OnBodyStyle: the names grid and its four buttons follow m_radioCustom. */
  bodyStyleNamesEnabled: boolean;
  onAddBodyStyle: () => void;
  onBodyStyleMoveUp: () => void;
  onBodyStyleMoveDown: () => void;
  onDeleteBodyStyle: () => void;

  footprintFilters: readonly string[];
  footprintFilterSelections: readonly number[];
  onFootprintFilterSelect: (aRows: number[]) => void;
  /** OnFpFilterDClick: the row under the double click (HitTest), or -1. */
  onFpFilterDClick: (aRow: number) => void;
  onFootprintFilterContextMenu: (aEvent: MouseEvent<HTMLDivElement>) => void;
  onFootprintFilterKey: (aKey: string, aControlDown: boolean) => boolean;
  onAddFootprintFilter: () => void;
  onEditFootprintFilter: () => void;
  onDeleteFootprintFilter: () => void;

  m_cbDuplicatePinsAreJumpers: CHECK;
  m_jumperGroupsGrid: ReactNode;
  onAddJumperGroup: () => void;
  onRemoveJumperGroup: () => void;

  /** The PANEL_EMBEDDED_FILES page. */
  m_embeddedFiles: ReactNode;

  /** `m_spiceFieldsButton->Show()`. */
  spiceFieldsShown: boolean;
  /** "Read Only": OK relabelled and disabled for a legacy library's symbol. */
  readOnly: boolean;
  onOK: () => void;
  onCancel: () => void;
}

export function DIALOG_LIB_SYMBOL_PROPERTIES_BASE(
  p: DIALOG_LIB_SYMBOL_PROPERTIES_BASE_PROPS,
): JSX.Element {
  const check = (aLabel: string, aCheck: CHECK, aTitle?: string): JSX.Element => (
    <CheckBox label={aLabel} title={aTitle} check={aCheck} />
  );

  const basicPanel = (
    // bSizerBasicPanel
    <BoxSizer orient={wxVERTICAL}>
      <SizerItem proportion={1} flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
        <StaticBoxSizer label={_('Fields')} orient={wxVERTICAL}>
          <SizerItem proportion={1} flag={wxALL | wxEXPAND} border={5} minSize={[-1, 160]}>
            {/* [data] m_grid->SetMinSize( wxSize( -1,160 ) ) */}
            {p.m_grid}
          </SizerItem>
          <SizerItem flag={wxEXPAND | wxBOTTOM} border={5}>
            {/* bButtonSize */}
            <BoxSizer orient={wxHORIZONTAL}>
              <SizerItem flag={wxRIGHT | wxLEFT} border={5}>
                <StdBitmapButton
                  bitmap="small_plus"
                  title={_('Add field')}
                  onClick={p.onAddField}
                />
              </SizerItem>
              <SizerItem flag={wxRIGHT} border={5}>
                <StdBitmapButton bitmap="small_up" title={_('Move up')} onClick={p.onMoveUp} />
              </SizerItem>
              <SizerItem flag={wxRIGHT} border={5}>
                <StdBitmapButton
                  bitmap="small_down"
                  title={_('Move down')}
                  onClick={p.onMoveDown}
                />
              </SizerItem>
              <Spacer width={20} height={0} flag={wxEXPAND} border={5} />
              <SizerItem flag={wxRIGHT | wxLEFT} border={10}>
                <StdBitmapButton
                  bitmap="small_trash"
                  title={_('Delete field')}
                  onClick={p.onDeleteField}
                />
              </SizerItem>
            </BoxSizer>
          </SizerItem>
        </StaticBoxSizer>
      </SizerItem>
      <SizerItem flag={wxEXPAND} border={5}>
        {/* bSizerMidBasicPanel */}
        <BoxSizer orient={wxVERTICAL}>
          <SizerItem proportion={1} flag={wxEXPAND | wxTOP | wxBOTTOM} border={5}>
            {/* fgSizerFPID = wxFlexGridSizer( 4, 2, 3, 0 ), AddGrowableCol( 1 ) */}
            <FlexGridSizer cols={2} vgap={3} hgap={0} growableCols={[1]}>
              <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT | wxRIGHT} border={8}>
                <StaticText label={_('Symbol name:')} />
              </SizerItem>
              <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxEXPAND | wxRIGHT} border={8}>
                <TextCtrl
                  value={p.m_SymbolNameCtrl.value}
                  onChange={p.m_SymbolNameCtrl.onChange}
                  onBlur={p.m_SymbolNameCtrl.onBlur}
                  ariaLabel={_('Symbol name')}
                />
              </SizerItem>
              <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={8}>
                <StaticText label={_('Keywords:')} />
              </SizerItem>
              <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxEXPAND | wxRIGHT} border={8}>
                <TextCtrl
                  value={p.m_KeywordCtrl.value}
                  onChange={p.m_KeywordCtrl.onChange}
                  ariaLabel="Keywords"
                />
              </SizerItem>
              <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT | wxRIGHT} border={8}>
                <StaticText
                  label={_('Derive from symbol:')}
                  disabled={!p.m_inheritanceSelectCombo.enabled}
                />
              </SizerItem>
              <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxEXPAND | wxRIGHT} border={7}>
                {/* wxCB_DROPDOWN|wxCB_READONLY: the text is "<None>" until a parent is chosen */}
                <Combo
                  value={p.m_inheritanceSelectCombo.value}
                  options={[
                    ...(p.m_inheritanceSelectCombo.value === ''
                      ? [{ value: '', label: _('<None>') }]
                      : []),
                    ...p.inheritanceChoices.map((n) => ({ value: n, label: n })),
                  ]}
                  disabled={!p.m_inheritanceSelectCombo.enabled}
                  onChange={p.m_inheritanceSelectCombo.onChange}
                  ariaLabel={_('Derive from symbol')}
                  title={INHERITANCE_TIP}
                />
              </SizerItem>
            </FlexGridSizer>
          </SizerItem>
        </BoxSizer>
      </SizerItem>
      <SizerItem flag={wxEXPAND} border={5} shown={p.lowerBasicPanelShown}>
        {/* bSizerLowerBasicPanel */}
        <BoxSizer orient={wxHORIZONTAL}>
          <SizerItem proportion={1} flag={wxEXPAND} border={5}>
            {/* bSizerLeftCol */}
            <BoxSizer orient={wxVERTICAL}>
              <SizerItem proportion={1} flag={wxEXPAND | wxALL} border={5}>
                <StaticBoxSizer label={_('General')} orient={wxVERTICAL}>
                  <SizerItem flag={wxBOTTOM | wxRIGHT | wxLEFT} border={4}>
                    {check(_('Define as power symbol'), p.m_OptionPower, POWER_TIP)}
                  </SizerItem>
                  <SizerItem proportion={1} flag={wxEXPAND} border={5}>
                    {/* bSizer16 */}
                    <BoxSizer orient={wxHORIZONTAL}>
                      <Spacer width={0} height={0} flag={wxEXPAND | wxLEFT | wxRIGHT} border={10} />
                      <SizerItem flag={wxBOTTOM | wxLEFT | wxRIGHT} border={4}>
                        {check(
                          _('Define as local power symbol'),
                          p.m_OptionLocalPower,
                          LOCAL_POWER_TIP,
                        )}
                      </SizerItem>
                    </BoxSizer>
                  </SizerItem>
                </StaticBoxSizer>
              </SizerItem>
            </BoxSizer>
          </SizerItem>
          <SizerItem proportion={1} flag={wxEXPAND} border={5}>
            {/* bSizerPinTextCol */}
            <BoxSizer orient={wxVERTICAL}>
              <SizerItem proportion={1} flag={wxALL | wxEXPAND} border={5}>
                <StaticBoxSizer label={_('Pin Text Options')} orient={wxVERTICAL}>
                  <SizerItem flag={wxRIGHT} border={5}>
                    {check(_('Show pin number'), p.m_ShowPinNumButt, _('Show or hide pin numbers'))}
                  </SizerItem>
                  <SizerItem flag={wxRIGHT | wxTOP} border={5}>
                    {check(_('Show pin name'), p.m_ShowPinNameButt, _('Show or hide pin names'))}
                  </SizerItem>
                  <Spacer width={0} height={12} flag={wxEXPAND} border={5} />
                  <SizerItem flag={wxRIGHT | wxTOP} border={5}>
                    {check(_('Place pin names inside'), p.m_PinsNameInsideButt, PINS_INSIDE_TIP)}
                  </SizerItem>
                  <SizerItem flag={wxBOTTOM | wxEXPAND | wxTOP} border={5}>
                    {/* bSizerNameOffset */}
                    <BoxSizer orient={wxHORIZONTAL}>
                      <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={5}>
                        <StaticText
                          label={_('Position offset:')}
                          title={_('Margin between the pin name position and the symbol body.')}
                          disabled={p.m_nameOffsetCtrl.enabled === false}
                        />
                      </SizerItem>
                      <SizerItem proportion={1} flag={wxLEFT | wxRIGHT} border={5}>
                        <TextCtrl
                          value={p.m_nameOffsetCtrl.value}
                          onChange={p.m_nameOffsetCtrl.onChange}
                          disabled={p.m_nameOffsetCtrl.enabled === false}
                          ariaLabel={_('Position offset')}
                        />
                      </SizerItem>
                      <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT} border={5}>
                        <StaticText
                          label={p.nameOffsetUnits}
                          disabled={p.m_nameOffsetCtrl.enabled === false}
                        />
                      </SizerItem>
                    </BoxSizer>
                  </SizerItem>
                  <Spacer width={0} height={0} flag={wxEXPAND} border={5} />
                </StaticBoxSizer>
              </SizerItem>
            </BoxSizer>
          </SizerItem>
          <SizerItem proportion={1} flag={wxEXPAND} border={5}>
            {/* bSizerRightCol */}
            <BoxSizer orient={wxVERTICAL}>
              <SizerItem proportion={1} flag={wxEXPAND | wxALL} border={5}>
                <StaticBoxSizer label={_('Attributes')} orient={wxVERTICAL}>
                  <SizerItem flag={wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
                    {check(_('Exclude from simulation'), p.m_excludeFromSimCheckBox)}
                  </SizerItem>
                  <Spacer width={0} height={10} flag={wxEXPAND} border={5} />
                  <SizerItem flag={wxBOTTOM | wxLEFT | wxRIGHT} border={5}>
                    {check(_('Exclude from bill of materials'), p.m_excludeFromBomCheckBox)}
                  </SizerItem>
                  <SizerItem flag={wxBOTTOM | wxLEFT | wxRIGHT} border={5}>
                    {check(_('Exclude from board'), p.m_excludeFromBoardCheckBox)}
                  </SizerItem>
                  <SizerItem flag={wxBOTTOM | wxLEFT | wxRIGHT} border={5}>
                    {check(_('Exclude from position files'), p.m_excludeFromPosFilesCheckBox)}
                  </SizerItem>
                </StaticBoxSizer>
              </SizerItem>
            </BoxSizer>
          </SizerItem>
        </BoxSizer>
      </SizerItem>
    </BoxSizer>
  );

  const bodyStyleButtons = !p.bodyStyleNamesEnabled;

  const unitsPanel = (
    // bSizerUnitsAndBodyStyles
    <BoxSizer orient={wxHORIZONTAL}>
      <SizerItem proportion={1} flag={wxEXPAND | wxALL} border={10}>
        <StaticBoxSizer label={_('Symbol Units')} orient={wxVERTICAL}>
          <SizerItem flag={wxEXPAND | wxBOTTOM | wxLEFT} border={4}>
            {/* bSizerUnitCount */}
            <BoxSizer orient={wxHORIZONTAL}>
              <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT} border={5}>
                <StaticText label={_('Number of units:')} title={UNIT_COUNT_TIP} />
              </SizerItem>
              <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                {/* wxSP_ARROW_KEYS, 1..64 */}
                <SpinCtrl
                  value={p.m_unitSpinCtrl.value}
                  onChange={p.m_unitSpinCtrl.onChange}
                  min={1}
                  max={64}
                  ariaLabel={_('Number of units')}
                />
              </SizerItem>
            </BoxSizer>
          </SizerItem>
          <Spacer width={0} height={2} flag={wxEXPAND} border={5} />
          <SizerItem flag={wxBOTTOM | wxRIGHT | wxLEFT} border={4}>
            {check(
              _('All units are interchangeable'),
              p.m_OptionPartsInterchangeable,
              INTERCHANGEABLE_TIP,
            )}
          </SizerItem>
          <Spacer width={0} height={15} flag={wxEXPAND} border={5} />
          <SizerItem flag={wxTOP | wxRIGHT | wxLEFT} border={5}>
            <StaticText label={_('Unit display names (optional):')} />
          </SizerItem>
          <SizerItem proportion={1} flag={wxALL | wxEXPAND} border={5}>
            {p.m_unitNamesGrid}
          </SizerItem>
        </StaticBoxSizer>
      </SizerItem>
      <SizerItem proportion={1} flag={wxEXPAND | wxALL} border={10}>
        <StaticBoxSizer label={_('Body Styles')} orient={wxVERTICAL}>
          <SizerItem flag={wxTOP | wxRIGHT | wxLEFT} border={5}>
            <RadioButton
              name="bodyStyles"
              label={_('Single body style')}
              checked={p.bodyStyleRadio === 0}
              onChange={() => p.onBodyStyle(0)}
            />
          </SizerItem>
          <Spacer width={0} height={3} flag={wxEXPAND} border={5} />
          <SizerItem flag={wxTOP | wxRIGHT | wxLEFT} border={5}>
            <RadioButton
              name="bodyStyles"
              label={_('‘Standard’ and ‘Alternate’ De Morgan body styles')}
              checked={p.bodyStyleRadio === 1}
              onChange={() => p.onBodyStyle(1)}
            />
          </SizerItem>
          <Spacer width={0} height={3} flag={wxEXPAND} border={5} />
          <SizerItem flag={wxALL} border={5}>
            <RadioButton
              name="bodyStyles"
              label={_('Custom body styles:')}
              checked={p.bodyStyleRadio === 2}
              onChange={() => p.onBodyStyle(2)}
            />
          </SizerItem>
          <SizerItem proportion={1} flag={wxEXPAND | wxLEFT | wxRIGHT} border={5}>
            {/* bSizerIndent */}
            <BoxSizer orient={wxVERTICAL}>
              <SizerItem proportion={1} flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
                {p.m_bodyStyleNamesGrid}
              </SizerItem>
              <SizerItem flag={wxBOTTOM | wxEXPAND | wxLEFT} border={5}>
                {/* bButtonSize1 */}
                <BoxSizer orient={wxHORIZONTAL}>
                  <SizerItem flag={wxRIGHT} border={5}>
                    <StdBitmapButton
                      bitmap="small_plus"
                      title={_('Add field')}
                      disabled={bodyStyleButtons}
                      onClick={p.onAddBodyStyle}
                    />
                  </SizerItem>
                  <SizerItem flag={wxRIGHT} border={5}>
                    <StdBitmapButton
                      bitmap="small_up"
                      title={_('Move up')}
                      disabled={bodyStyleButtons}
                      onClick={p.onBodyStyleMoveUp}
                    />
                  </SizerItem>
                  <SizerItem flag={wxRIGHT} border={5}>
                    <StdBitmapButton
                      bitmap="small_down"
                      title={_('Move down')}
                      disabled={bodyStyleButtons}
                      onClick={p.onBodyStyleMoveDown}
                    />
                  </SizerItem>
                  <Spacer width={20} height={0} flag={wxEXPAND} border={5} />
                  <SizerItem flag={wxRIGHT | wxLEFT} border={10}>
                    <StdBitmapButton
                      bitmap="small_trash"
                      title={_('Delete field')}
                      disabled={bodyStyleButtons}
                      onClick={p.onDeleteBodyStyle}
                    />
                  </SizerItem>
                </BoxSizer>
              </SizerItem>
            </BoxSizer>
          </SizerItem>
        </StaticBoxSizer>
      </SizerItem>
    </BoxSizer>
  );

  const filtersPanel = (
    // bSizerFPFilters
    <BoxSizer orient={wxHORIZONTAL}>
      <SizerItem proportion={1} flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={5}>
        {/* bFPFiltersMargins */}
        <BoxSizer orient={wxVERTICAL}>
          <SizerItem flag={wxRIGHT | wxLEFT} border={5}>
            <StaticText label={_('Footprint filters:')} title={FOOTPRINT_FILTERS_TIP} />
          </SizerItem>
          <SizerItem proportion={1} flag={wxEXPAND} border={5}>
            {/* wxLB_MULTIPLE */}
            <WxListBox
              items={p.footprintFilters}
              selection={-1}
              selections={p.footprintFilterSelections}
              onSelectRows={p.onFootprintFilterSelect}
              onContextMenu={p.onFootprintFilterContextMenu}
              onKeyDown={(e) => {
                if (p.onFootprintFilterKey(e.key, e.ctrlKey)) e.preventDefault();
              }}
              onDoubleClick={p.onFpFilterDClick}
              ariaLabel={_('Footprint filters')}
            />
          </SizerItem>
          <SizerItem border={5}>
            {/* bFpFilterRightBoxSizer */}
            <BoxSizer orient={wxHORIZONTAL}>
              <SizerItem flag={wxTOP | wxBOTTOM} border={5}>
                <StdBitmapButton
                  bitmap="small_plus"
                  title={_('Add footprint filter')}
                  onClick={p.onAddFootprintFilter}
                />
              </SizerItem>
              <SizerItem flag={wxALL} border={5}>
                <StdBitmapButton
                  bitmap="small_edit"
                  title={_('Edit footprint filter')}
                  onClick={p.onEditFootprintFilter}
                />
              </SizerItem>
              <Spacer width={20} height={0} flag={wxEXPAND} border={5} />
              <SizerItem flag={wxALL} border={5}>
                <StdBitmapButton
                  bitmap="small_trash"
                  title={_('Delete footprint filter')}
                  onClick={p.onDeleteFootprintFilter}
                />
              </SizerItem>
            </BoxSizer>
          </SizerItem>
        </BoxSizer>
      </SizerItem>
    </BoxSizer>
  );

  const pinConnectionsPanel = (
    // bSizerPinConnections
    <BoxSizer orient={wxVERTICAL}>
      <SizerItem proportion={1} flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={5}>
        {/* bMargins */}
        <BoxSizer orient={wxVERTICAL}>
          <SizerItem flag={wxLEFT} border={5}>
            {check(
              _('All pins with duplicate numbers are jumpers'),
              p.m_cbDuplicatePinsAreJumpers,
              DUPLICATE_PINS_TIP,
            )}
          </SizerItem>
          <Spacer width={0} height={5} flag={wxEXPAND} border={5} />
          <SizerItem flag={wxTOP | wxRIGHT | wxLEFT} border={5}>
            <StaticText label={_('Explicit jumper pin groups:')} />
          </SizerItem>
          <SizerItem proportion={1} flag={wxEXPAND | wxALL} border={2} minSize={[-1, 30]}>
            {/* [data] m_jumperGroupsGrid->SetMinSize( wxSize( -1,30 ) ) */}
            {p.m_jumperGroupsGrid}
          </SizerItem>
          <SizerItem flag={wxEXPAND | wxTOP} border={5}>
            {/* bButtonSize21 */}
            <BoxSizer orient={wxHORIZONTAL}>
              <SizerItem flag={wxBOTTOM | wxRIGHT} border={5}>
                <StdBitmapButton bitmap="small_plus" title="" onClick={p.onAddJumperGroup} />
              </SizerItem>
              <Spacer width={20} height={0} flag={wxEXPAND} border={5} />
              <SizerItem flag={wxBOTTOM | wxRIGHT} border={5}>
                <StdBitmapButton bitmap="small_trash" title="" onClick={p.onRemoveJumperGroup} />
              </SizerItem>
            </BoxSizer>
          </SizerItem>
        </BoxSizer>
      </SizerItem>
    </BoxSizer>
  );

  return (
    <DialogShim title={p.title} onClose={p.onCancel}>
      {/* bMainSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem proportion={1} flag={wxEXPAND | wxBOTTOM} border={5}>
          {/* bUpperSizer */}
          <BoxSizer orient={wxVERTICAL}>
            <SizerItem proportion={1} flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={10}>
              <Notebook
                selection={p.selection}
                onPageChanging={p.onPageChanging}
                onPageChanged={p.onPageChanged}
                pages={[
                  { text: _('General'), content: basicPanel },
                  { text: _('Units & Body Styles'), content: unitsPanel },
                  { text: _('Footprint Filters'), content: filtersPanel },
                  { text: _('Pin Connections'), content: pinConnectionsPanel },
                  { text: _('Embedded Files'), content: p.m_embeddedFiles },
                ]}
              />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND} border={5}>
          {/* bSizer101 */}
          <BoxSizer orient={wxHORIZONTAL}>
            <StretchSpacer />
            <SizerItem flag={wxEXPAND | wxALL} border={5} shown={p.spiceFieldsShown}>
              {/* DIALOG_SIM_MODEL is not ported. */}
              <Button
                label={_('Edit Simulation Model...')}
                disabled
                title={_('The simulator is not available in this build')}
              />
            </SizerItem>
            <Spacer width={0} height={0} flag={wxEXPAND | wxRIGHT | wxLEFT} border={15} />
            <SizerItem flag={wxEXPAND | wxALL} border={5}>
              {/* m_stdSizerButton: OK, Cancel */}
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

const INHERITANCE_TIP =
  'Select symbol to derive this symbol from or select\n<None> for root symbol.\n\n' +
  'Derived symbols were formerly referred to as aliases.\nThis is no longer the case and all ' +
  'symbols are either\nderived from another symbols or they stand alone as\nroot symbols.';
const POWER_TIP =
  'Power symbols define a global net with the value as a netname.\n' +
  'They will not be included in the BOM and cannot be assigned a footprint.';
const LOCAL_POWER_TIP = _HKI(
  'Local power symbols create labels that are limited to the sheet in which they are used',
);
const PINS_INSIDE_TIP =
  'Check this option to have pin names inside the body and pin number outside.\n' +
  'If not checked pins names and pins numbers are outside.';
const UNIT_COUNT_TIP = _HKI(
  'Enter the number of units for a symbol that contains more than one unit',
);
const INTERCHANGEABLE_TIP =
  'Check this option when all symbol units have the same function.\n' +
  'For instance, this should be checked for a quad NAND gate, while it should not be checked ' +
  'for a dual triode (where unit C is the filament).';
const FOOTPRINT_FILTERS_TIP =
  'A list of footprints names that can be used for this symbol.\n' +
  'Footprints names can used wildcards like sm* to allow all footprints names starting by sm.';
const DUPLICATE_PINS_TIP =
  'When enabled, this symbol can have more than one pin with the same number.  Pins with the ' +
  'same number will be considered to be jumpered together internally.';
