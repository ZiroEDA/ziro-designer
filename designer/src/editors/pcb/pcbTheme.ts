// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The board's view of KiCad's built-in colour themes, plus pcbnew's layer
 * stacking order.
 *
 * The colours themselves are NOT defined here. They live once, for every
 * editor, in `@ziroeda/common/src/settings/builtin_color_themes.ts` — a
 * mechanical port of `common/settings/builtin_color_themes.h`, which is
 * likewise the single place KiCad defines them. This module names the layers
 * pcbnew's painter reads (`PCB_LAYER_ID` / `GAL_LAYER_ID`), applies the
 * handful of overrides `PCB_RENDER_SETTINGS` applies on top of the theme, and
 * renders each colour to a CSS string.
 *
 * Adding a colour here means naming a layer, never typing an RGB value. The
 * two exceptions are called out individually below; both are colours KiCad has
 * no `COLOR_SETTINGS` layer for.
 *
 * The paint order is GAL_LAYER_ORDER from pcbnew/pcb_draw_panel_gal.cpp
 * reversed (that array is top-first; canvas painting goes bottom-up): back
 * tech layers, back copper, inner coppers (In30→In1), front tech layers, front
 * copper, then holes, then footprint text, then the user/edge layers.
 */
import {
  BUILTIN_CLASSIC_THEME,
  BUILTIN_DEFAULT_THEME,
  type Color4d,
  LEGACY_COLORS,
  toCssColor,
} from '@ziroeda/common';

/** One theme's colours, indexed by KiCad layer-id name. */
type ThemeColors = Partial<Record<string, Color4d>>;

/**
 * A layer's colour as a CSS string, in pcbnew's compact spelling. A layer the
 * theme does not set falls back to "KiCad Default", the same way this module's
 * hand-written predecessor did.
 */
const at = (colors: ThemeColors, layer: keyof typeof BUILTIN_DEFAULT_THEME): string =>
  toCssColor(colors[layer] ?? BUILTIN_DEFAULT_THEME[layer]);

const legacyCss = (name: keyof typeof LEGACY_COLORS): string => toCssColor(LEGACY_COLORS[name]);

const BLACK = legacyCss('BLACK');
const WHITE = legacyCss('WHITE');

/**
 * The board layers our renderer paints, as `PCB_LAYER_ID` enumerator names.
 * The enum spells a dot as an underscore and nothing else, so the mapping to
 * the canonical layer name the rest of the app uses is mechanical.
 */
const PCB_LAYER_IDS = [
  'F_Cu',
  ...Array.from({ length: 30 }, (_, i) => `In${i + 1}_Cu`),
  'B_Cu',
  'B_Adhes',
  'F_Adhes',
  'B_Paste',
  'F_Paste',
  'B_SilkS',
  'F_SilkS',
  'B_Mask',
  'F_Mask',
  'Dwgs_User',
  'Cmts_User',
  'Eco1_User',
  'Eco2_User',
  'Edge_Cuts',
  'Margin',
  'B_CrtYd',
  'F_CrtYd',
  'B_Fab',
  'F_Fab',
  // All forty-five, as `color_settings.cpp:199-244` registers them. This is a
  // lookup keyed by layer name, not a list of what gets painted, and the
  // footprint editor's layer dropdowns offer every one of them
  // (`PCB_LAYER_BOX_SELECTOR::getEnabledLayers` with no board frame) — so
  // stopping at nine gave User.10 and up the grid colour in their swatch.
  ...Array.from({ length: 45 }, (_, i) => `User_${i + 1}`),
] as (keyof typeof BUILTIN_DEFAULT_THEME)[];

/** `F_Cu` → `F.Cu`, `User_1` → `User.1`. */
const layerName = (id: string): string => id.replace('_', '.');

const layerColorsFor = (colors: ThemeColors): Record<string, string> =>
  Object.fromEntries(PCB_LAYER_IDS.map((id) => [layerName(id), at(colors, id)]));

/** Copper + technical layer colours, "KiCad Default". */
export const PCB_LAYER_COLORS: Record<string, string> = layerColorsFor(BUILTIN_DEFAULT_THEME);

