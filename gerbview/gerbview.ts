// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `gerbview/gerbview.h`: the RS-274 interpreter's three enums.
 *
 * `gerbview/gerbview.cpp` is the KIFACE (`CreateKiWindow`, `OnKifaceStart`);
 * its Preferences-panel switch is `designer/src/editors/gerbview/prefs/index.ts`
 * until `dialogs/prefs/types` leaves the app (see STRUCTURE.md).
 */

import { EdaIuScale } from '@ziroeda/common/eda_units.js';

/** `Gerb_Interpolation` (`gerbview.h:33-38`), the G01 / G02 / G03 modes. */
export enum Gerb_Interpolation {
  GERB_INTERPOL_LINEAR_1X = 0,
  /** G02, clockwise. */
  GERB_INTERPOL_ARC_NEG,
  /** G03, counter-clockwise. */
  GERB_INTERPOL_ARC_POS,
}

/** `Gerb_GCommand` (`gerbview.h:42-58`), the G codes `Execute_G_Command` knows. */
export enum Gerb_GCommand {
  GC_MOVE = 0,
  GC_LINEAR_INTERPOL_1X = 1,
  GC_CIRCLE_NEG_INTERPOL = 2,
  GC_CIRCLE_POS_INTERPOL = 3,
  GC_COMMENT = 4,
  GC_TURN_ON_POLY_FILL = 36,
  GC_TURN_OFF_POLY_FILL = 37,
  GC_SELECT_TOOL = 54,
  /** Can start a D03 flash command: redundant with D03. */
  GC_PHOTO_MODE = 55,
  GC_SPECIFY_INCHES = 70,
  GC_SPECIFY_MILLIMETERS = 71,
  GC_TURN_OFF_360_INTERPOL = 74,
  GC_TURN_ON_360_INTERPOL = 75,
  GC_SPECIFY_ABSOLUES_COORD = 90,
  GC_SPECIFY_RELATIVEES_COORD = 91,
}

/** `Gerb_Analyse_Cmd` (`gerbview.h:61-66`), the reader's state. */
export enum Gerb_Analyse_Cmd {
  CMD_IDLE = 0,
  END_BLOCK,
  ENTER_RS274X_CMD,
}

/**
 * Our gerbview internal unit: **1 nm**, where KiCad's is 10 nm
 * (`GERB_IU_PER_MM = 1e5`, `include/base_units.h:69`, which is
 * `common/`'s `GERB_IU_PER_MM`). A divergence recorded in STRUCTURE.md: every
 * engine test pins nanometres, and `export_to_pcbnew`'s `MapToPcbUnits`
 * divides by this same value, so the exported millimetres agree with KiCad's
 * except in the digit KiCad's `KiROUND` drops.
 */
export const IU_PER_MM = 1e6;
/** Internal units per mil (0.001"), in our 1 nm unit. */
export const IU_PER_MILS = 25400;

/**
 * `gerbIUScale`, at our 1 nm (see {@link IU_PER_MM}). `common/eda_units.ts`
 * exports KiCad's 10 nm one under the same name; gerbview files import this
 * one, so reconciling the unit is a change to this line.
 */
export const gerbIUScale = new EdaIuScale(IU_PER_MM);
