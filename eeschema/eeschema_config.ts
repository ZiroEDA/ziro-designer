// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/eeschema_config.cpp`: the Schematic Editor's project-settings
 * half. Ported so far: the render-settings seed `LoadProjectSettings` applies.
 * The rest of that file (`LoadDrawingSheet`, `ShowSchematicSetupDialog`,
 * `SaveProjectLocalSettings`, `LoadSettings`/`SaveSettings`) is still woven
 * through `sch_edit_frame_ui.tsx` and designer's settings store.
 */
import {
  IU_PER_MILS,
  hopOverArcRadiusIU,
  junctionDotDiameterIU,
  subpartSettings,
  type SchematicSetup,
} from './schematic_settings.js';

/**
 * `SCH_EDIT_FRAME::LoadProjectSettings` (eeschema_config.cpp:59-80): the
 * `SCH_RENDER_SETTINGS` members it seeds from `SCHEMATIC_SETTINGS` —
 *
 *     GetRenderSettings()->m_LabelSizeRatio  = settings.m_LabelSizeRatio;
 *     GetRenderSettings()->m_TextOffsetRatio = settings.m_TextOffsetRatio;
 *     GetRenderSettings()->m_PinSymbolSize   = settings.m_PinSymbolSize;
 *     GetRenderSettings()->SetDashLengthRatio( settings.m_DashedLineDashRatio );
 *     GetRenderSettings()->SetGapLengthRatio( settings.m_DashedLineGapRatio );
 *
 * — plus the drawing defaults every output (screen, print, plot) takes from
 * Schematic Setup > Formatting the same way. Returned rather than applied: the
 * frame spreads it into its `RenderOpts`.
 */
export function LoadProjectSettings(setup: SchematicSetup) {
  return {
    junctionDiameterIU: junctionDotDiameterIU(setup),
    dashLengthRatio: setup.formatting.dashLengthRatio,
    gapLengthRatio: setup.formatting.gapLengthRatio,
    // The panel stores percent (KiCad UI convention); the ratio is /100.
    textOffsetRatio: setup.formatting.labelOffsetRatio / 100,
    labelSizeRatio: setup.formatting.labelSizeRatio / 100,
    // Overbar offset is stored as the raw ratio (1.23), not percent.
    overbarHeightRatio: setup.formatting.overbarOffsetRatio,
    // 0 mils is meaningful: KiCad's per-pin text-size fallback.
    pinSymbolSizeIU: setup.formatting.pinSymbolSizeMils * IU_PER_MILS,
    // Wire hop-over arc radius (default line width × GetHopOverScale).
    hopOverRadiusIU: hopOverArcRadiusIU(setup),
    // Multi-unit reference notation (SCHEMATIC_SETTINGS::SubReference).
    subpart: subpartSettings(setup.annotation),
  };
}
