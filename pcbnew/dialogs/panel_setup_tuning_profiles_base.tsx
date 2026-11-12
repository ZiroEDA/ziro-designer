// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_SETUP_TUNING_PROFILES_BASE` (pcbnew/dialogs/panel_setup_tuning_profiles_base.cpp): the
 * m_tuningProfiles notebook, a PANEL_SETUP_TUNING_PROFILE_INFO a page, over the add / remove row.
 */
import type { JSX } from 'react';
import { StdBitmapButton } from '@ziroeda/common/widgets/std_bitmap_button.js';
import { wxALL, wxBOTTOM, wxEXPAND, wxHORIZONTAL, wxLEFT, wxTOP } from '@ziroeda/wx/defs.js';
import { type NotebookPage, Notebook } from '@ziroeda/wx/notebook_ui.js';
import { BoxSizer, FlexGridSizer, SizerItem, Spacer } from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

export interface PANEL_SETUP_TUNING_PROFILES_BASE_PROPS {
  m_tuningProfiles: {
    pages: readonly NotebookPage[];
    selection: number;
    onPageChanged: (aPage: number) => void;
  };
  onAddTuningProfileClick: () => void;
  onRemoveTuningProfileClick: () => void;
  removeEnabled: boolean;
}

export function PANEL_SETUP_TUNING_PROFILES_BASE(
  p: PANEL_SETUP_TUNING_PROFILES_BASE_PROPS,
): JSX.Element {
  return (
    // fgSizer1 = wxFlexGridSizer( 2, 1, 0, 0 ), growing column 0 and row 0
    <FlexGridSizer cols={1} growableCols={[0]} growableRows={[0]}>
      <SizerItem proportion={1} flag={wxEXPAND | wxALL} border={5}>
        <Notebook
          pages={p.m_tuningProfiles.pages}
          selection={p.m_tuningProfiles.selection}
          onPageChanged={p.m_tuningProfiles.onPageChanged}
          ariaLabel={_('Tuning profiles')}
        />
      </SizerItem>
      <SizerItem proportion={1} flag={wxTOP} border={5}>
        {/* bSizer91 */}
        <BoxSizer orient={wxHORIZONTAL}>
          <SizerItem flag={wxTOP | wxBOTTOM | wxLEFT} border={5}>
            <StdBitmapButton
              bitmap="small_plus"
              title={_('Add tuning profile')}
              tooltip={null}
              onClick={p.onAddTuningProfileClick}
            />
          </SizerItem>
          <Spacer width={20} height={0} proportion={1} flag={wxEXPAND} border={5} />
          <SizerItem flag={wxTOP | wxBOTTOM | wxLEFT} border={5}>
            <StdBitmapButton
              bitmap="small_trash"
              title={_('Remove tuning profile')}
              tooltip={null}
              disabled={!p.removeEnabled}
              onClick={p.onRemoveTuningProfileClick}
            />
          </SizerItem>
        </BoxSizer>
      </SizerItem>
    </FlexGridSizer>
  );
}
