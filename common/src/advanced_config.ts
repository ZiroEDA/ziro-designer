// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `advanced_config.h`: `ADVANCED_CFG`, the developer settings at their
 * defaults (`advanced_config.cpp`). There is no `kicad_advanced` file to load
 * here; the values are the ones the reference ships with. Members join as
 * the code that reads them is ported.
 */

export class ADVANCED_CFG {
  /**
   * Set the bevel height of layer items in 3D viewer when ray tracing.
   * Controls the start of the bevel and the extent, as a proportion of the
   * layer thickness.
   */
  /** The DPI of the screen; `wxDC::GetPPI()` reports 96 but 91 is the closest match to the legacy renderer. */
  m_ScreenDPI = 91;

  private static s_cfg: ADVANCED_CFG | null = null;

  /** Get the singleton instance's config, which is shared by all consumers. */
  static GetCfg(): ADVANCED_CFG {
    if (!ADVANCED_CFG.s_cfg) ADVANCED_CFG.s_cfg = new ADVANCED_CFG();
    return ADVANCED_CFG.s_cfg;
  }
}
