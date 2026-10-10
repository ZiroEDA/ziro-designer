// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Footprint Properties, board side. Counterpart:
 * `pcbnew/dialogs/dialog_footprint_properties.cpp` over its `_base` layout:
 * a General page (position, orientation, fabrication attributes) and a
 * "Clearance Overrides && Pad Connections" page.
 *
 * One thing upstream has that is not here: the Fields grid, which edits each
 * field's text properties — that is DIALOG_TEXT_PROPERTIES work.
 *
 * The decision logic lives in `pcbnew/dialogs/dialog_footprint_properties.ts`.
 */

import { CheckBox, Combo, TextCtrl } from '@ziroeda/common/wx/controls.js';
import { useRef, useState, type JSX, type ReactNode } from 'react';
import { pcbIuToMM, pcbMmToIU } from '@ziroeda/common/eda_units.js';
import type { FootprintValues } from './dialog_footprint_properties.js';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { pcbUnitText, pcbUnitValue, unitLabel } from '../pcb_unit_binder.js';
import type { StatusUnits } from '@ziroeda/common/widgets/kistatusbar_format.js';
import type { FOOTPRINT, FP_3DMODEL } from '../footprint.js';
import type { PANEL_3D_MODEL_HOST, SELECTED_3D_MODEL } from './panel_fp_properties_3d_model.js';
import {
  PanelFpProperties3dModel,
  type PANEL_3D_MODEL_API,
} from './panel_fp_properties_3d_model_ui.js';

interface Props {
  /**
   * The frame's display units. Every distance in this dialog is a
   * `UNIT_BINDER` upstream, so it shows and reads the frame's unit rather than
   * a fixed millimetre.
   */
  units: StatusUnits;
  initial: FootprintValues;
  /** The footprint's library id, shown read-only as upstream's Library link. */
  libId: string;
  onApply: (values: FootprintValues) => void;
  onClose: () => void;
  /**
   * The 3D Models page (`PANEL_FP_PROPERTIES_3D_MODEL`, which upstream adds to the
   * notebook as its third page): the live footprint it edits, what it asks of the
   * frame, and the two `3d-viewer/` widgets it hosts. Absent, the page is not drawn.
   */
  model3d?: {
    footprint: FOOTPRINT;
    host: PANEL_3D_MODEL_HOST;
    renderPreview: (
      aModels: readonly FP_3DMODEL[],
      aSelected: number,
      aVersion: number,
    ) => ReactNode;
    pickModel: () => Promise<SELECTED_3D_MODEL | null>;
  };
}

type Tab = 'general' | 'clearances' | 'models3d';

