// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_MAP_GERBER_LAYERS_TO_PCB_BASE` (`dialog_map_gerber_layers_to_pcb_base.cpp`),
 * drawing the state {@link DIALOG_MAP_GERBER_LAYERS_TO_PCB} holds.
 *
 * The sizer tree, `bSizerMain` (vertical):
 *   - sbUpperSizer (horizontal), proportion 1, wxEXPAND|wxALL 5:
 *     - bSizerLayerSelection (vertical), proportion 1, wxEXPAND|wxRIGHT 5:
 *       - "Layer selection:", wxALL 5;
 *       - m_bSizerLayerList (horizontal), proportion 1, wxEXPAND:
 *         - a 0 x 0 spacer, wxRIGHT|wxLEFT 10;
 *         - m_flexLeftColumnBoxSizer, wxFlexGridSizer( 16, 4, 0, 0 ) with
 *           AddGrowableCol( 1 ), proportion 1, wxEXPAND;
 *         - m_staticlineSep, wxLI_VERTICAL, wxEXPAND|wxALL 5 — hidden unless
 *           more than GERBER_DRAWLAYERS_COUNT / 2 files are loaded;
 *         - m_flexRightColumnBoxSizer, the same, proportion 1, wxEXPAND.
 *     - bRightSizer (vertical), proportion 0, wxRIGHT|wxLEFT|wxEXPAND 5:
 *       - bSizerLyrCnt (vertical), wxEXPAND: "Copper layers count:"
 *         wxTOP|wxRIGHT|wxLEFT 5, the combo wxEXPAND|wxBOTTOM|wxRIGHT|wxLEFT 5;
 *       - a 5 x 15 spacer, proportion 1, wxEXPAND;
 *       - bSizerButtons (vertical), wxEXPAND: Store Choice / Get Stored Choice /
 *         Reset, each wxALL|wxEXPAND 5.
 *   - the std buttons, wxALL|wxEXPAND 5.
 *
 * Each grid row is `initDialog`'s (`:143-197`): "Layer N:" and the file name,
 * wxALIGN_CENTER_VERTICAL|wxALL 5; the "..." wxBU_EXACTFIT button,
 * wxALIGN_CENTER_VERTICAL|wxALL with no border; the mapped layer, wxALL 5,
 * held at the width of the widest name it could ever show.
 *
 * Title `_("Layer Selection")` (`_base.h:62`).
 */

import { Button } from '@ziroeda/common/wx/controls.js';
import { type JSX, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { StdDialogButtons, useModalEscape } from '@ziroeda/common/dialog_shim.js';
import { measureTextWidth } from '@ziroeda/common/widgets/text_ctrl_width.js';
import { Combo } from '@ziroeda/common/widgets/wx_combobox.js';
import { GERBER_DRAWLAYERS_COUNT } from '@ziroeda/common/layer_id.js';
import {
  COPPER_LAYERS_COUNT_CHOICES,
  type DIALOG_MAP_GERBER_LAYERS_TO_PCB,
  mappedLayerSizingLabels,
} from './dialog_map_gerber_layers_to_pcb.js';

const COMBO_OPTIONS = COPPER_LAYERS_COUNT_CHOICES.map((label, i) => ({ value: String(i), label }));

export function DialogMapGerberLayersToPcb({
  dlg,
  onClose,
}: {
  /** Already through initDialog. */
  dlg: DIALOG_MAP_GERBER_LAYERS_TO_PCB;
  /** wxID_OK once TransferDataFromWindow allowed it, or wxID_CANCEL. */
  onClose: (aOk: boolean) => void;
}): JSX.Element {
  // The engine is the state; a handler that changed it asks for a repaint.
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const [goodWidth, setGoodWidth] = useState<number | undefined>(undefined);
  const firstMapped = useRef<HTMLSpanElement>(null);

  useModalEscape(() => onClose(false));

  // `goodSize` (`:182-194`): the first mapped-layer text measured against
  // every label it could take, and that width given to all of them.
  useLayoutEffect(() => {
    const el = firstMapped.current;

    if (!el) return;

    let width = 0;

    for (const label of mappedLayerSizingLabels())
      width = Math.max(width, measureTextWidth(label, el));

    if (width > 0) setGoodWidth(width);
  }, []);

  const ok = (): void => {
    if (dlg.TransferDataFromWindow()) onClose(true);
  };

  const row = (ii: number): JSX.Element[] => {
    const labels = dlg.m_layerLabels[ii]!;
    const mapped = dlg.m_layersList[ii]!;

    return [
      <span key={`l${ii}`} className="ze-mapgbr-cell">
        {labels.layer}
      </span>,
      <span key={`f${ii}`} className="ze-mapgbr-cell">
        {labels.fileName}
      </span>,
      <button
        key={`b${ii}`}
        type="button"
        className="ze-btn ze-btn-exactfit ze-mapgbr-select"
        onClick={() => {
          void dlg.OnSelectLayer(ii).then(refresh);
        }}
      >
        ...
      </button>,
      <span
        key={`t${ii}`}
        ref={ii === 0 ? firstMapped : undefined}
        className={`ze-mapgbr-cell ze-mapgbr-layer ${mapped.colour}`}
        style={goodWidth === undefined ? undefined : { minWidth: goodWidth }}
      >
        {mapped.label}
      </span>,
    ];
  };

  const half = GERBER_DRAWLAYERS_COUNT / 2;
  const count = dlg.m_gerberActiveLayersCount;
  const left: JSX.Element[] = [];
  const right: JSX.Element[] = [];

  for (let ii = 0; ii < count; ii++) (ii < half ? left : right).push(...row(ii));

  return (
    <div className="ze-modal-backdrop">
      <div
        className="ze-modal ze-mapgbr"
        role="dialog"
        aria-modal="true"
        aria-label="Layer Selection"
      >
        <div className="ze-modal-header">Layer Selection</div>
        <div className="ze-mapgbr-upper">
          <div className="ze-mapgbr-selection">
            <span className="ze-mapgbr-cell">Layer selection:</span>
            <div className="ze-mapgbr-list">
              <span className="ze-mapgbr-indent" />
              <div className="ze-mapgbr-grid">{left}</div>
              {dlg.m_staticlineSepShown && <div className="ze-mapgbr-vline" />}
              <div className="ze-mapgbr-grid">{right}</div>
            </div>
          </div>
          <div className="ze-mapgbr-right">
            <span className="ze-mapgbr-lyrcnt-label">Copper layers count:</span>
            <Combo
              className="ze-mapgbr-lyrcnt"
              ariaLabel="Copper layers count:"
              value={String(dlg.m_comboCopperLayersCount)}
              options={COMBO_OPTIONS}
              onChange={(v) => {
                dlg.OnBrdLayersCountSelection(Number(v));
                refresh();
              }}
            />
            <span className="ze-mapgbr-stretch" />
            <Button
              label="Store Choice"
              className="ze-mapgbr-button"
              onClick={() => {
                dlg.OnStoreSetup();
                refresh();
              }}
            />
            <Button
              label="Get Stored Choice"
              disabled={!dlg.m_buttonRetrieveEnabled}
              className="ze-mapgbr-button"
              onClick={() => {
                dlg.OnGetSetup();
                refresh();
              }}
            />
            <Button
              label="Reset"
              className="ze-mapgbr-button"
              onClick={() => {
                dlg.OnResetClick();
                refresh();
              }}
            />
          </div>
        </div>
        <StdDialogButtons onCancel={() => onClose(false)} onOk={ok} />
      </div>
    </div>
  );
}
