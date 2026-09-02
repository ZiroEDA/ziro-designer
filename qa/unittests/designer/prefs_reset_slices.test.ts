// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * "Reset to Defaults" resets the page that is open, and nothing else.
 *
 * Upstream this needs no test because a panel physically cannot reach another
 * panel's fields. `PANEL_MOUSE_SETTINGS::ResetPanel`
 * (`common/dialogs/panel_mouse_settings.cpp`) default-constructs a
 * `COMMON_SETTINGS` and calls `applySettingsToPanel`, which writes only the
 * controls this panel owns; `TransferDataFromWindow` then writes back only
 * those. So Common and Mouse and Touchpad share one `COMMON_SETTINGS` and still
 * cannot disturb each other, and `PANEL_GRID_SETTINGS::ResetPanel`
 * (`common/dialogs/panel_grid_settings.cpp:110-113`) touches `m_grids` alone.
 *
 * Ours edit a plain working copy with no widget tree in the way, so
 * `setEeschema(structuredClone(EESCHEMA_DEFAULTS))` looked like the same thing
 * and was not: Reset on Grids wiped Display Options, Editing Options,
 * Annotation Options and the field name templates too, and OK committed all of
 * it. That is a data-loss bug, so this test is about **what survives**.
 *
 * The shape matters. A test that only checked the reset page had gone back to
 * defaults would pass against the broken code — it did reset that page. So the
 * assertion is a whole-tree diff: dirty every leaf of every settings object,
 * reset one page, and require the set of leaves that changed to be *exactly*
 * the slice that page owns. A field reset by mistake fails it; a field the page
 * owns and silently forgot to reset fails it too.
 *
 * `SLICES` below is transcribed from each panel's controls — from the JSX, not
 * from the reset functions it is checking. Keeping it independent is the point:
 * derived from the implementation it would agree with any implementation.
 *
 * These import the `resets.ts` modules directly rather than the factories,
 * because `qa`'s tsconfig sets no `--jsx` and a factory reaches its panels.
 * Which page id each reset is wired to is checked from the factory sources at
 * the bottom of this file.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  COMMON_DEFAULTS,
  EESCHEMA_DEFAULTS,
  GERBVIEW_DEFAULTS,
  PCBNEW_DEFAULTS,
  PL_EDITOR_DEFAULTS,
  PRIVACY_DEFAULTS,
  SYMBOL_EDITOR_DEFAULTS,
  type CommonSettings,
  type EeschemaSettings,
  type GerbviewSettings,
  type PcbnewSettings,
  type PlEditorSettings,
  type PrivacySettings,
  type SymbolEditorSettings,
} from '@ziroeda/designer/src/prefs/settings.js';
import type { PrefsContext, PrefsPageId } from '@ziroeda/designer/src/dialogs/prefs/types.js';
import { TOOLBAR_APPS, type ToolbarApp } from '@ziroeda/designer/src/prefs/settings.js';
import {
  TOOLBAR_SETTINGS_DEFAULTS,
  type ToolbarSettings,
} from '@ziroeda/designer/src/ui/toolbar_config.js';
import {
  resetCommonPanel,
  resetMousePanel,
} from '@ziroeda/designer/src/dialogs/prefs/panels/resets.js';
import {
  resetEeschemaColorSettings,
  resetEeschemaDisplayOptions,
  resetEeschemaEditingOptions,
  resetEeschemaGrids,
  resetEeschemaToolbars,
} from '@ziroeda/designer/src/editors/schematic/prefs/resets.js';
import {
  resetPcbDisplayOptions,
  resetPcbToolbars,
} from '@ziroeda/designer/src/editors/pcb/prefs/resets.js';
import {
  resetSymbolEditorDisplayOptions,
  resetSymbolEditorEditingOptions,
  resetSymbolEditorGrids,
  resetSymbolEditorToolbars,
} from '@ziroeda/designer/src/editors/symbol/prefs/resets.js';
import {
  resetGerbviewColorSettings,
  resetGerbviewDisplayOptions,
  resetGerbviewGrids,
  resetGerbviewToolbars,
} from '@ziroeda/designer/src/editors/gerbview/prefs/resets.js';
import {
  resetPlEditorColorSettings,
  resetPlEditorDisplayOptions,
  resetPlEditorGrids,
  resetPlEditorToolbars,
} from '@ziroeda/designer/src/editors/drawingsheet/prefs/resets.js';

const SRC = fileURLToPath(new URL('../../../designer/src', import.meta.url));
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');

// ---------------------------------------------------------------- the slices

/**
 * Which settings each Preferences page owns, rooted at the working copy the
 * dialog hands its panels. Transcribed from the panels' controls.
 *
 * A path naming an object or an array covers everything under it.
 */
