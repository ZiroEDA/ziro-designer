// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The windows of `CONVERT_SETTINGS_DIALOG` (`convert_tool.cpp:65-203`) and of
 * the zone editors' "Conversion Settings" box. The transfers are in
 * `convert_settings_dialog.ts`; every border here is the C++ sizer's Add().
 */
import { type JSX, useState } from 'react';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import type { StatusUnits } from '@ziroeda/common/widgets/kistatusbar_format.js';
import { CONVERT_STRATEGY } from '../pcbnew_settings.js';
import { pcbUnitText, pcbUnitValue, unitLabel } from '../pcb_unit_binder.js';
import {
  CONVERT_SETTINGS_DIALOG,
  type ConversionBoxValues,
  type ConvertSettingsValues,
} from './convert_settings_dialog.js';

// [data] The sizer borders and spacers of convert_tool.cpp:65-203 and of the
// zone dialogs' conversion box (dialog_copper_zones.cpp:139-169): the
// pixel counts the C++ passes to Add() and AddSpacer().
const ADD_LR_5 = '0 5px'; // Add( m_rb..., 0, wxLEFT|wxRIGHT, 5 )
const ADD_ALL_5 = 5; // Add( m_cbDeleteOriginals, 0, wxALL, 5 )
const ADD_ALL_10 = 10; // Add( topSizer, 1, wxALL|wxEXPAND, 10 ); Insert( 0, bConvertSizer, ..., 10 )
const CTRL_LR_3 = '0 3px'; // hullParamsSizer->Add( m_gapCtrl, 1, ...|wxLEFT|wxRIGHT, 3 )
const HULL_INDENT = 26; // topSizer->Add( hullParamsSizer, 0, wxLEFT, 26 )
const SPACER_2 = 2;
const SPACER_6 = 6;
const SPACER_15 = 15;
const SPACER_18 = 18;
const STATIC_LINE_LR = '0 10px'; // Insert( 1, line, 0, wxLEFT|wxRIGHT|wxEXPAND, 10 )

/** A `UNIT_BINDER`'s three controls: label, text, units. */
function UnitRow({
  label,
  value,
  units,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  units: StatusUnits;
  disabled: boolean;
  onChange: (iu: number) => void;
}): JSX.Element {
  const [text, setText] = useState(pcbUnitText(value, units));

  return (
    <>
      <span className={disabled ? 'ze-disabled' : undefined}>{label}</span>
      <input
        className="ze-search"
        type="text"
        size={8}
        value={text}
        disabled={disabled}
        style={{ flex: '1 1 auto', margin: CTRL_LR_3 }}
        onChange={(e) => {
          setText(e.target.value);
          const iu = pcbUnitValue(e.target.value, units);
          if (Number.isFinite(iu)) onChange(iu);
        }}
      />
      <span className={disabled ? 'ze-unit-label ze-disabled' : 'ze-unit-label'}>
        {unitLabel(units)}
      </span>
    </>
  );
}

