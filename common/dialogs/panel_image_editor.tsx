// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_IMAGE_EDITOR` (common/dialogs/panel_image_editor.cpp) with its
 * `_base` folded in: the panel both image-properties dialogs embed - the
 * schematic's DIALOG_IMAGE_PROPERTIES and the board's
 * DIALOG_REFERENCE_IMAGE_PROPERTIES.
 *
 * `bSizerLeft` is horizontal: `m_panelDraw`, the 300 x 300 preview
 * (wxEXPAND|wxALL 5, wxBORDER_SIMPLE), then `gbSizer1`, a wxGridBagSizer( 5, 5 )
 * at wxEXPAND|wxALL 10 holding Scale at (0,0)-(0,1), PPI at (1,0)-(1,1) and
 * Convert to Greyscale at (4,0) spanning two columns.
 *
 * The host dialog owns the values: this panel shows the scale text it is
 * given, the image's PPI, and hands back a greyscale payload. `CheckValues`
 * is upstream's validation, which the host runs on OK
 * (`TransferDataFromWindow`).
 */
import type { JSX } from 'react';

/** MIN_SIZE / MAX_SIZE (panel_image_editor.cpp:71-72), in pixels after scaling. */
export const MIN_SIZE = 15; // Min size in pixels after scaling (50 mils)
export const MAX_SIZE = 6000; // Max size in pixels after scaling (20 inches)

/**
 * `CheckValues`: an error (DisplayErrorMessage, and OK is refused), a question
 * (IsOK: the scale is very large - proceed only on yes), or nothing. The image
 * definition is 300 ppi in the drawing routines, which is where the mm / mil /
 * inch figures come from.
 */
export function CheckValues(
  aScale: number,
  aSizePixels: { x: number; y: number },
): { error: string } | { confirm: string } | null {
  // Test number correctness
  if (!(aScale >= 0)) return { error: 'Scale must be a positive number.' };

  // Test value correctness
  const size_min = Math.trunc(Math.min(aSizePixels.x * aScale, aSizePixels.y * aScale));

  // if the size is too small, the image will be hard to locate
  if (size_min < MIN_SIZE) {
    return {
      error: `This scale results in an image which is too small (${((25.4 / 300) * size_min).toFixed(2)} mm or ${((1000.0 / 300.0) * size_min).toFixed(1)} mil).`,
    };
  }

  const size_max = Math.trunc(Math.max(aSizePixels.x * aScale, aSizePixels.y * aScale));

  if (size_max > MAX_SIZE) {
    // the actual size is 25.4/300 * size_max in mm
    return {
      confirm: `This scale results in an image which is very large (${((25.4 / 300) * size_max).toFixed(1)} mm or ${(size_max / 300.0).toFixed(2)} in). Are you sure?`,
    };
  }

  return null;
}

/**
 * `OnGreyScaleConvert`: `m_workingImage->ConvertToGreyscale()`, which is
 * wxImage's with its default weights (0.299, 0.587, 0.114). The payload is
 * re-encoded, since the document stores the file, not the decoded bitmap.
 */
export function ConvertToGreyscale(aPngBase64: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const work = document.createElement('canvas');
      work.width = img.naturalWidth;
      work.height = img.naturalHeight;
      const ctx = work.getContext('2d');
      if (!ctx) {
        reject(new Error('no 2D context'));
        return;
      }
      ctx.drawImage(img, 0, 0);
      const pixels = ctx.getImageData(0, 0, work.width, work.height);
      const d = pixels.data;
      for (let i = 0; i < d.length; i += 4) {
        const l = 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!;
        d[i] = l;
        d[i + 1] = l;
        d[i + 2] = l;
      }
      ctx.putImageData(pixels, 0, 0);
      resolve(work.toDataURL('image/png').replace(/^data:image\/png;base64,/, ''));
    };
    img.onerror = () => reject(new Error('undecodable image'));
    img.src = `data:image/png;base64,${aPngBase64}`;
  });
}

export function PANEL_IMAGE_EDITOR({
  data,
  scaleText,
  onScaleText,
  ppi,
  onGreyscale,
}: {
  /** `m_workingImage`: the image file, base64. */
  data: string;
  /** `m_textCtrlScale`'s text; unitless (`SetUnits( EDA_UNITS::UNSCALED )`). */
  scaleText: string;
  onScaleText: (text: string) => void;
  /** `m_stPPI_Value`: the image's own PPI, as an integer. */
  ppi: number;
  /** Convert to Greyscale's result, the re-encoded payload. */
  onGreyscale: (data: string) => void;
}): JSX.Element {
  return (
    <div className="ze-imgedit">
      {/* `OnRedrawPanel`: the image fitted to the panel's client area. */}
      <div className="ze-imgedit-preview">
        <img src={`data:image/png;base64,${data}`} alt="" />
      </div>
      <div className="ze-imgedit-grid">
        <span className="ze-refimg-lbl">Scale:</span>
        <input
          type="text"
          className="ze-input ze-imgedit-scale"
          aria-label="Scale"
          value={scaleText}
          onChange={(e) => onScaleText(e.target.value)}
        />
        <span className="ze-refimg-lbl">PPI:</span>
        <span className="ze-imgedit-ppi">{ppi}</span>
        <button
          type="button"
          className="ze-btn ze-imgedit-grey"
          onClick={() => {
            void ConvertToGreyscale(data).then(onGreyscale, () => {});
          }}
        >
          Convert to Greyscale
        </button>
      </div>
    </div>
  );
}
