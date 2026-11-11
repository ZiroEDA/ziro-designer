// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_IMAGE_PROPERTIES_BASE` (eeschema/dialogs/dialog_image_properties_base.cpp): the sizer
 * tree, Add() for Add(). `m_imageSizer` is empty in the base; DIALOG_IMAGE_PROPERTIES adds its
 * PANEL_IMAGE_EDITOR there (`m_imageSizer->Add( m_imageEditor, 1, wxEXPAND | wxALL, 5 )`), so
 * the derived dialog passes it in.
 */
import type { JSX, ReactNode } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { TextCtrl } from '@ziroeda/wx/controls.js';
import {
  wxALIGN_CENTER_VERTICAL,
  wxALL,
  wxEXPAND,
  wxLEFT,
  wxRIGHT,
  wxTOP,
  wxVERTICAL,
} from '@ziroeda/wx/defs.js';
import {
  BoxSizer,
  FlexGridSizer,
  SizerItem,
  Spacer,
  StdDialogButtonSizer,
} from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

export interface DIALOG_IMAGE_PROPERTIES_BASE_PROPS {
  m_ModPositionX: string;
  onPositionX: (aText: string) => void;
  m_ModPositionY: string;
  onPositionY: (aText: string) => void;
  /** `m_XPosUnit` / `m_YPosUnit`: the UNIT_BINDERs' unit labels. */
  unitsLabel: string;
  /** What the derived dialog adds to `m_imageSizer`. */
  m_imageSizer: ReactNode;
  onOK: () => void;
  onCancel: () => void;
}

export function DIALOG_IMAGE_PROPERTIES_BASE(p: DIALOG_IMAGE_PROPERTIES_BASE_PROPS): JSX.Element {
  return (
    <DialogShim title={_('Image Properties')} onClose={p.onCancel}>
      {/* bMainSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <Spacer width={0} height={5} flag={wxEXPAND} border={5} />
        <SizerItem flag={wxEXPAND | wxALL} border={8}>
          {/* fgSizerPos = wxFlexGridSizer( 2, 3, 1, 0 ), AddGrowableCol( 1 ), AddGrowableRow( 0 ) */}
          <FlexGridSizer cols={3} vgap={1} hgap={0} growableCols={[1]} growableRows={[0]}>
            <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
              {/* m_XPosLabel */}
              <span>{_('Position X:')}</span>
            </SizerItem>
            <SizerItem proportion={1} flag={wxALIGN_CENTER_VERTICAL | wxEXPAND} border={5}>
              {/* m_ModPositionX */}
              <TextCtrl
                value={p.m_ModPositionX}
                onChange={p.onPositionX}
                ariaLabel={_HKI('Position X')}
              />
            </SizerItem>
            <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT | wxRIGHT} border={5}>
              {/* m_XPosUnit */}
              <span>{p.unitsLabel}</span>
            </SizerItem>
            <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
              {/* m_YPosLabel */}
              <span>{_('Position Y:')}</span>
            </SizerItem>
            <SizerItem proportion={1} flag={wxALIGN_CENTER_VERTICAL | wxEXPAND | wxTOP} border={1}>
              {/* m_ModPositionY */}
              <TextCtrl
                value={p.m_ModPositionY}
                onChange={p.onPositionY}
                ariaLabel={_HKI('Position Y')}
              />
            </SizerItem>
            <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
              {/* m_YPosUnit */}
              <span>{p.unitsLabel}</span>
            </SizerItem>
          </FlexGridSizer>
        </SizerItem>
        <SizerItem proportion={1} flag={wxEXPAND} border={5} minSize={[360, -1]}>
          {/* m_imageSizer, SetMinSize( wxSize( 360,-1 ) ) */}
          <BoxSizer orient={wxVERTICAL}>
            <SizerItem proportion={1} flag={wxEXPAND | wxALL} border={5}>
              {p.m_imageSizer}
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxALL | wxEXPAND} border={5}>
          {/* m_sdbSizerStdButtons: OK, Cancel */}
          <StdDialogButtonSizer onOk={p.onOK} onCancel={p.onCancel} />
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