const SLICES: Partial<Record<PrefsPageId, readonly string[]>> = {
  // PanelCommonSettings.tsx — Antialiasing (no store), User Interface, Editing,
  // Session, Project Backup, Privacy.
  common: [
    'common.appearance.use_icons_in_menus',
    'common.appearance.show_scrollbars',
    'common.appearance.grid_striping',
    'common.appearance.use_custom_cursors',
    'common.appearance.icon_theme',
    'common.appearance.toolbar_icon_size',
    'common.appearance.hicontrast_dimming_factor',
    // "Scaling" — ZOOM_CORRECTION_CTRL is one control and one setting.
    'common.appearance.zoom_correction_factor',
    'common.input.warp_mouse_on_move',
    'common.input.immediate_actions',
    'common.input.hotkey_feedback',
    'common.input.focus_follow_sch_pcb',
    'common.system.session.remember_open_files',
    'common.system.file_history_size',
    // Gone with the groups this page no longer draws. A panel's reset slice is
    // exactly the fields its controls bind to, so a control that is not on the
    // page may not be reset by its button — `common.system.autosave_interval`
    // (10.0.5 dropped the `Auto save:` row), the four Project Backup fields,
    // and `privacy.crash_reports`, which was ours rather than KiCad's. That
    // last one matters most: resetting a setting the user cannot see would
    // turn crash reporting back on from a button labelled "Reset Common to
    // Defaults".
    'common.backup.enabled',
    'common.backup.format',
    'common.backup.location',
    'common.backup.limit_total_size',
  ],
  // PanelGitRepos.tsx — but only the three `PANEL_GIT_REPOS::ResetPanel`
  // touches (`panel_git_repos.cpp:48-53`). `git.enableGit` and
  // `git.updatInterval` are on the page and are NOT reset upstream, so they are
  // not in the slice: a reset restores what its ResetPanel restores.
  'version-control': [
    'common.git.useDefaultAuthor',
    'common.git.authorName',
    'common.git.authorEmail',
  ],
  // PanelSpacemouse.tsx — `m_SpaceMouse` entire, every one of the six
  // parameters being on that page (`panel_spacemouse_base.cpp:30-67`). The
  // controls are disabled — no browser API reaches a SpaceMouse — but the page
  // is a RESETTABLE_PANEL upstream and its values are stored, not literals.
  spacemouse: ['common.spacemouse'],
  // PanelMouseSettings.tsx — Pan and Zoom, Drag Gestures, Scroll Gestures.
  mouse: [
    'common.input.center_on_zoom',
    'common.input.auto_pan',
    'common.input.zoom_acceleration',
    'common.input.zoom_speed',
    'common.input.zoom_speed_auto',
    'common.input.auto_pan_acceleration',
    'common.input.mouse_left',
    'common.input.mouse_middle',
    'common.input.mouse_right',
    // `m_choicePanMoveKey` — Drag Gestures' fourth row
    // (`panel_mouse_settings_base.cpp:161-169`).
    'common.input.motion_pan_modifier',
    'common.input.scroll_modifier_zoom',
    'common.input.scroll_modifier_pan_h',
    'common.input.scroll_modifier_pan_v',
    'common.input.reverse_scroll_zoom',
    'common.input.reverse_scroll_pan_h',
    'common.input.horizontal_pan',
  ],
  // PanelEeschemaDisplayOptions.tsx — Appearance, Selection & Highlighting,
  // Cross-probing, plus the embedded PANEL_GAL_OPTIONS' grid/cursor controls.
  'sch-display': [
    'eeschema.appearance.default_font',
    'eeschema.appearance.show_hidden_pins',
    'eeschema.appearance.show_hidden_fields',
    // `m_checkShowDirectiveLabels` (`panel_eeschema_display_options_base.cpp:116`),
    // which this page was missing altogether.
    'eeschema.appearance.show_directive_labels',
    'eeschema.appearance.show_erc_errors',
    'eeschema.appearance.show_erc_warnings',
    'eeschema.appearance.show_erc_exclusions',
    'eeschema.appearance.mark_sim_exclusions',
    'eeschema.appearance.show_op_voltages',
    'eeschema.appearance.show_op_currents',
    'eeschema.appearance.show_pin_alt_icons',
    'eeschema.appearance.show_page_limits',
    'eeschema.selection.thickness',
    // `m_collisionMarkerWidthCtrl` (`:271`), missing with it.
    'eeschema.selection.drag_net_collision_width',
    'eeschema.selection.highlight_thickness',
    'eeschema.selection.draw_selected_children',
    'eeschema.selection.fill_shapes',
    'eeschema.selection.highlight_netclass_colors',
    'eeschema.selection.highlight_netclass_colors_thickness',
    'eeschema.selection.highlight_netclass_colors_alpha',
    'eeschema.cross_probing',
    'eeschema.window.grid.style',
    'eeschema.window.grid.line_width',
    'eeschema.window.grid.min_spacing',
    'eeschema.window.grid.snap',
    'eeschema.window.cursor.crosshair',
    'eeschema.window.cursor.always_show_cursor',
  ],
  // PanelEeschemaGrids.tsx — Grids, Fast Grid Switching, Grid Overrides.
  'sch-grids': [
    'eeschema.window.grid.sizes',
    'eeschema.window.grid.last_size_idx',
    'eeschema.window.grid.fast_grid_1',
    'eeschema.window.grid.fast_grid_2',
    'eeschema.window.grid.overrides_enabled',
    'eeschema.window.grid.overrides',
  ],
  // PanelEeschemaEditingOptions.tsx.
  'sch-editing': [
    'eeschema.input.drag_is_move',
    'eeschema.input.esc_clears_net_highlight',
    'eeschema.input.allow_unconstrained_pin_swaps',
    'eeschema.drawing.line_mode',
    'eeschema.drawing.arc_edit_mode',
    'eeschema.drawing.auto_start_wires',
    'eeschema.drawing.repeat_label_increment',
    'eeschema.drawing.default_repeat_offset_x',
    'eeschema.drawing.default_repeat_offset_y',
    'eeschema.drawing.default_sheet_border_color',
    'eeschema.drawing.default_sheet_background_color',
    'eeschema.drawing.new_power_symbols',
    'eeschema.autoplace_fields.enable',
    'eeschema.autoplace_fields.allow_rejustify',
    'eeschema.autoplace_fields.align_to_grid',
    // m_checkAutoAnnotate, which Annotation Options also carries.
    'eeschema.annotation.automatic',
    'eeschema.appearance.footprint_preview',
    'eeschema.system.never_show_rescue_dialog',
  ],
  // PanelEeschemaColorSettings.tsx — the theme choice and the per-layer overrides.
  'sch-colors': ['eeschema.appearance.color_theme', 'userColors'],
  // PanelPcbDisplayOptions.tsx — only the Cross-probing group is ported.
  'pcb-display': ['pcbnew.cross_probing'],
  // PanelToolbarCustomization, one per app. `ResetPanel` refills the shadow
  // toolbars from `DefaultToolbarConfig` and touches nothing else — notably NOT
  // `appearance.custom_toolbars`, which is an APP_SETTINGS_BASE value the page
  // merely edits (`panel_toolbar_customization.cpp:243-267`).
  'sch-toolbars': ['toolbars.eeschema'],
  'pcb-toolbars': ['toolbars.pcbnew'],
  // PanelSymbolEditorDisplayOptions.tsx — the four Appearance checkboxes
  // `loadSymEditorSettings` writes (`panel_sym_display_options.cpp:41-47`) plus
  // the embedded PANEL_GAL_OPTIONS' six, which is what `ResetPanel` covers
  // (`:76-85`). The grid LIST and the overrides belong to the Grids page.
  'sym-display': [
    'symbolEditor.show_hidden_lib_pins',
    'symbolEditor.show_hidden_lib_fields',
    'symbolEditor.show_pin_electrical_type',
    'symbolEditor.show_pin_alt_icons',
    'symbolEditor.window.grid.style',
    'symbolEditor.window.grid.line_width',
    'symbolEditor.window.grid.min_spacing',
    'symbolEditor.window.grid.snap',
    'symbolEditor.window.cursor.crosshair',
    'symbolEditor.window.cursor.always_show_cursor',
  ],
  // PanelSymbolEditorEditingOptions.tsx — the eight values
  // `loadSymEditorSettings` pushes at the controls
  // (`panel_sym_editing_options.cpp:53-63`), which is every field on the page
  // and nothing else. Three of the eight are drawn disabled; a disabled control
  // is still this page's field, and `ResetPanel` puts it back.
  'sym-editing': [
    'symbolEditor.defaults',
    'symbolEditor.repeat',
    'symbolEditor.drag_pins_along_with_edges',
  ],
  // PanelSymbolEditorGrids.tsx — the same shared PANEL_GRID_SETTINGS, over
  // `symbol_editor.json`. `PANEL_GRID_SETTINGS::ResetPanel` is the same two
  // lines whatever frame constructed it.
  'sym-grids': [
    'symbolEditor.window.grid.sizes',
    'symbolEditor.window.grid.last_size_idx',
    'symbolEditor.window.grid.fast_grid_1',
    'symbolEditor.window.grid.fast_grid_2',
    'symbolEditor.window.grid.overrides_enabled',
    'symbolEditor.window.grid.overrides',
  ],
  'sym-toolbars': ['toolbars.symbol_editor'],
  // PanelPlEditorDisplayOptions.tsx — the embedded PANEL_GAL_OPTIONS and
  // nothing else: that panel IS the whole page
  // (`panel_pl_editor_display_options.cpp:33-46`).
  'ds-display': [
    'plEditor.window.grid.style',
    'plEditor.window.grid.line_width',
    'plEditor.window.grid.min_spacing',
    'plEditor.window.grid.snap',
    'plEditor.window.cursor.crosshair',
    'plEditor.window.cursor.always_show_cursor',
  ],
  // PanelPlEditorGrids.tsx — the same PANEL_GRID_SETTINGS the schematic's Grids
  // page is, so the same slice over this editor's settings object.
  'ds-grids': [
    'plEditor.window.grid.sizes',
    'plEditor.window.grid.last_size_idx',
    'plEditor.window.grid.fast_grid_1',
    'plEditor.window.grid.fast_grid_2',
    'plEditor.window.grid.overrides_enabled',
    'plEditor.window.grid.overrides',
  ],
  // PanelPlEditorColorSettings.tsx — one `Color theme:` choice and no swatches,
  // so unlike eeschema's Colors page it does NOT own `userColors`.
  'ds-colors': ['plEditor.appearance.color_theme'],
  'ds-toolbars': ['toolbars.pl_editor'],
  // PanelGerbviewDisplayOptions.tsx. `ResetPanel` is `loadSettings( &cfg )`
  // plus `m_galOptsPanel->ResetPanel( &cfg )`
  // (`panel_gerbview_display_options.cpp:110-118`), so the slice is this
  // page's own three groups plus the embedded PANEL_GAL_OPTIONS'. Pointedly
  // NOT `appearance.show_border_and_titleblock` or
  // `appearance.show_negative_objects`: `loadSettings` never reads them back,
  // because they are the layers manager's rows and not controls on this page.
  'gbr-display': [
    'gerbview.appearance.show_dcodes',
    'gerbview.appearance.show_page_limit',
    'gerbview.appearance.mode_opacity_value',
    'gerbview.appearance.page_type',
    'gerbview.display.flashed_items_fill',
    'gerbview.display.lines_fill',
    'gerbview.display.polygons_fill',
    'gerbview.window.grid.style',
    'gerbview.window.grid.line_width',
    'gerbview.window.grid.min_spacing',
    'gerbview.window.grid.snap',
    'gerbview.window.cursor.crosshair',
    'gerbview.window.cursor.always_show_cursor',
  ],
  // `gbr-colors` is deliberately ABSENT: its slice is a NAMESPACE inside
  // `userColors`, and this harness compares that record whole (see
  // `bagLeaves`). Checked by "the Colors pages share one file, one namespace
  // each" at the bottom of this file instead — a page skipped here without a
  // test of its own would be a page nobody checks.
  // PanelGerbviewGrids.tsx — the same PANEL_GRID_SETTINGS the schematic's and
  // the Drawing Sheet Editor's Grids pages are, so the same slice over this
  // editor's settings object.
  'gbr-grids': [
    'gerbview.window.grid.sizes',
    'gerbview.window.grid.last_size_idx',
    'gerbview.window.grid.fast_grid_1',
    'gerbview.window.grid.fast_grid_2',
    'gerbview.window.grid.overrides_enabled',
    // `gerbview.window.grid.overrides` is deliberately NOT here. The panel does
    // assign the whole `m_grids` block back, and the reset does put that key
    // back — but `PANEL_GRID_SETTINGS` hides every override row for
    // FRAME_GERBER (`panel_grid_settings.cpp:62-90`), so the record is
    // permanently empty and resetting it cannot move a leaf. Listing a leaf
    // that can never change would make this page the one test in the file
    // asserting something unobservable.
  ],
  'gbr-toolbars': ['toolbars.gerbview'],
};