export const PCB_BACKGROUND = at(BUILTIN_DEFAULT_THEME, 'LAYER_PCB_BACKGROUND');
/** `LAYER_DRAWINGSHEET` — the sheet border and title block, as pcbnew draws
 *  them and as `DIALOG_PAGES_SETTINGS`' preview paints them for a non-schematic
 *  frame (dialog_page_settings.cpp:606-613 substitutes the schematic layer only
 *  for FRAME_SCH*). */
export const PCB_DRAWINGSHEET = at(BUILTIN_DEFAULT_THEME, 'LAYER_DRAWINGSHEET');
export const PCB_GRID = at(BUILTIN_DEFAULT_THEME, 'LAYER_GRID');
export const PCB_GRID_AXES = at(BUILTIN_DEFAULT_THEME, 'LAYER_GRID_AXES');
export const PCB_CURSOR = at(BUILTIN_DEFAULT_THEME, 'LAYER_CURSOR');

/**
 * The drill/place file origin marker (BOARD_EDITOR_CONTROL's `m_placeOrigin`,
 * `COLOR4D( 0.8, 0.0, 0.0, 1.0 )`). Not theme-able upstream: it is constructed
 * with this literal rather than read from the colour settings.
 */
export const PCB_PLACE_ORIGIN = toCssColor({ r: 0.8, g: 0, b: 0, a: 1 });

/**
 * The colour the active DRC marker repaints in (pcb_painter.cpp GetColor: a
 * brightened/selected PCB_MARKER). KiCad has no COLOR_SETTINGS layer for it —
 * there is no `LAYER_DRC_HIGHLIGHTED` in `layer_ids.h` — so it is ours, and it
 * is spelled out here rather than looked up in the shared table.
 */
const DRC_HIGHLIGHTED = 'rgb(255,0,255)';

/** Special (virtual) layer colours used by the painter. */
export interface PcbSpecialColors {
  padPlatedHole: string;
  nonPlatedHole: string;
  viaHole: string;
  viaHoleWall: string;
  padHoleWall: string;
  ratsnest: string;
  anchor: string;
  /** `LAYER_POINTS` ("board.points"): the colour of a `PCB_POINT`'s X. */
  points: string;
  /** `LAYER_AUX_ITEMS` ("board.aux_items"), which the ruler and the edit
   *  points draw in. */
  auxItems: string;
  drawingSheet: string;
  pageLimits: string;
  /**
   * `LAYER_BOARD_OUTLINE_AREA` — the "Board Area Shadow" fill inside Edge.Cuts,
   * rgba(100, 100, 100, 0.35) in both built-in themes
   * (`common/settings/builtin_color_themes.h:175`, `:452`).
   */
  outlineArea: string;
  netName: string;
  padName: string;
  viaName: string;
  drcError: string;
  drcWarning: string;
  drcExclusion: string;
  drcHighlighted: string;
}

