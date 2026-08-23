// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Drawing sheet (page layout), the web-native mirror of KiCad's `pl_editor` /
 * `common/drawing_sheet`. Model + `.kicad_wks` reader/writer + layout resolver
 * + editing geometry.
 */
export * from './types.js';
export { readDrawingSheet, parseDrawingSheet, convertLegacyVariableRefs } from './read.js';
export { writeDrawingSheet, serializeDrawingSheet } from './write.js';
export { defaultDrawingSheet, emptyDrawingSheet } from './default-sheet.js';
export {
  layoutDrawingSheet,
  hitTestDrawingSheet,
  resolveDrawingSheetText,
  incrementLabel,
  expandTextEscapes,
  constrainedTextSize,
  type WksPage,
  type WksResolveContext,
  type DsDrawItem,
  type DsLineItem,
  type DsTextItem,
  type DsPolyItem,
  type DsBitmapItem,
} from './layout.js';
export {
  wksItemMsgPanelInfo,
  ellipsizeStatusText,
  statusTextOneLine,
  statusTextWidth,
  WKS_ITEM_TYPE_LABEL,
  WKS_PAGE1_OPTION_LABEL,
  type WksMsgPanelItem,
} from './msg_panel.js';
export {
  drawItemBBox,
  itemBBox,
  pickDrawItem,
  itemsInBox,
  translateItem,
  replaceItem,
  bitmapDisplayPPI,
  bitmapScaleForPPI,
  type WksBBox,
} from './edit.js';

/**
 * `KIGFX::DS_PAINTER` and the bitmap cache it draws through.
 *
 * Exported from here rather than reached at its path, so the four canvases that
 * draw a sheet ask `common` for the painter the way every editor upstream asks
 * `common/drawing_sheet/` for `DS_PAINTER`.
 */
export * from './ds_painter.js';
export * from './ds_bitmap.js';
export * from './project_sheet.js';
