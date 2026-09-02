// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SYMBOL_EDITOR_SETTINGS::DEFAULTS` in internal units — what a newly drawn
 * item is born with.
 *
 * Upstream every one of these is read at the point the item is constructed, and
 * always through `schIUScale.MilsToIU`, because the file stores mils:
 *
 *     int lineWidth = schIUScale.MilsToIU( cfg->m_Defaults.line_width );
 *     text->SetTextSize( VECTOR2I( schIUScale.MilsToIU( cfg->m_Defaults.text_size ), … ) );
 *       (`eeschema/tools/symbol_editor_drawing_tools.cpp:480`, `:240-241`)
 *     g_LastPinLength  = schIUScale.MilsToIU( cfg->m_Defaults.pin_length );
 *     g_LastPinNameSize = schIUScale.MilsToIU( cfg->m_Defaults.pin_name_size );
 *     g_LastPinNumSize  = schIUScale.MilsToIU( cfg->m_Defaults.pin_num_size );
 *       (`eeschema/tools/symbol_editor_pin_tool.cpp:50-79`)
 *
 * The conversion is the whole of this module, and it is here rather than inline
 * so that "Preferences says 60 mils, the new pin is 60 mils" is a thing `qa`
 * can assert without a canvas. Before this the five numbers were literals in
 * `SymbolEditor.tsx` and `components/dialogs.tsx` — `2.54 * MM`, `1.27 * MM` —
 * which happened to equal the defaults and could not be changed by anything.
 */
import { schIUScale } from '@ziroeda/common';
import { settings, type SymbolEditorSettings } from '../../prefs/settings.js';

/** The five `defaults.*` values, converted once. */
export interface SymbolItemDefaults {
  /** `defaults.line_width`. **0 means "inherit"**, and stays 0 here. */
  lineWidthIU: number;
  /** `defaults.text_size`. */
  textSizeIU: number;
  /** `defaults.pin_length`. */
  pinLengthIU: number;
  /** `defaults.pin_name_size`. */
  pinNameSizeIU: number;
  /** `defaults.pin_num_size`. */
  pinNumberSizeIU: number;
}

export function symbolItemDefaults(
  cfg: SymbolEditorSettings = settings.symbolEditor,
): SymbolItemDefaults {
  const iu = (mils: number): number => schIUScale.milsToIU(mils);
  return {
    // Not clamped and not defaulted away: `line_width` 0 is a value with a
    // meaning — "allow symbols to inherit line width properties from
    // schematic", which is the page's own note under the field — and the
    // caller is what decides to leave the stroke off entirely.
    lineWidthIU: iu(cfg.defaults.line_width),
    textSizeIU: iu(cfg.defaults.text_size),
    pinLengthIU: iu(cfg.defaults.pin_length),
    pinNameSizeIU: iu(cfg.defaults.pin_name_size),
    pinNumberSizeIU: iu(cfg.defaults.pin_num_size),
  };
}
