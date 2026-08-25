// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The unit drop-downs, one table per upstream class.
 * Counterpart: KiCad `pcb_calculator/widgets/unit_selector.cpp`.
 *
 * Upstream these are twelve `wxChoice` **subclasses**, each appending its own
 * fixed list in its constructor and answering `GetUnitScale()`. Every one of
 * the thirty-nine selectors across the eight panels is an instance of one of
 * them, which is why upstream's `um` is spelt the same way in all nineteen
 * UNIT_SELECTOR_LEN sites — nobody can retype it. Ours had drifted into
 * per-panel copies and one of them had picked up a `µm`; this file is the one
 * place the lists are written.
 *
 * `mult` is what a typed number is multiplied by to reach the SI unit the
 * engines work in — metres, hertz, ohms, radians, seconds, volts, watts, m/s.
 * `units_scales.h` states some of them the other way round (`UNIT_MILLIVOLT
 * 1e+3`), because the panels that use those two multiply on display rather
 * than on input; same conversion, stated inversely.
 *
 * A plain `.ts` rather than part of `fields.tsx` so the qa suite can check
 * these tables entry by entry without pulling React in.
 */

/** Unit option: label + multiplier to the base SI unit. */
export interface UnitOpt {
  label: string;
  mult: number;
  /** A lone unit is a wxStaticText, and some of them carry their own tooltip
   *  ("nanoseconds" on Via Size's ns, panel_via_size_base.cpp:191). */
  title?: string;
}

/**
 * UNIT_SELECTOR_LEN — mm, um, cm, mil, inch (unit_selector.cpp:34-38).
 * Five entries, and the micron one is spelled with an ASCII `u`, where the
 * THICKNESS selector below spells the same unit `µm`. The inconsistency is
 * upstream's and it is visible: a wxChoice is as wide as its widest entry, and
 * on Track Width the two lists sit one above the other. We had a sixth entry,
 * `m`, that pcb_calculator has nowhere.
 */
export const LEN_UNITS: UnitOpt[] = [
  { label: 'mm', mult: 1e-3 },
  { label: 'um', mult: 1e-6 },
  { label: 'cm', mult: 1e-2 },
  { label: 'mil', mult: 25.4e-6 },
  { label: 'inch', mult: 25.4e-3 },
];

/**
 * UNIT_SELECTOR_THICKNESS — the LEN list plus oz/ft², with `µm` spelled with
 * the micro sign (unit_selector.cpp:66-71). Copper weight converts at
 * UNIT_OZSQFT = 34.40 µm (units_scales.h:39). Track Width's two thickness
 * rows and Fusing Current's thickness row use this one, not LEN.
 */
export const THICK_UNITS: UnitOpt[] = [
  { label: 'mm', mult: 1e-3 },
  { label: 'µm', mult: 1e-6 },
  { label: 'cm', mult: 1e-2 },
  { label: 'mil', mult: 25.4e-6 },
  { label: 'inch', mult: 25.4e-3 },
  { label: 'oz/ft²', mult: 34.4e-6 },
];

/** UNIT_SELECTOR_FREQUENCY — GHz down to Hz (unit_selector.cpp:98-101), and
 *  UNIT_GHZ / UNIT_MHZ / UNIT_KHZ (units_scales.h:41-43). */
export const FREQ_UNITS: UnitOpt[] = [
  { label: 'GHz', mult: 1e9 },
  { label: 'MHz', mult: 1e6 },
  { label: 'kHz', mult: 1e3 },
  { label: 'Hz', mult: 1 },
];

/** UNIT_SELECTOR_ANGLE — rad then deg (unit_selector.cpp:129-130), and
 *  UNIT_RADIAN / UNIT_DEGREE = M_PI/180 (units_scales.h:45-46). Held in
 *  radians, which is index 0 and therefore what Ang_l opens in. */
export const ANGLE_UNITS: UnitOpt[] = [
  { label: 'rad', mult: 1 },
  { label: 'deg', mult: Math.PI / 180 },
];

/** UNIT_SELECTOR_RESISTOR — two entries, Ω and kΩ (unit_selector.cpp:154-155).
 *  We had invented a third, MΩ. */
