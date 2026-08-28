// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The dimming tail of `SCH_PAINTER::getRenderColor`
 * (`eeschema/sch_painter.cpp:482-486`).
 *
 * It is the last thing that happens to a colour, after the brightened /
 * selected / disabled branches have chosen one:
 *
 *     if( aDimmed && !( aItem->IsSelected() && aDrawingShadows ) )
 *     {
 *         COLOR4D sheetColour = m_schSettings.GetLayerColor( LAYER_SCHEMATIC_BACKGROUND );
 *         color.Desaturate();
 *         color = color.Mix( sheetColour, 0.5f );
 *     }
 *
 * `aDimmed` has exactly one source in eeschema: the symbol's (or sheet's) DNP
 * flag. `draw( SCH_SYMBOL )` computes `DNP` at `sch_painter.cpp:2695` and hands
 * it to every field (`:2705`) and to the body (`:2790`) as that argument. The
 * excluded-from-simulation flag is computed on the very next line (`:2696`) and
 * is NOT passed anywhere — it only gates the marker at `:2837`. So a symbol
 * that is excluded from simulation but populated keeps its full colours, and it
 * is DNP alone that greys a symbol out.
 *
 * The arithmetic itself is `COLOR4D`'s and lives in `common/src/color4d.ts`
 * with the rest of it; this module only states the order and the 0.5.
 */
import { desaturate, mix, parseColor4d, toCssColor } from '@ziroeda/common';

/**
 * [data] `color.Mix( sheetColour, 0.5f )` — the fraction upstream writes into
 * the call, not a value the theme decides.
 */
const DIM_MIX_FACTOR = 0.5;

/**
 * `aDimmed`'s effect on one already-resolved colour.
 *
 * `background` is `GetLayerColor( LAYER_SCHEMATIC_BACKGROUND )`, i.e. the
 * theme's sheet colour — which is why a DNP symbol fades toward beige under
 * "KiCad Default" and toward white under "KiCad Classic", rather than toward a
 * fixed grey.
 */
export function dimmedColor(color: string, background: string): string {
  const desaturated = desaturate(parseColor4d(color));
  return toCssColor(mix(desaturated, parseColor4d(background), DIM_MIX_FACTOR), ', ');
}
