// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Non-Copper Zone Properties, headless.
 * Counterpart: `pcbnew/dialogs/dialog_non_copper_zones_properties.cpp`.
 *
 * `PCB_EDIT_FRAME::Edit_Zone_Params` picks between three dialogs, and the test
 * is worth stating because it is not "which layer is this on": a rule area
 * gets the rule area dialog *whatever* layer it sits on, and only a
 * non-rule-area whose first layer is not copper lands here.
 *
 * What a non-copper zone has that a copper one does not is nothing; the
 * difference is entirely in what is *missing*. There is no net, no priority,
 * no clearance, no thermal relief, no pad connection and no island removal on
 * this form — a zone on a technical layer connects to nothing, so none of them
 * mean anything. What is left is the outline (border style, pitch, corner
 * smoothing), the minimum fill width and the hatch pattern.
 *
 * One consequence of that omission is load-bearing here: because the form has
 * no name field, `collect`/`apply` never touch the zone's name, so a
 * non-copper zone can keep a name that collides with another.
 */

import { pcbMmToIU as mmToIU } from '@ziroeda/common/eda_units.js';
import type { Board, PcbZone } from '../types.js';
import type { ZoneBorderStyle, ZoneValueError } from './dialog_rule_area_properties.js';
import { LSET_Name } from '@ziroeda/common/layer_ids.js';
import { LSET } from '@ziroeda/common/lset.js';
import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { PCB_BASE_EDIT_FRAME } from '../pcb_base_edit_frame.js';
import { layerSetOfTokens, layerTokens } from '../pcb_io/kicad_sexpr/board_view.js';
import type { ZONE } from '../zone.js';
import { ZONE_BORDER_DISPLAY_STYLE, ZONE_FILL_MODE, ZONE_SETTINGS } from '../zone_settings.js';
import type { TransferResult } from './dialog_text_properties.js';
import { editZoneParamsCommit } from './panel_zone_properties.js';

/** ZONE_BORDER_HATCH_{DIST,MINDIST,MAXDIST}_MM (pcbnew/zones.h:34-36). */
const BORDER_HATCH_DEFAULT = mmToIU(0.5);
const BORDER_HATCH_MIN = mmToIU(0.1);
const BORDER_HATCH_MAX = mmToIU(2.0);

/** ZONE_THICKNESS_MM, the minimum width a zone without one falls back to. */
const ZONE_THICKNESS = mmToIU(0.25);

/** Every field DIALOG_NON_COPPER_ZONES_EDITOR edits. */
export interface NonCopperZoneValues {
  layers: string[];
  locked: boolean;
  hatchStyle: ZoneBorderStyle;
  hatchPitch: number;
  cornerSmoothing: 'none' | 'chamfer' | 'fillet';
  /** Chamfer distance or fillet radius, IU. */
  cornerRadius: number;
  /** `(min_thickness …)`, labelled "Minimum width" on this form. */
  minThickness: number;
  /** `ZONE_FILL_MODE`: POLYGONS or HATCH_PATTERN, the only two there are. */
  fillMode: 'solid' | 'hatch';
  hatchThickness: number;
  hatchGap: number;
  /** Degrees. */
  hatchOrientation: number;
  hatchSmoothingLevel: number;
  hatchSmoothingValue: number;
}

/** The DisplayError string this dialog puts up — singular, unlike a rule area's. */
export const NO_LAYER_SELECTED = 'No layer selected.';

/**
 * DIALOG_NON_COPPER_ZONES_EDITOR::TransferDataToWindow.
 *
 * The hatch width and gap are not shown as stored. A zone that has never been
 * hatched carries zeroes, and blank-looking controls would be validated
 * against the minimum width the moment the user switched to hatched, so the
 * dialog invents a plausible pair — four and six times the minimum width, with
 * 1 mm and 1.5 mm floors — and then clamps both up to the minimum width. The
 * clamp also bites on a *stored* value: a hatch width narrower than the
 * minimum fill width is raised on open, before the user has touched anything.
 */
