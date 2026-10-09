// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The display names of a pin's electrical type and its graphic shape.
 *
 * KiCad holds each of these ONCE, in `eeschema/pin_type.cpp`'s
 * `g_pinElectricalTypes` and `g_pinShapes`, and every caller goes through
 * `ElectricalPinTypeGetText()` / `PinShapeGetText()` — the pin editor, the
 * message panel, the properties panel, the ERC report and the symbol editor
 * all read the same two maps. That is why a pin reads the same everywhere in
 * KiCad.
 *
 * Ours had FOUR copies of the type table — `erc/erc_settings.ts`,
 * `widgets/sch_properties_panel.ts`, the designer's `symbolRenderer.ts` and one
 * more — and two of the shape table, which is exactly the drift the
 * central-value rule exists to stop.
 *
 * The strings are KiCad's own, verbatim and in its order.
 */

import {
  ELECTRICAL_PINTYPE,
  type ElectricalPinType,
  GetCanonicalElectricalTypeName,
  GRAPHIC_PINSHAPE,
  PIN_ORIENTATION,
} from '@ziroeda/common/pin_type.js';

/**
 * `g_pinElectricalTypes` (pin_type.cpp), in ELECTRICAL_PINTYPE order.
 *
 * Keyed by `ElectricalPinType`, so the canonical names live in ONE place
 * (`common/pin_type.ts`, upstream's `common/pin_type.h`) and a token added
 * there without a label here fails to compile.
 */
const PIN_TYPE_NAMES: Readonly<Record<ElectricalPinType, string>> = {
  input: 'Input',
  output: 'Output',
  bidirectional: 'Bidirectional',
  tri_state: 'Tri-state',
  passive: 'Passive',
  /** PT_NIC — "not internally connected", which KiCad shows as "Free". */
  free: 'Free',
  unspecified: 'Unspecified',
  power_in: 'Power input',
  power_out: 'Power output',
  open_collector: 'Open collector',
  open_emitter: 'Open emitter',
  /** PT_NC. */
  no_connect: 'Unconnected',
};

/** `g_pinShapes` (pin_type.cpp), in GRAPHIC_PINSHAPE order. */
const PIN_SHAPE_NAMES: Readonly<Record<string, string>> = {
  line: 'Line',
  inverted: 'Inverted',
  clock: 'Clock',
  inverted_clock: 'Inverted clock',
  input_low: 'Input low',
  clock_low: 'Clock low',
  output_low: 'Output low',
  edge_clock_high: 'Falling edge clock',
  non_logic: 'NonLogic',
};

/**
 * `ElectricalPinTypeGetText( aType )`. Upstream asserts on an unknown type and
 * returns "???"; ours hands back what it was given, which is more useful in a
 * report than a row of question marks.
 */
export function electricalPinTypeGetText(type: string): string {
  return PIN_TYPE_NAMES[type as ElectricalPinType] ?? type;
}

/** `PinShapeGetText( aShape )`. */
export function pinShapeGetText(shape: string): string {
  return PIN_SHAPE_NAMES[shape] ?? shape;
}

/**
 * The same two tables as ordered lists, which is what a chooser needs.
 *
 * `InitTables()` (pin_type.cpp:120-138) walks the enums and fills `g_typeNames`
 * and `g_shapeNames` for exactly this — the pin editor's two combos are built
 * from them, so their order is the enum's, not alphabetical.
 */
export const PIN_TYPE_ENTRIES: readonly (readonly [string, string])[] =
  Object.entries(PIN_TYPE_NAMES);

/** `g_shapeNames`. */
export const PIN_SHAPE_ENTRIES: readonly (readonly [string, string])[] =
  Object.entries(PIN_SHAPE_NAMES);

// The same tables keyed by the live model's numeric enums (common/pin_type.ts).

/** The file tokens of `GRAPHIC_PINSHAPE`, in enum order (getPinShapeToken). */
const PIN_SHAPE_TOKENS: readonly string[] = [
  'line',
  'inverted',
  'clock',
  'inverted_clock',
  'input_low',
  'clock_low',
  'output_low',
  'edge_clock_high',
  'non_logic',
];

