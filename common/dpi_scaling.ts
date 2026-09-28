// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DPI_SCALING` (include/dpi_scaling.h, common/dpi_scaling.cpp): the
 * interface a scale source answers, and the bounds a canvas scale may take.
 */
export abstract class DPI_SCALING {
  /**
   * Get the DPI scale from all known sources in order: KiCad config, the
   * toolkit's environment variable, the platform, a fallback of 1.0.
   */
  abstract GetScaleFactor(): number;

  /** As GetScaleFactor, for the content scale (fonts, icons). */
  abstract GetContentScaleFactor(): number;

  /** Is the current value auto scaled, or is it user-set in the config? */
  abstract GetCanvasIsAutoScaled(): boolean;

  /** Set the common DPI config in a given config object. */
  abstract SetDpiConfig(aAuto: boolean, aValue: number): void;

  /** Get the maximum scaling factor that should be presented to the user. */
  static GetMaxScaleFactor(): number {
    // displays with higher than 4.0 DPI are not really going to be useful
    // for KiCad (even an 8k display would be effectively only ~1080p at 4x)
    return 6.0;
  }

  /** Get the minimum scaling factor that should be presented to the user. */
  static GetMinScaleFactor(): number {
    // scales under 1.0 don't make sense from a HiDPI perspective
    return 1.0;
  }

  /** Get the "default" scaling factor to use if not otherwise specified. */
  static GetDefaultScaleFactor(): number {
    // no scaling => 1.0
    return 1.0;
  }
}
