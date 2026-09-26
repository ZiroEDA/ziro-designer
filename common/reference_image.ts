// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/reference_image.h` / `common/reference_image.cpp`: `REFERENCE_IMAGE`,
 * the position, transform origin and `BITMAP_BASE` an `SCH_BITMAP` /
 * `PCB_REFERENCE_IMAGE` owns. One class in `common/`, parameterised by the
 * editor's `EDA_IU_SCALE`, computes the pixel size for both editors.
 *
 * A word of warning, because it is the obvious wrong turn: `BITMAP_BASE`'s
 * constructor hardcodes `254000.0 / m_ppi` under a comment saying so is "OK ...
 * for Eeschema which uses currently 254000PPI". That is only the default a bare
 * BITMAP_BASE carries before anyone sets it; `updatePixelSizeInIU` overwrites
 * it from the scale. Take the scale, never the number.
 */

import { BITMAP_BASE } from './bitmap_base.js';
import type { EdaIuScale } from './eda_units.js';
import type { WX_IMAGE } from './wx_image.js';
import { type FLIP_DIRECTION, MIRROR } from '@ziroeda/core/mirror.js';
import { EDA_ANGLE, EDA_ANGLE_T } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { IsVec2SafeXY } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import { BOX2D, BOX2I, IsBOX2Safe } from '@ziroeda/kimath/src/math/box2.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import { type VECTOR2I, equal } from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';

function compareImages(aLeft: BITMAP_BASE, aRight: BITMAP_BASE): boolean {
  const leftImage = aLeft.GetImageData();
  const rightImage = aRight.GetImageData();

  if (!leftImage || !rightImage) return leftImage === rightImage;

  const leftData = aLeft.SaveImageData();
  const rightData = aRight.SaveImageData();

  if (!leftData || !rightData) return false;

  const leftSize = leftData.length;
  const rightSize = rightData.length;

  if (leftSize !== rightSize) return false;

  if (leftSize === 0) return true;

  for (let i = 0; i < leftSize; i++) if (leftData[i] !== rightData[i]) return false;

  return true;
}

/**
 * A reference image (a bitmap) placed in a document.
 */
export class REFERENCE_IMAGE {
  private readonly m_iuScale: EdaIuScale;
  private m_pos: VECTOR2I;
  private m_transformOriginOffset: VECTOR2I;
  private m_bitmapBase: BITMAP_BASE;

  constructor(aIuScale: EdaIuScale);
  constructor(aOther: REFERENCE_IMAGE);
  constructor(a: EdaIuScale | REFERENCE_IMAGE) {
    if (a instanceof REFERENCE_IMAGE) {
      this.m_iuScale = a.m_iuScale;
      this.m_pos = { ...a.m_pos };
      this.m_transformOriginOffset = { ...a.m_transformOriginOffset };
      this.m_bitmapBase = new BITMAP_BASE(a.m_bitmapBase);
    } else {
      this.m_iuScale = a;
      this.m_pos = { x: 0, y: 0 };
      this.m_transformOriginOffset = { x: 0, y: 0 };
      this.m_bitmapBase = new BITMAP_BASE();
    }

    this.updatePixelSizeInIU();
  }

  private updatePixelSizeInIU(): void {
    const pixelSizeIu = this.m_iuScale.milsToIU(1000) / this.m_bitmapBase.GetPPI();
    this.m_bitmapBase.SetPixelSizeIu(pixelSizeIu);
  }

  /** `operator=`. */
  assign(aOther: REFERENCE_IMAGE): this {
    console.assert(this.m_iuScale.IU_PER_MILS === aOther.m_iuScale.IU_PER_MILS);

    if (aOther !== this) {
      if (aOther.m_bitmapBase) {
        this.m_bitmapBase = new BITMAP_BASE(aOther.m_bitmapBase);
      }

      this.m_pos = { ...aOther.m_pos };
      this.m_transformOriginOffset = { ...aOther.m_transformOriginOffset };
      this.updatePixelSizeInIU();
    }

    return this;
  }

