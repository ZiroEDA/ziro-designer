// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_REFERENCE_IMAGE_PROPERTIES` (pcbnew/dialogs/dialog_reference_image_properties.cpp) on a
 * PCB_REFERENCE_IMAGE, with the PANEL_IMAGE_EDITOR it adds to its m_imageSizer.
 *
 * Width, height and scale are one number wearing three hats: the item stores only the scale, so
 * a typed width rewrites the scale through the image's current size (onWidthChanged), and the
 * height follows with ChangeDoubleValue, which does not fire its own handler back.
 *
 * PANEL_IMAGE_EDITOR's working image is a copy of the bitmap (`std::make_unique<BITMAP_BASE>(
 * aItem )`): the preview, greyscale and scale act on it, and OK's TransferToImage imports it.
 *
 * Not a BOARD_COMMIT: upstream files the undo entry itself with SaveCopyInUndoList when the item
 * is not already in an edit, then writes the item in place; ShowReferenceImagePropertiesDialog
 * recaches the view afterwards.
 *
 * `DialogReferenceImageProperties` below is the window, DIALOG_REFERENCE_IMAGE_PROPERTIES_BASE
 * over the class.
 */
import { type JSX, useReducer, useState } from 'react';
import { BITMAP_BASE } from '@ziroeda/common/bitmap_base.js';
import { CheckValues, PANEL_IMAGE_EDITOR } from '@ziroeda/common/dialogs/panel_image_editor.js';
import { MessageDialogError, MessageDialogYesNo } from '@ziroeda/common/dialogs/dialog_message.js';
import { unitLabel } from '@ziroeda/common/eda_units.js';
import { toCssColor } from '@ziroeda/common/gal/color4d.js';
import { LSET_Name, LSET_NameToLayer } from '@ziroeda/common/layer_ids.js';
import { type PCB_LAYER_ID, ToLAYER_ID } from '@ziroeda/common/layer_id.js';
import { COORD_TYPES_T } from '@ziroeda/common/origin_transforms.js';
import { base64Encode } from '@ziroeda/common/plotters/SVG_plotter.js';
import { UNDO_REDO } from '@ziroeda/common/undo_redo_container.js';
import { UNIT_BINDER } from '@ziroeda/common/widgets/unit_binder.js';
import { wxALL, wxEXPAND } from '@ziroeda/wx/defs.js';
import { SizerItem } from '@ziroeda/wx/sizer.js';
import type { PCB_BASE_EDIT_FRAME } from '../pcb_base_edit_frame.js';
import { base64Decode } from '../pcb_io/kicad_sexpr/pcb_io_kicad_sexpr_items.js';
import { PCB_LAYER_BOX_SELECTOR } from '../pcb_layer_box_selector.js';
import type { PCB_REFERENCE_IMAGE } from '../pcb_reference_image.js';
import {
  DIALOG_REFERENCE_IMAGE_PROPERTIES_BASE,
  type UNIT_FIELD,
} from './dialog_reference_image_properties_base.js';
import { _ } from '@ziroeda/wx/translation.js';

export class DIALOG_REFERENCE_IMAGE_PROPERTIES {
  private readonly m_frame: PCB_BASE_EDIT_FRAME;
  private readonly m_bitmap: PCB_REFERENCE_IMAGE;

  readonly m_posX: UNIT_BINDER;
  readonly m_posY: UNIT_BINDER;
  readonly m_width: UNIT_BINDER;
  readonly m_height: UNIT_BINDER;
  readonly m_LayerSelectionCtrl = new PCB_LAYER_BOX_SELECTOR();
  m_cbLocked = false;
  /** `m_cbLocked->Show( false )` in the footprint editor. */
  readonly m_lockedShown: boolean;

  /** PANEL_IMAGE_EDITOR's `m_workingImage`. */
  readonly m_workingImage: BITMAP_BASE;
  /** PANEL_IMAGE_EDITOR's `m_textCtrlScale`: its m_scale binder is UNSCALED. */
  m_scaleText = '';

  constructor(aParent: PCB_BASE_EDIT_FRAME, aBitmap: PCB_REFERENCE_IMAGE) {
    this.m_frame = aParent;
    this.m_bitmap = aBitmap;
    this.m_posX = new UNIT_BINDER(aParent, _('Position X:'));
    this.m_posY = new UNIT_BINDER(aParent, _('Position Y:'));
    this.m_width = new UNIT_BINDER(aParent, _('Width:'));
    this.m_height = new UNIT_BINDER(aParent, _('Height:'));

    // Create the image editor page
    this.m_workingImage = new BITMAP_BASE(aBitmap.GetReferenceImage().GetImage());

    this.m_posX.SetCoordType(COORD_TYPES_T.ABS_X_COORD);
    this.m_posY.SetCoordType(COORD_TYPES_T.ABS_Y_COORD);
    this.m_width.SetCoordType(COORD_TYPES_T.ABS_X_COORD);
    this.m_height.SetCoordType(COORD_TYPES_T.ABS_Y_COORD);

    const board = aParent.GetBoard()!;

    // Only show unactivated board layers if the bitmap is on one of them
    if (!board.IsLayerEnabled(aBitmap.GetLayer()))
      this.m_LayerSelectionCtrl.ShowNonActivatedLayers(true);

    // Don't show locked control in the footprint editor
    this.m_lockedShown = !board.IsFootprintHolder();

    this.m_LayerSelectionCtrl.SetLayersHotkeys(false);
    this.m_LayerSelectionCtrl.SetBoardFrame(aParent);
    this.m_LayerSelectionCtrl.Resync();
  }

  /** PANEL_IMAGE_EDITOR::GetScale. */
  GetScale(): number {
    return Number.parseFloat(this.m_scaleText);
  }

  /** PANEL_IMAGE_EDITOR::SetScale: the field and the working image. */
  private SetScale(aScale: number): void {
    this.m_scaleText = String(aScale);
    this.UpdateImageScale(aScale);
  }

  /** PANEL_IMAGE_EDITOR::UpdateImageScale. */
  private UpdateImageScale(aScale: number): void {
    this.m_workingImage.SetScale(aScale);
  }

  /** PANEL_IMAGE_EDITOR::GetImageSize. */
  GetImageSize(): { x: number; y: number } {
    return this.m_workingImage.GetSize();
  }

  /** The working image's PNG, base64, for PANEL_IMAGE_EDITOR's preview. */
  GetWorkingImageData(): string {
    const bytes = this.m_workingImage.SaveImageData();
    return bytes ? base64Encode(bytes) : '';
  }

  /** PANEL_IMAGE_EDITOR::OnGreyScaleConvert, as the panel hands back the converted PNG. */
  OnGreyScaleConvert(aData: string): void {
    const scale = this.m_workingImage.GetScale();
    this.m_workingImage.ReadImageFile(base64Decode(aData));
    this.m_workingImage.SetScale(scale);
  }

  TransferDataToWindow(): boolean {
    const b = this.m_bitmap;

    this.m_posX.SetValue(b.GetPosition().x);
    this.m_posY.SetValue(b.GetPosition().y);
    this.m_LayerSelectionCtrl.SetLayerSelection(b.GetLayer());

    // Don't populate the locked control in the footprint editor
    if (this.m_lockedShown) this.m_cbLocked = b.IsLocked();

    // m_imageEditor->TransferDataToWindow()
    this.m_scaleText = String(this.m_workingImage.GetScale());

    const size = this.GetImageSize();
    this.m_width.SetValue(size.x);
    this.m_height.SetValue(size.y);

    return true;
  }

  /**
   * PANEL_IMAGE_EDITOR::CheckValues (:69-112): an error refuses; a very large image is a
   * question the window asks before calling TransferDataFromWindow.
   */
  CheckValues(): { error: string } | { confirm: string } | null {
    return CheckValues(this.GetScale(), this.m_workingImage.GetSizePixels());
  }

  /** After CheckValues has passed (or been answered yes). */
  TransferDataFromWindow(): boolean {
    const b = this.m_bitmap;

    // Save old image in undo list if not already in edit
    if (b.GetEditFlags() === 0) this.m_frame.SaveCopyInUndoList(b, UNDO_REDO.CHANGED);

    // Update our bitmap from the editor: TransferToImage
    let scale = Number.parseFloat(this.m_scaleText);
    if (!Number.isFinite(scale)) scale = 1.0;

    this.m_workingImage.SetScale(scale);
    b.GetReferenceImage().MutableImage().ImportData(this.m_workingImage);

    // Set position, etc.
    b.SetPosition({ x: this.m_posX.GetIntValue(), y: this.m_posY.GetIntValue() });
    b.SetLayer(ToLAYER_ID(this.m_LayerSelectionCtrl.GetLayerSelection()));

    // Only save locked status on non-footprint editor windows
    if (this.m_lockedShown) b.SetLocked(this.m_cbLocked);

    return true;
  }

  onWidthChanged(): void {
    const newWidth = this.m_width.GetDoubleValue();

    if (newWidth <= 0) return;

    const size = this.GetImageSize();

    if (size.x > 0) {
      const scale = (this.GetScale() * newWidth) / size.x;
      this.SetScale(scale);

      const newSize = this.GetImageSize();
      this.m_height.ChangeDoubleValue(newSize.y);
    }
  }

  onHeightChanged(): void {
    const newHeight = this.m_height.GetDoubleValue();

    if (newHeight <= 0) return;

    const size = this.GetImageSize();

    if (size.y > 0) {
      const scale = (this.GetScale() * newHeight) / size.y;
      this.SetScale(scale);

      const newSize = this.GetImageSize();
      this.m_width.ChangeDoubleValue(newSize.x);
    }
  }

  onScaleChanged(): void {
    const scale = this.GetScale();

    if (!(scale > 0)) return;

    // Update the preview and size fields, but leave the scale field alone. SetScale() would
    // rewrite it and send the caret back to the start on every keystroke.
    this.UpdateImageScale(scale);

    const size = this.GetImageSize();
    this.m_width.ChangeDoubleValue(size.x);
    this.m_height.ChangeDoubleValue(size.y);
  }
}

/** `ShowModal()` of DIALOG_REFERENCE_IMAGE_PROPERTIES: `onClose( true )` is wxID_OK. */
export function DialogReferenceImageProperties({
  dialog,
  onClose,
}: {
  dialog: DIALOG_REFERENCE_IMAGE_PROPERTIES;
  onClose: (aOk: boolean) => void;
}): JSX.Element {
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [preview, setPreview] = useState(() => {
    dialog.TransferDataToWindow();
    return dialog.GetWorkingImageData();
  });

  const field = (aBinder: UNIT_BINDER, aChanged?: () => void): UNIT_FIELD => ({
    label: aBinder.GetLabel(),
    value: aBinder.GetText(),
    units: unitLabel(aBinder.GetUnits()),
    // wxEVT_TEXT
    onChange: (aText) => {
      aBinder.SetText(aText);
      aChanged?.();
      redraw();
    },
    onBlur: redraw,
  });

  const ok = (): void => {
    const check = dialog.CheckValues();

    if (check && 'error' in check) setError(check.error);
    else if (check) setConfirm(check.confirm);
    else if (dialog.TransferDataFromWindow()) onClose(true);
  };

  const box = dialog.m_LayerSelectionCtrl;

  return (
    <>
      <DIALOG_REFERENCE_IMAGE_PROPERTIES_BASE
        m_posX={field(dialog.m_posX)}
        m_posY={field(dialog.m_posY)}
        m_width={field(dialog.m_width, () => dialog.onWidthChanged())}
        m_height={field(dialog.m_height, () => dialog.onHeightChanged())}
        layerRows={box.GetRows().map((r) => ({
          value: LSET_Name(r.layerid),
          label: r.name,
          swatch: r.swatch ? toCssColor(r.swatch) : undefined,
        }))}
        layer={LSET_Name(box.GetLayerSelection() as PCB_LAYER_ID)}
        onLayerChange={(aLayer) => {
          box.SetLayerSelection(LSET_NameToLayer(aLayer as never) as PCB_LAYER_ID);
          redraw();
        }}
        m_cbLocked={{
          value: dialog.m_cbLocked,
          onChange: (aOn) => {
            dialog.m_cbLocked = aOn;
            redraw();
          },
        }}
        lockedShown={dialog.m_lockedShown}
        lockedTip={_(
          "Locked items cannot be freely moved and oriented on the canvas and can only be selected when the 'Locked items' checkbox is checked in the selection filter.",
        )}
        m_imageEditor={
          <SizerItem proportion={1} flag={wxEXPAND | wxALL} border={5}>
            <PANEL_IMAGE_EDITOR
              data={preview}
              scaleText={dialog.m_scaleText}
              onScaleText={(aText) => {
                dialog.m_scaleText = aText;
                dialog.onScaleChanged();
                redraw();
              }}
              ppi={dialog.m_workingImage.GetPPI()}
              onGreyscale={(aData) => {
                dialog.OnGreyScaleConvert(aData);
                setPreview(aData);
              }}
            />
          </SizerItem>
        }
        onOK={ok}
        onCancel={() => onClose(false)}
      />
      {error && <MessageDialogError message={error} onClose={() => setError(null)} />}
      {confirm && (
        // IsOK( host, msg ) (confirm.cpp:278-298): "Confirmation", the question icon, Yes as
        // the default.
        <MessageDialogYesNo
          caption={_('Confirmation')}
          icon="question"
          defaultButton="yes"
          message={confirm}
          onResult={(r) => {
            setConfirm(null);
            if (r === 'yes' && dialog.TransferDataFromWindow()) onClose(true);
          }}
        />
      )}
    </>
  );
}
