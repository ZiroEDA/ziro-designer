// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Barcode properties.
 * Counterpart: `pcbnew/dialogs/dialog_barcode_properties.cpp` and its `_base`.
 *
 * The decisions live in `pcbnew/src/barcode_properties.ts`; this is layout,
 * plus the live preview — which is not decoration. A barcode is the one item
 * whose appearance the user cannot predict from the fields: the symbology and
 * the text together decide the version, and a string one character too long
 * jumps the symbol a size. Upstream gives the dialog a whole
 * `PCB_DRAW_PANEL_GAL` for it (`prepareCanvas`, :184-206), autozoomed to the
 * polygon with a 0.7 margin, and redrawn on every keystroke.
 *
 * The layout is `_base`'s: a text field across the top, three checkboxes down
 * the left, a two-column grid of position/size/orientation/text/margins, the
 * Code and Error Correction radio boxes in the right-hand column of that grid,
 * and the preview beside all of it.
 */

import { useEffect, useRef, useState, type JSX } from 'react';
import { pcbIuToMM, pcbMmToIU } from '@ziroeda/common/src/eda_units.js';
import {
  BARCODE_ECC_CHOICES,
  BARCODE_KIND_CHOICES,
  applyBarcodeValues,
  barcodeCommitError,
  barcodeUiState,
  correctEccForKind,
  type BarcodeValues,
} from '@ziroeda/pcbnew/src/barcode_properties.js';
import { barcodeGeometry } from '@ziroeda/pcbnew/src/barcode_geometry.js';
import type { PcbBarcode } from '@ziroeda/pcbnew/src/types.js';
import { Combo } from '../../../ui/Combo.js';
import { useModalEscape } from '../../../ui/useModalEscape.js';

interface Props {
  /** The item being edited, for the fields the dialog does not own. */
  barcode: PcbBarcode;
  initial: BarcodeValues;
  layers: readonly string[];
  /** The layer colours, so the preview is drawn in the one it will be. */
  layerColor: (layer: string) => string;
  background: string;
  onApply: (v: BarcodeValues) => void;
  onClose: () => void;
}

/**
 * `refreshPreview` (`:322-343`): autozoom to the polygon's bounding box, then
 * `SetScale( GetScale() * 0.7 )` for a margin, centred on the item's position.
 */
function drawPreview(
  canvas: HTMLCanvasElement,
  barcode: PcbBarcode,
  v: BarcodeValues,
  ink: string,
  background: string,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, w, h);

  const g = barcodeGeometry(applyBarcodeValues(barcode, v));
  if (g.poly.length === 0) return;

  const bw = g.bbox.x2 - g.bbox.x1;
  const bh = g.bbox.y2 - g.bbox.y1;
  if (bw <= 0 || bh <= 0) return;

  // `SetViewport( BOX2D( bbI.GetOrigin(), bbI.GetSize() ) )` fits the box, and
  // the 0.7 is upstream's margin.
  const scale = Math.min(w / bw, h / bh) * 0.7;
  const cx = (g.bbox.x1 + g.bbox.x2) / 2;
  const cy = (g.bbox.y1 + g.bbox.y2) / 2;

  ctx.setTransform(scale, 0, 0, scale, w / 2 - cx * scale, h / 2 - cy * scale);
  ctx.fillStyle = ink;
  ctx.beginPath();
  for (const rings of g.poly) {
    for (const ring of rings) {
      if (ring.length < 3) continue;
      ctx.moveTo(ring[0]!.x, ring[0]!.y);
      for (let i = 1; i < ring.length; i++) ctx.lineTo(ring[i]!.x, ring[i]!.y);
      ctx.closePath();
    }
  }
  ctx.fill('nonzero');
}

