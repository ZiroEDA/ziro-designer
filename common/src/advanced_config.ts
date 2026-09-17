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
  /** The DPI of the screen; `wxDC::GetPPI()` reports 96 but 91 is the closest match to the legacy renderer. */
  m_ScreenDPI = 91;

  /**
   * When true, strokes the triangulations in OpenGL
   */
  m_DrawTriangulationOutlines = false;

  /**
   * Multiplier for the hole wall plating thickness when painting hole walls.
   */
  m_HoleWallPaintingMultiplier = 1.5;

  /**
   * Hole wall plating thickness.  Used to determine actual hole size from finish hole size.
   */
  m_HoleWallThickness = 0.02; // IPC-6012 says 15-18um; Cadence says at least
  // 0.020 for a Class 2 board and at least 0.025
  // for Class 3.

  /**
   * The maximum number of threads to use in the thread pool.
   * Setting name: "MaximumThreads"
   * Valid values: 0 to 500
   * Default: 0 (auto-detect), i.e. `std::thread::hardware_concurrency()`
   */
  m_MaximumThreads = 0;

  private static s_cfg: ADVANCED_CFG | null = null;

  /** Get the singleton instance's config, which is shared by all consumers. */
  static GetCfg(): ADVANCED_CFG {
    if (!ADVANCED_CFG.s_cfg) ADVANCED_CFG.s_cfg = new ADVANCED_CFG();
    return ADVANCED_CFG.s_cfg;
  }
}
