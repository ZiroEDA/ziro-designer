// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_BOM_PRESETS_BASE` (eeschema/dialogs/panel_bom_presets_base.cpp): the panel's sizer tree,
 * Add() for Add() - two titled 180 px WX_GRIDs, each with its delete button beneath. A Schematic
 * Setup page: the paged dialog owns the frame and the buttons.
 */
import type { JSX, ReactNode } from 'react';
import { StdBitmapButton } from '@ziroeda/common/widgets/std_bitmap_button.js';
import { StaticText } from '@ziroeda/wx/controls.js';
import { wxBOTTOM, wxEXPAND, wxLEFT, wxTOP, wxVERTICAL } from '@ziroeda/wx/defs.js';
import { BoxSizer, SizerItem, Spacer } from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

export interface PANEL_BOM_PRESETS_BASE_PROPS {
  m_bomPresetsGrid: ReactNode;
  onDeleteBomPreset: () => void;
  m_bomFmtPresetsGrid: ReactNode;
  onDeleteBomFmtPreset: () => void;
}

export function PANEL_BOM_PRESETS_BASE(p: PANEL_BOM_PRESETS_BASE_PROPS): JSX.Element {
  return (
    // bPanelSizer
    <BoxSizer orient={wxVERTICAL}>
      <SizerItem flag={wxTOP | wxLEFT | wxEXPAND} border={8}>
        <StaticText label={_('Bill of Materials Presets')} />
      </SizerItem>
      <Spacer width={0} height={3} flag={wxEXPAND} border={5} />
      <SizerItem proportion={1} flag={wxEXPAND | wxBOTTOM} border={3} minSize={[-1, 180]}>
        {p.m_bomPresetsGrid}
      </SizerItem>
      <SizerItem flag={wxBOTTOM} border={5}>
        <StdBitmapButton
          bitmap="small_trash"
          title="Delete preset"
          tooltip={null}
          onClick={p.onDeleteBomPreset}
        />
      </SizerItem>
      <Spacer width={0} height={5} flag={wxEXPAND} border={5} />
      <SizerItem flag={wxEXPAND | wxLEFT | wxTOP} border={8}>
        <StaticText label={_('Bill of Materials Formatting Presets')} />
      </SizerItem>
      <Spacer width={0} height={3} flag={wxEXPAND} border={5} />
      <SizerItem proportion={1} flag={wxEXPAND | wxBOTTOM} border={3} minSize={[-1, 180]}>
        {p.m_bomFmtPresetsGrid}
      </SizerItem>
      <SizerItem flag={wxBOTTOM} border={5}>
        <StdBitmapButton
          bitmap="small_trash"
          title="Delete formatting preset"
          tooltip={null}
          onClick={p.onDeleteBomFmtPreset}
        />
      </SizerItem>
    </BoxSizer>
  );
}
