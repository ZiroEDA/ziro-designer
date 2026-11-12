// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_ZONE_PROPERTIES_BASE` (pcbnew/dialogs/panel_zone_properties_base.cpp): the panel the Copper
 * Zone dialog and the Zone Manager both put a zone's fields in, Add() for Add(). The members are
 * props; the behaviour is PANEL_ZONE_PROPERTIES's (panel_zone_properties.tsx).
 */
import type { JSX, ReactNode } from 'react';
import { Infobar } from '@ziroeda/common/widgets/wx_infobar.js';
import { type NetInfoList, NetSelector } from '@ziroeda/common/widgets/net_selector.js';
import { StdBitmapButton } from '@ziroeda/common/widgets/std_bitmap_button.js';
import {
  type CHECK,
  type CHOICE,
  CheckBox,
  Choice,
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
  wxRESERVE_SPACE_EVEN_IF_HIDDEN,
  wxRIGHT,
  wxTOP,
  wxVERTICAL,
} from '@ziroeda/wx/defs.js';
import { Notebook } from '@ziroeda/wx/notebook_ui.js';
import { BoxSizer, GridBagSizer, SizerItem, Spacer } from '@ziroeda/wx/sizer.js';
import { SpinCtrl } from '@ziroeda/wx/spin_ctrl.js';
import { _ } from '@ziroeda/wx/translation.js';

/** A UNIT_BINDER (or a plain wxTextCtrl with its unit text): label, text, unit, Enable(). */
export interface UNIT_FIELD {
  value: string;
  units: string;
  enabled?: boolean;
  onChange: (aText: string) => void;
}

export interface PANEL_ZONE_PROPERTIES_BASE_PROPS {
  /** `m_copperZoneInfoBar`: its message while shown. */
  m_copperZoneInfoBar: string | null;
  m_tcZoneName: { value: string; onChange: (aText: string) => void };
  /** `m_netLabel` / `m_netSelector`, hidden when !allowNetSpec. */
  netShown: boolean;
  m_netSelector: { netInfo: NetInfoList; netcode: number; onChange: (aNetcode: number) => void };
  m_cbLocked: CHECK;
  m_notebook: { selection: number; onPageChanged: (aPage: number) => void };
  m_clearance: UNIT_FIELD;
  m_minWidth: UNIT_FIELD;
  m_PadInZoneOpt: CHOICE;
  m_antipad: UNIT_FIELD;
  m_spokeWidth: UNIT_FIELD;
  m_OutlineDisplayCtrl: CHOICE;
  m_outlineHatchPitch: UNIT_FIELD;
  m_cbHatched: CHECK;
  m_gridStyleRotation: UNIT_FIELD;
  m_gridStyleThickness: UNIT_FIELD;
  m_gridStyleGap: UNIT_FIELD;
  m_spinCtrlSmoothLevel: { value: number; enabled: boolean; onChange: (aValue: number) => void };
  m_spinCtrlSmoothValue: { value: number; enabled: boolean; onChange: (aValue: number) => void };
  /** `m_layerSpecificOverrides`, a WX_GRID over LAYER_PROPERTIES_GRID_TABLE. */
  m_layerSpecificOverrides: ReactNode;
  overridesEnabled: boolean;
  OnAddLayerItem: () => void;
  OnDeleteLayerItem: () => void;
  m_cornerSmoothingChoice: CHOICE;
  m_cornerRadius: UNIT_FIELD;
  /** `m_cornerRadiusLabel/Ctrl/Units->Show()`. */
  cornerRadiusShown: boolean;
  m_cbRemoveIslands: CHOICE;
  m_islandThreshold: UNIT_FIELD;
  islandThresholdShown: boolean;
}

const CV = wxALIGN_CENTER_VERTICAL;

function UnitCtrl({ f, ariaLabel }: { f: UNIT_FIELD; ariaLabel: string }): JSX.Element {
  return (
    <TextCtrl
      value={f.value}
      onChange={f.onChange}
      disabled={f.enabled === false}
      ariaLabel={ariaLabel}
    />
  );
}

