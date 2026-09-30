// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_ZONE_PROPERTIES`'s window (`panel_zone_properties_base.cpp`, folded in:
 * `_base` is not split out here), the panel the Copper Zone dialog and the Zone
 * Manager both put a zone's fields in. The logic is `PANEL_ZONE_PROPERTIES` in
 * `panel_zone_properties.ts`; this is a view over the values it holds.
 *
 * The panel is, top to bottom:
 *
 *   1. `m_copperZoneInfoBar` — a WX_INFOBAR, shown only for `<no net>`
 *   2. `gbSizer8`, a `wxGridBagSizer( 3, 5 )`: Zone name, then Net name
 *   3. `m_cbLocked`
 *   4. `m_notebook` — three tabs: Clearances && Pad Connections / Display
 *      Overrides / Hatched Fill
 *   5. `gbSizerGeneralProps`, a `wxGridBagSizer( 5, 5 )` outside the notebook:
 *      Corner smoothing + Radius, Remove islands + Area limit
 *
 * Radius and Area limit carry `wxRESERVE_SPACE_EVEN_IF_HIDDEN` and are
 * `Show( false )` when they do not apply. With `allowNetSpec` false the net
 * label and selector are hidden (`m_netLabel->Hide(); m_netSelector->Hide()`).
 */

import { useState, type JSX } from 'react';
import type { ZoneValues } from './panel_zone_properties.js';
import { Combo } from '@ziroeda/common/widgets/wx_combobox.js';
import { Infobar } from '@ziroeda/common/widgets/wx_infobar.js';
import { NetSelector } from '@ziroeda/common/widgets/net_selector.js';
import { pcbUnitText, pcbUnitValue, unitLabel } from '../pcb_unit_binder.js';
import type { StatusUnits } from '@ziroeda/common/widgets/kistatusbar_format.js';

export interface PanelZonePropertiesProps {
  /** What the panel's controls hold. */
  values: ZoneValues;
  /** A control changed: the fields that moved. */
  onChange: (patch: Partial<ZoneValues>) => void;
  /**
   * The frame's display units. Every distance here is a `UNIT_BINDER`
   * upstream, so it shows and reads the frame's unit rather than a fixed mm.
   */
  units: StatusUnits;
  /** Net codes and names, for the `NET_SELECTOR`. */
  nets: ReadonlyMap<number, string>;
  /** `allowNetSpec`. */
  allowNetSpec?: boolean;
  /**
   * `m_isTeardrop`: outlines are never smoothed and the pad connection is
   * fixed, so those two controls are disabled.
   */
  teardrop?: boolean;
}

/** `m_PadInZoneOptChoices` (`panel_zone_properties_base.cpp:105`), in order. */
const PAD_CONNECTION = [
  { value: 'full', label: 'Solid' },
  { value: 'thermal', label: 'Thermal reliefs' },
  { value: 'thru_hole_only', label: 'Reliefs for PTH' },
  { value: 'none', label: 'None' },
] as const;

/** `m_OutlineDisplayCtrlChoices` (`:166`). */
const OUTLINE_DISPLAY = [
  { value: 'none', label: 'Line' },
  { value: 'edge', label: 'Hatched' },
  { value: 'full', label: 'Fully hatched' },
] as const;

/** `m_cornerSmoothingChoiceChoices` (`:344`). */
const CORNER_SMOOTHING = [
  { value: 'none', label: 'None' },
  { value: 'chamfer', label: 'Chamfer' },
  { value: 'fillet', label: 'Fillet' },
] as const;

/** `m_cbRemoveIslandsChoices` (`:370`) — the ISLAND_REMOVAL_MODE order. */
const REMOVE_ISLANDS = [
  { value: 'always', label: 'Always' },
  { value: 'never', label: 'Never' },
  { value: 'area', label: 'Below area limit' },
] as const;

type Tab = 'clearances' | 'display' | 'hatched';

