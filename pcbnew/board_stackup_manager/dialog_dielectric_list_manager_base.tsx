// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_DIELECTRIC_MATERIAL_BASE` (pcbnew/board_stackup_manager/dialog_dielectric_list_manager_base.cpp):
 * a new material's name / epsilon R / loss tangent over the list of common materials. The
 * behaviour is DIALOG_DIELECTRIC_MATERIAL's (dialog_dielectric_list_manager.tsx).
 */
import type { JSX } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { ListCtrl, StaticText, TextCtrl } from '@ziroeda/wx/controls.js';
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
import { BoxSizer, FlexGridSizer, SizerItem, StdDialogButtonSizer } from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

type ENTRY = { value: string; onChange: (aText: string) => void };

export interface DIALOG_DIELECTRIC_MATERIAL_BASE_PROPS {
  m_tcMaterial: ENTRY;
  m_tcEpsilonR: ENTRY;
  m_tcLossTg: ENTRY;
  /** m_lcMaterials, wxLC_REPORT|wxLC_SINGLE_SEL. */
  m_lcMaterials: {
    rows: readonly (readonly string[])[];
    columnWidths: readonly number[];
    selection: number;
    onListItemSelected: (aRow: number) => void;
    onListKeyDown: (aKey: string) => void;
  };
  onOK: () => void;
  onCancel: () => void;
}

export function DIALOG_DIELECTRIC_MATERIAL_BASE(
  p: DIALOG_DIELECTRIC_MATERIAL_BASE_PROPS,
): JSX.Element {
  return (
    <DialogShim title={_('Dielectric Material Characteristics')} onClose={p.onCancel}>
      {/* bSizerMain */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem proportion={1} flag={wxBOTTOM | wxEXPAND | wxLEFT | wxRIGHT} border={10}>
          {/* bSizerUpper */}
          <BoxSizer orient={wxVERTICAL}>
            <SizerItem flag={wxEXPAND} border={5}>
              {/* bSizerNewItem */}
              <BoxSizer orient={wxHORIZONTAL}>
                <SizerItem proportion={1} border={5}>
                  {/* fgSizerNewDielectric = wxFlexGridSizer( 2, 3, 0, 5 ), growing column 0 */}
                  <FlexGridSizer cols={3} hgap={5} growableCols={[0]}>
                    <SizerItem flag={wxTOP | wxRIGHT | wxLEFT} border={5}>
                      <StaticText label={_('Name:')} />
                    </SizerItem>
                    <SizerItem flag={wxTOP | wxRIGHT | wxLEFT} border={5}>
                      <StaticText label={_('Epsilon R:')} />
                    </SizerItem>
                    <SizerItem flag={wxTOP | wxRIGHT | wxLEFT} border={5}>
                      <StaticText label={_('Loss Tan:')} />
                    </SizerItem>
                    <SizerItem
                      flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT}
                      border={5}
                      minSize={[150, -1]}
                    >
                      <TextCtrl
                        value={p.m_tcMaterial.value}
                        onChange={p.m_tcMaterial.onChange}
                        ariaLabel="Name"
                      />
                    </SizerItem>
                    <SizerItem flag={wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
                      <TextCtrl
                        value={p.m_tcEpsilonR.value}
                        onChange={p.m_tcEpsilonR.onChange}
                        ariaLabel={_('Epsilon R')}
                      />
                    </SizerItem>
                    <SizerItem flag={wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
                      <TextCtrl
                        value={p.m_tcLossTg.value}
                        onChange={p.m_tcLossTg.onChange}
                        ariaLabel={_('Loss Tan')}
                      />
                    </SizerItem>
                  </FlexGridSizer>
                </SizerItem>
              </BoxSizer>
            </SizerItem>
            <SizerItem flag={wxTOP | wxRIGHT | wxLEFT} border={5}>
              <StaticText label={_('Common materials:')} />
            </SizerItem>
            <SizerItem proportion={1} flag={wxALL | wxEXPAND} border={5}>
              <ListCtrl
                headers={[_('Material'), _('Epsilon R'), _('Loss Tan')]}
                rows={p.m_lcMaterials.rows}
                columnWidths={p.m_lcMaterials.columnWidths}
                selection={p.m_lcMaterials.selection}
                onSelect={p.m_lcMaterials.onListItemSelected}
                onKeyDown={p.m_lcMaterials.onListKeyDown}
                ariaLabel="Common materials"
              />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        <SizerItem flag={wxBOTTOM | wxEXPAND | wxTOP} border={5}>
          <StdDialogButtonSizer onOk={p.onOK} onCancel={p.onCancel} />
        </SizerItem>
      </BoxSizer>
    </DialogShim>
  );
}
