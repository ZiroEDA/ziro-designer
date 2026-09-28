// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `gerbview/gerber_file_image_list.h` + `.cpp`: `GERBER_FILE_IMAGE_LIST`, the
 * images (one per loaded file) a GerbView holds — GERBER_DRAWLAYERS_COUNT
 * slots, some empty — and the two ways of ordering them, by file extension
 * and by X2 file function.
 *
 * `GetImagesList()` is KiCad's process-wide list (`s_GERBER_List`). The frame
 * still keeps its layers in its own React state (the frame is waiting, see
 * STRUCTURE.md), and sorts them with {@link sortFileExtension} and
 * {@link sortZorder} through {@link asComparator}.
 *
 * `std::sort` is not stable and a JS sort is: a real difference, visible only
 * on ties. Ties are common — `.GBR` maps to BOARD_OUTLINE, so every file of a
 * modern KiCad plot ties — and upstream leaves those in whatever permutation
 * std::sort produces; a stable sort leaves them in load order, the one
 * deterministic answer inside the range the C++ allows.
 */
import { GERBER_DRAWLAYERS_COUNT } from '@ziroeda/common/layer_id.js';
import type { GERBER_FILE_IMAGE } from './gerber_file_image.js';
import { strtol10 } from './libc.js';

/**
 * `GERBER_ORDER_ENUM`: the numbering is the sort key — `return (int)
 * ref_layer < (int) test_layer` — so the order of these members IS the order
 * of the layers manager. Drill first, unknown last.
 */
export enum GERBER_ORDER_ENUM {
  GERBER_DRILL = 0,
  GERBER_BOARD_OUTLINE,
  GERBER_KEEP_OUT,
  GERBER_MECHANICAL,
  GERBER_TOP_PASTE,
  GERBER_TOP_SILK_SCREEN,
  GERBER_TOP_SOLDER_MASK,
  GERBER_TOP_COPPER,
  GERBER_INNER,
  GERBER_BOTTOM_COPPER,
  GERBER_BOTTOM_SOLDER_MASK,
  GERBER_BOTTOM_SILK_SCREEN,
  GERBER_BOTTOM_PASTE,
  GERBER_LAYER_UNKNOWN,
}

/** `LayerSortFunction`: a C++ `std::sort` less-than on two images. */
export type LayerSortFunction = (
  ref: GERBER_FILE_IMAGE | null,
  test: GERBER_FILE_IMAGE | null,
) => boolean;

/**
 * `gerberFileExtensionOrder[]`, verbatim and in upstream's order, which
 * matters: the search returns on the FIRST match. `.GPI` is listed only to
 * stop an Eagle file matching something else, and the inner-copper globs
 * "need to come last so the wildcard number matching doesn't pick up other
 * specific layer names".
 *
 * [data]: KiCad's own table. Not to be tidied, deduplicated or reordered — the
 * duplicate `.SMB` and `MB.PHO` rows (bottom solder mask, then bottom paste)
 * and the twice-listed `.BOT` are upstream's.
 */