  /** `operator==`. */
  equals(aOther: REFERENCE_IMAGE): boolean {
    if (!equal(this.m_pos, aOther.m_pos)) return false;

    if (!equal(this.m_transformOriginOffset, aOther.m_transformOriginOffset)) return false;

    if (!equal(this.m_bitmapBase.GetSize(), aOther.m_bitmapBase.GetSize())) return false;

    if (this.m_bitmapBase.GetPPI() !== aOther.m_bitmapBase.GetPPI()) return false;

    if (this.m_bitmapBase.GetScale() !== aOther.m_bitmapBase.GetScale()) return false;

    if (!compareImages(this.m_bitmapBase, aOther.m_bitmapBase)) return false;

    return true;
  }

  Similarity(aOther: REFERENCE_IMAGE): number {
    let similarity = 1.0;

    if (!equal(this.m_pos, aOther.m_pos)) similarity *= 0.9;

    if (!equal(this.m_bitmapBase.GetSize(), aOther.m_bitmapBase.GetSize())) similarity *= 0.9;

    if (this.m_bitmapBase.GetPPI() !== aOther.m_bitmapBase.GetPPI()) similarity *= 0.9;

    if (this.m_bitmapBase.GetScale() !== aOther.m_bitmapBase.GetScale()) similarity *= 0.9;

    if (!compareImages(this.m_bitmapBase, aOther.m_bitmapBase)) similarity *= 0.9;

    return similarity;
  }

  GetBoundingBox(): BOX2I {
    return BOX2I.ByCenter(this.m_pos, this.m_bitmapBase.GetSize());
  }

  GetPosition(): VECTOR2I {
    return this.m_pos;
  }

  /**
   * Set the position of the image; no change if the new box would overflow.
   */
  SetPosition(aPos: VECTOR2I): void {
    const newBox = BOX2D.ByCenter(aPos, this.m_bitmapBase.GetSize());

    if (!IsBOX2Safe(newBox)) return;

    this.m_pos = { x: aPos.x, y: aPos.y };
  }

  /**
   * Get the center of transformation, relative to the image center.
   */
  GetTransformOriginOffset(): VECTOR2I {
    return this.m_transformOriginOffset;
  }
  SetTransformOriginOffset(aCenter: VECTOR2I): void {
    this.m_transformOriginOffset = { x: aCenter.x, y: aCenter.y };
  }

  /**
   * Get the image "zoom" value.
   */
  GetSize(): VECTOR2I {
    return this.m_bitmapBase.GetSize();
  }

  SetWidth(aWidth: number): void {
    if (aWidth <= 0) return;

    const ratio = aWidth / this.m_bitmapBase.GetSize().x;
    this.scaleBy(ratio);
  }

  SetHeight(aHeight: number): void {
    if (aHeight <= 0) return;

    const ratio = aHeight / this.m_bitmapBase.GetSize().y;
    this.scaleBy(ratio);
  }

  /**
   * Get the image "zoom" value.
   */
  GetImageScale(): number {
    return this.m_bitmapBase.GetScale();
  }

  /**
   * Set the image "zoom" value.
   *
   * Scales the image about the transform origin (position + offset); no change
   * when the scaled box would overflow.
   */
  SetImageScale(aScale: number): void {
    if (aScale <= 0) return;

    const ratio = aScale / this.m_bitmapBase.GetScale();
    this.scaleBy(ratio);
  }

  private scaleBy(aRatio: number): void {
    if (aRatio <= 0) return;

    const currentOrigin = {
      x: this.m_pos.x + this.m_transformOriginOffset.x,
      y: this.m_pos.y + this.m_transformOriginOffset.y,
    };
    const newOffset = {
      x: this.m_transformOriginOffset.x * aRatio,
      y: this.m_transformOriginOffset.y * aRatio,
    };
    const newCenter = { x: currentOrigin.x - newOffset.x, y: currentOrigin.y - newOffset.y };
    const size = this.m_bitmapBase.GetSize();
    const newSize = { x: size.x * aRatio, y: size.y * aRatio };

    // The span of the image is limited to the size of the coordinate system
    if (!IsVec2SafeXY(newSize)) return;

    const newBox = BOX2D.ByCenter(newCenter, newSize);

    // Any overflow, just reject the call
    if (!IsBOX2Safe(newBox)) return;

    this.m_bitmapBase.SetScale(this.m_bitmapBase.GetScale() * aRatio);
    this.SetTransformOriginOffset({ x: KiROUND(newOffset.x), y: KiROUND(newOffset.y) });
    // Don't need to recheck the box, we just did that
    this.m_pos = { x: KiROUND(newCenter.x), y: KiROUND(newCenter.y) };
  }

