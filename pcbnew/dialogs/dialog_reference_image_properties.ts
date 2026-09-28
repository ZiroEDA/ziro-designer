// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Reading and writing a reference image's properties.
 * Counterparts: `DIALOG_REFERENCE_IMAGE_PROPERTIES` and the scale half of
 * `PANEL_IMAGE_EDITOR`.
 *
 * Headless, like the other properties modules: the dialog is layout, this is
 * the part with decisions in it.
 *
 * ## Width, height and scale are one number wearing three hats
 *
 * The dialog shows all three and lets you type in any of them, but the item
 * stores only `(scale …)`. So each field has to be able to drive the other two,
 * and upstream does it through the *current* size rather than the original
 * pixels:
 *
 *     scale' = scale × newWidth / size.x        (size.x = pixels × iuPerPixel × scale)
 *
 * which algebraically is just `newWidth / (pixels × iuPerPixel)`. Going the long
 * way round is not pointless — `size.x` is rounded to whole internal units, so
 * the two forms can differ by a nanometre, and this is the one whose answers
 * match KiCad's.
 *
 * The aspect ratio is not adjustable. Typing a width rewrites the *scale*, so
 * the height moves with it; there is no independent stretch. That is a property
 * of the model — one scale factor — not a limitation of the dialog.
 *
 * ## What the dialog cannot do
 *
 * Upstream's `PANEL_IMAGE_EDITOR` also offers **greyscale conversion**, which
 * rewrites the pixels. That is deliberately absent: our model holds the PNG
 * payload as it was read, and converting would mean decoding, recolouring and
 * re-encoding a raster — real work in a place where nothing else touches
 * pixels, for an effect a user can get before importing. Left out rather than
 * half-done.
 */
import { parseBoardItemId } from '../edit-board.js';
import { imageSizeIU } from '../pcb_reference_image.js';
import type { Board, PcbImage } from '../types.js';
import type { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LSET_Name, LSET_NameToLayer } from '@ziroeda/common/layer_ids.js';
import { UNDO_REDO } from '@ziroeda/common/undo_redo_container.js';
import type { PCB_BASE_EDIT_FRAME } from '../pcb_base_edit_frame.js';
import { base64Decode } from '../pcb_io/kicad_sexpr/pcb_io_kicad_sexpr_items.js';
import type { PCB_REFERENCE_IMAGE } from '../pcb_reference_image.js';
import type { TransferResult } from './dialog_text_properties.js';

/** Every control on the dialog, flattened. */
export interface ImageValues {
  x: number;
  y: number;
  layer: string;
  locked: boolean;
  scale: number;
  /** Derived from the scale; shown so it can be typed into. */
  width: number;
  height: number;
  /**
   * PANEL_IMAGE_EDITOR's Convert to Greyscale replaced the image file
   * (`TransferToImage` -> `aItem.ImportData( *m_workingImage )`).
   */
  data?: string;
}

/** The single selected reference image's index, or null. */
export function imageAt(board: Board, selection: Iterable<string>): number | null {
  const ids = [...selection];
  if (ids.length !== 1) return null;
  const ref = parseBoardItemId(ids[0]!);
  if (!ref || ref.kind !== 'image') return null;
  return board.images[ref.index] ? ref.index : null;
}

/** `TransferDataToWindow`: the item's state as the dialog's fields. */
export function collectImageValues(img: PcbImage): ImageValues {
  const size = imageSizeIU(img);
  return {
    x: img.at.x,
    y: img.at.y,
    layer: img.layer,
    locked: img.locked ?? false,
    // An absent `(scale …)` is 1 — the writer omits it at 1.
    scale: img.scale ?? 1,
    width: size.w,
    height: size.h,
  };
}

/**
 * `onWidthChanged`: a typed width becomes a scale, and the height follows.
 *
 * A width of zero or less is ignored rather than clamped, as upstream does — it
 * is what you see mid-typing after clearing the field, and snapping the image
 * to nothing on the way to a real number would be worse than doing nothing.
 * The rejection happens in `sizeForScale`, which is the single gate on the
 * resulting scale; upstream needs its own `newWidth <= 0` test only because its
 * `SetScale` has none. Mutation testing showed a second test here unobservable.
 *
 * The size guard is *not* redundant, though it looks like it: an image whose
 * stored scale is zero — which a hand-edited file can say — measures zero
 * across, and dividing by that gives an infinite scale that no later test
 * rejects.
 */
export function scaleForWidth(img: PcbImage, values: ImageValues, newWidth: number): ImageValues {
  const size = imageSizeIU({ ...img, scale: values.scale });
  if (size.w <= 0) return values;
  return sizeForScale(img, values, (values.scale * newWidth) / size.w);
}

/** `onHeightChanged`, the same the other way round. */
export function scaleForHeight(img: PcbImage, values: ImageValues, newHeight: number): ImageValues {
  const size = imageSizeIU({ ...img, scale: values.scale });
  if (size.h <= 0) return values;
  return sizeForScale(img, values, (values.scale * newHeight) / size.h);
}

/**
 * `onScaleChanged`: the scale drives both size fields.
 *
 * Upstream calls `ChangeDoubleValue` for the two sizes rather than
 * `SetDoubleValue` specifically so that updating them does not fire their own
 * change handlers back — the three fields would otherwise chase each other. In
 * a single pure function that problem cannot arise, which is the point of
 * putting it here rather than in three event handlers.
 */
export function sizeForScale(img: PcbImage, values: ImageValues, newScale: number): ImageValues {
  if (newScale <= 0) return values;
  const size = imageSizeIU({ ...img, scale: newScale });
  return { ...values, scale: newScale, width: size.w, height: size.h };
}