const gerberFileExtensionOrder: readonly [string, GERBER_ORDER_ENUM][] = [
  ['.GM1', GERBER_ORDER_ENUM.GERBER_BOARD_OUTLINE],
  ['.GM3', GERBER_ORDER_ENUM.GERBER_BOARD_OUTLINE],
  ['.GBR', GERBER_ORDER_ENUM.GERBER_BOARD_OUTLINE],
  ['.DIM', GERBER_ORDER_ENUM.GERBER_BOARD_OUTLINE],
  ['.MIL', GERBER_ORDER_ENUM.GERBER_BOARD_OUTLINE],
  ['.GML', GERBER_ORDER_ENUM.GERBER_BOARD_OUTLINE],
  ['EDGE.CUTS', GERBER_ORDER_ENUM.GERBER_BOARD_OUTLINE],
  ['.FAB', GERBER_ORDER_ENUM.GERBER_BOARD_OUTLINE],

  ['.GKO', GERBER_ORDER_ENUM.GERBER_KEEP_OUT],

  ['.GM?', GERBER_ORDER_ENUM.GERBER_MECHANICAL],
  ['.GM??', GERBER_ORDER_ENUM.GERBER_MECHANICAL],

  ['.TXT', GERBER_ORDER_ENUM.GERBER_DRILL],
  ['.XLN', GERBER_ORDER_ENUM.GERBER_DRILL],
  ['.TAP', GERBER_ORDER_ENUM.GERBER_DRILL],
  ['.DRD', GERBER_ORDER_ENUM.GERBER_DRILL],
  ['.DRL', GERBER_ORDER_ENUM.GERBER_DRILL],
  ['.NC', GERBER_ORDER_ENUM.GERBER_DRILL],
  ['.XNC', GERBER_ORDER_ENUM.GERBER_DRILL],

  ['.GTP', GERBER_ORDER_ENUM.GERBER_TOP_PASTE],
  ['.CRC', GERBER_ORDER_ENUM.GERBER_TOP_PASTE],
  ['.TSP', GERBER_ORDER_ENUM.GERBER_TOP_PASTE],
  ['F.PASTE', GERBER_ORDER_ENUM.GERBER_TOP_PASTE],
  ['.SPT', GERBER_ORDER_ENUM.GERBER_TOP_PASTE],
  ['PT.PHO', GERBER_ORDER_ENUM.GERBER_TOP_PASTE],

  ['.GTO', GERBER_ORDER_ENUM.GERBER_TOP_SILK_SCREEN],
  ['.PLC', GERBER_ORDER_ENUM.GERBER_TOP_SILK_SCREEN],
  ['.TSK', GERBER_ORDER_ENUM.GERBER_TOP_SILK_SCREEN],
  ['F.SILKS', GERBER_ORDER_ENUM.GERBER_TOP_SILK_SCREEN],
  ['.SST', GERBER_ORDER_ENUM.GERBER_TOP_SILK_SCREEN],
  ['ST.PHO', GERBER_ORDER_ENUM.GERBER_TOP_SILK_SCREEN],

  ['.GTS', GERBER_ORDER_ENUM.GERBER_TOP_SOLDER_MASK],
  ['.STC', GERBER_ORDER_ENUM.GERBER_TOP_SOLDER_MASK],
  ['.TSM', GERBER_ORDER_ENUM.GERBER_TOP_SOLDER_MASK],
  ['F.MASK', GERBER_ORDER_ENUM.GERBER_TOP_SOLDER_MASK],
  ['.SMT', GERBER_ORDER_ENUM.GERBER_TOP_SOLDER_MASK],
  ['MT.PHO', GERBER_ORDER_ENUM.GERBER_TOP_SOLDER_MASK],

  ['.GTL', GERBER_ORDER_ENUM.GERBER_TOP_COPPER],
  ['.CMP', GERBER_ORDER_ENUM.GERBER_TOP_COPPER],
  ['.TOP', GERBER_ORDER_ENUM.GERBER_TOP_COPPER],
  ['F.CU', GERBER_ORDER_ENUM.GERBER_TOP_COPPER],
  ['L1.PHO', GERBER_ORDER_ENUM.GERBER_TOP_COPPER],
  ['.PHD', GERBER_ORDER_ENUM.GERBER_TOP_COPPER],
  ['.ART', GERBER_ORDER_ENUM.GERBER_TOP_COPPER],

  ['.GBL', GERBER_ORDER_ENUM.GERBER_BOTTOM_COPPER],
  ['.SOL', GERBER_ORDER_ENUM.GERBER_BOTTOM_COPPER],
  ['.BOT', GERBER_ORDER_ENUM.GERBER_BOTTOM_COPPER],
  ['B.CU', GERBER_ORDER_ENUM.GERBER_BOTTOM_COPPER],
  ['.BOT', GERBER_ORDER_ENUM.GERBER_BOTTOM_COPPER],

  ['.GBS', GERBER_ORDER_ENUM.GERBER_BOTTOM_SOLDER_MASK],
  ['.STS', GERBER_ORDER_ENUM.GERBER_BOTTOM_SOLDER_MASK],
  ['.BSM', GERBER_ORDER_ENUM.GERBER_BOTTOM_SOLDER_MASK],
  ['B.MASK', GERBER_ORDER_ENUM.GERBER_BOTTOM_SOLDER_MASK],
  ['.SMB', GERBER_ORDER_ENUM.GERBER_BOTTOM_SOLDER_MASK],
  ['MB.PHO', GERBER_ORDER_ENUM.GERBER_BOTTOM_SOLDER_MASK],

  ['.GBO', GERBER_ORDER_ENUM.GERBER_BOTTOM_SILK_SCREEN],
  ['.PLS', GERBER_ORDER_ENUM.GERBER_BOTTOM_SILK_SCREEN],
  ['.BSK', GERBER_ORDER_ENUM.GERBER_BOTTOM_SILK_SCREEN],
  ['B.SILK', GERBER_ORDER_ENUM.GERBER_BOTTOM_SILK_SCREEN],
  ['.SSB', GERBER_ORDER_ENUM.GERBER_BOTTOM_SILK_SCREEN],
  ['SB.PHO', GERBER_ORDER_ENUM.GERBER_BOTTOM_SILK_SCREEN],

  ['.GBP', GERBER_ORDER_ENUM.GERBER_BOTTOM_PASTE],
  ['.CRS', GERBER_ORDER_ENUM.GERBER_BOTTOM_PASTE],
  ['.BSP', GERBER_ORDER_ENUM.GERBER_BOTTOM_PASTE],
  ['B.PASTE', GERBER_ORDER_ENUM.GERBER_BOTTOM_PASTE],
  ['.SMB', GERBER_ORDER_ENUM.GERBER_BOTTOM_PASTE],
  ['MB.PHO', GERBER_ORDER_ENUM.GERBER_BOTTOM_PASTE],

  // "EAGLE CAD file to explicitly ignore that can match some other layers
  // otherwise"
  ['.GPI', GERBER_ORDER_ENUM.GERBER_LAYER_UNKNOWN],

  // "Inner copper layers need to come last so the wildcard number matching
  // doesn't pick up other specific layer names."
  ['.GI?', GERBER_ORDER_ENUM.GERBER_INNER],
  ['.GI??', GERBER_ORDER_ENUM.GERBER_INNER],
  ['.G?', GERBER_ORDER_ENUM.GERBER_INNER],
  ['.G??', GERBER_ORDER_ENUM.GERBER_INNER],
  ['.G?L', GERBER_ORDER_ENUM.GERBER_INNER],
  ['.G??L', GERBER_ORDER_ENUM.GERBER_INNER],
];