const specialFor = (colors: ThemeColors): PcbSpecialColors => ({
  // pcb_painter.cpp:158 forces LAYER_PAD_PLATEDHOLES to the background colour
  // at render time (it isn't theme-able), so a plated drill reads as a real
  // empty hole rather than the theme's own plated-hole colour. Only via holes
  // and NPTH keep theirs.
  padPlatedHole: at(colors, 'LAYER_PCB_BACKGROUND'),
  nonPlatedHole: at(colors, 'LAYER_NON_PLATEDHOLES'),
  viaHole: at(colors, 'LAYER_VIA_HOLES'),
  viaHoleWall: at(colors, 'LAYER_VIA_HOLEWALLS'),
  // pcb_painter.cpp:293 draws pad hole walls in the via "golden copper" hole
  // colour (LAYER_VIA_HOLES) for contrast — an amber plating ring, not grey.
  padHoleWall: at(colors, 'LAYER_VIA_HOLES'),
  ratsnest: at(colors, 'LAYER_RATSNEST'),
  anchor: at(colors, 'LAYER_ANCHOR'),
  points: at(colors, 'LAYER_POINTS'),
  auxItems: at(colors, 'LAYER_AUX_ITEMS'),
  drawingSheet: at(colors, 'LAYER_DRAWINGSHEET'),
  // LAYER_PAGE_LIMITS: the paper edge, outside the sheet's own frame and in
  // its own grey. Not the schematic's page-limits grey, which is a different
  // layer and a lighter 181.
  pageLimits: at(colors, 'LAYER_PAGE_LIMITS'),
  outlineArea: at(colors, 'LAYER_BOARD_OUTLINE_AREA'),
  // Net-name text colours:
  //  - netName is NETNAMES_LAYER_ID_START, the track-name base ("lightLabel");
  //    the painter inverts it per copper layer whose colour is brighter than
  //    0.5, which is what makes names on a light green In1.Cu read dark.
  //  - viaName is LAYER_VIA_NETNAMES, near-black over the via copper.
  netName: at(colors, 'NETNAMES_LAYER_ID_START'),
  // LAYER_PAD_NETNAMES is listed as white 0.9 in both themes, but
  // RENDER_SETTINGS::update() then overwrites it with the netnames colour
  // — `m_layerColors[LAYER_PAD_NETNAMES] = GetColor( NETNAMES_LAYER_ID_START )`
  // — so 0.7 is what actually reaches the screen. Taking the theme's 0.9 at
  // face value put our pad text at (250,235,235) over a red pad where pcbnew
  // draws (234,178,178). LAYER_VIA_NETNAMES gets no such override, so it does
  // keep its 0.9.
  padName: at(colors, 'NETNAMES_LAYER_ID_START'),
  viaName: at(colors, 'LAYER_VIA_NETNAMES'),
  drcError: at(colors, 'LAYER_DRC_ERROR'),
  drcWarning: at(colors, 'LAYER_DRC_WARNING'),
  drcExclusion: at(colors, 'LAYER_DRC_EXCLUSION'),
  drcHighlighted: DRC_HIGHLIGHTED,
});

export const PCB_SPECIAL: PcbSpecialColors = specialFor(BUILTIN_DEFAULT_THEME);

// ---------------------------------------------------------------------------
// Colour themes (COLOR_SETTINGS). KiCad ships two built-ins
// (color_settings.cpp CreateBuiltinColorSettings): "KiCad Default"
// (s_defaultTheme) and "KiCad Classic" (s_classicTheme). The print dialog
// picks among these like KiCad's theme chooser.

/** A complete board palette (COLOR_SETTINGS, pcbnew subset). */
export interface PcbColorTheme {
  /** COLOR_SETTINGS::GetFilename(), the identity stored in settings. */
  filename: string;
  /** COLOR_SETTINGS::GetName(), shown in theme choosers. */
  name: string;
  background: string;
  grid: string;
  /** `LAYER_GRID_AXES`, which `PCB_DRAW_PANEL_GAL::updateColors` hands to
   *  `GAL::SetAxesColor` (`pcbnew/pcb_draw_panel_gal.cpp:495`). */
  gridAxes: string;
  layerColors: Record<string, string>;
  special: PcbSpecialColors;
}

export const PCB_THEMES: PcbColorTheme[] = [
  {
    filename: '_builtin_default',
    name: 'KiCad Default',
    background: PCB_BACKGROUND,
    grid: PCB_GRID,
    gridAxes: PCB_GRID_AXES,
    layerColors: PCB_LAYER_COLORS,
    special: PCB_SPECIAL,
  },
  {
    filename: '_builtin_classic',
    name: 'KiCad Classic',
    background: at(BUILTIN_CLASSIC_THEME, 'LAYER_PCB_BACKGROUND'),
    grid: at(BUILTIN_CLASSIC_THEME, 'LAYER_GRID'),
    gridAxes: at(BUILTIN_CLASSIC_THEME, 'LAYER_GRID_AXES'),
    layerColors: layerColorsFor(BUILTIN_CLASSIC_THEME),
    special: specialFor(BUILTIN_CLASSIC_THEME),
  },
];

/** The theme registered under a COLOR_SETTINGS filename (default fallback). */
export const themeByFilename = (filename: string): PcbColorTheme =>
  PCB_THEMES.find((t) => t.filename === filename) ?? PCB_THEMES[0]!;