/** `CONVERT_SETTINGS_DIALOG`, "Conversion Settings". */
export function ConvertSettingsDialog({
  dialog,
  units,
  onClose,
}: {
  dialog: CONVERT_SETTINGS_DIALOG;
  units: StatusUnits;
  /** OK (after the transfer) or Cancel. */
  onClose: (aOk: boolean) => void;
}): JSX.Element {
  const [v, setV] = useState<ConvertSettingsValues>(() => dialog.TransferDataToWindow());
  const set = (patch: Partial<ConvertSettingsValues>): void => setV((p) => ({ ...p, ...patch }));
  const hull = CONVERT_SETTINGS_DIALOG.HullParamsEnabled(v);
  const shown = dialog.m_shown;

  const radio = (label: string, strategy: CONVERT_STRATEGY): JSX.Element => (
    <label className="ze-check" style={{ margin: ADD_LR_5 }}>
      <input
        type="radio"
        name="ze-convert-strategy"
        checked={v.strategy === strategy}
        onChange={() => set({ strategy })}
      />
      {label}
    </label>
  );

  return (
    <DialogShim title="Conversion Settings" onClose={() => onClose(false)}>
      {/* mainSizer->Add( topSizer, 1, wxALL|wxEXPAND, 10 ) */}
      <div style={{ margin: ADD_ALL_10, display: 'flex', flexDirection: 'column' }}>
        {' '}
        {shown.copyLineWidth &&
          radio('Copy line width of first object', CONVERT_STRATEGY.COPY_LINEWIDTH)}
        {shown.centerline && (
          <>
            <div style={{ height: SPACER_6 }} />
            {radio('Use centerlines', CONVERT_STRATEGY.CENTERLINE)}
          </>
        )}
        {shown.boundingHull && (
          <>
            <div style={{ height: SPACER_6 }} />
            {radio('Create bounding hull', CONVERT_STRATEGY.BOUNDING_HULL)}
            <div style={{ height: SPACER_2 }} />
            {/* topSizer->Add( hullParamsSizer, 0, wxLEFT, 26 ) */}
            <div style={{ marginLeft: HULL_INDENT, display: 'flex', alignItems: 'center' }}>
              {' '}
              <UnitRow
                label="Gap:"
                value={v.gap}
                units={units}
                disabled={!hull}
                onChange={(gap) => set({ gap })}
              />
              <div style={{ width: SPACER_18 }} />
              <UnitRow
                label="Line width:"
                value={v.lineWidth}
                units={units}
                disabled={!hull}
                onChange={(lineWidth) => set({ lineWidth })}
              />
            </div>
            <div style={{ height: SPACER_15 }} />
          </>
        )}
        {/* topSizer->Add( m_cbDeleteOriginals, 0, wxALL, 5 ) */}
        <label className="ze-check" style={{ margin: ADD_ALL_5 }}>
          {' '}
          <input
            type="checkbox"
            checked={v.deleteOriginals}
            onChange={(e) => set({ deleteOriginals: e.target.checked })}
          />
          Delete source objects after conversion
        </label>
      </div>

      <div className="ze-modal-footer">
        <button type="button" className="ze-btn" onClick={() => onClose(false)}>
          Cancel
        </button>
        <button
          type="button"
          className="ze-btn primary"
          onClick={() => {
            dialog.TransferDataFromWindow(v);
            onClose(true);
          }}
        >
          OK
        </button>
      </div>
    </DialogShim>
  );
}

/**
 * The zone editors' "Conversion Settings" static box, inserted at the top of
 * the dialog (`GetSizer()->Insert( 0, bConvertSizer, 0, wxALL|wxEXPAND, 10 )`).
 */
/** The static line under the conversion box (rule-area editor only). */
export const CONVERSION_BOX_LINE_MARGIN = STATIC_LINE_LR;

export function ConversionSettingsBox({
  values,
  units,
  onChange,
}: {
  values: ConversionBoxValues;
  units: StatusUnits;
  onChange: (aValues: ConversionBoxValues) => void;
}): JSX.Element {
  const set = (patch: Partial<ConversionBoxValues>): void => onChange({ ...values, ...patch });

  return (
    <fieldset className="ze-sbox" style={{ margin: ADD_ALL_10 }}>
      <legend>Conversion Settings</legend>
      <label className="ze-check" style={{ margin: ADD_LR_5 }}>
        {' '}
        <input
          type="radio"
          checked={!values.boundingHull}
          onChange={() => set({ boundingHull: false })}
        />
        Use centerlines
      </label>
      <div style={{ height: SPACER_2 }} />
      <label className="ze-check" style={{ margin: ADD_LR_5 }}>
        {' '}
        <input
          type="radio"
          checked={values.boundingHull}
          onChange={() => set({ boundingHull: true })}
        />
        Create bounding hull
      </label>
      <div style={{ height: SPACER_2 }} />
      <div style={{ marginLeft: HULL_INDENT, display: 'flex', alignItems: 'center' }}>
        {' '}
        <UnitRow
          label="Gap:"
          value={values.gap}
          units={units}
          disabled={!values.boundingHull}
          onChange={(gap) => set({ gap })}
        />
      </div>
      <div style={{ height: SPACER_6 }} />
      <label className="ze-check" style={{ margin: ADD_ALL_5 }}>
        {' '}
        <input
          type="checkbox"
          checked={values.deleteOriginals}
          onChange={(e) => set({ deleteOriginals: e.target.checked })}
        />
        Delete source objects after conversion
      </label>
    </fieldset>
  );
}
