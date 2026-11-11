// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_LAYER_SELECTION_BASE` and `DIALOG_COPPER_LAYER_PAIR_SELECTION_BASE`
 * (pcbnew/dialogs/dialog_layer_selection_base.cpp): their sizer trees, Add() for Add(). The grids
 * are the members PCB_ONE_LAYER_SELECTOR and SELECT_COPPER_LAYERS_PAIR_DIALOG fill
 * (pcbnew/sel_layer.tsx), passed in as they are built there.
 */
import type { JSX, KeyboardEvent, ReactNode } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { StdBitmapButton } from '@ziroeda/common/widgets/std_bitmap_button.js';
import { StaticText } from '@ziroeda/wx/controls.js';
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
import { BoxSizer, SizerItem, StaticBoxSizer, StdDialogButtonSizer } from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

export interface DIALOG_LAYER_SELECTION_BASE_PROPS {
  /** `m_leftGridLayers` (copper) and `m_rightGridLayers` (the rest), or null when empty. */
  m_leftGridLayers: ReactNode | null;
  m_rightGridLayers: ReactNode | null;
  onCharHook: (aEvent: KeyboardEvent<HTMLDivElement>) => void;
  onCancel: () => void;
}

export function DIALOG_LAYER_SELECTION_BASE(p: DIALOG_LAYER_SELECTION_BASE_PROPS): JSX.Element {
  return (
    <DialogShim title={_('Select Layer')} onClose={p.onCancel} onCharHook={p.onCharHook}>
      {/* bSizerMain */}
      <BoxSizer orient={wxHORIZONTAL}>
        <SizerItem proportion={1} flag={wxEXPAND | wxALL} border={10}>
          {/* bSizerUpper */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem
              proportion={1}
              flag={wxALL | wxEXPAND}
              border={5}
              shown={p.m_leftGridLayers !== null}
            >
              {p.m_leftGridLayers}
            </SizerItem>
            <SizerItem
              proportion={1}
              flag={wxALL | wxEXPAND}
              border={5}
              shown={p.m_rightGridLayers !== null}
            >
              {p.m_rightGridLayers}
            </SizerItem>
          </BoxSizer>
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}

export interface DIALOG_COPPER_LAYER_PAIR_SELECTION_BASE_PROPS {
  m_leftGridLayers: ReactNode;
  m_rightGridLayers: ReactNode;
  /** `m_addToPresetsButton->SetBitmap( KiBitmapBundle( BITMAPS::right ) )`. */
  onAddToPresets: () => void;
  m_presetsGrid: ReactNode;
  /** `m_deleteRowButton->SetBitmap( KiBitmapBundle( BITMAPS::small_trash ) )`. */
  onDeleteRows: () => void;
  onOK: () => void;
  onCancel: () => void;
}

export function DIALOG_COPPER_LAYER_PAIR_SELECTION_BASE(
  p: DIALOG_COPPER_LAYER_PAIR_SELECTION_BASE_PROPS,
): JSX.Element {
  return (
    <DialogShim title={_('Select Copper Layer Pair')} onClose={p.onCancel}>
      {/* bSizerMain */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem proportion={1} flag={wxALL | wxEXPAND} border={5}>
          {/* bSizerUpper */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem flag={wxEXPAND | wxRIGHT | wxLEFT} border={5}>
              {/* bSizerLeft */}
              <BoxSizer orient={wxVERTICAL}>
                <SizerItem flag={wxTOP | wxRIGHT | wxLEFT} border={5}>
                  <StaticText label={_('Top/Front layer:')} />
                </SizerItem>
                <SizerItem flag={wxALL | wxEXPAND} border={5}>
                  {p.m_leftGridLayers}
                </SizerItem>
              </BoxSizer>
            </SizerItem>
            <SizerItem flag={wxEXPAND | wxRIGHT | wxLEFT} border={5}>
              {/* bSizerRight */}
              <BoxSizer orient={wxVERTICAL}>
                <SizerItem flag={wxTOP | wxRIGHT | wxLEFT} border={5}>
                  <StaticText label={_('Bottom/Back layer:')} />
                </SizerItem>
                <SizerItem flag={wxALL | wxEXPAND} border={5}>
                  {p.m_rightGridLayers}
                </SizerItem>
              </BoxSizer>
            </SizerItem>
            <SizerItem flag={wxALIGN_CENTER_VERTICAL} border={5}>
              {/* bSizer7 */}
              <BoxSizer orient={wxVERTICAL}>
                <SizerItem flag={wxALL} border={5}>
                  <StdBitmapButton
                    bitmap="right"
                    title="Add current pair to presets"
                    tooltip={null}
                    onClick={p.onAddToPresets}
                  />
                </SizerItem>
              </BoxSizer>
            </SizerItem>
            <SizerItem proportion={1} flag={wxBOTTOM | wxEXPAND | wxLEFT | wxRIGHT} border={5}>
              <StaticBoxSizer label={_('Copper Layer Pair Presets')} orient={wxVERTICAL}>
                <SizerItem proportion={1} flag={wxALL | wxEXPAND} border={5}>
                  {p.m_presetsGrid}
                </SizerItem>
                <SizerItem flag={wxBOTTOM | wxLEFT | wxTOP} border={5}>
                  <StdBitmapButton
                    bitmap="small_trash"
                    title="Delete selected presets"
                    tooltip={null}
                    onClick={p.onDeleteRows}
                  />
                </SizerItem>
              </StaticBoxSizer>
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxBOTTOM | wxEXPAND | wxLEFT | wxTOP} border={5}>
          <StdDialogButtonSizer onOk={p.onOK} onCancel={p.onCancel} />
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
