// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_SHEET_PROPERTIES_BASE` (eeschema/dialogs/dialog_sheet_properties_base.cpp): the sizer
 * tree, Add() for Add() - the info bar, m_longForm (the Fields grid and its buttons, then
 * Attributes beside Style), and m_sizerBottom (the hierarchical path beside the standard pair).
 * The behaviour is DIALOG_SHEET_PROPERTIES's.
 */
import type { JSX, ReactNode } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import type { Color4d } from '@ziroeda/common/gal/color4d.js';
import { ColorSwatch } from '@ziroeda/common/widgets/color_swatch.js';
import { StdBitmapButton } from '@ziroeda/common/widgets/std_bitmap_button.js';
import { Infobar } from '@ziroeda/common/widgets/wx_infobar.js';
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
  SizerItem,
  Spacer,
  StaticBoxSizer,
  StdDialogButtonSizer,
  StretchSpacer,
} from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

/** The two tooltips the base sets on the exclusion boxes. */
const EXCLUDE_FROM_BOM_TIP =
  'This is useful for adding symbols for board footprints such as fiducials\n' +
  'and logos that you do not want to appear in the bill of materials export';
const EXCLUDE_FROM_BOARD_TIP =
  'This is useful for adding symbols that only get exported to the bill of materials but\n' +
  'not required to layout the board such as mechanical fasteners and enclosures';

export interface DIALOG_SHEET_PROPERTIES_BASE_PROPS {
  m_infoBar: string | null;
  /** m_grid: the WX_GRID the derived dialog sets up over FIELDS_GRID_TABLE. */
  m_grid: ReactNode;
  onAddField: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDeleteField: () => void;
  m_pageNumberTextCtrl: string;
  onPageNumber: (aText: string) => void;
  m_cbExcludeFromSim: CHECK;
  m_cbExcludeFromBom: CHECK;
  m_cbExcludeFromBoard: CHECK;
  m_cbDNP: CHECK;
  m_borderWidthCtrl: string;
  onBorderWidth: (aText: string) => void;
  units: string;
  m_borderSwatch: Color4d;
  onBorderColor: (aColor: Color4d) => void;
  m_backgroundSwatch: Color4d;
  onBackgroundColor: (aColor: Color4d) => void;
  swatchBackground: Color4d;
  m_hierarchicalPath: string;
  onOK: () => void;
  onCancel: () => void;
}

