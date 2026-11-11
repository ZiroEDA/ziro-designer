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
import { DisplayErrorMessage } from '@ziroeda/common/confirm.js';
import { COORD_TYPES_T } from '@ziroeda/common/origin_transforms.js';
import type { StatusUnits } from '@ziroeda/common/widgets/kistatusbar_format.js';
import { UNIT_BINDER, unitLabel } from '@ziroeda/common/widgets/unit_binder.js';
import { SCH_COMMIT } from '../sch_commit.js';
import type { SCH_BITMAP } from '../sch_bitmap.js';
import type { SCH_EDIT_FRAME } from '../sch_edit_frame.js';
import { DIALOG_IMAGE_PROPERTIES_BASE } from './dialog_image_properties_base.js';
import { _ } from '@ziroeda/wx/translation.js';

export interface ImagePropsResult {
  /** `m_ModPositionX` / `m_ModPositionY`'s text, read back through their UNIT_BINDERs. */
  posX: string;
  posY: string;
  scale: number;
  /** Set when Convert to Greyscale replaced the payload. */
  data?: string;
}

interface Props {
  /** The position fields' text, as `m_posX.SetValue()` / `m_posY.SetValue()` wrote it. */
  posX: string;
  posY: string;
  /** The frame's units, which the binders write into `m_XPosUnit` / `m_YPosUnit`. */
  units: StatusUnits;
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
  posX: posX0,
  posY: posY0,
  units,
  scale: scale0,
  data: data0,
  ppi,
  pixelSize,
  onOk,
  onCancel,
}: Props): JSX.Element {
  const [posX, setPosX] = useState(posX0);
  const [posY, setPosY] = useState(posY0);
  const [scale, setScale] = useState(String(scale0));
  const [data, setData] = useState(data0);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const accept = (sc: number): void =>
    onOk({ posX, posY, scale: sc, ...(data !== data0 ? { data } : {}) });
  /** TransferDataFromWindow: PANEL_IMAGE_EDITOR::CheckValues first. */
  const submit = (): void => {
    const s = Number(scale);
    const r = CheckValues(Number.isFinite(s) ? s : -1, { x: pixelSize.w, y: pixelSize.h });
    if (r && 'error' in r) setError(r.error);
    else if (r) setConfirm(r.confirm);
    else accept(s);
  };

  return (
    <>
      <DIALOG_IMAGE_PROPERTIES_BASE
        m_ModPositionX={posX}
        onPositionX={setPosX}
        m_ModPositionY={posY}
        onPositionY={setPosY}
        unitsLabel={unitLabel(units)}
        m_imageSizer={
          // PANEL_IMAGE_EDITOR (common/dialogs), as DIALOG_IMAGE_PROPERTIES adds it.
          <PANEL_IMAGE_EDITOR
            data={data}
            scaleText={scale}
            onScaleText={setScale}
            ppi={ppi}
            onGreyscale={setData}
          />
        }
        onOK={submit}
        onCancel={onCancel}
      />
      {error && <MessageDialogError message={error} onClose={() => setError(null)} />}
      {confirm && (
        // IsOK( host, msg ) (confirm.cpp:278-298).
        <MessageDialogYesNo
          caption={_('Confirmation')}
          icon="question"
          defaultButton="yes"
          message={confirm}
          onResult={(r) => {
            setConfirm(null);
            if (r === 'yes') accept(Number(scale));
          }}
        />
      )}
    </>
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
  private readonly m_posX: UNIT_BINDER;
  private readonly m_posY: UNIT_BINDER;

  constructor(aParent: SCH_EDIT_FRAME, aBitmap: SCH_BITMAP) {
    this.m_frame = aParent;
    this.m_bitmap = aBitmap;
    this.m_posX = new UNIT_BINDER(aParent, _('Position X:'), (m) => DisplayErrorMessage(m));
    this.m_posY = new UNIT_BINDER(aParent, _('Position Y:'), (m) => DisplayErrorMessage(m));

    this.m_posX.SetCoordType(COORD_TYPES_T.ABS_X_COORD);
    this.m_posY.SetCoordType(COORD_TYPES_T.ABS_Y_COORD);
  }

  /** `TransferDataToWindow()`. */
  TransferDataToWindow(): {
    posX: string;
    posY: string;
    scale: number;
    data: string;
    ppi: number;
    pixelSize: { w: number; h: number };
  } {
    const image = this.m_bitmap.GetReferenceImage().GetImage();
    const pixels = image.GetImageData();
    const png = pixels?.SaveFilePng() ?? null;

    this.m_posX.SetValue(this.m_bitmap.GetPosition().x);
    this.m_posY.SetValue(this.m_bitmap.GetPosition().y);

    return {
      posX: this.m_posX.GetText(),
      posY: this.m_posY.GetText(),
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

    this.m_posX.SetText(aResult.posX);
    this.m_posY.SetText(aResult.posY);
    this.m_bitmap.SetPosition({ x: this.m_posX.GetIntValue(), y: this.m_posY.GetIntValue() });

    if (!commit.Empty()) commit.Push(_('Image Properties'));

    return true;
  }
}
