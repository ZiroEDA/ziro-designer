// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_SETUP_TRACKS_AND_VIAS_BASE` (pcbnew/dialogs/panel_setup_tracks_and_vias_base.cpp): Board
 * Setup's Pre-defined Sizes - three columns at proportions 1, 2 and 3 (tracks, vias, differential
 * pairs), each a label, its WX_GRID and an add / sort / remove row. The behaviour is
 * PANEL_SETUP_TRACKS_AND_VIAS's (panel_setup_tracks_and_vias.tsx).
 */
import type { JSX, ReactNode } from 'react';
import { StdBitmapButton } from '@ziroeda/common/widgets/std_bitmap_button.js';
import { StaticText } from '@ziroeda/wx/controls.js';
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
import { BoxSizer, SizerItem, Spacer } from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

export interface SIZE_GRID {
  grid: ReactNode;
  onAdd: () => void;
  onSort: () => void;
  onRemove: () => void;
}

export interface PANEL_SETUP_TRACKS_AND_VIAS_BASE_PROPS {
  m_trackWidths: SIZE_GRID;
  m_viaSizes: SIZE_GRID;
  m_diffPairs: SIZE_GRID;
}

export function PANEL_SETUP_TRACKS_AND_VIAS_BASE(
  p: PANEL_SETUP_TRACKS_AND_VIAS_BASE_PROPS,
): JSX.Element {
  /**
   * One column. The class's SetBitmap()s give the buttons small_plus / small_sort_desc /
   * small_trash; the base gives them no tooltip. The remove button sits 25 px out on the tracks
   * column, and behind a 20 px spacer on the other two.
   */
  const column = (aTitle: string, g: SIZE_GRID, aGridFlag: number, aTracks: boolean) => (
    <BoxSizer orient={wxVERTICAL}>
      <SizerItem flag={wxALL} border={5}>
        <StaticText label={aTitle} />
      </SizerItem>
      <SizerItem proportion={1} flag={aGridFlag} border={5}>
        {g.grid}
      </SizerItem>
      <SizerItem flag={wxEXPAND | wxTOP} border={3}>
        <BoxSizer orient={wxHORIZONTAL}>
          <SizerItem flag={wxBOTTOM | wxRIGHT} border={5}>
            <StdBitmapButton
              bitmap="small_plus"
              title={`${aTitle}: add`}
              tooltip={null}
              onClick={g.onAdd}
            />
          </SizerItem>
          <SizerItem flag={wxRIGHT | wxLEFT} border={5}>
            <StdBitmapButton
              bitmap="small_sort_desc"
              title={`${aTitle}: sort`}
              tooltip={null}
              onClick={g.onSort}
            />
          </SizerItem>
          {!aTracks && <Spacer width={20} height={0} flag={wxEXPAND} border={5} />}
          <SizerItem flag={wxLEFT | wxRIGHT} border={aTracks ? 25 : 5}>
            <StdBitmapButton
              bitmap="small_trash"
              title={`${aTitle}: remove`}
              tooltip={null}
              onClick={g.onRemove}
            />
          </SizerItem>
        </BoxSizer>
      </SizerItem>
    </BoxSizer>
  );

  return (
    // bMainSizer
    <BoxSizer orient={wxHORIZONTAL}>
      <SizerItem proportion={1} flag={wxEXPAND} border={5}>
        {column(_('Tracks'), p.m_trackWidths, wxEXPAND | wxRIGHT, true)}
      </SizerItem>
      <SizerItem proportion={2} flag={wxEXPAND} border={5}>
        {column(_('Vias'), p.m_viaSizes, wxEXPAND | wxRIGHT, false)}
      </SizerItem>
      <SizerItem proportion={3} flag={wxEXPAND} border={5}>
        {column(_('Differential Pairs'), p.m_diffPairs, wxEXPAND, false)}
      </SizerItem>
    </BoxSizer>
  );
}