/** `ElectricalPinTypeGetText( ELECTRICAL_PINTYPE )`. */
export function ElectricalPinTypeGetText(aType: ELECTRICAL_PINTYPE): string {
  if (aType === ELECTRICAL_PINTYPE.PT_INHERIT) return '';

  return electricalPinTypeGetText(GetCanonicalElectricalTypeName(aType));
}

/** `PinShapeGetText( GRAPHIC_PINSHAPE )`. */
export function PinShapeGetText(aShape: GRAPHIC_PINSHAPE): string {
  return pinShapeGetText(PIN_SHAPE_TOKENS[aShape] ?? '');
}

/** `g_pinOrientations`' names (pin_type.cpp, InitTables). [data] */
const PIN_ORIENTATION_NAMES: Readonly<Partial<Record<PIN_ORIENTATION, string>>> = {
  [PIN_ORIENTATION.PIN_RIGHT]: 'Right',
  [PIN_ORIENTATION.PIN_LEFT]: 'Left',
  [PIN_ORIENTATION.PIN_UP]: 'Up',
  [PIN_ORIENTATION.PIN_DOWN]: 'Down',
};

/** `PinOrientationName( PIN_ORIENTATION )`: '?' for one the table lacks (INHERIT), as the wxCHECK. */
export function PinOrientationName(aOrientation: PIN_ORIENTATION): string {
  return PIN_ORIENTATION_NAMES[aOrientation] ?? '?';
}

/** `g_pinElectricalTypes`' bitmaps (pin_type.cpp:85-96), by type token. [data] */
const PIN_TYPE_BITMAPS: Readonly<Record<ElectricalPinType, string>> = {
  input: 'pintype_input',
  output: 'pintype_output',
  bidirectional: 'pintype_bidi',
  tri_state: 'pintype_3states',
  passive: 'pintype_passive',
  free: 'pintype_nic',
  unspecified: 'pintype_notspecif',
  power_in: 'pintype_powerinput',
  power_out: 'pintype_poweroutput',
  open_collector: 'pintype_opencoll',
  open_emitter: 'pintype_openemit',
  no_connect: 'pintype_noconnect',
};

/**
 * `g_pinShapes`' bitmaps (pin_type.cpp:100-108), by shape token - the FILE token, so
 * FALLING_EDGE_CLOCK is `edge_clock_high` (sch_io_kicad_sexpr_parser.cpp:1625). [data]
 */
const PIN_SHAPE_BITMAPS: Readonly<Record<string, string>> = {
  line: 'pinshape_normal',
  inverted: 'pinshape_invert',
  clock: 'pinshape_clock_normal',
  inverted_clock: 'pinshape_clock_invert',
  input_low: 'pinshape_active_low_input',
  clock_low: 'pinshape_clock_active_low',
  output_low: 'pinshape_active_low_output',
  edge_clock_high: 'pinshape_clock_fall',
  non_logic: 'pinshape_nonlogic',
};

/** `PinTypeNames()` (pin_type.cpp:153): `g_typeNames`, in ELECTRICAL_PINTYPE order. */
export function PinTypeNames(): readonly string[] {
  return PIN_TYPE_ENTRIES.map(([, name]) => name);
}

/** `PinTypeIcons()` (pin_type.cpp:162): `g_typeIcons`, in the same order. */
export function PinTypeIcons(): readonly string[] {
  return PIN_TYPE_ENTRIES.map(([token]) => PIN_TYPE_BITMAPS[token as ElectricalPinType]);
}

/** `PinShapeNames()` (pin_type.cpp:171): `g_shapeNames`, in GRAPHIC_PINSHAPE order. */
export function PinShapeNames(): readonly string[] {
  return PIN_SHAPE_ENTRIES.map(([, name]) => name);
}

/** `PinShapeIcons()` (pin_type.cpp:180): `g_shapeIcons`, in the same order. */
export function PinShapeIcons(): readonly string[] {
  return PIN_SHAPE_ENTRIES.map(([token]) => PIN_SHAPE_BITMAPS[token]!);
}
