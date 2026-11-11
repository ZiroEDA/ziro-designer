// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_FILTER_SELECTION_BASE` (pcbnew/dialogs/dialog_filter_selection_base.cpp): the sizer
 * tree, Add() for Add(). The members are props; the behaviour is DIALOG_FILTER_SELECTION's
 * (dialog_filter_selection.tsx).
 */
import type { JSX } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { type CHECK, CheckBox } from '@ziroeda/wx/controls.js';
import { wxALL, wxEXPAND, wxRESERVE_SPACE_EVEN_IF_HIDDEN, wxVERTICAL } from '@ziroeda/wx/defs.js';
import { BoxSizer, FlexGridSizer, SizerItem, StdDialogButtonSizer } from '@ziroeda/wx/sizer.js';
import { type CHECK3, TriStateCheck } from '@ziroeda/wx/wx_checkbox.js';
import { _ } from '@ziroeda/wx/translation.js';

export interface DIALOG_FILTER_SELECTION_BASE_PROPS {
  /** wxCHK_3STATE | wxCHK_ALLOW_3RD_STATE_FOR_USER, its click is allItemsClicked. */
  m_All_Items: CHECK3;
  m_Include_Modules: CHECK;
  m_Include_PcbTexts: CHECK;
  m_IncludeLockedModules: CHECK;
  m_Include_Draw_Items: CHECK;
  m_Include_Tracks: CHECK;
  m_Include_Edges_Items: CHECK;
  m_Include_Vias: CHECK;
  m_Include_Zones: CHECK;
  /** wxID_OK is ExecuteCommand. */
  onOK: () => void;
  onCancel: () => void;
}

export function DIALOG_FILTER_SELECTION_BASE(p: DIALOG_FILTER_SELECTION_BASE_PROPS): JSX.Element {
  return (
    <DialogShim title={_('Filter Selected Items')} onClose={p.onCancel}>
      {/* bSizerMain */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem proportion={1} flag={wxEXPAND | wxALL} border={10}>
          {/* gSizer1 = wxGridSizer( 0, 2, 3, 3 ) */}
          <FlexGridSizer cols={2} vgap={3} hgap={3} flexibleDirection={0}>
            <SizerItem border={5}>
              <TriStateCheck label={_('All items')} check={p.m_All_Items} />
            </SizerItem>
            {/* m_Hidden_Spacer->Hide(), wxRESERVE_SPACE_EVEN_IF_HIDDEN: an empty checkbox */}
            <SizerItem flag={wxRESERVE_SPACE_EVEN_IF_HIDDEN} shown={false}>
              <CheckBox label="" checked={false} />
            </SizerItem>
            <SizerItem border={5}>
              <CheckBox label={_('Include footprints')} check={p.m_Include_Modules} />
            </SizerItem>
            <SizerItem border={5}>
              <CheckBox label={_('Include text items')} check={p.m_Include_PcbTexts} />
            </SizerItem>
            <SizerItem border={5}>
              <CheckBox label={_('Include locked footprints')} check={p.m_IncludeLockedModules} />
            </SizerItem>
            <SizerItem border={5}>
              <CheckBox label={_('Include drawings')} check={p.m_Include_Draw_Items} />
            </SizerItem>
            <SizerItem border={5}>
              <CheckBox label={_('Include tracks')} check={p.m_Include_Tracks} />
            </SizerItem>
            <SizerItem border={5}>
              <CheckBox label={_('Include board outline layer')} check={p.m_Include_Edges_Items} />
            </SizerItem>
            <SizerItem border={5}>
              <CheckBox label={_('Include vias')} check={p.m_Include_Vias} />
            </SizerItem>
            <SizerItem border={5}>
              <CheckBox label={_('Include zones')} check={p.m_Include_Zones} />
            </SizerItem>
          </FlexGridSizer>
        </SizerItem>
        <SizerItem flag={wxALL | wxEXPAND} border={5}>
          <StdDialogButtonSizer onOk={p.onOK} onCancel={p.onCancel} />
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