export const RES_UNITS: UnitOpt[] = [
  { label: 'Ω', mult: 1 },
  { label: 'kΩ', mult: 1e3 },
];

/** UNIT_SELECTOR_TIME — **two** entries, ns and ps (unit_selector.cpp:322-323),
 *  and UNIT_NSECOND / UNIT_PSECOND (units_scales.h). We had five: s, ms, µs, ns,
 *  ps. A wxChoice is as wide as its widest entry, so an invented list is
 *  visible even before anyone opens it. */
export const TIME_UNITS: UnitOpt[] = [
  { label: 'ns', mult: 1e-9 },
  { label: 'ps', mult: 1e-12 },
];

/**
 * UNIT_SELECTOR_LEN_CABLE — cm, m, km, inch, **feet**
 * (unit_selector.cpp:198-202). A different list from UNIT_SELECTOR_LEN and the
 * only one that has metres in it; Cable Size's length and Wavelength's two
 * wavelength rows use it. The last entry is spelt "feet", not "ft".
 */
export const CABLE_LEN_UNITS: UnitOpt[] = [
  { label: 'cm', mult: 1e-2 },
  { label: 'm', mult: 1 },
  { label: 'km', mult: 1e3 },
  { label: 'inch', mult: 25.4e-3 },
  { label: 'feet', mult: 0.3048 },
];

/**
 * UNIT_SELECTOR_LINEAR_RESISTANCE (unit_selector.cpp:172-175).
 *
 * The two feet constants are `3.28084` and `3.28084e-3` verbatim
 * (units_scales.h:52-55) — [data], and NOT `1 / 0.3048`, which differs in the
 * sixth significant figure and so in a `%g` field.
 */
export const LIN_RES_UNITS: UnitOpt[] = [
  { label: 'Ω/m', mult: 1 },
  { label: 'Ω/km', mult: 1e-3 },
  { label: 'Ω/ft', mult: 3.28084 },
  { label: 'Ω/1000ft', mult: 3.28084e-3 },
];

/**
 * UNIT_SELECTOR_VOLTAGE — mV, V (unit_selector.cpp:257-258).
 *
 * `mult` is metres-per-unit throughout this file, i.e. what a typed number is
 * multiplied by to reach SI. Upstream's `UNIT_MILLIVOLT` is `1e+3` because the
 * two places that use it *multiply on display* (`m_voltageDrop *
 * GetUnitScale()`, panel_cable_size.cpp:536); the same conversion, stated the
 * other way round.
 */
export const VOLTAGE_UNITS: UnitOpt[] = [
  { label: 'mV', mult: 1e-3 },
  { label: 'V', mult: 1 },
];

/** UNIT_SELECTOR_POWER — mW, W (unit_selector.cpp:278-279); `UNIT_MILLIWATT`
 *  is `1e+3` for the same reason `UNIT_MILLIVOLT` is. */
export const POWER_UNITS: UnitOpt[] = [
  { label: 'mW', mult: 1e-3 },
  { label: 'W', mult: 1 },
];

/**
 * UNIT_SELECTOR_SPEED — m/s, ft/s, km/h, mi/h (unit_selector.cpp:287-291).
 *
 * **`mi/h` is 1609.34, and that is upstream's bug, mirrored.** `UNIT_MILES_PER_HOUR`
 * is defined as `1609.34` (units_scales.h:68), which is the mile in *metres* —
 * the miles-per-hour factor is 0.44704. Wavelength divides by it
 * (panel_wavelength.cpp:118), so the installed build prints the speed of light
 * as 186411 under a label reading "mi/h". This is [data] KiCad hardcodes, so
 * ours reads 186411 too rather than the physically correct 6.71e8: the point of
 * the port is that the two panels agree.
 */
export const SPEED_UNITS: UnitOpt[] = [
  { label: 'm/s', mult: 1 },
  { label: 'ft/s', mult: 0.3048 },
  { label: 'km/h', mult: 1 / 3.6 },
  { label: 'mi/h', mult: 1609.34 },
];

/** Index of a unit by label (build-time convenience for defaults). */
export const unitIndex = (units: UnitOpt[], label: string): number =>
  Math.max(
    0,
    units.findIndex((u) => u.label === label),
  );
