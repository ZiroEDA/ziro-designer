// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/plotters/common_plot_functions.cpp`: `GetDefaultPlotExtension` and
 * `PlotDrawingSheet`, the page frame and title block plotted through any
 * PLOTTER from the drawing sheet's own draw list (DS_DRAW_ITEM_LIST), as both
 * editors plot it.
 *
 * The render settings are the plotter's; `GetLayerName()` and the default
 * font are read from a full `RENDER_SETTINGS` when the plotter has one, and
 * fall back to '' and the stroke font otherwise.
 */

import type { BITMAP_BASE, PLOTTER_FOR_IMAGE } from '../bitmap_base.js';
import type { DS_DATA_ITEM_BITMAP } from '../drawing_sheet/ds_data_item.js';
import {
  type DS_DRAW_ITEM_BITMAP,
  DS_DRAW_ITEM_LIST,
  type DS_DRAW_ITEM_LINE,
  type DS_DRAW_ITEM_POLYPOLYGONS,
  type DS_DRAW_ITEM_RECT,
  type DS_DRAW_ITEM_TEXT,
} from '../drawing_sheet/ds_draw_item.js';
import { unityScale } from '../eda_units.js';
import { COLOR4D_BLACK, COLOR4D_UNSPECIFIED, type Color4d, LEGACY_COLORS } from '../gal/color4d.js';
import type { PAGE_INFO } from '../page_info.js';
import { RENDER_SETTINGS } from '../render_settings.js';
import { wxStringSplit } from '../string_utils.js';
import type { PROJECT_TEXT_VARS, TITLE_BLOCK } from '../title_block.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { DXF_PLOTTER } from './DXF_plotter.js';
import { GERBER_PLOTTER } from './GERBER_plotter.js';
import { PDF_PLOTTER } from './PDF_plotter.js';
import { PS_PLOTTER } from './PS_plotter.js';
import { SVG_PLOTTER } from './SVG_plotter.js';
import { FILL_T, PLOT_FORMAT, type PLOTTER, plotterFont } from './plotter.js';

/** `GetDefaultPlotExtension( PLOT_FORMAT aFormat )`. */
export function GetDefaultPlotExtension(aFormat: PLOT_FORMAT): string {
  switch (aFormat) {
    case PLOT_FORMAT.DXF:
      return DXF_PLOTTER.GetDefaultFileExtension();
    case PLOT_FORMAT.POST:
      return PS_PLOTTER.GetDefaultFileExtension();
    case PLOT_FORMAT.PDF:
      return PDF_PLOTTER.GetDefaultFileExtension();
    case PLOT_FORMAT.GERBER:
      return GERBER_PLOTTER.GetDefaultFileExtension();
    case PLOT_FORMAT.SVG:
      return SVG_PLOTTER.GetDefaultFileExtension();
    default:
      // wxFAIL
      return '';
  }
}

const colorEquals = (a: Color4d, b: Color4d): boolean =>
  a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;

/** `wxFileName( aFilename ).GetFullPath()`: the path as given. */
const fullPath = (aFilename: string): string => aFilename;

/**
 * `PlotDrawingSheet`: the drawing sheet's items for this page, plotted in the
 * page's own coordinates. Bitmaps go first, then the lines, rectangles,
 * texts and polygons in list order, each in `aColor` (black when the plotter
 * is not in colour mode; red when the colour is unspecified).
 */
