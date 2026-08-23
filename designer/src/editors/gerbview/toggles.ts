// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * GerbView's left-toolbar toggle state, as a pure function.
 *
 * Two of these buttons are not toggles at all: they are RADIO groups that the
 * toolbar cycles through. `cycleOnClick` (`ui/Toolbar.tsx`) calls `onActivate`
 * with the NEXT member's id, and only one member of a group can be in force at
 * a time — units are millimetres or inches or mils, and the crosshair is one of
 * `CROSS_HAIR_MODE`'s three (`common/gal/gal_display_options.h`).
 *
 * It lived inside `GerberViewer.tsx` as a `useCallback`, which meant it could
 * only be exercised by rendering the component — and there is no DOM test
 * environment in this repo. A mutation sweep proved the cost: disabling the
 * crosshair group's mutual exclusion outright failed NOT ONE test, and mutual
 * exclusion is the thing that commit was written to fix. A pure function in a
 * `.ts` can be called directly, so it is one here.
 */

/** `EDA_DRAW_FRAME`'s unit choice — one of three, never none and never two. */
export const UNIT_GROUP = ['unitsMm', 'unitsInches', 'unitsMils'];

/**
 * `CROSS_HAIR_MODE`: SMALL_CROSS, FULL_CROSSHAIR, FULL_CROSSHAIR_45.
 *
 * Exclusive for the same reason the units are, and for one more: the canvas
 * reads a single mode. While these three toggled independently the canvas never
 * saw the diagonal one at all.
 */
export const CROSSHAIR_GROUP = ['crosshairSmall', 'crosshairFull', 'crosshair45'];

/**
 * What a fresh frame shows.
 *
 * `m_crossHairMode( CROSS_HAIR_MODE::SMALL_CROSS )` is the
 * `GAL_DISPLAY_OPTIONS` constructor's default
 * (`common/gal/gal_display_options.cpp:53`), so the small cross is on.
 */
export const DEFAULT_TOGGLES: ReadonlySet<string> = new Set([
  'toggleGrid',
  'unitsMm',
  'showLayerManager',
  'crosshairSmall',
]);

/** The radio groups, in the order the reducer tries them. */
const GROUPS = [UNIT_GROUP, CROSSHAIR_GROUP];

/**
 * Activating `id`, given what is currently on.
 *
 * A member of a radio group REPLACES its group — including itself, so
 * re-activating the member that is already on leaves it on rather than turning
 * it off. Anything else flips.
 */
export function applyToggle(prev: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(prev);
  const group = GROUPS.find((g) => g.includes(id));

  if (group) {
    for (const g of group) next.delete(g);
    next.add(id);
  } else if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }

  return next;
}
