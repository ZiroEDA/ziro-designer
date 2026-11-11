// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_SWAP_LAYERS_BASE` (pcbnew/dialogs/dialog_swap_layers_base.cpp): the sizer tree, Add()
 * for Add(). `m_grid` is the derived class's WX_GRID over LAYER_GRID_TABLE; its two 125-wide
 * columns share the grid's width (`OnSize` -> adjustGridColumns).
 */
import type { JSX } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import type { WX_GRID } from '@ziroeda/common/widgets/wx_grid.js';
import { wxALL, wxEXPAND, wxLEFT, wxRIGHT, wxTOP, wxVERTICAL } from '@ziroeda/wx/defs.js';
import { WxGridView } from '@ziroeda/wx/grid_ui.js';
import { BoxSizer, SizerItem, StdDialogButtonSizer } from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

export interface DIALOG_SWAP_LAYERS_BASE_PROPS {
  m_grid: WX_GRID;
  onOK: () => void;
  onCancel: () => void;
}

export function DIALOG_SWAP_LAYERS_BASE(p: DIALOG_SWAP_LAYERS_BASE_PROPS): JSX.Element {
  return (
    <DialogShim title={_('Swap Layers')} onClose={p.onCancel}>
      {/* bMainSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem proportion={1} flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={10}>
          {/* bMarginsSizer */}
          <BoxSizer orient={wxVERTICAL}>
            {/* m_grid->SetMinSize( wxSize( 250,150 ) ) */}
            <SizerItem proportion={1} flag={wxEXPAND | wxALL} border={5} minSize={[250, 150]}>
              <WxGridView grid={p.m_grid} rowLabels={false} flexCol={1} ariaLabel="Swap layers" />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxALL | wxEXPAND} border={5}>
          <StdDialogButtonSizer onOk={p.onOK} onCancel={p.onCancel} />
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
