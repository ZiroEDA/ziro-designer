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

import { type JSX, useState } from 'react';
import type { StatusUnits } from '@ziroeda/common/widgets/kistatusbar_format.js';
import type { PCB_BASE_EDIT_FRAME } from '../pcb_base_edit_frame.js';
import type { CONVERT_SETTINGS } from '../pcbnew_settings.js';
import { CONVERSION_BOX, type ConversionBoxValues } from '../tools/convert_settings_dialog.js';
import { ConversionSettingsBox } from '../tools/convert_settings_dialog.js';
import type { ZONE } from '../zone.js';
import type { ZONE_SETTINGS } from '../zone_settings.js';
import { DIALOG_COPPER_ZONE_BASE } from './dialog_copper_zones_base.js';
import type { TransferResult } from './dialog_text_properties.js';
import { layerSetOfTokens } from './layer_tokens.js';
import {
  PanelZoneProperties,
  type ZoneValues,
  acceptZoneOptions,
  editZoneParamsCommit,
  zoneSettingsToValues,
} from './panel_zone_properties.js';
import { _ } from '@ziroeda/wx/translation.js';

/**
 * `DIALOG_COPPER_ZONE` + `PANEL_ZONE_PROPERTIES` on a live copper ZONE, as
 * `PCB_EDIT_FRAME::Edit_Zone_Params` (edit_zone_helpers.cpp:41-85) drives
 * them: the settings are the board's default zone settings with the zone
 * read over them (`zoneInfo << *aZone`); OK runs AcceptOptions (:344-455) and
 * the dialog's layer check, then one BOARD_COMMIT, "Edit Zone Properties":
 * `ExportSetting` onto the zone, the net when the board has it, and the
 * settings (net orphaned) become the board's default zone settings.
 *
 * The panel edits neither the priority, the hatch hole area nor the fill
 * state, so the values' `priority`, `hatchHoleMinArea` and `filled` are shown
 * and not written. Refilling is BOARD_COMMIT's, under the frame's "Auto-refill
 * zones" setting (board_commit.cpp:229), not this dialog's.
 */
export class DIALOG_COPPER_ZONE {
  private readonly m_frame: PCB_BASE_EDIT_FRAME;
  private readonly m_zone: ZONE | null;
  private readonly m_settings: ZONE_SETTINGS;
  /** `m_ptr`: the caller's settings, written on OK when there is no zone. */
  private readonly m_ptr: ZONE_SETTINGS | null;
  /** `m_convertSettings`: CONVERT_TOOL's, when it opens the dialog. */
  readonly m_convertSettings: CONVERT_SETTINGS | null;

  /**
   * On a live zone, as `Edit_Zone_Params` opens it; or, with `aZone` null, on
   * `aSettings` alone, as `InvokeCopperZonesEditor( frame, nullptr, &zoneInfo,
   * &convertSettings )` does for CONVERT_TOOL - no commit, the settings come
   * back through `*m_ptr`.
   */
  constructor(
    aFrame: PCB_BASE_EDIT_FRAME,
    aZone: ZONE | null,
    aSettings: ZONE_SETTINGS | null = null,
    aConvertSettings: CONVERT_SETTINGS | null = null,
  ) {
    this.m_frame = aFrame;
    this.m_zone = aZone;
    this.m_ptr = aSettings;
    this.m_convertSettings = aConvertSettings;

    if (aZone) {
      this.m_settings = aFrame.GetDesignSettings().GetDefaultZoneSettings().clone();
      this.m_settings.importFrom(aZone);
    } else {
      this.m_settings = aSettings!.clone();
    }
  }

  private copperLayerCount(): number {
    return (this.m_zone?.GetBoard() ?? this.m_frame.GetBoard())?.GetCopperLayerCount() ?? 2;
  }

  /** The "Conversion Settings" box's controls, or null when there is none. */
  TransferConversionToWindow(): ConversionBoxValues | null {
    return this.m_convertSettings ? CONVERSION_BOX.ToWindow(this.m_convertSettings, false) : null;
  }

  /** TransferZoneSettingsToWindow (:139-237), plus the dialog's layer list. */
  TransferDataToWindow(): ZoneValues {
    return zoneSettingsToValues(this.m_settings, this.m_zone, this.copperLayerCount());
  }

  /** AcceptOptions (:344-455): false where a validator refuses. */
  private acceptOptions(v: ZoneValues): TransferResult {
    return acceptZoneOptions(this.m_settings, v, this.m_zone, false, this.m_frame.GetBoard());
  }

