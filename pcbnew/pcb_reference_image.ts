// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_reference_image.h` / `pcb_reference_image.cpp`:
 * `PCB_REFERENCE_IMAGE`, a bitmap placed on the board to trace over, owning a
 * `REFERENCE_IMAGE`.
 *
 * Not here: `Serialize`/`Deserialize` (the kiapi protobuf surface) and
 * `PCB_REFERENCE_IMAGE_DESC`, the `PROPERTY_MANAGER` registration.
 *
 * Also carries the plain-record image-geometry helpers (moved from
 * pcbnew/image_geometry.ts): `iuPerPixel`, `imageSizeIU` and `imageBBox` work
 * over the board's `PcbImage` record rather than a built `PCB_REFERENCE_IMAGE`,
 * for callers that only have the file's plain data. They stay here rather than
 * in common/bitmap_base.ts or common/reference_image.ts because `PcbImage` is
 * pcbnew-only and `iuPerPixel` hardcodes the board's `pcbIUScale` — exactly the
 * per-editor specialisation eeschema keeps to itself in
 * eeschema/tools/image_size.ts, rather than splitting into common/.
 */

import type { EDA_DRAW_FRAME_LIKE } from '@ziroeda/common/eda_item.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import {
  BITMAP_LAYER_FOR,
  FLASHING,
  FlipLayer,
  GAL_LAYER_ID,
  LayerName,
  PCB_LAYER_ID,
} from '@ziroeda/common/layer_id.js';
import { pixelSizeIu, REFERENCE_IMAGE } from '@ziroeda/common/reference_image.js';
import type { UNITS_PROVIDER } from '@ziroeda/common/units_provider.js';
import { MSG_PANEL_ITEM } from '@ziroeda/common/widgets/msgpanel.js';
import { pngPPI, pngPixelSize } from '@ziroeda/common/wx/png_meta.js';
import { type FLIP_DIRECTION } from '@ziroeda/core/mirror.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import {
  KIGEOM_BoxHitTestBox,
  KIGEOM_BoxHitTestChain,
  KIGEOM_BoxHitTestPoint,
} from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import type { SHAPE } from '@ziroeda/kimath/src/geometry/shape.js';
import { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { SHAPE_RECT } from '@ziroeda/kimath/src/geometry/shape_rect.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { type VECTOR2I, add } from '@ziroeda/kimath/src/math/vector2.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import { HIGH_CONTRAST_MODE } from '@ziroeda/common/project/board_project_settings.js';
import { BOARD_ITEM } from './board_item.js';
import { COORD_TYPES_T } from '@ziroeda/common/origin_transforms.js';
import {
  ENUM_MAP,
  type INSPECTABLE_ITEM,
  NO_SETTER,
  PG_CHOICES,
  PROPERTY,
  PROPERTY_DISPLAY,
  PROPERTY_ENUM,
  TYPE_BOOL,
  TYPE_CAST,
  TYPE_COLOR4D,
  TYPE_DOUBLE,
  TYPE_INT,
  TYPE_OPT_INT,
  TYPE_STRING,
} from '@ziroeda/common/properties/property.js';
import { PROPERTY_MANAGER, REGISTER_TYPE } from '@ziroeda/common/properties/property_mgr.js';

import type { PCB_VIEW_FOR_LOD } from './pcb_shape.js';

/**
 * Object to handle a bitmap image that can be inserted in a PCB.
 */
export class PCB_REFERENCE_IMAGE extends BOARD_ITEM {
  private m_referenceImage: REFERENCE_IMAGE;

  constructor(
    aParent: BOARD_ITEM | null,
    aPos: VECTOR2I = { x: 0, y: 0 },
    aLayer: PCB_LAYER_ID = PCB_LAYER_ID.F_Cu,
  ) {
    super(aParent, KICAD_T.PCB_REFERENCE_IMAGE_T, aLayer);
    this.m_referenceImage = new REFERENCE_IMAGE(pcbIUScale);
    this.m_referenceImage.SetPosition(aPos);
  }

  /** `PCB_REFERENCE_IMAGE( const PCB_REFERENCE_IMAGE& )`. */
  static copyOf(aPCBBitmap: PCB_REFERENCE_IMAGE): PCB_REFERENCE_IMAGE {
    const copy = new PCB_REFERENCE_IMAGE(aPCBBitmap.GetParent());
    BOARD_ITEM.copyBase(copy, aPCBBitmap);
    copy.m_referenceImage = new REFERENCE_IMAGE(aPCBBitmap.m_referenceImage);
    return copy;
  }

  /** `operator=( const BOARD_ITEM& aItem )`. */
  assignReferenceImage(aItem: BOARD_ITEM): this {
    if (this.Type() !== aItem.Type()) {
      console.assert(
        false,
        `Cannot assign object type ${aItem.GetClass()} to type ${this.GetClass()}`,
      );
      return this;
    }

    if (aItem !== this) {
      this.assignBoardItem(aItem);

      const refImg = aItem as PCB_REFERENCE_IMAGE;
      this.m_referenceImage.assign(refImg.m_referenceImage);
    }

    return this;
  }

  override CopyFrom(aOther: BOARD_ITEM | null): void {
    if (!(aOther && aOther.Type() === KICAD_T.PCB_REFERENCE_IMAGE_T)) return; // wxCHECK

    this.assignReferenceImage(aOther);
  }

  static ClassOf(aItem: { Type(): KICAD_T } | null): boolean {
    return aItem !== null && KICAD_T.PCB_REFERENCE_IMAGE_T === aItem.Type();
  }

  GetReferenceImage(): REFERENCE_IMAGE {
    return this.m_referenceImage;
  }

  override Clone(): PCB_REFERENCE_IMAGE {
    return PCB_REFERENCE_IMAGE.copyOf(this);
  }

  protected override swapData(aItem: BOARD_ITEM): void {
    if (aItem.Type() !== KICAD_T.PCB_REFERENCE_IMAGE_T) return; // wxCHECK_RET( "cannot swap data" )

    const item = aItem as PCB_REFERENCE_IMAGE;

    [this.m_layer, item.m_layer] = [item.m_layer, this.m_layer];
    [this.m_isKnockout, item.m_isKnockout] = [item.m_isKnockout, this.m_isKnockout];
    [this.m_isLocked, item.m_isLocked] = [item.m_isLocked, this.m_isLocked];
    [this.m_flags, item.m_flags] = [item.m_flags, this.m_flags];
    [this.m_parent, item.m_parent] = [item.m_parent, this.m_parent];
    [this.m_forceVisible, item.m_forceVisible] = [item.m_forceVisible, this.m_forceVisible];
    this.m_referenceImage.SwapData(item.m_referenceImage);
  }

  override ViewGetLOD(aLayer: number, aView: PCB_VIEW_FOR_LOD | null): number {
    const renderSettings = aView!.GetPainter().GetSettings();

    // All bitmaps are drawn on LAYER_DRAW_BITMAPS, but their
    // associated board layer controls their visibility.
    if (!this.GetBoard()!.IsLayerVisible(this.m_layer)) return PCB_REFERENCE_IMAGE.LOD_HIDE;

    if (
      renderSettings.GetHighContrast() &&
      renderSettings.m_ContrastModeDisplay === HIGH_CONTRAST_MODE.HIDDEN &&
      !renderSettings.GetLayerIsHighContrast(this.m_layer)
    ) {
      return PCB_REFERENCE_IMAGE.LOD_HIDE;
    }

    if (aView!.IsLayerVisible(GAL_LAYER_ID.LAYER_DRAW_BITMAPS)) return PCB_REFERENCE_IMAGE.LOD_SHOW;

    return PCB_REFERENCE_IMAGE.LOD_HIDE;
  }

  override GetBoundingBox(): BOX2I {
    return this.m_referenceImage.GetBoundingBox();
  }

  override GetEffectiveShape(
    aLayer: PCB_LAYER_ID = PCB_LAYER_ID.UNDEFINED_LAYER,
    aFlash: FLASHING = FLASHING.DEFAULT,
  ): SHAPE {
    const box = this.GetBoundingBox();
    return new SHAPE_RECT(box.GetPosition(), box.GetWidth(), box.GetHeight());
  }

  override GetPosition(): VECTOR2I {
    return this.m_referenceImage.GetPosition();
  }

  override SetPosition(aPos: VECTOR2I): void {
    this.m_referenceImage.SetPosition(aPos);
  }

  override Move(aMoveVector: VECTOR2I): void {
    // Defer to SetPosition to check the new position overflow
    this.SetPosition(add(this.GetPosition(), aMoveVector));
  }

  override Flip(aCentre: VECTOR2I, aFlipDirection: FLIP_DIRECTION): void {
    this.m_referenceImage.Flip(aCentre, aFlipDirection);

    const board = this.GetBoard();

    if (board) this.SetLayer(board.FlipLayer(this.GetLayer()));
    else this.SetLayer(FlipLayer(this.GetLayer()));
  }

  override Rotate(aCenter: VECTOR2I, aAngle: EDA_ANGLE): void {
    this.m_referenceImage.Rotate(aCenter, aAngle);
  }

  override HitTest(aPosition: VECTOR2I, aAccuracy?: number): boolean;
  override HitTest(aRect: BOX2I, aContained: boolean, aAccuracy?: number): boolean;
  override HitTest(aPoly: SHAPE_LINE_CHAIN, aContained: boolean): boolean;
  override HitTest(
    a: VECTOR2I | BOX2I | SHAPE_LINE_CHAIN,
    b?: number | boolean,
    c?: number,
  ): boolean {
    if (a instanceof BOX2I)
      return KIGEOM_BoxHitTestBox(a, this.GetBoundingBox(), b as boolean, c ?? 0);

    if (a instanceof SHAPE_LINE_CHAIN)
      return KIGEOM_BoxHitTestChain(a, this.GetBoundingBox(), b as boolean);

    return KIGEOM_BoxHitTestPoint(a, this.GetBoundingBox(), (b as number | undefined) ?? 0);
  }

  override GetMenuImage(): string {
    return 'image'; // BITMAPS::image
  }

  override GetMsgPanelInfo(aFrame: EDA_DRAW_FRAME_LIKE, aList: MSG_PANEL_ITEM[]): void {
    aList.push(new MSG_PANEL_ITEM('Reference Image', ''));

    aList.push(new MSG_PANEL_ITEM('PPI', `${this.m_referenceImage.GetImage().GetPPI()} `));
    aList.push(new MSG_PANEL_ITEM('Scale', `${this.m_referenceImage.GetImageScale().toFixed(6)} `));

    aList.push(
      new MSG_PANEL_ITEM('Width', aFrame.MessageTextFromValue(this.m_referenceImage.GetSize().x)),
    );
    aList.push(
      new MSG_PANEL_ITEM('Height', aFrame.MessageTextFromValue(this.m_referenceImage.GetSize().y)),
    );
    aList.push(new MSG_PANEL_ITEM('Layer', LayerName(this.m_layer)));
  }

  override GetItemDescription(aUnitsProvider: UNITS_PROVIDER | null, aFull: boolean): string {
    return 'Reference Image';
  }

  override ViewGetLayers(): number[] {
    return [BITMAP_LAYER_FOR(this.m_layer)];
  }

  GetClass(): string {
    return 'PCB_REFERENCE_IMAGE';
  }

  /** `operator==( const BOARD_ITEM& )`. */
  equals(aBoardItem: BOARD_ITEM): boolean {
    if (aBoardItem.Type() !== this.Type()) return false;

    const other = aBoardItem as PCB_REFERENCE_IMAGE;

    return this.equalsReferenceImage(other);
  }

  /** `operator==( const PCB_REFERENCE_IMAGE& )`. */
  equalsReferenceImage(aOther: PCB_REFERENCE_IMAGE): boolean {
    if (this.m_layer !== aOther.m_layer) return false;

    if (!this.m_referenceImage.equals(aOther.m_referenceImage)) return false;

    return true;
  }

  Similarity(aOther: BOARD_ITEM): number {
    if (aOther.Type() !== this.Type()) return 0.0;

    const other = aOther as PCB_REFERENCE_IMAGE;

    let similarity = 1.0;

    if (this.m_layer !== other.m_layer) similarity *= 0.9;

    similarity *= this.m_referenceImage.Similarity(other.m_referenceImage);

    return similarity;
  }

  // Property manager accessors

  GetTransformOriginOffsetX(): number {
    return this.m_referenceImage.GetTransformOriginOffset().x;
  }

  SetTransformOriginOffsetX(aX: number): void {
    const offset = { ...this.m_referenceImage.GetTransformOriginOffset() };
    offset.x = aX;
    this.m_referenceImage.SetTransformOriginOffset(offset);
  }

  GetTransformOriginOffsetY(): number {
    return this.m_referenceImage.GetTransformOriginOffset().y;
  }

  SetTransformOriginOffsetY(aY: number): void {
    const offset = { ...this.m_referenceImage.GetTransformOriginOffset() };
    offset.y = aY;
    this.m_referenceImage.SetTransformOriginOffset(offset);
  }

  GetImageScale(): number {
    return this.m_referenceImage.GetImageScale();
  }

  SetImageScale(aScale: number): void {
    this.m_referenceImage.SetImageScale(aScale);
  }

  GetWidth(): number {
    return this.m_referenceImage.GetImage().GetSize().x;
  }

  SetWidth(aWidth: number): void {
    this.m_referenceImage.SetWidth(aWidth);
  }

  GetHeight(): number {
    return this.m_referenceImage.GetImage().GetSize().y;
  }

  SetHeight(aHeight: number): void {
    this.m_referenceImage.SetHeight(aHeight);
  }
}

/**
 * `static struct PCB_REFERENCE_IMAGE_DESC` (pcbnew/pcb_reference_image.cpp).
 */
(() => {
  const propMgr = PROPERTY_MANAGER.Instance();
  REGISTER_TYPE(PCB_REFERENCE_IMAGE);
  propMgr.InheritsAfter(PCB_REFERENCE_IMAGE, BOARD_ITEM);

  propMgr.ReplaceProperty(
    BOARD_ITEM,
    'Layer',
    new PROPERTY_ENUM<PCB_REFERENCE_IMAGE, PCB_LAYER_ID, BOARD_ITEM>(
      PCB_REFERENCE_IMAGE,
      'Associated Layer',
      'SetLayer',
      'GetLayer',
      ENUM_MAP.Instance<PCB_LAYER_ID>('PCB_LAYER_ID'),
      PROPERTY_DISPLAY.PT_DEFAULT,
      COORD_TYPES_T.NOT_A_COORD,
      BOARD_ITEM,
    ),
  );

  const groupImage = 'Image Properties';

  propMgr.AddProperty(
    new PROPERTY<PCB_REFERENCE_IMAGE, number>(
      PCB_REFERENCE_IMAGE,
      'Scale',
      'SetImageScale',
      'GetImageScale',
      TYPE_DOUBLE,
    ),
    groupImage,
  );

  propMgr.AddProperty(
    new PROPERTY<PCB_REFERENCE_IMAGE, number>(
      PCB_REFERENCE_IMAGE,
      'Transform Offset X',
      'SetTransformOriginOffsetX',
      'GetTransformOriginOffsetX',
      TYPE_INT,
      PROPERTY_DISPLAY.PT_COORD,
      COORD_TYPES_T.ABS_X_COORD,
    ),
    groupImage,
  );

  propMgr.AddProperty(
    new PROPERTY<PCB_REFERENCE_IMAGE, number>(
      PCB_REFERENCE_IMAGE,
      'Transform Offset Y',
      'SetTransformOriginOffsetY',
      'GetTransformOriginOffsetY',
      TYPE_INT,
      PROPERTY_DISPLAY.PT_COORD,
      COORD_TYPES_T.ABS_Y_COORD,
    ),
    groupImage,
  );

  propMgr.AddProperty(
    new PROPERTY<PCB_REFERENCE_IMAGE, number>(
      PCB_REFERENCE_IMAGE,
      'Width',
      'SetWidth',
      'GetWidth',
      TYPE_INT,
      PROPERTY_DISPLAY.PT_COORD,
    ),
    groupImage,
  );

  propMgr.AddProperty(
    new PROPERTY<PCB_REFERENCE_IMAGE, number>(
      PCB_REFERENCE_IMAGE,
      'Height',
      'SetHeight',
      'GetHeight',
      TYPE_INT,
      PROPERTY_DISPLAY.PT_COORD,
    ),
    groupImage,
  );

  // For future use
  const greyscale = 'Greyscale';
  void greyscale;
})();

// ---------------------------------------------------------------------------
// Plain-record image geometry: how much board a `PcbImage` covers, without
// building a `PCB_REFERENCE_IMAGE`.
// ---------------------------------------------------------------------------
/**
 * How much board a reference image covers.
 * Counterparts: `BITMAP_BASE::GetSize`, `REFERENCE_IMAGE::GetBoundingBox` and
 * `PCB_REFERENCE_IMAGE::HitTest`.
 *
 * ## The image is centred on its position
 *
 * `(at …)` is the *middle* of the picture, not a corner — `GetBoundingBox`
 * builds the box from the centre outwards. Treating it as a top-left corner
 * would put every image half its own size out of place, consistently enough to
 * look deliberate.
 *
 * ## Pixels become board units through the file's own resolution
 *
 * A pixel spans `25.4 mm / ppi`, where ppi comes from the PNG's `pHYs` chunk
 * and falls back to `BITMAP_BASE`'s 300. That is then multiplied by `(scale …)`.
 * So the same picture at 600 ppi covers half the board that it does at 300, and
 * the scale factor is on top of that rather than instead of it.
 *
 * Board internal units are nanometres, which is why this cannot reuse the
 * schematic's IU-per-pixel: there an IU is 100 nm.
 *
 * There is no `hitTestImage` here. `boardHitCandidates` needs the *distance* to
 * the box for its size ranking rather than a boolean, so it measures against
 * `imageBBox` directly; a predicate was written and had no caller, so it is not
 * kept. Same call as the text box work.
 */

/**
 * The size a payload-less or unreadable image is given, so it stays selectable
 * rather than becoming an invisible zero-size item on the board.
 */
export const FALLBACK_PIXELS = { w: 40, h: 40 };

/**
 * The board's binding of `REFERENCE_IMAGE`, whose constructor takes the frame's
 * `EDA_IU_SCALE` (`PCB_REFERENCE_IMAGE::m_referenceImage`,
 * pcbnew/pcb_reference_image.h:138, is built with `pcbIUScale`). The arithmetic
 * is shared with the schematic, as `REFERENCE_IMAGE::updatePixelSizeInIU` is
 * upstream; only the scale is the board's.
 */
export function iuPerPixel(ppi: number): number {
  return pixelSizeIu(pcbIUScale, ppi);
}

/** `BITMAP_BASE::GetSize`: the image's extent in board IU. */
export function imageSizeIU(img: { data: string; scale?: number }): { w: number; h: number } {
  const px = pngPixelSize(img.data) ?? FALLBACK_PIXELS;
  const per = iuPerPixel(pngPPI(img.data));
  const scale = img.scale ?? 1;
  return { w: Math.round(px.w * per * scale), h: Math.round(px.h * per * scale) };
}

// --- BITMAP_BASE::m_bitmap / ImgToBitmap: the decode cache (was image_cache.ts) ---

/**
 * Decoded reference-image bitmaps, kept between frames.
 * Counterpart: `BITMAP_BASE::m_bitmap` / `ImgToBitmap`, and the OpenGL bitmap
 * cache `KIGFX::VIEW::RecacheAllItems` invalidates.
 *
 * ## Why the scene cannot hold the picture
 *
 * The board scene is `Path2D` geometry, built synchronously from the model.
 * Decoding a PNG is neither: `createImageBitmap` returns a promise, and the
 * result is a `CanvasImageSource` rather than a path. So the scene carries the
 * *record* — payload, layer and destination box — and this cache carries the
 * pixels, exactly as `netLabels` are carried as data because their glyphs
 * depend on the frame.
 *
 * ## Decoding is once per payload, not once per frame or per item
 *
 * The key is the base64 payload itself, so two images of the same picture
 * decode once, and panning does not decode anything. A decode in flight is
 * remembered too — without that, every frame drawn while the first decode is
 * still running starts another one, which on a large PNG is how a board with
 * one reference image ends up with dozens of concurrent decodes.
 *
 * ## A failed decode is remembered as a failure
 *
 * A payload that will not decode is recorded as `null` rather than left
 * unknown. Unknown means "try again", and trying again every frame turns one
 * corrupt image into a permanent stall. `null` also tells the paint pass to
 * fall back to outlining the extent, which is what a reference image looked
 * like before any of this existed.
 */

/** What a decoded payload is worth to the canvas, or `null` if it will not decode. */
export type DecodedImage = CanvasImageSource | null;

/** Injected so the cache can be exercised without a browser's image decoder. */
export type ImageDecoder = (bytes: Uint8Array) => Promise<CanvasImageSource>;

/**
 * base64 → bytes.
 *
 * `atob` is the browser's own decoder and what `FileReader.readAsDataURL`
 * pairs with; going through it rather than a hand-rolled alphabet keeps the
 * padding rules someone else's problem.
 *
 * It also keeps the *whitespace* rules there. That matters, because the file
 * format splits the payload across quoted lines and a reader that rejoins them
 * with newlines is within its rights — so this has to tolerate them. `atob` is
 * specified as forgiving-base64, which strips ASCII whitespace before decoding,
 * so no pre-cleaning is needed. I wrote a strip anyway and mutation testing
 * showed it dead; the test that pins the requirement stays.
 */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The browser decoder: bytes → `ImageBitmap`, through a PNG blob. */
const decodeWithBrowser: ImageDecoder = (bytes) =>
  createImageBitmap(new Blob([bytes as BlobPart], { type: 'image/png' }));

export class ReferenceImageCache {
  private readonly decoded = new Map<string, DecodedImage>();
  private readonly inFlight = new Set<string>();
  private readonly decode: ImageDecoder;

  constructor(decode: ImageDecoder = decodeWithBrowser) {
    this.decode = decode;
  }

  /** The bitmap for a payload: `undefined` while unknown, `null` once it has failed. */
  get(data: string): DecodedImage | undefined {
    return this.decoded.get(data);
  }

  /** Everything decoded so far, for handing to the paint pass. */
  get bitmaps(): ReadonlyMap<string, DecodedImage> {
    return this.decoded;
  }

  /**
   * Start decoding `data` if it is neither known nor already being decoded,
   * calling `onReady` when the answer changes — success or failure, since a
   * failure changes what gets painted too.
   */
  ensure(data: string, onReady: () => void): void {
    if (this.decoded.has(data) || this.inFlight.has(data)) return;
    this.inFlight.add(data);

    let bytes: Uint8Array;
    try {
      bytes = base64ToBytes(data);
    } catch {
      // Not even base64. Record the failure rather than retrying forever.
      this.inFlight.delete(data);
      this.decoded.set(data, null);
      onReady();
      return;
    }

    this.decode(bytes).then(
      (bitmap) => {
        this.inFlight.delete(data);
        this.decoded.set(data, bitmap);
        onReady();
      },
      () => {
        this.inFlight.delete(data);
        this.decoded.set(data, null);
        onReady();
      },
    );
  }
}
