// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `KIGFX::RENDER_SETTINGS` — KiCad's `include/render_settings.h` and
 * `common/render_settings.cpp`.
 *
 * The dash and gap ratios are NOT `PLOTTER` statics: upstream keeps them on
 * `RENDER_SETTINGS` (render_settings.h:347-348, defaulted in
 * render_settings.cpp:32-33), and `PLOTTER::GetDashMarkLenIU` /
 * `GetDashGapLenIU` (common/plotters/plotter.cpp:142,148) ask the render
 * settings for the length. So they live here rather than next to the
 * line-width sentinels, at the level of sharing upstream gives them.
 */

import { brightened, brightness, type Color4d, COLOR4D_BLACK, darkened, mix } from './color4d.js';
import {
  GAL_LAYER_ID,
  IsNetnameLayer,
  LAYER_ID_COUNT,
  PCB_LAYER_ID,
  PCBNEW_LAYER_ID_START,
  SCH_LAYER_ID,
} from './layer_id.js';
import { LSET } from './lset.js';
import type { COLOR_SETTINGS } from './settings/color_settings.js';
import type { VIEW_ITEM } from './view/view_item.js';

/**
 * The accessors a plotter reaches for. `RENDER_SETTINGS` satisfies it; the
 * plotters take this type until they take `RENDER_SETTINGS` itself.
 */
export interface PlotterRenderSettings {
  GetDefaultPenWidth(): number;
  GetDashLength(aLineWidth: number): number;
  GetDotLength(aLineWidth: number): number;
  GetGapLength(aLineWidth: number): number;
}

/**
 * `correction` (render_settings.cpp:56-62). The file offers 0.8 ("looks best
 * visually") behind an `#if 0` and compiles 1.0; the dead value is not an
 * option, it is dead.
 */
const correction = 1.0;

/** `RENDER_SETTINGS`' ISO 128-2 defaults — render_settings.cpp:32-33. */
export const DEFAULT_DASH_LENGTH_RATIO = 12;
export const DEFAULT_GAP_LENGTH_RATIO = 3;

/**
 * `KIGFX::RENDER_SETTINGS` (`include/render_settings.h` +
 * `common/render_settings.cpp`): the drawing parameters a PAINTER reads,
 * whole. `m_printDC` is wxDC-only and has no browser form.
 */
export abstract class RENDER_SETTINGS {
  protected m_activeLayer: PCB_LAYER_ID; // The active layer (as shown by appearance mgr)
  protected m_layerName = '';
  protected m_highContrastLayers = new Set<number>(); // High-contrast layers (both board layers and
  //   synthetic GAL layers)

  protected m_layerColors = new Map<number, Color4d>(); // Layer colors
  protected m_layerColorsHi = new Map<number, Color4d>(); // Layer colors for highlighted objects
  protected m_layerColorsSel = new Map<number, Color4d>(); // Layer colors for selected objects
  protected m_hiContrastColor = new Map<number, Color4d>(); // High-contrast mode layer colors
  protected m_layerColorsDark = new Map<number, Color4d>(); // Darkened layer colors (for high-contrast mode)
  protected m_backgroundColor: Color4d = COLOR4D_BLACK; // The background color

  /// Parameters for display modes
  protected m_hiContrastEnabled: boolean; // High contrast display mode on/off
  protected m_hiContrastFactor: number; // Factor used for computing high contrast color
  protected m_highlightEnabled: boolean; // Highlight display mode on/off
  protected m_highlightNetcodes = new Set<number>(); // Set of net cods to be highlighted
  protected m_highlightFactor: number; // Factor used for computing highlight color
  protected m_drawBoundingBoxes: boolean; // Visual aid for debugging
  protected m_selectFactor: number; // Specifies how color of selected items is changed
  protected m_outlineWidth: number; // Line width used when drawing outlines
  protected m_drawingSheetLineWidth: number; // Line width used for borders and titleblock
  protected m_defaultPenWidth: number;
  protected m_minPenWidth: number; // Some clients (such as PDF) don't like ultra-thin
  // lines.  This sets an absolute minimum.
  protected m_dashLengthRatio: number;
  protected m_gapLengthRatio: number;
  protected m_defaultFont = '';
  protected m_isPrinting: boolean; // true when draw to a printer
  protected m_printBlackAndWite: boolean; // true if black and white printing is requested: some
  // backgrounds are not printed to avoid not visible items
  protected m_printLayers: LSET = new LSET();

