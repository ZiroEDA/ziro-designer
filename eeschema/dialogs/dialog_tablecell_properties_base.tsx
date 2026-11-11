// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_TABLECELL_PROPERTIES_BASE` (eeschema/dialogs/dialog_tablecell_properties_base.cpp): the
 * sizer tree, Add() for Add() - the cell text beside the formatting column (alignment buttons,
 * font, size, three-state Bold / Italic, the two colour books, the margins grid), then Edit
 * Table..., Syntax help and the standard pair. The behaviour is DIALOG_TABLECELL_PROPERTIES's.
 *
 * m_cellTextCtrl is a wxStyledTextCtrl upstream; here a multi-line wxTextCtrl (no Scintilla).
 */
import type { JSX } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import type { Color4d } from '@ziroeda/common/gal/color4d.js';
import { BitmapButton } from '@ziroeda/common/widgets/bitmap_button.js';
import { ColorSwatch } from '@ziroeda/common/widgets/color_swatch.js';
import { FontChoice } from '@ziroeda/common/widgets/font_choice.js';
import { Infobar } from '@ziroeda/common/widgets/wx_infobar.js';
import {
  Button,
  type CHOICE,
  Choice,
  HyperlinkCtrl,
  Panel,
  StaticText,
  TextCtrl,
} from '@ziroeda/wx/controls.js';
import {
  wxALIGN_CENTER_HORIZONTAL,
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
import { Simplebook } from '@ziroeda/wx/simplebook.js';
import {
  BoxSizer,
  FlexGridSizer,
  GridBagSizer,
  SizerItem,
  Spacer,
  StdDialogButtonSizer,
  StretchSpacer,
} from '@ziroeda/wx/sizer.js';
import { type CHECK3, TriStateCheck } from '@ziroeda/wx/wx_checkbox.js';
import { _ } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

/** One BITMAP_BUTTON of an alignment group. */
export interface ALIGN_BUTTON {
  bitmap: string;
  tooltip: string;
  checked: boolean;
  onClick: () => void;
}

/** A colour book: page 0 the "-- mixed values --" / "Set Color..." popup, page 1 the swatch. */
export interface COLOR_BOOK {
  page: number;
  popup: CHOICE;
  color: Color4d;
  onColor: (aColor: Color4d) => void;
  /** GetNewSwatchColor() as the swatch page comes up. */
  pickNow: boolean;
}

export interface DIALOG_TABLECELL_PROPERTIES_BASE_PROPS {
  m_infoBar: string | null;
  m_cellTextCtrl: string;
  onCellText: (aText: string) => void;
  hAlign: readonly ALIGN_BUTTON[];
  vAlign: readonly ALIGN_BUTTON[];
  /** FONT_CHOICE: '' is "Default Font". */
  font: string;
  onFont: (aFace: string) => void;
  m_textSizeCtrl: string;
  onTextSize: (aText: string) => void;
  /** The UNIT_BINDERs' units (`m_textSizeUnits`, `m_marginTopUnits`). */
  units: string;
  m_bold: CHECK3;
  m_italic: CHECK3;
  m_textColorBook: COLOR_BOOK;
  m_fillColorBook: COLOR_BOOK;
  m_marginTopCtrl: string;
  m_marginLeftCtrl: string;
  m_marginRightCtrl: string;
  m_marginBottomCtrl: string;
  onMargin: (aWhich: 'top' | 'left' | 'right' | 'bottom', aText: string) => void;
  onEditTable: () => void;
  onFormattingHelp: () => void;
  onOK: () => void;
  onCancel: () => void;
}

const COLOR_POPUP = [_HKI('-- mixed values --'), _HKI('Set Color...')];

function AlignButtons({ buttons }: { buttons: readonly ALIGN_BUTTON[] }): JSX.Element {
  return (
    <BoxSizer orient={wxHORIZONTAL}>
      {buttons.map((b) => (
        <SizerItem key={b.bitmap} flag={wxALIGN_CENTER_VERTICAL} border={5}>
          <BitmapButton
            bitmap={b.bitmap}
            tooltip={b.tooltip}
            checked={b.checked}
            onClick={b.onClick}
          />
        </SizerItem>
      ))}
    </BoxSizer>
  );
}

function ColorBook({ label, b }: { label: string; b: COLOR_BOOK }): JSX.Element {
  return (
    <Simplebook
      selection={b.page}
      pages={[
        // textColorPopupPanel: bSizer20
        <BoxSizer key="popup" orient={wxVERTICAL}>
          <SizerItem flag={0} border={5}>
            <Choice choices={COLOR_POPUP} choice={b.popup} ariaLabel={label} />
          </SizerItem>
        </BoxSizer>,
        // textColorSwatchPanel: bSizer222, m_panelTextColor (wxBORDER_SIMPLE)
        <BoxSizer key="swatch" orient={wxHORIZONTAL}>
          <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
            <Panel border="simple">
              <BoxSizer orient={wxVERTICAL}>
                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxALIGN_CENTER_HORIZONTAL} border={5}>
                  {b.page === 1 && (
                    <ColorSwatch
                      label={label}
                      color={b.color}
                      onChange={b.onColor}
                      openOnMount={b.pickNow}
                    />
                  )}
                </SizerItem>
              </BoxSizer>
            </Panel>
          </SizerItem>
        </BoxSizer>,
      ]}
    />
  );
}