/** Every page's `RESETTABLE_PANEL::ResetPanel`, by id. */
const RESETS: Partial<Record<PrefsPageId, (ctx: PrefsContext) => void>> = {
  common: resetCommonPanel,
  mouse: resetMousePanel,
  hotkeys: (ctx) => ctx.setHotkeys({}),
  'sym-display': resetSymbolEditorDisplayOptions,
  'sym-editing': resetSymbolEditorEditingOptions,
  'sym-grids': resetSymbolEditorGrids,
  'sym-toolbars': resetSymbolEditorToolbars,
  'sch-display': resetEeschemaDisplayOptions,
  'sch-grids': resetEeschemaGrids,
  'sch-editing': resetEeschemaEditingOptions,
  'sch-colors': resetEeschemaColorSettings,
  'pcb-display': resetPcbDisplayOptions,
  'sch-toolbars': resetEeschemaToolbars,
  'pcb-toolbars': resetPcbToolbars,
  'ds-display': resetPlEditorDisplayOptions,
  'ds-grids': resetPlEditorGrids,
  'ds-colors': resetPlEditorColorSettings,
  'ds-toolbars': resetPlEditorToolbars,
  'gbr-colors': resetGerbviewColorSettings,
  'gbr-display': resetGerbviewDisplayOptions,
  'gbr-grids': resetGerbviewGrids,
  'gbr-toolbars': resetGerbviewToolbars,
};

