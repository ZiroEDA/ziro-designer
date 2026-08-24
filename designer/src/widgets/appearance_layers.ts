// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The order the Appearance panel's Layers tab lists layers in, and the tooltip
 * each one carries. Counterpart: `APPEARANCE_CONTROLS::rebuildLayers`
 * (`pcbnew/widgets/appearance_controls.cpp:1750-1935`).
 *
 * **One widget, two frames.** `APPEARANCE_CONTROLS` is constructed by both
 * `PCB_EDIT_FRAME` and `FOOTPRINT_EDIT_FRAME` — the only difference is the
 * `aFpEditorMode` flag, which removes the Nets page and changes where the
 * labels come from (:584, :1902). `rebuildLayers` itself is shared, so the row
 * order is one table in one file. Ours had two: `NON_CU_SEQ` inside
 * `PcbEditor.tsx`, and, in the footprint editor, `PCB_PAINT_ORDER` reversed —
 * a paint order, not a UI order, and an invention. It listed
 * `Dwgs.User, Cmts.User, Eco1.User, Eco2.User, Edge.Cuts, Margin, F.Mask,
 * F.SilkS, …` where KiCad lists `F.Adhesive, B.Adhesive, F.Paste, …`.
 *
 * A `.ts` and not part of either `.tsx`, because `qa`'s tsconfig compiles `.ts`
 * only: a table living in a `.tsx` cannot be read by any test, which is how the
 * footprint editor's ordering went unnoticed.
 */

/**
 * [data] The named half of `non_cu_seq` (:1756-1773), in its order, with its
 * tooltips verbatim. KiCad hardcodes this table; it is not a theme value.
 */
const NAMED_NON_CU: readonly (readonly [string, string])[] = [
  ['F.Adhes', "Adhesive on board's front"],
  ['B.Adhes', "Adhesive on board's back"],
  ['F.Paste', "Solder paste on board's front"],
  ['B.Paste', "Solder paste on board's back"],
  ['F.SilkS', "Silkscreen on board's front"],
  ['B.SilkS', "Silkscreen on board's back"],
  ['F.Mask', "Solder mask on board's front"],
  ['B.Mask', "Solder mask on board's back"],
  ['Dwgs.User', 'Explanatory drawings'],
  ['Cmts.User', 'Explanatory comments'],
  ['Eco1.User', 'User defined meaning'],
  ['Eco2.User', 'User defined meaning'],
  ['Edge.Cuts', "Board's perimeter definition"],
  ['Margin', "Board's edge setback outline"],
  ['F.CrtYd', "Footprint courtyards on board's front"],
  ['B.CrtYd', "Footprint courtyards on board's back"],
  ['F.Fab', "Footprint assembly on board's front"],
  ['B.Fab', "Footprint assembly on board's back"],
];

/**
 * [data] `non_cu_seq` continues `{ User_1, _HKI( "User defined layer 1" ) }`
 * through `User_45` (:1774-1819) — 45 rows that differ only in their number.
 * Generated rather than transcribed: forty-five hand-typed lines is forty-five
 * chances to fat-finger one, and the rule is mechanical in the source too.
 */
export const USER_DEFINED_LAYER_COUNT = 45;

/** `non_cu_seq`, whole: the eighteen named rows then `User.1 … User.45`. */
export const NON_CU_SEQ: readonly (readonly [string, string])[] = [
  ...NAMED_NON_CU,
  ...Array.from(
    { length: USER_DEFINED_LAYER_COUNT },
    (_, i) => [`User.${i + 1}`, `User defined layer ${i + 1}`] as const,
  ),
];

/** Just the names, in `non_cu_seq` order. */
export const NON_CU_ORDER: readonly string[] = NON_CU_SEQ.map(([name]) => name);

/**
 * The tooltip `rebuildLayers` gives one row: the copper `dsc` switch
 * (:1863-1870) for a `.Cu` layer, the `non_cu_seq` entry otherwise.
 */
export function layerTooltip(name: string): string {
  const entry = NON_CU_SEQ.find(([n]) => n === name);
  if (entry) return entry[1];
  if (name === 'F.Cu') return 'Front copper layer';
  if (name === 'B.Cu') return 'Back copper layer';
  if (/\.Cu$/.test(name)) return 'Inner copper layer';
  return '';
}

/**
 * The Layers tab's rows, in order: "show all coppers first, with front on top,
 * back on bottom, then technical layers" (:1859) — `enabled.CuStack()` and then
 * `non_cu_seq` filtered by `enabled[layer]` (:1860-1893).
 *
 * `aCopperStack` is already in stack order (front → back); this does not sort
 * it, because the board's own order is the stack.
 *
 * Upstream can drop nothing, since `non_cu_seq` names every non-copper layer
 * that exists. Ours can, if a board carries a layer name this table has never
 * heard of, so anything enabled and unplaced is appended rather than silently
 * lost — a layer missing from the Appearance panel is invisible *and*
 * unswitchable.
 */
export function appearanceLayerRows(
  aCopperStack: readonly string[],
  aEnabled: readonly string[],
): string[] {
  const enabled = new Set(aEnabled);
  const rows = [...aCopperStack, ...NON_CU_ORDER.filter((n) => enabled.has(n))];
  const placed = new Set(rows);
  return [...rows, ...aEnabled.filter((n) => !placed.has(n))];
}
