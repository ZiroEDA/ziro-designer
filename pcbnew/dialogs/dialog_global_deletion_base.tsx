// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_GLOBAL_DELETION_BASE` (pcbnew/dialogs/dialog_global_deletion_base.cpp): the sizer tree,
 * Add() for Add(). The members are props; the behaviour is DIALOG_GLOBAL_DELETION's
 * (dialog_global_deletion.tsx).
 */
import type { JSX } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { type CHECK, CheckBox, RadioBox } from '@ziroeda/wx/controls.js';
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
import {
  BoxSizer,
  FlexGridSizer,
  SizerItem,
  StaticBoxSizer,
  StdDialogButtonSizer,
} from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

export interface DIALOG_GLOBAL_DELETION_BASE_PROPS {
  m_delZones: CHECK;
  m_delTexts: CHECK;
  m_delBoardEdges: CHECK;
  m_delDrawings: CHECK;
  m_delFootprints: CHECK;
  m_delTracks: CHECK;
  m_delTeardrops: CHECK;
  m_delMarkers: CHECK;
  m_delAll: CHECK;
  m_drawingFilterLocked: CHECK;
  m_drawingFilterUnlocked: CHECK;
  m_footprintFilterLocked: CHECK;
  m_footprintFilterUnlocked: CHECK;
  m_trackFilterLocked: CHECK;
  m_trackFilterUnlocked: CHECK;
  m_viaFilterLocked: CHECK;
  m_viaFilterUnlocked: CHECK;
  /** `m_rbLayersOption`: its two rows (the second SetCurrentLayer's) and the selection. */
  m_rbLayersOption: {
    choices: readonly string[];
    selection: number;
    onChange: (i: number) => void;
  };
  onOK: () => void;
  onCancel: () => void;
}

const BRL = wxBOTTOM | wxRIGHT | wxLEFT;

export function DIALOG_GLOBAL_DELETION_BASE(p: DIALOG_GLOBAL_DELETION_BASE_PROPS): JSX.Element {
  return (
    <DialogShim title={_('Delete Items')} onClose={p.onCancel}>
      {/* bSizerMain */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem proportion={1} flag={wxEXPAND | wxALL} border={5}>
          {/* bSizerUpper */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem flag={wxEXPAND | wxALL} border={5}>
              <StaticBoxSizer label={_('Items to Delete')} orient={wxVERTICAL}>
                <SizerItem flag={BRL} border={5}>
                  <CheckBox label={_('Zones')} check={p.m_delZones} />
                </SizerItem>
                <SizerItem flag={BRL} border={5}>
                  <CheckBox label={_('Text')} check={p.m_delTexts} />
                </SizerItem>
                <SizerItem flag={BRL} border={5}>
                  <CheckBox label={_('Board outlines')} check={p.m_delBoardEdges} />
                </SizerItem>
                <SizerItem flag={BRL} border={5}>
                  <CheckBox label={_('Graphics')} check={p.m_delDrawings} />
                </SizerItem>
                <SizerItem flag={BRL} border={5}>
                  <CheckBox label={_('Footprints')} check={p.m_delFootprints} />
                </SizerItem>
                <SizerItem flag={BRL} border={5}>
                  {/* "Tracks && vias": && is a literal & */}
                  <CheckBox label={_('Tracks & vias')} check={p.m_delTracks} />
                </SizerItem>
                <SizerItem flag={BRL} border={5}>
                  <CheckBox label={_('Teardrops')} check={p.m_delTeardrops} />
                </SizerItem>
                <SizerItem flag={BRL} border={5}>
                  <CheckBox label={_('Markers')} check={p.m_delMarkers} />
                </SizerItem>
                <SizerItem flag={BRL} border={5}>
                  <CheckBox label={_('Clear board')} check={p.m_delAll} />
                </SizerItem>
              </StaticBoxSizer>
            </SizerItem>
            <SizerItem flag={wxEXPAND | wxLEFT} border={5}>
              {/* bSizerRight */}
              <BoxSizer orient={wxVERTICAL}>
                <SizerItem proportion={1} flag={wxEXPAND | wxTOP | wxBOTTOM | wxLEFT} border={5}>
                  <StaticBoxSizer label={_('Filter Settings')} orient={wxVERTICAL}>
                    <SizerItem proportion={1} flag={wxEXPAND} border={5}>
                      {/* fgSizer2 = wxFlexGridSizer( 0, 1, 3, 0 ) */}
                      <FlexGridSizer cols={1} vgap={3} hgap={0}>
                        <SizerItem flag={wxRIGHT | wxLEFT} border={5}>
                          <CheckBox label={_('Locked graphics')} check={p.m_drawingFilterLocked} />
                        </SizerItem>
                        <SizerItem flag={BRL} border={5}>
                          <CheckBox
                            label={_('Unlocked graphics')}
                            check={p.m_drawingFilterUnlocked}
                          />
                        </SizerItem>
                        <SizerItem flag={wxTOP | wxRIGHT | wxLEFT} border={5}>
                          <CheckBox
                            label={_('Locked footprints')}
                            check={p.m_footprintFilterLocked}
                          />
                        </SizerItem>
                        <SizerItem flag={BRL} border={5}>
                          <CheckBox
                            label={_('Unlocked footprints')}
                            check={p.m_footprintFilterUnlocked}
                          />
                        </SizerItem>
                        <SizerItem flag={wxTOP | wxRIGHT | wxLEFT} border={5}>
                          <CheckBox label={_('Locked tracks')} check={p.m_trackFilterLocked} />
                        </SizerItem>
                        <SizerItem flag={wxRIGHT | wxLEFT} border={5}>
                          <CheckBox label={_('Unlocked tracks')} check={p.m_trackFilterUnlocked} />
                        </SizerItem>
                        <SizerItem flag={wxRIGHT | wxLEFT} border={5}>
                          <CheckBox label={_('Locked vias')} check={p.m_viaFilterLocked} />
                        </SizerItem>
                        <SizerItem flag={wxRIGHT | wxLEFT} border={5}>
                          <CheckBox label={_('Unlocked vias')} check={p.m_viaFilterUnlocked} />
                        </SizerItem>
                      </FlexGridSizer>
                    </SizerItem>
                  </StaticBoxSizer>
                </SizerItem>
              </BoxSizer>
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxRIGHT | wxLEFT} border={10}>
          <RadioBox
            label={_('Layer Filter')}
            choices={p.m_rbLayersOption.choices}
            selection={p.m_rbLayersOption.selection}
            onChange={p.m_rbLayersOption.onChange}
          />
        </SizerItem>
        <SizerItem flag={wxBOTTOM | wxEXPAND | wxTOP} border={5}>
          <StdDialogButtonSizer onOk={p.onOK} onCancel={p.onCancel} />
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
