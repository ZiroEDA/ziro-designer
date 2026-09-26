// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DPI_SCALING_COMMON` (include/dpi_scaling_common.h,
 * common/dpi_scaling_common.cpp): the canvas scale from, in order, the user's
 * `appearance.canvas_scale`, `GDK_SCALE` (the build is GTK), the platform's
 * answer for the window, and `DPI_SCALING::GetDefaultScaleFactor()`.
 */
import { DPI_SCALING } from './dpi_scaling.js';
import { ENV_VAR } from './env_vars.js';
import * as KIPLATFORM_UI from './kiplatform/ui.js';

/** The part of `COMMON_SETTINGS` a DPI source reads and writes. */
export interface DPI_SCALING_CONFIG {
  m_Appearance: { canvas_scale: number };
}

/** Get a user-configured scale factor from KiCad config file. */
function getKiCadConfiguredScale(aConfig: DPI_SCALING_CONFIG): number | undefined {
  const canvas_scale = aConfig.m_Appearance.canvas_scale;
  return canvas_scale > 0.0 ? canvas_scale : undefined;
}

/**
 * Get the toolkit scale factor from a user-set environment variable
 * (`GDK_SCALE` on GTK, the port this build mirrors).
 */
function getEnvironmentScale(): number | undefined {
  return ENV_VAR.GetEnvVarDouble('GDK_SCALE');
}

export class DPI_SCALING_COMMON extends DPI_SCALING {
  private readonly m_config: DPI_SCALING_CONFIG | null;
  /** The window the platform is asked about; null asks for none. */
  private readonly m_window: KIPLATFORM_UI.PlatformWindow | null;

  constructor(aConfig: DPI_SCALING_CONFIG | null, aWindow: KIPLATFORM_UI.PlatformWindow | null) {
    super();
    this.m_config = aConfig;
    this.m_window = aWindow;
  }

  GetScaleFactor(): number {
    let val: number | undefined;

    if (this.m_config) val = getKiCadConfiguredScale(this.m_config);

    if (val === undefined) val = getEnvironmentScale();

    if (val === undefined && this.m_window) val = KIPLATFORM_UI.GetPixelScaleFactor(this.m_window);

    if (val === undefined) val = DPI_SCALING.GetDefaultScaleFactor();

    return val;
  }

  GetContentScaleFactor(): number {
    let val: number | undefined;

    if (this.m_config) val = getKiCadConfiguredScale(this.m_config);

    if (val === undefined) val = getEnvironmentScale();

    if (val === undefined && this.m_window)
      val = KIPLATFORM_UI.GetContentScaleFactor(this.m_window);

    if (val === undefined) val = DPI_SCALING.GetDefaultScaleFactor();

    return val;
  }

  GetCanvasIsAutoScaled(): boolean {
    if (this.m_config === null) return true;

    return getKiCadConfiguredScale(this.m_config) === undefined;
  }

  SetDpiConfig(aAuto: boolean, aValue: number): void {
    if (this.m_config === null) throw new Error('Setting DPI config without a config store.');

    this.m_config.m_Appearance.canvas_scale = aAuto ? 0.0 : aValue;
  }
}
