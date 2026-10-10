// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_GLOBAL_EDIT_TEARDROPS's window (dialog_global_edit_teardrops_base.cpp):
 * Scope and Filter Items side by side, then Action - the four radios, the
 * Board Setup link, and the specified values (tri-state boxes and five
 * UNIT_BINDERs beside the teardrop_sizes bitmap) - then Apply and Close / Close.
 */
import { CheckBox, RadioButton, StaticBox, TextCtrl } from '@ziroeda/common/wx/controls.js';
import { type JSX, useEffect, useState } from 'react';
import { svgUrl } from '@ziroeda/bitmaps_png';
import { DialogShim, StdDialogButtons } from '@ziroeda/common/dialog_shim.js';
import { unitLabel } from '@ziroeda/common/eda_units.js';
import { NetSelector } from '@ziroeda/common/widgets/net_selector.js';
import type { UNIT_BINDER } from '@ziroeda/common/widgets/unit_binder.js';
import { Combo } from '@ziroeda/common/widgets/wx_combobox.js';
import {
  type DIALOG_GLOBAL_EDIT_TEARDROPS,
  TEARDROP_ACTION,
  type TRI_STATE,
} from './dialog_global_edit_teardrops.js';

export interface TEARDROP_LAYER_CHOICE {
  layer: number;
  label: string;
  swatch?: string;
}

type Flag =
  | 'm_pthPads'
  | 'm_smdPads'
  | 'm_vias'
  | 'm_netFilterOpt'
  | 'm_netclassFilterOpt'
  | 'm_layerFilterOpt'
  | 'm_roundPadsFilter'
  | 'm_existingFilter'
  | 'm_selectedItemsFilter';

