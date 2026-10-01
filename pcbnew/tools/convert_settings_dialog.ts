// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `CONVERT_SETTINGS_DIALOG` (`pcbnew/tools/convert_tool.cpp:65-262`), the
 * logic half, and the "Conversion Settings" box the three zone editors add
 * when CONVERT_TOOL opens them (`dialog_copper_zones.cpp:137-171`,
 * `dialog_rule_area_properties.cpp:149-187`,
 * `dialog_non_copper_zones_properties.cpp:113-150`). The windows are
 * `convert_settings_dialog_ui.tsx`.
 */
import { type CONVERT_SETTINGS, CONVERT_STRATEGY } from '../pcbnew_settings.js';

/** The dialog's controls. */
export interface ConvertSettingsValues {
  /** Which radio is set: `m_rbMimicLineWidth`, `m_rbCenterline` or `m_rbBoundingHull`. */
  strategy: CONVERT_STRATEGY;
  /** `m_gap`, IU. */
  gap: number;
  /** `m_width`, IU. */
  lineWidth: number;
  deleteOriginals: boolean;
}

/** Which controls the dialog shows: its three constructor flags. */
export interface ConvertSettingsShown {
  copyLineWidth: boolean;
  centerline: boolean;
  boundingHull: boolean;
}

export class CONVERT_SETTINGS_DIALOG {
  constructor(
    private readonly m_settings: CONVERT_SETTINGS,
    readonly m_shown: ConvertSettingsShown,
  ) {}

  /** `TransferDataToWindow` (:205-221). */
  TransferDataToWindow(): ConvertSettingsValues {
    const s = this.m_settings;

    return {
      strategy: s.m_Strategy,
      gap: s.m_Gap,
      lineWidth: s.m_LineWidth,
      deleteOriginals: s.m_DeleteOriginals,
    };
  }

  /**
   * `TransferDataFromWindow` (:223-237). A hidden radio still holds the value
   * TransferDataToWindow gave it, so a strategy round-trips whichever radios
   * are shown.
   */
  TransferDataFromWindow(v: ConvertSettingsValues): void {
    const s = this.m_settings;

    if (v.strategy === CONVERT_STRATEGY.BOUNDING_HULL)
      s.m_Strategy = CONVERT_STRATEGY.BOUNDING_HULL;
    else if (v.strategy === CONVERT_STRATEGY.CENTERLINE) s.m_Strategy = CONVERT_STRATEGY.CENTERLINE;
    else s.m_Strategy = CONVERT_STRATEGY.COPY_LINEWIDTH;

    s.m_Gap = v.gap;
    s.m_LineWidth = v.lineWidth;

    s.m_DeleteOriginals = v.deleteOriginals;
  }

  /** `onRadioButton` / TransferDataToWindow: the gap and width bind only to the hull. */
  static HullParamsEnabled(v: ConvertSettingsValues): boolean {
    return v.strategy === CONVERT_STRATEGY.BOUNDING_HULL;
  }
}

/** The zone editors' "Conversion Settings" box: centerline or hull, gap, delete. */
export interface ConversionBoxValues {
  boundingHull: boolean;
  gap: number;
  deleteOriginals: boolean;
}

/**
 * The box's transfers, which differ per dialog: the copper and non-copper
 * editors load the gap (`m_gap->SetValue( m_convertSettings->m_Gap )` in the
 * constructor) and always write it back; the rule-area editor does neither,
 * so its gap opens at 0 and is written only when the hull is chosen
 * (dialog_rule_area_properties.cpp:237-245, :423-436).
 */
export const CONVERSION_BOX = {
  ToWindow(aSettings: CONVERT_SETTINGS, aRuleArea: boolean): ConversionBoxValues {
    return {
      boundingHull: aSettings.m_Strategy === CONVERT_STRATEGY.BOUNDING_HULL,
      gap: aRuleArea ? 0 : aSettings.m_Gap,
      deleteOriginals: aSettings.m_DeleteOriginals,
    };
  },

  FromWindow(aSettings: CONVERT_SETTINGS, v: ConversionBoxValues, aRuleArea: boolean): void {
    if (aRuleArea) {
      if (v.boundingHull) {
        aSettings.m_Strategy = CONVERT_STRATEGY.BOUNDING_HULL;
        aSettings.m_Gap = v.gap;
      } else {
        aSettings.m_Strategy = CONVERT_STRATEGY.CENTERLINE;
      }

      aSettings.m_DeleteOriginals = v.deleteOriginals;
      return;
    }

    if (v.boundingHull) aSettings.m_Strategy = CONVERT_STRATEGY.BOUNDING_HULL;
    else aSettings.m_Strategy = CONVERT_STRATEGY.CENTERLINE;

    aSettings.m_DeleteOriginals = v.deleteOriginals;
    aSettings.m_Gap = v.gap;
  },
};
