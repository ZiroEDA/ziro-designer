// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The board and schematic palettes are derived from the one shared table, not
 * re-typed per editor.
 *
 * KiCad defines its colours exactly once — `builtin_color_themes.h` is
 * `#include`d only by `color_settings.cpp` — and pcbnew, eeschema, gerbview and
 * pl_editor all read the resulting `COLOR_SETTINGS`. We had that table
 * transcribed by hand in three editor modules, and the copies had already
 * drifted: KiCad Classic's ERC-exclusion grey was CSS `lightgray` rather than
 * KiCad's `LIGHTGRAY`, and its rule-area outline was `PURERED` where the header
 * says `RED`. Neither was findable without diffing 500 lines of literals by eye.
 *
 * So the interesting assertions here are the two structural ones: that neither
 * editor's module contains a colour literal any more, and that each still
 * resolves to the value the header specifies. The first is what stops the
 * copies growing back; a future editor that "just needs one more colour" and
 * writes `rgb(…)` into its own file fails this file, not a code review.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BUILTIN_CLASSIC_THEME, BUILTIN_DEFAULT_THEME, toCssColor } from '@ziroeda/common';
import {
  PCB_BACKGROUND,
  PCB_CURSOR,
  PCB_GRID,
  PCB_GRID_AXES,
  PCB_LAYER_COLORS,
  PCB_OBJECT_COLORS,
  PCB_SPECIAL,
  PCB_THEMES,
  themeByFilename,
} from '@ziroeda/designer/src/editors/pcb/pcbTheme.js';
import { KICAD_CLASSIC, KICAD_DEFAULT } from '@ziroeda/designer/src/editors/schematic/theme.js';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const PCB_SRC = read('../../../designer/src/editors/pcb/pcbTheme.ts');
const SCH_SRC = read('../../../designer/src/editors/schematic/theme.ts');

