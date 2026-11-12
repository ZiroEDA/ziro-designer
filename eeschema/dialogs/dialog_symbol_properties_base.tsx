// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_SYMBOL_PROPERTIES_BASE` (eeschema/dialogs/dialog_symbol_properties_base.cpp): the sizer
 * tree, Add() for Add() - m_notebook1 with the General page (the Fields grid and its buttons, then
 * General | Attributes | the four library buttons) and the Pin Functions page, then bSizerBottom
 * (Library link, Simulation Model..., the standard pair). The behaviour is
 * DIALOG_SYMBOL_PROPERTIES's.
 */
import type { JSX, ReactNode } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { StdBitmapButton } from '@ziroeda/common/widgets/std_bitmap_button.js';
import {
  Button,
  type CHECK,
  CheckBox,
  type CHOICE,
  Choice,
  Panel,
  StaticText,
  TextCtrl,
} from '@ziroeda/wx/controls.js';
import {
  wxALIGN_CENTER_VERTICAL,
  wxALL,
  wxBOTTOM,
  wxEXPAND,
  wxFIXED_MINSIZE,
  wxHORIZONTAL,
  wxLEFT,
  wxRIGHT,
  wxTOP,
  wxVERTICAL,
} from '@ziroeda/wx/defs.js';
import { Notebook } from '@ziroeda/wx/notebook_ui.js';
import {
  BoxSizer,
  GridBagSizer,
  SizerItem,
  Spacer,
  StaticBoxSizer,
  StdDialogButtonSizer,
  StretchSpacer,
} from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

const EXCLUDE_FROM_BOM_TIP =
  'This is useful for adding symbols for board footprints such as fiducials\n' +
  'and logos that you do not want to appear in the bill of materials export';
const EXCLUDE_FROM_BOARD_TIP =
  'This is useful for adding symbols that only get exported to the bill of materials but\n' +
  'not required to layout the board such as mechanical fasteners and enclosures';
const EXCLUDE_FROM_POS_FILES_TIP =
  'This is useful for adding symbols that should not be included in the \n' +
  'exported position files used for pick and place machines';

/** m_orientationCtrlChoices and m_mirrorCtrlChoices. */
const ORIENTATIONS = ['0', '+90', '-90', '180'];
const MIRRORS = [_HKI('Not mirrored'), _HKI('Around X axis'), _HKI('Around Y axis')];

export interface DIALOG_SYMBOL_PROPERTIES_BASE_PROPS {
  title: string;
  /** m_notebook1's selection: 0 General, 1 Pin Functions. */
  selection: number;
  onPageChanging: (aPage: number) => boolean;
  onPageChanged: (aPage: number) => void;
  m_fieldsGrid: ReactNode;
  onAddField: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDeleteField: () => void;
  unitChoices: readonly string[];
  m_unitChoice: CHOICE;
  bodyStyleChoices: readonly string[];
  m_bodyStyleChoice: CHOICE;
  m_orientationCtrl: CHOICE;
  m_mirrorCtrl: CHOICE;
  m_ShowPinNumButt: CHECK;
  m_ShowPinNameButt: CHECK;
  m_cbExcludeFromSim: CHECK;
  m_cbExcludeFromBom: CHECK;
  m_cbExcludeFromBoard: CHECK;
  m_cbExcludeFromPosFiles: CHECK;
  m_cbDNP: CHECK;
  onUpdateSymbol: () => void;
  onExchangeSymbol: () => void;
  onEditSymbol: () => void;
  onEditLibrarySymbol: () => void;
  editSymbolEnabled: boolean;
  /** m_pinGrid, or null while m_pinTablePage is disabled. */
  m_pinGrid: ReactNode;
  /** m_pinTablePage->SetToolTip(), set when it is disabled. */
  pinTablePageTip?: string;
  m_tcLibraryID: string;
  /** `m_spiceFieldsButton->Hide()` for a power symbol. */
  spiceFieldsShown: boolean;
  onOK: () => void;
  onCancel: () => void;
}