/**
 * `::GetColorSettings( cfg->m_ColorTheme )` for a board frame — the built-in
 * palette with the "User" theme's per-layer overrides laid over it.
 *
 * Upstream a theme IS a `COLOR_SETTINGS` file, so a user theme is not a
 * built-in plus a patch: it is a file of its own that `SETTINGS_MANAGER` hands
 * back whole. Ours stores only the rows a user has changed (`colors/user.json`,
 * flat, namespaced) — see `useUserColors` — so the two are assembled here, in
 * one place, rather than at each frame that asks.
 *
 * The keys are `board.*` (`common/settings/color_settings.cpp:124-190`), which
 * is the namespace `PANEL_FP_EDITOR_COLOR_SETTINGS` and the PCB Editor's own
 * Colors page BOTH write — `m_colorNamespace = "board"` — so a colour changed
 * from the footprint editor moves the board editor too. That shared namespace
 * is upstream's, not a shortcut here.
 */
export function pcbThemeWithOverrides(
  filename: string,
  userColors: Readonly<Record<string, string>>,
  /**
   * Themes "New Theme..." made, each with a `board.*` table of its own.
   * `AddNewColorSettings` gives one a file and `SetReadOnly( false )`
   * (`panel_color_settings.cpp:158-160`), so it is a theme the Colors page can
   * write and this has to read — a made theme resolved as a built-in would
   * paint the canvas in Default while its swatches showed something else.
   */
  userThemes: Readonly<Record<string, { colors: Readonly<Record<string, string>> }>> = {},
): PcbColorTheme {
  const base = themeByFilename(filename);
  const made = userThemes[filename];
  // A built-in theme's file `IsReadOnly()`, so no override can apply to it —
  // which is also why the swatches are answerable only on a writable theme
  // (`panel_color_settings.cpp:74-75`).
  if (filename !== 'user' && !made) return base;
  // `m_currentSettings` is the theme's OWN table; the writable one is stored as
  // `colors/user.json`, a made one under its own name.
  const overrides = made ? made.colors : userColors;

  const layerColors = { ...base.layerColors };
  // `board.copper.<f|b|in1…>` for a copper layer, `board.<layer>` otherwise.
  for (const id of PCB_LAYER_IDS) {
    const name = layerName(id);
    const key = /\.Cu$/.test(name)
      ? `board.copper.${name.replace(/\.Cu$/, '').toLowerCase()}`
      : `board.${id.toLowerCase()}`;
    const override = overrides[key];
    if (override !== undefined) layerColors[name] = override;
  }

  const pick = (key: string, fallback: string): string => overrides[key] ?? fallback;
  return {
    ...base,
    background: pick('board.background', base.background),
    grid: pick('board.grid', base.grid),
    gridAxes: pick('board.grid_axes', base.gridAxes),
    layerColors,
    special: {
      ...base.special,
      ratsnest: pick('board.ratsnest', base.special.ratsnest),
      anchor: pick('board.anchor', base.special.anchor),
      points: pick('board.points', base.special.points),
      auxItems: pick('board.aux_items', base.special.auxItems),
      drawingSheet: pick('board.worksheet', base.special.drawingSheet),
      pageLimits: pick('board.page_limits', base.special.pageLimits),
      outlineArea: pick('board.outline_area', base.special.outlineArea),
      nonPlatedHole: pick('board.plated_hole', base.special.nonPlatedHole),
      netName: pick('board.track_net_names', base.special.netName),
      padName: pick('board.pad_net_names', base.special.padName),
      viaName: pick('board.via_net_names', base.special.viaName),
      drcError: pick('board.drc_error', base.special.drcError),
      drcWarning: pick('board.drc_warning', base.special.drcWarning),
      drcExclusion: pick('board.drc_exclusion', base.special.drcExclusion),
    },
  };
}

/**
 * Black-and-white print rendering (BOARD_PRINTOUT with blackWhite: every item
 * prints black on white paper; hole interiors read as paper through the
 * copper, hole walls print black).
 */
