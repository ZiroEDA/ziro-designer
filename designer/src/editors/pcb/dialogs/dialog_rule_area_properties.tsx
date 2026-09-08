// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Rule Area Properties. Counterparts:
 * `pcbnew/dialogs/dialog_rule_area_properties.cpp` over its
 * `_base.cpp` sizer tree, plus the two notebook panels
 * `panel_rule_area_properties_keepout_base.cpp` and
 * `panel_rule_area_properties_placement_base.cpp`.
 *
 * The layout is one `bUpperSizer` with the layer list on the left (proportion
 * 4) and everything else on the right (proportion 7): the area name and the
 * Locked box, then a two-page notebook — **Keepouts** and **Placement** — and
 * below the notebook a grid-bag sizer carrying Outline display and Outline
 * hatch pitch. Those last two are outside the notebook, which is easy to get
 * wrong because they read like page content.
 *
 * All of the decision logic is `pcbnew/src/rule_area_properties.ts`, ported
 * separately so it can be driven without a canvas: which page opens, what the
 * three placement combos contain, what a "not found on board" source does, and
 * the validation order. This file is the widgets and nothing else.
 *
 * `InvokeRuleAreaEditor` is called from **two** places upstream —
 * `ZONE_CREATE_HELPER::createNewZone` when the Draw Rule Area tool starts an
 * outline, and `EDIT_TOOL::Properties` on an existing rule area — which is why
 * the caller passes the values in rather than a zone.
 */

import { useState, type JSX } from 'react';
import {
  NO_LAYERS_SELECTED,
  collectPlacementPage,
  initialRuleAreaPage,
  placementFromPage,
  ruleAreaValuesError,
  withPlacementRadio,
  withPlacementSelection,
  type PlacementPage,
  type PlacementSources,
  type RuleAreaValues,
} from '@ziroeda/pcbnew/src/rule_area_properties.js';
import type { PlacementSourceType } from '@ziroeda/pcbnew/src/types.js';
import { Combo } from '../../../ui/Combo.js';
import { useModalEscape } from '../../../ui/useModalEscape.js';
import { pcbUnitText, pcbUnitValue, unitLabel } from '../pcb_unit_binder.js';
import type { StatusUnits } from '../../../ui/status_format.js';

interface Props {
  /** The frame's display units: the hatch pitch is a `UNIT_BINDER` upstream. */
  units: StatusUnits;
  initial: RuleAreaValues;
  /** Every layer the area may sit on, with the colour its swatch draws. */
  layers: readonly { name: string; color: string }[];
  /** What the three placement combos may offer, gathered from the board. */
  sources: PlacementSources;
  /**
   * `wxID_OK`. The caller applies the values; a rule area started by the
   * drawing tool has no zone to patch yet, so this hands back the values.
   */
  onApply: (values: RuleAreaValues) => void;
  /** `wxID_CANCEL`, which for the drawing tool vetoes `OnFirstPoint`. */
  onClose: () => void;
}

/** `m_OutlineDisplayCtrlChoices` (`_base.cpp:73`), in its own order. */
const OUTLINE_DISPLAY = [
  { value: 'none', label: 'Line' },
  { value: 'edge', label: 'Hatched' },
  { value: 'full', label: 'Fully hatched' },
] as const;

/** The four radios on the Placement page, top to bottom. */
const PLACEMENT_RADIOS: { type: PlacementSourceType | null; label: string }[] = [
  { type: null, label: 'No placement' },
  { type: 'sheetname', label: 'Place items from sheet:' },
  { type: 'component_class', label: 'Place items matching component class:' },
  { type: 'group', label: 'Place items in group:' },
];

