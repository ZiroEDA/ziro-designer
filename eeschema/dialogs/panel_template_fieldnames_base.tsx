// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_TEMPLATE_FIELDNAMES_BASE` (eeschema/dialogs/panel_template_fieldnames_base.cpp): the
 * panel's sizer tree, Add() for Add() - m_title, the 180 px WX_GRID, and bSizer10's add / up /
 * down / 20 px / delete buttons. Schematic Setup and Preferences both host it.
 */
import type { JSX, ReactNode } from 'react';
import { StdBitmapButton } from '@ziroeda/common/widgets/std_bitmap_button.js';
import { StaticText } from '@ziroeda/wx/controls.js';
import {
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

export interface PANEL_TEMPLATE_FIELDNAMES_BASE_PROPS {
  /** m_title: "Project Field Name Templates" or "Global Field Name Templates". */
  title: string;
  m_grid: ReactNode;
  onAddField: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDeleteField: () => void;
}

export function PANEL_TEMPLATE_FIELDNAMES_BASE(
  p: PANEL_TEMPLATE_FIELDNAMES_BASE_PROPS,
): JSX.Element {
  return (
    // bPanelSizer
    <BoxSizer orient={wxVERTICAL}>
      <SizerItem flag={wxTOP | wxLEFT | wxEXPAND} border={8}>
        <StaticText label={p.title} />
      </SizerItem>
      <Spacer width={0} height={3} flag={wxEXPAND} border={5} />
      <SizerItem proportion={1} flag={wxEXPAND | wxRIGHT} border={5} minSize={[-1, 180]}>
        {p.m_grid}
      </SizerItem>
      <SizerItem flag={wxEXPAND | wxTOP} border={3}>
        {/* bSizer10: the tooltips are on up and down alone, where the base file sets them */}
        <BoxSizer orient={wxHORIZONTAL}>
          <SizerItem flag={wxBOTTOM} border={5}>
            <StdBitmapButton
              bitmap="small_plus"
              title={_('Add field')}
              tooltip={null}
              onClick={p.onAddField}
            />
          </SizerItem>
          <SizerItem flag={wxBOTTOM | wxLEFT} border={5}>
            <StdBitmapButton bitmap="small_up" title={_('Move up')} onClick={p.onMoveUp} />
          </SizerItem>
          <SizerItem flag={wxBOTTOM | wxLEFT} border={5}>
            <StdBitmapButton bitmap="small_down" title={_('Move down')} onClick={p.onMoveDown} />
          </SizerItem>
          <Spacer width={20} height={0} flag={wxEXPAND} border={5} />
          <SizerItem flag={wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
            <StdBitmapButton
              bitmap="small_trash"
              title={_('Delete field')}
              tooltip={null}
              onClick={p.onDeleteField}
            />
          </SizerItem>
        </BoxSizer>
      </SizerItem>
    </BoxSizer>
  );
}