export const PCB_BW_PRINT_THEME: PcbColorTheme = {
  filename: '_print_bw',
  name: 'Black and white',
  background: WHITE,
  grid: BLACK,
  gridAxes: BLACK,
  layerColors: Object.fromEntries(Object.keys(PCB_LAYER_COLORS).map((k) => [k, BLACK])),
  special: {
    padPlatedHole: WHITE,
    nonPlatedHole: WHITE,
    viaHole: WHITE,
    viaHoleWall: BLACK,
    padHoleWall: BLACK,
    ratsnest: BLACK,
    anchor: BLACK,
    points: BLACK,
    auxItems: BLACK,
    drawingSheet: BLACK,
    pageLimits: BLACK,
    // A print never draws the board-area shadow — it is a screen affordance and
    // `boardOutlineArea` defaults off — so this is the PAPER rather than an
    // invented transparent literal. `shared_color_theme.test.ts` allows exactly
    // one colour literal in this file and is right to: a second would be a
    // colour nothing in KiCad has.
    outlineArea: WHITE,
    netName: WHITE,
    padName: WHITE,
    viaName: BLACK,
    // Markers aren't printed (BOARD_PRINTOUT draws board layers only), but
    // every palette carries the full special set.
    drcError: BLACK,
    drcWarning: BLACK,
    drcExclusion: BLACK,
    drcHighlighted: BLACK,
  },
};

/**
 * Objects-tab swatch colours, keyed by the Objects row key.
 *
 * A row missing from this map has no colour of its own in the theme — Tracks
 * through Footprint Text are the eleven — and upstream still draws a swatch
 * for it, in COLOR_SWATCH's checkerboard "unset" rendering rather than as a
 * gap (`appearance_controls.cpp:2317`, and `GetDefaultColor` cannot return
 * UNSPECIFIED: unregistered layers fall through to `s_userColors[id % 4]`).
 * The `.unset` swatch class carries that rendering.
 */
export const PCB_OBJECT_COLORS: Record<string, string> = {
  ratsnest: PCB_SPECIAL.ratsnest,
  drcWarnings: PCB_SPECIAL.drcWarning,
  drcErrors: PCB_SPECIAL.drcError,
  drcExclusions: PCB_SPECIAL.drcExclusion,
  anchors: PCB_SPECIAL.anchor,
  points: PCB_SPECIAL.points,
  lockedShadow: at(BUILTIN_DEFAULT_THEME, 'LAYER_LOCKED_ITEM_SHADOW'),
  collidingCourtyards: at(BUILTIN_DEFAULT_THEME, 'LAYER_CONFLICTS_SHADOW'),
  boardAreaShadow: at(BUILTIN_DEFAULT_THEME, 'LAYER_BOARD_OUTLINE_AREA'),
  drawingSheet: PCB_SPECIAL.drawingSheet,
  pageLimits: PCB_SPECIAL.pageLimits,
  outlineArea: PCB_SPECIAL.outlineArea,
  grid: PCB_GRID,
};

const INNER = Array.from({ length: 30 }, (_, i) => `In${30 - i}.Cu`);

/**
 * Bottom-to-top paint order for real board layers (GAL_LAYER_ORDER reversed).
 * Holes and footprint text are separate passes injected between 'F.Cu' and
 * 'User.9' by the renderer, exactly where the GAL array puts them.
 */
export const PCB_PAINT_ORDER: string[] = [
  'B.Fab',
  'B.CrtYd',
  'B.Adhes',
  'B.Paste',
  'B.SilkS',
  'B.Mask',
  'B.Cu',
  ...INNER,
  'F.Fab',
  'F.CrtYd',
  'F.Adhes',
  'F.Paste',
  'F.SilkS',
  'F.Mask',
  'F.Cu',
  // renderer: holes pass, then footprint-text pass
  'User.9',
  'User.8',
  'User.7',
  'User.6',
  'User.5',
  'User.4',
  'User.3',
  'User.2',
  'User.1',
  'Margin',
  'Edge.Cuts',
  'Eco2.User',
  'Eco1.User',
  'Cmts.User',
  'Dwgs.User',
];

export const layerColor = (name: string): string => PCB_LAYER_COLORS[name] ?? PCB_GRID;
