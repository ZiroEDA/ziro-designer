// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SCH_EDIT_FRAME's left-toolbar toggle state, as pure data and one function.
 *
 * Same shape, and the same reason, as `editors/gerbview/toggles.ts` and
 * `editors/symbol/toggles.ts`: this lived inside `SchematicEditor.tsx`, and
 * `qa`'s tsconfig compiles `.ts` only, so nothing in the suite could import it.
 * The frame's opening units sat in there as `'unitsMm'` — the wrong arm of
 * `APP_SETTINGS_BASE`'s branch — through every audit this editor has had,
 * because no test could name the value.
 *
 * Only the buttons eeschema keeps in *session* state live here. Grid,
 * crosshair, line mode, hidden pins/fields and auto-annotate are
 * `EESCHEMA_SETTINGS` keys upstream and are derived from the settings store
 * each render (`SETTINGS_TOGGLES` in `SchematicEditor.tsx`).
 */

import { defaultUnitsToggle } from '../../ui/app_settings_units.js';

/**
 * The left toolbar's cycling groups — `AppendGroup( TOOLBAR_GROUP_CONFIG(...) )`
 * (`eeschema/toolbars_sch_editor.cpp:81-84` for Units). One button each,
 * showing the selected action, so exactly one member is in `toggles` at a time.
 *
 * The units group is in upstream's own order — inches, mils, mm — which is NOT
 * pcbnew's order (`pcbnew/toolbars_pcb_editor.cpp:164-167` puts mm first). The
 * order is what the toolbar cycles through on click, so it is per-frame data,
 * not a shared constant.
 */
export const RADIO_GROUPS: readonly (readonly string[])[] = [
  ['unitsInches', 'unitsMils', 'unitsMm'],
  ['crosshairSmall', 'crosshairFull', 'crosshair45'],
  ['lineModeFree', 'lineMode90', 'lineMode45'],
];

/**
 * What a fresh SCH_EDIT_FRAME shows, of the buttons eeschema does not persist.
 *
 * The units entry is NOT written here. `system.units`' default is one branch in
 * `APP_SETTINGS_BASE` (`common/settings/app_settings.cpp:228-238`) and
 * `eeschema` is named on its imperial side, so this frame opens in **mils** —
 * `grid 50`, not `grid 1.27`. See `ui/app_settings_units.ts`.
 *
 * The two panes are `aui.show_schematic_hierarchy` and `aui.show_properties`,
 * both defaulting `true` (`eeschema/eeschema_settings.cpp:246-247` and
 * `:318-319`). `aui.show_search` (`:297-298`) and `aui.show_net_nav_panel`
 * (`:300-301`) default `false`, which is why neither is here.
 */
export const DEFAULT_TOGGLES: ReadonlySet<string> = new Set([
  defaultUnitsToggle('eeschema'),
  'showHierarchy',
  'showProperties',
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
  } else if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }

  return next;
}
