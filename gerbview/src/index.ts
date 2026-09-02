// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * @ziroeda/gerbview, the Gerber/Excellon viewer engine, ported from KiCad's
 * `gerbview/`. Parses RS-274X Gerber and Excellon drill files into a typed
 * item model (GERBER_DRAW_ITEM) grouped into images (GERBER_FILE_IMAGE) and a
 * layout (GBR_LAYOUT), ready for a Canvas 2D renderer in the app.
 */

export * from './types.js';
export * from './aperture_macro.js';
export { D_CODE, APERTURE_DEF_HOLE } from './dcode.js';
export * from './gerber_draw_item.js';
export { GERBER_FILE_IMAGE, type CoordFormat } from './gerber_file_image.js';
export { parseGerber } from './gerber_file_image_parse.js';
export { parseExcellon, EXCELLON_STRUCT_DEFAULTS, type ExcellonDefaults } from './excellon.js';
export { GBR_LAYOUT } from './gbr_layout.js';
export {
  readGerberOrDrill,
  isExcellonFile,
  parseJobFile,
  type JobFileEntry,
} from './read_gerber.js';
export {
  GERBER_ORDER,
  GERBER_FILE_EXTENSION_ORDER,
  gerberLayerFromFilename,
  compareByFileExtension,
  compareByZOrder,
  zOrderOf,
} from './layer_sort.js';
export {
  testFileIsRS274,
  testFileIsExcellon,
  detectFileType,
  GBR_FILE_TYPE,
  type GbrFileType,
} from './file_detect.js';
