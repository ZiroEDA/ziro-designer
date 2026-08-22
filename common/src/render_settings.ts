// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `RENDER_SETTINGS`, reduced to the accessors a plotter reaches for —
 * KiCad's `include/render_settings.h` and `common/render_settings.cpp`.
 *
 * The dash and gap ratios are NOT `PLOTTER` statics: upstream keeps them on
 * `RENDER_SETTINGS` (render_settings.h:347-348, defaulted in
 * render_settings.cpp:32-33), and `PLOTTER::GetDashMarkLenIU` /
 * `GetDashGapLenIU` (common/plotters/plotter.cpp:142,148) ask the render
 * settings for the length. So they live here rather than next to the
 * line-width sentinels, at the level of sharing upstream gives them.
 *
 * Settings are injected rather than imported because the engine packages must
 * not reach into `designer/`'s theme; `plotterRenderSettings` builds a
 * faithful one for a caller that has no theme to offer.
 */

import { type Color4d, mix } from './color4d.js';

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
const DASH_CORRECTION = 1.0;

/** `RENDER_SETTINGS`' ISO 128-2 defaults — render_settings.cpp:32-33. */
export const DEFAULT_DASH_LENGTH_RATIO = 12;
export const DEFAULT_GAP_LENGTH_RATIO = 3;

/**
 * `RENDER_SETTINGS::GetDashLength` / `GetDotLength` / `GetGapLength`
 * (render_settings.cpp:65-83). The dot length ignores both ratios and is
 * floored at 0.2 of the width, which is what keeps a dot from collapsing to a
 * zero-length line. `m_defaultPenWidth` starts at a bare zero.
 */
export function plotterRenderSettings(
  aOptions: { defaultPenWidth?: number; dashLengthRatio?: number; gapLengthRatio?: number } = {},
): PlotterRenderSettings {
  const defaultPenWidth = aOptions.defaultPenWidth ?? 0;
  const dashLengthRatio = aOptions.dashLengthRatio ?? DEFAULT_DASH_LENGTH_RATIO;
  const gapLengthRatio = aOptions.gapLengthRatio ?? DEFAULT_GAP_LENGTH_RATIO;

  return {
    GetDefaultPenWidth: () => defaultPenWidth,
    GetDashLength: (aLineWidth) => Math.max(dashLengthRatio - DASH_CORRECTION, 1.0) * aLineWidth,
    GetDotLength: (aLineWidth) => Math.max(1.0 - DASH_CORRECTION, 0.2) * aLineWidth,
    GetGapLength: (aLineWidth) => Math.max(gapLengthRatio + DASH_CORRECTION, 1.0) * aLineWidth,
  };
}

/**
 * `RENDER_SETTINGS::m_hiContrastFactor`, `common/render_settings.cpp:42`.
 *
 * [data] KiCad's own constant, not a shade we chose.
 */
export const HI_CONTRAST_FACTOR = 0.2;

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
export function hiContrastColor(layerColor: Color4d, background: Color4d): Color4d {
  return mix(layerColor, background, HI_CONTRAST_FACTOR);
}
