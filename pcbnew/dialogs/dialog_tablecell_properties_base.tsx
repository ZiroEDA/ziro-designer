// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_TABLECELL_PROPERTIES_BASE` (pcbnew/dialogs/dialog_tablecell_properties_base.cpp): the
 * sizer tree, Add() for Add(). The members are props; the behaviour is
 * DIALOG_TABLECELL_PROPERTIES's (dialog_tablecell_properties.tsx). Its m_infoBar is created hidden
 * and pcbnew's class never shows it.
 */
import type { JSX } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { BitmapButton, BitmapButtonSeparator } from '@ziroeda/common/widgets/bitmap_button.js';
import { FontChoice } from '@ziroeda/common/widgets/font_choice.js';
import { Button, HyperlinkCtrl, StaticText, TextCtrl } from '@ziroeda/wx/controls.js';
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
import { STC_BEST_SIZE, StyledTextCtrl } from '@ziroeda/wx/stc.js';
import type { FIELD, HALIGN, TOGGLE, VALIGN } from './dialog_text_properties_base.js';
import { _ } from '@ziroeda/wx/translation.js';

export interface DIALOG_TABLECELL_PROPERTIES_BASE_PROPS {
  m_cellTextCtrl: { value: string; onChange: (aText: string) => void };
  m_fontCtrl: { face: string; onChange: (aFace: string) => void };
  m_bold: TOGGLE;
  m_italic: TOGGLE;
  /** The align radio buttons; null where no button of the row is checked. */
  hAlign: HALIGN | null;
  onHAlign: (aAlign: HALIGN) => void;
  vAlign: VALIGN | null;
  onVAlign: (aAlign: VALIGN) => void;
  m_textWidth: FIELD;
  m_textHeight: FIELD;
  m_textThickness: FIELD;
  m_autoTextThickness: TOGGLE;
  m_marginTop: FIELD;
  m_marginLeft: FIELD;
  m_marginRight: FIELD;
  m_marginBottom: FIELD;
  onEditTable: () => void;
  onSyntaxHelp: () => void;
  onOK: () => void;
  onCancel: () => void;
}

const CV = wxALIGN_CENTER_VERTICAL;

