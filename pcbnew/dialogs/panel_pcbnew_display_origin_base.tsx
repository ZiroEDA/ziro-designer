// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_PCBNEW_DISPLAY_ORIGIN_BASE` (pcbnew/dialogs/panel_pcbnew_display_origin_base.cpp): the
 * panel's sizer tree, Add() for Add(). The Origins & Axes preferences page of both the board and
 * the footprint editor; the behaviour is PANEL_PCBNEW_DISPLAY_ORIGIN's
 * (panel_pcbnew_display_origin.tsx).
 */
import type { JSX } from 'react';
import { RadioButton, StaticLine, StaticText } from '@ziroeda/wx/controls.js';
import {
  wxALL,
  wxBOTTOM,
  wxEXPAND,
  wxHORIZONTAL,
  wxLEFT,
  wxRIGHT,
  wxTOP,
  wxVERTICAL,
} from '@ziroeda/wx/defs.js';
import { BoxSizer, FlexGridSizer, SizerItem, Spacer } from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

type RADIO = { checked: boolean; onSelect: () => void };

export interface PANEL_PCBNEW_DISPLAY_ORIGIN_BASE_PROPS {
  /** The radio groups' DOM names; two panels on one page must not share them. */
  groupName: string;
  /** `m_displayOrigin`, a sizer the class Show()s only for the board editor. */
  displayOriginShown: boolean;
  m_pageOrigin: RADIO;
  m_drillPlaceOrigin: RADIO;
  m_gridOrigin: RADIO;
  m_xIncreasesRight: RADIO;
  m_xIncreasesLeft: RADIO;
  m_yIncreasesUp: RADIO;
  m_yIncreasesDown: RADIO;
}

export function PANEL_PCBNEW_DISPLAY_ORIGIN_BASE(
  p: PANEL_PCBNEW_DISPLAY_ORIGIN_BASE_PROPS,
): JSX.Element {
  const radio = (aLabel: string, r: RADIO, aGroup: string) => (
    <SizerItem flag={wxRIGHT} border={5}>
      <RadioButton
        label={aLabel}
        name={`${p.groupName}-${aGroup}`}
        checked={r.checked}
        onChange={r.onSelect}
      />
    </SizerItem>
  );
  const heading = (aLabel: string) => (
    <>
      <SizerItem flag={wxTOP | wxRIGHT | wxLEFT} border={13}>
        <StaticText label={aLabel} />
      </SizerItem>
      <SizerItem flag={wxEXPAND | wxTOP | wxBOTTOM} border={2}>
        <StaticLine />
      </SizerItem>
    </>
  );

  return (
    // bPanelSizer
    <BoxSizer orient={wxHORIZONTAL}>
      <SizerItem proportion={1} flag={wxTOP | wxRIGHT} border={5}>
        {/* bMargins */}
        <BoxSizer orient={wxHORIZONTAL}>
          <SizerItem proportion={1} flag={wxEXPAND | wxRIGHT} border={5}>
            {/* bLeftSizer */}
            <BoxSizer orient={wxVERTICAL}>
              <SizerItem flag={wxEXPAND} border={5} shown={p.displayOriginShown}>
                {/* m_displayOrigin */}
                <BoxSizer orient={wxVERTICAL}>
                  {heading(_('Display Origin'))}
                  <SizerItem flag={wxEXPAND | wxALL} border={10}>
                    {/* gSizer1 = wxGridSizer( 0, 1, 4, 0 ) */}
                    <FlexGridSizer cols={1} vgap={4} flexibleDirection={0}>
                      {radio(_('Page origin'), p.m_pageOrigin, 'origin')}
                      {radio(_('Drill/place file origin'), p.m_drillPlaceOrigin, 'origin')}
                      {radio(_('Grid origin'), p.m_gridOrigin, 'origin')}
                    </FlexGridSizer>
                  </SizerItem>
                </BoxSizer>
              </SizerItem>
              {heading(_('X Axis'))}
              <SizerItem flag={wxEXPAND | wxALL} border={10}>
                {/* gSizer2 */}
                <FlexGridSizer cols={1} vgap={4} flexibleDirection={0}>
                  {radio(_('Increases right'), p.m_xIncreasesRight, 'x')}
                  {radio(_('Increases left'), p.m_xIncreasesLeft, 'x')}
                </FlexGridSizer>
              </SizerItem>
              {heading(_('Y Axis'))}
              <SizerItem proportion={1} flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={10}>
                {/* gSizer4 */}
                <FlexGridSizer cols={1} vgap={4} flexibleDirection={0}>
                  {radio(_('Increases up'), p.m_yIncreasesUp, 'y')}
                  {radio(_('Increases down'), p.m_yIncreasesDown, 'y')}
                </FlexGridSizer>
              </SizerItem>
            </BoxSizer>
          </SizerItem>
          <SizerItem proportion={1} flag={wxEXPAND | wxRIGHT} border={5}>
            {/* bRightSizer */}
            <BoxSizer orient={wxVERTICAL}>
              <Spacer width={0} height={0} proportion={1} flag={wxEXPAND} border={5} />
            </BoxSizer>
          </SizerItem>
        </BoxSizer>
      </SizerItem>
    </BoxSizer>
  );
}