/**
 * `wxString::Matches`, for the masks in the table above: `?` is any single
 * character, `*` any sequence.
 */
function matchesMask(text: string, mask: string): boolean {
  const pattern = mask
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\?/g, '.')
    .replace(/\*/g, '.*');
  return new RegExp(`^${pattern}$`, 's').test(text);
}

/** `wxFileName( name ).GetFullName()`: the name without its directory. */
function fullName(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
}

/**
 * `wxString::ToULong` over the digits of a matched extension, every non-digit
 * blanked first; the value strtoul reads, even if the call reports failure
 * on the trailing blanks.
 */
function extensionNumber(ext: string): number {
  const blanked = ext.replace(/[^0-9]/g, ' ');
  return strtol10(blanked, 0).value;
}

/**
 * `sortFileExtension`: a less-than on two images, by the layer their file
 * name suggests. Two inner copper layers compare on the digits of the matched
 * mask, which is what keeps `.G1` above `.G10`.
 */
export function sortFileExtension(
  ref: GERBER_FILE_IMAGE | null,
  test: GERBER_FILE_IMAGE | null,
): boolean {
  // Do not change order: no criteria to sort items
  if (!ref && !test) return false;

  // Not used: ref ordered after
  if (!ref || !ref.m_InUse) return false;

  // Not used: ref ordered before
  if (!test || !test.m_InUse) return true;

  const r = GERBER_FILE_IMAGE_LIST.GetGerberLayerFromFilename(ref.m_FileName);
  const t = GERBER_FILE_IMAGE_LIST.GetGerberLayerFromFilename(test.m_FileName);

  // Inner layers have a numeric code that we can compare against
  if (r.order === GERBER_ORDER_ENUM.GERBER_INNER && t.order === GERBER_ORDER_ENUM.GERBER_INNER) {
    // Strip extensions down to only the numbers in it. Later conversion to int will
    // automatically skip the spaces
    return extensionNumber(r.matchedExtension) < extensionNumber(t.matchedExtension);
  }

  return r.order < t.order;
}

/**
 * `sortZorder`: a less-than on two images by the X2 file function's z order,
 * DESCENDING on both keys. An image with no file function sorts after one
 * with, and two without keep their place.
 */
