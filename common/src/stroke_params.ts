// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `LINE_STYLE`, the dash pattern of a stroke — KiCad's `common/stroke_params.h`.
 *
 * Moved out of `pcbnew/src/plot_dxf.ts` for the same reason as [Color4d]: the
 * graphics importers are shared between the board and the schematic, and a
 * schematic package cannot import from the board package. `plot_dxf.ts`
 * re-exports it.
 *
 * `DEFAULT = -1` is meaningful and is not "solid": it means the item has no
 * style of its own and inherits one.
 */

export enum LINE_STYLE {
  DEFAULT = -1,
  SOLID = 0,
  DASH,
  DOT,
  DASHDOT,
  DASHDOTDOT,
}

/** The `(stroke (type …))` token each `LINE_STYLE` is stored as. */
export type LineStyleToken = 'default' | 'solid' | 'dash' | 'dot' | 'dash_dot' | 'dash_dot_dot';

/** One row of `lineTypeNames`: `LINE_STYLE_DESC` (include/stroke_params.h:57). */
export interface LineStyleDesc {
  readonly style: LINE_STYLE;
  /** The file token, which is also the `<option value>` every dialog uses. */
  readonly value: LineStyleToken;
  /** `LINE_STYLE_DESC::name`, the string the combo shows. */
  readonly label: string;
}

/**
 * `lineTypeNames` — `common/stroke_params.cpp:39`, the one table upstream, in
 * its map order, which is the order every combo is filled in.
 *
 * `LINE_STYLE::DEFAULT` is deliberately **absent**: the map is keyed from
 * `SOLID = 0` up, and every dialog fills its combo by iterating it and then
 * indexes back into it by selection, so a sixth leading entry would shift every
 * style by one. A stroke that *is* `DEFAULT` shows `DEFAULT_LINE_STYLE_LABEL`
 * instead (`dialog_shape_properties.cpp:147`).
 */
export const LINE_STYLE_NAMES: readonly LineStyleDesc[] = [
  { style: LINE_STYLE.SOLID, value: 'solid', label: 'Solid' },
  { style: LINE_STYLE.DASH, value: 'dash', label: 'Dashed' },
  { style: LINE_STYLE.DOT, value: 'dot', label: 'Dotted' },
  { style: LINE_STYLE.DASHDOT, value: 'dash_dot', label: 'Dash-Dot' },
  { style: LINE_STYLE.DASHDOTDOT, value: 'dash_dot_dot', label: 'Dash-Dot-Dot' },
];

/** `DEFAULT_LINE_STYLE_LABEL` (include/stroke_params.h:85). What a combo that
 *  cannot express `DEFAULT` shows for a stroke that has no style of its own. */
export const DEFAULT_LINE_STYLE_LABEL = 'Solid';

/** `DEFAULT_WIRE_STYLE_LABEL` (include/stroke_params.h:86). */
export const DEFAULT_WIRE_STYLE_LABEL = 'Default';

/** `INDETERMINATE_STYLE` (include/stroke_params.h:87). */
export const INDETERMINATE_STYLE = 'Leave unchanged';

/**
 * The wire/bus combo: `lineTypeNames` with `DEFAULT_WIRE_STYLE_LABEL`
 * **appended after** them — `dialog_wire_bus_properties.cpp:56-59`. Only a wire
 * or bus inherits its style from its net class, so only that dialog offers it,
 * and upstream puts it last, not first.
 */
export const WIRE_STYLE_NAMES: readonly LineStyleDesc[] = [
  ...LINE_STYLE_NAMES,
  { style: LINE_STYLE.DEFAULT, value: 'default', label: DEFAULT_WIRE_STYLE_LABEL },
];

/**
 * Which entry of `LINE_STYLE_NAMES` a stored style selects.
 *
 * `DIALOG_SHAPE_PROPERTIES::TransferDataToWindow` (dialog_shape_properties.cpp:147):
 * `if( style == -1 ) SetStringSelection( DEFAULT_LINE_STYLE_LABEL )`, i.e. an
 * inherited stroke shows Solid — and, because the combo cannot say otherwise,
 * is written back as solid.
 */
export function lineStyleComboValue(stored: string | undefined): LineStyleToken {
  const hit = LINE_STYLE_NAMES.find((d) => d.value === stored);
  return hit ? hit.value : 'solid';
}

/** The name `lineTypeNames` gives a token, or `DEFAULT_WIRE_STYLE_LABEL`. */
export function lineStyleLabel(token: string): string {
  return WIRE_STYLE_NAMES.find((d) => d.value === token)?.label ?? DEFAULT_LINE_STYLE_LABEL;
}

/**
 * `ENUM_MAP<LINE_STYLE>` as the properties manager registers it —
 * `common/eda_shape.cpp:2833`, `pcbnew/pcb_textbox.cpp:832`,
 * `pcbnew/pcb_table.cpp:868`, `eeschema/sch_line.cpp:1218` all register the
 * same five, without DEFAULT — in the `[value, label]` shape a choice widget
 * wants.
 */
export const LINE_STYLE_CHOICES: readonly (readonly [LineStyleToken, string])[] =
  LINE_STYLE_NAMES.map((d) => [d.value, d.label] as const);

/**
 * `ENUM_MAP<WIRE_STYLE>` (`eeschema/sch_line.cpp:1229`,
 * `eeschema/sch_bus_entry.cpp:639`): the same five with DEFAULT mapped to
 * "Default" — and here it is registered **first**, unlike the wire/bus dialog
 * which appends it last.
 */
export const WIRE_STYLE_CHOICES: readonly (readonly [LineStyleToken, string])[] = [
  ['default', DEFAULT_WIRE_STYLE_LABEL],
  ...LINE_STYLE_CHOICES,
];
