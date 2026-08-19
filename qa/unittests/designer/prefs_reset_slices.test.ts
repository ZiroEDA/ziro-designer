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
  PCBNEW_DEFAULTS,
  PRIVACY_DEFAULTS,
  type CommonSettings,
  type EeschemaSettings,
  type PcbnewSettings,
  type PrivacySettings,
} from '@ziroeda/designer/src/prefs/settings.js';
import type { PrefsContext, PrefsPageId } from '@ziroeda/designer/src/dialogs/prefs/types.js';
import {
  resetCommonPanel,
  resetMousePanel,
} from '@ziroeda/designer/src/dialogs/prefs/panels/resets.js';
import {
  resetEeschemaAnnotationOptions,
  resetEeschemaColorSettings,
  resetEeschemaDisplayOptions,
  resetEeschemaEditingOptions,
  resetEeschemaGrids,
} from '@ziroeda/designer/src/editors/schematic/prefs/resets.js';
import { resetPcbDisplayOptions } from '@ziroeda/designer/src/editors/pcb/prefs/resets.js';

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
    'common.appearance.icon_theme',
    'common.appearance.toolbar_icon_size',
    'common.appearance.hicontrast_dimming_factor',
    'common.input.warp_mouse_on_move',
    'common.input.immediate_actions',
    'common.input.hotkey_feedback',
    'common.system.session.remember_open_files',
    'common.system.autosave_interval',
    'common.system.file_history_size',
    'common.backup.enabled',
    'common.backup.backup_on_autosave',
    'common.backup.limit_total_files',
    'common.backup.limit_daily_files',
    'common.backup.min_interval',
    'common.backup.limit_total_size',
    'privacy.crash_reports',
  ],
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
    'eeschema.appearance.show_erc_errors',
    'eeschema.appearance.show_erc_warnings',
    'eeschema.appearance.show_erc_exclusions',
    'eeschema.appearance.mark_sim_exclusions',
    'eeschema.appearance.show_op_voltages',
    'eeschema.appearance.show_op_currents',
    'eeschema.appearance.show_pin_alt_icons',
    'eeschema.appearance.show_page_limits',
    'eeschema.selection.thickness',
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
  // PanelEeschemaAnnotationOptions.tsx.
  'sch-annotation': [
    'eeschema.annotation.automatic',
    'eeschema.annotation.method',
    'eeschema.annotation.sort_order',
  ],
  // PanelEeschemaColorSettings.tsx — the theme choice and the per-layer overrides.
  'sch-colors': ['eeschema.appearance.color_theme', 'userColors'],
  // PanelPcbDisplayOptions.tsx — only the Cross-probing group is ported.
  'pcb-display': ['pcbnew.cross_probing'],
};

/** Every page's `RESETTABLE_PANEL::ResetPanel`, by id. */
const RESETS: Partial<Record<PrefsPageId, (ctx: PrefsContext) => void>> = {
  common: resetCommonPanel,
  mouse: resetMousePanel,
  hotkeys: (ctx) => ctx.setHotkeys({}),
  'sch-display': resetEeschemaDisplayOptions,
  'sch-grids': resetEeschemaGrids,
  'sch-editing': resetEeschemaEditingOptions,
  'sch-annotation': resetEeschemaAnnotationOptions,
  'sch-colors': resetEeschemaColorSettings,
  'pcb-display': resetPcbDisplayOptions,
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
  pcbnew: PcbnewSettings;
  privacy: PrivacySettings;
  userColors: Record<string, string>;
  hotkeys: Record<string, string>;
}

const freshBag = (): Bag => ({
  common: structuredClone(COMMON_DEFAULTS),
  eeschema: structuredClone(EESCHEMA_DEFAULTS),
  pcbnew: structuredClone(PCBNEW_DEFAULTS),
  privacy: structuredClone(PRIVACY_DEFAULTS),
  userColors: {},
  hotkeys: {},
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
    <K extends 'common' | 'eeschema' | 'pcbnew'>(key: K) =>
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
    get privacy() {
      return bag.privacy;
    },
    get userColors() {
      return bag.userColors;
    },
    get hotkeys() {
      return bag.hotkeys;
    },
    upC: updater('common'),
    upE: updater('eeschema'),
    upP: updater('pcbnew'),
    setCommon: setter('common'),
    setEeschema: setter('eeschema'),
    setPcbnew: setter('pcbnew'),
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
  for (const key of ['common', 'eeschema', 'pcbnew', 'privacy'] as const)
    leaves(bag[key], key, out);
  // Records with no fixed shape: compared whole.
  out.set('userColors', bag.userColors);
  out.set('hotkeys', bag.hotkeys);
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
  bag.pcbnew = dirty(bag.pcbnew) as PcbnewSettings;
  bag.privacy = dirty(bag.privacy) as PrivacySettings;
  bag.userColors = { wire: '#ff0000' };
  bag.hotkeys = { 'sch.drawWire': 'Ctrl+Shift+W' };
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
  const SCHEMATIC: PrefsPageId[] = [
    'sch-display',
    'sch-grids',
    'sch-editing',
    'sch-annotation',
    'sch-colors',
  ];

  /** One representative field per page, and a value nobody would default to. */
  const MARKS: Partial<Record<PrefsPageId, [string, Json]>> = {
    'sch-display': ['eeschema.appearance.show_hidden_pins', true],
    'sch-grids': ['eeschema.window.grid.sizes', ['1 mm', '0.5 mm']],
    'sch-editing': ['eeschema.drawing.default_repeat_offset_y', 250],
    'sch-annotation': ['eeschema.annotation.sort_order', 1],
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
    expect(bag.privacy.crash_reports).toBe(PRIVACY_DEFAULTS.crash_reports);
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
    const arm = src.slice(src.indexOf("case 'sch-fields':"), src.indexOf('default:'));
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
    ['dialogs/prefs/panels/index.ts', ['common', 'mouse', 'hotkeys']],
    [
      'editors/schematic/prefs/index.ts',
      ['sch-display', 'sch-grids', 'sch-editing', 'sch-annotation', 'sch-colors'],
    ],
    ['editors/pcb/prefs/index.ts', ['pcb-display']],
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