  constructor() {
    // Set the default initial values
    this.m_activeLayer = PCB_LAYER_ID.F_Cu;
    this.m_drawBoundingBoxes = false;
    this.m_dashLengthRatio = 12; // From ISO 128-2
    this.m_gapLengthRatio = 3; // From ISO 128-2

    // Set the default initial values
    this.m_highlightFactor = 0.5;
    this.m_selectFactor = 0.5;
    this.m_highlightEnabled = false;
    this.m_hiContrastEnabled = false;
    this.m_hiContrastFactor = Math.fround(0.2);
    this.m_outlineWidth = 1;
    this.m_drawingSheetLineWidth = 100000;
    this.m_defaultPenWidth = 0;
    this.m_minPenWidth = 0;
    this.m_isPrinting = false;
    this.m_printBlackAndWite = false;
  }

  /**
   * Set the specified layer as high-contrast.
   *
   * @param aLayerId is a layer number that should be displayed in a specific mode.
   * @param aEnabled is the new layer state ( true = active or false = not active).
   */
  SetLayerIsHighContrast(aLayerId: number, aEnabled = true): void {
    if (aEnabled) this.m_highContrastLayers.add(aLayerId);
    else this.m_highContrastLayers.delete(aLayerId);
  }

  /**
   * Return information whether the queried layer is marked as high-contrast.
   *
   * @return True if the queried layer is marked as active.
   */
  GetLayerIsHighContrast(aLayerId: number): boolean {
    return this.m_highContrastLayers.has(aLayerId);
  }

  /**
   * Returns the set of currently high-contrast layers.
   */
  GetHighContrastLayers(): Set<number> {
    return new Set(this.m_highContrastLayers);
  }

  /**
   * Return the board layer which is in high-contrast mode.
   *
   * There should only be one board layer which is high-contrast at any given time, although
   * there might be many high-contrast synthetic (GAL) layers.
   */
  GetPrimaryHighContrastLayer(): PCB_LAYER_ID {
    // A std::set<int> iterates in ascending order
    for (const layer of [...this.m_highContrastLayers].sort((a, b) => a - b)) {
      if (layer >= PCBNEW_LAYER_ID_START && layer < PCB_LAYER_ID.PCB_LAYER_ID_COUNT)
        return layer as PCB_LAYER_ID;
    }

    return PCB_LAYER_ID.UNDEFINED_LAYER;
  }

  GetActiveLayer(): PCB_LAYER_ID {
    return this.m_activeLayer;
  }
  SetActiveLayer(aLayer: PCB_LAYER_ID): void {
    this.m_activeLayer = aLayer;
  }

  GetPrintLayers(): LSET {
    return this.m_printLayers;
  }
  SetPrintLayers(aLayerSet: LSET): void {
    this.m_printLayers = aLayerSet;
  }

  /**
   * Load a given set of colors, from a settings object.
   */
  LoadColors(aSettings: COLOR_SETTINGS | null): void {}

  GetLayerName(): string {
    return this.m_layerName;
  }
  SetLayerName(aLayerName: string): void {
    this.m_layerName = aLayerName;
  }

  /**
   * Clear the list of active layers.
   */
  ClearHighContrastLayers(): void {
    this.m_highContrastLayers.clear();
  }

  /**
   * Return current highlight setting.
   */
  IsHighlightEnabled(): boolean {
    return this.m_highlightEnabled;
  }

  /**
   * Return the netcode of currently highlighted net.
   */
  GetHighlightNetCodes(): Set<number> {
    return this.m_highlightNetcodes;
  }

