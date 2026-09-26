// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What decides the order of the layers manager —
 * `GERBER_FILE_IMAGE_LIST::SortImagesByFileExtension` and
 * `SortImagesByZOrder` (`gerbview/gerber_file_image_list.cpp:202-455`).
 *
 * GerbView has two sorts and applies one automatically at four call sites:
 *
 *   - a plain Open, but ONLY when nothing was loaded before —
 *     `bool isFirstFile = GetImagesList()->GetLoadedImageCount() == 0;` and
 *     then `if( isFirstFile ) { ... SortLayersByFileExtension(); ... }`
 *     (`gerbview/files.cpp:178-193`). A second Open adds to the list and leaves
 *     the order alone.
 *   - a zip: by X2 attributes when any gerber in it was X2, otherwise by file
 *     extension (`files.cpp:631-634`).
 *   - a job file: always by X2 attributes (`job_file_reader.cpp:235`).
 *   - and either one on demand, from the layers manager's right-click menu
 *     (`gerbview_layer_widget.cpp:253-259`).
 *
 * Ours did none of it: the layers sat in load order and both menu entries were
 * greyed out.
 */

/**
 * `GERBER_ORDER_ENUM` (`gerber_file_image_list.h:36-52`), and the numbering is
 * the sort key — `return (int) ref_layer < (int) test_layer` — so the order of
 * these members IS the order of the layers manager. Drill first, unknown last.
 */
export enum GERBER_ORDER {
  GERBER_DRILL = 0,
  GERBER_BOARD_OUTLINE = 1,
  GERBER_KEEP_OUT = 2,
  GERBER_MECHANICAL = 3,
  GERBER_TOP_PASTE = 4,
  GERBER_TOP_SILK_SCREEN = 5,
  GERBER_TOP_SOLDER_MASK = 6,
  GERBER_TOP_COPPER = 7,
  GERBER_INNER = 8,
  GERBER_BOTTOM_COPPER = 9,
  GERBER_BOTTOM_SOLDER_MASK = 10,
  GERBER_BOTTOM_SILK_SCREEN = 11,
  GERBER_BOTTOM_PASTE = 12,
  GERBER_LAYER_UNKNOWN = 13,
}

/**
 * `gerberFileExtensionOrder[]` (`gerber_file_image_list.cpp:210-304`), verbatim
 * and in upstream's order, which matters: the search returns on the FIRST
 * match, and the file is laid out with that in mind. Its own comments say so —
 * `.GPI` is listed only to stop an Eagle file matching something else, and the
 * inner-copper globs "need to come last so the wildcard number matching doesn't
 * pick up other specific layer names".
 *
 * [data]: KiCad's own table. Not to be tidied, deduplicated or reordered — the
 * duplicate `.SMB` and `.MB.PHO` rows (bottom solder mask, then bottom paste)
 * and the twice-listed `.BOT` are upstream's, and removing them would change
 * which branch wins.
 *
 * One consequence worth knowing before reading a sorted list: `.GBR` is the
 * third entry and maps to BOARD_OUTLINE, so **every** file from a modern KiCad
 * plot ties at BOARD_OUTLINE, whatever it holds. Only the drill files, which
 * end `.drl`, sort away from the pack — which is exactly what a live GerbView
 * shows for such a set: the drill file first and the rest in load order.
 */
