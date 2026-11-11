// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_INCREMENT_ANNOTATIONS_BASE` (eeschema/dialogs/dialog_increment_annotations_base.cpp),
 * transcribed Add() for Add(). Upstream has no derived class: SCH_EDITOR_CONTROL::
 * IncrementAnnotations shows this base itself and reads its controls back, so the values go
 * into the tool's INCREMENT_ANNOTATIONS_VALUES on OK (its TransferDataFromWindow).
 *
 * No validator (the .fbp's is wxFILTER_NONE): an empty or numberless reference is accepted
 * here and the tool's `IsSplitNeeded()` test makes it a silent no-op, as upstream.
 */
import { type JSX, useRef, useState } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { RadioButton, TextCtrl } from '@ziroeda/wx/controls.js';
import {
  wxALIGN_CENTER_VERTICAL,
  wxALL,
  wxBOTTOM,
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
import { SpinCtrl } from '@ziroeda/wx/spin_ctrl.js';
import type { INCREMENT_ANNOTATIONS_VALUES } from '../tools/sch_editor_control.js';
import { _ } from '@ziroeda/wx/translation.js';

interface Props {
  /** The tool's values, written on OK. */
  values: INCREMENT_ANNOTATIONS_VALUES;
  onOk: () => void;
  onCancel: () => void;
}

export function DIALOG_INCREMENT_ANNOTATIONS_BASE({ values, onOk, onCancel }: Props): JSX.Element {
  const [firstRefDes, setFirstRefDes] = useState(values.firstRefDes);
  const [increment, setIncrement] = useState(values.increment);
  const [allSheets, setAllSheets] = useState(values.allSheets);
  // A wxDialog hands its focus to its first child that takes it (wxNavigationEnabled).
  const firstRef = useRef<HTMLInputElement>(null);

  const ok = (): void => {
    values.firstRefDes = firstRefDes;
    values.increment = increment;
    values.allSheets = allSheets;
    onOk();
  };

  return (
    <DialogShim title={_('Increment Annotations From')} onClose={onCancel} initialFocus={firstRef}>
      {/* bSizerMain */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={5}>
          {/* bSizerTop */}
          <BoxSizer orient={wxVERTICAL}>
            <SizerItem proportion={1} flag={wxALL | wxEXPAND} border={5}>
              {/* fgSizer31 = wxFlexGridSizer( 0, 2, 6, 6 ), AddGrowableCol( 1 ) */}
              <FlexGridSizer cols={2} vgap={6} hgap={6} growableCols={[1]}>
                <SizerItem flag={wxALIGN_CENTER_VERTICAL}>
                  {/* m_firstRefDesLabel */}
                  <span title="The symbol name in library and also the default&#10;symbol value when loaded in the schematic.">
                    {_('Start reference designator:')}
                  </span>
                </SizerItem>
                <SizerItem proportion={1} flag={wxALIGN_CENTER_VERTICAL | wxEXPAND}>
                  {/* m_FirstRefDes */}
                  <TextCtrl
                    value={firstRefDes}
                    onChange={setFirstRefDes}
                    inputRef={firstRef}
                    ariaLabel="Start reference designator"
                  />
                </SizerItem>
                <SizerItem flag={wxALIGN_CENTER_VERTICAL}>
                  {/* m_incrementLabel */}
                  <span>{_('Increment by:')}</span>
                </SizerItem>
                <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxEXPAND}>
                  {/* m_Increment = wxSpinCtrl( …, wxSP_ARROW_KEYS, 1, 64, 0 ) */}
                  <SpinCtrl
                    value={increment}
                    onChange={setIncrement}
                    min={1}
                    max={64}
                    ariaLabel="Increment by"
                  />
                </SizerItem>
              </FlexGridSizer>
            </SizerItem>
            <Spacer width={0} height={10} flag={wxEXPAND} border={5} />
            <SizerItem flag={wxALL} border={5}>
              {/* m_CurrentSheet, wxRB_GROUP, SetValue( true ) */}
              <RadioButton
                label={_('Current sheet only')}
                name="increment-scope"
                checked={!allSheets}
                onChange={() => setAllSheets(false)}
              />
            </SizerItem>
            <SizerItem flag={wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
              {/* m_AllSheets */}
              <RadioButton
                label={_('All sheets')}
                name="increment-scope"
                checked={allSheets}
                onChange={() => setAllSheets(true)}
              />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxALL | wxEXPAND} border={5}>
          {/* m_sdbSizer: OK, Cancel */}
          <StdDialogButtonSizer onOk={ok} onCancel={onCancel} />
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
