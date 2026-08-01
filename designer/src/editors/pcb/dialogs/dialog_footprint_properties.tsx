// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Footprint Properties, board side. Counterpart:
 * `pcbnew/dialogs/dialog_footprint_properties.cpp` over its `_base` layout:
 * a General page (position, orientation, fabrication attributes) and a
 * "Clearance Overrides && Pad Connections" page.
 *
 * Two things upstream has that are not here, both for want of a model:
 *  - the Fields grid (per-field text properties) — that is text-properties work;
 *  - Side (front/back), which is `FOOTPRINT::Flip`, shared with the mirror tool
 *    and worth its own change.
 *
 * The decision logic lives in `pcbnew/src/footprint_properties.ts`.
 */

import { useState, type JSX } from 'react';
import { pcbIuToMM, pcbMmToIU } from '@ziroeda/common/src/eda_units.js';
import type { FootprintValues } from '@ziroeda/pcbnew/src/footprint_properties.js';

interface Props {
  initial: FootprintValues;
  /** The footprint's library id, shown read-only as upstream's Library link. */
  libId: string;
  /** The side the footprint sits on, shown read-only (see the note above). */
  side: string;
  onApply: (values: FootprintValues) => void;
  onClose: () => void;
}

type Tab = 'general' | 'clearances';

