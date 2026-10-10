// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_GLOBAL_EDIT_TRACKS_AND_VIAS's window
 * (dialog_global_edit_tracks_and_vias_base.cpp): "Scope" beside "Filter Items",
 * then "Action" (the specified values, or the net class / custom rule values),
 * then Apply and Close / Close.
 */
import { type JSX, useEffect, useState } from 'react';
import { DialogShim, StdDialogButtons } from '@ziroeda/common/dialog_shim.js';
import { unitLabel } from '@ziroeda/common/eda_units.js';
import { INDETERMINATE_ACTION } from '@ziroeda/common/widgets/ui_common.js';
import type { UNIT_BINDER } from '@ziroeda/common/widgets/unit_binder.js';
import { NetSelector } from '@ziroeda/common/widgets/net_selector.js';
import { Combo } from '@ziroeda/common/widgets/wx_combobox.js';
import type {
  CHOICE,
  DIALOG_GLOBAL_EDIT_TRACKS_AND_VIAS,
} from './dialog_global_edit_tracks_and_vias.js';

export interface TRACKS_VIAS_LAYER_CHOICE {
  layer: number;
  label: string;
  swatch?: string;
}

type Flag =
  | 'm_tracks'
  | 'm_throughVias'
  | 'm_microVias'
  | 'm_blindVias'
  | 'm_buriedVias'
  | 'm_netFilterOpt'
  | 'm_netclassFilterOpt'
  | 'm_layerFilterOpt'
  | 'm_filterByTrackWidth'
  | 'm_filterByViaSize'
  | 'm_selectedItemsFilter';

export function DialogGlobalEditTracksAndVias({
  dialog,
  nets,
  layers,
  onClose,
}: {
  dialog: DIALOG_GLOBAL_EDIT_TRACKS_AND_VIAS;
  nets: ReadonlyMap<number, string>;
  /** The board's copper layers for both layer controls. */
  layers: readonly TRACKS_VIAS_LAYER_CHOICE[];
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

  const box = (key: Flag, label: string, cls = ''): JSX.Element => (
    <label className={`ze-check ${cls}`}>
      <input
        type="checkbox"
        checked={dialog[key]}
        onChange={(e) => {
          dialog[key] = e.target.checked;
          redraw();
        }}
      />
      {label}
    </label>
  );

  const choice = (c: CHOICE, disabled: boolean): JSX.Element => (
    <Combo
      value={String(c.selection)}
      options={c.items.map((label, i) => ({ value: String(i), label }))}
      disabled={disabled}
      onChange={(v: string) => {
        c.selection = Number(v);
        redraw();
      }}
    />
  );

  const sizeEntry = (b: UNIT_BINDER): JSX.Element => (
    <span className="ze-gettv-size">
      <input
        className="ze-search"
        value={b.GetText()}
        onChange={(e) => {
          b.SetText(e.target.value);
          redraw();
        }}
      />
      <span className="unit">{unitLabel(b.GetUnits())}</span>
    </span>
  );

  const vias = dialog.GetViasValue();
  const off = !dialog.ActionControlsEnabled();

  return (
    <DialogShim title="Set Track and Via Properties" onClose={close} className="ze-gettv">
      <div className="ze-modal-body">
        <div className="ze-gettv-top">
          <fieldset className="ze-sbox ze-gettv-scope">
            <legend>Scope</legend>
            {box('m_tracks', 'Tracks', 'brl5')}
            <span className="ze-gettv-gap10" />
            <label className="ze-check brl5">
              <input
                type="checkbox"
                checked={vias === true}
                ref={(el) => {
                  if (el) el.indeterminate = vias === null;
                }}
                onChange={(e) => {
                  dialog.OnVias(e.target.checked);
                  redraw();
                }}
              />
              Vias
            </label>
            {box('m_throughVias', 'Through vias', 'l20')}
            {box('m_microVias', 'Microvias', 'l20 t3')}
            {box('m_blindVias', 'Blind vias', 'l20 t3')}
            {box('m_buriedVias', 'Buried vias', 'l20 t3')}
          </fieldset>
          <fieldset className="ze-sbox ze-gettv-filters">
            <legend>Filter Items</legend>
            <div className="ze-gettv-filter-grid">
              {box('m_netFilterOpt', 'Filter items by net:')}
              <NetSelector
                netInfo={nets}
                netcode={dialog.m_netFilter}
                onChange={(net) => {
                  dialog.m_netFilter = net;
                  redraw();
                }}
              />
              {box('m_netclassFilterOpt', 'Filter items by net class:')}
              <Combo
                value={dialog.m_netclassFilter}
                options={dialog.m_netclassNames.map((n) => ({ value: n, label: n }))}
                onChange={(v: string) => {
                  dialog.m_netclassFilter = v;
                  redraw();
                }}
              />
              {box('m_layerFilterOpt', 'Filter items by layer:')}
              <Combo
                value={String(dialog.m_layerFilter)}
                options={layers.map((l) => ({
                  value: String(l.layer),
                  label: l.label,
                  swatch: l.swatch,
                }))}
                onChange={(v: string) => {
                  dialog.m_layerFilter = Number(v);
                  redraw();
                }}
              />
              {box('m_filterByTrackWidth', 'Filter tracks by width:')}
              {sizeEntry(dialog.m_trackWidthFilter)}
              {box('m_filterByViaSize', 'Filter vias by diameter:')}
              {sizeEntry(dialog.m_viaSizeFilter)}
            </div>
            {box('m_selectedItemsFilter', 'Selected items only', 'all5')}
          </fieldset>
        </div>
        <fieldset className="ze-sbox ze-gettv-action">
          <legend>Action</legend>
          <label className="ze-radio">
            <input
              type="radio"
              name="ze-gettv-action"
              checked={dialog.m_setToSpecifiedValues}
              onChange={() => {
                dialog.m_setToSpecifiedValues = true;
                redraw();
              }}
            />
            Set to specified values:
          </label>
          <div className="ze-gettv-action-grid">
            <span className="lbl">Layer:</span>
            <Combo
              value={String(dialog.m_layerCtrl)}
              disabled={off}
              options={[
                { value: String(-1), label: INDETERMINATE_ACTION },
                ...layers.map((l) => ({
                  value: String(l.layer),
                  label: l.label,
                  swatch: l.swatch,
                })),
              ]}
              onChange={(v: string) => {
                dialog.m_layerCtrl = Number(v);
                redraw();
              }}
            />
            <span className="lbl">Track width:</span>
            {choice(dialog.m_trackWidthCtrl, off)}
            <span className="lbl">Via size:</span>
            {choice(dialog.m_viaSizesCtrl, off)}
            <span className="lbl">Via annular rings:</span>
            {choice(dialog.m_annularRingsCtrl, off)}
            <span
              className="lbl"
              title="Select which protection feature according to IPC-4761 the via should have."
            >
              Via protection features:
            </span>
            {choice(dialog.m_protectionFeatures, off)}
          </div>
          <label className="ze-radio">
            <input
              type="radio"
              name="ze-gettv-action"
              checked={!dialog.m_setToSpecifiedValues}
              onChange={() => {
                dialog.m_setToSpecifiedValues = false;
                redraw();
              }}
            />
            Set to net class / custom rule values
          </label>
        </fieldset>
      </div>
      <StdDialogButtons
        okLabel="Apply and Close"
        cancelLabel="Close"
        onOk={() => {
          if (dialog.TransferDataFromWindow()) close();
        }}
        onCancel={close}
      />
    </DialogShim>
  );
}
