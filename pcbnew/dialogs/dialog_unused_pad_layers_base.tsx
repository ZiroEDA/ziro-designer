// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_UNUSED_PAD_LAYERS_BASE` (pcbnew/dialogs/dialog_unused_pad_layers_base.cpp): the sizer
 * tree, Add() for Add(). The members are props; the behaviour is DIALOG_UNUSED_PAD_LAYERS's
 * (dialog_unused_pad_layers.tsx).
 */
import type { JSX } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { type CHECK, CheckBox, StaticBitmap } from '@ziroeda/wx/controls.js';
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
import { BoxSizer, SizerItem, Spacer, StdDialogButtonSizer } from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

export interface DIALOG_UNUSED_PAD_LAYERS_BASE_PROPS {
  m_cbVias: CHECK;
  m_cbPads: CHECK;
  m_cbSelectedOnly: CHECK;
  m_cbPreserveExternalLayers: CHECK;
  /** `m_image->SetBitmap()`. */
  image: string;
  onOK: () => void;
  onApply: () => void;
  onCancel: () => void;
}

export function DIALOG_UNUSED_PAD_LAYERS_BASE(p: DIALOG_UNUSED_PAD_LAYERS_BASE_PROPS): JSX.Element {
  return (
    <DialogShim title={_('Remove Unused Pads')} onClose={p.onCancel}>
      {/* m_MainSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem proportion={6} flag={wxBOTTOM | wxEXPAND | wxLEFT | wxRIGHT} border={5}>
          {/* bMargins */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem proportion={1} flag={wxEXPAND | wxTOP | wxLEFT} border={10}>
              {/* bSizer4 */}
              <BoxSizer orient={wxVERTICAL}>
                <SizerItem flag={wxALL} border={5}>
                  <CheckBox label={_('Vias')} check={p.m_cbVias} />
                </SizerItem>
                <SizerItem flag={wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
                  <CheckBox label={_('Pads')} check={p.m_cbPads} />
                </SizerItem>
                <Spacer width={0} height={15} flag={wxEXPAND} border={5} />
                <SizerItem flag={wxEXPAND | wxBOTTOM | wxLEFT} border={5}>
                  {/* "&Selected only": the & is the mnemonic */}
                  <CheckBox label={_('Selected only')} check={p.m_cbSelectedOnly} />
                </SizerItem>
                <SizerItem flag={wxEXPAND | wxLEFT} border={5}>
                  <CheckBox label={_('Keep outside layers')} check={p.m_cbPreserveExternalLayers} />
                </SizerItem>
              </BoxSizer>
            </SizerItem>
            <SizerItem proportion={1} flag={wxEXPAND | wxLEFT | wxRIGHT} border={5}>
              {/* bSizerPreview */}
              <BoxSizer orient={wxVERTICAL}>
                <Spacer flag={wxEXPAND} border={5} />
                <SizerItem flag={wxTOP | wxRIGHT | wxLEFT} border={10}>
                  <StaticBitmap bitmap={p.image} />
                </SizerItem>
                <Spacer flag={wxEXPAND} border={5} />
              </BoxSizer>
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxBOTTOM | wxEXPAND | wxTOP} border={5}>
          {/* SetupStandardButtons' labels */}
          <StdDialogButtonSizer
            onOk={p.onOK}
            okLabel={_('Remove Unused Layers')}
            onApply={p.onApply}
            applyLabel={_('Restore All Layers')}
            onCancel={p.onCancel}
          />
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
