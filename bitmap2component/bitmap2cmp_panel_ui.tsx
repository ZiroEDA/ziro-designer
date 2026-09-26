// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `BITMAP2CMP_PANEL`'s window: `bitmap2cmp_panel_base.cpp` (wxFormBuilder)
 * and the three `OnPaint*` handlers of `bitmap2cmp_panel.cpp`. Everything it
 * shows is a field of the `BITMAP2CMP_PANEL` it is given, and every control
 * calls that panel's handler; nothing is decided here.
 *
 * Its stylesheet is `bitmap2cmp_panel.css`, which the window that hosts it
 * imports (the package does not compile CSS).
 */
import { Fragment, type JSX, useEffect, useRef } from 'react';
import { Slider } from '@ziroeda/common/widgets/slider.js';
import { Combo } from '@ziroeda/common/widgets/wx_combobox.js';
import {
  LAYER_CHOICES,
  NOTEBOOK_PAGES,
  PIXEL_UNIT_CHOICES,
  type BITMAP2CMP_PANEL,
  type DROP_FILE,
  type IMAGE_FILE,
} from './bitmap2cmp_panel.js';
import {
  DRAWING_SHEET_FMT,
  FOOTPRINT_FMT,
  POSTSCRIPT_FMT,
  SYMBOL_FMT,
  type OUTPUT_FMT_ID,
} from './bitmap2component.js';
import type { wxImage } from './wx.js';

/** The Output Format radios, in `fgSizer2` order, with the Layer row after Footprint. [data] */
const FORMATS: { id: OUTPUT_FMT_ID; label: string }[] = [
  { id: SYMBOL_FMT, label: 'Symbol (.kicad_sym file)' },
  { id: FOOTPRINT_FMT, label: 'Footprint (.kicad_mod file)' },
  { id: POSTSCRIPT_FMT, label: 'Postscript (.ps file)' },
  { id: DRAWING_SHEET_FMT, label: 'Drawing Sheet (.kicad_wks file)' },
];

/** `m_sliderThreshold->SetToolTip(...)`. [data] */
const THRESHOLD_TOOLTIP =
  'Adjust the level to convert the greyscale picture to a black and white picture.';

/**
 * Read a file the browser hands over (the file dialog or a drop) into what
 * `OpenProjectFiles` takes: its bytes, and the browser's decode of them, or
 * null where the browser cannot decode it at all.
 */
export async function readImageFile(aFile: Blob & { name: string }): Promise<IMAGE_FILE> {
  const bytes = new Uint8Array(await aFile.arrayBuffer());

  try {
    const bmp = await createImageBitmap(new Blob([bytes], { type: aFile.type }));
    const cv = document.createElement('canvas');
    cv.width = bmp.width;
    cv.height = bmp.height;
    const cx = cv.getContext('2d');

    if (!cx) return { name: aFile.name, bytes, rgba: null };

    cx.drawImage(bmp, 0, 0);
    bmp.close();
    const img = cx.getImageData(0, 0, cv.width, cv.height);
    return {
      name: aFile.name,
      bytes,
      rgba: { data: img.data, width: img.width, height: img.height },
    };
  } catch {
    return { name: aFile.name, bytes, rgba: null };
  }
}

/**
 * A page's wxEVT_PAINT handler: `PrepareDC` then `DrawBitmap( bmp, 0, 0,
 * !!bmp.GetMask() )`. The canvas is sized to the bitmap itself, never to the
 * pane, so the preview is 1:1 and the pane scrolls. A masked pixel, and an
 * alpha one, show the page through.
 */
function paintPage(cv: HTMLCanvasElement | null, bmp: wxImage | null): void {
  if (!cv || !bmp || !bmp.IsOk()) return;

  const w = bmp.GetWidth();
  const h = bmp.GetHeight();
  const data = new ImageData(w, h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = bmp.GetRed(x, y);
      const g = bmp.GetGreen(x, y);
      const b = bmp.GetBlue(x, y);
      const masked =
        bmp.HasMask() &&
        r === bmp.GetMaskRed() &&
        g === bmp.GetMaskGreen() &&
        b === bmp.GetMaskBlue();

      data.data[i] = r;
      data.data[i + 1] = g;
      data.data[i + 2] = b;
      data.data[i + 3] = masked ? 0 : bmp.HasAlpha() ? bmp.GetAlpha(x, y) : 255;
    }
  }

  cv.width = data.width;
  cv.height = data.height;
  cv.getContext('2d')?.putImageData(data, 0, 0);
}