export const GERBER_FILE_EXTENSION_ORDER: readonly [string, GERBER_ORDER][] = [
  ['.GM1', GERBER_ORDER.GERBER_BOARD_OUTLINE],
  ['.GM3', GERBER_ORDER.GERBER_BOARD_OUTLINE],
  ['.GBR', GERBER_ORDER.GERBER_BOARD_OUTLINE],
  ['.DIM', GERBER_ORDER.GERBER_BOARD_OUTLINE],
  ['.MIL', GERBER_ORDER.GERBER_BOARD_OUTLINE],
  ['.GML', GERBER_ORDER.GERBER_BOARD_OUTLINE],
  ['EDGE.CUTS', GERBER_ORDER.GERBER_BOARD_OUTLINE],
  ['.FAB', GERBER_ORDER.GERBER_BOARD_OUTLINE],

  ['.GKO', GERBER_ORDER.GERBER_KEEP_OUT],

  ['.GM?', GERBER_ORDER.GERBER_MECHANICAL],
  ['.GM??', GERBER_ORDER.GERBER_MECHANICAL],

  ['.TXT', GERBER_ORDER.GERBER_DRILL],
  ['.XLN', GERBER_ORDER.GERBER_DRILL],
  ['.TAP', GERBER_ORDER.GERBER_DRILL],
  ['.DRD', GERBER_ORDER.GERBER_DRILL],
  ['.DRL', GERBER_ORDER.GERBER_DRILL],
  ['.NC', GERBER_ORDER.GERBER_DRILL],
  ['.XNC', GERBER_ORDER.GERBER_DRILL],

  ['.GTP', GERBER_ORDER.GERBER_TOP_PASTE],
  ['.CRC', GERBER_ORDER.GERBER_TOP_PASTE],
  ['.TSP', GERBER_ORDER.GERBER_TOP_PASTE],
  ['F.PASTE', GERBER_ORDER.GERBER_TOP_PASTE],
  ['.SPT', GERBER_ORDER.GERBER_TOP_PASTE],
  ['PT.PHO', GERBER_ORDER.GERBER_TOP_PASTE],

  ['.GTO', GERBER_ORDER.GERBER_TOP_SILK_SCREEN],
  ['.PLC', GERBER_ORDER.GERBER_TOP_SILK_SCREEN],
  ['.TSK', GERBER_ORDER.GERBER_TOP_SILK_SCREEN],
  ['F.SILKS', GERBER_ORDER.GERBER_TOP_SILK_SCREEN],
  ['.SST', GERBER_ORDER.GERBER_TOP_SILK_SCREEN],
  ['ST.PHO', GERBER_ORDER.GERBER_TOP_SILK_SCREEN],

  ['.GTS', GERBER_ORDER.GERBER_TOP_SOLDER_MASK],
  ['.STC', GERBER_ORDER.GERBER_TOP_SOLDER_MASK],
  ['.TSM', GERBER_ORDER.GERBER_TOP_SOLDER_MASK],
  ['F.MASK', GERBER_ORDER.GERBER_TOP_SOLDER_MASK],
  ['.SMT', GERBER_ORDER.GERBER_TOP_SOLDER_MASK],
  ['MT.PHO', GERBER_ORDER.GERBER_TOP_SOLDER_MASK],

  ['.GTL', GERBER_ORDER.GERBER_TOP_COPPER],
  ['.CMP', GERBER_ORDER.GERBER_TOP_COPPER],
  ['.TOP', GERBER_ORDER.GERBER_TOP_COPPER],
  ['F.CU', GERBER_ORDER.GERBER_TOP_COPPER],
  ['L1.PHO', GERBER_ORDER.GERBER_TOP_COPPER],
  ['.PHD', GERBER_ORDER.GERBER_TOP_COPPER],
  ['.ART', GERBER_ORDER.GERBER_TOP_COPPER],

  ['.GBL', GERBER_ORDER.GERBER_BOTTOM_COPPER],
  ['.SOL', GERBER_ORDER.GERBER_BOTTOM_COPPER],
  ['.BOT', GERBER_ORDER.GERBER_BOTTOM_COPPER],
  ['B.CU', GERBER_ORDER.GERBER_BOTTOM_COPPER],
  ['.BOT', GERBER_ORDER.GERBER_BOTTOM_COPPER],

  ['.GBS', GERBER_ORDER.GERBER_BOTTOM_SOLDER_MASK],
  ['.STS', GERBER_ORDER.GERBER_BOTTOM_SOLDER_MASK],
  ['.BSM', GERBER_ORDER.GERBER_BOTTOM_SOLDER_MASK],
  ['B.MASK', GERBER_ORDER.GERBER_BOTTOM_SOLDER_MASK],
  ['.SMB', GERBER_ORDER.GERBER_BOTTOM_SOLDER_MASK],
  ['MB.PHO', GERBER_ORDER.GERBER_BOTTOM_SOLDER_MASK],

  ['.GBO', GERBER_ORDER.GERBER_BOTTOM_SILK_SCREEN],
  ['.PLS', GERBER_ORDER.GERBER_BOTTOM_SILK_SCREEN],
  ['.BSK', GERBER_ORDER.GERBER_BOTTOM_SILK_SCREEN],
  ['B.SILK', GERBER_ORDER.GERBER_BOTTOM_SILK_SCREEN],
  ['.SSB', GERBER_ORDER.GERBER_BOTTOM_SILK_SCREEN],
  ['SB.PHO', GERBER_ORDER.GERBER_BOTTOM_SILK_SCREEN],

  ['.GBP', GERBER_ORDER.GERBER_BOTTOM_PASTE],
  ['.CRS', GERBER_ORDER.GERBER_BOTTOM_PASTE],
  ['.BSP', GERBER_ORDER.GERBER_BOTTOM_PASTE],
  ['B.PASTE', GERBER_ORDER.GERBER_BOTTOM_PASTE],
  ['.SMB', GERBER_ORDER.GERBER_BOTTOM_PASTE],
  ['MB.PHO', GERBER_ORDER.GERBER_BOTTOM_PASTE],

  // "EAGLE CAD file to explicitly ignore that can match some other layers
  // otherwise"
  ['.GPI', GERBER_ORDER.GERBER_LAYER_UNKNOWN],

  // "Inner copper layers need to come last so the wildcard number matching
  // doesn't pick up other specific layer names."
  ['.GI?', GERBER_ORDER.GERBER_INNER],
  ['.GI??', GERBER_ORDER.GERBER_INNER],
  ['.G?', GERBER_ORDER.GERBER_INNER],
  ['.G??', GERBER_ORDER.GERBER_INNER],
  ['.G?L', GERBER_ORDER.GERBER_INNER],
  ['.G??L', GERBER_ORDER.GERBER_INNER],
];

