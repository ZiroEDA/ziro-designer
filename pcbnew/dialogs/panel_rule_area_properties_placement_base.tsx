// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_RULE_AREA_PROPERTIES_PLACEMENT_BASE`
 * (pcbnew/dialogs/panel_rule_area_properties_placement_base.cpp): the Rule Area dialog's
 * "Placement" page. Upstream has no derived class: DIALOG_RULE_AREA_PROPERTIES reads and writes
 * these members itself.
 */
import type { JSX } from 'react';
import { Combo } from '@ziroeda/wx/combobox.js';
import { RadioButton } from '@ziroeda/wx/controls.js';
import { wxALL, wxBOTTOM, wxEXPAND, wxLEFT, wxRIGHT, wxVERTICAL } from '@ziroeda/wx/defs.js';
import { BoxSizer, SizerItem, Spacer } from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

/** A wxCB_READONLY wxComboBox: its strings, GetSelection() (-1 for none) and Enable(). */
export interface READONLY_COMBO {
  items: readonly string[];
  selection: number;
  enabled: boolean;
  onChange: (aIndex: number) => void;
}

/** The radio set: null is m_DisabledRb. */
export type PLACEMENT_SOURCE = 'sheetname' | 'component_class' | 'group' | null;

export interface PANEL_RULE_AREA_PROPERTIES_PLACEMENT_BASE_PROPS {
  /** Which of m_DisabledRb, m_SheetRb, m_ComponentsRb, m_GroupRb is set. */
  source: PLACEMENT_SOURCE;
  onSourceChange: (aSource: PLACEMENT_SOURCE) => void;
  m_sheetCombo: READONLY_COMBO;
  m_componentClassCombo: READONLY_COMBO;
  m_groupCombo: READONLY_COMBO;
}

export function PANEL_RULE_AREA_PROPERTIES_PLACEMENT_BASE(
  p: PANEL_RULE_AREA_PROPERTIES_PLACEMENT_BASE_PROPS,
): JSX.Element {
  const radio = (aLabel: string, aSource: typeof p.source): JSX.Element => (
    <RadioButton
      label={aLabel}
      name="m_placementSource"
      checked={p.source === aSource}
      onChange={() => p.onSourceChange(aSource)}
    />
  );
  const combo = (c: READONLY_COMBO, aName: string): JSX.Element => (
    <Combo
      value={c.selection < 0 ? '' : String(c.selection)}
      options={c.items.map((label, i) => ({ value: String(i), label }))}
      onChange={(v) => c.onChange(Number(v))}
      disabled={!c.enabled}
      ariaLabel={aName}
    />
  );

  return (
    // bMainSizer
    <BoxSizer orient={wxVERTICAL}>
      <SizerItem proportion={1} flag={wxEXPAND | wxBOTTOM | wxRIGHT} border={5}>
        {/* bMarginsSizer */}
        <BoxSizer orient={wxVERTICAL}>
          <SizerItem flag={wxALL} border={5}>
            {radio(_('No placement'), null)}
          </SizerItem>
          <SizerItem flag={wxALL} border={5}>
            {radio(_('Place items from sheet:'), 'sheetname')}
          </SizerItem>
          <SizerItem flag={wxLEFT | wxEXPAND} border={25}>
            {combo(p.m_sheetCombo, 'Sheet')}
          </SizerItem>
          <Spacer width={0} height={15} flag={wxEXPAND} border={5} />
          <SizerItem flag={wxALL} border={5}>
            {radio(_('Place items matching component class:'), 'component_class')}
          </SizerItem>
          <SizerItem flag={wxLEFT | wxEXPAND} border={25}>
            {combo(p.m_componentClassCombo, 'Component class')}
          </SizerItem>
          <Spacer width={0} height={15} border={5} />
          <SizerItem flag={wxALL} border={5}>
            {radio(_('Place items in group:'), 'group')}
          </SizerItem>
          <SizerItem flag={wxEXPAND | wxLEFT} border={25}>
            {combo(p.m_groupCombo, 'Group')}
          </SizerItem>
          <Spacer width={0} height={5} proportion={1} flag={wxEXPAND} border={5} />
        </BoxSizer>
      </SizerItem>
    </BoxSizer>
  );
}