/** Comments stripped, so a documented value cannot read as a live one. */
const code = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** Every colour literal in a source file: `rgb(...)`, `rgba(...)`, `#rrggbb`. */
const colorLiterals = (src: string): string[] => [
  ...(code(src).match(/rgba?\([^)]*\)|#[0-9a-fA-F]{3,8}\b/g) ?? []),
];

describe('the per-editor colour tables are gone', () => {
  it('leaves pcbnew with only the one colour KiCad has no layer for', () => {
    // LAYER_DRC_HIGHLIGHTED does not exist in layer_ids.h, so its colour is
    // ours and is commented as such where it is written.
    //
    // There were two. The second was rgba(80,160,240,0.5), the swatch for a
    // "Constrained Item Shadow" row that appears nowhere in 10.0.5 — not in
    // appearance_controls.cpp and not in any of the 44 translation
    // catalogues. It was documented as ours in pcbTheme.ts, documented again
    // here, and listed as an allowed exception, which is how an invented
    // control survived being noticed twice. The row is gone, so the colour is.
    expect(colorLiterals(PCB_SRC)).toEqual(['rgb(255,0,255)']);
  });

  it('leaves eeschema with none at all', () => {
    expect(colorLiterals(SCH_SRC)).toEqual([]);
  });

  it('has both editors reading the shared module', () => {
    for (const src of [PCB_SRC, SCH_SRC]) {
      expect(src).toContain("from '@ziroeda/common'");
      expect(src).toContain('BUILTIN_DEFAULT_THEME');
      expect(src).toContain('BUILTIN_CLASSIC_THEME');
    }
    // And not from each other: a colour is shared through common/, never
    // sideways between two peer editors.
    expect(PCB_SRC).not.toContain('../schematic/');
    expect(SCH_SRC).not.toContain('../pcb/');
  });

  it('does not carry a private legacy palette any more', () => {
    // Both files used to redeclare colorRefs()' BLUE/RED/CYAN by hand, each
    // with its own comment about the blue-first field order.
    for (const src of [PCB_SRC, SCH_SRC]) expect(code(src)).not.toMatch(/\bconst C = \{/);
  });
});

describe('pcbnew resolves to s_defaultTheme', () => {
  const d = BUILTIN_DEFAULT_THEME;

  it('takes its frame colours from the named layers', () => {
    expect(PCB_BACKGROUND).toBe(toCssColor(d.LAYER_PCB_BACKGROUND));
    expect(PCB_BACKGROUND).toBe('rgb(0,16,35)');
    expect(PCB_GRID).toBe('rgb(132,132,132)');
    expect(PCB_GRID_AXES).toBe('rgb(194,194,194)');
    expect(PCB_CURSOR).toBe('rgb(255,255,255)');
  });

  it('maps every PCB_LAYER_ID to its dotted layer name', () => {
    expect(PCB_LAYER_COLORS['F.Cu']).toBe(toCssColor(d.F_Cu));
    expect(PCB_LAYER_COLORS['B.Cu']).toBe(toCssColor(d.B_Cu));
    expect(PCB_LAYER_COLORS['In1.Cu']).toBe(toCssColor(d.In1_Cu));
    expect(PCB_LAYER_COLORS['In30.Cu']).toBe(toCssColor(d.In30_Cu));
    expect(PCB_LAYER_COLORS['Dwgs.User']).toBe(toCssColor(d.Dwgs_User));
    expect(PCB_LAYER_COLORS['Edge.Cuts']).toBe(toCssColor(d.Edge_Cuts));
    expect(PCB_LAYER_COLORS.Margin).toBe(toCssColor(d.Margin));
    expect(PCB_LAYER_COLORS['B.CrtYd']).toBe(toCssColor(d.B_CrtYd));
    expect(PCB_LAYER_COLORS['User.9']).toBe(toCssColor(d.User_9));
    // 32 copper + 18 technical + 9 user, the set the board editor paints.
    expect(Object.keys(PCB_LAYER_COLORS)).toHaveLength(59);
  });

  it('keeps the three painter overrides that are not the theme value', () => {
    // pcb_painter.cpp forces plated pad holes to the background, so they read
    // as real holes rather than the theme's 194,194,0.
    expect(PCB_SPECIAL.padPlatedHole).toBe(PCB_BACKGROUND);
    expect(PCB_SPECIAL.padPlatedHole).not.toBe(toCssColor(d.LAYER_PAD_PLATEDHOLES));
    // Pad hole walls borrow the via hole colour.
    expect(PCB_SPECIAL.padHoleWall).toBe(toCssColor(d.LAYER_VIA_HOLES));
    // RENDER_SETTINGS::update() overwrites LAYER_PAD_NETNAMES with the track
    // netnames colour, so the theme's 0.9 never reaches the screen.
    expect(PCB_SPECIAL.padName).toBe(toCssColor(d.NETNAMES_LAYER_ID_START));
    expect(PCB_SPECIAL.padName).toBe('rgba(255,255,255,0.7)');
    expect(PCB_SPECIAL.padName).not.toBe(toCssColor(d.LAYER_PAD_NETNAMES));
    // The via netnames layer gets no such override and does keep its 0.9.
    expect(PCB_SPECIAL.viaName).toBe('rgba(50,50,50,0.9)');
  });

  it('takes the rest of the special layers straight from the theme', () => {
    expect(PCB_SPECIAL.nonPlatedHole).toBe(toCssColor(d.LAYER_NON_PLATEDHOLES));
    expect(PCB_SPECIAL.viaHole).toBe(toCssColor(d.LAYER_VIA_HOLES));
    expect(PCB_SPECIAL.viaHoleWall).toBe(toCssColor(d.LAYER_VIA_HOLEWALLS));
    expect(PCB_SPECIAL.ratsnest).toBe('rgba(0,248,255,0.35)');
    expect(PCB_SPECIAL.drcError).toBe('rgba(215,91,107,0.8)');
    expect(PCB_SPECIAL.drcWarning).toBe('rgba(255,208,66,0.8)');
    expect(PCB_SPECIAL.drcExclusion).toBe('rgba(255,255,255,0.8)');
    expect(PCB_SPECIAL.drawingSheet).toBe('rgb(200,114,171)');
    // LAYER_PAGE_LIMITS, the board's own grey — not the schematic's lighter 181.
    expect(PCB_SPECIAL.pageLimits).toBe('rgb(132,132,132)');
    expect(PCB_SPECIAL.pageLimits).not.toBe(KICAD_DEFAULT.pageLimits);
  });

  it('draws the Objects swatches from the same layers as the canvas', () => {
    expect(PCB_OBJECT_COLORS.ratsnest).toBe(PCB_SPECIAL.ratsnest);
    expect(PCB_OBJECT_COLORS.drcErrors).toBe(PCB_SPECIAL.drcError);
    expect(PCB_OBJECT_COLORS.grid).toBe(PCB_GRID);
    expect(PCB_OBJECT_COLORS.lockedShadow).toBe(toCssColor(d.LAYER_LOCKED_ITEM_SHADOW));
    expect(PCB_OBJECT_COLORS.collidingCourtyards).toBe(toCssColor(d.LAYER_CONFLICTS_SHADOW));
    expect(PCB_OBJECT_COLORS.boardAreaShadow).toBe(toCssColor(d.LAYER_BOARD_OUTLINE_AREA));
    expect(PCB_OBJECT_COLORS.points).toBe(toCssColor(d.LAYER_POINTS));
  });
});

describe('pcbnew resolves to s_classicTheme', () => {
  const classic = themeByFilename('_builtin_classic');
  const c = BUILTIN_CLASSIC_THEME;

  it('is the second built-in and reads the classic map', () => {
    expect(PCB_THEMES[1]).toBe(classic);
    expect(classic.background).toBe(toCssColor(c.LAYER_PCB_BACKGROUND));
    expect(classic.grid).toBe(toCssColor(c.LAYER_GRID));
  });

  it('resolves its legacy colour names', () => {
    expect(classic.layerColors['F.Cu']).toBe('rgb(132,0,0)'); // RED
    expect(classic.layerColors['B.Cu']).toBe('rgb(0,132,0)'); // GREEN
    expect(classic.layerColors['In1.Cu']).toBe('rgb(194,194,0)'); // YELLOW
    expect(classic.layerColors['In30.Cu']).toBe('rgb(0,0,132)'); // BLUE
    expect(classic.special.drawingSheet).toBe('rgb(72,0,0)'); // DARKRED
    expect(classic.special.viaHoleWall).toBe('rgb(255,255,255)'); // WHITE
    // LAYER_VIA_HOLES is the one classic PCB entry written as raw floats.
    expect(classic.special.viaHole).toBe('rgba(128,102,0,0.8)'); // COLOR4D(.5,.4,0,.8)
  });

  it('covers every layer the default theme paints', () => {
    for (const name of Object.keys(PCB_LAYER_COLORS))
      expect(classic.layerColors[name], name).toBeDefined();
  });
});

describe('eeschema resolves to the schematic layers', () => {
  it('reads s_defaultTheme, spaced the way the renderer spells it', () => {
    expect(KICAD_DEFAULT.background).toBe(
      toCssColor(BUILTIN_DEFAULT_THEME.LAYER_SCHEMATIC_BACKGROUND, ', '),
    );
    expect(KICAD_DEFAULT.background).toBe('rgb(245, 244, 239)');
    expect(KICAD_DEFAULT.wire).toBe('rgb(0, 150, 0)');
    expect(KICAD_DEFAULT.bus).toBe('rgb(0, 0, 132)');
    expect(KICAD_DEFAULT.symbolOutline).toBe('rgb(132, 0, 0)');
    expect(KICAD_DEFAULT.symbolFill).toBe('rgb(255, 255, 194)');
    expect(KICAD_DEFAULT.pinNumber).toBe('rgb(169, 0, 0)');
    expect(KICAD_DEFAULT.hierLabel).toBe('rgb(114, 86, 0)');
    expect(KICAD_DEFAULT.ercError).toBe('rgba(230, 9, 13, 0.8)');
    expect(KICAD_DEFAULT.sheetBackground).toBe('rgba(255, 255, 255, 0)');
  });

  it('distinguishes the layers that merely happen to agree', () => {
    // pin / globalLabel / sheetBorder / pageFrame are all 132,0,0 in the
    // default theme and diverge in the classic one, which is what makes a
    // swapped pair invisible here and visible there.
    expect(KICAD_CLASSIC.sheetBorder).toBe('rgb(132, 0, 132)'); // MAGENTA
    expect(KICAD_CLASSIC.pageFrame).toBe('rgb(132, 0, 0)'); // RED
    expect(KICAD_CLASSIC.pinName).toBe('rgb(0, 132, 132)'); // CYAN
    expect(KICAD_CLASSIC.pinNumber).toBe('rgb(132, 0, 0)'); // RED
    expect(KICAD_CLASSIC.sheetFile).toBe('rgb(132, 132, 0)'); // BROWN
  });

  it('rounds COLOR4D(.4,.7,1.0,.8) the way ToColour does', () => {
    // .7 * 255 is 178.5, and ToColour adds 0.5 before truncating: 179.
    for (const theme of [KICAD_DEFAULT, KICAD_CLASSIC])
      expect(theme.selectionShadow).toBe('rgba(102, 179, 255, 0.8)');
  });

  it('carries the two values s_classicTheme was transcribed wrong for', () => {
    expect(KICAD_CLASSIC.ercExclusion).toBe('rgb(194, 194, 194)'); // LIGHTGRAY
    expect(KICAD_CLASSIC.ruleArea).toBe('rgb(132, 0, 0)'); // RED
  });

  it('falls back to the default theme for a layer classic never sets', () => {
    // s_classicTheme has no LAYER_SCHEMATIC_PAGE_LIMITS; upstream GetColor()
    // would return UNSPECIFIED (transparent) and KiCad Classic would draw no
    // page limits at all. We keep the visible fallback deliberately.
    expect('LAYER_SCHEMATIC_PAGE_LIMITS' in BUILTIN_CLASSIC_THEME).toBe(false);
    expect(KICAD_CLASSIC.pageLimits).toBe(KICAD_DEFAULT.pageLimits);
    expect(KICAD_CLASSIC.pageLimits).toBe('rgb(181, 181, 181)');
  });

  it('names one distinct layer per field it exposes', () => {
    // Every field is populated, and the set is neither padded nor shrunk.
    //
    // 42 since `gridAxes` was added for LAYER_SCHEMATIC_GRID_AXES. That is a
    // real layer of KiCad's own, not a field invented here: `SCH_BASE_FRAME`
    // hands it straight to the GAL —
    // `GetGAL()->SetAxesColor( colorSettings->GetColor( LAYER_SCHEMATIC_GRID_AXES ) )`
    // (`eeschema/sch_base_frame.cpp:612`) — and the Symbol Editor is the frame
    // that switches those axes on (`symbol_edit_frame.cpp:265`).
    //
    // 44 since `dnpMarker` and `excludedFromSim`, which are likewise KiCad's
    // own: `LAYER_DNP_MARKER` and `LAYER_EXCLUDED_FROM_SIM` are the colours
    // `SCH_PAINTER::draw( SCH_SYMBOL )` asks for at `sch_painter.cpp:2811` and
    // `:2839`, they are already in the shared builtin themes, and the Colors
    // page lists both (`common/layer_id.cpp:100-101`).
    //
    // 45 since `dragNetCollision`, LAYER_DRAG_NET_COLLISION, which
    // `SCH_DRAG_NET_COLLISION_MONITOR::Update` reads off the theme directly
    // (`sch_drag_net_collision.cpp:158-163`).
    const fields = Object.entries(KICAD_DEFAULT);
    expect(fields).toHaveLength(45);
    for (const [name, value] of fields) expect(value, name).toMatch(/^rgba?\(/);
  });

  /**
   * The new field, pinned by value rather than only counted — a count alone
   * would pass with `gridAxes` reading any other layer's colour.
   *
   * Both themes land on (0, 0, 132), by two different routes: the default
   * theme states it outright, and Classic says `legacy( 'BLUE' )`, which is the
   * SAME colour. KiCad's legacy palette entry is
   * `{ 132, 0, 0, BLUE, TS( "Blue 2" ), LIGHTBLUE }` (`common/gal/color4d.cpp:58`)
   * and that struct is B, G, R — so `BLUE` is rgb(0, 0, 132), not pure blue.
   * (Pure blue in that palette is LIGHTBLUE, the lighter variant named on the
   * same row.)
   */
  it('reads the axes colour from LAYER_SCHEMATIC_GRID_AXES', () => {
    expect(KICAD_DEFAULT.gridAxes).toBe('rgb(0, 0, 132)');
    expect(KICAD_CLASSIC.gridAxes).toBe('rgb(0, 0, 132)');
    // ...and it is not just the grid colour under another name, in either theme.
    expect(KICAD_DEFAULT.gridAxes).not.toBe(KICAD_DEFAULT.grid);
    expect(KICAD_CLASSIC.gridAxes).not.toBe(KICAD_CLASSIC.grid);
  });

  /**
   * The drag-collision colour, pinned the same way.
   *
   * The two themes disagree here, which is the point of pinning both: the
   * default theme states `CSS_COLOR( 230, 9, 13, 0.8 )` and Classic says
   * `COLOR4D( PURERED ).WithAlpha( 0.8 )` (`builtin_color_themes.h:54`, `:336`).
   * `PURERED` really is (255, 0, 0) — unlike `RED`, which that same B,G,R
   * struct makes (132, 0, 0).
   *
   * The alpha is load-bearing, not decoration: `Update` derives BOTH the fill
   * and the stroke alpha from it (`sch_drag_net_collision.cpp:167-171`), so a
   * theme colour read at alpha 1 would draw the markers a third more opaque
   * than KiCad does.
   */
  it('reads the drag-collision colour, alpha included, from LAYER_DRAG_NET_COLLISION', () => {
    expect(KICAD_DEFAULT.dragNetCollision).toBe('rgba(230, 9, 13, 0.8)');
    expect(KICAD_CLASSIC.dragNetCollision).toBe('rgba(255, 0, 0, 0.8)');
  });
});
