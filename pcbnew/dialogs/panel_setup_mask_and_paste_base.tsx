// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_SETUP_MASK_AND_PASTE_BASE` (pcbnew/dialogs/panel_setup_mask_and_paste_base.cpp): the
 * panel's sizer tree, Add() for Add(). A Board Setup page; the behaviour is
 * PANEL_SETUP_MASK_AND_PASTE's (panel_setup_mask_and_paste.tsx), whose constructor relabels the
 * paste row and Show( false )s the ratio row.
 */
import type { JSX } from 'react';
// wxArtProvider::GetBitmap( wxART_WARNING ) asks the GTK icon theme: Yaru's, vendored.
import warningIcon from '@ziroeda/bitmaps_png/sources/theme/dialog-warning.png';
import { type CHECK, CheckBox, StaticLine, StaticText, TextCtrl } from '@ziroeda/wx/controls.js';
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
import { BoxSizer, GridBagSizer, SizerItem, Spacer } from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

/** A UNIT_BINDER's label / control / units triple. */
export type FIELD = {
  label: string;
  value: string;
  onChange: (aText: string) => void;
  onBlur: () => void;
  units: string;
  title: string;
  shown?: boolean;
};

export interface PANEL_SETUP_MASK_AND_PASTE_BASE_PROPS {
  m_maskMargin: FIELD;
  m_maskMinWidth: FIELD;
  m_maskToCopperClearance: FIELD;
  m_allowBridges: CHECK;
  m_tentViasFront: CHECK;
  m_tentViasBack: CHECK;
  m_pasteMargin: FIELD;
  m_pasteMarginRatio: FIELD;
  /** m_staticTextInfoPaste */
  m_staticTextInfoPaste: string;
}

const CV = wxALIGN_CENTER_VERTICAL;
const TENT_TIP = _HKI(
  'Tented: vias are covered with solder mask.\nNot tented: vias are not covered with solder mask.',
);

