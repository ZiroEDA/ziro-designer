// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_CLEANUP_GRAPHICS's window (dialog_cleanup_graphics_base.cpp): the
 * options, the net-tie hint and the pad merge in the footprint editor, the
 * board-outline fix and its tolerance on a board, then "Changes to be
 * applied:" and OK / Cancel.
 */
import { type JSX, useEffect, useState, useSyncExternalStore } from 'react';
import { DialogShim, StdDialogButtons } from '@ziroeda/common/dialog_shim.js';
import { unitLabel } from '@ziroeda/common/eda_units.js';
import { RcTreeView } from '@ziroeda/common/widgets/rc_tree_view.js';
import type { DIALOG_CLEANUP_GRAPHICS } from './dialog_cleanup_graphics.js';

export function DialogCleanupGraphics({
  dialog,
  onClose,
}: {
  dialog: DIALOG_CLEANUP_GRAPHICS;
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

  useEffect(() => {
    dialog.TransferDataToWindow();
  }, [dialog]);

  const opt = (
    key: 'm_createRectanglesOpt' | 'm_deleteRedundantOpt' | 'm_mergePadsOpt' | 'm_fixBoardOutlines',
    label: string,
    cls: string,
  ): JSX.Element => (
    <label className={`ze-check ${cls}`}>
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

  const fpEditor = dialog.m_isFootprintEditor;

  return (
    <DialogShim title="Cleanup Graphics" onClose={onClose} className="ze-cleanupgfx">
      <div className="ze-modal-body ze-cleanupgfx-body">
        <div className="ze-cleanupgfx-upper">
          {opt('m_createRectanglesOpt', 'Merge lines into rectangles', 'all5')}
          {opt('m_deleteRedundantOpt', 'Delete redundant graphics', 'all5')}
          {fpEditor && opt('m_mergePadsOpt', 'Merge overlapping graphics into pads', 'trl5')}
          {fpEditor && (
            <div className="ze-cleanupgfx-hint">
              (Pads which appear in a Net Tie pad group will not be considered for merging.)
            </div>
          )}
          {!fpEditor && opt('m_fixBoardOutlines', 'Fix discontinuities in board outlines', 'all5')}
          {!fpEditor && (
            <div className="ze-cleanupgfx-tolerance">
              <label className="lbl" htmlFor="ze-cleanupgfx-tol">
                {dialog.m_tolerance.GetLabel()}
              </label>
              <input
                id="ze-cleanupgfx-tol"
                className="ze-search"
                value={dialog.m_tolerance.GetText()}
                onChange={(e) => dialog.SetToleranceText(e.target.value)}
                onBlur={() => dialog.OnCheckBox()}
              />
              <span className="unit">{unitLabel(dialog.m_tolerance.GetUnits())}</span>
            </div>
          )}
        </div>
        <div className="ze-cleanupgfx-lower">
          <div className="ze-cleanup-label">Changes to be applied:</div>
          <RcTreeView
            model={dialog.m_changesTreeModel}
            view={dialog.m_changesView}
            onDoubleClick={(node) => dialog.OnSelectItem(node)}
            testId="cleanupgfx-changes"
          />
        </div>
      </div>
      <StdDialogButtons
        okLabel={dialog.GetOKLabel()}
        onOk={() => {
          if (dialog.TransferDataFromWindow()) onClose();
        }}
        onCancel={onClose}
      />
    </DialogShim>
  );
}
