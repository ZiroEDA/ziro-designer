// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Which dimension each of the five drawing actions places.
 * Counterpart: the five `Go( &DRAWING_TOOL::DrawDimension, … )` registrations
 * in `drawing_tool.cpp` — one handler, five actions, and the action is what
 * decides the kind.
 *
 * Kept out of pcbToolbars.ts and the .tsx so qa can reach it: those import
 * types from `Toolbar.tsx`, which the qa tsconfig cannot follow.
 */
import {
  DEFAULT_DIMENSION_DEFAULTS,
  type DimensionDefaults as EngineDimensionDefaults,
  type DimensionKind,
} from '@ziroeda/pcbnew';

/** Toolbar/action id -> the kind it places. */
export const DIMENSION_TOOLS: Readonly<Record<string, DimensionKind>> = {
  drawAlignedDimension: 'aligned',
  drawOrthogonalDimension: 'orthogonal',
  drawCenterDimension: 'center',
  drawRadialDimension: 'radial',
  drawLeader: 'leader',
};

/** The kind this tool places, or null when it is not a dimension tool. */
export function dimensionToolKind(toolId: string): DimensionKind | null {
  return DIMENSION_TOOLS[toolId] ?? null;
}

/** Whether this tool id places a dimension at all. */
export function isDimensionTool(toolId: string): boolean {
  return dimensionToolKind(toolId) !== null;
}

/**
 * Board Setup's dimension block, as the engine wants it.
 *
 * The panel stores these as the *display strings* the dropdowns show
 * (`PANEL_SETUP_TEXT_AND_GRAPHICS`' choice lists), while the engine and the
 * file format both use the numeric `DIM_*` enums. This is that translation, and
 * it is the reason it lives in a plain module: it is the only real logic in the
 * tool wiring, and getting a mapping off by one would silently write a
 * different precision or the wrong units into every dimension placed.
 *
 * An unrecognised string falls back to the engine default rather than to zero —
 * zero is a meaningful value for all four of these (inches, no suffix, `0`
 * precision, outside), so a typo would otherwise look deliberate.
 */
export function dimensionDefaultsFrom(
  setup: {
    units: string;
    format: string;
    precision: string;
    suppressTrailingZeroes: boolean;
    textPosition: string;
    keepTextAligned: boolean;
    arrowLengthMM: number;
    extLineOffsetMM: number;
  },
  layer: string,
  lineThicknessIU: number,
  /**
   * `GetTextSize( layer )`, `GetTextThickness( layer )` and
   * `GetTextItalic( layer )` — all three index `[ GetLayerClass( aLayer ) ]`
   * (`board_design_settings.cpp:1689-1704`), so they must come from the row for
   * the layer being drawn on. Passing the silkscreen row for every layer gave a
   * dimension on `Dwgs.User` the silkscreen text size.
   */
  layerClass: { textWidth: number; textHeight: number; textThickness: number; italic: boolean },
): EngineDimensionDefaults {
  const mm = (v: number): number => Math.round(v * 1e6);
  const idx = <T>(list: readonly string[], value: string, fallback: T): T | number => {
    const i = list.indexOf(value);
    return i < 0 ? fallback : i;
  };

  return {
    layer,
    lineThickness: lineThicknessIU || DEFAULT_DIMENSION_DEFAULTS.lineThickness,
    arrowLength: mm(setup.arrowLengthMM) || DEFAULT_DIMENSION_DEFAULTS.arrowLength,
    extensionOffset: mm(setup.extLineOffsetMM),
    unitsMode: idx(DIM_UNITS, setup.units, DEFAULT_DIMENSION_DEFAULTS.unitsMode) as 0 | 1 | 2 | 3,
    unitsFormat: idx(DIM_FORMATS, setup.format, DEFAULT_DIMENSION_DEFAULTS.unitsFormat) as
      | 0
      | 1
      | 2,
    precision: idx(
      DIM_PRECISION,
      setup.precision,
      DEFAULT_DIMENSION_DEFAULTS.precision,
    ) as EngineDimensionDefaults['precision'],
    suppressZeroes: setup.suppressTrailingZeroes,
    textPositionMode: idx(
      DIM_POSITION,
      setup.textPosition,
      DEFAULT_DIMENSION_DEFAULTS.textPositionMode,
    ) as 0 | 1 | 2,
    keepTextAligned: setup.keepTextAligned,
    textWidth: layerClass.textWidth || DEFAULT_DIMENSION_DEFAULTS.textWidth,
    textHeight: layerClass.textHeight || DEFAULT_DIMENSION_DEFAULTS.textHeight,
    textThickness: layerClass.textThickness || DEFAULT_DIMENSION_DEFAULTS.textThickness,
    textItalic: layerClass.italic,
  };
}

// The dropdown choice lists, in the order that gives each entry its enum value.
const DIM_UNITS = ['Inches', 'Mils', 'Millimeters', 'Automatic'] as const;
const DIM_FORMATS = ['1234', '1234 mm', '1234 (mm)'] as const;
const DIM_PRECISION = ['0', '0.0', '0.00', '0.000', '0.0000', '0.00000'] as const;
// DIM_TEXT_POSITION also has MANUAL, which the panel does not offer: it is set
// by dragging the text, not chosen up front.
const DIM_POSITION = ['Outside', 'Inline'] as const;

/** Which groups of controls the properties dialog shows, by kind. */
export interface DimensionDialogFields {
  /** Prefix, suffix, units, format, precision, suppress zeroes, override text. */
  format: boolean;
  /** Text size, thickness, orientation, bold/italic/mirrored. */
  text: boolean;
  /** The Outside/Inline/Manual choice, inside the text group. */
  textPositionMode: boolean;
  arrowLength: boolean;
  extensionOffset: boolean;
  /** Extension line overshoot. */
  extensionOvershoot: boolean;
  arrowDirection: boolean;
  /** The leader's text frame (none/rectangle/circle/round rectangle). */
  textFrame: boolean;
}

/**
 * `DIALOG_DIMENSION_PROPERTIES`' constructor switch, which hides whole sizers
 * depending on the dimension's class.
 *
 * - A **centre** mark measures nothing and has no text, so the format and text
 *   groups go, and with them the arrow length and extension offset — it draws
 *   only a cross.
 * - A **leader** shows text you typed rather than a measurement, so the format
 *   group goes and the text-position choice with it, but the text frame appears.
 * - **Extension overshoot** is gated on `dynamic_cast<PCB_DIM_ALIGNED*>`
 *   (`m_extensionOvershoot.Show(false)` otherwise), so radial and leader do not
 *   get it either.
 *
 * **One deliberate divergence.** Upstream leaves the arrow-direction choice
 * visible for radial and leader, but `updateDimensionFromDialog` only ever
 * reaches `SetArrowDirection` through the base pointer while the *serializer*
 * writes `(arrow_direction …)` for aligned and orthogonal alone — so on those
 * kinds the control changes nothing that survives a save. It is hidden here for
 * the same reason Create Array does not offer numbering: a control that quietly
 * does nothing is worse than its absence.
 */
export function dimensionDialogFields(kind: DimensionKind): DimensionDialogFields {
  const aligned = kind === 'aligned' || kind === 'orthogonal';
  const centre = kind === 'center';
  const leader = kind === 'leader';
  return {
    format: !centre && !leader,
    text: !centre,
    textPositionMode: !centre && !leader,
    arrowLength: !centre,
    extensionOffset: !centre,
    extensionOvershoot: aligned,
    arrowDirection: aligned,
    textFrame: leader,
  };
}