export function DIALOG_TABLECELL_PROPERTIES_BASE(
  p: DIALOG_TABLECELL_PROPERTIES_BASE_PROPS,
): JSX.Element {
  const sizeRow = (aRow: number, f: FIELD) => (
    <>
      <SizerItem pos={[aRow, 0]} flag={CV} border={4}>
        <StaticText label={f.label} title={f.title} disabled={f.enabled === false} />
      </SizerItem>
      <SizerItem pos={[aRow, 1]} flag={CV | wxEXPAND} border={5}>
        <TextCtrl
          value={f.value}
          onChange={f.onChange}
          onBlur={f.onBlur}
          onEnter={p.onOK}
          disabled={f.enabled === false}
          ariaLabel={f.label.replace(/:$/, '')}
        />
      </SizerItem>
      <SizerItem pos={[aRow, 2]} flag={CV} border={5}>
        <StaticText label={f.units} disabled={f.enabled === false} />
      </SizerItem>
    </>
  );

  const margin = (aName: string, f: FIELD) => (
    <SizerItem flag={CV} border={5}>
      <TextCtrl value={f.value} onChange={f.onChange} onBlur={f.onBlur} ariaLabel={aName} />
    </SizerItem>
  );

  const align = <T extends string>(
    aValue: T,
    aBitmap: string,
    aTip: string,
    aCurrent: T | null,
    aOn: (v: T) => void,
  ) => (
    <SizerItem flag={CV} border={5}>
      <BitmapButton
        bitmap={aBitmap}
        tooltip={aTip}
        checked={aCurrent === aValue}
        onClick={() => aOn(aValue)}
      />
    </SizerItem>
  );

  return (
    <DialogShim title={_('Table Cell Properties')} onClose={p.onCancel}>
      {/* bMainSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem proportion={1} flag={wxEXPAND | wxLEFT} border={5}>
          {/* bSizer7 */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem proportion={1} flag={wxEXPAND | wxTOP | wxRIGHT} border={5}>
              {/* bSizer8 */}
              <BoxSizer orient={wxVERTICAL}>
                <SizerItem flag={wxTOP | wxRIGHT | wxLEFT} border={5}>
                  <StaticText label={_('Cell contents:')} />
                </SizerItem>
                <SizerItem
                  proportion={1}
                  flag={wxEXPAND | wxALL}
                  border={2}
                  minSize={STC_BEST_SIZE}
                >
                  <StyledTextCtrl
                    autoFocus
                    value={p.m_cellTextCtrl.value}
                    onChange={p.m_cellTextCtrl.onChange}
                    ariaLabel="Cell contents"
                  />
                </SizerItem>
              </BoxSizer>
            </SizerItem>
            <SizerItem proportion={1} flag={wxEXPAND} border={5}>
              {/* bSizer9 > bMargins */}
              <BoxSizer orient={wxVERTICAL}>
                <SizerItem proportion={1} flag={wxEXPAND | wxALL} border={10}>
                  <BoxSizer orient={wxVERTICAL}>
                    <SizerItem flag={wxEXPAND | wxBOTTOM} border={5}>
                      {/* gbFontSizer = wxGridBagSizer( 3, 5 ), SetEmptyCellSize( wxSize( -1, 5 ) ) */}
                      <GridBagSizer vgap={3} hgap={5} emptyCellSize={[-1, 5]} growableCols={[1]}>
                        <SizerItem pos={[1, 0]} flag={CV | wxLEFT} border={1}>
                          <StaticText label={_('Font:')} />
                        </SizerItem>
                        <SizerItem pos={[1, 1]} span={[1, 3]} flag={CV | wxEXPAND} border={5}>
                          <FontChoice face={p.m_fontCtrl.face} onChange={p.m_fontCtrl.onChange} />
                        </SizerItem>
                      </GridBagSizer>
                    </SizerItem>
                    <SizerItem proportion={1} flag={wxEXPAND} border={5}>
                      {/* fgTextStyleSizer > hAlignButtons */}
                      <FlexGridSizer cols={2} vgap={5} hgap={5}>
                        <SizerItem flag={CV} border={5}>
                          <BoxSizer orient={wxHORIZONTAL}>
                            <SizerItem flag={CV} border={5}>
                              <BitmapButton
                                bitmap="text_bold"
                                tooltip={_('Bold')}
                                checked={p.m_bold.checked}
                                onClick={p.m_bold.onClick}
                              />
                            </SizerItem>
                            <SizerItem flag={CV} border={5}>
                              <BitmapButton
                                bitmap="text_italic"
                                tooltip={_('Italic')}
                                checked={p.m_italic.checked}
                                onClick={p.m_italic.onClick}
                              />
                            </SizerItem>
                            <SizerItem flag={CV} border={5}>
                              <BitmapButtonSeparator />
                            </SizerItem>
                            {align(
                              'left',
                              'text_align_left',
                              _('Align left'),
                              p.hAlign,
                              p.onHAlign,
                            )}
                            {align(
                              'center',
                              'text_align_center',
                              _('Align horizontal center'),
                              p.hAlign,
                              p.onHAlign,
                            )}
                            {align(
                              'right',
                              'text_align_right',
                              _('Align right'),
                              p.hAlign,
                              p.onHAlign,
                            )}
                            <SizerItem flag={wxALL} border={5}>
                              <BitmapButtonSeparator />
                            </SizerItem>
                            {align('top', 'text_valign_top', _('Align top'), p.vAlign, p.onVAlign)}
                            {align(
                              'center',
                              'text_valign_center',
                              _('Align vertical center'),
                              p.vAlign,
                              p.onVAlign,
                            )}
                            {align(
                              'bottom',
                              'text_valign_bottom',
                              _('Align bottom'),
                              p.vAlign,
                              p.onVAlign,
                            )}
                          </BoxSizer>
                        </SizerItem>
                      </FlexGridSizer>
                    </SizerItem>
                    <SizerItem flag={wxEXPAND | wxTOP} border={5}>
                      {/* gbSizer1 = wxGridBagSizer( 3, 5 ), SetEmptyCellSize( wxSize( -1, 8 ) ) */}
                      <GridBagSizer vgap={3} hgap={5} emptyCellSize={[-1, 8]}>
                        {sizeRow(0, p.m_textWidth)}
                        {sizeRow(1, p.m_textHeight)}
                        {sizeRow(2, p.m_textThickness)}
                        <SizerItem pos={[2, 3]} flag={CV} border={5}>
                          <BitmapButton
                            bitmap="edit_cmp_symb_links"
                            tooltip={_('Adjust the text thickness')}
                            checked={p.m_autoTextThickness.checked}
                            onClick={p.m_autoTextThickness.onClick}
                          />
                        </SizerItem>
                      </GridBagSizer>
                    </SizerItem>
                    <Spacer width={0} height={20} flag={wxEXPAND} border={5} />
                    <SizerItem flag={wxEXPAND} border={5}>
                      {/* gMarginsSizer = wxGridSizer( 0, 3, 4, 2 ) */}
                      <FlexGridSizer cols={3} vgap={4} hgap={2}>
                        <SizerItem flag={CV} border={5}>
                          <StaticText label={_('Cell margins:')} />
                        </SizerItem>
                        {margin('Top margin', p.m_marginTop)}
                        <SizerItem flag={CV | wxLEFT} border={2}>
                          <StaticText label={p.m_marginTop.units} />
                        </SizerItem>
                        {margin('Left margin', p.m_marginLeft)}
                        <Spacer width={0} height={0} proportion={1} flag={wxEXPAND} border={5} />
                        {margin('Right margin', p.m_marginRight)}
                        <Spacer width={0} height={0} proportion={1} flag={wxEXPAND} border={5} />
                        {margin('Bottom margin', p.m_marginBottom)}
                      </FlexGridSizer>
                    </SizerItem>
                  </BoxSizer>
                </SizerItem>
              </BoxSizer>
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND} border={5}>
          {/* bButtons */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem flag={CV | wxLEFT} border={10}>
              <Button
                label={_('Edit Table...')}
                title={_('Edit table properties and cell contents')}
                onClick={p.onEditTable}
              />
            </SizerItem>
            <SizerItem flag={CV | wxLEFT} border={10}>
              <HyperlinkCtrl
                label={_('Syntax help')}
                title={_('Show syntax help window')}
                onClick={p.onSyntaxHelp}
              />
            </SizerItem>
            <Spacer width={0} height={0} proportion={1} flag={wxEXPAND} border={5} />
            <SizerItem flag={wxEXPAND | wxALL} border={5}>
              <StdDialogButtonSizer onOk={p.onOK} onCancel={p.onCancel} />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
