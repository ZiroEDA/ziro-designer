// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * @ziroeda/pcb_calculator, Calculator Tools engine.
 * Counterpart: KiCad `pcb_calculator/`.
 */

export * from './format.js';
export * from './eseries.js';
export * from './resistor_substitution_utils.js';
export * from './regulator_datafile.js';
export * from './regulators_funct.js';
export * from './tracks_width_versus_current_formula.js';
export * from './via_size.js';
export * from './electrical_spacing_values.js';
export * from './iec60664.js';
export * from './fusing_current.js';
export * from './cable_size.js';
export * from './common_data.js';
export * from './wavelength.js';
export * from './board_classes_values.js';
export * from './galvanic_corrosion.js';
export * from './color_code.js';
export * from './attenuators/attenuator_classes.js';
// The line maths and the `TRANSLINE_CALCULATION_BASE` classes live in
// `common/src/transline_calculations/` since 09-21, where KiCad keeps them;
// the four files below are the ones the Tuning Profiles calculator shares.
// `transline/` keeps pcb_calculator's own functional adapters over them.
export * from './transline/transline.js';
export {
  type DielectricModelParams,
  type DjordjevicSarkarModel,
  dispersedSubstrate,
  djordjevicSarkarFit,
  dsEpsilonRealAt,
  dsTanDeltaAt,
  type SoldermaskParams,
  applySoldermaskCorrection,
  coplanarSoldermaskDeltaQ,
  microstripSoldermaskDeltaQ,
  wanHoorfarQ2,
  // TRANSLINE::calcUnitPropagationDelay (transline.cpp:443) — the panel's
  // "Unit propagation delay:" row, which was never rendered.
  unitPropagationDelay,
  /** The electrical inputs every line type shares. */
  type TcElectrical,
} from '@ziroeda/common/src/transline_calculations/tc_common.js';
export * from '@ziroeda/common/src/transline_calculations/microstrip.js';
export * from '@ziroeda/common/src/transline_calculations/coupled_microstrip.js';
export * from './transline/coplanar.js';
export * from './transline/coax.js';
export * from './transline/rectwaveguide.js';
export * from '@ziroeda/common/src/transline_calculations/stripline.js';
export * from '@ziroeda/common/src/transline_calculations/coupled_stripline.js';
export * from './transline/twistedpair.js';
