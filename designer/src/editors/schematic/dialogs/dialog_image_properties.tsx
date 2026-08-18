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
import { useEffect, useRef, useState, type JSX } from 'react';
import { iuToMM, mmToIU } from '@ziroeda/common';
import { imageDataUrl } from '@ziroeda/eeschema/src/import_gfx/image_format.js';
import { useModalEscape } from '../../../ui/useModalEscape.js';

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

/** MIN_SIZE / MAX_SIZE from PANEL_IMAGE_EDITOR::CheckValues, in pixels. */
const MIN_SIZE = 15;
const MAX_SIZE = 6000;

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
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // The preview, which is also what greyscale reads back out of.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const img = new Image();
    img.onload = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const k = Math.min(canvas.width / img.naturalWidth, canvas.height / img.naturalHeight, 1);
      const w = img.naturalWidth * k;
      const h = img.naturalHeight * k;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
    };
    img.src = imageDataUrl(data);
  }, [data]);

  /**
   * ConvertToGreyscale. Upstream converts the decoded bitmap in place; here the
   * payload itself is re-encoded, since that is what the document stores.
   */
  const toGreyscale = (): void => {
    const img = new Image();
    img.onload = () => {
      const work = document.createElement('canvas');
      work.width = img.naturalWidth;
      work.height = img.naturalHeight;
      const ctx = work.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      const pixels = ctx.getImageData(0, 0, work.width, work.height);
      const d = pixels.data;
      for (let i = 0; i < d.length; i += 4) {
        // wxImage::ConvertToGreyscale's default luminance weights.
        const l = 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!;
        d[i] = l;
        d[i + 1] = l;
        d[i + 2] = l;
      }
      ctx.putImageData(pixels, 0, 0);
      setData(work.toDataURL('image/png').replace(/^data:image\/png;base64,/, ''));
    };
    img.src = imageDataUrl(data);
  };

  const submit = (): void => {
    const s = Number(scale);
    if (!Number.isFinite(s) || s < 0) {
      setError('Scale must be a positive number.');
      return;
    }
    const min = Math.min(pixelSize.w * s, pixelSize.h * s);
    if (min < MIN_SIZE) {
      const mm = ((25.4 / 300) * min).toFixed(2);
      const mils = ((1000 / 300) * min).toFixed(1);
      setError(`This scale results in an image which is too small (${mm} mm or ${mils} mil).`);
      return;
    }
    const max = Math.max(pixelSize.w * s, pixelSize.h * s);
    if (max > MAX_SIZE) {
      const mm = ((25.4 / 300) * max).toFixed(1);
      const inch = (max / 300).toFixed(2);
      if (
        !window.confirm(
          `This scale results in an image which is very large (${mm} mm or ${inch} in). Are you sure?`,
        )
      )
        return;
    }
    onOk({
      at: { x: mmToIU(Number(x) || 0), y: mmToIU(Number(y) || 0) },
      scale: s,
      ...(data !== data0 ? { data } : {}),
    });
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
          {error && (
            <div className="ze-props-error" onClick={() => setError(null)}>
              {error} Click to dismiss.
            </div>
          )}

          <canvas
            ref={canvasRef}
            width={260}
            height={180}
            style={{
              alignSelf: 'center',
              border: '1px solid var(--chrome-border)',
              borderRadius: 4,
              background: '#fff',
            }}
          />

          <label className="row">
            <span>Scale:</span>
            <input
              className="ze-search"
              style={{ width: 90 }}
              value={scale}
              onChange={(e) => setScale(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
          </label>
          <label className="row">
            <span>PPI:</span>
            <span className="ze-cell-ro">{ppi}</span>
          </label>
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
          <div className="row">
            <button className="ze-btn" onClick={toGreyscale}>
              Convert to Greyscale
            </button>
          </div>
        </div>
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