/**
 * `wxString::Matches`, for the masks in the table above.
 *
 * Only `?` (any single character) appears in them, but `*` (any sequence) is
 * the other half of wx's glob and is implemented so that adding a mask that
 * uses it does not silently match nothing.
 */
function matchesMask(text: string, mask: string): boolean {
  const pattern = mask
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\?/g, '.')
    .replace(/\*/g, '.*');
  return new RegExp(`^${pattern}$`).test(text);
}

/**
 * `GERBER_FILE_IMAGE_LIST::GetGerberLayerFromFilename` (`:307-326`).
 *
 *     wxString ext = filename.Right( o.m_FilenameMask.length() ).Upper();
 *     if( ext.Matches( o.m_FilenameMask ) ) { order = o.m_Order; ... return; }
 *
 * The comparison is against the LAST n characters of the whole name, upper
 * cased, where n is the mask's own length — not against an extension in any
 * real sense, which is why `EDGE.CUTS` and `F.PASTE` can be masks at all.
 */
export function gerberLayerFromFilename(filename: string): {
  order: GERBER_ORDER;
  matchedExtension: string;
} {
  for (const [mask, order] of GERBER_FILE_EXTENSION_ORDER) {
    const ext = filename.slice(Math.max(0, filename.length - mask.length)).toUpperCase();
    if (matchesMask(ext, mask)) return { order, matchedExtension: ext };
  }
  return { order: GERBER_ORDER.GERBER_LAYER_UNKNOWN, matchedExtension: '' };
}

/**
 * `sortFileExtension` (`:329-380`), as a comparator returning a number.
 *
 * Two inner-copper layers compare on the digits of the matched mask rather
 * than on the enum, which is what keeps `.G1` above `.G10`. Upstream extracts
 * them by blanking every non-digit and letting `ToULong` skip the spaces, so a
 * mask with no digits at all reads as 0.
 */
