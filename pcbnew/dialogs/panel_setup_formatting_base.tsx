// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_SETUP_FORMATTING_BASE` (pcbnew/dialogs/panel_setup_formatting_base.cpp): the panel's
 * sizer tree, Add() for Add(). A Board Setup page; the behaviour is PANEL_SETUP_FORMATTING's
 * (panel_setup_formatting.tsx).
 */
import type { JSX } from 'react';
import { type CHECK, CheckBox, StaticLine, StaticText, TextCtrl } from '@ziroeda/wx/controls.js';
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
import { BoxSizer, FlexGridSizer, SizerItem, Spacer } from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

type ENTRY = { value: string; onChange: (aText: string) => void };

export interface PANEL_SETUP_FORMATTING_BASE_PROPS {
  m_dashLengthCtrl: ENTRY;
  m_gapLengthCtrl: ENTRY;
  m_styleFields: CHECK;
  m_styleText: CHECK;
  m_styleShapes: CHECK;
  m_styleDimensions: CHECK;
  m_styleBarcodes: CHECK;
}

const CV = wxALIGN_CENTER_VERTICAL;

export function PANEL_SETUP_FORMATTING_BASE(p: PANEL_SETUP_FORMATTING_BASE_PROPS): JSX.Element {
  const style = (aLabel: string, c: CHECK) => (
    <SizerItem flag={wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
      <CheckBox label={aLabel} check={c} />
    </SizerItem>
  );

  return (
    // bMainSizer
    <BoxSizer orient={wxVERTICAL}>
      <SizerItem proportion={1} flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={5}>
        {/* bMargins */}
        <BoxSizer orient={wxVERTICAL}>
          <SizerItem flag={wxTOP | wxRIGHT | wxLEFT} border={8}>
            <StaticText label={_('Dashed Lines')} />
          </SizerItem>
          <SizerItem flag={wxEXPAND | wxBOTTOM | wxRIGHT} border={5}>
            <StaticLine />
          </SizerItem>
          <SizerItem flag={wxEXPAND | wxRIGHT | wxLEFT} border={5}>
            {/* fgSizer41 = wxFlexGridSizer( 0, 2, 5, 0 ) */}
            <FlexGridSizer cols={2} vgap={5}>
              <SizerItem flag={CV | wxLEFT | wxRIGHT} border={5}>
                <StaticText label={_('Dash length:')} />
              </SizerItem>
              <SizerItem flag={CV} border={5}>
                <TextCtrl
                  value={p.m_dashLengthCtrl.value}
                  onChange={p.m_dashLengthCtrl.onChange}
                  ariaLabel="Dash length"
                />
              </SizerItem>
              <SizerItem flag={CV | wxLEFT | wxRIGHT} border={5}>
                <StaticText label={_('Gap length:')} />
              </SizerItem>
              <SizerItem flag={CV} border={5}>
                <TextCtrl
                  value={p.m_gapLengthCtrl.value}
                  onChange={p.m_gapLengthCtrl.onChange}
                  ariaLabel="Gap length"
                />
              </SizerItem>
            </FlexGridSizer>
          </SizerItem>
          <SizerItem flag={wxALL} border={10}>
            {/* the constructor's SetFont( KIUI::GetInfoFont( this ).Italic() ) */}
            <StaticText
              label={_('Dash and dot lengths are ratios of the line width.')}
              font="info"
              italic
            />
          </SizerItem>
          <Spacer width={0} height={10} flag={wxEXPAND} border={5} />
          <SizerItem flag={wxTOP | wxRIGHT | wxLEFT} border={8}>
            <StaticText label={_('When Adding Footprints to Board')} />
          </SizerItem>
          <SizerItem flag={wxEXPAND | wxBOTTOM} border={5}>
            <StaticLine />
          </SizerItem>
          <SizerItem proportion={1} flag={wxEXPAND | wxTOP | wxLEFT} border={5}>
            {/* bSizer3 */}
            <BoxSizer orient={wxVERTICAL}>
              {style(_('Apply board defaults to footprint fields'), p.m_styleFields)}
              {style(_('Apply board defaults to footprint text'), p.m_styleText)}
              {style(_('Apply board defaults to non-copper footprint shapes'), p.m_styleShapes)}
              {style(_('Apply board defaults to footprint dimensions'), p.m_styleDimensions)}
              {style(_('Apply board defaults to footprint barcodes'), p.m_styleBarcodes)}
            </BoxSizer>
          </SizerItem>
        </BoxSizer>
      </SizerItem>
    </BoxSizer>
  );
}
