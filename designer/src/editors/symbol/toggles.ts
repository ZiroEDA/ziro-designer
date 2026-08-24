// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Symbol Editor's left-toolbar toggle state, as pure data and one function.
 *
 * Same shape, and the same reason, as `editors/gerbview/toggles.ts`: this lived
 * inside `SymbolEditor.tsx`, and `qa`'s tsconfig compiles `.ts` only, so
 * nothing in the suite could import it. The frame's opening units sat in there
 * as `'unitsMm'` — the wrong arm of `APP_SETTINGS_BASE`'s branch — through
 * every audit this editor has had, because no test could name the value.
 */

import { defaultUnitsToggle } from '../../ui/app_settings_units.js';

/**
 * The left toolbar's cycling groups — `AppendGroup( TOOLBAR_GROUP_CONFIG(...) )`
 * (`toolbars_symbol_editor.cpp:72-79`). One button each, showing the selected
 * action, so exactly one member is in `toggles` at a time.
 *
 * `showDeMorganStandard` / `showDeMorganAlternate` used to be a third pair here.
 * They were ours: neither name appears anywhere in KiCad 10.0.5, and the body
 * style is a CHOICE on the top bar upstream, not two toggle buttons.
 */
export const RADIO_GROUPS: readonly (readonly string[])[] = [
  ['unitsMm', 'unitsInches', 'unitsMils'],
  ['crosshairSmall', 'crosshairFull', 'crosshair45'],
];

/**
 * What a fresh SYMBOL_EDIT_FRAME shows.
 *
 * The units entry is NOT written here. `system.units`' default is one branch in
 * `APP_SETTINGS_BASE` (`common/settings/app_settings.cpp:228-238`) and
 * `symbol_editor` is on its imperial side, so this frame opens in mils —
 * `grid 50`, not `grid 1.27`. See `ui/app_settings_units.ts`.
 */
export const DEFAULT_TOGGLES: ReadonlySet<string> = new Set([
  'toggleGrid',
  defaultUnitsToggle('symbol_editor'),
  'toggleSyncedPinsMode',
  'showLibraryTree',
  'showProperties',
  // `cursorSmallCrosshairs` is the group's first action, so it is the one the
  // crosshair button shows on open.
  'crosshairSmall',
]);

/**
 * Activating `id`, given what is currently on.
 *
 * A member of a radio group REPLACES its group — including itself, so
 * re-activating the member already on leaves it on rather than turning it off.
 * Anything else flips.
 */
export function applyToggle(prev: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(prev);
  const group = RADIO_GROUPS.find((g) => g.includes(id));
  if (group) {
    for (const g of group) next.delete(g);
    next.add(id);
    return next;
  }
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}
