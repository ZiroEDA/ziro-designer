// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Copper Zone Properties. Counterparts: `dialog_copper_zones_base.cpp` (the
 * frame) over `panel_zone_properties_base.cpp` (every field), plus
 * `panel_zone_properties.cpp` for what is shown when.
 *
 * ### The shape, which is the thing this file kept getting wrong
 *
 * The frame is HORIZONTAL. A layer list sits on the left at proportion 0 with
 * `SetMinSize( wxSize( 180, -1 ) )`, and `m_sizerRight` — the whole panel —
 * takes the rest at proportion 1. This dialog used to be a single vertical
 * scroll of `<fieldset>` groups with the layers as two inline checkboxes, and
 * that is not a rearrangement of upstream's layout; it is a different one.
 *
 * The panel is, top to bottom:
 *
 *   1. `m_copperZoneInfoBar` — a WX_INFOBAR, shown only for `<no net>`
 *   2. `gbSizer8`, a `wxGridBagSizer( 3, 5 )`: Zone name, then Net name
 *   3. `m_cbLocked`
 *   4. `m_notebook` — **three tabs**, not four boxed groups:
 *      Clearances && Pad Connections / Display Overrides / Hatched Fill
 *   5. `gbSizerGeneralProps`, a `wxGridBagSizer( 5, 5 )` **outside** the
 *      notebook: Corner smoothing + Radius, Remove islands + Area limit
 *
 * ### Three controls that are hidden, not disabled
 *
 * Radius, and Area limit, carry `wxRESERVE_SPACE_EVEN_IF_HIDDEN` and are
 * `Show( false )` when they do not apply — smoothing None, and any island mode
 * but "Below area limit". They keep their space so the row does not jump.
 *
 * ### What upstream does NOT have here
 *
 * No "Filled" checkbox, no "Fill type" choice and no "Priority" field. The
 * fill mode is the `Hatched fill` checkbox on its own tab, and priority moved
 * to the Zone Manager in v10. All three were inventions of this file; the
 * values still ride through untouched, because the file still carries them.
 */

import { useState, type JSX } from 'react';
import type { ZoneValues } from './panel_zone_properties.js';
import { PanelZoneProperties } from './panel_zone_properties_ui.js';
import type { ConversionBoxValues } from '../tools/convert_settings_dialog.js';
import { ConversionSettingsBox } from '../tools/convert_settings_dialog_ui.js';
import { useModalEscape } from '@ziroeda/common/dialog_shim.js';
import type { StatusUnits } from '@ziroeda/common/widgets/kistatusbar_format.js';

interface Props {
  /**
   * The frame's display units. Every distance here is a `UNIT_BINDER`
   * upstream, so it shows and reads the frame's unit rather than a fixed mm.
   */
  units: StatusUnits;
  initial: ZoneValues;
  /** Net codes and names, for the `NET_SELECTOR`. */
  nets: ReadonlyMap<number, string>;
  /** Copper layers the zone may sit on, with the colour each swatch draws. */
  layers: readonly { name: string; color: string }[];
  /**
   * Whether the zone already exists on the board. "A zone still in creation
   * (ie: not yet in the document) can't be edited by the Zone Manager", so the
   * drawing tool hides that button outright.
   */
  existingZone?: boolean;
  /**
   * `aSettings->m_TeardropType != TD_NONE`: the legacy teardrop's own zone, so
   * the title says so and the panel fixes its smoothing and pad connection.
   */
  teardrop?: boolean;
  /**
   * `aConvertSettings`: CONVERT_TOOL opened the dialog, so it carries the
   * "Conversion Settings" box and is titled "Convert to Copper Zone".
   */
  conversion?: ConversionBoxValues | null;
  onApply: (values: ZoneValues, conversion: ConversionBoxValues | null) => void;
  /**
   * `DIALOG_COPPER_ZONE::onZoneManager`: `TransferDataFromWindow()`, then close
   * with `COPPER_ZONE_OPEN_ZONE_MANAGER`, on which `InvokeCopperZonesEditor`
   * runs `PCB_ACTIONS::zonesManager` after the commit. Called with the values,
   * as `onApply` is.
   */
  onOpenZoneManager?: (values: ZoneValues) => void;
  onClose: () => void;
}

export function DialogCopperZones({
  initial,
  units,
  nets,
  layers,
  existingZone = false,
  teardrop = false,
  conversion = null,
  onApply,
  onOpenZoneManager,
  onClose,
}: Props): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask.
  useModalEscape(onClose);

  const [v, setV] = useState<ZoneValues>(initial);
  const set = (patch: Partial<ZoneValues>): void => setV((prev) => ({ ...prev, ...patch }));

  // `onNetSelector`: "Zones with no net never have islands removed" — the
  // choice is forced to Never AND disabled, and the infobar comes up.
  const noNet = v.net <= 0;
  // The forced value is what upstream leaves in the settings, so hand back
  // what the disabled control shows rather than what it used to hold.
  const settled = (): ZoneValues => (noNet ? { ...v, islandRemovalMode: 'never' } : v);
  const [conv, setConv] = useState<ConversionBoxValues | null>(conversion);
  const accept = (): void => onApply(settled(), conv);

  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div className="ze-modal ze-cz-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          {conv
            ? 'Convert to Copper Zone'
            : teardrop
              ? 'Legacy Teardrop Properties'
              : 'Copper Zone Properties'}
          <span className="x" onClick={onClose}>
            ✕
          </span>
        </div>

        {conv && <ConversionSettingsBox values={conv} units={units} onChange={setConv} />}

        {/* bMainSizer, HORIZONTAL: bSizerLeft at proportion 0, m_sizerRight at 1. */}
        <div className="ze-modal-body ze-cz-body">
          <div className="ze-cz-layers">
            <div className="ze-cz-layers-label">Layers:</div>
            <div className="ze-cz-layer-list">
              {layers.map((l) => (
                <label key={l.name}>
                  <input
                    type="checkbox"
                    checked={v.layers.includes(l.name)}
                    onChange={(e) =>
                      set({
                        layers: e.target.checked
                          ? [...v.layers, l.name]
                          : v.layers.filter((x) => x !== l.name),
                      })
                    }
                  />
                  <span className="ze-layer-swatch" style={{ background: l.color }} />
                  {l.name}
                </label>
              ))}
            </div>
          </div>

          <div className="ze-cz-right">
            <PanelZoneProperties
              values={v}
              onChange={set}
              units={units}
              nets={nets}
              teardrop={teardrop}
            />
          </div>
        </div>

        {/* bSizerbottom: the Zone Manager button, then a wxStdDialogButtonSizer
            taking the slack — so GTK's order, Cancel then OK. */}
        <div className="ze-cz-foot">
          {existingZone && (
            <button
              type="button"
              className="ze-btn"
              disabled={!onOpenZoneManager}
              onClick={() => onOpenZoneManager?.(settled())}
            >
              Open Zone Manager...
            </button>
          )}
          <div className="ze-modal-footer">
            <button type="button" className="ze-btn" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="ze-btn primary" onClick={accept}>
              OK
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