/**
 * Pages with no reset at all. `PANEL_TEMPLATE_FIELDNAMES_BASE` is a plain
 * `wxPanel` (`eeschema/dialogs/panel_template_fieldnames_base.h:36`), so
 * `PAGED_DIALOG::UpdateResetButton` greys the button out on it.
 */
const NOT_RESETTABLE: PrefsPageId[] = ['sch-fields'];

// ------------------------------------------------------------- the fake dialog

interface Bag {
  common: CommonSettings;
  eeschema: EeschemaSettings;
  symbolEditor: SymbolEditorSettings;
  pcbnew: PcbnewSettings;
  gerbview: GerbviewSettings;
  plEditor: PlEditorSettings;
  privacy: PrivacySettings;
  userColors: Record<string, string>;
  hotkeys: Record<string, string>;
  toolbars: Record<ToolbarApp, ToolbarSettings>;
}

const freshBag = (): Bag => ({
  common: structuredClone(COMMON_DEFAULTS),
  eeschema: structuredClone(EESCHEMA_DEFAULTS),
  symbolEditor: structuredClone(SYMBOL_EDITOR_DEFAULTS),
  pcbnew: structuredClone(PCBNEW_DEFAULTS),
  gerbview: structuredClone(GERBVIEW_DEFAULTS),
  plEditor: structuredClone(PL_EDITOR_DEFAULTS),
  privacy: structuredClone(PRIVACY_DEFAULTS),
  userColors: {},
  hotkeys: {},
  toolbars: {
    eeschema: structuredClone(TOOLBAR_SETTINGS_DEFAULTS),
    symbol_editor: structuredClone(TOOLBAR_SETTINGS_DEFAULTS),
    pcbnew: structuredClone(TOOLBAR_SETTINGS_DEFAULTS),
    pl_editor: structuredClone(TOOLBAR_SETTINGS_DEFAULTS),
    gerbview: structuredClone(TOOLBAR_SETTINGS_DEFAULTS),
  },
});

