// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `FILL_T` for a board graphic, and the three questions `EDA_SHAPE` asks of it.
 * Counterpart: `include/eda_shape.h:57-146`.
 *
 * A PCB_SHAPE's fill is NOT a boolean. `EDA_SHAPE::m_fill` is an enum, and a
 * `.kicad_pcb` carries five of its values (`pcb_io_kicad_sexpr.cpp:1071-1097`,
 * `pcb_io_kicad_sexpr_parser.cpp:3580-3600`):
 *
 *     (fill yes) | (fill solid)   FILLED_SHAPE   -- `yes` is the 2017 spelling
 *     (fill no)  | (fill none)    NO_FILL
 *     (fill hatch)                HATCH
 *     (fill reverse_hatch)        REVERSE_HATCH
 *     (fill cross_hatch)          CROSS_HATCH
 *
 * Modelling it as a boolean read every hatched graphic back as unfilled and then
 * wrote `no` over it on the next edit — the hatch was lost by opening the board
 * and touching the shape.
 *
 * Which predicate a call site wants is upstream's own split, and they differ:
 * hit testing is `IsFilledForHitTesting()`, which is `IsSolidFill()`, so a
 * hatched shape is picked by its OUTLINE. The two remaining FILL_T values,
 * FILLED_WITH_BG_BODYCOLOR and FILLED_WITH_COLOR, are eeschema's and have no
 * board spelling; eeschema keeps its own union because it writes FILLED_SHAPE as
 * `outline` rather than `solid`.
 */

/** `FILL_T`, spelled as a `.kicad_pcb` spells it. */
export type PcbFillMode = 'none' | 'solid' | 'hatch' | 'reverse_hatch' | 'cross_hatch';

/** The `(fill …)` words the parser accepts, mapped to the mode they mean. */
export function pcbFillModeFromToken(token: string | undefined): PcbFillMode {
  switch (token) {
    case 'yes':
    case 'solid':
      return 'solid';
    case 'hatch':
      return 'hatch';
    case 'reverse_hatch':
      return 'reverse_hatch';
    case 'cross_hatch':
      return 'cross_hatch';
    // `none`, `no`, and an absent token: NO_FILL is EDA_SHAPE's default.
    default:
      return 'none';
  }
}

/** `EDA_SHAPE::IsAnyFill()` — anything but NO_FILL. */
export const isAnyFill = (s: { fillMode: PcbFillMode }): boolean => s.fillMode !== 'none';

/**
 * `EDA_SHAPE::IsSolidFill()` — the value that paints the shape's interior in the
 * shape's own colour. This is also `IsFilledForHitTesting()`.
 */
export const isSolidFill = (s: { fillMode: PcbFillMode }): boolean => s.fillMode === 'solid';

/** `EDA_SHAPE::IsHatchedFill()` — one of the three hatch modes. */
export const isHatchedFill = (s: { fillMode: PcbFillMode }): boolean =>
  s.fillMode === 'hatch' || s.fillMode === 'reverse_hatch' || s.fillMode === 'cross_hatch';

/**
 * `ENUM_MAP<UI_FILL_MODE>`'s labels (`common/eda_shape.cpp:2765-2772`), in Map
 * order. UI_FILL_MODE is FILL_T without the two schematic-only values, which is
 * why it maps one-to-one onto the board spellings above.
 */
export const UI_FILL_MODE_CHOICES = [
  ['none', 'None'],
  ['solid', 'Solid'],
  ['hatch', 'Hatch'],
  ['reverse_hatch', 'Reverse Hatch'],
  ['cross_hatch', 'Cross-hatch'],
] as const satisfies readonly (readonly [PcbFillMode, string])[];