export function PanelZoneProperties({
  values: v,
  onChange: set,
  units,
  nets,
  allowNetSpec = true,
  teardrop = false,
}: PanelZonePropertiesProps): JSX.Element {
  // `AddPage( m_clearancesPanel, …, true )` — the first tab opens selected.
  const [tab, setTab] = useState<Tab>('clearances');
  // Distance boxes are held as text so a half-typed number survives the caret.
  const [text, setText] = useState<Record<string, string>>({});

  /** A `UNIT_BINDER` row: label, control, unit suffix. */
  const dist = (label: string, key: keyof ZoneValues, title?: string): JSX.Element => (
    <>
      <label className="lbl" htmlFor={`ze-cz-${key}`} title={title}>
        {label}
      </label>
      <input
        id={`ze-cz-${key}`}
        type="text"
        value={text[key] ?? pcbUnitText(v[key] as number, units)}
        onChange={(e) => {
          setText((p) => ({ ...p, [key]: e.target.value }));
          const iu = pcbUnitValue(e.target.value, units);
          if (Number.isFinite(iu)) set({ [key]: iu } as Partial<ZoneValues>);
        }}
      />
      <span className="unit">{unitLabel(units)}</span>
    </>
  );

  /** A plain number row — degrees, mm², a ratio: not internal units. */
  const num = (
    label: string,
    key: keyof ZoneValues,
    unit: string,
    opts: { title?: string; step?: number; min?: number; max?: number } = {},
  ): JSX.Element => (
    <>
      <label className="lbl" htmlFor={`ze-cz-${key}`} title={opts.title}>
        {label}
      </label>
      <input
        id={`ze-cz-${key}`}
        type={opts.step === undefined ? 'text' : 'number'}
        step={opts.step}
        min={opts.min}
        max={opts.max}
        value={String(v[key])}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) set({ [key]: n } as Partial<ZoneValues>);
        }}
      />
      <span className="unit">{unit}</span>
    </>
  );

  // `onNetSelector`: "Zones with no net never have islands removed" — the
  // choice is forced to Never AND disabled, and the infobar comes up.
  // `onNetSelector` returns at once when the selector is hidden.
  const noNet = allowNetSpec && v.net <= 0;
  // `OnCornerSmoothingSelection` / `OnRemoveIslandsSelection`: Show(false),
  // with `wxRESERVE_SPACE_EVEN_IF_HIDDEN` keeping the cells.
  const showRadius = v.cornerSmoothing === 'chamfer' || v.cornerSmoothing === 'fillet';
  const showAreaLimit = !noNet && v.islandRemovalMode === 'area';
  const hatched = v.fillMode === 'hatch';

  return (
    <>
      {/* `m_copperZoneInfoBar` — a WX_INFOBAR, which is the shared
                `Infobar`. It brings the icon with it: `wxICON_WARNING` asks
                the ART PROVIDER, so what KiCad draws here is the desktop
                theme's red disc, and that file is already vendored beside the
                component. A glyph spelled at this call site would be a second
                answer to a question the widget has already answered.

                No close button: `updateInfoBar()` calls `ShowMessage` without
                `AddCloseButton()`, and dismisses the bar itself when the net
                changes. */}
      {noNet && (
        <Infobar
          message="<no net> will result in an isolated copper island."
          className="ze-cz-infobar"
        />
      )}

      {/* gbSizer8, a wxGridBagSizer( 3, 5 ) with column 1 growable. */}
      <div className="ze-cz-head">
        <label
          className="lbl"
          htmlFor="ze-cz-name"
          title="A unique name for this zone, used to identify it in DRC rules"
        >
          Zone name:
        </label>
        <input
          id="ze-cz-name"
          type="text"
          value={v.name}
          onChange={(e) => set({ name: e.target.value })}
        />
        {allowNetSpec && (
          <label className="lbl" htmlFor="ze-cz-net">
            Net name:
          </label>
        )}
        {/* NET_SELECTOR. Code 0 is `<no net>`, which is what the infobar
                  above is about. */}
        {allowNetSpec && (
          <NetSelector
            id="ze-cz-net"
            netInfo={nets}
            // `SetSelectedNetcode( std::max( 0, m_settings->m_Netcode ) )`
            // (panel_zone_properties.cpp:147).
            netcode={Math.max(0, v.net)}
            onChange={(net) => set({ net })}
          />
        )}
      </div>

      <label className="ze-cz-locked">
        <input
          type="checkbox"
          checked={v.locked}
          onChange={(e) => set({ locked: e.target.checked })}
        />
        Locked
      </label>

      <div className="ze-cz-nb">
        <div className="ze-nb-tabs">
          <button
            type="button"
            className={tab === 'clearances' ? 'active' : ''}
            onClick={() => setTab('clearances')}
          >
            Clearances &amp; Pad Connections
          </button>
          <button
            type="button"
            className={tab === 'display' ? 'active' : ''}
            onClick={() => setTab('display')}
          >
            Display Overrides
          </button>
          <button
            type="button"
            className={tab === 'hatched' ? 'active' : ''}
            onClick={() => setTab('hatched')}
          >
            Hatched Fill
          </button>
        </div>

        <div className="ze-cz-page">
          {tab === 'clearances' && (
            <div className="ze-cz-grid">
              {dist(
                'Clearance:',
                'clearance',
                'Copper clearance for this zone (set to 0 to use the netclass clearance)',
              )}
              {dist('Minimum width:', 'minThickness', 'Minimum thickness of filled areas.')}
              {/* `SetEmptyCellSize( wxSize( -1, 10 ) )` on row 2, which is
                        why Pad connections sits at row 3 with a gap above it. */}
              <div className="ze-cz-emptyrow" />
              <label
                className="lbl"
                htmlFor="ze-cz-padconn"
                title={
                  'Default pad connection type to zone.\nThis setting can be overridden by local pad settings'
                }
              >
                Pad connections:
              </label>
              <Combo
                id="ze-cz-padconn"
                disabled={teardrop}
                value={v.padConnection}
                options={PAD_CONNECTION.map((o) => ({ value: o.value, label: o.label }))}
                onChange={(value) => set({ padConnection: value as ZoneValues['padConnection'] })}
              />
              <span className="unit" />
              {dist(
                'Thermal relief gap:',
                'thermalGap',
                'The distance that will be kept clear between the filled area of the zone and a pad connected by thermal relief spokes.',
              )}
              {dist(
                'Thermal spoke width:',
                'thermalBridgeWidth',
                'Width of copper in thermal reliefs.',
              )}
            </div>
          )}

          {tab === 'display' && (
            <div className="ze-cz-grid">
              <label className="lbl" htmlFor="ze-cz-outline">
                Outline display:
              </label>
              <Combo
                id="ze-cz-outline"
                value={v.hatchStyle}
                options={OUTLINE_DISPLAY.map((o) => ({ value: o.value, label: o.label }))}
                onChange={(value) => set({ hatchStyle: value as ZoneValues['hatchStyle'] })}
              />
              <span className="unit" />
              {dist('Outline hatch pitch:', 'hatchPitch')}
            </div>
          )}

          {tab === 'hatched' && (
            <div className="ze-cz-hatched">
              <div className="ze-cz-grid">
                {/* `m_cbHatched` IS the fill mode: HATCH_PATTERN when
                          ticked, POLYGONS when not. There is no "Fill type"
                          choice and no "Filled" checkbox in this dialog. */}
                <label className="ze-cz-span">
                  <input
                    type="checkbox"
                    checked={hatched}
                    onChange={(e) => set({ fillMode: e.target.checked ? 'hatch' : 'solid' })}
                  />
                  Hatched fill
                </label>
                <fieldset disabled={!hatched} className="ze-cz-hatchfields">
                  {num('Orientation:', 'hatchOrientation', 'deg')}
                  {dist('Hatch width:', 'hatchThickness')}
                  {dist('Hatch gap:', 'hatchGap')}
                  {num('Smoothing effort:', 'hatchSmoothingLevel', '', {
                    title:
                      'Value of smoothing effort\n0 = no smoothing\n1 = chamfer\n2 = round corners\n3 = round corners (finer shape)',
                    step: 1,
                    min: 0,
                    max: 3,
                  })}
                  {num('Smoothing amount:', 'hatchSmoothingValue', '', {
                    title:
                      'Ratio between smoothed corners size and the gap between lines\n0 = no smoothing\n1.0 = max radius/chamfer size (half gap value)',
                    step: 0.1,
                    min: 0,
                    max: 1,
                  })}
                </fieldset>
              </div>

              {/* bSizerOffsetOverrides, proportion 1 beside the grid. */}
              <div className="ze-cz-offsets">
                <div className="ze-cz-offsets-label">Hatch offset overrides:</div>
                <table className="ze-grid ze-cz-offsets-grid">
                  <thead>
                    <tr>
                      {/* `SetColLabelValue` 0..2, and each `SetColSize( 90 )`. */}
                      <th>Layer</th>
                      <th>X Offset</th>
                      <th>Y Offset</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(v.layerProperties).map(([layer, off]) => (
                      <tr key={layer}>
                        <td>{layer}</td>
                        {(['x', 'y'] as const).map((axis) => (
                          <td key={axis}>
                            <input
                              type="text"
                              disabled={!hatched}
                              aria-label={`${layer} ${axis.toUpperCase()} Offset`}
                              value={text[`${layer}:${axis}`] ?? pcbUnitText(off[axis], units)}
                              onChange={(e) => {
                                setText((p) => ({
                                  ...p,
                                  [`${layer}:${axis}`]: e.target.value,
                                }));
                                const iu = pcbUnitValue(e.target.value, units);
                                if (!Number.isFinite(iu)) return;
                                set({
                                  layerProperties: {
                                    ...v.layerProperties,
                                    [layer]: { ...off, [axis]: iu },
                                  },
                                });
                              }}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="ze-cz-offsets-buttons">
                  {/* `OnAddLayerItem` puts up "All zone layers already
                            overridden." when every layer the zone is on has a
                            row already. */}
                  <button
                    type="button"
                    className="ze-btn"
                    disabled={!hatched || v.layers.every((l) => l in v.layerProperties)}
                    title="Add a layer override"
                    onClick={() => {
                      const next = v.layers.find((l) => !(l in v.layerProperties));
                      if (next)
                        set({
                          layerProperties: {
                            ...v.layerProperties,
                            [next]: { x: 0, y: 0 },
                          },
                        });
                    }}
                  >
                    +
                  </button>
                  <button
                    type="button"
                    className="ze-btn"
                    disabled={!hatched || Object.keys(v.layerProperties).length === 0}
                    title="Delete the last layer override"
                    onClick={() => {
                      const keys = Object.keys(v.layerProperties);
                      const last = keys[keys.length - 1];
                      if (last === undefined) return;
                      const { [last]: _drop, ...rest } = v.layerProperties;
                      set({ layerProperties: rest });
                    }}
                  >
                    −
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* gbSizerGeneralProps, OUTSIDE the notebook. Five columns, with 1
                and 3 growable. */}
      <div className="ze-cz-general">
        <label className="lbl" htmlFor="ze-cz-smoothing">
          Corner smoothing:
        </label>
        <Combo
          id="ze-cz-smoothing"
          disabled={teardrop}
          value={v.cornerSmoothing}
          options={CORNER_SMOOTHING.map((o) => ({ value: o.value, label: o.label }))}
          onChange={(value) => set({ cornerSmoothing: value as ZoneValues['cornerSmoothing'] })}
        />
        {/* `wxRESERVE_SPACE_EVEN_IF_HIDDEN`: hidden keeps its cell. */}
        <label className="lbl pad" htmlFor="ze-cz-radius" hidden={!showRadius}>
          Radius:
        </label>
        <input
          id="ze-cz-radius"
          type="text"
          hidden={!showRadius}
          value={text.cornerRadius ?? pcbUnitText(v.cornerRadius, units)}
          onChange={(e) => {
            setText((p) => ({ ...p, cornerRadius: e.target.value }));
            const iu = pcbUnitValue(e.target.value, units);
            if (Number.isFinite(iu)) set({ cornerRadius: iu });
          }}
        />
        <span className="unit" hidden={!showRadius}>
          {unitLabel(units)}
        </span>

        <label
          className="lbl"
          htmlFor="ze-cz-islands"
          title="Choose what to do with unconnected copper islands"
        >
          Remove islands:
        </label>
        <Combo
          id="ze-cz-islands"
          disabled={noNet}
          value={noNet ? 'never' : v.islandRemovalMode}
          options={REMOVE_ISLANDS.map((o) => ({ value: o.value, label: o.label }))}
          onChange={(value) => set({ islandRemovalMode: value as ZoneValues['islandRemovalMode'] })}
        />
        <label
          className="lbl pad"
          htmlFor="ze-cz-arealimit"
          hidden={!showAreaLimit}
          title="Isolated islands smaller than this will be removed"
        >
          Area limit:
        </label>
        <input
          id="ze-cz-arealimit"
          type="text"
          hidden={!showAreaLimit}
          value={String(v.islandAreaMin)}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) set({ islandAreaMin: n });
          }}
        />
        <span className="unit" hidden={!showAreaLimit}>
          mm²
        </span>
      </div>
    </>
  );
}
