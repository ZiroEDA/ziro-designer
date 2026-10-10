// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_GLOBAL_EDIT_TEXT_AND_GRAPHICS's window
 * (dialog_global_edit_text_and_graphics_base.cpp): "Scope" and "Filter Items"
 * side by side, then "Action" (the specified values, or the layer defaults
 * shown read-only from Board Setup), then Apply and Close / Close.
 */
import { type JSX, useEffect, useState } from 'react';
import { DialogShim, StdDialogButtons } from '@ziroeda/common/dialog_shim.js';
import { unitLabel } from '@ziroeda/common/eda_units.js';
import { FontChoice } from '@ziroeda/common/widgets/font_choice.js';
import { INDETERMINATE_ACTION } from '@ziroeda/common/widgets/ui_common.js';
import type { UNIT_BINDER } from '@ziroeda/common/widgets/unit_binder.js';
import { Combo } from '@ziroeda/common/widgets/wx_combobox.js';
import type {
  DIALOG_GLOBAL_EDIT_TEXT_AND_GRAPHICS,
  TRI_STATE,
} from './dialog_global_edit_text_and_graphics.js';

export interface TEXT_GFX_LAYER_CHOICE {
  layer: number;
  label: string;
  swatch?: string;
}

/** One row of the layer-defaults grid: the class, then its Board Setup values. */
export interface LAYER_DEFAULTS_ROW {
  name: string;
  line: string;
  width: string;
  height: string;
  thickness: string;
  italic: boolean | null;
  upright: boolean | null;
}

type Flag =
  | 'm_references'
  | 'm_values'
  | 'm_otherFootprintFields'
  | 'm_footprintGraphics'
  | 'm_footprintTexts'
  | 'm_footprintDimensions'
  | 'm_boardGraphics'
  | 'm_boardText'
  | 'm_boardDimensions'
  | 'm_layerFilterOpt'
  | 'm_referenceFilterOpt'
  | 'm_footprintFilterOpt'
  | 'm_selectedItemsFilter'
  | 'm_centerOnFP';

