// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_PRINT_GENERIC_BASE` (common/dialogs/dialog_print_generic_base.cpp): the sizer tree, Add()
 * for Add(). The members are props; DIALOG_PRINT_GENERIC (dialog_print_generic.tsx) sets the button
 * labels, and its subclasses fill getMainSizer() and getOptionsSizer().
 *
 * Two members are absent rather than hidden. `m_panelPrinters` (PANEL_PRINTER_LIST) is shown only
 * when wx lists printers, and a browser lists none. `m_buttonOption` ("Page Setup...") opens
 * wxPageSetupDialog, and the browser's own print dialog holds the page setup.
 */
import type { JSX, ReactNode } from 'react';
import { DialogShim } from '../dialog_shim.js';
import {
  type CHECK,
  type CHOICE,
  CheckBox,
  Choice,
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
  wxVERTICAL,
} from '@ziroeda/wx/defs.js';
import {
  BoxSizer,
  GridBagSizer,
  SizerItem,
  Spacer,
  StaticBoxSizer,
  StdDialogButtonSizer,
} from '@ziroeda/wx/sizer.js';
import type { PrintScaleMode } from './dialog_print_generic.js';
import { _ } from '@ziroeda/wx/translation.js';

export interface DIALOG_PRINT_GENERIC_BASE_PROPS {
  /** `m_outputMode`: 0 Color, 1 Black and white. */
  m_outputMode: CHOICE;
  /** `m_titleBlock`; ForcePrintBorder() hides it. */
  m_titleBlock: CHECK & { shown: boolean };
  /** `m_scale1` / `m_scaleFit` / `m_scaleCustom`. */
  scaleMode: PrintScaleMode;
  onScaleMode: (aMode: PrintScaleMode) => void;
  m_scaleCustomText: { value: string; onChange: (aText: string) => void };
  /** Items the subclass Inserts at 0 of getMainSizer() (m_bUpperSizer). */
  mainSizerInserts?: ReactNode;
  /** Items the subclass Adds to getOptionsSizer() (m_gbOptionsSizer), from row 2. */
  optionsSizerAdds?: ReactNode;
  /** `m_infoText`, hidden until a subclass sets its label. */
  m_infoText?: string;
  okLabel: string;
  cancelLabel: string;
  onOK: () => void;
  onCancel: () => void;
}

export function DIALOG_PRINT_GENERIC_BASE(p: DIALOG_PRINT_GENERIC_BASE_PROPS): JSX.Element {
  return (
    <DialogShim title={_('Print')} onClose={p.onCancel}>
      {/* bMainSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem proportion={1} flag={wxEXPAND | wxALL} border={5}>
          {/* m_bUpperSizer */}
          <BoxSizer orient={wxHORIZONTAL}>
            {p.mainSizerInserts}
            <SizerItem flag={wxEXPAND} border={5}>
              {/* bRightCol */}
              <BoxSizer orient={wxVERTICAL}>
                <SizerItem proportion={1} flag={wxEXPAND | wxALL} border={5}>
                  {/* m_sbOptionsSizer */}
                  <StaticBoxSizer label={_('Options')} orient={wxVERTICAL}>
                    <SizerItem proportion={1} flag={wxEXPAND | wxBOTTOM | wxRIGHT} border={5}>
                      {/* m_gbOptionsSizer = wxGridBagSizer( 3, 0 ), SetEmptyCellSize( wxSize( -1,10 ) ) */}
                      <GridBagSizer vgap={3} hgap={0} emptyCellSize={[-1, 10]} growableCols={[1]}>
                        <SizerItem
                          pos={[0, 0]}
                          flag={wxALIGN_CENTER_VERTICAL | wxBOTTOM | wxRIGHT | wxLEFT}
                          border={5}
                        >
                          <StaticText label={_('Output mode:')} />
                        </SizerItem>
                        <SizerItem
                          pos={[0, 1]}
                          flag={wxBOTTOM | wxRIGHT | wxLEFT | wxEXPAND}
                          border={5}
                        >
                          <Choice
                            choices={[_('Color'), _('Black and white')]}
                            choice={p.m_outputMode}
                            ariaLabel="Output mode"
                          />
                        </SizerItem>
                        <SizerItem
                          pos={[1, 0]}
                          span={[1, 2]}
                          flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT}
                          border={5}
                          shown={p.m_titleBlock.shown}
                        >
                          <CheckBox
                            label={_('Print drawing sheet')}
                            check={p.m_titleBlock}
                            title={_('Print Frame references.')}
                          />
                        </SizerItem>
                        {p.optionsSizerAdds}
                      </GridBagSizer>
                    </SizerItem>
                  </StaticBoxSizer>
                </SizerItem>
                <SizerItem flag={wxALL | wxEXPAND} border={5}>
                  {/* bScaleSizer */}
                  <StaticBoxSizer label={_('Scale')} orient={wxVERTICAL}>
                    <SizerItem flag={wxRIGHT | wxLEFT} border={5}>
                      <RadioButton
                        label="1:1"
                        name="m_scale"
                        checked={p.scaleMode === '1:1'}
                        onChange={() => p.onScaleMode('1:1')}
                      />
                    </SizerItem>
                    <Spacer width={0} height={5} border={5} />
                    <SizerItem flag={wxRIGHT | wxLEFT} border={5}>
                      <RadioButton
                        label={_('Fit to page')}
                        name="m_scale"
                        checked={p.scaleMode === 'fit'}
                        onChange={() => p.onScaleMode('fit')}
                      />
                    </SizerItem>
                    <Spacer width={0} height={3} flag={wxEXPAND} border={5} />
                    <SizerItem proportion={1} flag={wxEXPAND | wxBOTTOM} border={5}>
                      {/* bSizerScaleCustom */}
                      <BoxSizer orient={wxHORIZONTAL}>
                        <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
                          <RadioButton
                            label={_('Custom:')}
                            name="m_scale"
                            checked={p.scaleMode === 'custom'}
                            onChange={() => p.onScaleMode('custom')}
                          />
                        </SizerItem>
                        <SizerItem proportion={1} flag={wxEXPAND | wxRIGHT} border={5}>
                          <TextCtrl
                            value={p.m_scaleCustomText.value}
                            onChange={p.m_scaleCustomText.onChange}
                            ariaLabel="Custom scale"
                          />
                        </SizerItem>
                      </BoxSizer>
                    </SizerItem>
                  </StaticBoxSizer>
                </SizerItem>
              </BoxSizer>
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxLEFT} border={10}>
          {/* bSizer6 */}
          <BoxSizer orient={wxVERTICAL}>
            <SizerItem
              flag={wxBOTTOM | wxRIGHT | wxLEFT}
              border={5}
              shown={p.m_infoText !== undefined}
            >
              {/* KIUI::GetSmallInfoFont( this ).Italic(), set by the subclass with the label */}
              <StaticText label={p.m_infoText ?? _('Info text')} font="smallInfo" italic />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxLEFT} border={10}>
          {/* bButtonsSizer */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem proportion={1} flag={wxALL | wxEXPAND} border={5}>
              <StdDialogButtonSizer
                okLabel={p.okLabel}
                cancelLabel={p.cancelLabel}
                onOk={p.onOK}
                onCancel={p.onCancel}
              />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