export interface Bitmap2cmpPanelProps {
  panel: BITMAP2CMP_PANEL;
  /** The DROP_FILE installed on all three pages. */
  dropTarget: DROP_FILE;
  /** Bumped by the panel's `Refresh()`, so this re-renders. */
  version: number;
}

export function Bitmap2cmpPanel({ panel, dropTarget, version }: Bitmap2cmpPanelProps): JSX.Element {
  // One canvas per notebook page, mirroring the three wxScrolledWindows and
  // the three bitmaps (m_Pict_Bitmap / m_Greyscale_Bitmap / m_BN_Bitmap) that
  // BITMAP2CMP_PANEL keeps alive at once. Each page then scrolls on its own.
  const originalCanvasRef = useRef<HTMLCanvasElement>(null);
  const greyscaleCanvasRef = useRef<HTMLCanvasElement>(null);
  const bwCanvasRef = useRef<HTMLCanvasElement>(null);

  const pict = panel.m_Pict_Bitmap?.image ?? null;
  const greyscale = panel.m_Greyscale_Bitmap;
  const bw = panel.m_BN_Bitmap;

  // OnPaintInit / OnPaintGreyscale / OnPaintBW each draw their own bitmap at
  // (0, 0) into their own page; a threshold change rebuilds only m_BN_Bitmap,
  // a Negative click m_Greyscale_Bitmap and m_BN_Bitmap. `version` is not read:
  // the bitmaps are the dependencies, and a handler replaces the object when
  // it rebuilds one.
  useEffect(() => {
    paintPage(originalCanvasRef.current, pict);
  }, [pict]);
  useEffect(() => {
    paintPage(greyscaleCanvasRef.current, greyscale);
  }, [greyscale]);
  useEffect(() => {
    paintPage(bwCanvasRef.current, bw);
  }, [bw]);

  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault();
    const files = [...(e.dataTransfer.files ?? [])];

    if (files.length === 0) return;

    void (async () => {
      const read = await Promise.all(files.map((f) => readImageFile(f)));
      await dropTarget.OnDropFiles(read);
    })();
  };

  const loaded = pict !== null;
  const canvases = [originalCanvasRef, greyscaleCanvasRef, bwCanvasRef];

  return (
    <div className="imgc-body imgc-panel" data-version={version}>
      {/* bMainSizer: the notebook, then brightSizer */}
      <div className="imgc-notebook">
        {/* The notebook has no page-change handler at all
            (bitmap2cmp_panel_base.cpp connects paint, buttons, fields and
            radios - never the notebook), so a tab click only selects a page. */}
        <div className="imgc-tabs" role="tablist">
          {NOTEBOOK_PAGES.map((label, i) => (
            <button
              key={label}
              type="button"
              role="tab"
              aria-selected={panel.m_NotebookSelection === i}
              className={`imgc-tab${panel.m_NotebookSelection === i ? ' active' : ''}`}
              onClick={() => panel.SetNotebookSelection(i)}
            >
              {/* wx's mnemonic escape: "&&" is a literal "&" */}
              {label.replaceAll('&&', '&')}
            </button>
          ))}
        </div>
        <div className="imgc-pages" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
          {/* All three pages stay mounted, as AddPage() keeps all three
              wxScrolledWindows alive; only the selected one is visible, and
              each holds its own scroll offset across a tab switch. Before a
              file is loaded they are blank: KiCad paints no placeholder. */}
          {canvases.map((ref, i) => (
            <div
              key={NOTEBOOK_PAGES[i]}
              className={`imgc-view${panel.m_NotebookSelection === i ? ' active' : ''}`}
            >
              {loaded && <canvas ref={ref} className="imgc-canvas" />}
            </div>
          ))}
        </div>
      </div>

      {/* brightSizer, group by group */}
      <div className="imgc-side">
        <fieldset className="imgc-group">
          <legend>Image Information</legend>
          <div className="imgc-info">
            <span className="k">Image size:</span>
            <span className="v">{panel.m_SizeXValue}</span>
            <span className="v">{panel.m_SizeYValue}</span>
            <span className="u">pixels</span>

            <span className="k">Image PPI:</span>
            <span className="v">{panel.m_InputXValueDPI}</span>
            <span className="v">{panel.m_InputYValueDPI}</span>
            <span className="u">PPI</span>

            {/* Three cells then fgSizerInfo->Add( 0, 0, ... ), so "bits" is
                in column 3 and the empty cell trails it. */}
            <span className="k">BPP:</span>
            <span className="v">{panel.m_BPPValue}</span>
            <span className="u">bits</span>
            <span />
          </div>
        </fieldset>

        <button type="button" className="imgc-btn block" onClick={() => panel.OnLoadFile()}>
          Load Source Image
        </button>

        {/* brightSizer->Add( 0, 0, 1, wxEXPAND ) */}
        <div className="imgc-spacer" />

        <fieldset className="imgc-group">
          <legend>Output Size</legend>
          <div className="imgc-sizerow">
            <span className="lbl">Size:</span>
            <input
              className="imgc-input ze-bare"
              value={panel.m_UnitSizeX}
              onChange={(e) => panel.SetUnitSizeXText(e.target.value)}
              spellCheck={false}
            />
            <input
              className="imgc-input ze-bare"
              value={panel.m_UnitSizeY}
              onChange={(e) => panel.SetUnitSizeYText(e.target.value)}
              spellCheck={false}
            />
            <Combo
              className="imgc-select"
              value={String(panel.m_PixelUnit)}
              onChange={(v) => panel.OnSizeUnitChange(Number(v))}
              options={PIXEL_UNIT_CHOICES.map((label, i) => ({ value: String(i), label }))}
            />
          </div>
          <label className="imgc-check">
            <input
              type="checkbox"
              checked={panel.m_aspectRatioCheckbox}
              onChange={(e) => panel.ToggleAspectRatioLock(e.target.checked)}
            />
            Lock height / width ratio
          </label>
        </fieldset>

        <fieldset className="imgc-group">
          <legend>Options</legend>
          <span className="imgc-thresh-label">Black / white threshold:</span>
          <Slider
            className="imgc-slider"
            min={0}
            max={panel.m_sliderThresholdMax}
            labels
            value={panel.m_sliderThreshold}
            title={THRESHOLD_TOOLTIP}
            onChange={(v) => panel.OnThresholdChange(v)}
          />
          <label className="imgc-check">
            <input
              type="checkbox"
              checked={panel.m_checkNegative}
              onChange={(e) => panel.OnNegativeClicked(e.target.checked)}
            />
            Negative
          </label>
        </fieldset>

        <fieldset className="imgc-group imgc-format">
          <legend>Output Format</legend>
          {/* fgSizer2 is a wxFlexGridSizer( 5, 1, 2, 0 ): five sibling rows,
              the Layer row third. They must stay siblings, because each row's
              wxFormBuilder border differs and the stylesheet addresses them
              by position. */}
          <div className="imgc-formats">
            {FORMATS.map((f) => (
              <Fragment key={f.id}>
                <label className="imgc-radio">
                  <input
                    type="radio"
                    name="imgc-format"
                    checked={panel.getOutputFormat() === f.id}
                    onChange={() => panel.SelectFormat(f.id)}
                  />
                  {f.label}
                </label>
                {f.id === FOOTPRINT_FMT && (
                  <div className={`imgc-layerrow${panel.m_layerEnabled ? '' : ' disabled'}`}>
                    <span className="lbl">Layer:</span>
                    <Combo
                      className="imgc-select grow"
                      value={String(panel.m_layerCtrl)}
                      disabled={!panel.m_layerEnabled}
                      onChange={(v) => panel.SetLayerSelection(Number(v))}
                      options={LAYER_CHOICES.map((label, i) => ({ value: String(i), label }))}
                    />
                  </div>
                )}
              </Fragment>
            ))}
          </div>
        </fieldset>

        <button
          type="button"
          className="imgc-btn block"
          onClick={() => panel.OnExportToFile()}
          disabled={!panel.m_buttonExportFileEnabled}
        >
          Export to File...
        </button>
        <button
          type="button"
          className="imgc-btn block"
          onClick={() => void panel.OnExportToClipboard()}
          disabled={!panel.m_buttonExportClipboardEnabled}
        >
          Export to Clipboard
        </button>
      </div>
    </div>
  );
}