export function DialogFootprintProperties({
  initial,
  libId,
  side,
  onApply,
  onClose,
}: Props): JSX.Element {
  const [tab, setTab] = useState<Tab>('general');
  const [v, setV] = useState<FootprintValues>(initial);
  // Millimetre boxes keep their text so a half-typed number survives the caret.
  const [text, setText] = useState<Record<string, string>>({});

  const set = (patch: Partial<FootprintValues>): void => setV((p) => ({ ...p, ...patch }));

  /** A millimetre field bound to an IU value. */
  const mmField = (label: string, key: 'x' | 'y'): JSX.Element => (
    <label>
      <span className="ze-tvp-label">{label}</span>
      <input
        type="text"
        className="ze-tvp-input"
        value={text[key] ?? String(pcbIuToMM(v[key]))}
        onChange={(e) => {
          setText((p) => ({ ...p, [key]: e.target.value }));
          const n = Number(e.target.value);
          if (Number.isFinite(n)) set({ [key]: pcbMmToIU(n) } as Partial<FootprintValues>);
        }}
      />
      <span className="ze-tvp-unit">mm</span>
    </label>
  );

  /**
   * An override field. Blank means "use the Board Setup value" and is stored as
   * null — distinct from 0, which is a real override.
   */
  const overrideField = (
    label: string,
    key: 'localClearance' | 'localSolderMaskMargin' | 'localSolderPasteMargin',
    title: string,
  ): JSX.Element => {
    const stored = v[key];
    const shown = text[key] ?? (stored === null ? '' : String(pcbIuToMM(stored)));
    return (
      <label title={title}>
        <span className="ze-tvp-label">{label}</span>
        <input
          type="text"
          className="ze-tvp-input"
          value={shown}
          placeholder="—"
          onChange={(e) => {
            const s = e.target.value;
            setText((p) => ({ ...p, [key]: s }));
            if (s.trim() === '') {
              set({ [key]: null } as Partial<FootprintValues>);
              return;
            }
            const n = Number(s);
            if (Number.isFinite(n)) set({ [key]: pcbMmToIU(n) } as Partial<FootprintValues>);
          }}
        />
        <span className="ze-tvp-unit">mm</span>
      </label>
    );
  };

  const check = (
    label: string,
    key:
      | 'locked'
      | 'notInSchematic'
      | 'doNotPopulate'
      | 'excludeFromBom'
      | 'excludeFromPosFiles'
      | 'allowMissingCourtyard'
      | 'allowSolderMaskBridges',
    title?: string,
  ): JSX.Element => (
    <label title={title}>
      <input
        type="checkbox"
        checked={v[key]}
        onChange={(e) => set({ [key]: e.target.checked } as Partial<FootprintValues>)}
      />
      {label}
    </label>
  );

  const tabButton = (id: Tab, label: string): JSX.Element => (
    <button
      type="button"
      className={`ze-tab${tab === id ? ' active' : ''}`}
      onClick={() => setTab(id)}
    >
      {label}
    </button>
  );

  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div className="ze-modal ze-fpprops-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Footprint Properties
          <span className="x" onClick={onClose}>
            ✕
          </span>
        </div>

        <div className="ze-tabbar ze-fpprops-tabs">
          {tabButton('general', 'General')}
          {tabButton('clearances', 'Clearance Overrides & Pad Connections')}
        </div>

        <div className="ze-modal-body ze-update-pcb-body ze-tvp-body">
          {tab === 'general' ? (
            <>
              <fieldset>
                <legend>Footprint</legend>
                <label>
                  <span className="ze-tvp-label">Reference designator:</span>
                  <input
                    type="text"
                    className="ze-tvp-select"
                    value={v.reference}
                    onChange={(e) => set({ reference: e.target.value })}
                  />
                </label>
                <label>
                  <span className="ze-tvp-label">Value:</span>
                  <input
                    type="text"
                    className="ze-tvp-select"
                    value={v.value}
                    onChange={(e) => set({ value: e.target.value })}
                  />
                </label>
                <label title="The library ID and footprint ID currently assigned.">
                  <span className="ze-tvp-label">Library link:</span>
                  <input type="text" className="ze-tvp-select" value={libId} readOnly />
                </label>
              </fieldset>

              <fieldset>
                <legend>Position</legend>
                <div className="ze-tvp-row">
                  {mmField('X:', 'x')}
                  {mmField('Y:', 'y')}
                </div>
                <label>
                  <span className="ze-tvp-label">Orientation:</span>
                  <select
                    className="ze-tvp-select"
                    value={String(v.orientation)}
                    onChange={(e) => set({ orientation: Number(e.target.value) })}
                  >
                    {['0', '90', '-90', '180'].map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                    {!['0', '90', '-90', '180'].includes(String(v.orientation)) && (
                      <option value={String(v.orientation)}>{v.orientation}</option>
                    )}
                  </select>
                  <span className="ze-tvp-unit">deg</span>
                </label>
                <label title="Flipping a footprint is FOOTPRINT::Flip, which is not ported yet.">
                  <span className="ze-tvp-label">Side:</span>
                  <input type="text" className="ze-tvp-select" value={side} readOnly />
                </label>
                {check('Locked', 'locked')}
              </fieldset>

              <fieldset>
                <legend>Fabrication Attributes</legend>
                <label>
                  <span className="ze-tvp-label">Footprint type:</span>
                  <select
                    className="ze-tvp-select"
                    value={v.footprintType}
                    onChange={(e) =>
                      set({ footprintType: e.target.value as FootprintValues['footprintType'] })
                    }
                  >
                    <option value="through_hole">Through hole</option>
                    <option value="smd">SMD</option>
                    <option value="unspecified">Unspecified</option>
                  </select>
                </label>
                {check('Not in schematic', 'notInSchematic')}
                {check('Do not populate', 'doNotPopulate')}
                {check('Exclude from bill of materials', 'excludeFromBom')}
                {check('Exclude from position files', 'excludeFromPosFiles')}
                {check('Allow missing courtyard', 'allowMissingCourtyard')}
              </fieldset>
            </>
          ) : (
            <>
              <fieldset>
                <legend>Clearances</legend>
                <div className="ze-tvp-note" style={{ marginLeft: 0 }}>
                  Leave values blank to use Board Setup values.
                </div>
                {overrideField(
                  'Pad clearance:',
                  'localClearance',
                  'This is the local net clearance for all pads of this footprint.\nIf 0, the Netclass values are used.\nThis value can be superseded by a pad local value.',
                )}
                {overrideField(
                  'Solder mask expansion:',
                  'localSolderMaskMargin',
                  'This is the local clearance between pads and the solder mask for this footprint.\nThis value can be superseded by a pad local value.',
                )}
                {check(
                  'Allow bridged solder mask apertures between pads',
                  'allowSolderMaskBridges',
                )}
                {overrideField(
                  'Solder paste clearance:',
                  'localSolderPasteMargin',
                  'Solder paste clearance relative to pad size.\nThis value can be superseded by a pad local value.',
                )}
                <label title="Solder paste clearance as a fraction of the pad size.">
                  <span className="ze-tvp-label">Paste clearance ratio:</span>
                  <input
                    type="text"
                    className="ze-tvp-input"
                    placeholder="—"
                    value={
                      text.ratio ??
                      (v.localSolderPasteMarginRatio === null
                        ? ''
                        : String(v.localSolderPasteMarginRatio))
                    }
                    onChange={(e) => {
                      const s = e.target.value;
                      setText((p) => ({ ...p, ratio: s }));
                      if (s.trim() === '') {
                        set({ localSolderPasteMarginRatio: null });
                        return;
                      }
                      const n = Number(s);
                      if (Number.isFinite(n)) set({ localSolderPasteMarginRatio: n });
                    }}
                  />
                  <span className="ze-tvp-unit">×</span>
                </label>
                <div className="ze-tvp-note" style={{ marginLeft: 0 }}>
                  Note: solder mask and paste values are used only for pads on copper layers.
                </div>
              </fieldset>

              <fieldset>
                <legend>Pad Connections</legend>
                <label title="Default pad connection to zones for this footprint's pads.">
                  <span className="ze-tvp-label">Pad connection to zones:</span>
                  <select
                    className="ze-tvp-select"
                    value={v.zoneConnection}
                    onChange={(e) =>
                      set({ zoneConnection: e.target.value as FootprintValues['zoneConnection'] })
                    }
                  >
                    <option value="inherited">Use zone setting</option>
                    <option value="full">Solid</option>
                    <option value="thermal">Thermal relief</option>
                    <option value="none">None</option>
                  </select>
                </label>
              </fieldset>
            </>
          )}
        </div>

        <div className="ze-modal-footer">
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={() => onApply(v)}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
