// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_CLEANUP_TRACKS_AND_VIAS's window (dialog_cleanup_tracks_and_vias_base.cpp):
 * the "Actions" and "Filter Items" boxes side by side, then a simplebook of
 * "Changes to be applied:" (the RC tree) and "Progress:" (the report), then
 * Build Changes / Update PCB and Cancel.
 */
import { type JSX, useEffect, useState, useSyncExternalStore } from 'react';
import { DialogShim, StdDialogButtons } from '@ziroeda/common/dialog_shim.js';
import { NetSelector } from '@ziroeda/common/widgets/net_selector.js';
import { RcTreeView } from '@ziroeda/common/widgets/rc_tree_view.js';
import { Combo } from '@ziroeda/common/widgets/wx_combobox.js';
import type { DIALOG_CLEANUP_TRACKS_AND_VIAS } from './dialog_cleanup_tracks_and_vias.js';

export interface CLEANUP_LAYER_CHOICE {
  layer: number;
  label: string;
  swatch?: string;
}

export function DialogCleanupTracksAndVias({
  dialog,
  nets,
  layers,
  onClose,
}: {
  dialog: DIALOG_CLEANUP_TRACKS_AND_VIAS;
  /** The board's nets for m_netFilter (NET_SELECTOR over GetNetInfo()). */
  nets: ReadonlyMap<number, string>;
  /** m_layerFilter: a PCB_LAYER_BOX_SELECTOR that may not offer AllNonCuMask(). */
  layers: readonly CLEANUP_LAYER_CHOICE[];
  onClose: () => void;
}): JSX.Element {
  const [version, setVersion] = useState(0);
  useSyncExternalStore(
    (l) =>
      dialog.Subscribe(() => {
        setVersion((v) => v + 1);
        l();
      }),
    () => version,
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    dialog.TransferDataToWindow();
  }, [dialog]);

  const opt = (
    key:
      | 'm_cbRefillZones'
      | 'm_cleanShortCircuitOpt'
      | 'm_cleanViasOpt'
      | 'm_deleteDanglingViasOpt'
      | 'm_mergeSegmOpt'
      | 'm_deleteUnconnectedOpt'
      | 'm_deleteTracksInPadsOpt'
      | 'm_netFilterOpt'
      | 'm_netclassFilterOpt'
      | 'm_layerFilterOpt'
      | 'm_selectedItemsFilter',
    label: string,
    title?: string,
    cls = '',
  ): JSX.Element => (
    <label className={`ze-check ${cls}`} title={title}>
      <input
        type="checkbox"
        checked={dialog[key]}
        onChange={(e) => {
          dialog[key] = e.target.checked;
          dialog.OnCheckBox();
        }}
      />
      {label}
    </label>
  );

  const ok = async (): Promise<void> => {
    if (busy) return;

    setBusy(true);

    try {
      if (await dialog.TransferDataFromWindow()) onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogShim title="Cleanup Tracks &amp; Vias" onClose={onClose} className="ze-cleanup">
      <div className="ze-modal-body ze-cleanup-body">
        <div className="ze-cleanup-top">
          <fieldset className="ze-sbox ze-cleanup-actions">
            <legend>Actions</legend>
            {opt('m_cbRefillZones', 'Refill zones before and after cleanup')}
            <span className="ze-cleanup-gap12" />
            {opt(
              'm_cleanShortCircuitOpt',
              'Delete tracks connecting different nets',
              'remove track segments connecting nodes belonging to different nets (short circuit)',
            )}
            <span className="ze-cleanup-gap10" />
            {opt(
              'm_cleanViasOpt',
              'Delete redundant vias',
              'remove vias on through hole pads and superimposed vias',
            )}
            {opt(
              'm_deleteDanglingViasOpt',
              'Delete vias connected on only one layer',
              undefined,
              'top5',
            )}
            <span className="ze-cleanup-gap10" />
            {opt(
              'm_mergeSegmOpt',
              'Merge co-linear tracks',
              'merge aligned track segments, and remove null segments',
            )}
            {opt(
              'm_deleteUnconnectedOpt',
              'Delete tracks unconnected at one end',
              'delete tracks having at least one dangling end',
              'top5',
            )}
            {opt(
              'm_deleteTracksInPadsOpt',
              'Delete tracks fully inside pads',
              'Delete tracks that have both start and end positions inside of a pad',
              'all5',
            )}
          </fieldset>
          <fieldset className="ze-sbox ze-cleanup-filters">
            <legend>Filter Items</legend>
            <div className="ze-cleanup-filter-grid">
              {opt('m_netFilterOpt', 'Filter items by net:')}
              <NetSelector
                netInfo={nets}
                netcode={dialog.m_netFilter}
                onChange={(net) => {
                  dialog.m_netFilter = net;
                  dialog.OnCheckBox();
                }}
              />
              {opt('m_netclassFilterOpt', 'Filter items by net class:')}
              <Combo
                value={dialog.m_netclassFilter}
                options={dialog.m_netclassNames.map((n) => ({ value: n, label: n }))}
                onChange={(v: string) => {
                  dialog.m_netclassFilter = v;
                  dialog.OnCheckBox();
                }}
              />
              <span className="ze-cleanup-gap7" />
              <span />
              {opt('m_layerFilterOpt', 'Filter items by layer:')}
              <Combo
                value={String(dialog.m_layerFilter)}
                options={layers.map((l) => ({
                  value: String(l.layer),
                  label: l.label,
                  swatch: l.swatch,
                }))}
                onChange={(v: string) => {
                  dialog.m_layerFilter = Number(v);
                  dialog.OnCheckBox();
                }}
              />
            </div>
            {opt('m_selectedItemsFilter', 'Selected items only', undefined, 'all5')}
          </fieldset>
        </div>
        <div className="ze-cleanup-output">
          {dialog.m_outputPage === 0 ? (
            <>
              <div className="ze-cleanup-label">Changes to be applied:</div>
              <RcTreeView
                model={dialog.m_changesTreeModel}
                view={dialog.m_changesView}
                onDoubleClick={(node) => dialog.OnSelectItem(node)}
                testId="cleanup-changes"
              />
            </>
          ) : (
            <>
              <div className="ze-cleanup-label all5">Progress:</div>
              <textarea
                className="ze-cleanup-report"
                readOnly
                value={dialog.GetReportLines().join('\n')}
              />
            </>
          )}
        </div>
      </div>
      <StdDialogButtons
        okLabel={dialog.GetOKLabel()}
        okDisabled={busy}
        onOk={() => void ok()}
        onCancel={onClose}
      />
    </DialogShim>
  );
}
