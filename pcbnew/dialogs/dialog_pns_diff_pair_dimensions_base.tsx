// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_PNS_DIFF_PAIR_DIMENSIONS_BASE` (pcbnew/dialogs/dialog_pns_diff_pair_dimensions_base.cpp):
 * the sizer tree, Add() for Add(). The members are props; the behaviour is
 * DIALOG_PNS_DIFF_PAIR_DIMENSIONS's (dialog_pns_diff_pair_dimensions.tsx).
 */
import type { JSX, Ref } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { type CHECK, CheckBox, StaticText, TextCtrl } from '@ziroeda/wx/controls.js';
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
import { BoxSizer, FlexGridSizer, SizerItem, StdDialogButtonSizer } from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

/** A UNIT_BINDER: its entry text, units label and Enable(). */
export interface UNIT {
  value: string;
  units: string;
  enabled?: boolean;
  onChange: (aText: string) => void;
  inputRef?: Ref<HTMLInputElement>;
}

export interface DIALOG_PNS_DIFF_PAIR_DIMENSIONS_BASE_PROPS {
  m_traceWidth: UNIT;
  m_traceGap: UNIT;
  m_viaGap: UNIT;
  m_viaTraceGapEqual: CHECK;
  onOK: () => void;
  onCancel: () => void;
}

function Row({
  label,
  u,
  labelFlag,
  labelBorder,
}: {
  label: string;
  u: UNIT;
  labelFlag: number;
  labelBorder: number;
}): JSX.Element {
  const off = u.enabled === false;

  return (
    <>
      <SizerItem flag={labelFlag} border={labelBorder}>
        <StaticText label={label} disabled={off} />
      </SizerItem>
      <SizerItem flag={wxEXPAND | wxRIGHT | wxLEFT | wxALIGN_CENTER_VERTICAL} border={5}>
        <TextCtrl
          value={u.value}
          onChange={u.onChange}
          disabled={off}
          inputRef={u.inputRef}
          ariaLabel={label.replace(/:$/, '')}
        />
      </SizerItem>
      <SizerItem flag={wxALIGN_CENTER_VERTICAL | wxRIGHT} border={5}>
        <StaticText label={u.units} disabled={off} />
      </SizerItem>
    </>
  );
}

export function DIALOG_PNS_DIFF_PAIR_DIMENSIONS_BASE(
  p: DIALOG_PNS_DIFF_PAIR_DIMENSIONS_BASE_PROPS,
): JSX.Element {
  return (
    <DialogShim title={_('Differential Pair Dimensions')} onClose={p.onCancel}>
      {/* bSizer7 */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={10}>
          {/* fgSizer1 = wxFlexGridSizer( 0, 3, 5, 0 ) */}
          <FlexGridSizer cols={3} vgap={5} hgap={0} growableCols={[1]}>
            <Row
              label={_('Width:')}
              u={p.m_traceWidth}
              labelFlag={wxALIGN_CENTER_VERTICAL | wxRIGHT | wxLEFT}
              labelBorder={1}
            />
            <Row
              label={_('Track gap:')}
              u={p.m_traceGap}
              labelFlag={wxALIGN_CENTER_VERTICAL | wxRIGHT}
              labelBorder={5}
            />
            <Row
              label={_('Via gap:')}
              u={p.m_viaGap}
              labelFlag={wxALIGN_CENTER_VERTICAL | wxLEFT}
              labelBorder={1}
            />
          </FlexGridSizer>
        </SizerItem>
        <SizerItem flag={wxALL | wxEXPAND} border={10}>
          <CheckBox label={_('Via gap same as track gap')} check={p.m_viaTraceGapEqual} />
        </SizerItem>
        <SizerItem flag={wxBOTTOM | wxEXPAND | wxTOP} border={5}>
          <StdDialogButtonSizer onOk={p.onOK} onCancel={p.onCancel} />
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
