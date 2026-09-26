// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * @ziroeda/gerbview, KiCad's `gerbview/`: the RS-274X Gerber and Excellon
 * readers and the image model they build (GERBER_FILE_IMAGE of
 * GERBER_DRAW_ITEMs, D_CODEs and APERTURE_MACROs), the image list, the
 * layout, and the parts of the Gerber Viewer that have moved here from the
 * app. The package barrel; import a file by its KiCad name for anything else.
 */

export * from './gerbview.js';
export { GERBER_DRAWLAYERS_COUNT } from '@ziroeda/common/layer_id.js';
export { AM_PARAM, AM_PARAM_ITEM, AM_PARAM_EVAL, parm_item_type } from './am_param.js';
export { AM_PRIMITIVE, AM_PRIMITIVE_ID } from './am_primitive.js';
export { APERTURE_MACRO, type APERTURE_MACRO_SET } from './aperture_macro.js';
export { Evaluate } from './evaluate.js';
export {
  D_CODE,
  APERTURE_T,
  APERTURE_DEF_HOLETYPE,
  FIRST_DCODE,
  LAST_DCODE,
} from './dcode.js';
export { GBR_BASIC_SHAPE_TYPE, GERBER_DRAW_ITEM } from './gerber_draw_item.js';
export {
  GERBER_FILE_IMAGE,
  GERBER_LAYER,
  LAST_EXTRA_ARC_DATA_TYPE,
  GERBER_BUFZ,
  SortedKeys,
} from './gerber_file_image.js';
export {
  GERBER_FILE_IMAGE_LIST,
  GERBER_ORDER_ENUM,
  sortFileExtension,
  sortZorder,
  asComparator,
} from './gerber_file_image_list.js';
export { EXCELLON_IMAGE } from './excellon_read_drill_file.js';
export { EXCELLON_DEFAULTS } from './excellon_defaults.js';
export { X2_ATTRIBUTE, X2_ATTRIBUTE_FILEFUNCTION } from './X2_gerber_attributes.js';
export { GBR_NETLIST_METADATA, GBR_NETINFO_TYPE, GBR_DATA_FIELD } from './gbr_netlist_metadata.js';
export { GBR_LAYOUT } from './gbr_layout.js';
export { GERBER_JOBFILE_READER } from './job_file_reader.js';
export { GBR_FILE_TYPE, type GbrFileType, detectFileType } from './files.js';
export { GERBVIEW_PAINTER, GERBVIEW_RENDER_SETTINGS, gvconfig } from './gerbview_painter.js';
export { GERBVIEW_SETTINGS, GERBVIEW_APPEARANCE } from './gerbview_settings.js';
export { GBR_DISPLAY_OPTIONS } from './gbr_display_options.js';
