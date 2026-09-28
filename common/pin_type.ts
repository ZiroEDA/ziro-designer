// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `ELECTRICAL_PINTYPE` and its canonical names.
 * Counterpart: `common/pin_type.h:35-81` — and it lives in common/ for the same
 * reason it does upstream: eeschema owns the pin, but pcbnew reads the type off
 * a pad (`(pintype …)`, PAD::GetPinType) and lists the same twelve values in the
 * Properties panel's Pin Type cell.
 *
 * "These strings are the canonical name of the electrical type. Not translated,
 * no space in name, only ASCII chars." They are also the file tokens, which is
 * why both editors store exactly these strings. The ORDER is the enum's, and
 * `GetCanonicalElectricalTypeName` indexes this array by it, so it is data, not
 * presentation: sorting it would renumber the enum.
 *
 * The human-readable labels are a different table — `g_pinElectricalTypes` in
 * `eeschema/pin_type.cpp`, ours in `eeschema/pin_type.ts` — because upstream
 * separates them too: the panel's Pin Type combo lists these canonical names.
 */

export const ELECTRICAL_PINTYPES = [
  'input',
  'output',
  'bidirectional',
  'tri_state',
  'passive',
  /** PT_NIC — not internally connected. */
  'free',
  'unspecified',
  'power_in',
  'power_out',
  'open_collector',
  'open_emitter',
  /** PT_NC. */
  'no_connect',
] as const;

export type ElectricalPinType = (typeof ELECTRICAL_PINTYPES)[number];

/**
 * `enum class ELECTRICAL_PINTYPE` (common/pin_type.h): the numeric enum the live item
 * classes hold. Its order is `ELECTRICAL_PINTYPES` above, whose names
 * `GetCanonicalElectricalTypeName` returns.
 */
export enum ELECTRICAL_PINTYPE {
  PT_INPUT, ///< usual pin input: must be connected
  PT_OUTPUT, ///< usual output
  PT_BIDI, ///< input or output (like port for a microprocessor)
  PT_TRISTATE, ///< tri state bus pin
  PT_PASSIVE, ///< pin for passive symbols: must be connected, and can be connected to any pin.
  PT_NIC, ///< not internally connected (may be connected to anything)
  PT_UNSPECIFIED, ///< unknown electrical properties: creates always a warning when connected
  PT_POWER_IN, ///< power input (GND, VCC for ICs). Must be connected to a power output.
  PT_POWER_OUT, ///< output of a regulator: intended to be connected to power input pins
  PT_OPENCOLLECTOR, ///< pin type open collector
  PT_OPENEMITTER, ///< pin type open emitter
  PT_NC, ///< not connected (must be left open)

  PT_LAST_OPTION = PT_NC, ///< sentinel value, set to last usable enum option
  PT_INHERIT, ///< inherit from the library pin
}

/** `ELECTRICAL_PINTYPES_TOTAL`. */
export const ELECTRICAL_PINTYPES_TOTAL = ELECTRICAL_PINTYPE.PT_LAST_OPTION + 1;

/** `GetCanonicalElectricalTypeName( ELECTRICAL_PINTYPE )`. */
export function GetCanonicalElectricalTypeName(aType: ELECTRICAL_PINTYPE): string {
  return (ELECTRICAL_PINTYPES as readonly string[])[aType] ?? '';
}

/** `enum class GRAPHIC_PINSHAPE`. */
export enum GRAPHIC_PINSHAPE {
  LINE,
  INVERTED,
  CLOCK,
  INVERTED_CLOCK,
  INPUT_LOW,
  CLOCK_LOW,
  OUTPUT_LOW,
  FALLING_EDGE_CLOCK,
  NONLOGIC,

  LAST_OPTION = NONLOGIC, ///< this is the sentinel value, must be set to last enum value
  INHERIT,
}

/** `GRAPHIC_PINSHAPES_TOTAL`. */
export const GRAPHIC_PINSHAPES_TOTAL = GRAPHIC_PINSHAPE.LAST_OPTION + 1;

/** `enum class PIN_ORIENTATION`: which way the pin extends from its connection point. */
export enum PIN_ORIENTATION {
  /** The pin extends rightwards from the connection point. */
  PIN_RIGHT,
  /** The pin extends leftwards from the connection point. */
  PIN_LEFT,
  /** The pin extends upwards from the connection point. */
  PIN_UP,
  /** The pin extends downwards from the connection point. */
  PIN_DOWN,
  INHERIT,
}