  /**
   * Turns on/off highlighting.
   *
   * It may be done for the active layer or the specified net(s)..
   *
   * @param aEnabled tells if highlighting should be enabled.
   * @param aNetcode is optional and if specified, turns on highlighting only for the net with
   *                 number given as the parameter.
   */
  SetHighlight(aEnabled: boolean, aNetcode?: number, aMulti?: boolean): void;
  SetHighlight(aHighlight: Set<number>, aEnabled?: boolean): void;
  SetHighlight(a: boolean | Set<number>, b?: number | boolean, c?: boolean): void {
    if (a instanceof Set) {
      const aEnabled = (b as boolean | undefined) ?? true;

      this.m_highlightEnabled = aEnabled;

      if (aEnabled) this.m_highlightNetcodes = new Set(a);
      else this.m_highlightNetcodes.clear();

      return;
    }

    const aNetcode = (b as number | undefined) ?? -1;
    const aMulti = c ?? false;

    this.m_highlightEnabled = a;

    if (a) {
      if (!aMulti) this.m_highlightNetcodes.clear();

      this.m_highlightNetcodes.add(aNetcode);
    } else this.m_highlightNetcodes.clear();
  }

  /**
   * Turns on/off high contrast display mode.
   */
  SetHighContrast(aEnabled: boolean): void {
    this.m_hiContrastEnabled = aEnabled;
  }
  GetHighContrast(): boolean {
    return this.m_hiContrastEnabled;
  }

  SetDrawBoundingBoxes(aEnabled: boolean): void {
    this.m_drawBoundingBoxes = aEnabled;
  }
  GetDrawBoundingBoxes(): boolean {
    return this.m_drawBoundingBoxes;
  }

  /**
   * Returns the color that should be used to draw the specific VIEW_ITEM on the specific layer
   * using currently used render settings.
   *
   * @param aItem is the VIEW_ITEM.
   * @param aLayer is the layer.
   * @return The color.
   */
  abstract GetColor(aItem: VIEW_ITEM | null, aLayer: number): Color4d;

  GetDrawingSheetLineWidth(): number {
    return this.m_drawingSheetLineWidth;
  }

  GetDefaultPenWidth(): number {
    return this.m_defaultPenWidth;
  }
  SetDefaultPenWidth(aWidth: number): void {
    this.m_defaultPenWidth = aWidth;
  }

  GetMinPenWidth(): number {
    return this.m_minPenWidth;
  }
  SetMinPenWidth(aWidth: number): void {
    this.m_minPenWidth = aWidth;
  }

  GetDashLengthRatio(): number {
    return this.m_dashLengthRatio;
  }
  SetDashLengthRatio(aRatio: number): void {
    this.m_dashLengthRatio = aRatio;
  }
  GetDashLength(aLineWidth: number): number {
    return Math.max(this.m_dashLengthRatio - correction, 1.0) * aLineWidth;
  }
  GetDotLength(aLineWidth: number): number {
    // The minimal length scale is arbitrary set to 0.2 after trials
    // 0 lenght can create drawing issues
    return Math.max(1.0 - correction, 0.2) * aLineWidth;
  }

  GetGapLengthRatio(): number {
    return this.m_gapLengthRatio;
  }
  SetGapLengthRatio(aRatio: number): void {
    this.m_gapLengthRatio = aRatio;
  }
  GetGapLength(aLineWidth: number): number {
    return Math.max(this.m_gapLengthRatio + correction, 1.0) * aLineWidth;
  }

  GetShowPageLimits(): boolean {
    return true;
  }

  IsPrinting(): boolean {
    return this.m_isPrinting;
  }
  SetIsPrinting(isPrinting: boolean): void {
    this.m_isPrinting = isPrinting;
  }

  IsPrintBlackAndWhite(): boolean {
    return this.m_printBlackAndWite;
  }
  SetPrintBlackAndWhite(aPrintBlackAndWhite: boolean): void {
    this.m_printBlackAndWite = aPrintBlackAndWhite;
  }

  PrintBlackAndWhiteReq(): boolean {
    return this.m_printBlackAndWite && this.m_isPrinting;
  }

  /**
   * Return current background color settings.
   */
  abstract GetBackgroundColor(): Color4d;

  /**
   * Set the background color.
   */
  abstract SetBackgroundColor(aColor: Color4d): void;

  /**
   * Return current grid color settings.
   */
  abstract GetGridColor(): Color4d;

  /**
   * Return current cursor color settings.
   */
  abstract GetCursorColor(): Color4d;