export function sortZorder(ref: GERBER_FILE_IMAGE | null, test: GERBER_FILE_IMAGE | null): boolean {
  if (!ref && !test) return false; // do not change order: no criteria to sort items

  if (!ref || !ref.m_InUse) return false; // Not used: ref ordered after

  if (!test || !test.m_InUse) return true; // Not used: ref ordered before

  if (!ref.m_FileFunction && !test.m_FileFunction) return false; // do not change order

  if (!ref.m_FileFunction) return false;

  if (!test.m_FileFunction) return true;

  if (ref.m_FileFunction.GetZOrder() !== test.m_FileFunction.GetZOrder())
    return ref.m_FileFunction.GetZOrder() > test.m_FileFunction.GetZOrder();

  return ref.m_FileFunction.GetZSubOrder() > test.m_FileFunction.GetZSubOrder();
}

/** A `std::sort` less-than as an `Array.prototype.sort` comparator. */
export function asComparator<T>(less: (a: T, b: T) => boolean): (a: T, b: T) => number {
  return (a, b) => (less(a, b) ? -1 : less(b, a) ? 1 : 0);
}

/**
 * A helper class to handle the list of GERBER_FILE_IMAGE which are loaded and
 * can be displayed.
 */
export class GERBER_FILE_IMAGE_LIST {
  /** The list of loaded images (1 image = 1 gerber file). */
  private m_GERBER_List: (GERBER_FILE_IMAGE | null)[] = [];

  constructor() {
    for (let layer = 0; layer < GERBER_DRAWLAYERS_COUNT; ++layer) this.m_GERBER_List.push(null);
  }

  /**
   * Which PCB layer a gerber/drill file corresponds to, guessed from its file
   * name: the LAST n characters, upper cased, against each mask of length n —
   * not an extension in any real sense, which is why `EDGE.CUTS` and `F.PASTE`
   * can be masks at all.
   */
  static GetGerberLayerFromFilename(filename: string): {
    order: GERBER_ORDER_ENUM;
    matchedExtension: string;
  } {
    for (const [mask, order] of gerberFileExtensionOrder) {
      const ext = filename.slice(Math.max(0, filename.length - mask.length)).toUpperCase();

      if (matchesMask(ext, mask)) return { order, matchedExtension: ext };
    }

    return { order: GERBER_ORDER_ENUM.GERBER_LAYER_UNKNOWN, matchedExtension: '' };
  }

  /** The global image list (`s_GERBER_List`). */
  static GetImagesList(): GERBER_FILE_IMAGE_LIST {
    return s_GERBER_List;
  }

  GetGbrImage(aIdx: number): GERBER_FILE_IMAGE | null {
    if (aIdx >= 0 && aIdx < this.m_GERBER_List.length) return this.m_GERBER_List[aIdx] ?? null;

    return null;
  }

  ImagesMaxCount(): number {
    return this.m_GERBER_List.length;
  }

  /**
   * Add an image at index `aIdx`, or at the first free location if `aIdx < 0`.
   * @return the index used, or -1 if there is no room.
   */
  AddGbrImage(aGbrImage: GERBER_FILE_IMAGE, aIdx: number): number {
    let idx = aIdx;

    if (idx < 0) {
      for (idx = 0; idx < this.m_GERBER_List.length; idx++) {
        if (this.m_GERBER_List[idx] === null) break;
      }
    }

    if (idx >= this.m_GERBER_List.length) return -1; // No room

    this.m_GERBER_List[idx] = aGbrImage;

    return idx;
  }

  /** Remove all loaded data in list. */
  DeleteAllImages(): void {
    for (let idx = 0; idx < this.m_GERBER_List.length; ++idx) this.DeleteImage(idx);
  }

  /** Delete the loaded data of image `aIdx`. */
  DeleteImage(aIdx: number): void {
    // Ensure the index is valid:
    if (aIdx < 0 || aIdx >= this.m_GERBER_List.length) return;

    // delete image aIdx
    this.m_GERBER_List[aIdx] = null;
  }