export function collectNonCopperZoneValues(zone: PcbZone): NonCopperZoneValues {
  const minThickness = zone.minThickness ?? ZONE_THICKNESS;

  const best = (stored: number, multiple: number, floorMM: number): number => {
    const bestValue = stored > 0 ? stored : Math.max(minThickness * multiple, mmToIU(floorMM));
    return Math.max(bestValue, minThickness);
  };

  return {
    layers: [...zone.layers],
    locked: zone.locked ?? false,
    // INVISIBLE_BORDER is "not used for standard zones": the switch skips it
    // and leaves the choice on its initial entry, which is `none` either way.
    hatchStyle: zone.hatchStyle === 'full' ? 'full' : zone.hatchStyle === 'edge' ? 'edge' : 'none',
    hatchPitch: zone.hatchPitch || BORDER_HATCH_DEFAULT,
    cornerSmoothing: zone.cornerSmoothing ?? 'none',
    cornerRadius: zone.cornerRadius ?? 0,
    minThickness,
    // Only HATCH_PATTERN selects the hatched entry; the `default:` arm takes
    // both POLYGONS and COPPER_THIEVING to solid.
    fillMode: zone.fillMode === 'hatch' ? 'hatch' : 'solid',
    hatchThickness: best(zone.hatchThickness ?? 0, 4, 1.0),
    hatchGap: best(zone.hatchGap ?? 0, 6, 1.5),
    hatchOrientation: zone.hatchOrientation ?? 0,
    hatchSmoothingLevel: zone.hatchSmoothingLevel ?? 0,
    hatchSmoothingValue: zone.hatchSmoothingValue ?? 0,
  };
}

/**
 * TransferDataFromWindow's refusals, in the order it makes them: the hatch
 * pitch first, then — only for a hatched fill — the hatch width and gap
 * against the minimum width, and the layer check last.
 */
export function nonCopperZoneValuesError(v: NonCopperZoneValues): ZoneValueError | null {
  if (v.hatchPitch < BORDER_HATCH_MIN)
    return { field: 'hatchPitch', kind: 'min', bound: BORDER_HATCH_MIN };
  if (v.hatchPitch > BORDER_HATCH_MAX)
    return { field: 'hatchPitch', kind: 'max', bound: BORDER_HATCH_MAX };

  if (v.fillMode === 'hatch') {
    if (v.hatchThickness < v.minThickness)
      return { field: 'hatchWidth', kind: 'min', bound: v.minThickness };
    if (v.hatchGap < v.minThickness)
      return { field: 'hatchGap', kind: 'min', bound: v.minThickness };
  }

  if (v.layers.length === 0) return { field: 'layers', kind: 'empty', bound: 0 };
  return null;
}

/**
 * DIALOG_NON_COPPER_ZONES_EDITOR::TransferDataFromWindow, patching the source
 * in step. The board comes back untouched when the values are refused.
 *
 * The corner radius is zeroed when smoothing is off, and the hatch parameters
 * are stored *whatever* the fill mode — a solid zone keeps the numbers so that
 * flipping to hatched later finds them again, even though the file records
 * them only for a hatched fill.
 */
export function applyNonCopperZoneValues(
  board: Board,
  index: number,
  v: NonCopperZoneValues,
): Board {
  const zone = board.zones[index];
  if (!zone) return board;
  if (nonCopperZoneValuesError(v)) return board;

  const cornerRadius = v.cornerSmoothing === 'none' ? 0 : v.cornerRadius;

  const next: PcbZone = {
    ...zone,
    layers: [...v.layers],
    locked: v.locked,
    hatchStyle: v.hatchStyle,
    hatchPitch: v.hatchPitch,
    cornerSmoothing: v.cornerSmoothing,
    cornerRadius,
    minThickness: v.minThickness,
    fillMode: v.fillMode,
    hatchThickness: v.hatchThickness,
    hatchGap: v.hatchGap,
    hatchOrientation: v.hatchOrientation,
    hatchSmoothingLevel: v.hatchSmoothingLevel,
    hatchSmoothingValue: v.hatchSmoothingValue,
  };

  return { ...board, zones: board.zones.map((z, i) => (i === index ? next : z)) };
}

// ---------------------------------------------------------------------------
// The live dialog: DIALOG_NON_COPPER_ZONES_EDITOR on a ZONE (#636 stage 6)
// ---------------------------------------------------------------------------

const OUTLINE_DISPLAY: readonly [ZoneBorderStyle, ZONE_BORDER_DISPLAY_STYLE][] = [
  ['none', ZONE_BORDER_DISPLAY_STYLE.NO_HATCH],
  ['edge', ZONE_BORDER_DISPLAY_STYLE.DIAGONAL_EDGE],
  ['full', ZONE_BORDER_DISPLAY_STYLE.DIAGONAL_FULL],
];

const SMOOTHING: readonly NonCopperZoneValues['cornerSmoothing'][] = ['none', 'chamfer', 'fillet'];

/**
 * `DIALOG_NON_COPPER_ZONES_EDITOR` (dialog_non_copper_zones_properties.cpp)
 * on a live non-copper ZONE, as `PCB_EDIT_FRAME::Edit_Zone_Params` drives it
 * (edit_zone_helpers.cpp:54-58): the board's default zone settings with the
 * zone read over them, TransferDataToWindow (:188-250) and
 * TransferDataFromWindow (:287-373), then the shared commit tail
 * ({@link editZoneParamsCommit}), "Edit Zone Properties".
 */
