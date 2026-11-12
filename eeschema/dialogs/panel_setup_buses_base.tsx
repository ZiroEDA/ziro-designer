// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_SETUP_BUSES_BASE` (eeschema/dialogs/panel_setup_buses_base.cpp): the panel's sizer tree,
 * Add() for Add() - Bus Definitions (the 180 px aliases grid, add / 20 px / delete, the source
 * text) beside m_membersBook, a wxSimplebook whose first page holds the members grid and whose
 * second is the disabled empty panel shown while no alias is selected. A Schematic Setup page.
 */
import type { JSX, ReactNode } from 'react';
import { StdBitmapButton } from '@ziroeda/common/widgets/std_bitmap_button.js';
import { Panel, StaticText } from '@ziroeda/wx/controls.js';
import {
  wxALIGN_CENTER_VERTICAL,
  wxBOTTOM,
  wxEXPAND,
  wxHORIZONTAL,
  wxLEFT,
  wxRIGHT,
  wxTOP,
  wxVERTICAL,
} from '@ziroeda/wx/defs.js';
import { Simplebook } from '@ziroeda/wx/simplebook.js';
import { BoxSizer, SizerItem, Spacer } from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

export interface PANEL_SETUP_BUSES_BASE_PROPS {
  m_aliasesGrid: ReactNode;
  onAddAlias: () => void;
  onDeleteAlias: () => void;
  /** m_source: where the selected alias was defined. */
  m_source: string;
  /** m_membersBook: 0 the members page, 1 the empty one. */
  membersPage: number;
  /** m_membersLabel: "Members of '%s'". */
  m_membersLabel: string;
  m_membersGrid: ReactNode;
  onAddMember: () => void;
  onRemoveMember: () => void;
}

export function PANEL_SETUP_BUSES_BASE(p: PANEL_SETUP_BUSES_BASE_PROPS): JSX.Element {
  const membersPanel = (
    // bSizer7
    <BoxSizer orient={wxVERTICAL}>
      <SizerItem flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={8}>
        <StaticText label={p.m_membersLabel} />
      </SizerItem>
      <Spacer width={0} height={3} flag={wxEXPAND} border={5} />
      <SizerItem proportion={1} flag={wxEXPAND} border={5} minSize={[-1, 180]}>
        {p.m_membersGrid}
      </SizerItem>
      <SizerItem flag={wxEXPAND | wxTOP} border={3}>
        {/* bSizer101 */}
        <BoxSizer orient={wxHORIZONTAL}>
          <SizerItem flag={wxBOTTOM} border={5}>
            <StdBitmapButton
              bitmap="small_plus"
              title={_('Add member')}
              tooltip={null}
              onClick={p.onAddMember}
            />
          </SizerItem>
          <Spacer width={20} height={0} flag={wxEXPAND} border={5} />
          <SizerItem flag={wxBOTTOM | wxLEFT} border={5}>
            <StdBitmapButton
              bitmap="small_trash"
              title={_('Remove member')}
              tooltip={null}
              onClick={p.onRemoveMember}
            />
          </SizerItem>
        </BoxSizer>
      </SizerItem>
    </BoxSizer>
  );

  return (
    // bPanelSizer
    <BoxSizer orient={wxHORIZONTAL}>
      <SizerItem proportion={1} flag={wxEXPAND} border={5}>
        {/* bMargins */}
        <BoxSizer orient={wxHORIZONTAL}>
          <SizerItem proportion={1} flag={wxEXPAND | wxRIGHT} border={5}>
            {/* bLeftCol */}
            <BoxSizer orient={wxVERTICAL}>
              <SizerItem flag={wxLEFT | wxTOP} border={8}>
                <StaticText label={_('Bus Definitions')} />
              </SizerItem>
              <Spacer width={0} height={3} flag={wxEXPAND} border={5} />
              <SizerItem proportion={1} flag={wxEXPAND} border={5} minSize={[-1, 180]}>
                {p.m_aliasesGrid}
              </SizerItem>
              <SizerItem flag={wxEXPAND | wxTOP} border={3}>
                {/* bSizer10 */}
                <BoxSizer orient={wxHORIZONTAL}>
                  <SizerItem flag={wxBOTTOM} border={5}>
                    <StdBitmapButton
                      bitmap="small_plus"
                      title={_('Add alias')}
                      tooltip={null}
                      onClick={p.onAddAlias}
                    />
                  </SizerItem>
                  <Spacer width={20} height={0} flag={wxEXPAND} border={5} />
                  <SizerItem flag={wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
                    <StdBitmapButton
                      bitmap="small_trash"
                      title={_('Delete alias')}
                      tooltip={null}
                      onClick={p.onDeleteAlias}
                    />
                  </SizerItem>
                  <Spacer width={15} height={0} proportion={1} border={5} />
                  <SizerItem
                    flag={wxALIGN_CENTER_VERTICAL | wxBOTTOM | wxRIGHT | wxLEFT}
                    border={5}
                  >
                    <StaticText label={p.m_source} />
                  </SizerItem>
                </BoxSizer>
              </SizerItem>
            </BoxSizer>
          </SizerItem>
          <SizerItem proportion={1} flag={wxEXPAND | wxLEFT} border={5}>
            {/* bRightColumn > m_membersBook */}
            <BoxSizer orient={wxVERTICAL}>
              <SizerItem proportion={1} flag={wxEXPAND} border={5}>
                <Simplebook
                  selection={p.membersPage}
                  pages={[membersPanel, <Panel key="empty">{null}</Panel>]}
                />
              </SizerItem>
            </BoxSizer>
          </SizerItem>
        </BoxSizer>
      </SizerItem>
    </BoxSizer>
  );
}
