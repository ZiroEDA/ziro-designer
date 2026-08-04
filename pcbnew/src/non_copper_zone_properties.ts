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
 * Two consequences of that omission are load-bearing here. Because the form
 * has no name field, `collect`/`apply` never touch the zone's name, so a
 * non-copper zone can keep a name that collides with another. And because the
 * fill-style choice offers only solid and hatched, opening this dialog on a
 * copper-thieving zone and pressing OK silently demotes it to solid — upstream
 * guards the *copper* path against that (`IsCopperThieving` bails out early)
 * but a thieving zone that somehow reached a technical layer is not guarded.
 */

import { atom, head, isList, str, type SList, type SNode } from '@ziroeda/sexpr/src/index.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { dropChild, mm, patchChild } from './edit-board.js';
import type { Board, PcbZone } from './types.js';
import type { ZoneBorderStyle, ZoneValueError } from './rule_area_properties.js';

const list = (...items: SNode[]): SList => ({ kind: 'list', items });

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
  /** The fill-style choice: solid or hatched. There is no thieving option. */
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

/** The layer children: `(layer …)` for one, `(layers …)` for several. */
function layerNodes(src: SList, layers: readonly string[]): SList {
  if (layers.length === 1) {
    return patchChild(dropChild(src, 'layers'), 'layer', list(atom('layer'), str(layers[0]!)));
  }
  return patchChild(dropChild(src, 'layer'), 'layers', {
    kind: 'list',
    items: [atom('layers'), ...layers.map((l) => str(l))],
  });
}

/**
 * Patch the `(fill …)` child in place rather than rebuild it.
 *
 * This dialog owns eight of the fill's tokens and none of the rest — thermal
 * relief, island removal and the thieving block all belong to the copper form
 * — so rebuilding the node would quietly drop settings the user never saw.
 * Which of the eight are written follows `PCB_IO_KICAD_SEXPR::format`: the
 * radius only when non-zero, the hatch parameters only for a hatched fill, and
 * the hatch smoothing pair only above level 0.
 */
function patchFill(src: SList, v: NonCopperZoneValues): SList {
  const existing = src.items.find((it): it is SList => isList(it) && head(it) === 'fill');
  let fill: SList = existing ?? list(atom('fill'));

  fill =
    v.fillMode === 'hatch'
      ? patchChild(fill, 'mode', list(atom('mode'), atom('hatch')))
      : dropChild(fill, 'mode');

  if (v.cornerSmoothing === 'none') {
    fill = dropChild(dropChild(fill, 'smoothing'), 'radius');
  } else {
    fill = patchChild(fill, 'smoothing', list(atom('smoothing'), atom(v.cornerSmoothing)));
    fill = v.cornerRadius
      ? patchChild(fill, 'radius', list(atom('radius'), atom(mm(v.cornerRadius))))
      : dropChild(fill, 'radius');
  }

  if (v.fillMode === 'hatch') {
    fill = patchChild(
      fill,
      'hatch_thickness',
      list(atom('hatch_thickness'), atom(mm(v.hatchThickness))),
    );
    fill = patchChild(fill, 'hatch_gap', list(atom('hatch_gap'), atom(mm(v.hatchGap))));
    fill = patchChild(
      fill,
      'hatch_orientation',
      list(atom('hatch_orientation'), atom(String(v.hatchOrientation))),
    );

    if (v.hatchSmoothingLevel > 0) {
      fill = patchChild(
        fill,
        'hatch_smoothing_level',
        list(atom('hatch_smoothing_level'), atom(String(v.hatchSmoothingLevel))),
      );
      fill = patchChild(
        fill,
        'hatch_smoothing_value',
        list(atom('hatch_smoothing_value'), atom(String(v.hatchSmoothingValue))),
      );
    } else {
      fill = dropChild(dropChild(fill, 'hatch_smoothing_level'), 'hatch_smoothing_value');
    }
  } else {
    for (const name of [
      'hatch_thickness',
      'hatch_gap',
      'hatch_orientation',
      'hatch_smoothing_level',
      'hatch_smoothing_value',
    ])
      fill = dropChild(fill, name);
  }

  return patchChild(src, 'fill', fill);
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

  let src = zone.source;
  src = layerNodes(src, v.layers);
  src = v.locked
    ? patchChild(src, 'locked', list(atom('locked'), atom('yes')))
    : dropChild(src, 'locked');
  src = patchChild(src, 'hatch', list(atom('hatch'), atom(v.hatchStyle), atom(mm(v.hatchPitch))));
  src = patchChild(src, 'min_thickness', list(atom('min_thickness'), atom(mm(v.minThickness))));
  src = patchFill(src, { ...v, cornerRadius });

  next.source = src;

  return { ...board, zones: board.zones.map((z, i) => (i === index ? next : z)) };
}
