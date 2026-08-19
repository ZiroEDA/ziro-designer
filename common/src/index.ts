// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** @ziroeda/common, shared EDA foundations mirroring KiCad's common/. */
export * from './eda_units.js';
export * from './generator.js';
export * from './eda_pattern_match.js';
export * from './kiid.js';
export * from './reporter.js';
export * from './string_utils.js';
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
  DEFAULT_SETUP,
  WKS_FILE_VERSION,
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

export * from './color4d.js';
export * from './settings/builtin_color_themes.js';

export * from './array_options.js';
export { pngPixelSize, pngPPI, DEFAULT_PPI } from './png_meta.js';