export function PANEL_SETUP_MASK_AND_PASTE_BASE(
  p: PANEL_SETUP_MASK_AND_PASTE_BASE_PROPS,
): JSX.Element {
  /** One gbSizer row: the label, the control, the units, each Add() with its own flags. */
  const row = (aRow: number, f: FIELD, aLabelFlag: number, aUnitsFlag: number) => (
    <>
      <SizerItem pos={[aRow, 0]} flag={aLabelFlag} border={5} shown={f.shown !== false}>
        <StaticText label={f.label} title={f.title} />
      </SizerItem>
      <SizerItem pos={[aRow, 1]} flag={CV} border={5} shown={f.shown !== false}>
        <TextCtrl
          value={f.value}
          onChange={f.onChange}
          onBlur={f.onBlur}
          title={f.title}
          ariaLabel={f.label.replace(/:$/, '')}
        />
      </SizerItem>
      <SizerItem pos={[aRow, 2]} flag={aUnitsFlag} border={5} shown={f.shown !== false}>
        <StaticText label={f.units} />
      </SizerItem>
    </>
  );
  const heading = (aLabel: string) => (
    <>
      {/* SetFont( wxNORMAL_FONT size, wxFONTWEIGHT_NORMAL ): the dialog's own font. */}
      <SizerItem flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={13}>
        <StaticText label={aLabel} />
      </SizerItem>
      <SizerItem flag={wxEXPAND | wxTOP | wxBOTTOM} border={2}>
        <StaticLine />
      </SizerItem>
    </>
  );

  return (
    // bMainSizer
    <BoxSizer orient={wxVERTICAL}>
      <SizerItem flag={wxRIGHT | wxLEFT | wxEXPAND} border={5}>
        {/* bSizer3 */}
        <BoxSizer orient={wxVERTICAL}>
          <SizerItem flag={wxEXPAND | wxTOP | wxBOTTOM} border={10}>
            {/* bMessages */}
            <BoxSizer orient={wxHORIZONTAL}>
              <SizerItem flag={CV | wxLEFT | wxRIGHT} border={5}>
                {/* m_bitmapWarning */}
                <img src={warningIcon} alt="" />
              </SizerItem>
              <SizerItem proportion={1} flag={wxEXPAND | wxLEFT} border={5}>
                {/* bSizer4 */}
                <BoxSizer orient={wxVERTICAL}>
                  <SizerItem flag={wxEXPAND} border={5}>
                    <StaticText
                      label={_(
                        "Consult your PCB manufacturer's specifications for solder mask expansion, web width, and clearance settings.",
                      )}
                    />
                  </SizerItem>
                  <SizerItem flag={wxEXPAND} border={5}>
                    <StaticText
                      label={_(
                        'If no specifications are provided, setting these values to zero is recommended.',
                      )}
                    />
                  </SizerItem>
                </BoxSizer>
              </SizerItem>
            </BoxSizer>
          </SizerItem>
          <Spacer width={0} height={5} flag={wxEXPAND} border={5} />
          {heading(_('Solder Mask Settings'))}
          <SizerItem flag={wxBOTTOM | wxEXPAND | wxTOP} border={5}>
            {/* gbSizer1 = wxGridBagSizer( 3, 5 ) */}
            <GridBagSizer vgap={3} hgap={5}>
              {row(0, p.m_maskMargin, CV | wxLEFT, CV | wxRIGHT | wxLEFT)}
              {row(1, p.m_maskMinWidth, wxRIGHT | wxLEFT | CV, wxRIGHT | wxLEFT | CV)}
              {row(2, p.m_maskToCopperClearance, CV | wxRIGHT | wxLEFT, CV | wxRIGHT | wxLEFT)}
              <SizerItem pos={[3, 0]} span={[1, 3]} flag={wxTOP | wxLEFT} border={5}>
                <CheckBox
                  label={_('Allow bridged solder mask apertures between pads within footprints')}
                  title={_(
                    'Disable DRC error checking for solder mask aperture bridging between pads in the same footprint.',
                  )}
                  check={p.m_allowBridges}
                />
              </SizerItem>
              <SizerItem pos={[4, 0]} span={[1, 3]} flag={wxEXPAND | wxTOP | wxBOTTOM} border={5}>
                {/* bSizer6 */}
                <BoxSizer orient={wxHORIZONTAL}>
                  <SizerItem flag={CV | wxRIGHT | wxLEFT} border={5}>
                    <StaticText label={_('Tent vias:')} />
                  </SizerItem>
                  <SizerItem flag={CV | wxLEFT | wxRIGHT} border={5}>
                    <CheckBox label={_('Front')} title={TENT_TIP} check={p.m_tentViasFront} />
                  </SizerItem>
                  <SizerItem flag={CV | wxLEFT} border={5}>
                    <CheckBox label={_('Back')} title={TENT_TIP} check={p.m_tentViasBack} />
                  </SizerItem>
                </BoxSizer>
              </SizerItem>
            </GridBagSizer>
          </SizerItem>
          <Spacer width={0} height={10} flag={wxEXPAND} border={5} />
          {heading(_('Solder Paste Settings'))}
          <SizerItem flag={wxBOTTOM | wxEXPAND | wxTOP} border={5}>
            {/* gbSizer2 = wxGridBagSizer( 3, 5 ) */}
            <GridBagSizer vgap={3} hgap={5}>
              {row(0, p.m_pasteMargin, CV | wxLEFT, CV)}
              {row(1, p.m_pasteMarginRatio, CV | wxLEFT, CV)}
            </GridBagSizer>
          </SizerItem>
          <Spacer width={0} height={0} proportion={2} flag={wxEXPAND} border={5} />
          <SizerItem flag={wxALL | wxEXPAND} border={5}>
            {/* the class's SetFont( KIUI::GetInfoFont( this ).Italic() ) */}
            <StaticText label={p.m_staticTextInfoPaste} font="info" italic />
          </SizerItem>
          <Spacer width={0} height={0} proportion={1} flag={wxEXPAND} border={5} />
        </BoxSizer>
      </SizerItem>
    </BoxSizer>
  );
}