  /**
   * The display name of layer `aIdx`: `<aIdx+1> <short filename> <X2 file
   * function info>` for a loaded file (the number omitted with `aNameOnly`),
   * else "Graphic layer n".
   *
   * @param aFullName false to ellipsize a name longer than 30 characters.
   */
  GetDisplayName(aIdx: number, aNameOnly = false, aFullName = false): string {
    let name: string;

    let gerber: GERBER_FILE_IMAGE | null = null;

    if (aIdx >= 0 && aIdx < this.m_GERBER_List.length) gerber = this.m_GERBER_List[aIdx] ?? null;

    // if a file is loaded, build the name:
    // <id> <short filename> <X2 FileFunction info> if a X2 FileFunction info is found
    // or (if no FileFunction info)
    // <id> <short filename> *
    if (gerber) {
      let filename = fullName(gerber.m_FileName);

      // If the filename is too long, display a shortened name if requested
      const maxlen = 30;

      if (!aFullName && filename.length > maxlen) {
        const shortenedfn = `${filename.slice(0, 2)}...${filename.slice(filename.length - (maxlen - 5))}`;
        filename = shortenedfn;
      }

      const ff = gerber.m_FileFunction;

      if (ff) {
        name = '';

        if (ff.IsCopper()) {
          name = `${filename} (${ff.GetFileType()}, ${ff.GetBrdLayerId()}, ${ff.GetBrdLayerSide()})`;
        }
        if (ff.IsDrillFile()) {
          name = `${filename} (${ff.GetFileType()},${ff.GetDrillLayerPair()},${ff.GetLPType()},${ff.GetRouteType()})`;
        } else {
          name = `${filename} (${ff.GetFileType()}, ${ff.GetBrdLayerId()})`;
        }
      } else {
        name = filename;
      }

      if (aNameOnly) return name;

      return `${aIdx + 1} ${name}`;
    }

    name = `Graphic layer ${aIdx + 1}`;

    return name;
  }

  /**
   * Sort the loaded images with `sortFunction`.
   * @return a mapping of old to new layer index.
   */
  SortImagesByFunction(sortFunction: LayerSortFunction): Map<number, number> {
    this.m_GERBER_List.sort(asComparator(sortFunction));
    return this.GetLayerRemap();
  }

  /** Sort loaded images by file extension matching. */
  SortImagesByFileExtension(): Map<number, number> {
    return this.SortImagesByFunction(sortFileExtension);
  }

  /** Sort loaded images by Z order priority, if they have the X2 FileFormat info. */
  SortImagesByZOrder(): Map<number, number> {
    return this.SortImagesByFunction(sortZorder);
  }

  /** Swap two images and their orders. */
  SwapImages(layer1: number, layer2: number): Map<number, number> {
    if (layer1 >= this.m_GERBER_List.length || layer2 >= this.m_GERBER_List.length)
      return new Map();

    const a = this.m_GERBER_List[layer1] ?? null;
    this.m_GERBER_List[layer1] = this.m_GERBER_List[layer2] ?? null;
    this.m_GERBER_List[layer2] = a;
    return this.GetLayerRemap();
  }

  /** Remove (and delete) an image, rotating the removed image to the end. */
  RemoveImage(layer: number): Map<number, number> {
    if (layer >= this.m_GERBER_List.length) return new Map();

    this.DeleteImage(layer);
    // Move deleted image to end of list, move all other images up
    const [removed] = this.m_GERBER_List.splice(layer, 1);
    this.m_GERBER_List.push(removed ?? null);
    return this.GetLayerRemap();
  }

  /** The number of loaded images. */
  GetLoadedImageCount(): number {
    return this.m_GERBER_List.filter((image) => image !== null).length;
  }

  /**
   * After the image order changed: renumber the images' graphic layers to
   * their new slots, and return the old-to-new map.
   */
  private GetLayerRemap(): Map<number, number> {
    // The image order has changed.
    // Graphic layer numbering must be updated to match the widgets layer order

    // Store the old/new graphic layer info:
    const tab_lyr = new Map<number, number>();

    for (let layer = 0; layer < this.m_GERBER_List.length; ++layer) {
      const gerber = this.m_GERBER_List[layer];

      if (!gerber) continue;

      tab_lyr.set(gerber.m_GraphicLayer, layer);
      gerber.m_GraphicLayer = layer;
    }

    return tab_lyr;
  }
}

/** The global image list. */
const s_GERBER_List = new GERBER_FILE_IMAGE_LIST();
