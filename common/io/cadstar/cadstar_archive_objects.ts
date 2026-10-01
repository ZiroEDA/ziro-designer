// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/io/cadstar/cadstar_archive_objects.h`: the pin enums the CADSTAR
 * schematic and PCB archive parsers share.
 */

export enum CADSTAR_PIN_TYPE {
  UNCOMMITTED, ///< Uncommitted pin (default)
  PIN_INPUT, ///< Input pin
  OUTPUT_OR, ///< Output pin OR tieable
  OUTPUT_NOT_OR, ///< Output pin not OR tieable
  OUTPUT_NOT_NORM_OR, ///< Output pin not normally OR tieable
  POWER, ///< Power pin
  GROUND, ///< Ground pin
  TRISTATE_BIDIR, ///< Tristate bi-directional driver pin
  TRISTATE_INPUT, ///< Tristate input pin
  TRISTATE_DRIVER, ///< Tristate output pin
}

export enum CADSTAR_PIN_POSITION {
  TOP_RIGHT = 0, ///< North East
  TOP_LEFT = 1, ///< North West
  BOTTOM_LEFT = 2, ///< South West
  BOTTOM_RIGHT = 3, ///< South East
}