/** `TransferDataFromWindow`: write the dialog's fields back to the board. */
export function applyImageValues(board: Board, index: number, v: ImageValues): Board {
  const img = board.images[index];
  if (!img) return board;

  const before = collectImageValues(img);
  if (JSON.stringify(before) === JSON.stringify(v)) return board;

  const next: PcbImage = {
    ...img,
    at: { x: v.x, y: v.y },
    layer: v.layer,
    locked: v.locked,
    // A scale of exactly 1 goes back to being absent, since that is how the
    // file says it: storing 1 would make an untouched image grow a token on
    // save. `dropChild` below removes it from the source node to match.
    scale: v.scale === 1 ? undefined : v.scale,
    ...(v.data !== undefined ? { data: v.data } : {}),
  };

  return {
    ...board,
    images: board.images.map((cur, i) => (i === index ? next : cur)),
  };
}

// ---------------------------------------------------------------------------
// The live dialog: DIALOG_REFERENCE_IMAGE_PROPERTIES on a PCB_REFERENCE_IMAGE
// (#636 stage 6)
// ---------------------------------------------------------------------------

/** PANEL_IMAGE_EDITOR::CheckValues' limits, in scaled pixels (panel_image_editor.cpp:73-74). */
const MIN_SIZE = 15; // Min size in pixels after scaling (50 mils)
const MAX_SIZE = 6000; // Max size in pixels after scaling (20 inches)

/**
 * `DIALOG_REFERENCE_IMAGE_PROPERTIES` (dialog_reference_image_properties.cpp)
 * on a live PCB_REFERENCE_IMAGE, with PANEL_IMAGE_EDITOR's CheckValues and
 * TransferToImage.
 *
 * Not a BOARD_COMMIT: upstream files the undo entry itself with
 * `SaveCopyInUndoList( &m_bitmap, UNDO_REDO::CHANGED )` when the item is not
 * already in an edit, then writes the item in place. The caller
 * (`ShowReferenceImagePropertiesDialog`) refreshes the view afterwards, so no
 * board listener hears this edit; the call site re-derives the view.
 *
 * The scale is written onto the bitmap directly (`m_workingImage->SetScale`,
 * `ImportData`), not through REFERENCE_IMAGE::SetImageScale, so the image
 * grows about its centre rather than its transform origin. Width and height
 * are the scale seen another way and are not written.
 */
export class DIALOG_REFERENCE_IMAGE_PROPERTIES {
  private readonly m_frame: PCB_BASE_EDIT_FRAME;
  private readonly m_bitmap: PCB_REFERENCE_IMAGE;

  constructor(aFrame: PCB_BASE_EDIT_FRAME, aBitmap: PCB_REFERENCE_IMAGE) {
    this.m_frame = aFrame;
    this.m_bitmap = aBitmap;
  }

  TransferDataToWindow(): ImageValues {
    const b = this.m_bitmap;
    const size = b.GetReferenceImage().GetSize();

    return {
      x: b.GetPosition().x,
      y: b.GetPosition().y,
      layer: LSET_Name(b.GetLayer()),
      locked: b.IsLocked(),
      scale: b.GetReferenceImage().GetImageScale(),
      width: size.x,
      height: size.y,
    };
  }

  /**
   * PANEL_IMAGE_EDITOR::CheckValues (:69-112). `aIsOK` is the "very large"
   * question's answer; without one the question is taken as yes.
   */
  private checkValues(aScale: number, aIsOK: (aMessage: string) => boolean): TransferResult {
    // Test number correctness
    if (aScale < 0.0) return { ok: false, message: 'Scale must be a positive number.' };

    // Test value correctness
    const psize = this.m_bitmap.GetReferenceImage().GetImage().GetSizePixels();
    const size_min = Math.trunc(Math.min(psize.x * aScale, psize.y * aScale));

    if (size_min < MIN_SIZE)
      return {
        ok: false,
        message: `This scale results in an image which is too small (${((25.4 / 300) * size_min).toFixed(2)} mm or ${((1000.0 / 300.0) * size_min).toFixed(1)} mil).`,
      };

    const size_max = Math.trunc(Math.max(psize.x * aScale, psize.y * aScale));

    if (
      size_max > MAX_SIZE &&
      !aIsOK(
        `This scale results in an image which is very large (${((25.4 / 300) * size_max).toFixed(1)} mm or ${(size_max / 300.0).toFixed(2)} in). Are you sure?`,
      )
    )
      return { ok: false };

    return { ok: true };
  }

  TransferDataFromWindow(
    v: ImageValues,
    aIsOK: (aMessage: string) => boolean = () => true,
  ): TransferResult {
    const check = this.checkValues(v.scale, aIsOK);
    if (!check.ok) return check;

    const b = this.m_bitmap;

    // Save old image in undo list if not already in edit
    if (b.GetEditFlags() === 0) this.m_frame.SaveCopyInUndoList(b, UNDO_REDO.CHANGED);

    // Update our bitmap from the editor
    const image = b.GetReferenceImage().MutableImage();
    if (v.data !== undefined) image.ReadImageFile(base64Decode(v.data));
    image.SetScale(v.scale);

    // Set position, etc.
    b.SetPosition({ x: v.x, y: v.y });
    b.SetLayer(LSET_NameToLayer(v.layer) as PCB_LAYER_ID);

    // Only save locked status on non-footprint editor windows
    if (!this.m_frame.GetBoard()?.IsFootprintHolder()) b.SetLocked(v.locked);

    this.m_frame.OnModify();

    return { ok: true };
  }
}