export function PANEL_ZONE_PROPERTIES_BASE(p: PANEL_ZONE_PROPERTIES_BASE_PROPS): JSX.Element {
  const clearances = (
    // m_clearancesPanel: bClearancesSizer
    <BoxSizer orient={wxVERTICAL}>
      <SizerItem flag={wxALL} border={5}>
        {/* gbSizerClearances = wxGridBagSizer( 1, 1 ), SetEmptyCellSize( wxSize( -1,10 ) ) */}
        <GridBagSizer vgap={1} hgap={1} emptyCellSize={[-1, 10]} growableCols={[2]}>
          <SizerItem pos={[0, 0]} flag={CV | wxTOP | wxBOTTOM | wxLEFT} border={5}>
            <StaticText
              label={_('Clearance:')}
              title={_('Copper clearance for this zone (set to 0 to use the netclass clearance)')}
            />
          </SizerItem>
          <SizerItem pos={[0, 1]} flag={wxEXPAND | wxALL} border={4}>
            <UnitCtrl f={p.m_clearance} ariaLabel="Clearance" />
          </SizerItem>
          <SizerItem pos={[0, 2]} flag={CV | wxTOP | wxBOTTOM | wxRIGHT} border={5}>
            <StaticText label={p.m_clearance.units} />
          </SizerItem>
          <SizerItem pos={[1, 0]} flag={CV | wxBOTTOM | wxLEFT} border={5}>
            <StaticText
              label={_('Minimum width:')}
              title={_('Minimum thickness of filled areas.')}
            />
          </SizerItem>
          <SizerItem pos={[1, 1]} flag={wxEXPAND | wxBOTTOM | wxRIGHT | wxLEFT} border={4}>
            <UnitCtrl f={p.m_minWidth} ariaLabel={_('Minimum width')} />
          </SizerItem>
          <SizerItem pos={[1, 2]} flag={CV | wxBOTTOM | wxRIGHT} border={5}>
            <StaticText label={p.m_minWidth.units} />
          </SizerItem>
          <SizerItem pos={[3, 0]} flag={CV | wxTOP | wxLEFT} border={5}>
            <StaticText
              label={_('Pad connections:')}
              title={_(
                'Default pad connection type to zone.\nThis setting can be overridden by local  pad settings',
              )}
            />
          </SizerItem>
          <SizerItem pos={[3, 1]} flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT | CV} border={5}>
            <Choice
              choices={[_('Solid'), _('Thermal reliefs'), _('Reliefs for PTH'), _('None')]}
              choice={p.m_PadInZoneOpt}
              ariaLabel={_('Pad connections')}
            />
          </SizerItem>
          <SizerItem pos={[4, 0]} flag={CV | wxLEFT | wxTOP} border={4}>
            <StaticText
              label={_('Thermal relief gap:')}
              title={_(
                'The distance that will be kept clear between the filled area of the zone and a pad connected by thermal relief spokes.',
              )}
            />
          </SizerItem>
          <SizerItem pos={[4, 1]} flag={wxEXPAND | wxTOP | wxRIGHT | wxLEFT} border={4}>
            <UnitCtrl f={p.m_antipad} ariaLabel={_('Thermal relief gap')} />
          </SizerItem>
          <SizerItem pos={[4, 2]} flag={CV | wxTOP | wxRIGHT} border={5}>
            <StaticText label={p.m_antipad.units} />
          </SizerItem>
          <SizerItem pos={[5, 0]} flag={CV | wxBOTTOM | wxLEFT | wxTOP} border={4}>
            <StaticText label={_('Thermal spoke width:')} />
          </SizerItem>
          <SizerItem pos={[5, 1]} flag={wxEXPAND | wxALL} border={4}>
            <UnitCtrl f={p.m_spokeWidth} ariaLabel={_('Thermal spoke width')} />
          </SizerItem>
          <SizerItem pos={[5, 2]} flag={CV | wxTOP | wxBOTTOM | wxRIGHT} border={5}>
            <StaticText label={p.m_spokeWidth.units} />
          </SizerItem>
        </GridBagSizer>
      </SizerItem>
    </BoxSizer>
  );

  const displayOverrides = (
    // m_displayOverridesPanel: bDisplayOverridesSizer
    <BoxSizer orient={wxVERTICAL}>
      <SizerItem flag={wxALL} border={5}>
        {/* gbSizerDisplayOverrides = wxGridBagSizer( 5, 5 ) */}
        <GridBagSizer vgap={5} hgap={5} growableCols={[2]}>
          <SizerItem pos={[0, 0]} flag={CV | wxTOP | wxLEFT} border={5}>
            <StaticText label={_('Outline display:')} />
          </SizerItem>
          <SizerItem pos={[0, 1]} flag={wxEXPAND | CV | wxTOP} border={5}>
            <Choice
              choices={[_('Line'), _('Hatched'), _('Fully hatched')]}
              choice={p.m_OutlineDisplayCtrl}
              ariaLabel={_('Outline display')}
            />
          </SizerItem>
          <SizerItem pos={[1, 0]} flag={CV | wxLEFT} border={5}>
            <StaticText label={_('Outline hatch pitch:')} />
          </SizerItem>
          <SizerItem pos={[1, 1]} flag={CV | wxEXPAND} border={5}>
            <UnitCtrl f={p.m_outlineHatchPitch} ariaLabel={_('Outline hatch pitch')} />
          </SizerItem>
          <SizerItem pos={[1, 2]} flag={CV | wxRIGHT} border={5}>
            <StaticText label={p.m_outlineHatchPitch.units} />
          </SizerItem>
        </GridBagSizer>
      </SizerItem>
    </BoxSizer>
  );

  const hatchRow = (aRow: number, aLabel: string, f: UNIT_FIELD, aName: string): JSX.Element => (
    <>
      <SizerItem pos={[aRow, 0]} flag={CV | wxBOTTOM | wxLEFT} border={5}>
        <StaticText label={aLabel} disabled={f.enabled === false} />
      </SizerItem>
      <SizerItem pos={[aRow, 1]} flag={wxEXPAND | CV | wxBOTTOM | wxRIGHT | wxLEFT} border={5}>
        <UnitCtrl f={f} ariaLabel={aName} />
      </SizerItem>
      <SizerItem pos={[aRow, 2]} flag={CV | wxBOTTOM | wxRIGHT} border={5}>
        <StaticText label={f.units} disabled={f.enabled === false} />
      </SizerItem>
    </>
  );

  const hatchedFill = (
    // m_hatchedFillPanel: bHatchedFillSizer
    <BoxSizer orient={wxHORIZONTAL}>
      <SizerItem flag={wxALL} border={5}>
        {/* gbSizerHatchedFill = wxGridBagSizer( 0, 0 ), SetEmptyCellSize( wxSize( -1,10 ) ) */}
        <GridBagSizer vgap={0} hgap={0} emptyCellSize={[-1, 10]} growableCols={[2]}>
          <SizerItem pos={[0, 0]} flag={wxLEFT | wxRIGHT} border={5}>
            <CheckBox label={_('Hatched fill')} check={p.m_cbHatched} />
          </SizerItem>
          <SizerItem pos={[1, 0]} flag={CV | wxBOTTOM | wxLEFT | wxTOP} border={5}>
            <StaticText
              label={_('Orientation:')}
              disabled={p.m_gridStyleRotation.enabled === false}
            />
          </SizerItem>
          <SizerItem pos={[1, 1]} flag={wxEXPAND | CV | wxALL} border={5}>
            <UnitCtrl f={p.m_gridStyleRotation} ariaLabel="Orientation" />
          </SizerItem>
          <SizerItem pos={[1, 2]} flag={CV | wxTOP | wxBOTTOM | wxRIGHT} border={5}>
            <StaticText
              label={p.m_gridStyleRotation.units}
              disabled={p.m_gridStyleRotation.enabled === false}
            />
          </SizerItem>
          {hatchRow(2, _('Hatch width:'), p.m_gridStyleThickness, 'Hatch width')}
          {hatchRow(3, _('Hatch gap:'), p.m_gridStyleGap, 'Hatch gap')}
          <SizerItem pos={[4, 0]} flag={CV | wxBOTTOM | wxLEFT} border={5}>
            <StaticText
              label={_('Smoothing effort:')}
              disabled={!p.m_spinCtrlSmoothLevel.enabled}
              title={_(
                'Value of smoothing effort\n0 = no smoothing\n1 = chamfer\n2 = round corners\n3 = round corners (finer shape)',
              )}
            />
          </SizerItem>
          <SizerItem pos={[4, 1]} flag={wxBOTTOM | wxRIGHT | wxLEFT | CV | wxEXPAND} border={5}>
            {/* wxSpinCtrl( …, 0, 3, 0 ) */}
            <SpinCtrl
              value={p.m_spinCtrlSmoothLevel.value}
              onChange={p.m_spinCtrlSmoothLevel.onChange}
              min={0}
              max={3}
              disabled={!p.m_spinCtrlSmoothLevel.enabled}
              ariaLabel={_('Smoothing effort')}
            />
          </SizerItem>
          <SizerItem pos={[5, 0]} flag={CV | wxBOTTOM | wxLEFT} border={5}>
            <StaticText
              label={_('Smoothing amount:')}
              disabled={!p.m_spinCtrlSmoothValue.enabled}
              title={_(
                'Ratio between smoothed corners size and the gap between lines\n0 = no smoothing\n1.0 = max radius/chamfer size (half gap value)',
              )}
            />
          </SizerItem>
          <SizerItem pos={[5, 1]} flag={wxBOTTOM | wxRIGHT | wxLEFT | CV | wxEXPAND} border={5}>
            {/* wxSpinCtrlDouble( …, 0, 1, 0.1, 0.1 ), SetDigits( 2 ) */}
            <SpinCtrl
              value={p.m_spinCtrlSmoothValue.value}
              onChange={p.m_spinCtrlSmoothValue.onChange}
              min={0}
              max={1}
              step={0.1}
              digits={2}
              disabled={!p.m_spinCtrlSmoothValue.enabled}
              ariaLabel={_('Smoothing amount')}
            />
          </SizerItem>
        </GridBagSizer>
      </SizerItem>
      <SizerItem proportion={1} flag={wxEXPAND | wxRIGHT | wxLEFT} border={5}>
        {/* bSizerOffsetOverrides */}
        <BoxSizer orient={wxVERTICAL}>
          <SizerItem flag={wxTOP | wxRIGHT | wxLEFT} border={5}>
            <StaticText label={_('Hatch offset overrides:')} disabled={!p.overridesEnabled} />
          </SizerItem>
          <Spacer width={0} height={2} border={5} />
          <SizerItem proportion={1} flag={wxEXPAND | wxRIGHT | wxLEFT} border={5}>
            {p.m_layerSpecificOverrides}
          </SizerItem>
          <SizerItem flag={wxEXPAND | wxTOP | wxBOTTOM} border={5}>
            {/* bButtonSizer */}
            <BoxSizer orient={wxHORIZONTAL}>
              <SizerItem flag={wxLEFT | wxRIGHT} border={5}>
                <StdBitmapButton
                  bitmap="small_plus"
                  title={_('Add a layer override')}
                  tooltip={null}
                  disabled={!p.overridesEnabled}
                  onClick={p.OnAddLayerItem}
                />
              </SizerItem>
              <Spacer width={20} height={0} flag={wxEXPAND} border={5} />
              <SizerItem flag={wxRIGHT} border={5}>
                <StdBitmapButton
                  bitmap="small_trash"
                  title={_('Delete a layer override')}
                  tooltip={null}
                  disabled={!p.overridesEnabled}
                  onClick={p.OnDeleteLayerItem}
                />
              </SizerItem>
            </BoxSizer>
          </SizerItem>
        </BoxSizer>
      </SizerItem>
    </BoxSizer>
  );

  const hidden = (aShown: boolean) => ({ shown: aShown });

  return (
    // bMainSizer > bSizer8
    <BoxSizer orient={wxHORIZONTAL}>
      <SizerItem proportion={1} flag={wxEXPAND} border={5}>
        <BoxSizer orient={wxVERTICAL}>
          <SizerItem flag={wxEXPAND} border={5} shown={p.m_copperZoneInfoBar !== null}>
            {/* SetShowHideEffects( wxSHOW_EFFECT_NONE, … ): no close button, dismissed by
                updateInfoBar() itself */}
            <Infobar message={p.m_copperZoneInfoBar ?? ''} />
          </SizerItem>
          <SizerItem proportion={1} flag={wxEXPAND} border={5}>
            {/* bPropertiesSizer */}
            <BoxSizer orient={wxVERTICAL}>
              <SizerItem flag={wxEXPAND | wxALL} border={5}>
                {/* gbSizer8 = wxGridBagSizer( 3, 5 ) */}
                <GridBagSizer vgap={3} hgap={5} growableCols={[1]}>
                  <SizerItem pos={[0, 0]} flag={CV} border={5}>
                    <StaticText
                      label={_('Zone name:')}
                      title={_('A unique name for this zone, used to identify it in DRC rules')}
                    />
                  </SizerItem>
                  <SizerItem pos={[0, 1]} flag={CV | wxEXPAND} border={5}>
                    <TextCtrl
                      value={p.m_tcZoneName.value}
                      onChange={p.m_tcZoneName.onChange}
                      ariaLabel={_('Zone name')}
                      title={_('A unique name for this zone, used to identify it in DRC rules')}
                    />
                  </SizerItem>
                  <SizerItem pos={[1, 0]} flag={CV} border={5} {...hidden(p.netShown)}>
                    <StaticText label={_('Net name:')} />
                  </SizerItem>
                  <SizerItem pos={[1, 1]} flag={CV | wxEXPAND} border={5} {...hidden(p.netShown)}>
                    <NetSelector
                      netInfo={p.m_netSelector.netInfo}
                      netcode={p.m_netSelector.netcode}
                      onChange={p.m_netSelector.onChange}
                    />
                  </SizerItem>
                </GridBagSizer>
              </SizerItem>
              <SizerItem flag={wxLEFT | wxRIGHT} border={5}>
                <CheckBox label={_('Locked')} check={p.m_cbLocked} />
              </SizerItem>
              <SizerItem proportion={1} flag={wxEXPAND | wxALL} border={5}>
                <Notebook
                  selection={p.m_notebook.selection}
                  onPageChanged={p.m_notebook.onPageChanged}
                  pages={[
                    // "Clearances && Pad Connections": && is a literal &
                    { text: _('Clearances & Pad Connections'), content: clearances },
                    { text: _('Display Overrides'), content: displayOverrides },
                    { text: _('Hatched Fill'), content: hatchedFill },
                  ]}
                />
              </SizerItem>
              <SizerItem flag={wxALL | wxEXPAND} border={10}>
                {/* gbSizerGeneralProps = wxGridBagSizer( 5, 5 ) */}
                <GridBagSizer vgap={5} hgap={5} growableCols={[1, 3]}>
                  <SizerItem pos={[0, 0]} flag={CV} border={5}>
                    <StaticText label={_('Corner smoothing:')} />
                  </SizerItem>
                  <SizerItem pos={[0, 1]} flag={CV | wxEXPAND} border={2}>
                    <Choice
                      choices={[_('None'), _('Chamfer'), _('Fillet')]}
                      choice={p.m_cornerSmoothingChoice}
                      ariaLabel={_('Corner smoothing')}
                    />
                  </SizerItem>
                  <SizerItem
                    pos={[0, 2]}
                    flag={CV | wxLEFT | wxRESERVE_SPACE_EVEN_IF_HIDDEN}
                    border={10}
                    {...hidden(p.cornerRadiusShown)}
                  >
                    <StaticText label={_('Radius:')} />
                  </SizerItem>
                  <SizerItem
                    pos={[0, 3]}
                    flag={CV | wxEXPAND | wxRESERVE_SPACE_EVEN_IF_HIDDEN}
                    border={5}
                    {...hidden(p.cornerRadiusShown)}
                  >
                    <UnitCtrl f={p.m_cornerRadius} ariaLabel={_('Radius')} />
                  </SizerItem>
                  <SizerItem
                    pos={[0, 4]}
                    flag={CV | wxRESERVE_SPACE_EVEN_IF_HIDDEN}
                    border={5}
                    {...hidden(p.cornerRadiusShown)}
                  >
                    <StaticText label={p.m_cornerRadius.units} />
                  </SizerItem>
                  <SizerItem pos={[1, 0]} flag={CV} border={5}>
                    <StaticText
                      label={_('Remove islands:')}
                      title={_('Choose what to do with unconnected copper islands')}
                    />
                  </SizerItem>
                  <SizerItem pos={[1, 1]} flag={CV | wxEXPAND} border={2}>
                    <Choice
                      choices={[_('Always'), _('Never'), _('Below area limit')]}
                      choice={p.m_cbRemoveIslands}
                      ariaLabel={_('Remove islands')}
                    />
                  </SizerItem>
                  <SizerItem
                    pos={[1, 2]}
                    flag={CV | wxLEFT | wxRESERVE_SPACE_EVEN_IF_HIDDEN}
                    border={10}
                    {...hidden(p.islandThresholdShown)}
                  >
                    <StaticText
                      label={_('Area limit:')}
                      title={_('Isolated islands smaller than this will be removed')}
                    />
                  </SizerItem>
                  <SizerItem
                    pos={[1, 3]}
                    flag={CV | wxEXPAND | wxRESERVE_SPACE_EVEN_IF_HIDDEN}
                    border={5}
                    {...hidden(p.islandThresholdShown)}
                  >
                    <UnitCtrl f={p.m_islandThreshold} ariaLabel={_('Area limit')} />
                  </SizerItem>
                  <SizerItem
                    pos={[1, 4]}
                    flag={CV | wxRESERVE_SPACE_EVEN_IF_HIDDEN}
                    border={5}
                    {...hidden(p.islandThresholdShown)}
                  >
                    <StaticText label={p.m_islandThreshold.units} />
                  </SizerItem>
                </GridBagSizer>
              </SizerItem>
            </BoxSizer>
          </SizerItem>
        </BoxSizer>
      </SizerItem>
    </BoxSizer>
  );
}
