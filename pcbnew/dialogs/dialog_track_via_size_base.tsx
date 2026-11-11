// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_TRACK_VIA_SIZE_BASE` (pcbnew/dialogs/dialog_track_via_size_base.cpp): the sizer tree,
 * Add() for Add(). The members are props; the behaviour is DIALOG_TRACK_VIA_SIZE's
 * (dialog_track_via_size.tsx).
 */
import type { JSX, Ref } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { StaticLine, StaticText, TextCtrl } from '@ziroeda/wx/controls.js';
import {
  wxALIGN_CENTER_VERTICAL,
  wxALL,
  wxBOTTOM,
  wxEXPAND,
  wxRIGHT,
  wxTOP,
  wxVERTICAL,
} from '@ziroeda/wx/defs.js';
import { BoxSizer, FlexGridSizer, SizerItem, StdDialogButtonSizer } from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

/** A UNIT_BINDER: its entry text and units label. */
export interface UNIT {
  value: string;
  units: string;
  onChange: (aText: string) => void;
  inputRef?: Ref<HTMLInputElement>;
}

export interface DIALOG_TRACK_VIA_SIZE_BASE_PROPS {
  m_trackWidth: UNIT;
  m_viaDiameter: UNIT;
  m_viaDrill: UNIT;
  onOK: () => void;
  onCancel: () => void;
}

function Row({ label, u }: { label: string; u: UNIT }): JSX.Element {
  return (
    <>
      <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxTOP | wxBOTTOM | wxRIGHT} border={5}>
        <StaticText label={label} />
      </SizerItem>
      <SizerItem proportion={1} flag={wxEXPAND | wxTOP | wxBOTTOM} border={5}>
        <TextCtrl
          value={u.value}
          onChange={u.onChange}
          inputRef={u.inputRef}
          ariaLabel={label.replace(/:$/, '')}
        />
      </SizerItem>
      <SizerItem flag={wxALL | wxALIGN_CENTER_VERTICAL} border={5}>
        <StaticText label={u.units} />
      </SizerItem>
    </>
  );
}

export function DIALOG_TRACK_VIA_SIZE_BASE(p: DIALOG_TRACK_VIA_SIZE_BASE_PROPS): JSX.Element {
  return (
    <DialogShim title="Track Width and Via Size" onClose={p.onCancel}>
      {/* bSizes */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem proportion={1} flag={wxEXPAND | wxALL} border={10}>
          {/* fgSizer1 = wxFlexGridSizer( 0, 3, 0, 0 ) */}
          <FlexGridSizer cols={3} growableCols={[1]}>
            <Row label={_('Track width:')} u={p.m_trackWidth} />
            <Row label={_('Via diameter:')} u={p.m_viaDiameter} />
            <Row label={_('Via hole:')} u={p.m_viaDrill} />
          </FlexGridSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND} border={5}>
          <StaticLine />
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxALL} border={5}>
          <StdDialogButtonSizer onOk={p.onOK} onCancel={p.onCancel} />
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
