// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Reference image properties.
 * Counterparts: `pcbnew/dialogs/dialog_reference_image_properties_base.cpp` and
 * the `PANEL_IMAGE_EDITOR` it embeds (`common/dialogs/panel_image_editor.cpp`),
 * which is where the preview, the Scale field and the PPI readout live.
 *
 * The decisions live in `pcbnew/image_properties.ts`; this is layout.
 *
 * ## The shape
 *
 * `bMainSizer` is vertical and has NO group boxes — `bMargins`, holding one
 * `wxGridBagSizer( 3, 5 )` and then the image editor, and then the standard
 * buttons. This file had two invented ones, Position and Size.
 *
 *     Position X:       [        ] mm
 *     Position Y:       [        ] mm
 *     Associated layer: [combo   ] mm      <- see "the stranded unit" below
 *     Height:           [        ] mm
 *     Width:            [        ]
 *     Locked [x]
 *     ┌──────────────┐  Scale: [    ]
 *     │   preview    │  PPI:   1200
 *     └──────────────┘
 *
 * Height above Width is upstream's order — `m_HeightLabel` is at row 3 and
 * `m_WidthLabel` at row 4 — and the manual lists them that way too ("Height,
 * Width, and Scale all control the size of the image").
 *
 * ## The stranded unit
 *
 * `m_WidthUnit` is added at `wxGBPosition( 2, 2 )` while the width label and
 * control are at row 4 (`_base.cpp:54-61`). So the "mm" that belongs to Width
 * is drawn on the **Associated layer** row, and Width has none beside it. That
 * is what KiCad renders — `m_width( aParent, m_WidthLabel, m_ModWidth,
 * m_WidthUnit )` binds the control, it does not move it — and it is mirrored
 * here rather than tidied, because tidying it is a visible divergence from the
 * dialog this is meant to be indistinguishable from.
 *
 * ## Width, height and scale are the same number three times
 *
 * The item stores only a scale, so typing in any of the three rewrites it and
 * the other two follow. Upstream reaches for `ChangeDoubleValue` to stop the
 * three controls firing each other's handlers; here each keystroke is one call
 * into a pure function that returns all three at once, so there is no loop to
 * break. The size fields show what the last computation produced rather than
 * the raw text, except for the field being typed in.
 *
 * Left out: `m_buttonGrey`, "Convert to Greyscale". It rewrites the pixels, and
 * our model holds the PNG as it was read; converting would mean decode,
 * recolour and re-encode in a place where nothing else touches a raster.
 */

import { useState, type JSX } from 'react';
import { pcbIuToMM, pcbIUScale, pcbMmToIU } from '@ziroeda/common/eda_units.js';
import {
  scaleForHeight,
  scaleForWidth,
  sizeForScale,
  type ImageValues,
} from '@ziroeda/pcbnew/image_properties.js';
import { pngPixelSize, pngPPI } from '@ziroeda/common/png_meta.js';
import { CheckValues, PANEL_IMAGE_EDITOR } from '@ziroeda/common/dialogs/panel_image_editor.js';
import { MessageDialogError, MessageDialogYesNo } from '@ziroeda/common/dialogs/dialog_message.js';
import type { PcbImage } from '@ziroeda/pcbnew/types.js';
import { Combo } from '@ziroeda/common/widgets/wx_combobox.js';
import { StdDialogButtons } from '@ziroeda/common/dialog_shim_buttons.js';
import { parseUnitValue, stringFromValue, unitLabel } from '@ziroeda/common/widgets/unit_binder.js';
import type { StatusUnits } from '@ziroeda/common/widgets/kistatusbar_format.js';
import { useModalEscape } from '@ziroeda/common/dialogs/use_modal_escape.js';

interface Props {
  image: PcbImage;
  initial: ImageValues;
  /**
   * The frame's display units. `m_posX`, `m_posY`, `m_width` and `m_height` are
   * all `UNIT_BINDER`s (`dialog_reference_image_properties.cpp:40-43`), each
   * built with its label, its control AND its unit static text, so all four
   * show and read the frame's unit. Scale is the one field that is not: its
   * binder is given a `nullptr` unit control (`panel_image_editor.cpp:39`)
   * because a scale factor is unitless.
   */
  units: StatusUnits;
  layers: readonly string[];
  /** The board colour of a layer, for the layer combo's swatch. */
  layerColor: (layer: string) => string;
  onApply: (v: ImageValues) => void;
  onClose: () => void;
}

export function DialogReferenceImageProperties({
  image,
  initial,
  units,
  layers,
  layerColor,
  onApply,
  onClose,
}: Props): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask.
  useModalEscape(onClose);

  const [v, setV] = useState<ImageValues>(initial);
  // The raw text of whichever field has the caret, so it is not reformatted
  // out from under the typist.
  const [typing, setTyping] = useState<{ key: string; text: string } | null>(null);
  const set = (patch: Partial<ImageValues>): void => setV((p) => ({ ...p, ...patch }));
  // PANEL_IMAGE_EDITOR::CheckValues, run by TransferDataFromWindow on OK.
  const [checkError, setCheckError] = useState<string | null>(null);
  const [checkConfirm, setCheckConfirm] = useState<string | null>(null);
  const onOk = (): void => {
    const size = pngPixelSize(v.data ?? image.data);
    const r = CheckValues(v.scale, { x: size?.w ?? 0, y: size?.h ?? 0 });
    if (r && 'error' in r) setCheckError(r.error);
    else if (r) setCheckConfirm(r.confirm);
    else onApply(v);
  };

  const shown = (key: string, value: string): string => (typing?.key === key ? typing.text : value);
  const asText = (iu: number): string => stringFromValue(pcbIuToMM(iu), units, false, pcbIUScale);

  /** A position field: no coupling to anything else in the dialog. */
  const posField = (label: string, key: 'x' | 'y', slot: string): JSX.Element => (
    <>
      <span className={`ze-refimg-lbl ze-refimg-${slot}-lbl`}>{label}</span>
      <input
        type="text"
        className={`ze-input ze-refimg-${slot}-ctl`}
        value={shown(key, asText(v[key]))}
        onChange={(e) => {
          setTyping({ key, text: e.target.value });
          const mm = parseUnitValue(e.target.value, units, pcbIUScale);
          if (Number.isFinite(mm)) set({ [key]: pcbMmToIU(mm) } as Partial<ImageValues>);
        }}
        onBlur={() => setTyping(null)}
      />
      <span className={`ze-unit-label ze-refimg-${slot}-u`}>{unitLabel(units)}</span>
    </>
  );

  /**
   * A size field. Typing here rewrites the *scale*, so the other size field and
   * the scale field both move — there is no independent stretch, because the
   * model has one scale factor rather than two.
   */
  const sizeField = (label: string, key: 'width' | 'height', slot: string): JSX.Element => (
    <>
      <span className={`ze-refimg-lbl ze-refimg-${slot}-lbl`}>{label}</span>
      <input
        type="text"
        className={`ze-input ze-refimg-${slot}-ctl`}
        value={shown(key, asText(v[key]))}
        onChange={(e) => {
          setTyping({ key, text: e.target.value });
          const mm = parseUnitValue(e.target.value, units, pcbIUScale);
          if (!Number.isFinite(mm)) return;
          const iu = pcbMmToIU(mm);
          setV((p) =>
            key === 'width' ? scaleForWidth(image, p, iu) : scaleForHeight(image, p, iu),
          );
        }}
        onBlur={() => setTyping(null)}
      />
    </>
  );

  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div className="ze-modal ze-refimg-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Reference Image Properties
          <span className="x" title="Cancel" onClick={onClose}>
            ✕
          </span>
        </div>

        <div className="ze-modal-body ze-refimg-body">
          {/* `bMargins`, which is everything but the buttons. */}
          <div className="ze-refimg-margins">
            {/* `gbSizer1 = new wxGridBagSizer( 3, 5 )`, three columns, growable
                column 1. Not one Add() in it names a border flag, so no cell
                carries a margin — only the 3/5 gaps separate them. */}
            <div className="ze-refimg-grid">
              {posField('Position X:', 'x', 'px')}
              {posField('Position Y:', 'y', 'py')}

              <span className="ze-refimg-lbl ze-refimg-layer-lbl">Associated layer:</span>
              {/* `m_LayerSelectionCtrl` is a PCB_LAYER_BOX_SELECTOR: every entry
                  carries its layer's colour swatch. */}
              <Combo
                className="ze-refimg-layer"
                value={v.layer}
                onChange={(layer) => set({ layer })}
                options={layers.map((l) => ({ value: l, label: l, swatch: layerColor(l) }))}
              />
              {/* Width's unit, at `wxGBPosition( 2, 2 )` — this row, not its
                  own. See the header. */}
              <span className="ze-unit-label ze-refimg-w-u">{unitLabel(units)}</span>

              {sizeField('Height:', 'height', 'h')}
              <span className="ze-unit-label ze-refimg-h-u">{unitLabel(units)}</span>

              {sizeField('Width:', 'width', 'w')}

              <label className="ze-refimg-check ze-refimg-locked">
                <input
                  type="checkbox"
                  checked={v.locked}
                  onChange={(e) => set({ locked: e.target.checked })}
                />
                Locked
              </label>
            </div>

            {/* `m_imageSizer`, holding PANEL_IMAGE_EDITOR (common/dialogs). */}
            <PANEL_IMAGE_EDITOR
              data={v.data ?? image.data}
              scaleText={shown('scale', String(v.scale))}
              onScaleText={(text) => {
                setTyping({ key: 'scale', text });
                const n = Number(text);
                if (Number.isFinite(n)) setV((p) => sizeForScale(image, p, n));
              }}
              ppi={pngPPI(v.data ?? image.data)}
              onGreyscale={(data) => set({ data })}
            />
          </div>
        </div>

        <StdDialogButtons onCancel={onClose} onOk={onOk} />
        {checkError && (
          <MessageDialogError message={checkError} onClose={() => setCheckError(null)} />
        )}
        {checkConfirm && (
          // IsOK( host, msg ) (confirm.cpp:278-298): "Confirmation", the
          // question icon, Yes as the default.
          <MessageDialogYesNo
            caption="Confirmation"
            icon="question"
            defaultButton="yes"
            message={checkConfirm}
            onResult={(r) => {
              setCheckConfirm(null);
              if (r === 'yes') onApply(v);
            }}
          />
        )}
      </div>
    </div>
  );
}
