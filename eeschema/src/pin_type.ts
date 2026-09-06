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
 * `tools/sch_properties_panel.ts`, the designer's `symbolRenderer.ts` and one
 * more — and two of the shape table, which is exactly the drift the
 * central-value rule exists to stop.
 *
 * The strings are KiCad's own, verbatim and in its order.
 */

import type { ElectricalPinType } from '@ziroeda/common/src/pin_type.js';

/**
 * `g_pinElectricalTypes` (pin_type.cpp), in ELECTRICAL_PINTYPE order.
 *
 * Keyed by `ElectricalPinType`, so the canonical names live in ONE place
 * (`common/src/pin_type.ts`, upstream's `common/pin_type.h`) and a token added
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