  Flip(aCentre: VECTOR2I, aFlipDirection: FLIP_DIRECTION): void {
    const newPos = { ...this.m_pos };
    MIRROR(newPos, aCentre, aFlipDirection);

    const newBox = BOX2D.ByCenter(newPos, this.m_bitmapBase.GetSize());

    if (!IsBOX2Safe(newBox)) return;

    this.m_pos = newPos;
    this.m_bitmapBase.Mirror(aFlipDirection);
  }

  Rotate(aCenter: VECTOR2I, aAngle: EDA_ANGLE): void {
    const norm = new EDA_ANGLE(aAngle.AsDegrees(), EDA_ANGLE_T.DEGREES_T);

    this.m_pos = RotatePoint(this.m_pos, aCenter, aAngle);

    norm.Normalize();

    // each call to m_bitmapBase->Rotate() rotates 90 degrees
    for (let ang = 45.0; ang < norm.AsDegrees(); ang += 90.0) this.m_bitmapBase.Rotate(true);
  }

  /**
   * Read and store an image file.
   *
   * Initialize the bitmap format used to draw this item.  Supported images formats are format
   * supported by wxImage if all handlers are loaded.  By default, .png, .jpeg are always loaded.
   *
   * @param aBuffer a memory buffer containing the file data.
   * @return true if success reading else false.
   */
  ReadImageFile(aBuffer: Uint8Array): boolean {
    if (this.m_bitmapBase.ReadImageFile(aBuffer)) {
      this.updatePixelSizeInIU();
      return true;
    }

    return false;
  }

  /**
   * Set the image from an existing wxImage.
   */
  SetImage(aImage: WX_IMAGE): boolean {
    if (this.m_bitmapBase.SetImage(aImage)) {
      this.updatePixelSizeInIU();
      return true;
    }

    return false;
  }

  /**
   * Only use this if you really need to modify the underlying image
   */
  GetImage(): BITMAP_BASE {
    // This cannot be null after construction
    return this.m_bitmapBase;
  }

  MutableImage(): BITMAP_BASE {
    return this.m_bitmapBase;
  }

  SwapData(aOther: REFERENCE_IMAGE): void {
    [this.m_pos, aOther.m_pos] = [aOther.m_pos, this.m_pos];
    [this.m_transformOriginOffset, aOther.m_transformOriginOffset] = [
      aOther.m_transformOriginOffset,
      this.m_transformOriginOffset,
    ];
    [this.m_bitmapBase, aOther.m_bitmapBase] = [aOther.m_bitmapBase, this.m_bitmapBase];
  }
}

/**
 * `REFERENCE_IMAGE::updatePixelSizeInIU`: the internal units one image pixel spans,
 * `m_iuScale.MilsToIU( 1000 ) / m_bitmapBase->GetPPI()`.
 *
 * @deprecated the plain-record image readers' form; a `REFERENCE_IMAGE` carries
 * this in its `BITMAP_BASE` (`GetImage().GetPixelSizeIu()`). Goes with the
 * plain-object image geometry (#636).
 */
export function pixelSizeIu(aIuScale: EdaIuScale, aPPI: number): number {
  return aIuScale.milsToIU(1000) / aPPI;
}

/**
 * `BITMAP_BASE::GetSize()` along one axis: `pixels * GetScalingFactor()`,
 * where `GetScalingFactor()` is `m_pixelSizeIu * m_scale`.
 *
 * @deprecated the plain-record image readers' form; see {@link pixelSizeIu}.
 */
export function bitmapSizeIu(
  aIuScale: EdaIuScale,
  aPixels: number,
  aPPI: number,
  aScale: number,
): number {
  return aPixels * pixelSizeIu(aIuScale, aPPI) * aScale;
}