  /**
   * Return the color used to draw a layer.
   *
   * @param aLayer is the layer number.
   */
  GetLayerColor(aLayer: number): Color4d {
    // We don't (yet?) have a separate color for intersheet refs
    if (aLayer === SCH_LAYER_ID.LAYER_INTERSHEET_REFS) aLayer = SCH_LAYER_ID.LAYER_GLOBLABEL;

    return this.m_layerColors.get(aLayer) ?? COLOR4D_BLACK;
  }

  /**
   * Change the color used to draw a layer.
   *
   * @param aLayer is the layer number.
   * @param aColor is the new color.
   */
  SetLayerColor(aLayer: number, aColor: Color4d): void {
    this.m_layerColors.set(aLayer, aColor);

    this.update(); // recompute other shades of the color
  }

  IsBackgroundDark(): boolean {
    return false;
  }

  /**
   * Set line width used for drawing outlines.
   *
   * @param aWidth is the new width.
   */
  SetOutlineWidth(aWidth: number): void {
    this.m_outlineWidth = aWidth;
  }
  GetOutlineWidth(): number {
    return this.m_outlineWidth;
  }

  SetHighlightFactor(aFactor: number): void {
    this.m_highlightFactor = aFactor;
  }
  SetSelectFactor(aFactor: number): void {
    this.m_selectFactor = aFactor;
  }

  SetDefaultFont(aFont: string): void {
    this.m_defaultFont = aFont;
  }
  GetDefaultFont(): string {
    return this.m_defaultFont;
  }

  /**
   * Precalculates extra colors for layers (e.g. highlighted, darkened and any needed version
   * of base colors).
   */
  protected update(): void {
    // `m_layerColors[i]` on a std::map creates a black entry where none was set
    const layerColor = (i: number): Color4d => {
      let c = this.m_layerColors.get(i);
      if (c === undefined) {
        c = { r: 0, g: 0, b: 0, a: 1 };
        this.m_layerColors.set(i, c);
      }
      return c;
    };
    const background = layerColor(GAL_LAYER_ID.LAYER_PCB_BACKGROUND);

    // Calculate darkened/highlighted variants of layer colors
    for (let i = 0; i < LAYER_ID_COUNT; i++) {
      const base = layerColor(i);
      this.m_hiContrastColor.set(i, mix(base, background, this.m_hiContrastFactor));
      this.m_layerColorsHi.set(i, brightened(base, this.m_highlightFactor));
      this.m_layerColorsDark.set(i, darkened(base, 1.0 - this.m_highlightFactor));

      // Skip selection brightening for things close to black, and netname text
      if (IsNetnameLayer(i) || brightness(base) < 0.05) {
        this.m_layerColorsSel.set(i, base);
        continue;
      }

      // Linear brightening doesn't work well for colors near white
      let factor = this.m_selectFactor * 0.5 + brightness(base) ** 3;
      factor = Math.min(1.0, factor);
      let sel = brightened(base, factor);

      // If we are maxed out on brightening as a highlight, fallback to darkening but keep
      // the blue that acts as a "glowing" color
      if (Math.abs(brightness(sel) - brightness(base)) < 0.05) {
        sel = darkened(base, this.m_selectFactor * 0.4);
        sel = { ...sel, b: base.b * (1.0 - factor) + factor };
      }

      this.m_layerColorsSel.set(i, sel);
    }
  }
}

/** The concrete stub `plotterRenderSettings` hands out. */
class PLOTTER_RENDER_SETTINGS_STUB extends RENDER_SETTINGS {
  GetColor(): Color4d {
    return COLOR4D_BLACK;
  }
  GetBackgroundColor(): Color4d {
    return this.m_backgroundColor;
  }
  SetBackgroundColor(aColor: Color4d): void {
    this.m_backgroundColor = aColor;
  }
  GetGridColor(): Color4d {
    return COLOR4D_BLACK;
  }
  GetCursorColor(): Color4d {
    return COLOR4D_BLACK;
  }
}