  TransferDataFromWindow(
    v: ZoneValues,
    aConversion: ConversionBoxValues | null = null,
  ): TransferResult {
    // DIALOG_COPPER_ZONE::TransferDataFromWindow's layer check comes first.
    const layers = layerSetOfTokens(v.layers);

    if (layers.none()) return { ok: false, message: _('No layer selected.') };

    this.m_settings.m_Layers = layers;

    const accepted = this.acceptOptions(v);
    if (!accepted.ok) return accepted;

    if (this.m_convertSettings && aConversion)
      CONVERSION_BOX.FromWindow(this.m_convertSettings, aConversion, false);

    // `*m_ptr = *m_zoneSettingsBag.GetZoneSettings( m_zone )`: with no zone,
    // the caller's settings; with one, Edit_Zone_Params' commit.
    if (this.m_zone) editZoneParamsCommit(this.m_frame, this.m_zone, this.m_settings);
    else this.m_ptr!.CopyFrom(this.m_settings, true);

    return { ok: true };
  }
}

interface Props {
  /** The frame's display units: every distance here is a UNIT_BINDER upstream. */
  units: StatusUnits;
  initial: ZoneValues;
  /** Net codes and names, for the NET_SELECTOR. */
  nets: ReadonlyMap<number, string>;
  /** Copper layers the zone may sit on, with the colour each swatch draws (SetupLayersList). */
  layers: readonly { name: string; label?: string; color: string }[];
  /**
   * Whether the zone already exists on the board. "A zone still in creation (ie: not yet in the
   * document) can't be edited by the Zone Manager", so m_openZoneManager is hidden.
   */
  existingZone?: boolean;
  /** `aSettings->m_TeardropType != TD_NONE`: "Legacy Teardrop Properties". */
  teardrop?: boolean;
  /** `aConvertSettings`: CONVERT_TOOL opened the dialog, so it carries the Conversion Settings. */
  conversion?: ConversionBoxValues | null;
  onApply: (values: ZoneValues, conversion: ConversionBoxValues | null) => void;
  /**
   * `onZoneManager`: TransferDataFromWindow, then COPPER_ZONE_OPEN_ZONE_MANAGER, on which
   * InvokeCopperZonesEditor runs PCB_ACTIONS::zonesManager after the commit.
   */
  onOpenZoneManager?: (values: ZoneValues) => void;
  onClose: () => void;
}

/** `ShowModal()` of DIALOG_COPPER_ZONE, DIALOG_COPPER_ZONE_BASE with its panel in m_sizerRight. */
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
  const [v, setV] = useState<ZoneValues>(initial);
  const set = (patch: Partial<ZoneValues>): void => setV((prev) => ({ ...prev, ...patch }));
  const [conv, setConv] = useState<ConversionBoxValues | null>(conversion);

  // onNetSelector: "Zones with no net never have islands removed". The forced value is what
  // upstream leaves in the settings, so hand back what the disabled control shows.
  const settled = (): ZoneValues => (v.net <= 0 ? { ...v, islandRemovalMode: 'never' } : v);

  return (
    <DIALOG_COPPER_ZONE_BASE
      title={
        conv
          ? _('Convert to Copper Zone')
          : teardrop
            ? _('Legacy Teardrop Properties')
            : _('Copper Zone Properties')
      }
      conversionBox={
        conv ? (
          <ConversionSettingsBox
            values={conv}
            units={units}
            gapBorders="copperZone"
            onChange={setConv}
          />
        ) : null
      }
      m_layers={layers.map((l) => ({
        toggle: v.layers.includes(l.name),
        text: l.label ?? l.name,
        iconColour: l.color,
      }))}
      OnLayerSelection={(aRow, aOn) => {
        const name = layers[aRow]!.name;
        set({ layers: aOn ? [...v.layers, name] : v.layers.filter((x) => x !== name) });
      }}
      m_sizerRight={
        <PanelZoneProperties
          values={v}
          onChange={set}
          units={units}
          nets={nets}
          teardrop={teardrop}
        />
      }
      zoneManagerShown={existingZone}
      zoneManagerEnabled={onOpenZoneManager !== undefined}
      onZoneManager={() => onOpenZoneManager?.(settled())}
      onOK={() => onApply(settled(), conv)}
      onCancel={onClose}
    />
  );
}
