// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The label a dimension shows, and where it sits.
 * Counterparts: `PCB_DIMENSION_BASE::GetValueText` / `::updateText` and the five
 * `PCB_DIM_*::updateText` overrides (pcbnew/pcb_dimension.cpp).
 *
 * ## Why this file has to exist
 *
 * A dimension's `(gr_text …)` child is not authored — it is *derived*, every
 * time the item changes, from the measured value and the format block. Nothing
 * here was ported before, so `measuredValue` computed a number that no caller
 * ever turned into a string: a dimension drawn in the editor came out with an
 * empty label, and one whose feature points moved kept the stale label it was
 * loaded with. Both are the same missing call.
 *
 * KiCad funnels it all through `Update()`, which runs `updateGeometry()`, which
 * calls `updateText()` — so *every* mutation of a dimension re-derives the
 * label. {@link updateDimension} is that call, and every place that builds or
 * edits a dimension has to end with it.
 *
 * ## Text position is geometry, not a stored field
 *
 * For aligned and orthogonal the label hangs off the crossbar's centre, so it
 * moves whenever the crossbar does; only `DIM_TEXT_POSITION::MANUAL` leaves the
 * stored position alone. A radial and a leader instead keep the position the
 * drawing tool dragged them to, and only their *angle* is derived.
 *
 * ## One upstream quirk mirrored deliberately
 *
 * `PCB_DIM_ORTHOGONAL::updateText` computes a text position and angle and then
 * calls `PCB_DIM_ALIGNED::updateText`, which unconditionally computes and
 * *overwrites* both. The orthogonal branch is therefore dead code. It is not a
 * divergence to skip it: an orthogonal crossbar is axis-aligned, and the aligned
 * formula reduces to the orthogonal one on exactly those inputs — worked through
 * in the tests for all four crossbar directions. Only the aligned formula is
 * ported, because only the aligned formula ever runs.
 */
import {
  pcbIUScale,
  toUserUnit,
  unitLabelText,
  type EdaUnits,
} from '@ziroeda/common/src/eda_units.js';
import { kiRound } from '@ziroeda/common/src/font/text_box.js';
import { dimensionCrossbar, measuredValue, radialKnee } from './dimension_geometry.js';
import { textPenWidth } from './text_metrics.js';
import type { PcbDimension } from './types.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });

/** KiCad's `sign()`: -1, 0 or 1. */
const sign = (n: number): number => (n > 0 ? 1 : n < 0 ? -1 : 0);

/** `VECTOR2I::Resize` — the same direction, this length. */
function resize(v: Vec2, len: number): Vec2 {
  const n = Math.hypot(v.x, v.y);
  if (n === 0) return { x: 0, y: 0 };
  return { x: kiRound((v.x / n) * len) || 0, y: kiRound((v.y / n) * len) || 0 };
}

/**
 * `RotatePoint( v, θ )`: `(x·cosθ + y·sinθ, −x·sinθ + y·cosθ)`. Only ±90° is
 * ever asked for here, so the exact quarter-turns are written out rather than
 * run through `cos`/`sin` — upstream dodges the same float error with
 * `EDA_ANGLE`'s special-case table.
 */
function rotateQuarter(v: Vec2, deg: 90 | -90 | 0): Vec2 {
  if (deg === 90) return { x: v.y, y: -v.x };
  if (deg === -90) return { x: -v.y, y: v.x };
  return v;
}

/**
 * `EDA_ANGLE( const VECTOR2D& )` in degrees. Upstream hard-codes the axes and
 * the diagonals to dodge float error, but every one of those cases agrees with
 * `atan2` to the bit, so the table is not reproduced — except that upstream
 * answers `-180` where `atan2` answers `+180`, which `Normalize` folds together
 * anyway.
 */
const angleOf = (v: Vec2): number => (Math.atan2(v.y, v.x) * 180) / Math.PI;

/** `EDA_ANGLE::Normalize`: into `[0, 360)`. */
function normalizeAngle(deg: number): number {
  let a = deg % 360;
  if (a < 0) a += 360;
  return a;
}

/**
 * `PCB_DIMENSION_BASE::SetUnitsMode`: which units the value is shown in.
 * `AUTOMATIC` is not a unit — it means "whatever the board is displaying", and
 * upstream falls back to millimetres when the item has no board yet.
 */
export function dimensionUnits(d: PcbDimension, userUnits: EdaUnits = 'mm'): EdaUnits {
  switch (d.format?.units ?? 3) {
    case 0:
      return 'in';
    case 1:
      return 'mils';
    case 2:
      return 'mm';
    default:
      return userUnits;
  }
}

/**
 * `PCB_DIMENSION_BASE::GetValueText`: the measured value alone, with no prefix,
 * suffix or unit label.
 *
 * The `precision >= 6` block is the `V_VV`-style "significant digits" half of
 * `DIM_PRECISION`: those four entries mean *the same physical resolution* in
 * every unit, so the digit count is rebased per unit rather than taken as-is.
 *
 * **The trailing-zero strip is upstream's, quirk included.** The loop removes
 * trailing `0`s and stops after eating a decimal point — so at precision `0` a
 * value of exactly 10 mm formats as `"10"`, loses its zero, and displays as
 * `"1"`. That is what KiCad 10.0.5 does; mirroring it is the point of this file,
 * and re-deriving a "sensible" answer here would be a silent divergence.
 */