export function compareByFileExtension(refName: string, testName: string): number {
  const ref = gerberLayerFromFilename(refName);
  const test = gerberLayerFromFilename(testName);

  if (ref.order === GERBER_ORDER.GERBER_INNER && test.order === GERBER_ORDER.GERBER_INNER) {
    return layerNumber(ref.matchedExtension) - layerNumber(test.matchedExtension);
  }
  return ref.order - test.order;
}

/** The digits of a matched mask, `ToULong` over a non-digit-blanked copy. */
function layerNumber(matchedExtension: string): number {
  const digits = matchedExtension.replace(/\D/g, '');
  return digits === '' ? 0 : Number.parseInt(digits, 10);
}

/**
 * `X2_ATTRIBUTE_FILEFUNCTION::set_Z_Order` (`X2_gerber_attributes.cpp:237-288`).
 *
 *     m_z_order = 100;  m_z_sub_order = 0;                  // high level
 *     if( IsCopper() )   { m_z_order = 0; m_z_sub_order = -Ln; }
 *     if( Soldermask )   { m_z_order = Bot ? -1 : 1; }
 *     if( Legend )       { m_z_order = Bot ? -2 : 2; }
 *     if( Paste )        { m_z_order = Bot ? -3 : 3; }
 *     if( Glue )         { m_z_order = Bot ? -4 : 4; }
 *
 * So everything that is not one of those five — Profile, Other, OtherDrawing,
 * AssemblyDrawing, a drill file — keeps 100 and ends up ABOVE the board stack,
 * and the copper layers sit in the middle ordered by their own number.
 *
 * `fileFunction` is the `%TF.FileFunction` value with the attribute name
 * already stripped, so field 0 is upstream's `Item( 1 )`.
 */
export function zOrderOf(fileFunction: string | null): { z: number; zSub: number } | null {
  if (fileFunction === null) return null;

  const p = fileFunction.split(',');
  const fileType = (p[0] ?? '').trim();
  const brdLayerId = (p[1] ?? '').trim();
  const is = (s: string): boolean => fileType.toLowerCase() === s.toLowerCase();
  const isBot = brdLayerId.toLowerCase() === 'bot';

  if (is('Copper')) {
    // "the priority is the layer Id": Ln, whose number becomes -n so that L1
    // sorts above L2 under the descending comparison below.
    const n = Number.parseInt(brdLayerId.slice(1), 10);
    return { z: 0, zSub: Number.isNaN(n) ? 0 : -n };
  }
  if (is('Soldermask')) return { z: isBot ? -1 : 1, zSub: 0 };
  if (is('Legend')) return { z: isBot ? -2 : 2, zSub: 0 };
  if (is('Paste')) return { z: isBot ? -3 : 3, zSub: 0 };
  if (is('Glue')) return { z: isBot ? -4 : 4, zSub: 0 };
  return { z: 100, zSub: 0 };
}

/**
 * `sortZorder` (`:385-411`), as a comparator returning a number.
 *
 * DESCENDING on both keys — `return ref->GetZOrder() > test->GetZOrder()` — and
 * an image with no file function at all keeps its place rather than being
 * pushed anywhere, because upstream returns false in both directions for that
 * pair and a false/false comparator is std::sort's "leave them alone".
 */
export function compareByZOrder(
  refFileFunction: string | null,
  testFileFunction: string | null,
): number {
  const ref = zOrderOf(refFileFunction);
  const test = zOrderOf(testFileFunction);

  // "do not change order: no criteria to sort items"
  if (!ref && !test) return 0;
  // `if( !ref->m_FileFunction ) return false;` — ref is never ordered first.
  if (!ref) return 1;
  // `if( !test->m_FileFunction ) return true;` — ref is always ordered first.
  if (!test) return -1;

  if (ref.z !== test.z) return test.z - ref.z;
  return test.zSub - ref.zSub;
}
