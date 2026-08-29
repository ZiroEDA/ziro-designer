// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `KIGFX::PREVIEW::RULER_ITEM` — the measurement the Measure Tool drags out.
 *
 * Shared for the reason the upstream file is in `common/preview_items/`: the
 * ruler is not pcbnew's. `ACTIONS::measureTool` is registered by
 * `PCB_VIEWER_TOOLS` (pcbnew, the footprint editor and viewer, and CVPCB's
 * `DISPLAY_FOOTPRINTS_FRAME`), by `EE_TOOLS` in eeschema and by gerbview, and
 * every one of them puts up this same item.
 *
 * Only the arithmetic and the label text live here — the part that must not be
 * re-derived. Arming the tool, capturing the pointer and painting belong to
 * each canvas, because each of ours owns its own transform.
 */

/** A world-space point, matching the canvases' own `Vec2`. */
export interface RulerPoint {
  x: number;
  y: number;
}

/**
 * `LEADER_MODE`, the angle constraint `TWO_POINT_GEOMETRY_MANAGER` applies.
 *
 * `PCB_VIEWER_TOOLS::MeasureTool` sets it per motion event
 * (`pcbnew/tools/pcb_viewer_tools.cpp:383-388`):
 *
 *     twoPtMgr.SetAngleSnap( evt->Modifier( MD_SHIFT ) ? LEADER_MODE::DEG45
 *                                                      : LEADER_MODE::DIRECT );
 *
 * so the measurement is a direct line, and Shift constrains it to 45° steps.
 */
export type RulerAngleSnap = 'direct' | 'deg45';

/**
 * The end point after the angle constraint.
 *
 * `DEG45` keeps the length along the snapped direction rather than projecting
 * onto it, which is what makes the ruler follow the cursor's distance while its
 * angle clicks round in eighths.
 */
export function rulerEnd(origin: RulerPoint, cursor: RulerPoint, snap: RulerAngleSnap): RulerPoint {
  if (snap === 'direct') return cursor;
  const dx = cursor.x - origin.x;
  const dy = cursor.y - origin.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return cursor;
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: origin.x + len * Math.cos(angle), y: origin.y + len * Math.sin(angle) };
}

/** The units a ruler label can be written in, as `EDA_UNITS` distinguishes them. */
export type RulerUnits = 'mm' | 'in' | 'mils';

/**
 * `KIGFX::PREVIEW::DimensionLabel`'s precision table
 * (`common/preview_items/preview_utils.cpp:44-61`), which is deliberately
 * coarser than the status bar's: "show a sane precision for the preview, which
 * doesn't need to be accurate down to the nanometre".
 */
// [data] EDA_UNITS::MM "%.3f" (1um), INCH "%.4f" (0.1mil), MILS "%.1f" (0.1mil),
// DEGREES "%.1f" (0.1deg).
const DECIMALS: Record<RulerUnits, number> = { mm: 3, in: 4, mils: 1 };
const DEGREE_DECIMALS = 1;

/** `DimensionLabel`: `"<prefix>: <value><unit>"` (`preview_utils.cpp:39-40, 63`). */
function label(prefix: string, value: string, unit: string): string {
  return `${prefix}: ${value}${unit}`;
}

const UNIT_SUFFIX: Record<RulerUnits, string> = { mm: ' mm', in: '"', mils: ' mils' };

function fromIU(iu: number, iuPerMM: number, units: RulerUnits): number {
  const mm = iu / iuPerMM;
  if (units === 'mm') return mm;
  if (units === 'in') return mm / 25.4;
  return (mm / 25.4) * 1000;
}

/**
 * `RULER_ITEM::GetDimensionStrings` (`common/preview_items/ruler_item.cpp:456`)
 * — four lines, in this order: x, y, r, θ.
 *
 * θ is `-EDA_ANGLE( rulerVec )`, negated because screen Y grows downward while
 * the reported angle is the mathematical one, and it is always in degrees
 * regardless of the frame's distance units.
 */
export function rulerDimensionStrings(
  origin: RulerPoint,
  end: RulerPoint,
  iuPerMM: number,
  units: RulerUnits,
): string[] {
  const dx = end.x - origin.x;
  const dy = end.y - origin.y;
  const d = DECIMALS[units];
  const u = UNIT_SUFFIX[units];
  const dist = (iu: number): string => fromIU(iu, iuPerMM, units).toFixed(d);
  const theta = (-Math.atan2(dy, dx) * 180) / Math.PI;
  return [
    label('x', dist(dx), u),
    label('y', dist(dy), u),
    label('r', dist(Math.hypot(dx, dy)), u),
    label('θ', theta.toFixed(DEGREE_DECIMALS), '°'),
  ];
}