/**
 * A `RENDER_SETTINGS` with only the pen width and dash ratios set, for a
 * plotter that has no editor settings to be handed.
 *
 * @deprecated the plotters take the editor's `PCB_RENDER_SETTINGS` /
 * `SCH_RENDER_SETTINGS` once those are ported (#636 stage 5).
 */
export function plotterRenderSettings(
  aOptions: { defaultPenWidth?: number; dashLengthRatio?: number; gapLengthRatio?: number } = {},
): RENDER_SETTINGS {
  const settings = new PLOTTER_RENDER_SETTINGS_STUB();

  settings.SetDefaultPenWidth(aOptions.defaultPenWidth ?? 0);
  settings.SetDashLengthRatio(aOptions.dashLengthRatio ?? DEFAULT_DASH_LENGTH_RATIO);
  settings.SetGapLengthRatio(aOptions.gapLengthRatio ?? DEFAULT_GAP_LENGTH_RATIO);

  return settings;
}

/**
 * `RENDER_SETTINGS::m_hiContrastFactor`, `common/render_settings.cpp:42`.
 *
 * [data] KiCad's own constant, not a shade we chose. It is the value
 * {@link hiContrastFactorFor} yields at the shipped `hicontrast_dimming_factor`
 * of 0.8, and the fallback `PCB_PAINTER` uses when there is no program object
 * to ask (`pcbnew/pcb_painter.cpp:178`, `m_hiContrastFactor = 1.0f - 0.8f`).
 */
export const HI_CONTRAST_FACTOR = 0.2;

/**
 * The factor from the user's setting — `pcbnew/pcb_painter.cpp:176`:
 *
 *     m_hiContrastFactor = 1.0f - Pgm().GetCommonSettings()->m_Appearance.hicontrast_dimming_factor;
 *
 * Note the inversion, which is the whole reason this is a function and not an
 * assignment at the call site: Preferences asks for a DIMMING amount and the
 * painter wants how much of the layer SURVIVES. Wiring the setting straight
 * through would make the slider run backwards, and it would still look
 * plausible — 80 dimming and 80 surviving are both "a number near the top".
 */
export function hiContrastFactorFor(dimming: number): number {
  return 1 - dimming;
}

/**
 * `dim_factor_Edge_Cuts` (`pcbnew/pcb_painter.cpp:513-518`):
 *
 *     // We could use a dim factor = m_hiContrastFactor, but to have a sufficient
 *     // contrast whenever m_hiContrastFactor value, we clamp the factor to 0.3f
 *     // (arbitray choice after tests)
 *     float dim_factor_Edge_Cuts = std::max( m_hiContrastFactor, 0.3f );
 *
 * Edge.Cuts is the one layer that survives HIDDEN mode as well as dimmed, so
 * this is a floor on both branches. [data] the 0.3 is upstream's.
 */
export function edgeCutsContrastFactor(factor: number): number {
  return Math.max(factor, 0.3);
}

/**
 * The colour an inactive layer is drawn in when "Inactive Layer View Mode" is
 * on — `ACTIONS::highContrastMode`, "Toggle inactive layers between normal and
 * dimmed".
 *
 *     m_hiContrastColor[i] = m_layerColors[i].Mix( m_layerColors[LAYER_PCB_BACKGROUND],
 *                                                  m_hiContrastFactor );
 *                                              common/render_settings.cpp:92-93
 *
 * It is a colour mixed toward the BACKGROUND, not a transparency: the layer
 * keeps its opacity and loses its saturation against the board. Drawing it as
 * alpha instead composites against whatever happens to be underneath, so two
 * dimmed layers overlapping come out brighter than either — which is what ours
 * did with `globalAlpha = 0.3`.
 *
 * `GERBVIEW_PAINTER::getLayerColor` picks this for every layer that is not in
 * `m_highContrastLayers` (`gerbview/gerbview_painter.cpp:163-168`), and GerbView
 * puts exactly one layer in that set — the active one
 * (`gerbview_draw_panel_gal.cpp:74-86`).
 */
export function hiContrastColor(
  layerColor: Color4d,
  background: Color4d,
  /** `m_hiContrastFactor`. Defaults to the value the shipped setting yields. */
  factor: number = HI_CONTRAST_FACTOR,
): Color4d {
  return mix(layerColor, background, factor);
}
