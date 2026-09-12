// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Reading and writing a dimension's properties.
 * Counterpart: `DIALOG_DIMENSION_PROPERTIES::TransferDataToWindow` and
 * `updateDimensionFromDialog` (pcbnew/dialogs/dialog_dimension_properties.cpp).
 *
 * Headless, like the other properties modules: the dialog is layout, this is
 * the part with decisions in it, and it patches the item's source node so a
 * saved file keeps everything the model does not represent.
 *
 * ## Override text is a mode, not a string
 *
 * `GetOverrideTextEnabled()` is what decides whether the dimension shows the
 * measurement it computes or a string you typed. Upstream keys it off a radio
 * choice for the measuring kinds and *preserves the existing state* for centre
 * and leader, which have no such choice. In the file the flag has no token of
 * its own — the presence of `(override_value …)` **is** the flag — so an
 * override of the empty string still has to be written, or the dimension
 * silently reverts to its measured value on reload. `overrideValue: undefined`
 * means "show the measurement"; `''` means "show nothing".
 *
 * ## Which fields exist depends on the kind
 *
 * Extension overshoot is aligned/orthogonal only, the text frame is leader
 * only, and a centre dimension has neither a format block nor text. Writing one
 * to the wrong kind produces a file KiCad reads back differently from what was
 * saved.
 */
import type { EdaUnits } from '@ziroeda/common/src/eda_units.js';
import { parseBoardItemId } from './edit-board.js';
import { updateDimension } from './dimension_text.js';
import { isAlignedKind } from './types.js';
import type {
  Board,
  DimPrecision,
  DimTextBorder,
  DimTextPosition,
  DimUnitsFormat,
  DimUnitsMode,
  PcbDimension,
} from './types.js';

/** Every control on the dialog, flattened. */
export interface DimensionValues {
  layer: string;
  /** The measured value's prefix and suffix (`R `, ` typ.`). */
  prefix: string;
  suffix: string;
  /**
   * The text shown instead of the measurement, or undefined to show the
   * measurement. An empty string is a *set* override, not an absent one.
   */
  overrideValue: string | undefined;
  units: DimUnitsMode;
  unitsFormat: DimUnitsFormat;
  precision: DimPrecision;
  suppressZeroes: boolean;
  textPositionMode: DimTextPosition;
  keepTextAligned: boolean;
  arrowDirection: 'inward' | 'outward';
  lineThickness: number;
  arrowLength: number;
  extensionOffset: number;
  /** Aligned and orthogonal only. */
  extensionOvershoot: number;
  /** Leader only. */
  textFrame: DimTextBorder;
  // --- the text item ---
  textWidth: number;
  textHeight: number;
  textThickness: number;
  textOrientation: number;
  bold: boolean;
  italic: boolean;
  mirrored: boolean;
  /** Only meaningful when textPositionMode is MANUAL (2). */
  textX: number;
  textY: number;
  locked: boolean;
}

/** The single selected dimension's index, or null. */
export function dimensionAt(board: Board, selection: Iterable<string>): number | null {
  const ids = [...selection];
  if (ids.length !== 1) return null;
  const ref = parseBoardItemId(ids[0]!);
  if (!ref || ref.kind !== 'dimension') return null;
  return board.dimensions[ref.index] ? ref.index : null;
}

/** `TransferDataToWindow`: the dialog's starting values. */
export function collectDimensionValues(d: PcbDimension): DimensionValues {
  const f = d.format;
  const t = d.text;
  return {
    layer: d.layer,
    prefix: f?.prefix ?? '',
    suffix: f?.suffix ?? '',
    overrideValue: f?.overrideValue,
    units: f?.units ?? 3,
    unitsFormat: f?.unitsFormat ?? 1,
    precision: f?.precision ?? 4,
    suppressZeroes: f?.suppressZeroes ?? false,
    textPositionMode: d.style.textPositionMode,
    keepTextAligned: d.style.keepTextAligned ?? false,
    arrowDirection: d.style.arrowDirection ?? 'outward',
    lineThickness: d.style.thickness,
    arrowLength: d.style.arrowLength,
    extensionOffset: d.style.extensionOffset,
    extensionOvershoot: d.style.extensionHeight ?? 0,
    textFrame: d.style.textFrame ?? 0,
    textWidth: t?.size.x ?? 0,
    textHeight: t?.size.y ?? 0,
    textThickness: t?.thickness ?? 0,
    textOrientation: t?.angle ?? 0,
    bold: t?.bold ?? false,
    italic: t?.italic ?? false,
    mirrored: t?.mirror ?? false,
    textX: t?.at.x ?? 0,
    textY: t?.at.y ?? 0,
    locked: d.locked ?? false,
  };
}

/**
 * `updateDimensionFromDialog`, plus the source patching that makes it survive a
 * save. Returns the board unchanged when nothing moved.
 */
export function applyDimensionValues(
  board: Board,
  index: number,
  v: DimensionValues,
  userUnits: EdaUnits = 'mm',
): Board {
  const d = board.dimensions[index];
  if (!d) return board;

  const before = collectDimensionValues(d);
  if (JSON.stringify(before) === JSON.stringify(v)) return board;

  const aligned = isAlignedKind(d.kind);
  const hasFormat = d.kind !== 'center';

  const raw: PcbDimension = {
    ...d,
    layer: v.layer,
    locked: v.locked,
    style: {
      ...d.style,
      thickness: v.lineThickness,
      arrowLength: v.arrowLength,
      extensionOffset: v.extensionOffset,
      textPositionMode: v.textPositionMode,
      keepTextAligned: v.keepTextAligned,
      // Kind-gated, exactly as the serializer gates them.
      ...(aligned
        ? { arrowDirection: v.arrowDirection, extensionHeight: v.extensionOvershoot }
        : {}),
      ...(d.kind === 'leader' ? { textFrame: v.textFrame } : {}),
    },
    ...(hasFormat
      ? {
          format: {
            prefix: v.prefix,
            suffix: v.suffix,
            units: v.units,
            unitsFormat: v.unitsFormat,
            precision: v.precision,
            suppressZeroes: v.suppressZeroes,
            // Assigned straight through, undefined included: an absent key and
            // an undefined one are indistinguishable to the serializer's
            // `!== undefined` check, to the reader, and to the no-op compare.
            overrideValue: v.overrideValue,
          },
        }
      : {}),
    ...(d.text
      ? {
          text: {
            ...d.text,
            layer: v.layer,
            size: { x: v.textWidth, y: v.textHeight },
            thickness: v.textThickness,
            angle: v.textOrientation,
            bold: v.bold,
            italic: v.italic,
            mirror: v.mirrored,
            // Upstream only writes the position back in MANUAL mode; in the
            // other two the geometry places it and a stale value would fight
            // the layout on the next redraw.
            ...(v.textPositionMode === 2 ? { at: { x: v.textX, y: v.textY } } : {}),
          },
        }
      : {}),
  };

  // `updateDimensionFromDialog` ends with `aTarget->Update()`, which re-derives
  // the label and — outside MANUAL mode — moves it back onto the crossbar. A
  // new precision or unit format is invisible without this.
  const next = updateDimension(raw, userUnits);

  return {
    ...board,
    dimensions: board.dimensions.map((cur, i) => (i === index ? next : cur)),
  };
}