export function DialogRuleAreaProperties({
  units,
  initial,
  layers,
  sources,
  onApply,
  onClose,
}: Props): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask.
  useModalEscape(onClose);

  const [v, setV] = useState<RuleAreaValues>(initial);
  const [page, setPage] = useState<PlacementPage>(() => collectPlacementPage(initial, sources));
  // `m_areaPropertiesNb->SetSelection( 0 )`, then 1 when the area does nothing
  // but place — computed once, from the values the dialog opened with.
  const [tab, setTab] = useState<0 | 1>(() => initialRuleAreaPage(initial));
  // The hatch pitch is held as text so a half-typed number survives the caret.
  const [pitchText, setPitchText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const set = (patch: Partial<RuleAreaValues>): void => setV((prev) => ({ ...prev, ...patch }));

  const keepout = (label: string, key: keyof RuleAreaValues, title: string): JSX.Element => (
    <label title={title}>
      <input
        type="checkbox"
        checked={v[key] as boolean}
        onChange={(e) => set({ [key]: e.target.checked } as Partial<RuleAreaValues>)}
      />
      {label}
    </label>
  );

  const combo = (type: PlacementSourceType): JSX.Element => {
    const c =
      type === 'sheetname'
        ? page.sheet
        : type === 'component_class'
          ? page.componentClass
          : page.group;
    return (
      <Combo
        // A combo is only live while its own radio is ticked, which is
        // `OnSheetNameClicked` and friends enabling it upstream.
        disabled={page.enabled !== type}
        value={c.selected === -1 ? '' : String(c.selected)}
        options={c.options.map((o, i) => ({ value: String(i), label: o }))}
        onChange={(value) => setPage((p) => withPlacementSelection(p, type, Number(value)))}
      />
    );
  };

  /** `TransferDataFromWindow`, in upstream's order. */
  const accept = (): void => {
    const placement = placementFromPage(page);
    const next: RuleAreaValues = {
      ...v,
      placementEnabled: placement.enabled,
      placementSourceType: placement.sourceType,
      placementSource: placement.source,
    };
    const err = ruleAreaValuesError(next);

    if (err?.field === 'layers') {
      setError(NO_LAYERS_SELECTED);
      return;
    }
    if (err) {
      // `UNIT_BINDER::Validate` composes its message from the control's own
      // label, which is why the bound is reported in the frame's units.
      setError(
        `Outline hatch pitch must be ${err.kind === 'min' ? 'at least' : 'no more than'} ` +
          `${pcbUnitText(err.bound, units)} ${unitLabel(units)}.`,
      );
      return;
    }

    onApply(next);
  };

  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div className="ze-modal ze-rule-area-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Rule Area Properties
          <span className="x" onClick={onClose}>
            ✕
          </span>
        </div>

        <div className="ze-modal-body ze-rule-area-body">
          {/* bLayersListSizer, proportion 4 — a wxDataViewListCtrl of
              checkbox + colour swatch + layer name. */}
          <div className="ze-rule-area-layers">
            <div className="ze-rule-area-layers-label">Layers:</div>
            <div className="ze-rule-area-layer-list">
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

          {/* bSizerRight, proportion 7. */}
          <div className="ze-rule-area-right">
            <label
              className="ze-rule-area-name"
              title="A unique name for this rule area for use in DRC rules"
            >
              <span>Area name:</span>
              <input type="text" value={v.name} onChange={(e) => set({ name: e.target.value })} />
            </label>
            <label className="ze-rule-area-locked">
              <input
                type="checkbox"
                checked={v.locked}
                onChange={(e) => set({ locked: e.target.checked })}
              />
              Locked
            </label>

            {/* m_areaPropertiesNb, the same wxNotebook tab strip every other
                notebook here draws, so the same shared rule paints it. */}
            <div className="ze-rule-area-nb">
              <div className="ze-nb-tabs">
                {/* `AddPage( m_keepoutProperties, _( "Keepouts" ), true )`. */}
                <button
                  type="button"
                  className={tab === 0 ? 'active' : ''}
                  onClick={() => setTab(0)}
                >
                  Keepouts
                </button>
                <button
                  type="button"
                  className={tab === 1 ? 'active' : ''}
                  onClick={() => setTab(1)}
                >
                  Placement
                </button>
              </div>

              <div className="ze-rule-area-page">
                {tab === 0 ? (
                  <div className="ze-rule-area-keepouts">
                    {keepout(
                      'Keep out tracks',
                      'doNotAllowTracks',
                      'Prevent tracks from routing into this area',
                    )}
                    {keepout(
                      'Keep out vias',
                      'doNotAllowVias',
                      'Prevent vias from being placed in this area',
                    )}
                    {keepout(
                      'Keep out pads',
                      'doNotAllowPads',
                      'Raise a DRC error if a pad overlaps this area',
                    )}
                    {keepout(
                      'Keep out zone fills',
                      'doNotAllowCopperPour',
                      'Zones will not fill copper into this area',
                    )}
                    {keepout(
                      'Keep out footprints',
                      'doNotAllowFootprints',
                      'Raise a DRC error if a footprint courtyard overlaps this area',
                    )}
                  </div>
                ) : (
                  <div className="ze-rule-area-placement">
                    {PLACEMENT_RADIOS.map((r) => (
                      <div key={r.label}>
                        <label>
                          <input
                            type="radio"
                            name="ze-rule-area-placement"
                            checked={page.enabled === r.type}
                            onChange={() => setPage((p) => withPlacementRadio(p, r.type))}
                          />
                          {r.label}
                        </label>
                        {r.type !== null && combo(r.type)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* gbSizer1, BELOW the notebook rather than on a page. */}
            <div className="ze-rule-area-outline">
              <label>
                <span>Outline display:</span>
                <Combo
                  value={v.hatchStyle}
                  options={OUTLINE_DISPLAY.map((o) => ({ value: o.value, label: o.label }))}
                  onChange={(value) => set({ hatchStyle: value as RuleAreaValues['hatchStyle'] })}
                />
              </label>
              <label title="Distance between parallel lines used for hatching the area">
                <span>Outline hatch pitch:</span>
                <input
                  type="text"
                  value={pitchText ?? pcbUnitText(v.hatchPitch, units)}
                  onChange={(e) => {
                    setPitchText(e.target.value);
                    const iu = pcbUnitValue(e.target.value, units);
                    if (Number.isFinite(iu)) set({ hatchPitch: iu });
                  }}
                />
                <span className="ze-unit-label">{unitLabel(units)}</span>
              </label>
            </div>
          </div>
        </div>

        {/* `DisplayError( this, … )` is a modal of its own upstream; a line in
            the dialog is the nearest a browser gets without a second modal. */}
        {error !== null && <div className="ze-rule-area-error">{error}</div>}

        {/* m_sdbSizerButtons: a wxStdDialogButtonSizer, so GTK's own order —
            Cancel then OK — and OK is the affirmative default. */}
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
  );
}
