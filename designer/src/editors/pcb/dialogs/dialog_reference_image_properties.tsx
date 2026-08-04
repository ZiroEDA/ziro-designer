// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Reference image properties.
 * Counterpart: `pcbnew/dialogs/dialog_reference_image_properties.cpp`, plus the
 * scale half of `common/dialogs/panel_image_editor.cpp`.
 *
 * The decisions live in `pcbnew/src/image_properties.ts`; this is layout.
 *
 * The one thing worth knowing while reading it: **width, height and scale are
 * the same number three times**. The item stores only a scale, so typing in any
 * of the three fields rewrites the scale and the other two follow. Upstream has
 * to reach for `ChangeDoubleValue` to stop the three controls firing each
 * other's handlers; here each keystroke is one call into a pure function that
 * returns all three at once, so there is no loop to break.
 *
 * The size fields are shown *derived*: they display whatever the last
 * computation produced rather than the raw text, except for the field currently
 * being typed in — otherwise a half-typed "1" reformats itself under the caret.
 *
 * Left out: KiCad's greyscale conversion, which rewrites the pixels. Our model
 * holds the PNG as it was read, and converting would mean decode/recolour/
 * re-encode in a place where nothing else touches a raster — for an effect
 * anyone can get before importing.
 */

import { useState, type JSX } from 'react';
import { pcbIuToMM, pcbMmToIU } from '@ziroeda/common/src/eda_units.js';
import {
  scaleForHeight,
  scaleForWidth,
  sizeForScale,
  type ImageValues,
} from '@ziroeda/pcbnew/src/image_properties.js';
import type { PcbImage } from '@ziroeda/pcbnew/src/types.js';

interface Props {
  image: PcbImage;
  initial: ImageValues;
  layers: readonly string[];
  onApply: (v: ImageValues) => void;
  onClose: () => void;
}

export function DialogReferenceImageProperties({
  image,
  initial,
  layers,
  onApply,
  onClose,
}: Props): JSX.Element {
  const [v, setV] = useState<ImageValues>(initial);
  // The raw text of whichever field has the caret, so it is not reformatted
  // out from under the typist.
  const [typing, setTyping] = useState<{ key: string; text: string } | null>(null);
  const set = (patch: Partial<ImageValues>): void => setV((p) => ({ ...p, ...patch }));

  const shown = (key: string, value: string): string => (typing?.key === key ? typing.text : value);

  /** A position field: plain mm, no coupling to anything. */
  const posField = (label: string, key: 'x' | 'y'): JSX.Element => (
    <label>
      <span className="ze-tvp-label">{label}</span>
      <input
        type="text"
        className="ze-tvp-input"
        value={shown(key, String(pcbIuToMM(v[key])))}
        onChange={(e) => {
          setTyping({ key, text: e.target.value });
          const n = Number(e.target.value);
          if (Number.isFinite(n)) set({ [key]: pcbMmToIU(n) } as Partial<ImageValues>);
        }}
        onBlur={() => setTyping(null)}
      />
      <span className="ze-tvp-unit">mm</span>
    </label>
  );

  /**
   * A size field. Typing here rewrites the *scale*, so the other size field and
   * the scale field both move — there is no independent stretch, because the
   * model has one scale factor rather than two.
   */
  const sizeField = (label: string, key: 'width' | 'height'): JSX.Element => (
    <label>
      <span className="ze-tvp-label">{label}</span>
      <input
        type="text"
        className="ze-tvp-input"
        value={shown(key, String(pcbIuToMM(v[key])))}
        onChange={(e) => {
          setTyping({ key, text: e.target.value });
          const n = Number(e.target.value);
          if (!Number.isFinite(n)) return;
          const iu = pcbMmToIU(n);
          setV((p) =>
            key === 'width' ? scaleForWidth(image, p, iu) : scaleForHeight(image, p, iu),
          );
        }}
        onBlur={() => setTyping(null)}
      />
      <span className="ze-tvp-unit">mm</span>
    </label>
  );

  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div className="ze-modal ze-graphic-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Reference Image Properties
          <span className="x" onClick={onClose}>
            ✕
          </span>
        </div>

        <div className="ze-modal-body ze-update-pcb-body ze-tvp-body">
          <fieldset>
            <legend>Position</legend>
            <div className="ze-tvp-row">
              {posField('Position X:', 'x')}
              {posField('Position Y:', 'y')}
            </div>
            <label>
              <span className="ze-tvp-label">Layer:</span>
              <select
                className="ze-tvp-select"
                value={v.layer}
                onChange={(e) => set({ layer: e.target.value })}
              >
                {layers.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={v.locked}
                onChange={(e) => set({ locked: e.target.checked })}
              />
              Locked
            </label>
          </fieldset>

          <fieldset>
            <legend>Size</legend>
            <label>
              <span className="ze-tvp-label">Scale:</span>
              <input
                type="text"
                className="ze-tvp-input"
                value={shown('scale', String(v.scale))}
                onChange={(e) => {
                  setTyping({ key: 'scale', text: e.target.value });
                  const n = Number(e.target.value);
                  if (Number.isFinite(n)) setV((p) => sizeForScale(image, p, n));
                }}
                onBlur={() => setTyping(null)}
              />
            </label>
            {/* Both driven by the scale: typing one rewrites it and moves the
                other, since the aspect ratio is fixed by the model. */}
            <div className="ze-tvp-row">
              {sizeField('Width:', 'width')}
              {sizeField('Height:', 'height')}
            </div>
          </fieldset>
        </div>

        <div className="ze-modal-footer">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={() => onApply(v)}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