/**
 * The `PrefsContext` the shell hands a panel, over a plain object instead of
 * React state. The setters take a value or an updater, as `Dispatch` does.
 */
function makeCtx(bag: Bag): PrefsContext {
  const setter =
    <K extends keyof Bag>(key: K) =>
    (v: Bag[K] | ((prev: Bag[K]) => Bag[K])): void => {
      bag[key] = typeof v === 'function' ? (v as (p: Bag[K]) => Bag[K])(bag[key]) : v;
    };
  const updater =
    <K extends 'common' | 'eeschema' | 'symbolEditor' | 'pcbnew' | 'gerbview' | 'plEditor'>(
      key: K,
    ) =>
    (fn: (s: Bag[K]) => void): void => {
      const next = structuredClone(bag[key]);
      fn(next);
      bag[key] = next;
    };
  return {
    get common() {
      return bag.common;
    },
    get eeschema() {
      return bag.eeschema;
    },
    get pcbnew() {
      return bag.pcbnew;
    },
    get gerbview() {
      return bag.gerbview;
    },
    get plEditor() {
      return bag.plEditor;
    },
    get privacy() {
      return bag.privacy;
    },
    get userColors() {
      return bag.userColors;
    },
    get hotkeys() {
      return bag.hotkeys;
    },
    get toolbars() {
      return bag.toolbars;
    },
    upTb: (app: ToolbarApp, fn: (s: ToolbarSettings) => void) => {
      const next = structuredClone(bag.toolbars[app]);
      fn(next);
      bag.toolbars = { ...bag.toolbars, [app]: next };
    },
    upC: updater('common'),
    upE: updater('eeschema'),
    upSym: updater('symbolEditor'),
    upP: updater('pcbnew'),
    upGbr: updater('gerbview'),
    upPl: updater('plEditor'),
    setCommon: setter('common'),
    setEeschema: setter('eeschema'),
    setSymbolEditor: setter('symbolEditor'),
    setPcbnew: setter('pcbnew'),
    setGerbview: setter('gerbview'),
    setPlEditor: setter('plEditor'),
    setPrivacy: setter('privacy'),
    setUserColors: setter('userColors'),
    setHotkeys: setter('hotkeys'),
  } as unknown as PrefsContext;
}

// ------------------------------------------------------------------ leaf walk

type Json = unknown;
const isPlainObject = (v: Json): v is Record<string, Json> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Every leaf path in the settings tree. Arrays count as leaves. */
function leaves(
  value: Json,
  prefix: string,
  out: Map<string, Json> = new Map(),
): Map<string, Json> {
  if (isPlainObject(value) && Object.keys(value).length > 0) {
    for (const [k, v] of Object.entries(value)) leaves(v, prefix ? `${prefix}.${k}` : k, out);
  } else {
    out.set(prefix, value);
  }
  return out;
}

const bagLeaves = (bag: Bag): Map<string, Json> => {
  const out = new Map<string, Json>();
  for (const key of [
    'common',
    'eeschema',
    'symbolEditor',
    'pcbnew',
    'gerbview',
    'plEditor',
    'privacy',
  ] as const)
    leaves(bag[key], key, out);
  // Records with no fixed shape: compared whole.
  out.set('userColors', bag.userColors);
  out.set('hotkeys', bag.hotkeys);
  // One leaf per app: a `TOOLBAR_SETTINGS` file is a list with no fixed shape,
  // so it is compared whole, as `userColors` is.
  for (const app of TOOLBAR_APPS) out.set(`toolbars.${app}`, bag.toolbars[app]);
  return out;
};

