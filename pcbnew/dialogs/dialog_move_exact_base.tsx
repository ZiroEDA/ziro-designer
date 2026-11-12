// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_MOVE_EXACT_BASE` (pcbnew/dialogs/dialog_move_exact_base.cpp): the sizer tree, Add() for
 * Add(). The members are props; the behaviour is DIALOG_MOVE_EXACT's (dialog_move_exact.tsx).
 */
import type { JSX, Ref } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { wxRED } from '@ziroeda/wx/colour.js';
import {
  Button,
  type CHECK,
  CheckBox,
  Choice,
  type CHOICE,
  StaticText,
  TextCtrl,
} from '@ziroeda/wx/controls.js';
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
import {
  BoxSizer,
  FlexGridSizer,
  SizerItem,
  Spacer,
  StdDialogButtonSizer,
} from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

/** A UNIT_BINDER: its label (SetLabel'd for polar), entry, units and the entry's events. */
export interface UNIT {
  label: string;
  value: string;
  units: string;
  /** `SetForegroundColour( *wxRED )` / `SetToolTip( invalid_length )` while out of range. */
  invalid?: string;
  onChange: (aText: string) => void;
  onBlur: () => void;
  inputRef?: Ref<HTMLInputElement>;
}

export interface DIALOG_MOVE_EXACT_BASE_PROPS {
  title: string;
  /** DIALOG_SHIM's m_hash_key: the title plus the anchor and frame suffixes. */
  hashKey: string;
  m_moveX: UNIT;
  m_moveY: UNIT;
  m_rotate: UNIT;
  onClearX: () => void;
  onClearY: () => void;
  onClearRot: () => void;
  m_anchorOptions: CHOICE & { choices: readonly string[] };
  m_polarCoords: CHECK;
  /** `m_stdButtons->GetAffirmativeButton()->Enable()`. */
  okEnabled: boolean;
  onOK: () => void;
  onCancel: () => void;
}

function Entry({ u, onEnter }: { u: UNIT; onEnter: () => void }): JSX.Element {
  return (
    <TextCtrl
      value={u.value}
      onChange={u.onChange}
      onBlur={u.onBlur}
      onEnter={onEnter}
      inputRef={u.inputRef}
      title={u.invalid}
      foregroundColour={u.invalid ? wxRED : undefined}
      ariaLabel={u.label.replace(/:$/, '')}
    />
  );
}

export function DIALOG_MOVE_EXACT_BASE(p: DIALOG_MOVE_EXACT_BASE_PROPS): JSX.Element {
  return (
    <DialogShim title={p.title} onClose={p.onCancel} hashKey={p.hashKey}>
      {/* bMainSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem flag={wxEXPAND | wxALL} border={5}>
          {/* fgInputSizer = wxFlexGridSizer( 0, 4, 5, 5 ) */}
          <FlexGridSizer cols={4} vgap={5} hgap={5} growableCols={[1]}>
            <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={5}>
              <StaticText label={p.m_moveX.label} />
            </SizerItem>
            <SizerItem flag={wxEXPAND} border={5}>
              <Entry u={p.m_moveX} onEnter={p.onOK} />
            </SizerItem>
            <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT} border={5}>
              <StaticText label={p.m_moveX.units} />
            </SizerItem>
            <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT | wxRIGHT} border={5}>
              <Button label={_('Reset')} onClick={p.onClearX} />
            </SizerItem>
            <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={5}>
              <StaticText label={p.m_moveY.label} />
            </SizerItem>
            <SizerItem flag={wxEXPAND} border={5}>
              <Entry u={p.m_moveY} onEnter={p.onOK} />
            </SizerItem>
            <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT} border={5}>
              <StaticText label={p.m_moveY.units} />
            </SizerItem>
            <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
              <Button label={_('Reset')} onClick={p.onClearY} />
            </SizerItem>
            <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT} border={5}>
              <StaticText label={p.m_rotate.label} />
            </SizerItem>
            <SizerItem flag={wxEXPAND} border={5}>
              <Entry u={p.m_rotate} onEnter={p.onOK} />
            </SizerItem>
            <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT} border={5}>
              <StaticText label={p.m_rotate.units} />
            </SizerItem>
            <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT} border={5}>
              <Button label={_('Reset')} onClick={p.onClearRot} />
            </SizerItem>
            <Spacer proportion={1} flag={wxEXPAND} border={5} />
            <SizerItem flag={wxEXPAND} border={5}>
              <Choice
                choices={p.m_anchorOptions.choices}
                choice={p.m_anchorOptions}
                ariaLabel={_('Rotation anchor')}
              />
            </SizerItem>
          </FlexGridSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND} border={5}>
          {/* bBottomSizer */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxLEFT | wxRIGHT} border={10}>
              <CheckBox label={_('Use polar coordinates')} check={p.m_polarCoords} />
            </SizerItem>
            <SizerItem proportion={1} flag={wxBOTTOM | wxEXPAND | wxTOP} border={5}>
              <StdDialogButtonSizer onOk={p.onOK} onCancel={p.onCancel} okDisabled={!p.okEnabled} />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
