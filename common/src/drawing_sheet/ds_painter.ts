// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `KIGFX::DS_PAINTER` — `common/drawing_sheet/ds_painter.cpp`.
 *
 * In `common/` because upstream's is: every editor draws the drawing sheet
 * through this one painter, pl_editor by installing it directly
 * (`PL_DRAW_PANEL_GAL`'s constructor) and the other three through
 * `DS_PROXY_VIEW_ITEM`. It lived in `editors/drawingsheet/` here and was
 * imported by the schematic renderer, `renderBoard`, `gerberRender` and the GL
 * adapter — four peers reaching into one editor's folder for a shared painter,
 * which is the circular ownership the project brief names.
 *
 * Drawing-sheet canvas painter. Draws the resolved IU primitives from
 * `layoutDrawingSheet` the way KiCad's DS_PAINTER paints them in `pl_editor`
 * (common/drawing_sheet/ds_painter.cpp):
 *  - lines / rectangles are stroked with the pen width;
 *  - poly-polygons are *filled* with the item colour (DrawPolygon, fill on,
 *    stroke off), the way logos are drawn;
 *  - text uses the stroke font (Newstroke) by default, or the named outline
 *    font when the item carries a `face`, matching `font->Draw`, which strokes
 *    glyph paths for the stroke font and fills glyph outlines for an outline
 *    font;
 *  - bitmaps are centred and sized `pixels / ppi · scale`.
 *
 * The caller sets the world transform on the context (IU → device pixels)
 * before calling; everything here is in schematic internal units.
 */

import { bitmapSizeIu, schIUScale } from '../index.js';
import { mmToIU } from '../index.js';
import type { DsDrawItem, DsTextItem, DsBitmapItem } from '../index.js';
import { KICAD_FONT_NAME, layoutText } from '../font/stroke_font.js';
// `ITALIC_TILT`, from its one home. This file used to declare its own `1 / 8`
// and was the KNOWN EXCEPTION in `italic_tilt_single_home.test.ts`, left there
// because the drawing-sheet tree was being rewritten at the time; the rewrite
// is what moved this file into common/, which is also what made the second
// declaration sit two directories from the first.
import { ITALIC_TILT } from '../font/font_metrics.js';
import { getBitmapImage } from './ds_bitmap.js';
import { brightness, parseColor4d } from '../index.js';

/*
 * The three colours the drawing sheet is painted from are COLOR_SETTINGS
 * layers, not a palette this editor invents. `DS_RENDER_SETTINGS::LoadColors`
 * (common/drawing_sheet/ds_painter.cpp:69-80) reads exactly three:
 *
 *   m_backgroundColor = LAYER_SCHEMATIC_BACKGROUND
 *   m_pageBorderColor = LAYER_SCHEMATIC_GRID
 *   m_normalColor     = LAYER_SCHEMATIC_DRAWINGSHEET
 *
 * and `EDA_DRAW_PANEL_GAL::onPaint` (common/draw_panel_gal.cpp:364) clears the
 * WHOLE canvas to `settings->GetBackgroundColor()`. So in pl_editor the canvas
 * and the paper are one colour and the page is only an outline — there is no
 * separate paper rectangle and no backdrop behind it.
 *
 * The values are `s_defaultTheme`, the "KiCad Default" theme every frame gets
 * when no other is chosen (common/settings/builtin_color_themes.h:32, :46,
 * :78). They are transcribed here in the same `rgb(r, g, b)` form
 * `editors/schematic/theme.ts` uses for the same three entries; see the PR for
 * why that table has not been promoted to a shared module yet.
 */

/**
 * [data] LAYER_SCHEMATIC_DRAWINGSHEET, `builtin_color_themes.h:78`. Held as
 * channels so the CSS form and the `<input type="color">` hex form below are
 * two views of ONE number rather than two numbers that have to agree.
 */
export const DS_ITEM_RGB = [132, 0, 0] as const;
export const DS_ITEM_COLOR = `rgb(${DS_ITEM_RGB[0]}, ${DS_ITEM_RGB[1]}, ${DS_ITEM_RGB[2]})`;
export const DS_ITEM_COLOR_HEX = `#${DS_ITEM_RGB.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
/** [data] LAYER_SCHEMATIC_BACKGROUND, `builtin_color_themes.h:32` — canvas AND paper. */
export const DS_BG_COLOR = 'rgb(245, 244, 239)';
/** [data] LAYER_SCHEMATIC_GRID, `builtin_color_themes.h:46` — `m_pageBorderColor`. */
export const DS_PAGE_BORDER_COLOR = 'rgb(181, 181, 181)';

/**
 * The three `COLOR_SETTINGS` layers `DS_RENDER_SETTINGS::LoadColors` reads,
 * named the way our `COLOR_SETTINGS` projection names them.
 *
 * This is deliberately a *structural* type rather than an import of the
 * schematic's `Theme`: `common/` is below every editor, and upstream's
 * `LoadColors` likewise takes a bare `const COLOR_SETTINGS*` and knows nothing
 * about which frame handed it over.
 */
export interface DsColorSettings {
  /** `LAYER_SCHEMATIC_BACKGROUND` */
  background: string;
  /** `LAYER_SCHEMATIC_GRID` */
  grid: string;
  /** `LAYER_SCHEMATIC_DRAWINGSHEET` */
  pageFrame: string;
}

/**
 * `DS_RENDER_SETTINGS`' three painted colours, after `LoadColors`.
 *
 * `m_selectedColor`, `m_brightenedColor`, `m_gridColor` and `m_cursorColor` are
 * NOT here for the reason `DS_SELECTED_COLOR` records below: `LoadColors`
 * overwrites exactly three members, and the other four keep either the
 * constructor's value or their luma-derived one.
 */
export interface DsRenderColors {
  /** `m_backgroundColor` — what `EDA_DRAW_PANEL_GAL::onPaint` clears to. */
  background: string;
  /** `m_pageBorderColor` — the page rectangle and its coord-origin marker. */
  pageBorder: string;
  /** `m_normalColor` — every sheet item that is not selected or brightened. */
  normal: string;
}

/**
 * `DS_RENDER_SETTINGS::LoadColors( const COLOR_SETTINGS* aSettings )`
 * (`common/drawing_sheet/ds_painter.cpp:58-69`):
 *
 *     m_backgroundColor = aSettings->GetColor( LAYER_SCHEMATIC_BACKGROUND );  // :66
 *     m_pageBorderColor = aSettings->GetColor( LAYER_SCHEMATIC_GRID );        // :67
 *     m_normalColor     = aSettings->GetColor( LAYER_SCHEMATIC_DRAWINGSHEET );// :68
 *
 * The per-layer `m_layerColors` copy at :60-64 has no consumer in the drawing
 * sheet — `DS_RENDER_SETTINGS::GetColor` (:71-93) only ever returns one of the
 * four members — so it is not mirrored.
 *
 * Note which layer feeds which: the page BORDER is `LAYER_SCHEMATIC_GRID`, and
 * the canvas grid is not a theme layer at all (`GetGridColor`, `ds_painter.h:71-75`,
 * picks DARKGRAY/LIGHTGRAY off the background's luma).
 */
export function dsLoadColors(aSettings: DsColorSettings): DsRenderColors {
  return {
    background: aSettings.background,
    pageBorder: aSettings.grid,
    normal: aSettings.pageFrame,
  };
}

/**
 * `LoadColors` applied to "KiCad Default" — `::GetColorSettings( DEFAULT_THEME )`,
 * which is what `PL_DRAW_PANEL_GAL`'s constructor falls back to when there is no
 * `PL_EDITOR_SETTINGS` to read a theme name out of (`pl_draw_panel_gal.cpp:57-59`).
 */
export const DS_DEFAULT_RENDER_COLORS: DsRenderColors = dsLoadColors({
  background: DS_BG_COLOR,
  grid: DS_PAGE_BORDER_COLOR,
  pageFrame: DS_ITEM_COLOR,
});

/**
 * Radius of the coord-origin marker DS_PAINTER draws on the page item.
 *
 *     constexpr double markerSize = drawSheetIUScale.mmToIU( 5 );
 *                                   pl_draw_panel_gal.cpp:110-113
 *
 * Five millimetres of PAGE, not of screen: PL_DRAW_PANEL_GAL fixes it when it
 * builds the DS_DRAW_ITEM_PAGE, so it zooms with everything else.
 *
 * Expressed through `mmToIU` — the SCHEMATIC scale — because that is the scale
 * this editor keeps its page geometry in, not `drawSheetIUScale`. Upstream can
 * use drawSheetIUScale here because pl_editor's internal units ARE that scale;
 * mixing the two would put the marker 10x out. See [[iu-scale-differs-per-editor]].
 */
export const PAGE_MARKER_SIZE_IU = mmToIU(5);
/**
 * [data] Paper for PRINT output only. A print does not go through the GAL and
 * does not carry the screen theme's background, so the sheet is drawn on white
 * paper however the canvas is themed: `dialogs_for_printing.cpp:186-187` sets
 * `SetDrawBgColor( WHITE )` for the duration and restores it at :211. WHITE is
 * `{255,255,255}`, `common/gal/color4d.cpp:48`.
 */
export const DS_PRINT_PAPER_COLOR = '#ffffff';
/**
 * [data] Black-background display option (`pl_editor_settings` `black_background`):
 * `pl_editor_frame.cpp:541` `SetDrawBgColor( cfg->m_BlackBackground ? BLACK : WHITE )`.
 * BLACK is `{0,0,0}`, `common/gal/color4d.cpp:44`.
 */
export const DS_BG_COLOR_DARK = '#000000';
/**
 * [data] The other half of that same ternary — `m_drawBgColor` when the
 * black-background option is off (`pl_editor_frame.cpp:541`). WHITE is
 * `{255,255,255}`, `common/gal/color4d.cpp:48`.
 *
 * This is NOT `DS_BG_COLOR`. That one is `LAYER_SCHEMATIC_BACKGROUND`, which is
 * what the GAL canvas paints; `m_drawBgColor` is the device-context background,
 * and the two callers that want it are the printer and
 * `DIALOG_PAGES_SETTINGS::UpdateDrawingSheetExample`, which fills its memory DC
 * with `GetDrawBgColor()` before drawing the sheet
 * (`common/dialogs/dialog_page_settings.cpp:616`).
 */
export const DS_BG_COLOR_LIGHT = '#ffffff';

/**
 * `DS_RENDER_SETTINGS::GetGridColor` / `GetCursorColor`
 * (`include/drawing_sheet/ds_painter.h:71-81`). pl_editor is the one frame that
 * does not read a COLOR_SETTINGS layer for these: it picks off the background's
 * luma, DARKGRAY/WHITE on a dark canvas and LIGHTGRAY/BLACK on a light one.
 * DARKGRAY and LIGHTGRAY are `common/gal/color4d.cpp:46-47`.
 */
export const DS_GRID_COLOR_ON_DARK = 'rgb(132, 132, 132)'; // [data] DARKGRAY
export const DS_GRID_COLOR_ON_LIGHT = 'rgb(194, 194, 194)'; // [data] LIGHTGRAY
export const DS_CURSOR_COLOR_ON_DARK = 'rgb(255, 255, 255)'; // [data] WHITE
export const DS_CURSOR_COLOR_ON_LIGHT = 'rgb(0, 0, 0)'; // [data] BLACK

/**
 * `DS_RENDER_SETTINGS::IsBackgroundDark()` (`ds_painter.h:57-61`):
 * `COLOR4D::GetBrightness()` — the weighted W3C formula
 * `r*0.299 + g*0.587 + b*0.117` (`include/gal/color4d.h:334-338`) — below 0.5.
 */
export function dsBackgroundIsDark(background: string): boolean {
  return brightness(parseColor4d(background)) < 0.5;
}
/**
 * [data] The colour a SELECTED drawing-sheet item is painted in.
 *
 * `DS_RENDER_SETTINGS::DS_RENDER_SETTINGS` (`ds_painter.cpp:46-53`) sets
 * `m_selectedColor = m_normalColor.Brightened( 0.5 )` with `m_normalColor = RED`,
 * and `LoadColors()` (:58-70) then overwrites `m_backgroundColor`,
 * `m_pageBorderColor` and `m_normalColor` — but NOT `m_selectedColor`. pl_editor
 * calls exactly that one function (`pl_draw_panel_gal.cpp:59`), so the selection
 * colour in the drawing-sheet editor keeps the constructor's value.
 *
 * RED is `{132, 0, 0}` (`color4d.cpp:61`) and `Brightened( f )` is
 * `c * (1 - f) + f` per channel (`include/gal/color4d.h:269-275`), so
 * (0.5176, 0, 0) -> (0.7588, 0.5, 0.5) -> rgb(194, 128, 128): the sheet's own
 * dark red washed halfway to white.
 *
 * It was `#4aa3ff`, a blue that appears NOWHERE in KiCad — `grep -rn
 * "74, *163, *255\|4aa3ff"` over the whole tree returns nothing. The
 * `#04ff43` green people expect is LAYER_SELECT_OVERLAY, which only applies when
 * the sheet is a DECORATION inside eeschema/pcbnew and
 * `ds_proxy_view_item.cpp:132-135` overrides the colour explicitly.
 */
export const DS_SELECTED_COLOR = 'rgb(194, 128, 128)';
/**
 * [data] DS_RENDER_SETTINGS `m_brightenedColor`: hover highlight of the delete
 * picker. `ds_painter.cpp:50` — `COLOR4D( 0.0, 1.0, 0.0, 0.9 )`, i.e. FULL
 * green. It was `rgba(0,230,0,0.9)`; 230 is not 1.0 * 255.
 */
export const DS_BRIGHTENED_COLOR = 'rgba(0, 255, 0, 0.9)';

/**
 * [data] The box-select marquee, `common/preview_items/selection_area.cpp:44-62`.
 * One `SELECTION_COLORS` per background luma, chosen at :105-106 by
 * `settings->IsBackgroundDark()`; the FILL is one colour for both drag
 * directions and only the OUTLINE differs — left-to-right yellow, right-to-left
 * blue (:116-121). Ours had two fills, blue and green, and neither outline.
 * COLOR4D channels are 0..1, so each is `round( c * 255 )`.
 */
export const DS_MARQUEE = {
  /** selectionColorScheme[0], the dark-background scheme. */
  onDark: {
    fill: 'rgba(77, 77, 179, 0.3)', // [data] COLOR4D( 0.3, 0.3, 0.7, 0.3 )
    outlineL2R: 'rgb(255, 255, 102)', // [data] COLOR4D( 1.0, 1.0, 0.4, 1.0 ) yellow
    outlineR2L: 'rgb(102, 102, 255)', // [data] COLOR4D( 0.4, 0.4, 1.0, 1.0 ) blue
  },
  /** selectionColorScheme[1], the light-background scheme. */
  onLight: {
    fill: 'rgba(128, 77, 255, 0.5)', // [data] COLOR4D( 0.5, 0.3, 1.0, 0.5 )
    outlineL2R: 'rgb(179, 179, 0)', // [data] COLOR4D( 0.7, 0.7, 0.0, 1.0 ) yellow
    outlineR2L: 'rgb(26, 26, 255)', // [data] COLOR4D( 0.1, 0.1, 1.0, 1.0 ) blue
  },
} as const;

/**
 * [data] EDIT_POINTS handles, `common/tool/edit_points.cpp:253-282`.
 *
 * The fill is `GetLayerColor( LAYER_AUX_ITEMS )` = white
 * (`builtin_color_themes.h:159`), INVERTED when it is within 0.5 of the clear
 * colour (:259-261) — which it is on this editor's near-white paper, so the
 * handles are black there and stay white on the black-background option. The
 * border is then derived from the fill's own brightness (:265-282): at
 * brightness 0 the `else` branch gives `Brightened( 0.7 ).WithAlpha( 0.8 )`, and
 * at brightness 1 the first gives `Darkened( 0.7 ).WithAlpha( 0.8 )`.
 *
 * Ours drew a white square with a `#4aa3ff` border, which is neither.
 */
export const DS_EDIT_POINT_ON_LIGHT = {
  fill: 'rgb(0, 0, 0)', // [data] LAYER_AUX_ITEMS white, inverted against near-white paper
  border: 'rgba(179, 179, 179, 0.8)', // [data] BLACK.Brightened( 0.7 ).WithAlpha( 0.8 )
} as const;
export const DS_EDIT_POINT_ON_DARK = {
  fill: 'rgb(255, 255, 255)', // [data] LAYER_AUX_ITEMS, `builtin_color_themes.h:159`
  border: 'rgba(77, 77, 77, 0.8)', // [data] WHITE.Darkened( 0.7 ).WithAlpha( 0.8 )
} as const;

export interface RenderOpts {
  color?: string;
  /** IU pen floor so hairlines stay visible; caller passes 1 world-unit ≈ n px. */
  minWidth?: number;
  /** Item index brightened by the interactive-delete picker (green). */
  brightened?: number | null;
  /**
   * `GRForceBlackPen( true )` (common/gr_basic.cpp), which pl_editor wraps the
   * whole printed page in (`dialogs_for_printing.cpp:184`, cleared again at
   * :213).
   *
   * It is not the same as passing `color: '#000'`: the flag makes every GR
   * drawing call use BLACK regardless of the colour it was asked for, so a
   * `(tbtext … (color …))` prints black too. Setting only the base colour
   * leaves a coloured text item coloured, which is what ours did.
   */
  forceBlackPen?: boolean;
}

/** Line-pitch factor for multi-line outline text (FONT_METRICS m_InterlinePitch). */
const INTERLINE_PITCH = 1.68;

/**
 * Map a stored `face` name to a CSS font-family. `sans`/`serif`/`monospace`
 * resolve to the CSS generics; any other name is passed through with a
 * sans-serif fallback so an unavailable face still renders.
 */
function cssFamily(face: string): string {
  const f = face.toLowerCase();
  if (f === 'sans' || f === 'sans-serif') return 'sans-serif';
  if (f === 'serif') return 'serif';
  if (f === 'monospace' || f === 'mono') return 'monospace';
  return `"${face}", sans-serif`;
}

/**
 * Fill one resolved text primitive with a named outline font, the way
 * `font->Draw` renders TTF glyphs (filled, not stroked). Positioning,
 * justification, rotation and the width/height ratio match the stroke path.
 */
/**
 * Reference glyph size (device px) the outline font is set at. Browsers clamp
 * `ctx.font` to a few thousand px, so setting an 8 mm = 80000 IU size directly
 * under the IU world transform gets dropped; instead the font is rasterised at
 * EM px and a nested scale maps EM → the item's world size.
 */
const OUTLINE_EM = 100;

function drawOutlineText(ctx: CanvasRenderingContext2D, t: DsTextItem, color: string): void {
  const size = t.h;
  if (size <= 0 || t.text === '') return;
  const lines = t.text.split('\n');
  const sx = size > 0 ? t.w / size : 1;
  const rad = (-t.rotate * Math.PI) / 180;
  const lineHeight = OUTLINE_EM * INTERLINE_PITCH; // in EM units
  const n = lines.length;
  // Vertical block anchor: top → first line at 0; bottom → last line at 0;
  // center → block centred. Canvas baselines line up with these.
  const baseline = t.vjustify === 'top' ? 'top' : t.vjustify === 'bottom' ? 'bottom' : 'middle';
  const y0 =
    t.vjustify === 'top'
      ? 0
      : t.vjustify === 'bottom'
        ? -(n - 1) * lineHeight
        : -((n - 1) / 2) * lineHeight;

  ctx.save();
  ctx.translate(t.at.x, t.at.y);
  ctx.rotate(rad);
  // Map the EM-sized font to `size` world units, applying the width/height ratio.
  ctx.scale((sx * size) / OUTLINE_EM, size / OUTLINE_EM);
  ctx.fillStyle = color;
  ctx.textAlign = t.hjustify === 'left' ? 'left' : t.hjustify === 'right' ? 'right' : 'center';
  ctx.textBaseline = baseline;
  ctx.font = `${t.italic ? 'italic ' : ''}${t.bold ? 'bold ' : ''}${OUTLINE_EM}px ${cssFamily(t.face ?? '')}`;
  lines.forEach((line, i) => ctx.fillText(line, 0, y0 + i * lineHeight));
  ctx.restore();
}

/** Stroke one resolved text primitive with the Newstroke font. */
function drawText(
  ctx: CanvasRenderingContext2D,
  t: DsTextItem,
  color: string,
  minWidth: number,
): void {
  // A named outline font is filled (font->Draw); the default is the stroke
  // font. "KiCad Font" is a name for the stroke font itself, not an outline
  // family: FONT::GetFont( KICAD_FONT_NAME ) hands back the stroke font
  // singleton, whose own m_fontName is that string (stroke_font.cpp:189), and
  // it is what pl_editor writes when the Font combo's second entry is picked.
  if (t.face && t.face !== KICAD_FONT_NAME) {
    drawOutlineText(ctx, t, color);
    return;
  }
  const size = t.h;
  if (size <= 0 || t.text === '') return;
  const { strokes, width } = layoutText(t.text, size);
  // EDA_TEXT pen: file thickness else bold→size/5 / normal→size/8, clamped ≤ size·0.25.
  const raw = t.thickness > 0 ? t.thickness : t.bold ? size / 5 : size / 8;
  const thickness = Math.max(Math.min(raw, size * 0.25), minWidth);
  const offX = t.hjustify === 'left' ? 0 : t.hjustify === 'right' ? -width : -width / 2;
  const offY = t.vjustify === 'top' ? size : t.vjustify === 'bottom' ? 0 : size / 2;
  const rad = (-t.rotate * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const sx = size > 0 ? t.w / size : 1;
  const tilt = t.italic ? ITALIC_TILT : 0;
  ctx.strokeStyle = color;
  ctx.lineWidth = thickness;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (const stroke of strokes) {
    for (let i = 0; i < stroke.length; i++) {
      const gx = (stroke[i]!.x + offX) * sx - stroke[i]!.y * tilt;
      const gy = stroke[i]!.y + offY;
      const x = t.at.x + gx * cos - gy * sin;
      const y = t.at.y + gx * sin + gy * cos;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      if (stroke.length === 1) ctx.lineTo(x + 1, y);
    }
  }
  ctx.stroke();
}

/**
 * Draw one bitmap. KiCad centres the image on its anchor point and sizes it at
 * `pixels / ppi · scale`. While the PNG is still decoding (or when it has no
 * payload) a dashed placeholder box of the same footprint is drawn instead, so
 * the item stays visible, selectable and movable.
 */
function drawBitmap(
  ctx: CanvasRenderingContext2D,
  d: DsBitmapItem,
  color: string,
  minWidth: number,
): void {
  const decoded = d.pngB64 ? getBitmapImage(d.pngB64) : null;
  const pxW = decoded?.w ?? (d.pxW && d.pxW > 0 ? d.pxW : d.ppi);
  const pxH = decoded?.h ?? (d.pxH && d.pxH > 0 ? d.pxH : d.ppi);
  const w = bitmapSizeIu(schIUScale, pxW, d.ppi, d.scale);
  const h = bitmapSizeIu(schIUScale, pxH, d.ppi, d.scale);
  const x = d.at.x - w / 2;
  const y = d.at.y - h / 2;
  if (decoded) {
    ctx.drawImage(decoded.img, x, y, w, h);
  } else {
    ctx.strokeStyle = color;
    ctx.setLineDash([Math.max(w, h) / 40, Math.max(w, h) / 60]);
    ctx.lineWidth = minWidth;
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
  }
}

/**
 * Stroke an axis-aligned hairline on the device pixel grid.
 *
 * A one-device-pixel stroke centred on an integer device coordinate straddles
 * two pixels, and Canvas 2D — which has no way to turn stroke antialiasing off —
 * then paints both at partial coverage. Measured against a live pl_editor at the
 * same page: KiCad puts a border line in ONE pixel at rgb(132,0,0) with clean
 * background either side, while ours put rgb(139,15,15) in one pixel and bled
 * rgb(238,229,224) into its neighbour. Every thin line and every glyph stem in
 * the sheet does that, which is the whole of the "blurry" difference; the line
 * width was never wrong, only its position.
 *
 * KiCad does not hit this because `graphics.antialiasing_mode` defaults to 2,
 * `AA_HIGHQUALITY` (`common_settings.cpp:328-329`), and its GAL renders hairlines
 * hard-edged into a supersampled buffer. The equivalent for a 2D canvas is to
 * put the stroke centre on a half-pixel so antialiasing has nothing to blend.
 *
 * Only for the axis-aligned case: with rotation or shear in the transform there
 * is no pixel to snap to, and the caller falls back to an ordinary stroke.
 */
const isAxisAligned = (m: DOMMatrix): boolean => m.b === 0 && m.c === 0;

/**
 * The current transform, or null when the context cannot report one.
 *
 * `getTransform` is part of the 2D context every browser ships, but not of the
 * recording doubles several suites build to assert what this renderer draws
 * (`render_item_filter`, the plot recorders). Snapping needs to know where a
 * point lands in device space, so with no matrix there is nothing to snap to
 * and the ordinary world-space stroke is the right answer -- which is also
 * exactly what those suites are asserting.
 */
function deviceMatrix(ctx: CanvasRenderingContext2D): DOMMatrix | null {
  if (typeof ctx.getTransform !== 'function') return null;
  return ctx.getTransform();
}

/**
 * True when this stroke comes out one device pixel wide or thinner.
 *
 * `worldWidth * scale` is the device width; the sheet's own 0.15 mm lines are
 * well under a pixel at any normal zoom and are already clamped up to the
 * one-device-pixel `minWidth` by the caller, so this is the common case rather
 * than an edge case.
 */
function isHairline(ctx: CanvasRenderingContext2D, worldWidth: number): boolean {
  const m = deviceMatrix(ctx);
  if (!m || !isAxisAligned(m)) return false;
  return worldWidth * Math.max(Math.abs(m.a), Math.abs(m.d)) <= 1.5;
}

/** World point -> device point under `m`. */
function toDevice(m: DOMMatrix, x: number, y: number): { x: number; y: number } {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

/** Put a coordinate on the centre of a device pixel. */
const snapHalf = (v: number): number => Math.round(v - 0.5) + 0.5;

/**
 * Run `paint` in device space with the transform reset, then restore it.
 * Returns false when the transform is not axis-aligned, so the caller can draw
 * the ordinary way instead.
 */
function inDeviceSpace(ctx: CanvasRenderingContext2D, paint: (m: DOMMatrix) => void): boolean {
  const m = deviceMatrix(ctx);
  if (!m || !isAxisAligned(m)) return false;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  paint(m);
  ctx.restore();
  return true;
}

/** Draw all resolved primitives; `selected` is the set of source item indices. */
export function drawDrawingSheetItems(
  ctx: CanvasRenderingContext2D,
  draws: DsDrawItem[],
  selected: ReadonlySet<number>,
  opts: RenderOpts = {},
): void {
  // `GRForceBlackPen`: the pen is black whatever the item asked for.
  const forceBlack = opts.forceBlackPen === true;
  const baseColor = forceBlack ? '#000000' : (opts.color ?? DS_ITEM_COLOR);
  const minWidth = opts.minWidth ?? 1;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const d of draws) {
    const sel = selected.has(d.src);
    // Priority: delete-picker brighten > selection > per-item colour > layer colour.
    const itemColor =
      d.kind === 'text' && d.color
        ? `rgba(${d.color.r},${d.color.g},${d.color.b},${d.color.a})`
        : baseColor;
    // `GRForceBlackPen` is consulted by `GRSetColorPen` on every call, so it
    // wins over all four of those and there is exactly one place to say so.
    // The item's own colour is deliberately NOT guarded a second time above:
    // a mutation sweep showed the guard was unreachable, which means the rule
    // was written twice and only one of the two could ever be wrong.
    const color = forceBlack
      ? baseColor
      : opts.brightened === d.src
        ? DS_BRIGHTENED_COLOR
        : sel
          ? DS_SELECTED_COLOR
          : itemColor;
    switch (d.kind) {
      case 'line': {
        const w = Math.max(d.width, minWidth);
        ctx.strokeStyle = color;
        ctx.lineWidth = w;
        // Snap only a hairline, and only when it is axis-aligned in device
        // space: a wider stroke covers whole pixels already, and a diagonal has
        // no pixel row to sit in.
        const snapped =
          isHairline(ctx, w) &&
          (d.a.x === d.b.x || d.a.y === d.b.y) &&
          inDeviceSpace(ctx, (m) => {
            const a = toDevice(m, d.a.x, d.a.y);
            const b = toDevice(m, d.b.x, d.b.y);
            const vertical = d.a.x === d.b.x;
            const fixed = snapHalf(vertical ? a.x : a.y);
            ctx.lineWidth = 1;
            ctx.beginPath();
            if (vertical) {
              ctx.moveTo(fixed, a.y);
              ctx.lineTo(fixed, b.y);
            } else {
              ctx.moveTo(a.x, fixed);
              ctx.lineTo(b.x, fixed);
            }
            ctx.stroke();
          });
        if (snapped) break;
        ctx.beginPath();
        ctx.moveTo(d.a.x, d.a.y);
        ctx.lineTo(d.b.x, d.b.y);
        ctx.stroke();
        break;
      }
      case 'rect': {
        const w = Math.max(d.width, minWidth);
        const x = Math.min(d.a.x, d.b.x);
        const y = Math.min(d.a.y, d.b.y);
        const rw = Math.abs(d.b.x - d.a.x);
        const rh = Math.abs(d.b.y - d.a.y);
        ctx.strokeStyle = color;
        ctx.lineWidth = w;
        // All four sides are axis-aligned, so the whole rect snaps or none of it
        // does — snapping only some sides would leave the corners ragged.
        const snapped =
          isHairline(ctx, w) &&
          inDeviceSpace(ctx, (m) => {
            const p0 = toDevice(m, x, y);
            const p1 = toDevice(m, x + rw, y + rh);
            const l = snapHalf(Math.min(p0.x, p1.x));
            const t = snapHalf(Math.min(p0.y, p1.y));
            const r = snapHalf(Math.max(p0.x, p1.x));
            const b = snapHalf(Math.max(p0.y, p1.y));
            ctx.lineWidth = 1;
            ctx.strokeRect(l, t, r - l, b - t);
          });
        if (snapped) break;
        ctx.strokeRect(x, y, rw, rh);
        break;
      }
      case 'poly': {
        // DS_PAINTER fills poly-polygons (fill on, stroke off), logos, not outlines.
        ctx.fillStyle = color;
        ctx.beginPath();
        d.pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 'text':
        drawText(ctx, d, color, minWidth);
        break;
      case 'bitmap':
        drawBitmap(ctx, d, color, minWidth);
        break;
    }
  }
}
