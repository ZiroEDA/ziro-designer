// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_OFFSET_ITEM_BASE` (pcbnew/dialogs/dialog_offset_item_base.cpp): the sizer tree, Add()
 * for Add(). The members are props; the behaviour is DIALOG_OFFSET_ITEM's (dialog_offset_item.tsx).
 */
import type { JSX, Ref } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { Button, type CHECK, CheckBox, StaticText, TextCtrl } from '@ziroeda/wx/controls.js';
import {
  wxALIGN_CENTER_VERTICAL,
  wxALIGN_LEFT,
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
  Spacer,
  StdDialogButtonSizer,
} from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

/** A UNIT_BINDER: its label (SetLabel'd for polar), entry, units, and wxEVT_KILL_FOCUS. */
export interface UNIT {
  label: string;
  value: string;
  units: string;
  onChange: (aText: string) => void;
  onBlur: () => void;
}

export interface DIALOG_OFFSET_ITEM_BASE_PROPS {
  title: string;
  m_xOffset: UNIT;
  /** `SetInitialFocus( m_xEntry )`. */
  xEntryRef: Ref<HTMLInputElement>;
  m_yOffset: UNIT;
  /** The Reset buttons' tool tips, which the derived class sets. */
  clearXToolTip: string;
  clearYToolTip: string;
  onClearX: () => void;
  onClearY: () => void;
  m_polarCoords: CHECK;
  onOK: () => void;
  onCancel: () => void;
}

export function DIALOG_OFFSET_ITEM_BASE(p: DIALOG_OFFSET_ITEM_BASE_PROPS): JSX.Element {
  const entry = (aUnit: UNIT, aRef?: Ref<HTMLInputElement>) => (
    <TextCtrl
      value={aUnit.value}
      onChange={aUnit.onChange}
      onBlur={aUnit.onBlur}
      onEnter={p.onOK}
      inputRef={aRef}
      ariaLabel={aUnit.label.replace(/:$/, '')}
    />
  );

  return (
    <DialogShim title={p.title} onClose={p.onCancel}>
      {/* bMainSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem proportion={1} flag={wxEXPAND | wxALL} border={5}>
          {/* fgSizer2 = wxFlexGridSizer( 0, 5, 5, 0 ) */}
          <FlexGridSizer cols={5} vgap={5} hgap={0} growableCols={[1]}>
            <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxTOP | wxRIGHT | wxLEFT} border={5}>
              <StaticText label={p.m_xOffset.label} />
            </SizerItem>
            <SizerItem flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={5}>
              {entry(p.m_xOffset, p.xEntryRef)}
            </SizerItem>
            <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxALIGN_LEFT | wxTOP | wxRIGHT} border={5}>
              <StaticText label={p.m_xOffset.units} />
            </SizerItem>
            <Spacer
              width={10}
              height={0}
              proportion={1}
              flag={wxEXPAND | wxRIGHT | wxLEFT}
              border={5}
            />
            <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxTOP | wxRIGHT | wxLEFT} border={5}>
              {/* wxBU_EXACTFIT */}
              <Button label={_('Reset')} title={p.clearXToolTip} onClick={p.onClearX} />
            </SizerItem>
            <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
              <StaticText label={p.m_yOffset.label} />
            </SizerItem>
            <SizerItem flag={wxEXPAND | wxLEFT | wxRIGHT} border={5}>
              {entry(p.m_yOffset)}
            </SizerItem>
            <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT} border={5}>
              <StaticText label={p.m_yOffset.units} />
            </SizerItem>
            <Spacer width={10} height={0} proportion={1} flag={wxEXPAND} border={5} />
            <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT | wxRIGHT} border={5}>
              <Button label={_('Reset')} title={p.clearYToolTip} onClick={p.onClearY} />
            </SizerItem>
          </FlexGridSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxTOP} border={5}>
          {/* bSizerBottom */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={10}>
              <CheckBox label={_('Use polar coordinates')} check={p.m_polarCoords} />
            </SizerItem>
            <Spacer width={40} height={0} proportion={1} flag={wxEXPAND} border={5} />
            <SizerItem flag={wxBOTTOM | wxTOP} border={5}>
              <StdDialogButtonSizer onOk={p.onOK} onCancel={p.onCancel} />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
