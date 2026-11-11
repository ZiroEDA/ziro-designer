// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_DISPLAY_OPTIONS_BASE` (pcbnew/dialogs/panel_display_options_base.cpp): the board and
 * footprint editors' Display Options page, Add() for Add(). bSizer11 on the left holds
 * m_galOptionsSizer (the class Add()s PANEL_GAL_OPTIONS to it) over Pads and Clearance Outlines;
 * on the right m_optionsBook, a wxSimplebook whose page 0 is empty (the footprint editor) and page 1
 * holds Annotations, Selection && Highlighting and Cross-probing (the PCB editor). The behaviour is
 * PANEL_DISPLAY_OPTIONS's (panel_display_options.tsx).
 */
import type { JSX, ReactNode } from 'react';
import {
  type CHECK,
  type CHOICE,
  CheckBox,
  Choice,
  Panel,
  StaticLine,
  StaticText,
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
import { Simplebook } from '@ziroeda/wx/simplebook.js';
import { BoxSizer, GridBagSizer, SizerItem, Spacer } from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

export interface PANEL_DISPLAY_OPTIONS_BASE_PROPS {
  /** What the class Add()s to m_galOptionsSizer: m_galOptsPanel. */
  m_galOptionsSizer: ReactNode;
  m_OptUseViaColorForNormalTHPadstacks: CHECK;
  m_OptDisplayTracksClearance: CHOICE;
  m_OptDisplayPadClearence: CHECK;
  /** m_optionsBook->SetSelection( m_isPCBEdit ? 1 : 0 ). */
  optionsPage: 0 | 1;
  m_ShowNetNamesOption: CHOICE;
  m_OptDisplayPadNumber: CHECK;
  m_checkForceShowFieldsWhenFPSelected: CHECK;
  m_checkCrossProbeOnSelection: CHECK;
  m_checkCrossProbeCenter: CHECK;
  m_checkCrossProbeZoom: CHECK;
  m_checkCrossProbeAutoHighlight: CHECK;
  m_checkCrossProbeFlash: CHECK;
  m_live3Drefresh: CHECK;
}

const CV = wxALIGN_CENTER_VERTICAL;

/** A heading and its rule: `Add( label, 0, wxTOP|wxRIGHT|wxLEFT [|wxEXPAND], 13 )`, the line 2. */
function Heading({ label, expand }: { label: string; expand?: boolean }): JSX.Element {
  return (
    <>
      <SizerItem flag={wxTOP | wxRIGHT | wxLEFT | (expand ? wxEXPAND : 0)} border={13}>
        <StaticText label={label} />
      </SizerItem>
      <SizerItem flag={wxEXPAND | wxTOP | wxBOTTOM} border={2}>
        <StaticLine />
      </SizerItem>
    </>
  );
}

export function PANEL_DISPLAY_OPTIONS_BASE(p: PANEL_DISPLAY_OPTIONS_BASE_PROPS): JSX.Element {
  const pcbPage = (
    // pcbOptionsSizer
    <BoxSizer orient={wxVERTICAL}>
      <SizerItem flag={wxEXPAND} border={5}>
        {/* bMargins */}
        <BoxSizer orient={wxVERTICAL}>
          <Heading label={_('Annotations')} />
          <SizerItem proportion={1} flag={wxEXPAND | wxRIGHT | wxLEFT} border={5}>
            {/* gbSizer1 = wxGridBagSizer( 2, 0 ) */}
            <GridBagSizer vgap={2} hgap={0}>
              <SizerItem pos={[0, 0]} flag={CV | wxTOP | wxLEFT} border={5}>
                <StaticText label={_('Net names:')} />
              </SizerItem>
              <SizerItem pos={[0, 1]} flag={CV | wxTOP | wxRIGHT | wxLEFT} border={5}>
                <Choice
                  choices={[
                    _('Do not show'),
                    _('Show on pads'),
                    _('Show on tracks'),
                    _('Show on pads & tracks'),
                  ]}
                  choice={p.m_ShowNetNamesOption}
                  ariaLabel={_('Net names')}
                />
              </SizerItem>
              <SizerItem pos={[1, 0]} span={[1, 2]} flag={wxALL} border={5}>
                <CheckBox label={_('Show pad numbers')} check={p.m_OptDisplayPadNumber} />
              </SizerItem>
            </GridBagSizer>
          </SizerItem>
          <Spacer width={0} height={8} border={5} />
          {/* _("Selection && Highlighting"): && is wx's escape for one ampersand. */}
          <Heading label={_('Selection & Highlighting')} />
          <SizerItem flag={wxEXPAND | wxRIGHT | wxLEFT} border={5}>
            {/* bSizer9 */}
            <BoxSizer orient={wxVERTICAL}>
              <SizerItem flag={wxALL} border={5}>
                <CheckBox
                  label={_('Show all fields when parent footprint is selected')}
                  check={p.m_checkForceShowFieldsWhenFPSelected}
                />
              </SizerItem>
            </BoxSizer>
          </SizerItem>
          <Spacer width={0} height={8} border={5} />
          <Heading label={_('Cross-probing')} expand />
          <SizerItem flag={wxEXPAND | wxRIGHT | wxLEFT} border={5}>
            {/* bSizer8 */}
            <BoxSizer orient={wxVERTICAL}>
              <SizerItem flag={wxALL} border={5}>
                <CheckBox
                  label={_('Select/highlight objects corresponding to schematic selection')}
                  title={_('Highlight footprints corresponding to selected symbols')}
                  check={p.m_checkCrossProbeOnSelection}
                />
              </SizerItem>
              <SizerItem flag={wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
                <CheckBox
                  label={_('Center view on cross-probed items')}
                  title={_('Ensures that cross-probed footprints are visible in the current view')}
                  check={p.m_checkCrossProbeCenter}
                />
              </SizerItem>
              <SizerItem flag={wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
                <CheckBox
                  label={_('Zoom to fit cross-probed items')}
                  check={p.m_checkCrossProbeZoom}
                />
              </SizerItem>
              <SizerItem flag={wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
                <CheckBox
                  label={_('Highlight cross-probed nets')}
                  title={_('Highlight nets when they are highlighted in the schematic editor')}
                  check={p.m_checkCrossProbeAutoHighlight}
                />
              </SizerItem>
              <SizerItem flag={wxBOTTOM | wxLEFT | wxRIGHT} border={5}>
                <CheckBox
                  label={_('Flash cross-probed selection')}
                  title={_('Temporarily flash the newly cross-probed selection 3 times')}
                  check={p.m_checkCrossProbeFlash}
                />
              </SizerItem>
              <SizerItem flag={wxBOTTOM | wxLEFT | wxRIGHT} border={5}>
                <CheckBox
                  label={_('Refresh 3D view automatically')}
                  title={_(
                    'When enabled, edits to the board will cause the 3D view to refresh (may be slow with larger boards)',
                  )}
                  check={p.m_live3Drefresh}
                />
              </SizerItem>
            </BoxSizer>
          </SizerItem>
          <Spacer width={0} height={8} proportion={1} flag={wxEXPAND} border={5} />
        </BoxSizer>
      </SizerItem>
    </BoxSizer>
  );

  return (
    // bMainSizer
    <BoxSizer orient={wxVERTICAL}>
      <SizerItem flag={wxEXPAND} border={5}>
        {/* bupperSizer */}
        <BoxSizer orient={wxHORIZONTAL}>
          <SizerItem proportion={1} flag={wxEXPAND} border={5}>
            {/* bSizer11 */}
            <BoxSizer orient={wxVERTICAL}>
              <SizerItem flag={wxEXPAND | wxRIGHT} border={10}>
                {/* m_galOptionsSizer */}
                <BoxSizer orient={wxVERTICAL}>{p.m_galOptionsSizer}</BoxSizer>
              </SizerItem>
              <Spacer width={0} height={8} border={5} />
              <SizerItem flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={5}>
                {/* bSizerPads */}
                <BoxSizer orient={wxVERTICAL}>
                  <Heading label={_('Pads')} />
                  <SizerItem flag={wxALL} border={5}>
                    <CheckBox
                      label={_('Use via color for normal through hole padstacks')}
                      check={p.m_OptUseViaColorForNormalTHPadstacks}
                    />
                  </SizerItem>
                  <Spacer width={0} height={8} flag={wxEXPAND} border={5} />
                  <Heading label={_('Clearance Outlines')} expand />
                  <SizerItem proportion={1} flag={wxEXPAND | wxRIGHT | wxLEFT} border={5}>
                    {/* gbSizer2 = wxGridBagSizer( 2, 0 ) */}
                    <GridBagSizer vgap={2} hgap={0}>
                      <SizerItem pos={[0, 0]} flag={CV | wxTOP | wxLEFT} border={5}>
                        <StaticText label={_('Tracks:')} />
                      </SizerItem>
                      <SizerItem pos={[0, 1]} flag={CV | wxTOP | wxRIGHT | wxLEFT} border={5}>
                        <Choice
                          choices={[
                            _('Do not show clearances'),
                            _('Show when routing'),
                            _('Show when routing w/ via clearance at end'),
                            _('Show when routing and editing'),
                            _('Show always'),
                          ]}
                          choice={p.m_OptDisplayTracksClearance}
                          ariaLabel="Tracks"
                        />
                      </SizerItem>
                      <SizerItem pos={[1, 0]} span={[1, 2]} flag={wxALL} border={5}>
                        <CheckBox
                          label={_('Show pad clearance')}
                          check={p.m_OptDisplayPadClearence}
                        />
                      </SizerItem>
                    </GridBagSizer>
                  </SizerItem>
                  <Spacer width={0} height={0} proportion={1} flag={wxEXPAND} border={5} />
                </BoxSizer>
              </SizerItem>
            </BoxSizer>
          </SizerItem>
          <Spacer width={15} height={0} border={5} />
          <SizerItem flag={wxEXPAND | wxRIGHT | wxLEFT} border={5}>
            {/* m_optionsBook: fpEditorPage (empty) and pcbPage */}
            <Simplebook selection={p.optionsPage} pages={[<Panel key="fp" />, pcbPage]} />
          </SizerItem>
        </BoxSizer>
      </SizerItem>
    </BoxSizer>
  );
}