export function DialogGlobalEditTextAndGraphics({
  dialog,
  layers,
  defaults,
  onClose,
}: {
  dialog: DIALOG_GLOBAL_EDIT_TEXT_AND_GRAPHICS;
  layers: readonly TEXT_GFX_LAYER_CHOICE[];
  /** The six layer-class rows TransferDataToWindow writes into m_grid. */
  defaults: readonly LAYER_DEFAULTS_ROW[];
  onClose: () => void;
}): JSX.Element {
  const [, setTick] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const redraw = (): void => setTick((t) => t + 1);
  const close = (): void => {
    dialog.OnClose();
    onClose();
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: the dialog is the trigger; redraw only bumps a counter
  useEffect(() => {
    dialog.TransferDataToWindow();
    redraw();
  }, [dialog]);

  const box = (key: Flag, label: string, cls = '', disabled = false): JSX.Element => (
    <label className={`ze-check ${cls}`}>
      <input
        type="checkbox"
        checked={dialog[key]}
        disabled={disabled}
        onChange={(e) => {
          dialog[key] = e.target.checked;
          redraw();
        }}
      />
      {label}
    </label>
  );

  const tri = (
    key: 'm_visible' | 'm_bold' | 'm_italic' | 'm_keepUpright',
    label: string,
    disabled: boolean,
  ): JSX.Element => {
    const v: TRI_STATE = dialog[key];
    return (
      <label className="ze-check">
        <input
          type="checkbox"
          checked={v === true}
          disabled={disabled}
          ref={(el) => {
            if (el) el.indeterminate = v === null;
          }}
          onChange={() => {
            // wxCHK_3STATE with user-selectable undetermined: off -> on -> mixed -> off.
            dialog[key] = v === false ? true : v === true ? null : false;
            if (key === 'm_bold') dialog.OnTextSize();
            redraw();
          }}
        />
        {label}
      </label>
    );
  };

  const entry = (b: UNIT_BINDER, disabled: boolean, onText?: () => void): JSX.Element[] => [
    <span key="l" className="lbl">
      {b.GetLabel()}
    </span>,
    <input
      key="e"
      className="ze-search"
      value={b.GetText()}
      disabled={disabled}
      onChange={(e) => {
        b.SetText(e.target.value);
        onText?.();
        redraw();
      }}
    />,
    <span key="u" className="unit">
      {unitLabel(b.GetUnits())}
    </span>,
  ];

  const on = dialog.SpecifiedValuesEnabled();
  const fp = dialog.FootprintScopeLabels();
  const board = dialog.m_isBoardEditor;

  return (
    <DialogShim title="Edit Text and Graphic Properties" onClose={close} className="ze-getg">
      <div className="ze-modal-body">
        <div className="ze-getg-top">
          <fieldset className="ze-sbox ze-getg-scope">
            <legend>Scope</legend>
            <div className="ze-getg-scope-grid">
              {box('m_references', 'Reference designators')}
              {board ? box('m_boardGraphics', 'PCB graphic items') : <span />}
              {box('m_values', 'Values')}
              {board ? box('m_boardText', 'PCB text items') : <span />}
              {box('m_otherFootprintFields', 'Other footprint fields')}
              {board ? box('m_boardDimensions', 'PCB dimensions') : <span />}
              {box('m_footprintGraphics', fp.graphics, 'top5')}
              <span />
              {box('m_footprintTexts', fp.texts)}
              <span />
              {box('m_footprintDimensions', fp.dimensions)}
            </div>
          </fieldset>
          <fieldset className="ze-sbox ze-getg-filters">
            <legend>Filter Items</legend>
            <div className="ze-getg-filter-grid">
              {box('m_layerFilterOpt', 'By layer:')}
              <Combo
                value={String(dialog.m_layerFilter)}
                options={layers.map((l) => ({
                  value: String(l.layer),
                  label: l.label,
                  swatch: l.swatch,
                }))}
                onChange={(v: string) => {
                  dialog.m_layerFilter = Number(v);
                  dialog.m_layerFilterOpt = true; // OnLayerFilterSelect
                  redraw();
                }}
              />
              {board && box('m_referenceFilterOpt', 'By parent reference designator:')}
              {board && (
                <input
                  className="ze-search"
                  value={dialog.m_referenceFilter}
                  onChange={(e) => {
                    dialog.m_referenceFilter = e.target.value;
                    dialog.m_referenceFilterOpt = true; // OnReferenceFilterText
                    redraw();
                  }}
                />
              )}
              {board && box('m_footprintFilterOpt', 'By parent footprint library link:')}
              {board && (
                <input
                  className="ze-search"
                  value={dialog.m_footprintFilter}
                  onChange={(e) => {
                    dialog.m_footprintFilter = e.target.value;
                    dialog.m_footprintFilterOpt = true; // OnFootprintFilterText
                    redraw();
                  }}
                />
              )}
            </div>
            {box('m_selectedItemsFilter', 'Selected items only', 'all5')}
          </fieldset>
        </div>
        <fieldset className="ze-sbox ze-getg-action">
          <legend>Action</legend>
          <label className="ze-radio">
            <input
              type="radio"
              name="ze-getg-action"
              checked={on}
              onChange={() => {
                dialog.m_setToSpecifiedValues = true;
                redraw();
              }}
            />
            Set to specified values:
          </label>
          <div className="ze-getg-values">
            <span className="lbl">Layer:</span>
            <Combo
              value={String(dialog.m_LayerCtrl)}
              disabled={!on}
              options={[
                { value: String(-1), label: INDETERMINATE_ACTION },
                ...layers.map((l) => ({
                  value: String(l.layer),
                  label: l.label,
                  swatch: l.swatch,
                })),
              ]}
              onChange={(v: string) => {
                dialog.m_LayerCtrl = Number(v);
                redraw();
              }}
            />
            <span />
            {tri('m_visible', 'Visible  (fields only)', !on)}
            {entry(dialog.m_lineWidth, !on)}
            <span className="ze-getg-font">
              <span className="lbl">Font:</span>
              <FontChoice
                face={dialog.m_fontCtrl === 'Default Font' ? '' : dialog.m_fontCtrl}
                indeterminate
                disabled={!on}
                onChange={(face) => {
                  dialog.m_fontCtrl = face === '' ? 'Default Font' : face;
                  redraw();
                }}
              />
            </span>
            {entry(dialog.m_textWidth, !on, () => dialog.OnTextSize())}
            {tri('m_bold', 'Bold', !on)}
            {entry(dialog.m_textHeight, !on, () => dialog.OnTextSize())}
            {tri('m_italic', 'Italic', !on)}
            {entry(dialog.m_thickness, !dialog.ThicknessEnabled())}
            <span className="ze-getg-auto">
              <label className="ze-check" title="Use the default thickness for the text size">
                <input
                  type="checkbox"
                  checked={dialog.m_autoTextThickness}
                  disabled={!on}
                  onChange={(e) => {
                    dialog.OnAutoTextThickness(e.target.checked);
                    redraw();
                  }}
                />
                Auto
              </label>
              {tri('m_keepUpright', 'Keep upright', !on)}
            </span>
            <span />
            <span />
            <span />
            {box('m_centerOnFP', 'Center on footprint', '', !on)}
          </div>
          <label className="ze-radio">
            <input
              type="radio"
              name="ze-getg-action"
              checked={!on}
              onChange={() => {
                dialog.m_setToSpecifiedValues = false;
                redraw();
              }}
            />
            {dialog.LayerDefaultsLabel()}
          </label>
          <table className="ze-getg-defaults" aria-disabled={on}>
            <thead>
              <tr>
                <th />
                <th>Line Thickness</th>
                <th>Text Width</th>
                <th>Text Height</th>
                <th>Text Thickness</th>
                <th>Italic</th>
                <th>Keep Upright</th>
              </tr>
            </thead>
            <tbody>
              {defaults.map((r) => (
                <tr key={r.name}>
                  <td>{r.name}</td>
                  <td>{r.line}</td>
                  <td>{r.width}</td>
                  <td>{r.height}</td>
                  <td>{r.thickness}</td>
                  <td className="c">{r.italic === null ? '' : r.italic ? '✓' : ''}</td>
                  <td className="c">{r.upright === null ? '' : r.upright ? '✓' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </fieldset>
        {error && <div className="ze-prefs-error">{error}</div>}
      </div>
      <StdDialogButtons
        okLabel="Apply and Close"
        cancelLabel="Close"
        onOk={() => {
          const bad = dialog.ValidationError();
          if (bad !== null) {
            setError(`${bad.replace(/:$/, '')} must be between the minimum and maximum text size.`);
            return;
          }
          if (dialog.TransferDataFromWindow()) close();
        }}
        onCancel={close}
      />
    </DialogShim>
  );
}
