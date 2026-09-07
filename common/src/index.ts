// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** @ziroeda/common, shared EDA foundations mirroring KiCad's common/. */
export * from './eda_units.js';
export * from './page_info.js';
export * from './generator.js';
export * from './eda_pattern_match.js';
export * from './kiid.js';
export * from './reporter.js';
export * from './common.js';
export * from './string_utils.js';
export * from './pin_numbers.js';
export * from './pin_type.js';
export * from './transform.js';
export * from './eda_shape.js';
export * from './eda_text.js';
export * from './font/stroke_font.js';

// --- Drawing sheet (page layout / pl_editor) ---------------------------------
export * as wks from './drawing_sheet/index.js';
export {
  readDrawingSheet,
  parseDrawingSheet,
  writeDrawingSheet,
  serializeDrawingSheet,
  defaultDrawingSheet,
  emptyDrawingSheet,
  layoutDrawingSheet,
  hitTestDrawingSheet,
  resolveDrawingSheetText,
  incrementLabel,
  expandTextEscapes,
  constrainedTextSize,
  drawItemBBox,
  pickDrawItem,
  translateItem,
  itemBBox as wksItemBBox,
  itemsInBox as wksItemsInBox,
  replaceItem as replaceWksItem,
  bitmapDisplayPPI,
  bitmapScaleForPPI,
  paperTypeName,
  DEFAULT_SETUP,
  WKS_FILE_VERSION,
  wksItemMsgPanelInfo,
  ellipsizeStatusText,
  statusTextOneLine,
  statusTextWidth,
  WKS_ITEM_TYPE_LABEL,
  WKS_PAGE1_OPTION_LABEL,
  type WksMsgPanelItem,
  type WksColor,
  type WksSheet,
  type WksItem,
  type WksLine,
  type WksRect,
  type WksText,
  type WksBitmap,
  type WksPoly,
  type WksSetup,
  type WksCorner,
  type WksOption,
  type WksHJustify,
  type WksVJustify,
  type WksPoint,
  type WksXY,
  type WksItemType,
  type WksItemBase,
  type WksPage,
  type WksResolveContext,
  type DsDrawItem,
  type DsLineItem,
  type DsTextItem,
  type DsPolyItem,
  type DsBitmapItem,
  type WksBBox,
} from './drawing_sheet/index.js';

/**
 * `KIGFX::DS_PAINTER` and its bitmap cache, flat rather than under `wks`.
 *
 * The four canvases that draw a sheet call these directly, exactly as every
 * frame upstream reaches `common/drawing_sheet/ds_painter.h` rather than an
 * editor's header.
 */
export * from './drawing_sheet/ds_painter.js';
export * from './drawing_sheet/ds_bitmap.js';

/**
 * `common/preview_items/` — the tool preview items every editor shares.
 * KiCad keeps them here for the same reason we do: a rubber band belongs to no
 * one editor, and four canvases each owning a copy of its colour table is how
 * two of them ended up painting the light scheme on a dark background.
 */
export * from './preview_items/selection_area.js';
export * from './preview_items/edit_points.js';
export * from './drawing_sheet/project_sheet.js';

/**
 * `NET_SETTINGS` — part of PROJECT_FILE, so both editors ask common/ for it.
 */
export * from './project/net_settings.js';

export * from './page_info.js';
export * from './color4d.js';
export * from './settings/builtin_color_themes.js';
export * from './settings/color_theme_file.js';

export * from './array_options.js';
export * from './table.js';
export * from './reference_image.js';
export { pngPixelSize, pngPPI, DEFAULT_PPI } from './png_meta.js';

// `ExpandTextVars` (common/common.cpp) — both editors resolve ${VAR} with it.
export * from './text_vars.js';
