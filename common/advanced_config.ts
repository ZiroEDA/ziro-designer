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
   * Show UUIDs of items in the message panel: 0 no, 1 the whole UUID, 2 its
   * first eight characters. Setting name: "MsgPanelShowUuids"; default 0.
   */
  m_MsgPanelShowUuids = 0;

  /**
   * The number of milliseconds to wait in a click before showing a disambiguation menu.
   * Setting name: "DisambiguationTime"; default 500.
   */
  m_DisambiguationMenuDelay = 500;

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
   * Epsilon used in DRC to check for overlapping shapes and edges (mm).
   * Setting name: "DRCEpsilon"
   */
  m_DRCEpsilon = 0.0005; // 0.5um is small enough not to materially violate
  // any constraints.

  /**
   * Sliver width tolerance for DRC.
   *
   * Units are mm.
   *
   * Setting name: "DRCSliverWidthTolerance"
   * Valid values: 0.01 to 0.25
   * Default value: 0.08
   */
  m_SliverWidthTolerance = 0.08;

  /**
   * Sliver length tolerance for DRC.
   *
   * Units are mm.
   *
   * Setting name: "DRCSliverMinimumLength"
   * Valid values: 1e-9 to 10
   * Default value: 0.0008
   */
  m_SliverMinimumLength = 0.0008;

  /**
   * Sliver angle to tolerance for DRC.
   *
   * Units are mm.
   *
   * Setting name: "DRCSliverAngleTolerance"
   * Valid values: 1 to 90
   * Default value: 20
   */
  m_SliverAngleTolerance = 20.0;

  /**
   * When filling zones, we add an extra amount of clearance to each zone to ensure that
   * rounding errors do not overrun minimum clearance distances.
   *
   * This is the extra clearance in mm.
   *
   * Setting name: "ExtraFillMargin"
   * Valid values: 0 to 1
   * Default value: 0.0005
   */
  m_ExtraClearance = 0.0005;

  /**
   * Enable the minimum slot width check for creepage
   *
   * Setting name: "EnableCreepageSlot"
   * Default value: false
   */
  m_EnableCreepageSlot = false;

  /**
   * Minimum overlapping angle for which an arc is considered to be parallel
   * to its paired arc.
   *
   * Setting name: "MinParallelAngle"
   * Default value: 0.001
   */
  m_MinParallelAngle = 0.001;

  /**
   * The maximum number of threads to use in the thread pool.
   * Setting name: "MaximumThreads"
   * Valid values: 0 to 500
   * Default: 0 (auto-detect), i.e. `std::thread::hardware_concurrency()`
   */
  m_MaximumThreads = 0;

  /**
   * When point-editing an arc by an endpoint while keeping the tangent at the
   * other end, the derived radius is rejected once `|v2.y / (R - v2.x)|`
   * exceeds this, so a near-degenerate drag cannot blow the radius up to
   * overflow the geometry that draws it.
   * Setting name: "DrawArcCenterMaxAngle"
   * Default value: 50.0
   */
  m_DrawArcCenterMaxAngle = 50.0;

  /**
   * How long (in milliseconds) `CONSTRUCTION_MANAGER` waits before a
   * proposed batch of temporary construction geometry is accepted and shown,
   * unless it is a persistent batch or the timeout is superseded first.
   * Setting name: "ExtensionSnapTimeoutMs"; default 500.
   */
  m_ExtensionSnapTimeoutMs = 500;

  /**
   * The drill mark size, in mm, the plotters use for "Small" drill marks.
   * Setting name: "SmallDrillMarkSize"; default 0.35 (clamped 0.0 .. 3.0).
   */
  m_SmallDrillMarkSize = 0.35;

  private static s_cfg: ADVANCED_CFG | null = null;

  /** Get the singleton instance's config, which is shared by all consumers. */
  static GetCfg(): ADVANCED_CFG {
    if (!ADVANCED_CFG.s_cfg) ADVANCED_CFG.s_cfg = new ADVANCED_CFG();
    return ADVANCED_CFG.s_cfg;
  }
}
