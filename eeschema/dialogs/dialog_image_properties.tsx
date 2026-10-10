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
import { Button } from '@ziroeda/common/wx/controls.js';
import { CheckValues, PANEL_IMAGE_EDITOR } from '@ziroeda/common/dialogs/panel_image_editor.js';
import { MessageDialogError, MessageDialogYesNo } from '@ziroeda/common/dialogs/dialog_message.js';
import { useState, type JSX } from 'react';
import { iuToMM, mmToIU } from '@ziroeda/common';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { SCH_COMMIT } from '../sch_commit.js';
import type { SCH_BITMAP } from '../sch_bitmap.js';
import type { SCH_EDIT_FRAME } from '../sch_edit_frame.js';

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
    <DialogShim title="Image Properties" onClose={onCancel} className="ze-label-dialog">
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
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
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
        <Button label="Cancel" onClick={onCancel} />
        <Button label="OK" isDefault onClick={submit} />
      </div>
    </DialogShim>
  );
}

const toBase64 = (aBytes: Uint8Array): string => {
  let bin = '';
  for (const b of aBytes) bin += String.fromCharCode(b);
  return btoa(bin);
};

const fromBase64 = (aText: string): Uint8Array =>
  Uint8Array.from(atob(aText), (c) => c.charCodeAt(0));

/**
 * `DIALOG_IMAGE_PROPERTIES` (eeschema/dialogs/dialog_image_properties.cpp), the model half: the
 * live bitmap's position and its PANEL_IMAGE_EDITOR values (TransferDataToWindow), and the
 * SCH_COMMIT its OK makes (TransferDataFromWindow). The editor works on the image's PNG, so the
 * bitmap is shown as one and read back from one when greyscale changed it.
 */
export class DIALOG_IMAGE_PROPERTIES {
  private readonly m_frame: SCH_EDIT_FRAME;
  private readonly m_bitmap: SCH_BITMAP;

  constructor(aParent: SCH_EDIT_FRAME, aBitmap: SCH_BITMAP) {
    this.m_frame = aParent;
    this.m_bitmap = aBitmap;
  }

  /** `TransferDataToWindow()`. */
  TransferDataToWindow(): {
    at: { x: number; y: number };
    scale: number;
    data: string;
    ppi: number;
    pixelSize: { w: number; h: number };
  } {
    const image = this.m_bitmap.GetReferenceImage().GetImage();
    const pixels = image.GetImageData();
    const png = pixels?.SaveFilePng() ?? null;

    return {
      at: { ...this.m_bitmap.GetPosition() },
      scale: this.m_bitmap.GetImageScale(),
      data: png ? toBase64(png) : '',
      ppi: image.GetPPI(),
      pixelSize: { w: pixels?.GetWidth() ?? 0, h: pixels?.GetHeight() ?? 0 },
    };
  }

  /** `TransferDataFromWindow()`. */
  TransferDataFromWindow(aResult: ImagePropsResult): boolean {
    const refImage = this.m_bitmap.GetReferenceImage();
    const commit = new SCH_COMMIT(this.m_frame);

    // Save old image in undo list if not already in edit
    if (this.m_bitmap.GetEditFlags() === 0) commit.Modify(this.m_bitmap, this.m_frame.GetScreen());

    // Update our bitmap from the editor
    refImage.SetImageScale(aResult.scale);

    if (aResult.data !== undefined) refImage.MutableImage().ReadImageFile(fromBase64(aResult.data));

    this.m_bitmap.SetPosition({ x: aResult.at.x, y: aResult.at.y });

    if (!commit.Empty()) commit.Push('Image Properties');

    return true;
  }
}