/** A value that is definitely not the default, of the same rough shape. */
function dirty(value: Json): Json {
  if (typeof value === 'boolean') return !value;
  if (typeof value === 'number') return value + 7;
  if (typeof value === 'string') return `${value}~dirty`;
  if (Array.isArray(value)) return [...value, '~dirty'];
  if (isPlainObject(value)) {
    const out: Record<string, Json> = {};
    for (const [k, v] of Object.entries(value)) out[k] = dirty(v);
    return out;
  }
  return '~dirty';
}

/** Dirty every leaf of the whole working copy — every page's settings at once. */
function dirtyEverything(bag: Bag): void {
  bag.common = dirty(bag.common) as CommonSettings;
  bag.eeschema = dirty(bag.eeschema) as EeschemaSettings;
  bag.symbolEditor = dirty(bag.symbolEditor) as SymbolEditorSettings;
  bag.pcbnew = dirty(bag.pcbnew) as PcbnewSettings;
  bag.gerbview = dirty(bag.gerbview) as GerbviewSettings;
  bag.plEditor = dirty(bag.plEditor) as PlEditorSettings;
  bag.privacy = dirty(bag.privacy) as PrivacySettings;
  // ONE namespace, the schematic's. `colors/user.json` holds every app's
  // colours under its own (`m_colorNamespace`), but this harness compares
  // `userColors` as a single leaf — it has no fixed shape — so it can say "the
  // record moved" and not "whose rows moved". Dirtying a second namespace here
  // would make every Colors page fail for the right behaviour: a reset that
  // correctly spares the other app leaves the leaf not-equal to its default.
  // That half is checked instead by "the Colors pages share one file, one
  // namespace each" at the bottom of this file, in both directions.
  bag.userColors = { wire: '#ff0000' };
  bag.hotkeys = { 'sch.drawWire': 'Ctrl+Shift+W' };
  for (const app of TOOLBAR_APPS)
    bag.toolbars[app] = { toolbars: [{ name: 'LEFT', contents: [{ type: 'SEPARATOR' }] }] };
}

/** The leaf paths a slice covers: a path naming a subtree covers all of it. */
function sliceLeaves(paths: readonly string[], all: Iterable<string>): Set<string> {
  const every = [...all];
  const out = new Set<string>();
  for (const p of paths) {
    const hits = every.filter((leaf) => leaf === p || leaf.startsWith(`${p}.`));
    if (hits.length === 0) throw new Error(`slice path "${p}" matches no setting`);
    for (const h of hits) out.add(h);
  }
  return out;
}

const RESETTABLE = Object.keys(RESETS) as PrefsPageId[];

// --------------------------------------------------------------------- tests

describe('every slice path names a real setting', () => {
  it.each(Object.entries(SLICES))('%s', (_id, paths) => {
    const all = bagLeaves(freshBag()).keys();
    expect(sliceLeaves(paths as readonly string[], all).size).toBeGreaterThan(0);
  });
});

describe('resetting one page changes that page and only that page', () => {
  // The whole-tree form. Every leaf of every settings object is dirtied, one
  // page is reset, and the leaves that moved must be exactly that page's slice.
  it.each(RESETTABLE.filter((id) => SLICES[id]))('%s', (id) => {
    const bag = freshBag();
    const defaults = bagLeaves(freshBag());
    dirtyEverything(bag);
    const before = bagLeaves(bag);
    expect(before.size).toBe(defaults.size);

    (RESETS[id] as (ctx: PrefsContext) => void)(makeCtx(bag));

    const after = bagLeaves(bag);
    const moved = [...after.keys()]
      .filter((k) => JSON.stringify(after.get(k)) !== JSON.stringify(before.get(k)))
      .sort();
    const owned = [...sliceLeaves(SLICES[id] as readonly string[], defaults.keys())].sort();

    // Nothing outside the page moved, and nothing inside it was missed.
    expect(moved).toEqual(owned);
    // And what moved went back to the default, not to some other value.
    for (const k of moved) expect(after.get(k), k).toEqual(defaults.get(k));
  });

  it('hotkeys resets its override map and no settings at all', () => {
    const bag = freshBag();
    dirtyEverything(bag);
    const before = bagLeaves(bag);

    (RESETS.hotkeys as (ctx: PrefsContext) => void)(makeCtx(bag));

    expect(bag.hotkeys).toEqual({});
    const after = bagLeaves(bag);
    const moved = [...after.keys()].filter(
      (k) => JSON.stringify(after.get(k)) !== JSON.stringify(before.get(k)),
    );
    expect(moved).toEqual(['hotkeys']);
  });
});

