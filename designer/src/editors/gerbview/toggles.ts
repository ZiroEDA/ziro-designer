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

import { defaultUnitsToggle } from '../../ui/app_settings_units.js';
import type { GerbviewSettings } from '../../prefs/settings.js';
import { switchUnits, toggleIdUnits, unitsToggleId } from '../../ui/app_settings_units.js';

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
 * (`common/gal/gal_display_options.cpp:52`), so the small cross is on.
 *
 * The units entry is NOT written here. `system.units`' default is one branch in
 * `APP_SETTINGS_BASE` (`common/settings/app_settings.cpp:228-238`), and
 * `GERBVIEW_SETTINGS` passes the filename `"gerbview"`
 * (`gerbview/gerbview_settings.cpp:40`), which is not on the imperial side — so
 * this frame opens in millimetres. Right answer, but it was a local literal
 * restating a branch that lives in one place upstream.
 */
export const DEFAULT_TOGGLES: ReadonlySet<string> = new Set([
  'toggleGrid',
  defaultUnitsToggle('gerbview'),
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

// ----- gerbview.json ------------------------------------------------------------

/**
 * The toggles that are a `GERBVIEW_SETTINGS` field, and which field.
 *
 * Upstream every one of these buttons is a `GERBVIEW_ACTIONS` handler that
 * flips a member of `cfg` — `gvconfig()->m_Display.m_XORMode = !...`
 * (`gerbview/tools/gerbview_control.cpp`) — and the frame's checked state is
 * read straight back off the same member
 * (`GERBVIEW_FRAME::GetGbrVisibleElements` and the `SetConditions` block at
 * `gerbview_frame.cpp:1126-1150`). So the settings object, not the toolbar, is
 * where a toggle lives; the toolbar is a view of it, and so is Preferences >
 * Gerber Viewer > Display Options. That is the whole reason both can move the
 * same switch.
 *
 * The three `*Sketch` entries are INVERTED, because upstream's members are
 * fill flags and the buttons are sketch ones:
 * `return !gvconfig()->m_Display.m_DisplayLinesFill` (`:1136`).
 *
 * Not here: `showLayerManager`, `togglePolar` and `hideBackground`. The first
 * two are `wxAUI` pane state and `m_PolarCoords`, neither of which this port
 * stores yet, and the third has no upstream member at all — see
 * {@link LOCAL_TOGGLES}.
 */
export interface StoredToggle {
  read: (c: GerbviewSettings) => boolean;
  write: (c: GerbviewSettings, on: boolean) => void;
}

export const STORED_TOGGLES: Readonly<Record<string, StoredToggle>> = {
  toggleGrid: {
    read: (c) => c.window.grid.show,
    write: (c, on) => {
      c.window.grid.show = on;
    },
  },
  showDcodes: {
    read: (c) => c.appearance.show_dcodes,
    write: (c, on) => {
      c.appearance.show_dcodes = on;
    },
  },
  showNegativeObjects: {
    read: (c) => c.appearance.show_negative_objects,
    write: (c, on) => {
      c.appearance.show_negative_objects = on;
    },
  },
  showDrawingSheet: {
    read: (c) => c.appearance.show_border_and_titleblock,
    write: (c, on) => {
      c.appearance.show_border_and_titleblock = on;
    },
  },
  showPageLimits: {
    read: (c) => c.appearance.show_page_limit,
    write: (c, on) => {
      c.appearance.show_page_limit = on;
    },
  },
  flashedSketch: {
    read: (c) => !c.display.flashed_items_fill,
    write: (c, on) => {
      c.display.flashed_items_fill = !on;
    },
  },
  linesSketch: {
    read: (c) => !c.display.lines_fill,
    write: (c, on) => {
      c.display.lines_fill = !on;
    },
  },
  polygonsSketch: {
    read: (c) => !c.display.polygons_fill,
    write: (c, on) => {
      c.display.polygons_fill = !on;
    },
  },
  forceOpacityMode: {
    read: (c) => c.display.force_opacity_mode,
    write: (c, on) => {
      c.display.force_opacity_mode = on;
    },
  },
  xorMode: {
    read: (c) => c.display.xor_mode,
    write: (c, on) => {
      c.display.xor_mode = on;
    },
  },
  highContrast: {
    read: (c) => c.display.high_contrast_mode,
    write: (c, on) => {
      c.display.high_contrast_mode = on;
    },
  },
  flipView: {
    read: (c) => c.display.flip_gerber_view,
    write: (c, on) => {
      c.display.flip_gerber_view = on;
    },
  },
};

/**
 * The toggles with no field behind them, which therefore keep whatever the
 * frame has them at.
 *
 * `showLayerManager` is `wxAUI` perspective state upstream, `togglePolar` is
 * `EDA_DRAW_FRAME::m_PolarCoords`, and `hideBackground` has no upstream
 * counterpart at all — it is `LAYER_GERBVIEW_BACKGROUND`'s row in the layers
 * manager, whose visibility GerbView keeps in the render settings rather than
 * in a `PARAM`. None of the three is on a Preferences page, so none of them
 * needs one.
 */
export const LOCAL_TOGGLES: readonly string[] = [
  'showLayerManager',
  'togglePolar',
  'hideBackground',
];

/** Which ids come from `gerbview.json` rather than from the frame. */
function isStored(id: string): boolean {
  return id in STORED_TOGGLES || UNIT_GROUP.includes(id) || CROSSHAIR_GROUP.includes(id);
}

/**
 * The toggle set `cfg` describes, keeping `local`'s answer for the three ids
 * {@link LOCAL_TOGGLES} names.
 *
 * This is `GERBVIEW_FRAME::SetConditions`' whole block read as data: every
 * `.Check( cond )` there resolves against `gvconfig()`, so "which buttons are
 * lit" is a pure function of the settings object plus the pane state.
 */
export function togglesFromSettings(
  cfg: GerbviewSettings,
  local: ReadonlySet<string>,
): Set<string> {
  const on = new Set<string>();
  for (const [id, t] of Object.entries(STORED_TOGGLES)) if (t.read(cfg)) on.add(id);
  // `system.units`, the same three the Units radio group offers.
  on.add(unitsToggleId(cfg.system.units));
  // `window.cursor.cross_hair_mode` — CROSS_HAIR_MODE's three.
  on.add(
    cfg.window.cursor.crosshair === '45'
      ? 'crosshair45'
      : cfg.window.cursor.crosshair === 'full'
        ? 'crosshairFull'
        : 'crosshairSmall',
  );
  for (const id of local) if (!isStored(id)) on.add(id);
  return on;
}

/**
 * Write `on` back into `cfg`, and say whether anything actually moved.
 *
 * The boolean is what keeps a freshly opened viewer from committing
 * `gerbview.json` — and waking the account sync — on mount, for a set that
 * came out of that very file a moment earlier.
 */
export function applyTogglesToSettings(cfg: GerbviewSettings, on: ReadonlySet<string>): boolean {
  let changed = false;
  for (const [id, t] of Object.entries(STORED_TOGGLES)) {
    const want = on.has(id);
    if (t.read(cfg) !== want) {
      t.write(cfg, want);
      changed = true;
    }
  }
  // `COMMON_TOOLS::SwitchUnits`, which also remembers the choice as the last of
  // its own FAMILY (`common_tools.cpp:656-668`) — this wrote `system.units`
  // alone, so Ctrl+U came back to whatever `last_*_units` still held from the
  // defaults rather than to the unit actually used last.
  const unitsId = on.has('unitsInches')
    ? 'unitsInches'
    : on.has('unitsMils')
      ? 'unitsMils'
      : 'unitsMm';
  if (cfg.system.units !== toggleIdUnits(unitsId)) {
    switchUnits(cfg.system, unitsId);
    changed = true;
  }
  const crosshair = on.has('crosshair45') ? '45' : on.has('crosshairFull') ? 'full' : 'small';
  if (cfg.window.cursor.crosshair !== crosshair) {
    cfg.window.cursor.crosshair = crosshair;
    changed = true;
  }
  return changed;
}

/** Two toggle sets holding the same ids. */
export function sameToggles(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}