export class DIALOG_NON_COPPER_ZONES_EDITOR {
  private readonly m_frame: PCB_BASE_EDIT_FRAME;
  private readonly m_zone: ZONE;
  private readonly m_settings: ZONE_SETTINGS;

  constructor(aFrame: PCB_BASE_EDIT_FRAME, aZone: ZONE) {
    this.m_frame = aFrame;
    this.m_zone = aZone;
    this.m_settings = aFrame.GetDesignSettings().GetDefaultZoneSettings().clone();
    this.m_settings.importFrom(aZone);
  }

  TransferDataToWindow(): NonCopperZoneValues {
    const s = this.m_settings;
    const layers = s.m_Layers;
    const copperLayerCount = this.m_zone.GetBoard()?.GetCopperLayerCount() ?? 2;

    // Gives a reasonable value to grid style parameters, if currently there are no defined
    // parameters for grid pattern thickness and gap (if the value is 0)
    let hatchWidth = s.m_HatchThickness;

    if (hatchWidth <= 0) hatchWidth = Math.max(s.m_ZoneMinThickness * 4, mmToIU(1.0));

    let hatchGap = s.m_HatchGap;

    if (hatchGap <= 0) hatchGap = Math.max(s.m_ZoneMinThickness * 6, mmToIU(1.5));

    return {
      layers:
        layers.count() > 1
          ? layerTokens(layers, copperLayerCount, true, layers.and(LSET.AllCuMask()).any())
          : layers.Seq().map((l) => LSET_Name(l)),
      locked: s.m_Locked,
      // INVISIBLE_BORDER is "not used for standard zones": the choice stays on its first row.
      hatchStyle: OUTLINE_DISPLAY.find(([, d]) => d === s.m_ZoneBorderDisplayStyle)?.[0] ?? 'none',
      hatchPitch: s.m_BorderHatchPitch,
      cornerSmoothing: SMOOTHING[s.GetCornerSmoothingType()] ?? 'none',
      cornerRadius: s.GetCornerRadius(),
      minThickness: s.m_ZoneMinThickness,
      fillMode: s.m_FillMode === ZONE_FILL_MODE.HATCH_PATTERN ? 'hatch' : 'solid',
      hatchThickness: Math.max(hatchWidth, s.m_ZoneMinThickness),
      hatchGap: Math.max(hatchGap, s.m_ZoneMinThickness),
      hatchOrientation: s.m_HatchOrientation.AsDegrees(),
      hatchSmoothingLevel: s.m_HatchSmoothingLevel,
      hatchSmoothingValue: s.m_HatchSmoothingValue,
    };
  }

  TransferDataFromWindow(v: NonCopperZoneValues): TransferResult {
    const s = this.m_settings;

    s.SetCornerSmoothingType(Math.max(0, SMOOTHING.indexOf(v.cornerSmoothing)));
    s.SetCornerRadius(
      s.GetCornerSmoothingType() === ZONE_SETTINGS.SMOOTHING_NONE ? 0 : v.cornerRadius,
    );
    s.m_ZoneMinThickness = v.minThickness;

    const outline = OUTLINE_DISPLAY.find(([name]) => name === v.hatchStyle);
    if (outline) s.m_ZoneBorderDisplayStyle = outline[1];

    if (v.hatchPitch < BORDER_HATCH_MIN || v.hatchPitch > BORDER_HATCH_MAX) return { ok: false };

    s.m_BorderHatchPitch = v.hatchPitch;
    s.m_FillMode = v.fillMode === 'hatch' ? ZONE_FILL_MODE.HATCH_PATTERN : ZONE_FILL_MODE.POLYGONS;

    if (s.m_FillMode === ZONE_FILL_MODE.HATCH_PATTERN) {
      if (v.hatchThickness < v.minThickness) return { ok: false };
      if (v.hatchGap < v.minThickness) return { ok: false };
    }

    s.m_HatchOrientation = new EDA_ANGLE(v.hatchOrientation);
    s.m_HatchThickness = v.hatchThickness;
    s.m_HatchGap = v.hatchGap;
    s.m_HatchSmoothingLevel = v.hatchSmoothingLevel;
    s.m_HatchSmoothingValue = v.hatchSmoothingValue;
    s.m_Locked = v.locked;

    // Get the layer selection for this zone
    s.m_Layers = layerSetOfTokens(v.layers);

    if (s.m_Layers.none()) return { ok: false, message: NO_LAYER_SELECTED };

    editZoneParamsCommit(this.m_frame, this.m_zone, s);

    return { ok: true };
  }
}