describe('the other pages survive, page by page', () => {
  // The same guarantee stated the way a user meets it: a value set on every
  // schematic page, one page reset, the other five still holding their values.
  // `sch-fields` has no reset of its own, so it appears only as a survivor.
  const SCHEMATIC: PrefsPageId[] = ['sch-display', 'sch-grids', 'sch-editing', 'sch-colors'];

  /** One representative field per page, and a value nobody would default to. */
  const MARKS: Partial<Record<PrefsPageId, [string, Json]>> = {
    'sch-display': ['eeschema.appearance.show_hidden_pins', true],
    'sch-grids': ['eeschema.window.grid.sizes', ['1 mm', '0.5 mm']],
    'sch-editing': ['eeschema.drawing.default_repeat_offset_y', 250],
    'sch-colors': ['userColors', { wire: '#ff00ff' }],
    'sch-fields': ['eeschema.drawing.field_names', [{ name: 'MPN', value: '', visible: true }]],
  };

  const at = (bag: Bag, path: string): Json =>
    path.split('.').reduce<Json>((o, k) => (o as Record<string, Json>)[k], bag as unknown as Json);
  const put = (bag: Bag, path: string, v: Json): void => {
    const keys = path.split('.');
    const last = keys.pop() as string;
    const host = keys.reduce<Json>(
      (o, k) => (o as Record<string, Json>)[k],
      bag as unknown as Json,
    );
    (host as Record<string, Json>)[last] = v;
  };

  it.each(SCHEMATIC)('resetting %s leaves the other schematic pages alone', (reset) => {
    const bag = freshBag();
    for (const [, mark] of Object.entries(MARKS)) put(bag, mark[0], structuredClone(mark[1]));

    (RESETS[reset] as (ctx: PrefsContext) => void)(makeCtx(bag));

    for (const [page, [path, value]] of Object.entries(MARKS) as [PrefsPageId, [string, Json]][]) {
      if (page === reset) {
        expect(at(bag, path), `${page} did not reset ${path}`).not.toEqual(value);
      } else {
        expect(at(bag, path), `resetting ${reset} clobbered ${page}'s ${path}`).toEqual(value);
      }
    }
  });

  it('resetting Common leaves Mouse and Touchpad alone, and the other way round', () => {
    // The two share one COMMON_SETTINGS, which is why upstream needs
    // applySettingsToPanel rather than a whole-object assignment.
    const bag = freshBag();
    bag.common.appearance.icon_theme = 'dark';
    bag.common.system.file_history_size = 42;
    bag.common.input.zoom_speed = 9;
    bag.common.input.mouse_middle = 'zoom';
    bag.privacy.crash_reports = false;

    resetMousePanel(makeCtx(bag));
    expect(bag.common.appearance.icon_theme).toBe('dark');
    expect(bag.common.system.file_history_size).toBe(42);
    expect(bag.privacy.crash_reports).toBe(false);
    expect(bag.common.input.zoom_speed).toBe(COMMON_DEFAULTS.input.zoom_speed);
    expect(bag.common.input.mouse_middle).toBe(COMMON_DEFAULTS.input.mouse_middle);

    bag.common.input.zoom_speed = 9;
    bag.common.input.mouse_middle = 'zoom';
    resetCommonPanel(makeCtx(bag));
    expect(bag.common.input.zoom_speed).toBe(9);
    expect(bag.common.input.mouse_middle).toBe('zoom');
    expect(bag.common.appearance.icon_theme).toBe(COMMON_DEFAULTS.appearance.icon_theme);
    // ...and crash reporting is NOT reset, because the Privacy group is no
    // longer on the page. Turning telemetry back on from a button that says
    // "Reset Common to Defaults" would be the wrong kind of surprise, and the
    // per-panel slice is what prevents it.
    expect(bag.privacy.crash_reports).toBe(false);
  });

  it('no reset touches a setting no Preferences page shows', () => {
    // Fields that reach the same objects from elsewhere in the app: the Set
    // Language menu, the symbol chooser's pinned libraries, Schematic Setup's
    // default thicknesses, and the PNS router's own settings block.
    const OUTSIDE = [
      'common.system.language',
      'common.system.session.pinned_symbol_libs',
      'eeschema.drawing.default_line_thickness',
      'eeschema.drawing.field_names',
      'pcbnew.tools.pns',
      'pcbnew.appearance.color_theme',
    ];
    const all = [...bagLeaves(freshBag()).keys()];
    for (const id of RESETTABLE) {
      const paths = SLICES[id];
      if (!paths) continue;
      const owned = sliceLeaves(paths, all);
      for (const p of OUTSIDE) {
        const hits = all.filter((leaf) => leaf === p || leaf.startsWith(`${p}.`));
        expect(hits.length, p).toBeGreaterThan(0);
        for (const h of hits) expect(owned.has(h), `${id} claims ${h}`).toBe(false);
      }
    }
  });
});

