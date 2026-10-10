// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_UNUSED_PAD_LAYERS's window (dialog_unused_pad_layers_base.cpp): the
 * four checkboxes beside the illustration, then Restore All Layers (Apply),
 * Cancel and Remove Unused Layers (OK).
 */
import { type JSX, useState } from 'react';
import { KiBitmapBundle } from '@ziroeda/common/bitmap.js';
import { DialogShim, StdDialogButtons } from '@ziroeda/common/dialog_shim.js';
import type { DIALOG_UNUSED_PAD_LAYERS } from './dialog_unused_pad_layers.js';

type Box = 'm_cbVias' | 'm_cbPads' | 'm_cbSelectedOnly' | 'm_cbPreserveExternalLayers';

export function DialogUnusedPadLayers({
  dialog,
  onClose,
}: {
  dialog: DIALOG_UNUSED_PAD_LAYERS;
  onClose: () => void;
}): JSX.Element {
  const [, setTick] = useState(0);

  const box = (key: Box, label: string, cls: string): JSX.Element => (
    <label className={`ze-check ${cls}`}>
      <input
        type="checkbox"
        checked={dialog[key]}
        onChange={(e) => {
          dialog[key] = e.target.checked;
          setTick((t) => t + 1);
        }}
      />
      {label}
    </label>
  );

  return (
    <DialogShim title="Remove Unused Pads" onClose={onClose} className="ze-unusedpads">
      <div className="ze-modal-body ze-unusedpads-body">
        <div className="ze-unusedpads-boxes">
          {box('m_cbVias', 'Vias', 'all5')}
          {box('m_cbPads', 'Pads', 'brl5')}
          <span className="ze-unusedpads-gap" />
          {box('m_cbSelectedOnly', 'Selected only', 'bl5')}
          {box('m_cbPreserveExternalLayers', 'Keep outside layers', 'l5')}
        </div>
        <div className="ze-unusedpads-preview">
          <img alt="" src={KiBitmapBundle(dialog.GetImage())} />
        </div>
      </div>
      <StdDialogButtons
        okLabel="Remove Unused Layers"
        onOk={() => {
          dialog.OnOK();
          onClose();
        }}
        onApply={() => {
          dialog.OnApply();
          onClose();
        }}
        applyLabel="Restore All Layers"
        onCancel={onClose}
      />
    </DialogShim>
  );
}
