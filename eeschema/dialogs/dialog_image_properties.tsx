// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Image properties. Counterparts:
 * `eeschema/dialogs/dialog_image_properties.cpp` (DIALOG_IMAGE_PROPERTIES,
 * which contributes the position) wrapped around
 * `common/dialogs/panel_image_editor.cpp` (PANEL_IMAGE_EDITOR: the preview,
 * the scale, the resolution readout and Convert to Greyscale).
 *
 * PANEL_IMAGE_EDITOR::CheckValues is the reason the scale is validated rather
 * than merely parsed: a scale that leaves the image under 15 pixels makes it
 * effectively impossible to find on the canvas, and one over 6000 pixels is
 * accepted only after a confirmation, since that is 20 inches of paper.
 */
import { CheckValues, PANEL_IMAGE_EDITOR } from '@ziroeda/common/dialogs/panel_image_editor.js';
import { MessageDialogError, MessageDialogYesNo } from '@ziroeda/common/dialogs/dialog_message.js';
import { useState, type JSX } from 'react';
import { iuToMM, mmToIU } from '@ziroeda/common';
import { useModalEscape } from '@ziroeda/common/dialog_shim.js';

export interface ImagePropsResult {
  at: { x: number; y: number };
  scale: number;
  /** Set when Convert to Greyscale replaced the payload. */
  data?: string;
}

interface Props {
  at: { x: number; y: number };
  scale: number;
  /** Base64 PNG payload, shown in the preview and rewritten by greyscale. */
  data: string;
  /** The image's own resolution (BITMAP_BASE::GetPPI), shown read-only. */
  ppi: number;
  pixelSize: { w: number; h: number };
  onOk: (r: ImagePropsResult) => void;
  onCancel: () => void;
}

export function DialogImageProperties({
  at,
  scale: scale0,
  data: data0,
  ppi,
  pixelSize,
  onOk,
  onCancel,
}: Props): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts.
  useModalEscape(onCancel);

  const [x, setX] = useState(String(iuToMM(at.x)));
  const [y, setY] = useState(String(iuToMM(at.y)));
  const [scale, setScale] = useState(String(scale0));
  const [data, setData] = useState(data0);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const accept = (sc: number): void =>
    onOk({
      at: { x: mmToIU(Number(x) || 0), y: mmToIU(Number(y) || 0) },
      scale: sc,
      ...(data !== data0 ? { data } : {}),
    });
  /** TransferDataFromWindow: PANEL_IMAGE_EDITOR::CheckValues first. */
  const submit = (): void => {
    const s = Number(scale);
    const r = CheckValues(Number.isFinite(s) ? s : -1, { x: pixelSize.w, y: pixelSize.h });
    if (r && 'error' in r) setError(r.error);
    else if (r) setConfirm(r.confirm);
    else accept(s);
  };

  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      <div className="ze-modal ze-label-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Image Properties
          <span className="x" title="Cancel" onClick={onCancel}>
            ✕
          </span>
        </div>
        <div
          className="ze-label-dialog-body"
          style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
        >
          {/* PANEL_IMAGE_EDITOR (common/dialogs), as DIALOG_IMAGE_PROPERTIES embeds it. */}
          <PANEL_IMAGE_EDITOR
            data={data}
            scaleText={scale}
            onScaleText={setScale}
            ppi={ppi}
            onGreyscale={setData}
          />
          <label className="row">
            <span>Position X:</span>
            <input
              className="ze-search"
              style={{ width: 90 }}
              value={x}
              onChange={(e) => setX(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
            <span className="ze-muted">mm</span>
          </label>
          <label className="row">
            <span>Position Y:</span>
            <input
              className="ze-search"
              style={{ width: 90 }}
              value={y}
              onChange={(e) => setY(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') submit();
              }}
            />
            <span className="ze-muted">mm</span>
          </label>
        </div>
        {error && <MessageDialogError message={error} onClose={() => setError(null)} />}
        {confirm && (
          // IsOK( host, msg ) (confirm.cpp:278-298).
          <MessageDialogYesNo
            caption="Confirmation"
            icon="question"
            defaultButton="yes"
            message={confirm}
            onResult={(r) => {
              setConfirm(null);
              if (r === 'yes') accept(Number(scale));
            }}
          />
        )}
        <div className="ze-modal-footer">
          <button className="ze-btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="ze-btn primary" onClick={submit}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