export function DialogBarcodeProperties({
  barcode,
  initial,
  layers,
  layerColor,
  background,
  onApply,
  onClose,
}: Props): JSX.Element {
  useModalEscape(onClose);

  const [v, setV] = useState<BarcodeValues>(initial);
  const [typing, setTyping] = useState<{ key: string; text: string } | null>(null);
  const [error, setError] = useState('');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // `OnValuesChanged` → `transferDataToBarcode` → `refreshPreview` on every
  // change, including every keystroke in the text field (`OnTextValueChanged`).
  useEffect(() => {
    const c = canvasRef.current;
    if (c) drawPreview(c, barcode, v, layerColor(v.layer), background);
  }, [barcode, v, layerColor, background]);

  const ui = barcodeUiState(v);
  const set = (patch: Partial<BarcodeValues>): void =>
    setV((p) => correctEccForKind({ ...p, ...patch }));

  const shown = (key: string, value: string): string => (typing?.key === key ? typing.text : value);

  /** A millimetre field: `UNIT_BINDER`'s `ChangeValue` / `GetIntValue` pair. */
  const mmField = (
    label: string,
    key: string,
    value: number,
    apply: (iu: number) => void,
    enabled = true,
  ): JSX.Element => (
    <label>
      <span className="ze-tvp-label">{label}</span>
      <input
        type="text"
        className="ze-tvp-input"
        disabled={!enabled}
        value={shown(key, String(pcbIuToMM(value)))}
        onChange={(e) => {
          setTyping({ key, text: e.target.value });
          const n = Number(e.target.value);
          if (Number.isFinite(n)) apply(pcbMmToIU(n));
        }}
        onBlur={() => setTyping(null)}
      />
      <span className="ze-tvp-unit">mm</span>
    </label>
  );

  const ok = (): void => {
    const message = barcodeCommitError(barcode, v);
    if (message) {
      setError(message);
      return;
    }
    onApply(v);
  };

  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div className="ze-modal ze-barcode-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Barcode Properties
          <span className="x" onClick={onClose}>
            ✕
          </span>
        </div>

        <div className="ze-modal-body ze-tvp-body">
          <label className="ze-barcode-text">
            <span className="ze-tvp-label">Text:</span>
            <input
              type="text"
              className="ze-tvp-input"
              value={v.text}
              onChange={(e) => set({ text: e.target.value })}
            />
          </label>

          <div className="ze-barcode-columns">
            <div className="ze-barcode-checks">
              <label>
                <input
                  type="checkbox"
                  checked={v.locked}
                  onChange={(e) => set({ locked: e.target.checked })}
                />
                Locked
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={v.knockout}
                  onChange={(e) => set({ knockout: e.target.checked })}
                />
                Knockout
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={v.showText}
                  onChange={(e) => set({ showText: e.target.checked })}
                />
                Show text
              </label>
            </div>

            <div className="ze-barcode-grid">
              <label>
                <span className="ze-tvp-label">Layer:</span>
                <Combo
                  value={v.layer}
                  options={layers.map((l) => ({ value: l, label: l, swatch: layerColor(l) }))}
                  onChange={(layer) => set({ layer })}
                />
              </label>
              {mmField('Position X:', 'x', v.at.x, (iu) => set({ at: { ...v.at, x: iu } }))}
              {mmField('Position Y:', 'y', v.at.y, (iu) => set({ at: { ...v.at, y: iu } }))}
              {mmField('Size X:', 'w', v.width, (iu) => set({ width: iu }))}
              {mmField('Size Y:', 'h', v.height, (iu) => set({ height: iu }))}
              <label>
                <span className="ze-tvp-label">Orientation:</span>
                <input
                  type="text"
                  className="ze-tvp-input"
                  value={shown('angle', String(v.angle))}
                  onChange={(e) => {
                    setTyping({ key: 'angle', text: e.target.value });
                    const n = Number(e.target.value);
                    if (Number.isFinite(n)) set({ angle: n });
                  }}
                  onBlur={() => setTyping(null)}
                />
                <span className="ze-tvp-unit">deg</span>
              </label>
              {mmField(
                'Text size:',
                'ts',
                v.textHeight,
                (iu) => set({ textHeight: iu }),
                ui.textSizeEnabled,
              )}
              {mmField(
                'Min margin X:',
                'mx',
                v.margin.x,
                (iu) => set({ margin: { ...v.margin, x: iu } }),
                ui.marginsEnabled,
              )}
              {mmField(
                'Min margin Y:',
                'my',
                v.margin.y,
                (iu) => set({ margin: { ...v.margin, y: iu } }),
                ui.marginsEnabled,
              )}
            </div>

            <div className="ze-barcode-radios">
              <fieldset>
                <legend>Code</legend>
                {BARCODE_KIND_CHOICES.map((c) => (
                  <label key={c.value}>
                    <input
                      type="radio"
                      name="ze-barcode-kind"
                      checked={v.kind === c.value}
                      onChange={() => set({ kind: c.value })}
                    />
                    {c.label}
                  </label>
                ))}
              </fieldset>
              <fieldset disabled={!ui.eccEnabled}>
                <legend>Error Correction</legend>
                {BARCODE_ECC_CHOICES.map((c) => (
                  <label key={c.value}>
                    <input
                      type="radio"
                      name="ze-barcode-ecc"
                      disabled={c.value === 'H' && !ui.eccHEnabled}
                      checked={v.ecc === c.value}
                      onChange={() => set({ ecc: c.value })}
                    />
                    {c.label}
                  </label>
                ))}
              </fieldset>
            </div>

            <canvas ref={canvasRef} className="ze-barcode-preview" width={260} height={260} />
          </div>

          {/* `wxMessageBox( m_dummyBarcode->GetLastError(), _( "Barcode Error" ) )` —
              shown on OK rather than while typing, so a half-entered string is
              not nagged about. */}
          {error ? <div className="ze-barcode-error">{error}</div> : null}
        </div>

        <div className="ze-modal-footer">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={ok}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