export function dimensionValueText(d: PcbDimension, userUnits: EdaUnits = 'mm'): string {
  const units = dimensionUnits(d, userUnits);
  const val = measuredValue(d);
  let precision: number = d.format?.precision ?? 4;

  if (precision >= 6) {
    if (units === 'in') precision -= 4;
    else if (units === 'mils') precision = Math.max(0, precision - 7);
    else if (units === 'mm') precision -= 5;
    else precision -= 4;
  }

  let text = toUserUnit(pcbIUScale, units, val).toFixed(precision);

  if (d.format?.suppressZeroes) {
    while (text.endsWith('0')) {
      text = text.slice(0, -1);
      if (text.endsWith('.')) {
        text = text.slice(0, -1);
        break;
      }
    }
  }

  return text;
}

/**
 * `PCB_DIMENSION_BASE::updateText`: the whole displayed string — the override or
 * the measured value, then the unit suffix the format asks for, then the prefix
 * and suffix wrapped around the lot.
 *
 * Note the order: the prefix and suffix go *outside* the unit label, so a
 * radial's `R ` prefix and a `1234 (mm)` format compose as `R 5 (mm)`.
 */
export function dimensionDisplayText(d: PcbDimension, userUnits: EdaUnits = 'mm'): string {
  const f = d.format;
  const override = f?.overrideValue;
  let text = override !== undefined ? override : dimensionValueText(d, userUnits);

  switch (f?.unitsFormat ?? 0) {
    case 1: // BARE_SUFFIX
      text += unitLabelText(dimensionUnits(d, userUnits));
      break;
    case 2: // PAREN_SUFFIX
      text += ` (${unitLabelText(dimensionUnits(d, userUnits)).trimStart()})`;
      break;
    default: // NO_SUFFIX
      break;
  }

  return (f?.prefix ?? '') + text + (f?.suffix ?? '');
}

/**
 * `PCB_DIM_ALIGNED::updateText`'s label placement, off the crossbar's centre.
 *
 * `OUTSIDE` pushes the label one text-height-plus-pen clear of the bar, on the
 * side the perpendicular of the bar points to; `INLINE` sits it on the bar
 * itself. `MANUAL` is absent from the switch upstream, which is how the position
 * a user dragged the label to survives every later edit.
 */
function alignedTextPlacement(
  d: PcbDimension,
  bar: { start: Vec2; end: Vec2 },
): { at?: Vec2; angle?: number } {
  // VECTOR2I's operator/ rounds (KiROUND), it does not truncate.
  const cc: Vec2 = {
    x: kiRound((bar.end.x - bar.start.x) / 2),
    y: kiRound((bar.end.y - bar.start.y) / 2),
  };

  const out: { at?: Vec2; angle?: number } = {};

  if (d.style.textPositionMode === 0) {
    const t = d.text;
    const offsetDistance = t ? textPenWidth(t) + t.size.y : 0;
    const rotation: 90 | -90 | 0 =
      cc.x === 0 ? ((90 * sign(-cc.y)) as 90 | -90 | 0) : cc.x < 0 ? -90 : 90;
    const offset = add(cc, resize(rotateQuarter(cc, rotation), offsetDistance));
    out.at = add(bar.start, offset);
  } else if (d.style.textPositionMode === 1) {
    out.at = add(bar.start, cc);
  }

  if (d.style.keepTextAligned) {
    let angle = normalizeAngle(360 - angleOf(cc));
    // Upstream does not re-normalise after the fold, so an angle in (90, 270]
    // lands in (-90, 90] and is stored there.
    if (angle > 90 && angle <= 270) angle -= 180;
    out.angle = angle;
  }

  return out;
}

/** `PCB_DIM_RADIAL::updateText`: only the angle, and only to the nearest degree. */
function radialTextAngle(d: PcbDimension): number | undefined {
  if (!d.style.keepTextAligned || !d.text) return undefined;
  const textLine = sub(d.text.at, radialKnee(d));
  let angle = normalizeAngle(360 - angleOf(textLine));
  if (angle > 90 && angle <= 270) angle -= 180;
  return kiRound(angle);
}

/**
 * `PCB_DIMENSION_BASE::Update()` — re-derive everything the dimension displays
 * from its feature points, style and format.
 *
 * Call this after **every** mutation of a dimension, the way upstream does: the
 * drawing tool after each click and each motion, the properties dialog at the
 * end of `updateDimensionFromDialog`, and any global edit that touches the
 * format or the text size. A dimension that skips it keeps a label describing
 * the shape it used to be.
 *
 * `userUnits` is the board's display units, which is the only thing
 * `DIM_UNITS_MODE::AUTOMATIC` means.
 */
export function updateDimension(d: PcbDimension, userUnits: EdaUnits = 'mm'): PcbDimension {
  // A centre mark has no text item at all in our model; upstream only sets a
  // text position on one so that lasso hit-testing has a point to test.
  if (!d.text) return d;

  const text = dimensionDisplayText(d, userUnits);

  if (d.kind === 'aligned' || d.kind === 'orthogonal') {
    const bar = dimensionCrossbar(d);
    if (!bar) return { ...d, text: { ...d.text, text } };
    const placed = alignedTextPlacement(d, bar);
    return {
      ...d,
      text: {
        ...d.text,
        text,
        ...(placed.at ? { at: placed.at } : {}),
        ...(placed.angle !== undefined ? { angle: placed.angle } : {}),
      },
    };
  }

  if (d.kind === 'radial') {
    const angle = radialTextAngle(d);
    return { ...d, text: { ...d.text, text, ...(angle !== undefined ? { angle } : {}) } };
  }

  // A leader's label is whatever was typed, wherever the tool dragged it.
  return { ...d, text: { ...d.text, text } };
}
