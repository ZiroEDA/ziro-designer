// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_OUTSET_ITEMS_BASE` (pcbnew/dialogs/dialog_outset_items_base.cpp): the sizer tree, Add()
 * for Add(). The members are props; the behaviour is DIALOG_OUTSET_ITEMS's
 * (dialog_outset_items.tsx).
 */
import type { JSX } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { Combo, type ComboOption, TextCombo } from '@ziroeda/wx/combobox.js';
import { Button, type CHECK, CheckBox, StaticLine, StaticText } from '@ziroeda/wx/controls.js';
import {
  wxALIGN_CENTER_VERTICAL,
  wxALIGN_RIGHT,
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
  GridBagSizer,
  SizerItem,
  Spacer,
  StdDialogButtonSizer,
} from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

/** A UNIT_BINDER over a wxComboBox: its text, its SetOptionsList strings, units and Enable(). */
export interface UNIT_COMBO {
  value: string;
  options: readonly string[];
  units: string;
  enabled?: boolean;
  onChange: (aText: string) => void;
}

export interface DIALOG_OUTSET_ITEMS_BASE_PROPS {
  m_outset: UNIT_COMBO;
  m_roundCorners: CHECK;
  m_roundToGrid: CHECK;
  m_roundingGrid: UNIT_COMBO;
  m_copyLayers: CHECK;
  /** `m_LayerSelectionCtrl`, a PCB_LAYER_BOX_SELECTOR: its rows, selection and Enable(). */
  layerRows: readonly ComboOption[];
  layer: string;
  layerEnabled: boolean;
  onLayerChange: (aLayer: string) => void;
  m_copyWidths: CHECK;
  m_lineWidth: UNIT_COMBO;
  onLayerDefault: () => void;
  m_deleteSourceItems: CHECK;
  onOK: () => void;
  onCancel: () => void;
}

function UnitRow({
  row,
  label,
  u,
  ariaLabel,
}: {
  row: number;
  label: string;
  u: UNIT_COMBO;
  ariaLabel: string;
}): JSX.Element {
  const off = u.enabled === false;

  return (
    <>
      <SizerItem pos={[row, 0]} flag={wxALIGN_CENTER_VERTICAL | wxALL} border={5}>
        <StaticText label={label} disabled={off} />
      </SizerItem>
      <SizerItem pos={[row, 1]} span={[1, 2]} flag={wxALL | wxEXPAND} border={5}>
        <TextCombo
          value={u.value}
          options={u.options}
          onChange={u.onChange}
          disabled={off}
          ariaLabel={ariaLabel}
        />
      </SizerItem>
      <SizerItem
        pos={[row, 3]}
        flag={wxALIGN_CENTER_VERTICAL | wxTOP | wxBOTTOM | wxRIGHT}
        border={5}
      >
        <StaticText label={u.units} disabled={off} />
      </SizerItem>
    </>
  );
}

export function DIALOG_OUTSET_ITEMS_BASE(p: DIALOG_OUTSET_ITEMS_BASE_PROPS): JSX.Element {
  return (
    <DialogShim title={_('Outset Items')} onClose={p.onCancel}>
      {/* bMainSizer */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem proportion={1} flag={wxEXPAND | wxALL} border={5}>
          {/* gbSizer1 = wxGridBagSizer( 0, 0 ) */}
          <GridBagSizer vgap={0} hgap={0} growableCols={[1]}>
            <UnitRow row={0} label={_('Outset:')} u={p.m_outset} ariaLabel={_('Outset')} />
            <SizerItem pos={[1, 0]} span={[1, 4]} flag={wxALL | wxEXPAND} border={5}>
              <CheckBox label={_('Round corners (when possible)')} check={p.m_roundCorners} />
            </SizerItem>
            <SizerItem pos={[2, 0]} span={[1, 4]} flag={wxALL | wxEXPAND} border={5}>
              <CheckBox
                label={_('Round outwards to grid multiples (when possible)')}
                check={p.m_roundToGrid}
                title={_('This is only possible for rectangular outsets.')}
              />
            </SizerItem>
            <UnitRow
              row={3}
              label={_('Grid size:')}
              u={p.m_roundingGrid}
              ariaLabel={_('Grid size')}
            />
            <SizerItem pos={[4, 0]} span={[1, 4]} flag={wxEXPAND | wxTOP | wxBOTTOM} border={5}>
              <StaticLine />
            </SizerItem>
            <SizerItem
              pos={[5, 0]}
              span={[1, 4]}
              flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT}
              border={5}
            >
              <CheckBox label={_('Copy item layers')} check={p.m_copyLayers} />
            </SizerItem>
            <SizerItem pos={[6, 0]} flag={wxALIGN_CENTER_VERTICAL | wxALL} border={5}>
              <StaticText label={_('Layer:')} disabled={!p.layerEnabled} />
            </SizerItem>
            <SizerItem pos={[6, 1]} span={[1, 3]} flag={wxALL | wxEXPAND} border={5}>
              <Combo
                value={p.layer}
                options={p.layerRows}
                onChange={p.onLayerChange}
                disabled={!p.layerEnabled}
                ariaLabel="Layer"
              />
            </SizerItem>
            <SizerItem pos={[7, 0]} span={[1, 4]} flag={wxALL} border={5}>
              <CheckBox
                label={_('Copy item widths (if possible)')}
                check={p.m_copyWidths}
                title={_(
                  'This is not possible for items like pads, which will still use the value below.',
                )}
              />
            </SizerItem>
            <SizerItem
              pos={[8, 0]}
              flag={wxALIGN_CENTER_VERTICAL | wxALIGN_RIGHT | wxALL}
              border={5}
            >
              <StaticText label={_('Line width:')} />
            </SizerItem>
            <SizerItem pos={[8, 1]} flag={wxALL | wxEXPAND | wxALIGN_CENTER_VERTICAL} border={5}>
              <TextCombo
                value={p.m_lineWidth.value}
                options={p.m_lineWidth.options}
                onChange={p.m_lineWidth.onChange}
                ariaLabel={_('Line width')}
              />
            </SizerItem>
            <SizerItem pos={[8, 2]} flag={wxALIGN_CENTER_VERTICAL | wxRIGHT} border={10}>
              <StaticText label={p.m_lineWidth.units} />
            </SizerItem>
            <SizerItem pos={[8, 3]} flag={wxRIGHT | wxLEFT | wxALIGN_CENTER_VERTICAL} border={5}>
              <Button label={_('Layer Default')} onClick={p.onLayerDefault} />
            </SizerItem>
            <SizerItem pos={[9, 0]} span={[1, 4]} flag={wxEXPAND | wxTOP | wxBOTTOM} border={5}>
              <StaticLine />
            </SizerItem>
            <SizerItem pos={[10, 0]} span={[1, 4]} flag={wxALL} border={5}>
              <CheckBox
                label={_('Delete source items after outset')}
                check={p.m_deleteSourceItems}
                title={_(
                  'This is not possible for items like pads, which will still use the value below.',
                )}
              />
            </SizerItem>
          </GridBagSizer>
        </SizerItem>
        <SizerItem flag={wxEXPAND | wxTOP} border={5}>
          {/* bSizerBottom */}
          <BoxSizer orient={wxHORIZONTAL}>
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