export function DIALOG_SHEET_PROPERTIES_BASE(p: DIALOG_SHEET_PROPERTIES_BASE_PROPS): JSX.Element {
  return (
    <DialogShim title={_('Sheet Properties')} onClose={p.onCancel}>
      {/* mainSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem flag={wxEXPAND | wxBOTTOM} border={5} shown={p.m_infoBar !== null}>
          <Infobar message={p.m_infoBar ?? ''} />
        </SizerItem>
        <SizerItem proportion={1} flag={wxEXPAND | wxRIGHT | wxLEFT} border={5}>
          {/* m_longForm */}
          <BoxSizer orient={wxVERTICAL}>
            <SizerItem proportion={1} flag={wxALL | wxEXPAND} border={5}>
              <StaticBoxSizer label={_('Fields')} orient={wxVERTICAL}>
                <SizerItem proportion={1} flag={wxALL | wxEXPAND} border={5} minSize={[-1, 120]}>
                  {/* m_grid->SetMinSize( wxSize( -1,120 ) ) */}
                  {p.m_grid}
                </SizerItem>
                <SizerItem flag={wxALL | wxEXPAND} border={5}>
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
                      <StdBitmapButton
                        bitmap="small_up"
                        title={_('Move up')}
                        onClick={p.onMoveUp}
                      />
                    </SizerItem>
                    <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT} border={5}>
                      <StdBitmapButton
                        bitmap="small_down"
                        title={_('Move down')}
                        onClick={p.onMoveDown}
                      />
                    </SizerItem>
                    <Spacer width={20} height={0} flag={wxEXPAND} border={10} />
                    <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
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
            <SizerItem flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={5}>
              {/* bSizer5 */}
              <BoxSizer orient={wxHORIZONTAL}>
                <SizerItem flag={wxEXPAND | wxRIGHT} border={5}>
                  <StaticBoxSizer label={_('Attributes')} orient={wxVERTICAL}>
                    <SizerItem flag={wxEXPAND | wxBOTTOM | wxRIGHT} border={10}>
                      {/* bSizer6 */}
                      <BoxSizer orient={wxHORIZONTAL}>
                        <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={5}>
                          <StaticText label={_('Page number:')} />
                        </SizerItem>
                        <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT | wxRIGHT} border={5}>
                          <TextCtrl
                            value={p.m_pageNumberTextCtrl}
                            onChange={p.onPageNumber}
                            onEnter={p.onOK}
                            ariaLabel={_('Page number')}
                          />
                        </SizerItem>
                        <Spacer width={0} height={0} proportion={3} flag={wxEXPAND} border={5} />
                      </BoxSizer>
                    </SizerItem>
                    <SizerItem flag={wxTOP | wxRIGHT | wxLEFT} border={5}>
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
                    <SizerItem flag={wxBOTTOM | wxLEFT | wxRIGHT} border={5}>
                      <CheckBox label={_('Do not populate')} check={p.m_cbDNP} />
                    </SizerItem>
                  </StaticBoxSizer>
                </SizerItem>
                <SizerItem proportion={1} flag={wxEXPAND | wxLEFT} border={10}>
                  {/* sbSizer2 */}
                  <StaticBoxSizer label={_('Style')} orient={wxVERTICAL}>
                    <SizerItem flag={wxEXPAND} border={5}>
                      {/* bStyleColumns */}
                      <BoxSizer orient={wxHORIZONTAL}>
                        <SizerItem proportion={2} flag={wxEXPAND} border={5}>
                          {/* bBorderSizer */}
                          <BoxSizer orient={wxVERTICAL}>
                            <SizerItem flag={wxBOTTOM | wxLEFT} border={5}>
                              <StaticText label={_('Border')} />
                            </SizerItem>
                            <SizerItem proportion={1} flag={wxEXPAND} border={5}>
                              {/* bSizer10 */}
                              <BoxSizer orient={wxHORIZONTAL}>
                                <SizerItem
                                  flag={wxALIGN_CENTER_VERTICAL | wxBOTTOM | wxLEFT}
                                  border={5}
                                >
                                  <StaticText label={_('Width:')} />
                                </SizerItem>
                                <SizerItem
                                  flag={wxALIGN_CENTER_VERTICAL | wxBOTTOM | wxRIGHT | wxLEFT}
                                  border={5}
                                >
                                  <TextCtrl
                                    value={p.m_borderWidthCtrl}
                                    onChange={p.onBorderWidth}
                                    onEnter={p.onOK}
                                    ariaLabel={_('Border width')}
                                  />
                                </SizerItem>
                                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxBOTTOM} border={5}>
                                  <StaticText label={p.units} />
                                </SizerItem>
                                <Spacer width={20} height={0} flag={wxEXPAND} border={5} />
                                <SizerItem
                                  flag={wxALIGN_CENTER_VERTICAL | wxBOTTOM | wxRIGHT}
                                  border={5}
                                >
                                  <StaticText label={_('Color:')} />
                                </SizerItem>
                                <SizerItem
                                  flag={wxALIGN_CENTER_VERTICAL}
                                  border={5}
                                  minSize={[48, 24]}
                                >
                                  {/* m_borderSwatch->SetMinSize( wxSize( 48,24 ) ) */}
                                  <ColorSwatch
                                    label={_('Border color')}
                                    color={p.m_borderSwatch}
                                    background={p.swatchBackground}
                                    onChange={p.onBorderColor}
                                  />
                                </SizerItem>
                              </BoxSizer>
                            </SizerItem>
                          </BoxSizer>
                        </SizerItem>
                        <SizerItem proportion={1} flag={wxEXPAND} border={5}>
                          {/* bFillSizer */}
                          <BoxSizer orient={wxVERTICAL}>
                            <SizerItem flag={wxBOTTOM} border={5}>
                              <StaticText label={_('Fill')} />
                            </SizerItem>
                            <SizerItem proportion={1} flag={wxEXPAND} border={5}>
                              {/* bSizer11 */}
                              <BoxSizer orient={wxHORIZONTAL}>
                                <SizerItem
                                  flag={wxALIGN_CENTER_VERTICAL | wxBOTTOM | wxRIGHT}
                                  border={5}
                                >
                                  <StaticText label={_('Color:')} />
                                </SizerItem>
                                <SizerItem
                                  flag={wxALIGN_CENTER_VERTICAL}
                                  border={5}
                                  minSize={[48, 24]}
                                >
                                  <ColorSwatch
                                    label={_HKI('Fill color')}
                                    color={p.m_backgroundSwatch}
                                    background={p.swatchBackground}
                                    onChange={p.onBackgroundColor}
                                  />
                                </SizerItem>
                              </BoxSizer>
                            </SizerItem>
                          </BoxSizer>
                        </SizerItem>
                      </BoxSizer>
                    </SizerItem>
                  </StaticBoxSizer>
                </SizerItem>
              </BoxSizer>
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxLEFT} border={5}>
          {/* m_sizerBottom */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem flag={wxLEFT | wxALIGN_CENTER_VERTICAL} border={10}>
              <StaticText label={_('Hierarchical path:')} />
            </SizerItem>
            <SizerItem proportion={1} flag={wxALL | wxALIGN_CENTER_VERTICAL} border={5}>
              <StaticText label={p.m_hierarchicalPath} />
            </SizerItem>
            <SizerItem flag={wxEXPAND | wxALL} border={5}>
              {/* m_stdDialogButtonSizer: OK, Cancel */}
              <StdDialogButtonSizer onOk={p.onOK} onCancel={p.onCancel} />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