export function DialogGlobalEditTeardrops({
  dialog,
  nets,
  layers,
  onShowBoardSetup,
  onApplied,
  onClose,
}: {
  dialog: DIALOG_GLOBAL_EDIT_TEARDROPS;
  nets: ReadonlyMap<number, string>;
  /** The copper layers (`SetNotAllowedLayerSet( LSET::AllNonCuMask() )`). */
  layers: readonly TEARDROP_LAYER_CHOICE[];
  /** `onShowBoardSetup`: Board Setup on its Teardrops page. */
  onShowBoardSetup: () => void;
  /** After a successful Apply and Close, before the dialog goes. */
  onApplied: () => void;
  onClose: () => void;
}): JSX.Element {
  const [, setTick] = useState(0);
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

  const filtersOn = dialog.FiltersEnabled();
  const specOn = dialog.SpecifiedValuesEnabled();
  const labels = dialog.AddLabels();

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
    key: 'm_cbPreferZoneConnection' | 'm_cbTeardropsUseNextTrack' | 'm_curvedEdges',
    label: string,
    tooltip?: string,
  ): JSX.Element => {
    const v: TRI_STATE = dialog[key];
    return (
      <label className="ze-check" title={tooltip}>
        <input
          type="checkbox"
          checked={v === true}
          disabled={!specOn}
          ref={(el) => {
            if (el) el.indeterminate = v === null;
          }}
          onChange={() => {
            // wxCHK_ALLOW_3RD_STATE_FOR_USER: off -> on -> undetermined -> off.
            dialog[key] = v === false ? true : v === true ? null : false;
            redraw();
          }}
        />
        {label}
      </label>
    );
  };

  const radio = (action: TEARDROP_ACTION, label: string, tooltip?: string): JSX.Element => (
    <RadioButton
      label={label}
      name="ze-getd-action"
      checked={dialog.m_action === action}
      title={tooltip}
      className="ze-radio"
      onChange={() => {
        dialog.m_action = action;
        redraw();
      }}
    />
  );

  const entry = (b: UNIT_BINDER): JSX.Element => (
    <TextCtrl
      value={b.GetText()}
      onChange={(aValue) => {
        b.SetText(aValue);
        redraw();
      }}
      disabled={!specOn}
      className="ze-search"
    />
  );

  /** The `%( d )` unit hint after a percentage. */
  const pctOf = (d: string): JSX.Element => (
    <span className="ze-getd-pct">
      %(<span className="hint">{d}</span> )
    </span>
  );

  const src = svgUrl('teardrops', 'teardrop_sizes');

  return (
    <DialogShim title="Edit Teardrops" onClose={close} className="ze-getd">
      <div className="ze-modal-body">
        <div className="ze-getd-top">
          <StaticBox label="Scope" className="ze-getd-scope">
            {box('m_pthPads', 'PTH pads')}
            {box('m_smdPads', 'SMD pads')}
            {box('m_vias', 'Vias')}
            <CheckBox
              label="Track to track"
              checked={dialog.m_trackToTrack}
              className="all5"
              onChange={(aChecked) => {
                dialog.OnTrackToTrack(aChecked);
                redraw();
              }}
            />
          </StaticBox>
          <StaticBox label="Filter Items" className="ze-getd-filters">
            <div className="ze-getd-filter-grid">
              {box('m_netFilterOpt', 'Filter items by net:', '', !filtersOn)}
              <NetSelector
                netInfo={nets}
                netcode={dialog.m_netFilter}
                disabled={!filtersOn}
                onChange={(net) => {
                  dialog.m_netFilter = net;
                  dialog.m_netFilterOpt = true; // OnNetFilterSelect
                  redraw();
                }}
              />
              {box('m_netclassFilterOpt', 'Filter items by net class:', '', !filtersOn)}
              <Combo
                value={dialog.m_netclassFilter}
                disabled={!filtersOn}
                options={dialog.m_netclassNames.map((n) => ({ value: n, label: n }))}
                onChange={(v: string) => {
                  dialog.m_netclassFilter = v;
                  dialog.m_netclassFilterOpt = true; // OnNetclassFilterSelect
                  redraw();
                }}
              />
              <span className="ze-getd-gap" />
              <span className="ze-getd-gap" />
              {box('m_layerFilterOpt', 'Filter items by layer:', '', !filtersOn)}
              <Combo
                value={String(dialog.m_layerFilter)}
                disabled={!filtersOn}
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
            </div>
            {box('m_roundPadsFilter', 'Round pads only', 'top5', !filtersOn)}
            {box('m_existingFilter', 'Existing teardrops only', 'top5', !filtersOn)}
            {box('m_selectedItemsFilter', 'Selected items only', 'all5', !filtersOn)}
          </StaticBox>
        </div>
        <StaticBox label="Action" className="ze-getd-action">
          {radio(
            TEARDROP_ACTION.REMOVE,
            'Remove teardrops',
            'Remove teardrops according to filtering options',
          )}
          {radio(
            TEARDROP_ACTION.REMOVE_ALL,
            'Remove all teardrops',
            'Remove all teardrops, regardless of filtering options',
          )}
          <div className="ze-getd-addrow">
            {radio(TEARDROP_ACTION.ADD_DEFAULTS, labels.addTeardrops)}
            <button
              type="button"
              className="ze-hyperlink"
              onClick={() => {
                dialog.OnClose();
                onShowBoardSetup();
              }}
            >
              Edit default values in Board Setup
            </button>
          </div>
          {radio(TEARDROP_ACTION.SPECIFIED, labels.specifiedValues)}
          <div className="ze-getd-specified">
            <div className="ze-getd-cols">
              <div className="ze-getd-col">
                {tri(
                  'm_cbPreferZoneConnection',
                  'Prefer zone connection',
                  'Do not create teardrops on tracks connected to pads that are also connected to a copper zone.',
                )}
                {tri(
                  'm_cbTeardropsUseNextTrack',
                  'Allow teardrops to span two track segments',
                  'Allows a teardrop to extend over the first 2 connected track segments if the first track segment is too short to accommodate the best length.',
                )}
              </div>
              <div className="ze-getd-col right">
                <div className="ze-getd-hd">
                  <span className="lbl">{dialog.m_teardropHDPercent.GetLabel()}</span>
                  {entry(dialog.m_teardropHDPercent)}
                  <span className="unit">%</span>
                </div>
                <span className="ze-getd-hint">(as a percentage of pad/via minor dimension)</span>
              </div>
            </div>
            <div className="ze-getd-shape">
              <div className="ze-getd-bitmap">
                {src && <img src={src} alt="" aria-hidden="true" />}
              </div>
              <div className="ze-getd-grid">
                <span className="lbl">{dialog.m_teardropLenPercent.GetLabel()}</span>
                {entry(dialog.m_teardropLenPercent)}
                {pctOf('d')}
                <span className="lbl">{dialog.m_teardropMaxLen.GetLabel()}</span>
                {entry(dialog.m_teardropMaxLen)}
                <span className="unit">{unitLabel(dialog.m_teardropMaxLen.GetUnits())}</span>
                <span className="ze-getd-gap" />
                <span />
                <span />
                <span className="lbl">{dialog.m_teardropHeightPercent.GetLabel()}</span>
                {entry(dialog.m_teardropHeightPercent)}
                {pctOf('d')}
                <span className="lbl">{dialog.m_teardropMaxHeight.GetLabel()}</span>
                {entry(dialog.m_teardropMaxHeight)}
                <span className="unit">{unitLabel(dialog.m_teardropMaxHeight.GetUnits())}</span>
                <span className="ze-getd-curved">{tri('m_curvedEdges', 'Curved edges')}</span>
              </div>
            </div>
          </div>
        </StaticBox>
      </div>
      <StdDialogButtons
        okLabel="Apply and Close"
        cancelLabel="Close"
        onOk={() => {
          if (dialog.TransferDataFromWindow()) {
            onApplied();
            close();
          }
        }}
        onCancel={close}
      />
    </DialogShim>
  );
}