export function DialogFootprintProperties({
  initial,
  units,
  libId,
  onApply,
  onClose,
  model3d,
}: Props): JSX.Element {
  const [tab, setTab] = useState<Tab>('general');
  const [v, setV] = useState<FootprintValues>(initial);
  const modelsApi = useRef<PANEL_3D_MODEL_API | null>(null);
  // Millimetre boxes keep their text so a half-typed number survives the caret.
  const [text, setText] = useState<Record<string, string>>({});

  const set = (patch: Partial<FootprintValues>): void => setV((p) => ({ ...p, ...patch }));

  /** A millimetre field bound to an IU value. */
  const mmField = (label: string, key: 'x' | 'y'): JSX.Element => (
    <label>
      <span className="ze-tvp-label">{label}</span>
      <TextCtrl
        value={text[key] ?? pcbUnitText(v[key], units)}
        onChange={(aValue) => {
          setText((p) => ({ ...p, [key]: aValue }));
          const iu = pcbUnitValue(aValue, units);
          if (Number.isFinite(iu)) set({ [key]: iu } as Partial<FootprintValues>);
        }}
        className="ze-tvp-input"
      />
      <span className="ze-unit-label">{unitLabel(units)}</span>
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
    const shown = text[key] ?? (stored === null ? '' : pcbUnitText(stored, units));
    return (
      <label title={title}>
        <span className="ze-tvp-label">{label}</span>
        <TextCtrl
          value={shown}
          onChange={(aValue) => {
            const s = aValue;
            setText((p) => ({ ...p, [key]: s }));
            if (s.trim() === '') {
              set({ [key]: null } as Partial<FootprintValues>);
              return;
            }
            const iu = pcbUnitValue(s, units);
            if (Number.isFinite(iu)) set({ [key]: iu } as Partial<FootprintValues>);
          }}
          className="ze-tvp-input"
          hint="—"
        />
        <span className="ze-unit-label">{unitLabel(units)}</span>
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
    <CheckBox
      label={label}
      checked={v[key]}
      title={title}
      onChange={(aChecked) => set({ [key]: aChecked } as Partial<FootprintValues>)}
    />
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
    <DialogShim title="Footprint Properties" onClose={onClose} className="ze-fpprops-dialog">
      <div className="ze-tabbar ze-fpprops-tabs">
        {tabButton('general', 'General')}
        {tabButton('clearances', 'Clearance Overrides & Pad Connections')}
        {model3d && tabButton('models3d', '3D Models')}
      </div>

      <div className="ze-modal-body ze-update-pcb-body ze-tvp-body">
        {tab === 'general' ? (
          <>
            <fieldset>
              <legend>Footprint</legend>
              <label>
                <span className="ze-tvp-label">Reference designator:</span>
                <TextCtrl
                  value={v.reference}
                  onChange={(aValue) => set({ reference: aValue })}
                  className="ze-tvp-select"
                />
              </label>
              <label>
                <span className="ze-tvp-label">Value:</span>
                <TextCtrl
                  value={v.value}
                  onChange={(aValue) => set({ value: aValue })}
                  className="ze-tvp-select"
                />
              </label>
              <label title="The library ID and footprint ID currently assigned.">
                <span className="ze-tvp-label">Library link:</span>
                <TextCtrl value={libId} readOnly className="ze-tvp-select" />
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
              <label title="Changing the side flips the footprint (EDIT_TOOL::Flip).">
                <span className="ze-tvp-label">Side:</span>
                <Combo
                  value={String(v.side)}
                  options={[
                    { value: String('front'), label: 'Front' },
                    { value: String('back'), label: 'Back' },
                  ]}
                  className="ze-tvp-select"
                  onChange={(aValue) => set({ side: aValue as FootprintValues['side'] })}
                />
              </label>
              {check('Locked', 'locked')}
            </fieldset>

            <fieldset>
              <legend>Fabrication Attributes</legend>
              <label>
                <span className="ze-tvp-label">Footprint type:</span>
                <Combo
                  value={String(v.footprintType)}
                  options={[
                    { value: String('through_hole'), label: 'Through hole' },
                    { value: String('smd'), label: 'SMD' },
                    { value: String('unspecified'), label: 'Unspecified' },
                  ]}
                  className="ze-tvp-select"
                  onChange={(aValue) =>
                    set({ footprintType: aValue as FootprintValues['footprintType'] })
                  }
                />
              </label>
              {check('Not in schematic', 'notInSchematic')}
              {check('Do not populate', 'doNotPopulate')}
              {check('Exclude from bill of materials', 'excludeFromBom')}
              {check('Exclude from position files', 'excludeFromPosFiles')}
              {check('Allow missing courtyard', 'allowMissingCourtyard')}
            </fieldset>
          </>
        ) : tab === 'clearances' ? (
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
              {check('Allow bridged solder mask apertures between pads', 'allowSolderMaskBridges')}
              {overrideField(
                'Solder paste clearance:',
                'localSolderPasteMargin',
                'Solder paste clearance relative to pad size.\nThis value can be superseded by a pad local value.',
              )}
              <label title="Solder paste clearance as a fraction of the pad size.">
                <span className="ze-tvp-label">Paste clearance ratio:</span>
                <TextCtrl
                  value={
                    text.ratio ??
                    (v.localSolderPasteMarginRatio === null
                      ? ''
                      : String(v.localSolderPasteMarginRatio))
                  }
                  onChange={(aValue) => {
                    const s = aValue;
                    setText((p) => ({ ...p, ratio: s }));
                    if (s.trim() === '') {
                      set({ localSolderPasteMarginRatio: null });
                      return;
                    }
                    const n = Number(s);
                    if (Number.isFinite(n)) set({ localSolderPasteMarginRatio: n });
                  }}
                  className="ze-tvp-input"
                  hint="—"
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
                <Combo
                  value={String(v.zoneConnection)}
                  options={[
                    { value: String('inherited'), label: 'Use zone setting' },
                    { value: String('full'), label: 'Solid' },
                    { value: String('thermal'), label: 'Thermal relief' },
                    { value: String('none'), label: 'None' },
                  ]}
                  className="ze-tvp-select"
                  onChange={(aValue) =>
                    set({ zoneConnection: aValue as FootprintValues['zoneConnection'] })
                  }
                />
              </label>
            </fieldset>
          </>
        ) : null}
        {/* Mounted for the dialog's life, so the list survives a change of page. */}
        {model3d && (
          <div className="ze-fp3d-host" hidden={tab !== 'models3d'}>
            <PanelFpProperties3dModel
              footprint={model3d.footprint}
              host={model3d.host}
              renderPreview={model3d.renderPreview}
              pickModel={model3d.pickModel}
              apiRef={modelsApi}
            />
          </div>
        )}
      </div>

      <div className="ze-modal-footer">
        <span style={{ flex: 1 }} />
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => {
            // `m_3dPanel->TransferDataFromWindow()`: commit the open cell, then take the list.
            if (modelsApi.current && !modelsApi.current.CommitPendingChanges()) return;
            onApply(modelsApi.current ? { ...v, models: modelsApi.current.GetModelList() } : v);
          }}
        >
          OK
        </button>
      </div>
    </DialogShim>
  );
}