export function PlotDrawingSheet(
  plotter: PLOTTER,
  aProject: PROJECT_TEXT_VARS,
  aTitleBlock: TITLE_BLOCK,
  aPageInfo: PAGE_INFO,
  aProperties: Map<string, string> | null,
  aSheetNumber: string,
  aSheetCount: number,
  aSheetName: string,
  aSheetPath: string,
  aFilename: string,
  aColor: Color4d,
  aIsFirstPage: boolean,
  aVariantName = '',
  aVariantDesc = '',
): void {
  /* Note: Page sizes values are given in mils
   */
  const iusPerMil = plotter.GetIUsPerDecimil() * 10.0;
  let plotColor = plotter.GetColorMode() ? aColor : COLOR4D_BLACK;
  const rs = plotter.RenderSettings();
  const settings = rs instanceof RENDER_SETTINGS ? rs : null;
  const defaultPenWidth = rs ? rs.GetDefaultPenWidth() : 0;

  if (colorEquals(plotColor, COLOR4D_UNSPECIFIED)) plotColor = LEGACY_COLORS.RED;

  const drawList = new DS_DRAW_ITEM_LIST(unityScale);

  // Prepare plot parameters
  drawList.SetDefaultPenSize(defaultPenWidth);
  drawList.SetPlotterMilsToIUfactor(iusPerMil);
  drawList.SetPageNumber(aSheetNumber);
  drawList.SetSheetCount(aSheetCount);
  drawList.SetFileName(fullPath(aFilename));
  drawList.SetSheetName(aSheetName);
  drawList.SetSheetPath(aSheetPath);
  drawList.SetSheetLayer(settings ? settings.GetLayerName() : '');
  drawList.SetProject(aProject);
  drawList.SetIsFirstPage(aIsFirstPage);
  drawList.SetProperties(aProperties);
  drawList.SetVariantName(aVariantName);
  drawList.SetVariantDesc(aVariantDesc);

  drawList.BuildDrawItemsList(aPageInfo, aTitleBlock);

  try {
    // Draw bitmaps first
    for (let item = drawList.GetFirst(); item; item = drawList.GetNext()) {
      if (item.Type() === KICAD_T.WSG_BITMAP_T) {
        const drawItem = item as DS_DRAW_ITEM_BITMAP;
        const bitmap = drawItem.GetPeer() as DS_DATA_ITEM_BITMAP;
        const image: BITMAP_BASE | null = bitmap.m_ImageBitmap;

        if (image === null) continue;

        image.PlotImage(
          plotter as unknown as PLOTTER_FOR_IMAGE,
          drawItem.GetPosition(),
          plotColor,
          defaultPenWidth,
        );
      }
    }

    // Draw other items
    for (let item = drawList.GetFirst(); item; item = drawList.GetNext()) {
      if (item.Type() === KICAD_T.WSG_BITMAP_T) continue;

      plotter.SetColor(plotColor);

      switch (item.Type()) {
        case KICAD_T.WSG_LINE_T: {
          const line = item as DS_DRAW_ITEM_LINE;
          plotter.SetCurrentLineWidth(Math.max(line.GetPenWidth(), defaultPenWidth));
          plotter.MoveTo(line.GetStart());
          plotter.FinishTo(line.GetEnd());
          break;
        }

        case KICAD_T.WSG_RECT_T: {
          const rect = item as DS_DRAW_ITEM_RECT;
          plotter.SetCurrentLineWidth(Math.max(rect.GetPenWidth(), defaultPenWidth));
          plotter.MoveTo(rect.GetStart());
          plotter.LineTo({ x: rect.GetEnd().x, y: rect.GetStart().y });
          plotter.LineTo({ x: rect.GetEnd().x, y: rect.GetEnd().y });
          plotter.LineTo({ x: rect.GetStart().x, y: rect.GetEnd().y });
          plotter.FinishTo(rect.GetStart());
          break;
        }

        case KICAD_T.WSG_TEXT_T: {
          const text = item as DS_DRAW_ITEM_TEXT;
          const font = text.GetDrawFont(settings);
          let color = plotColor;
          const shownText = text.GetShownText(true);

          if (plotter.GetColorMode() && !colorEquals(text.GetTextColor(), COLOR4D_UNSPECIFIED))
            color = text.GetTextColor();

          const penWidth = Math.max(text.GetEffectiveTextPenWidth(), defaultPenWidth);
          const metrics = text.GetFontMetrics();
          const plotted = plotterFont(font, metrics);

          // Some plotters (PDF plotter) do not handle multiline very well. So handle them here
          if (text.IsMultilineAllowed() && shownText.includes('\n')) {
            const positions: VECTOR2I[] = [];
            const strings_list = wxStringSplit(shownText, '\n');

            text.GetLinePositions(settings, positions, strings_list.length);

            for (let ii = 0; ii < strings_list.length; ii++) {
              plotter.Text(
                positions[ii]!,
                color,
                strings_list[ii]!,
                text.GetTextAngle(),
                text.GetTextSize(),
                text.GetHorizJustify(),
                text.GetVertJustify(),
                penWidth,
                text.IsItalic(),
                text.IsBold(),
                false,
                plotted,
                metrics,
              );
            }
          } else {
            plotter.Text(
              text.GetTextPos(),
              color,
              shownText,
              text.GetTextAngle(),
              text.GetTextSize(),
              text.GetHorizJustify(),
              text.GetVertJustify(),
              penWidth,
              text.IsItalic(),
              text.IsBold(),
              text.IsMultilineAllowed(),
              plotted,
              metrics,
            );
          }

          break;
        }

        case KICAD_T.WSG_POLY_T: {
          const poly = item as DS_DRAW_ITEM_POLYPOLYGONS;
          const penWidth = Math.max(poly.GetPenWidth(), defaultPenWidth);

          for (let idx = 0; idx < poly.GetPolygons().OutlineCount(); ++idx) {
            const outline = poly.GetPolygons().Outline(idx);
            const points: VECTOR2I[] = [];

            for (let ii = 0; ii < outline.PointCount(); ii++) {
              const p = outline.CPoint(ii);
              points.push({ x: p.x, y: p.y });
            }

            plotter.PlotPoly(points, FILL_T.FILLED_SHAPE, penWidth, null);
          }

          break;
        }

        default:
          // wxFAIL_MSG( "PlotDrawingSheet(): Unknown drawing sheet item." )
          break;
      }
    }
  } catch (e) {
    // wxFAIL_MSG( "PlotDrawingSheet(): Exception during plot." )
    console.error('PlotDrawingSheet(): Exception during plot.', e);
  }
}