export function DIALOG_TABLECELL_PROPERTIES_BASE(
  p: DIALOG_TABLECELL_PROPERTIES_BASE_PROPS,
): JSX.Element {
  return (
    <DialogShim title={_('Table Cell Properties')} onClose={p.onCancel}>
      {/* bMainSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem flag={wxEXPAND | wxBOTTOM} border={5} shown={p.m_infoBar !== null}>
          <Infobar message={p.m_infoBar ?? ''} />
        </SizerItem>
        <SizerItem proportion={1} flag={wxEXPAND | wxLEFT} border={5}>
          {/* bSizer151 > bSizer16 */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem proportion={1} flag={wxEXPAND | wxRIGHT} border={10}>
              {/* bSizer18 */}
              <BoxSizer orient={wxVERTICAL}>
                <SizerItem flag={wxALL} border={5}>
                  <StaticText label={_('Cell contents:')} />
                </SizerItem>
                <SizerItem proportion={1} flag={wxEXPAND | wxALL} border={5} minSize={[200, 100]}>
                  {/* m_cellTextCtrl, SetInitialFocus */}
                  <TextCtrl
                    multiLine
                    value={p.m_cellTextCtrl}
                    onChange={p.onCellText}
                    autoFocus
                    ariaLabel="Cell contents"
                  />
                </SizerItem>
              </BoxSizer>
            </SizerItem>
            <SizerItem proportion={1} flag={wxEXPAND | wxLEFT} border={5}>
              {/* bSizer17 */}
              <BoxSizer orient={wxVERTICAL}>
                <SizerItem proportion={1} flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={5}>
                  {/* bSizer13 */}
                  <BoxSizer orient={wxVERTICAL}>
                    <Spacer width={0} height={20} border={5} />
                    <SizerItem flag={wxEXPAND} border={5}>
                      {/* fgTextStyleSizer = wxFlexGridSizer( 0, 2, 5, 5 ) */}
                      <FlexGridSizer cols={2} vgap={5} hgap={5}>
                        <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={5}>
                          <StaticText
                            label={_('Horizontal alignment:')}
                            title={_('Horizontal alignment')}
                          />
                        </SizerItem>
                        <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                          <AlignButtons buttons={p.hAlign} />
                        </SizerItem>
                        <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={5}>
                          <StaticText
                            label={_('Vertical alignment:')}
                            title={_('Vertical alignment')}
                          />
                        </SizerItem>
                        <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                          <AlignButtons buttons={p.vAlign} />
                        </SizerItem>
                      </FlexGridSizer>
                    </SizerItem>
                    <SizerItem proportion={1} flag={wxEXPAND | wxALL} border={5}>
                      {/* bMargins */}
                      <BoxSizer orient={wxVERTICAL}>
                        <Spacer width={0} height={10} flag={wxEXPAND} border={5} />
                        <SizerItem flag={wxEXPAND | wxBOTTOM} border={5}>
                          {/* gbFontSizer = wxGridBagSizer( 6, 5 ), SetEmptyCellSize( -1, 5 ),
                              AddGrowableCol( 1 ) */}
                          <GridBagSizer
                            vgap={6}
                            hgap={5}
                            emptyCellSize={[-1, 5]}
                            growableCols={[1]}
                          >
                            <SizerItem
                              pos={[3, 0]}
                              span={[1, 1]}
                              flag={wxALIGN_CENTER_VERTICAL | wxTOP}
                              border={1}
                            >
                              <StaticText label={_('Style:')} />
                            </SizerItem>
                            <SizerItem
                              pos={[3, 1]}
                              span={[1, 1]}
                              flag={wxEXPAND | wxTOP}
                              border={1}
                            >
                              {/* bSizer14: m_bold, m_italic (wxCHK_3STATE |
                                  wxCHK_ALLOW_3RD_STATE_FOR_USER) */}
                              <BoxSizer orient={wxHORIZONTAL}>
                                <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                                  <TriStateCheck label={_('Bold')} check={p.m_bold} />
                                </SizerItem>
                                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={45}>
                                  <TriStateCheck label={_('Italic')} check={p.m_italic} />
                                </SizerItem>
                              </BoxSizer>
                            </SizerItem>
                            <SizerItem
                              pos={[1, 0]}
                              span={[1, 1]}
                              flag={wxALIGN_CENTER_VERTICAL | wxLEFT}
                              border={1}
                            >
                              <StaticText label={_('Font:')} />
                            </SizerItem>
                            <SizerItem
                              pos={[1, 1]}
                              span={[1, 3]}
                              flag={wxALIGN_CENTER_VERTICAL | wxEXPAND}
                              border={5}
                            >
                              <FontChoice face={p.font} onChange={p.onFont} />
                            </SizerItem>
                            <SizerItem
                              pos={[2, 0]}
                              span={[1, 1]}
                              flag={wxALIGN_CENTER_VERTICAL}
                              border={5}
                            >
                              <StaticText label={_('Size:')} />
                            </SizerItem>
                            <SizerItem
                              pos={[2, 1]}
                              span={[1, 3]}
                              flag={wxALIGN_CENTER_VERTICAL}
                              border={5}
                            >
                              {/* bSizer15 */}
                              <BoxSizer orient={wxHORIZONTAL}>
                                <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                                  <TextCtrl
                                    value={p.m_textSizeCtrl}
                                    onChange={p.onTextSize}
                                    ariaLabel="Size"
                                  />
                                </SizerItem>
                                <SizerItem flag={wxLEFT | wxALIGN_CENTER_VERTICAL} border={3}>
                                  <StaticText label={p.units} />
                                </SizerItem>
                              </BoxSizer>
                            </SizerItem>
                          </GridBagSizer>
                        </SizerItem>
                        <SizerItem flag={wxEXPAND | wxTOP | wxBOTTOM} border={20}>
                          {/* fgColorSizer = wxFlexGridSizer( 0, 2, 4, 5 ) */}
                          <FlexGridSizer cols={2} vgap={4} hgap={5}>
                            <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                              <StaticText label={_('Text color:')} />
                            </SizerItem>
                            <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                              <ColorBook label="Text color" b={p.m_textColorBook} />
                            </SizerItem>
                            <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                              <StaticText label={_('Background fill:')} />
                            </SizerItem>
                            <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                              <ColorBook label={_('Background fill')} b={p.m_fillColorBook} />
                            </SizerItem>
                          </FlexGridSizer>
                        </SizerItem>
                        <Spacer width={0} height={5} flag={wxEXPAND} border={5} />
                        <SizerItem flag={wxEXPAND} border={5}>
                          {/* gMarginsSizer = wxGridSizer( 0, 3, 4, 2 ) */}
                          <FlexGridSizer cols={3} vgap={4} hgap={2} flexibleDirection={0}>
                            <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                              <StaticText label={_('Cell margins:')} />
                            </SizerItem>
                            <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                              <TextCtrl
                                value={p.m_marginTopCtrl}
                                onChange={(t) => p.onMargin('top', t)}
                                ariaLabel="Top margin"
                              />
                            </SizerItem>
                            <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={2}>
                              <StaticText label={p.units} />
                            </SizerItem>
                            <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                              <TextCtrl
                                value={p.m_marginLeftCtrl}
                                onChange={(t) => p.onMargin('left', t)}
                                ariaLabel="Left margin"
                              />
                            </SizerItem>
                            <StretchSpacer />
                            <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                              <TextCtrl
                                value={p.m_marginRightCtrl}
                                onChange={(t) => p.onMargin('right', t)}
                                ariaLabel="Right margin"
                              />
                            </SizerItem>
                            <StretchSpacer />
                            <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
                              <TextCtrl
                                value={p.m_marginBottomCtrl}
                                onChange={(t) => p.onMargin('bottom', t)}
                                ariaLabel="Bottom margin"
                              />
                            </SizerItem>
                          </FlexGridSizer>
                        </SizerItem>
                      </BoxSizer>
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
            <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={10}>
              <Button
                label={_('Edit Table...')}
                title={_('Edit table properties and cell contents')}
                onClick={p.onEditTable}
              />
            </SizerItem>
            <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={10}>
              <HyperlinkCtrl
                label={_('Syntax help')}
                title={_('Show syntax help window')}
                onClick={p.onFormattingHelp}
              />
            </SizerItem>
            <StretchSpacer />
            <SizerItem flag={wxEXPAND | wxALL} border={5}>
              <StdDialogButtonSizer onOk={p.onOK} onCancel={p.onCancel} />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
