// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * pcbnew default color theme and layer stacking order.
 *
 * Colors are the exact "KiCad Default" theme from
 * common/settings/builtin_color_themes.h (s_defaultTheme). The paint order is
 * GAL_LAYER_ORDER from pcbnew/pcb_draw_panel_gal.cpp reversed (that array is
 * top-first; canvas painting goes bottom-up): back tech layers, back copper,
 * inner coppers (In30→In1), front tech layers, front copper, then holes, then
 * footprint text, then the user/edge layers.
 */

export const PCB_BACKGROUND = 'rgb(0,16,35)';
// LAYER_GRID / LAYER_GRID_AXES / LAYER_CURSOR, KiCad Default theme.
export const PCB_GRID = 'rgb(132,132,132)';
export const PCB_GRID_AXES = 'rgb(194,194,194)';
export const PCB_CURSOR = 'rgb(255,255,255)';

/**
 * The drill/place file origin marker (BOARD_EDITOR_CONTROL's `m_placeOrigin`,
 * `COLOR4D( 0.8, 0.0, 0.0, 1.0 )`). Not theme-able upstream: it is constructed
 * with this literal rather than read from the colour settings.
 */
export const PCB_PLACE_ORIGIN = 'rgb(204,0,0)';

const rgba = (r: number, g: number, b: number, a = 1): string =>
  a >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`;

/** Copper + technical layer colors (s_defaultTheme). */
export const PCB_LAYER_COLORS: Record<string, string> = {
  'F.Cu': rgba(200, 52, 52),
  'In1.Cu': rgba(127, 200, 127),
  'In2.Cu': rgba(206, 125, 44),
  'In3.Cu': rgba(79, 203, 203),
  'In4.Cu': rgba(219, 98, 139),
  'In5.Cu': rgba(167, 165, 198),
  'In6.Cu': rgba(40, 204, 217),
  'In7.Cu': rgba(232, 178, 167),
  'In8.Cu': rgba(242, 237, 161),
  'In9.Cu': rgba(141, 203, 129),
  'In10.Cu': rgba(237, 124, 51),
  'In11.Cu': rgba(91, 195, 235),
  'In12.Cu': rgba(247, 111, 142),
  'In13.Cu': rgba(167, 165, 198),
  'In14.Cu': rgba(40, 204, 217),
  'In15.Cu': rgba(232, 178, 167),
  'In16.Cu': rgba(242, 237, 161),
  'In17.Cu': rgba(237, 124, 51),
  'In18.Cu': rgba(91, 195, 235),
  'In19.Cu': rgba(247, 111, 142),
  'In20.Cu': rgba(167, 165, 198),
  'In21.Cu': rgba(40, 204, 217),
  'In22.Cu': rgba(232, 178, 167),
  'In23.Cu': rgba(242, 237, 161),
  'In24.Cu': rgba(237, 124, 51),
  'In25.Cu': rgba(91, 195, 235),
  'In26.Cu': rgba(247, 111, 142),
  'In27.Cu': rgba(167, 165, 198),
  'In28.Cu': rgba(40, 204, 217),
  'In29.Cu': rgba(232, 178, 167),
  'In30.Cu': rgba(242, 237, 161),
  'B.Cu': rgba(77, 127, 196),
  'B.Adhes': rgba(0, 0, 132),
  'F.Adhes': rgba(132, 0, 132),
  'B.Paste': rgba(0, 194, 194, 0.9),
  'F.Paste': rgba(180, 160, 154, 0.9),
  'B.SilkS': rgba(232, 178, 167),
  'F.SilkS': rgba(242, 237, 161),
  'B.Mask': rgba(2, 255, 238, 0.4),
  'F.Mask': rgba(216, 100, 255, 0.4),
  'Dwgs.User': rgba(194, 194, 194),
  'Cmts.User': rgba(89, 148, 220),
  'Eco1.User': rgba(180, 219, 210),
  'Eco2.User': rgba(216, 200, 82),
  'Edge.Cuts': rgba(208, 210, 205),
  Margin: rgba(255, 38, 226),
  'B.CrtYd': rgba(38, 233, 255),
  'F.CrtYd': rgba(255, 38, 226),
  'B.Fab': rgba(88, 93, 132),
  'F.Fab': rgba(175, 175, 175),
  'User.1': rgba(194, 194, 194),
  'User.2': rgba(89, 148, 220),
  'User.3': rgba(180, 219, 210),
  'User.4': rgba(216, 200, 82),
  'User.5': rgba(194, 194, 194),
  'User.6': rgba(89, 148, 220),
  'User.7': rgba(180, 219, 210),
  'User.8': rgba(216, 200, 82),
  'User.9': rgba(232, 178, 167),
};

/** Special (virtual) layer colors used by the painter. */
export const PCB_SPECIAL = {
  // pcb_painter.cpp:158 forces LAYER_PAD_PLATEDHOLES to the background color at
  // render time (it isn't theme-able), so a plated drill reads as a real empty
  // hole, not the theme's 194,194,0. Only via holes / NPTH keep their colors.
  padPlatedHole: PCB_BACKGROUND,
  nonPlatedHole: rgba(26, 196, 210),
  viaHole: rgba(227, 183, 46),
  viaHoleWall: rgba(236, 236, 236),
  // pcb_painter.cpp:293 draws pad hole walls in the via "golden copper" hole
  // color (LAYER_VIA_HOLES) for contrast, an amber plating ring, not gray.
  padHoleWall: rgba(227, 183, 46),
  ratsnest: rgba(0, 248, 255, 0.35),
  anchor: rgba(255, 38, 226),
  drawingSheet: rgba(200, 114, 171),
  // Netname text colors (builtin_color_themes.h):
  //  - netName is NETNAMES_LAYER_ID_START, the track-name base ("lightLabel");
  //    the painter inverts it per copper layer whose color is brighter than
  //    0.5, which is what makes names on a light green In1.Cu read dark.
  //  - padName is LAYER_PAD_NETNAMES, the through-hole pad text.
  //  - viaName is LAYER_VIA_NETNAMES, near-black over the via copper.
  netName: rgba(255, 255, 255, 0.7),
  // LAYER_PAD_NETNAMES is listed as white 0.9 in builtin_color_themes.h, but
  // RENDER_SETTINGS::update() then overwrites it with the netnames colour
  // — `m_layerColors[LAYER_PAD_NETNAMES] = GetColor( NETNAMES_LAYER_ID_START )`
  // — so 0.7 is what actually reaches the screen. Taking the theme's 0.9 at
  // face value put our pad text at (250,235,235) over a red pad where pcbnew
  // draws (234,178,178). LAYER_VIA_NETNAMES gets no such override, so it does
  // keep its 0.9.
  padName: rgba(255, 255, 255, 0.7),
  viaName: rgba(50, 50, 50, 0.9),
  // DRC marker layers (LAYER_DRC_ERROR / _WARNING / _EXCLUSION /
  // _HIGHLIGHTED, s_defaultTheme). The active marker repaints in the
  // highlighted color (pcb_painter.cpp GetColor: brightened/selected
  // PCB_MARKER → LAYER_DRC_HIGHLIGHTED).
  drcError: rgba(215, 91, 107, 0.8),
  drcWarning: rgba(255, 208, 66, 0.8),
  drcExclusion: rgba(255, 255, 255, 0.8),
  drcHighlighted: rgba(255, 0, 255),
};

// ---------------------------------------------------------------------------
// Color themes (COLOR_SETTINGS). KiCad ships two built-ins
// (color_settings.cpp CreateBuiltinColorSettings): "KiCad Default"
// (s_defaultTheme, the palette above) and "KiCad Classic" (s_classicTheme).
// The print dialog picks among these like KiCad's theme chooser.

/** A complete board palette (COLOR_SETTINGS, pcbnew subset). */
export interface PcbColorTheme {
  /** COLOR_SETTINGS::GetFilename(), the identity stored in settings. */
  filename: string;
  /** COLOR_SETTINGS::GetName(), shown in theme choosers. */
  name: string;
  background: string;
  grid: string;
  layerColors: Record<string, string>;
  special: typeof PCB_SPECIAL;
}

/**
 * s_classicTheme board colors. The classic theme is written with legacy
 * EDA_COLOR_T names; the RGB values come from common/gal/color4d.cpp
 * colorRefs(), NOTE that table's fields are ordered blue,green,red, so e.g.
 * BLUE={132,0,0} means rgb(0,0,132).
 */
const C = {
  black: rgba(0, 0, 0),
  darkGray: rgba(132, 132, 132),
  lightGray: rgba(194, 194, 194),
  white: rgba(255, 255, 255),
  blue: rgba(0, 0, 132),
  green: rgba(0, 132, 0),
  cyan: rgba(0, 132, 132),
  red: rgba(132, 0, 0),
  magenta: rgba(132, 0, 132),
  brown: rgba(132, 132, 0),
  lightCyan: rgba(0, 194, 194),
  lightRed: rgba(194, 0, 0),
  lightMagenta: rgba(194, 0, 194),
  yellow: rgba(194, 194, 0),
  darkRed: rgba(72, 0, 0),
};

// In1..In30 classic copper cycle (s_classicTheme In1_Cu..In30_Cu, in order).
const CLASSIC_INNER = [
  C.yellow,
  C.lightMagenta,
  C.lightRed,
  C.cyan,
  C.green,
  C.blue,
  C.darkGray,
  C.magenta,
  C.lightGray,
  C.magenta,
  C.red,
  C.brown,
  C.lightGray,
  C.blue,
  C.green,
  C.red,
  C.yellow,
  C.lightMagenta,
  C.lightRed,
  C.cyan,
  C.green,
  C.blue,
  C.darkGray,
  C.magenta,
  C.lightGray,
  C.magenta,
  C.red,
  C.brown,
  C.lightGray,
  C.blue,
];

const CLASSIC_LAYER_COLORS: Record<string, string> = {
  'F.Cu': C.red,
  ...Object.fromEntries(CLASSIC_INNER.map((c, i) => [`In${i + 1}.Cu`, c])),
  'B.Cu': C.green,
  'B.Adhes': C.blue,
  'F.Adhes': C.magenta,
  'B.Paste': C.lightCyan,
  'F.Paste': C.red,
  'B.SilkS': C.magenta,
  'F.SilkS': C.cyan,
  'B.Mask': C.brown,
  'F.Mask': C.magenta,
  'Dwgs.User': C.lightGray,
  'Cmts.User': C.blue,
  'Eco1.User': C.green,
  'Eco2.User': C.yellow,
  'Edge.Cuts': C.yellow,
  Margin: C.lightMagenta,
  'B.CrtYd': C.darkGray,
  'F.CrtYd': C.lightGray,
  'B.Fab': C.blue,
  'F.Fab': C.darkGray,
  'User.1': C.blue,
  'User.2': C.blue,
  'User.3': C.blue,
  'User.4': C.blue,
  'User.5': C.blue,
  'User.6': C.blue,
  'User.7': C.blue,
  'User.8': C.blue,
  'User.9': C.blue,
};

const CLASSIC_SPECIAL: typeof PCB_SPECIAL = {
  // The painter forces plated pad holes to the background (classic: black).
  padPlatedHole: C.black,
  nonPlatedHole: C.yellow, // LAYER_NON_PLATEDHOLES = YELLOW
  viaHole: 'rgba(128,102,0,0.8)', // LAYER_VIA_HOLES = COLOR4D(0.5, 0.4, 0, 0.8)
  viaHoleWall: C.white, // LAYER_VIA_HOLEWALLS = WHITE
  padHoleWall: 'rgba(128,102,0,0.8)', // painter uses LAYER_VIA_HOLES
  ratsnest: C.white, // LAYER_RATSNEST = WHITE
  anchor: C.blue, // LAYER_ANCHOR = BLUE
  drawingSheet: C.darkRed, // LAYER_DRAWINGSHEET = DARKRED
  netName: rgba(255, 255, 255, 0.7), // NETNAMES_LAYER_ID_START (same as default)
  padName: rgba(255, 255, 255, 0.7), // LAYER_PAD_NETNAMES, after the override
  viaName: rgba(50, 50, 50, 0.9), // LAYER_VIA_NETNAMES (same as default)
  // s_classicTheme: PURERED / PUREGREEN at 0.8, WHITE, PUREMAGENTA (color4d.cpp
  // colorRefs, the b,g,r field order again: PURERED={0,0,255} = rgb(255,0,0)).
  drcError: rgba(255, 0, 0, 0.8),
  drcWarning: rgba(0, 255, 0, 0.8),
  drcExclusion: rgba(255, 255, 255),
  drcHighlighted: rgba(255, 0, 255),
};

export const PCB_THEMES: PcbColorTheme[] = [
  {
    filename: '_builtin_default',
    name: 'KiCad Default',
    background: PCB_BACKGROUND,
    grid: PCB_GRID,
    layerColors: PCB_LAYER_COLORS,
    special: PCB_SPECIAL,
  },
  {
    filename: '_builtin_classic',
    name: 'KiCad Classic',
    background: C.black, // LAYER_PCB_BACKGROUND = BLACK
    grid: C.darkGray, // LAYER_GRID = DARKGRAY
    layerColors: CLASSIC_LAYER_COLORS,
    special: CLASSIC_SPECIAL,
  },
];

/** The theme registered under a COLOR_SETTINGS filename (default fallback). */
export const themeByFilename = (filename: string): PcbColorTheme =>
  PCB_THEMES.find((t) => t.filename === filename) ?? PCB_THEMES[0]!;

/**
 * Black-and-white print rendering (BOARD_PRINTOUT with blackWhite: every item
 * prints black on white paper; hole interiors read as paper through the
 * copper, hole walls print black).
 */
export const PCB_BW_PRINT_THEME: PcbColorTheme = {
  filename: '_print_bw',
  name: 'Black and white',
  background: C.white,
  grid: C.black,
  layerColors: Object.fromEntries(Object.keys(PCB_LAYER_COLORS).map((k) => [k, C.black])),
  special: {
    padPlatedHole: C.white,
    nonPlatedHole: C.white,
    viaHole: C.white,
    viaHoleWall: C.black,
    padHoleWall: C.black,
    ratsnest: C.black,
    anchor: C.black,
    drawingSheet: C.black,
    netName: C.white,
    padName: C.white,
    viaName: C.black,
    // Markers aren't printed (BOARD_PRINTOUT draws board layers only), but
    // every palette carries the full special set.
    drcError: C.black,
    drcWarning: C.black,
    drcExclusion: C.black,
    drcHighlighted: C.black,
  },
};

/**
 * Objects-tab swatch colors, keyed by the Objects row key, from KiCad's
 * builtin dark theme (common/settings/builtin_color_themes.h). Rows without
 * an entry have no theme color and show a blank spacer, like upstream.
 */
export const PCB_OBJECT_COLORS: Record<string, string> = {
  ratsnest: rgba(0, 248, 255, 0.35),
  drcWarnings: rgba(255, 208, 66, 0.8),
  drcErrors: rgba(215, 91, 107, 0.8),
  drcExclusions: rgba(255, 255, 255, 0.8),
  anchors: rgba(255, 38, 226),
  points: rgba(255, 38, 226),
  lockedShadow: rgba(255, 38, 226, 0.5),
  collidingCourtyards: rgba(255, 0, 5, 0.5),
  constrainedShadow: rgba(80, 160, 240, 0.5),
  boardAreaShadow: rgba(100, 100, 100, 0.35),
  drawingSheet: rgba(200, 114, 171),
  grid: rgba(132, 132, 132),
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

export const layerColor = (name: string): string => PCB_LAYER_COLORS[name] ?? 'rgb(132,132,132)';