describe('a page that is not resettable has no reset', () => {
  it('the schematic factory gives Field Name Templates no reset arm', () => {
    // Read as text: the factory reaches its panels, which are .tsx, and qa's
    // tsconfig sets no --jsx.
    const src = read('editors/schematic/prefs/index.ts');
    // To the NEXT case, not to `default:` — this arm is no longer the last one,
    // and a slice that runs past it reads the following arm's `reset:` as this
    // arm's. `sch-datasources` and `sch-simulator` come after it now.
    const from = src.indexOf("case 'sch-fields':");
    const to = src.indexOf('case ', from + 1);
    const arm = src.slice(from, to === -1 ? src.indexOf('default:') : to);
    expect(arm).toContain('PanelTemplateFieldnames');
    expect(arm).not.toMatch(/\breset:/);
    for (const id of NOT_RESETTABLE) expect(RESETS[id]).toBeUndefined();
  });

  it('the shell disables the button rather than resetting nothing silently', () => {
    // PAGED_DIALOG::UpdateResetButton (common/widgets/paged_dialog.cpp:329-355)
    // enables and renames the button only for a RESETTABLE_PANEL.
    const src = read('dialogs/PreferencesDialog.tsx');
    expect(src).toContain('const resettable = panel?.reset !== undefined;');
    expect(src).toContain('disabled={!resettable}');
    expect(src).toMatch(/Reset \$\{labelOf\(page\)[^}]*\} to Defaults/);
  });

  it('the shell never names a settings field of its own', () => {
    // The slice belongs to the panel. If the shell learns which fields a page
    // owns, the split is back to a switch in the dialog.
    const src = read('dialogs/PreferencesDialog.tsx');
    for (const name of ['COMMON_DEFAULTS', 'EESCHEMA_DEFAULTS', 'PCBNEW_DEFAULTS', 'resetKeys'])
      expect(src, `the shell names ${name}`).not.toContain(name);
  });
});

describe('every resettable page is wired to its own reset', () => {
  it.each([
    [
      'dialogs/prefs/panels/index.ts',
      ['common', 'mouse', 'hotkeys', 'spacemouse', 'version-control'],
    ],
    ['editors/schematic/prefs/index.ts', ['sch-display', 'sch-grids', 'sch-editing', 'sch-colors']],
    ['editors/pcb/prefs/index.ts', ['pcb-display']],
    ['editors/symbol/prefs/index.ts', ['sym-display', 'sym-editing', 'sym-grids', 'sym-toolbars']],
  ] as [string, string[]][])('%s', (rel, ids) => {
    const src = read(rel);
    for (const id of ids) {
      const start = src.indexOf(`case '${id}':`);
      expect(start, `${rel} has no arm for ${id}`).toBeGreaterThan(-1);
      const next = src.indexOf('case ', start + 6);
      const arm = src.slice(start, next === -1 ? src.indexOf('default:') : next);
      expect(arm, `${id} has no reset`).toMatch(/\breset:/);
    }
  });
});

/**
 * `colors/user.json` is ONE file holding EVERY app's colours, each under its
 * own section: `PANEL_COLOR_SETTINGS` announces which by setting
 * `m_colorNamespace` — `"gerbview"` at
 * `gerbview/dialogs/panel_gerbview_color_settings.cpp:33`, `"schematic"` at
 * `eeschema/dialogs/panel_eeschema_color_settings.cpp`. Ours is one flat map
 * with the namespace in the key.
 *
 * So "reset this page and no other" has a second meaning for the Colors pages
 * that the whole-tree harness above cannot express: it compares `userColors` as
 * a single leaf, because the record has no fixed shape. Resetting the Gerber
 * Viewer's Colors page while leaving the schematic's wires alone is invisible
 * to a whole-record compare, and that is exactly the failure mode — one page
 * clearing another app's colours out of a shared file.
 */
describe('the Colors pages share one file, one namespace each', () => {
  it('the Gerber Viewer’s reset clears its own rows and nobody else’s', () => {
    const bag = freshBag();
    bag.userColors = {
      wire: '#ff0000',
      bus: '#00ff00',
      'gerbview.grid': '#0000ff',
      'gerbview.layer3': '#ffff00',
    };

    resetGerbviewColorSettings(makeCtx(bag));

    expect(bag.userColors).toEqual({ wire: '#ff0000', bus: '#00ff00' });
  });

  it('it is a no-op when the Gerber Viewer has no override stored', () => {
    // `PANEL_COLOR_SETTINGS::ResetPanel` writes the DEFAULT into every swatch,
    // and a swatch already at its default does not move. Ours drops the key,
    // which is the same state — the fallback IS the default.
    const bag = freshBag();
    bag.userColors = { wire: '#ff0000' };
    resetGerbviewColorSettings(makeCtx(bag));
    expect(bag.userColors).toEqual({ wire: '#ff0000' });
  });

  /**
   * The other direction, which was a real defect until this page landed beside
   * it: `resetEeschemaColorSettings` was `ctx.setUserColors({})`, emptying the
   * whole file and taking the Gerber Viewer's 128 graphic layers with it.
   * Upstream cannot do that — `ResetPanel` walks `m_swatches`, and eeschema's
   * panel has no gerbview swatch to walk.
   *
   * Now narrowed to its own namespace, and asserted from the other side so it
   * stays narrow: this test is what fails if either reset goes back to
   * clearing the record whole.
   */
  it('the schematic’s reset leaves the Gerber Viewer’s rows alone', () => {
    const bag = freshBag();
    bag.userColors = { wire: '#ff0000', 'gerbview.grid': '#0000ff' };
    resetEeschemaColorSettings(makeCtx(bag));
    expect(bag.userColors).toEqual({ 'gerbview.grid': '#0000ff' });
  });
});