export function DIALOG_SYMBOL_PROPERTIES_BASE(p: DIALOG_SYMBOL_PROPERTIES_BASE_PROPS): JSX.Element {
  const generalPage = (
    // generalPageSizer
    <BoxSizer orient={wxVERTICAL}>
      <SizerItem proportion={1} flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
        <StaticBoxSizer label={_('Fields')} orient={wxVERTICAL}>
          <SizerItem
            proportion={1}
            flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT}
            border={5}
            minSize={[-1, 160]}
          >
            {/* m_fieldsGrid->SetMinSize( wxSize( -1, 160 ) ) (the derived constructor) */}
            {p.m_fieldsGrid}
          </SizerItem>
          <SizerItem flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
            {/* bButtonSize */}
            <BoxSizer orient={wxHORIZONTAL}>
              <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT} border={5}>
                <StdBitmapButton
                  bitmap="small_plus"
                  title={_('Add field')}
                  onClick={p.onAddField}
                />
              </SizerItem>
              <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT} border={5}>
                <StdBitmapButton bitmap="small_up" title={_('Move up')} onClick={p.onMoveUp} />
              </SizerItem>
              <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT} border={5}>
                <StdBitmapButton
                  bitmap="small_down"
                  title={_('Move down')}
                  onClick={p.onMoveDown}
                />
              </SizerItem>
              <Spacer width={20} height={0} flag={wxEXPAND} border={10} />
              <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT} border={5}>
                <StdBitmapButton
                  bitmap="small_trash"
                  title={_('Delete field')}
                  onClick={p.onDeleteField}
                />
              </SizerItem>
              <StretchSpacer />
            </BoxSizer>
          </SizerItem>
        </StaticBoxSizer>
      </SizerItem>
      <SizerItem flag={wxEXPAND | wxTOP | wxBOTTOM} border={5}>
        {/* bLowerSizer */}
        <BoxSizer orient={wxHORIZONTAL}>
          <SizerItem proportion={4} flag={wxEXPAND | wxRIGHT | wxLEFT} border={5}>
            <StaticBoxSizer label={_('General')} orient={wxVERTICAL}>
              <SizerItem proportion={1} flag={wxEXPAND} border={5}>
                {/* gbSizer1 = wxGridBagSizer( 3, 3 ), SetEmptyCellSize( wxSize( -1,12 ) ),
                    AddGrowableCol( 1 ) */}
                <GridBagSizer vgap={3} hgap={3} emptyCellSize={[-1, 12]} growableCols={[1]}>
                  <SizerItem
                    pos={[0, 0]}
                    span={[1, 1]}
                    flag={wxALIGN_CENTER_VERTICAL | wxLEFT | wxRIGHT}
                    border={5}
                  >
                    <StaticText label={_('Unit:')} disabled={p.m_unitChoice.enabled === false} />
                  </SizerItem>
                  <SizerItem
                    pos={[0, 1]}
                    span={[1, 1]}
                    flag={wxEXPAND | wxRIGHT}
                    border={5}
                    minSize={[100, -1]}
                  >
                    <Choice ariaLabel="Unit" choices={p.unitChoices} choice={p.m_unitChoice} />
                  </SizerItem>
                  <SizerItem
                    pos={[1, 0]}
                    span={[1, 1]}
                    flag={wxALIGN_CENTER_VERTICAL | wxLEFT}
                    border={5}
                  >
                    <StaticText
                      label={_('Body style:')}
                      disabled={p.m_bodyStyleChoice.enabled === false}
                    />
                  </SizerItem>
                  <SizerItem
                    pos={[1, 1]}
                    span={[1, 1]}
                    flag={wxEXPAND | wxALIGN_CENTER_VERTICAL | wxRIGHT}
                    border={5}
                  >
                    <Choice
                      ariaLabel={_('Body style')}
                      choices={p.bodyStyleChoices}
                      choice={p.m_bodyStyleChoice}
                    />
                  </SizerItem>
                  <SizerItem
                    pos={[3, 0]}
                    span={[1, 1]}
                    flag={wxALIGN_CENTER_VERTICAL | wxLEFT | wxRIGHT}
                    border={5}
                  >
                    <StaticText label={_('Angle:')} />
                  </SizerItem>
                  <SizerItem
                    pos={[3, 1]}
                    span={[1, 1]}
                    flag={wxALIGN_CENTER_VERTICAL | wxEXPAND | wxRIGHT}
                    border={5}
                  >
                    <Choice
                      ariaLabel={_('Angle')}
                      choices={ORIENTATIONS}
                      choice={p.m_orientationCtrl}
                    />
                  </SizerItem>
                  <SizerItem
                    pos={[4, 0]}
                    span={[1, 1]}
                    flag={wxALIGN_CENTER_VERTICAL | wxLEFT | wxRIGHT}
                    border={5}
                  >
                    <StaticText label={_('Mirror:')} />
                  </SizerItem>
                  <SizerItem pos={[4, 1]} span={[1, 1]} flag={wxEXPAND | wxRIGHT} border={5}>
                    <Choice ariaLabel={_('Mirror')} choices={MIRRORS} choice={p.m_mirrorCtrl} />
                  </SizerItem>
                </GridBagSizer>
              </SizerItem>
              <SizerItem flag={wxEXPAND | wxTOP} border={13}>
                {/* bSizer11 */}
                <BoxSizer orient={wxHORIZONTAL}>
                  <SizerItem proportion={1} flag={wxALL} border={3}>
                    <CheckBox
                      label={_('Show pin numbers')}
                      title={_('Show or hide pin numbers')}
                      check={p.m_ShowPinNumButt}
                    />
                  </SizerItem>
                  <SizerItem proportion={1} flag={wxALL} border={3}>
                    <CheckBox
                      label={_('Show pin names')}
                      title={_('Show or hide pin names')}
                      check={p.m_ShowPinNameButt}
                    />
                  </SizerItem>
                </BoxSizer>
              </SizerItem>
            </StaticBoxSizer>
          </SizerItem>
          <SizerItem proportion={3} flag={wxEXPAND | wxRIGHT | wxLEFT} border={5}>
            {/* bMiddleCol */}
            <BoxSizer orient={wxVERTICAL}>
              <SizerItem proportion={1} flag={wxEXPAND | wxRIGHT | wxLEFT} border={5}>
                <StaticBoxSizer label={_('Attributes')} orient={wxVERTICAL}>
                  <SizerItem flag={wxRIGHT | wxLEFT} border={5}>
                    <CheckBox label={_('Exclude from simulation')} check={p.m_cbExcludeFromSim} />
                  </SizerItem>
                  <Spacer width={0} height={10} flag={wxEXPAND} border={5} />
                  <SizerItem flag={wxALL} border={5}>
                    <CheckBox
                      label={_('Exclude from bill of materials')}
                      title={EXCLUDE_FROM_BOM_TIP}
                      check={p.m_cbExcludeFromBom}
                    />
                  </SizerItem>
                  <SizerItem flag={wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
                    <CheckBox
                      label={_('Exclude from board')}
                      title={EXCLUDE_FROM_BOARD_TIP}
                      check={p.m_cbExcludeFromBoard}
                    />
                  </SizerItem>
                  <SizerItem flag={wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
                    <CheckBox
                      label={_('Exclude from position files')}
                      title={EXCLUDE_FROM_POS_FILES_TIP}
                      check={p.m_cbExcludeFromPosFiles}
                    />
                  </SizerItem>
                  <SizerItem flag={wxBOTTOM | wxLEFT | wxRIGHT} border={5}>
                    <CheckBox label={_('Do not populate')} check={p.m_cbDNP} />
                  </SizerItem>
                </StaticBoxSizer>
              </SizerItem>
            </BoxSizer>
          </SizerItem>
          <SizerItem proportion={3} flag={wxEXPAND | wxALL} border={5}>
            {/* buttonsSizer */}
            <BoxSizer orient={wxVERTICAL}>
              <SizerItem flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
                <Button label={_('Update Symbol from Library...')} onClick={p.onUpdateSymbol} />
              </SizerItem>
              <SizerItem flag={wxEXPAND | wxALL} border={5}>
                <Button label={_('Change Symbol...')} onClick={p.onExchangeSymbol} />
              </SizerItem>
              <SizerItem flag={wxEXPAND | wxALL} border={5}>
                <Button
                  label={_('Edit Symbol...')}
                  disabled={!p.editSymbolEnabled}
                  onClick={p.onEditSymbol}
                />
              </SizerItem>
              <Spacer width={0} height={20} flag={wxEXPAND} border={5} />
              <SizerItem flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={5}>
                <Button
                  label={_('Edit Library Symbol...')}
                  disabled={!p.editSymbolEnabled}
                  onClick={p.onEditLibrarySymbol}
                />
              </SizerItem>
            </BoxSizer>
          </SizerItem>
        </BoxSizer>
      </SizerItem>
    </BoxSizer>
  );

  const pinTablePage = (
    // m_pinTablePage: pinTableSizer > bMargins
    <Panel title={p.pinTablePageTip}>
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem proportion={1} flag={wxEXPAND | wxRIGHT | wxLEFT} border={5}>
          <BoxSizer orient={wxVERTICAL}>
            <SizerItem proportion={1} flag={wxEXPAND | wxALL | wxFIXED_MINSIZE} border={5}>
              {p.m_pinGrid}
            </SizerItem>
          </BoxSizer>
        </SizerItem>
      </BoxSizer>
    </Panel>
  );

  return (
    <DialogShim title={p.title} onClose={p.onCancel}>
      {/* mainSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem proportion={1} flag={wxEXPAND | wxALL} border={10}>
          <Notebook
            selection={p.selection}
            onPageChanging={p.onPageChanging}
            onPageChanged={p.onPageChanged}
            pages={[
              { text: _('General'), content: generalPage },
              { text: _('Pin Functions'), content: pinTablePage },
            ]}
          />
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxLEFT} border={12}>
          {/* bSizerBottom */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxBOTTOM | wxTOP} border={2}>
              <StaticText label={_('Library link:')} />
            </SizerItem>
            <SizerItem proportion={1} flag={wxALIGN_CENTER_VERTICAL | wxALL} border={5}>
              {/* m_tcLibraryID: wxTE_READONLY|wxBORDER_NONE */}
              <TextCtrl
                value={p.m_tcLibraryID}
                readOnly
                className="ze-bare"
                title={p.m_tcLibraryID}
                ariaLabel={_('Library link')}
              />
            </SizerItem>
            <Spacer width={10} height={0} flag={wxALIGN_CENTER_VERTICAL} border={5} />
            <SizerItem
              flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT}
              border={15}
              shown={p.spiceFieldsShown}
            >
              {/* DIALOG_SIM_MODEL is not ported. */}
              <Button
                label={_('Simulation Model...')}
                disabled
                title={_('The simulator is not available in this build')}
              />
            </SizerItem>
            <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxALL} border={5}>
              {/* m_stdDialogButtonSizer: OK, Cancel */}
              <StdDialogButtonSizer onOk={p.onOK} onCancel={p.onCancel} />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
