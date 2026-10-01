// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_GLOBAL_DELETION's window (dialog_global_deletion_base.cpp): "Items to
 * Delete" beside "Filter Settings", the "Layer Filter" radio box below, then
 * OK / Cancel. The lock filters grey out while their item box is clear.
 */
import { type JSX, useState } from 'react';
import { StdDialogButtons, useModalEscape } from '@ziroeda/common/dialog_shim.js';
import type { DIALOG_GLOBAL_DELETION } from './dialog_global_deletion.js';

type Flag = {
  [K in keyof DIALOG_GLOBAL_DELETION]: DIALOG_GLOBAL_DELETION[K] extends boolean ? K : never;
}[keyof DIALOG_GLOBAL_DELETION];

export function DialogGlobalDeletion({
  dialog,
  onResult,
}: {
  dialog: DIALOG_GLOBAL_DELETION;
  onResult: (aOk: boolean) => void;
}): JSX.Element {
  const [, setTick] = useState(0);
  useModalEscape(() => onResult(false));

  const box = (key: Flag, label: string, cls: string, disabled = false): JSX.Element => (
    <label className={`ze-check ${cls}`}>
      <input
        type="checkbox"
        checked={dialog[key] as boolean}
        disabled={disabled}
        onChange={(e) => {
          (dialog as unknown as Record<string, boolean>)[key] = e.target.checked;
          setTick((t) => t + 1);
        }}
      />
      {label}
    </label>
  );

  const drawings = !dialog.DrawingFiltersEnabled();
  const footprints = !dialog.FootprintFiltersEnabled();
  const tracks = !dialog.TrackFiltersEnabled();

  return (
    <div className="ze-modal-backdrop">
      <div className="ze-modal ze-globaldel" role="dialog" aria-modal="true">
        <div className="ze-modal-header">Delete Items</div>
        <div className="ze-modal-body">
          <div className="ze-globaldel-upper">
            <fieldset className="ze-sbox ze-globaldel-items">
              <legend>Items to Delete</legend>
              {box('m_delZones', 'Zones', 'brl5')}
              {box('m_delTexts', 'Text', 'brl5')}
              {box('m_delBoardEdges', 'Board outlines', 'brl5')}
              {box('m_delDrawings', 'Graphics', 'brl5')}
              {box('m_delFootprints', 'Footprints', 'brl5')}
              {box('m_delTracks', 'Tracks & vias', 'brl5')}
              {box('m_delTeardrops', 'Teardrops', 'brl5')}
              {box('m_delMarkers', 'Markers', 'brl5')}
              {box('m_delAll', 'Clear board', 'brl5')}
            </fieldset>
            <fieldset className="ze-sbox ze-globaldel-filter">
              <legend>Filter Settings</legend>
              <div className="ze-globaldel-filter-grid">
                {box('m_drawingFilterLocked', 'Locked graphics', 'rl5', drawings)}
                {box('m_drawingFilterUnlocked', 'Unlocked graphics', 'brl5', drawings)}
                {box('m_footprintFilterLocked', 'Locked footprints', 'trl5', footprints)}
                {box('m_footprintFilterUnlocked', 'Unlocked footprints', 'brl5', footprints)}
                {box('m_trackFilterLocked', 'Locked tracks', 'trl5', tracks)}
                {box('m_trackFilterUnlocked', 'Unlocked tracks', 'rl5', tracks)}
                {box('m_viaFilterLocked', 'Locked vias', 'rl5', tracks)}
                {box('m_viaFilterUnlocked', 'Unlocked vias', 'rl5', tracks)}
              </div>
            </fieldset>
          </div>
          <fieldset className="ze-sbox ze-globaldel-layers" role="radiogroup">
            <legend>Layer Filter</legend>
            {dialog.m_layerOptionLabels.map((label, i) => (
              <label key={label} className="ze-radio">
                <input
                  type="radio"
                  name="ze-globaldel-layer"
                  checked={dialog.m_rbLayersOption === i}
                  onChange={() => {
                    dialog.m_rbLayersOption = i;
                    setTick((t) => t + 1);
                  }}
                />
                {label}
              </label>
            ))}
          </fieldset>
        </div>
        <StdDialogButtons onOk={() => onResult(true)} onCancel={() => onResult(false)} />
      </div>
    </div>
  );
}
