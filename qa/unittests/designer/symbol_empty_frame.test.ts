// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What a SYMBOL_EDIT_FRAME looks like with no symbol loaded.
 *
 * Every expectation here came from putting a real KiCad 10.0.5 Symbol Editor
 * next to ours on the same screen, both empty, and then reading the C++ for
 * whatever differed — not from re-baselining ours to whatever it printed.
 *
 * The four things pinned:
 *
 *   1. the frame opens in MILS, not mm  (`app_settings.cpp:228-238`)
 *   2. the world origin is the GAL's AXES, not an anchor cross
 *                                        (`symbol_edit_frame.cpp:265`)
 *   3. PANEL_SCH_SELECTION_FILTER exists, laid out for this frame
 *                                        (`panel_sch_selection_filter.cpp:70-88`)
 *   4. both toolbar combos are LISTBOX_WIDTH wide
 *                                        (`toolbars_symbol_editor.cpp:43-47`)
 */
import { describe, expect, it } from 'vitest';
import {
  defaultUnits,
  defaultUnitsToggle,
  type AppSettingsName,
} from '@ziroeda/designer/src/ui/app_settings_units.js';
import {
  selectionFilterGrid,
  setAllSelectionFilterCategories,
  symSelectionFilterShown,
} from '@ziroeda/designer/src/ui/selection_filter_panel.js';
import { LISTBOX_WIDTH } from '@ziroeda/designer/src/editors/symbol/symbolToolbars.js';
import {
  applyToggle,
  DEFAULT_TOGGLES,
  RADIO_GROUPS,
  syncPinEditOnLoad,
} from '@ziroeda/designer/src/editors/symbol/toggles.js';
import {
  renderSymbolScene,
  type SymbolViewOptions,
} from '@ziroeda/designer/src/editors/symbol/render/symbolRenderer.js';
import { KICAD_DEFAULT } from '@ziroeda/designer/src/editors/schematic/theme.js';
import {
  defaultSelectionFilter,
  selectionFilterAll,
} from '@ziroeda/eeschema/src/tools/sch_selection_filter.js';

// ---------------------------------------------------------------------------
// 1. system.units
// ---------------------------------------------------------------------------

describe("system.units' per-app default (app_settings.cpp:228-238)", () => {
  /**
   * The branch is `pl_editor || eeschema || symbol_editor -> MILS`, everything
   * else MM. Spelled out per app rather than by calling the function twice,
   * so a mutant that flips the condition cannot compute the expectation.
   */
  it('puts exactly three apps on the imperial side', () => {
    const table: Record<AppSettingsName, 'mm' | 'mils'> = {
      pl_editor: 'mils',
      eeschema: 'mils',
      symbol_editor: 'mils',
      pcbnew: 'mm',
      fpedit: 'mm',
      gerbview: 'mm',
      bitmap2component: 'mm',
      pcb_calculator: 'mm',
    };
    for (const [app, units] of Object.entries(table))
      expect(defaultUnits(app as AppSettingsName)).toBe(units);
  });

  /**
   * The Symbol Editor specifically. It booted in mm — the branch's OTHER arm —
   * which is why an empty frame read `grid 1.27` / `mm` where a real one reads
   * `grid 50` / `mils`.
   */
  it('opens the Symbol Editor in mils', () => {
    expect(defaultUnits('symbol_editor')).toBe('mils');
    expect(defaultUnitsToggle('symbol_editor')).toBe('unitsMils');
  });

  it('opens pcbnew in mm, so the two arms really do differ', () => {
    expect(defaultUnits('pcbnew')).toBe('mm');
    expect(defaultUnitsToggle('pcbnew')).toBe('unitsMm');
  });
});

describe("SYMBOL_EDIT_FRAME's opening toggle state", () => {
  /**
   * The set the frame actually boots with — not just what the shared branch
   * returns. It used to live inside `SymbolEditor.tsx`, where `qa`'s tsconfig
   * (`.ts` only) could not reach it, which is how `'unitsMm'` survived here.
   *
   * Whole-set and in one expectation, because "contains unitsMils" would pass
   * with `unitsMm` still in the set beside it.
   */
  it('is the five buttons upstream leaves on, with mils among them', () => {
    expect([...DEFAULT_TOGGLES].sort()).toEqual([
      'crosshairSmall',
      'showLibraryTree',
      'showProperties',
      'toggleGrid',
      'unitsMils',
    ]);
  });

  /**
   * `toggleSyncedPinsMode` is NOT in that set, and this is the re-derivation
   * rather than a re-baseline: `SYMBOL_EDIT_FRAME`'s constructor writes
   * `m_SyncPinEdit = false;` (`symbol_edit_frame.cpp:128`) and nothing puts it
   * back until a symbol is loaded (:968). It sat in `DEFAULT_TOGGLES`, which
   * painted the Synchronized Pins button lit — and lit *while disabled*, since
   * `multiUnitModeCond` (:609-613) is false with no symbol. A captured KiCad
   * cold frame shows that button flat: measured, its cell background is the
   * toolbar face rgb(55,55,55), where ours was the checked fill rgb(68,48,41).
   */
  it('does not light Synchronized Pins mode on a cold frame', () => {
    expect(DEFAULT_TOGGLES.has('toggleSyncedPinsMode')).toBe(false);
    expect(syncPinEditOnLoad(null)).toBe(false);
  });

  /** Exactly one member of each radio group is on at boot. */
  it('starts with one member of each cycling group', () => {
    for (const group of RADIO_GROUPS)
      expect(group.filter((id) => DEFAULT_TOGGLES.has(id))).toHaveLength(1);
  });

  /**
   * `applyToggle`: a group member REPLACES its group, anything else flips.
   * Picking inches must therefore take mils back off, or the status bar has two
   * units in force at once.
   */
  it('replaces the units group rather than adding to it', () => {
    const inches = applyToggle(DEFAULT_TOGGLES, 'unitsInches');
    expect(inches.has('unitsInches')).toBe(true);
    expect(inches.has('unitsMils')).toBe(false);
    expect(inches.has('unitsMm')).toBe(false);
    // Re-activating the member already on leaves it on.
    expect(applyToggle(inches, 'unitsInches').has('unitsInches')).toBe(true);
    // A non-group id flips.
    expect(applyToggle(DEFAULT_TOGGLES, 'toggleGrid').has('toggleGrid')).toBe(false);
    expect(applyToggle(DEFAULT_TOGGLES, 'showHiddenPins').has('showHiddenPins')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. the origin: GAL axes, not an anchor cross
// ---------------------------------------------------------------------------

/** Every stroked segment `renderSymbolScene` lays down, with its colour. */
interface Seg {
  color: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
}

/**
 * A recording 2D context. Only the calls the scene makes on an empty frame are
 * implemented; `Path2D` is stubbed the way `pcb_grid_origin.test.ts` stubs it,
 * because the grid painter builds its lattice as a retained path.
 */
function paintEmptyScene(showGrid = true, canvas = { w: 400, h: 300 }): Seg[] {
  const segs: Seg[] = [];
  let cur = { x: 0, y: 0 };
  let pending: Seg[] = [];
  let strokeStyle = '';
  const ctx = {
    get strokeStyle() {
      return strokeStyle;
    },
    set strokeStyle(v: string) {
      strokeStyle = v;
    },
    setTransform: () => {},
    translate: () => {},
    save: () => {},
    restore: () => {},
    beginPath: () => {
      pending = [];
    },
    moveTo: (x: number, y: number) => {
      cur = { x, y };
    },
    lineTo: (x: number, y: number) => {
      pending.push({ color: strokeStyle, from: cur, to: { x, y } });
      cur = { x, y };
    },
    stroke: () => {
      segs.push(...pending);
      pending = [];
    },
    fill: () => {},
    fillRect: () => {},
    setLineDash: () => {},
    fillStyle: '',
    lineWidth: 0,
    lineCap: '',
    lineJoin: '',
  } as unknown as CanvasRenderingContext2D;

  const realPath2D = globalThis.Path2D;
  (globalThis as { Path2D?: unknown }).Path2D = class {
    rect(): void {}
    moveTo(): void {}
    lineTo(): void {}
  };
  const opts: SymbolViewOptions = {
    unit: 1,
    bodyStyle: 1,
    showPinElectricalTypes: false,
    showHiddenPins: false,
    showHiddenFields: false,
    showGrid,
    devicePixelRatio: 1,
  };
  try {
    // The world origin sits at device (120, 90) — deliberately NOT the canvas
    // centre, so an axis drawn at the middle of the canvas would fail.
    renderSymbolScene(
      ctx,
      null,
      { scale: 0.002, offsetX: 120, offsetY: 90 },
      KICAD_DEFAULT,
      canvas.w,
      canvas.h,
      opts,
    );
  } finally {
    (globalThis as { Path2D?: unknown }).Path2D = realPath2D;
  }
  return segs;
}

describe('the world origin on an empty canvas', () => {
  /**
   * `GetCanvas()->GetGAL()->SetAxesEnabled( true )` (symbol_edit_frame.cpp:265)
   * and `DrawLine( { worldStart.x, 0 }, { worldEnd.x, 0 } )` /
   * `DrawLine( { 0, worldStart.y }, { 0, worldEnd.y } )` (opengl_gal.cpp:1926-1927)
   * — two lines spanning the WHOLE viewport, in
   * `LAYER_SCHEMATIC_GRID_AXES` (sch_base_frame.cpp:612).
   */
  it('draws two full-viewport axes in LAYER_SCHEMATIC_GRID_AXES', () => {
    const axes = paintEmptyScene().filter((s) => s.color === KICAD_DEFAULT.gridAxes);
    expect(axes).toHaveLength(2);

    const horizontal = axes.find((s) => s.from.y === s.to.y);
    const vertical = axes.find((s) => s.from.x === s.to.x);
    // Spans the full canvas width, at the origin's device Y.
    expect(horizontal).toEqual({
      color: KICAD_DEFAULT.gridAxes,
      from: { x: 0, y: 90 },
      to: { x: 400, y: 90 },
    });
    // Spans the full canvas height, at the origin's device X.
    expect(vertical).toEqual({
      color: KICAD_DEFAULT.gridAxes,
      from: { x: 120, y: 0 },
      to: { x: 120, y: 300 },
    });
  });

  /**
   * The colour is the theme's, not blue-by-name: KiCad Default's
   * LAYER_SCHEMATIC_GRID_AXES is (0, 0, 132) and the Classic theme's is the
   * legacy BLUE. Re-derived from `builtin_color_themes.ts:65`, which is the
   * mechanical port of `builtin_color_themes.h`.
   */
  it('uses the Default theme colour rgb(0, 0, 132)', () => {
    expect(KICAD_DEFAULT.gridAxes).toBe('rgb(0, 0, 132)');
  });

  /**
   * What used to be here: a short cross in LAYER_SCHEMATIC_ANCHOR at the world
   * origin, in the shape of `SCH_PAINTER::drawAnchor` (sch_painter.cpp:1688).
   * Upstream calls that only for a SELECTED field or a MOVING item, never as a
   * standing mark, so an empty frame must not paint the anchor colour at all.
   */
  it('paints nothing in LAYER_SCHEMATIC_ANCHOR', () => {
    expect(paintEmptyScene().filter((s) => s.color === KICAD_DEFAULT.anchor)).toEqual([]);
  });

  /**
   * "Draw axes if desired" runs BEFORE the grid-visibility test upstream
   * (opengl_gal.cpp:1920-1928 sits above `if( !m_gridVisibility ) return`), so
   * turning the grid off must not take the axes with it. This is the same
   * canvas, so the two axes are still at the same places.
   */
  it('survives the grid being turned off', () => {
    const axes = paintEmptyScene(false).filter((s) => s.color === KICAD_DEFAULT.gridAxes);
    expect(axes).toHaveLength(2);
    expect(axes.map((s) => `${s.from.x},${s.from.y} -> ${s.to.x},${s.to.y}`).sort()).toEqual([
      '0,90 -> 400,90',
      '120,0 -> 120,300',
    ]);
  });
});

// ---------------------------------------------------------------------------
// 3. PANEL_SCH_SELECTION_FILTER
// ---------------------------------------------------------------------------

/** `Row > [a | b]`, so a row's SHAPE is part of the expectation. */
const grid = (frame: 'FRAME_SCH' | 'FRAME_SCH_SYMBOL_EDITOR'): string[] =>
  selectionFilterGrid(frame).map((row) => row.map((c) => c?.label ?? '').join(' | '));

describe('PANEL_SCH_SELECTION_FILTER', () => {
  /**
   * `panel_sch_selection_filter_base.cpp:14-66`, by `wxGBPosition`:
   *   (0,0) All items     (0,1) Rule Areas
   *   (1,0) Symbols       (1,1) Pins
   *   (2,0) Wires         (2,1) Labels
   *   (3,0) Graphics      (3,1) Images
   *   (4,0) Text          (4,1) Other items
   *
   * Per-row and in order, because a count or a set would pass with every pair
   * transposed — which is exactly how ours had drifted.
   */
  it('lays the schematic editor out in upstream row order', () => {
    expect(grid('FRAME_SCH')).toEqual([
      'All items | Rule Areas',
      'Symbols | Pins',
      'Wires | Labels',
      'Graphics | Images',
      'Text | Other items',
    ]);
  });

  /**
   * `panel_sch_selection_filter.cpp:70-88`: for FRAME_SCH_SYMBOL_EDITOR,
   * Symbols/Wires/Labels/Images are parked at rows 6-7 and hidden, Rule Areas
   * is hidden in place at (0,1), and Pins/Text/Graphics/Other items are moved
   * up to (1,0)/(1,1)/(2,0)/(2,1).
   */
  it('lays the symbol editor out with four boxes on two rows', () => {
    expect(grid('FRAME_SCH_SYMBOL_EDITOR')).toEqual([
      // (0,1) is Rule Areas hidden IN PLACE, so the slot stays empty rather
      // than "All items" gaining a partner.
      'All items | ',
      'Pins | Text',
      'Graphics | Other items',
    ]);
  });

  /**
   * `m_cbLockedItems->Hide()` (base :28), never re-shown in either frame — it
   * is reachable only through the right-click "Only %s" menu. Ours rendered it
   * as a visible schematic row.
   */
  it('shows no "Locked items" row in either frame', () => {
    for (const frame of ['FRAME_SCH', 'FRAME_SCH_SYMBOL_EDITOR'] as const)
      expect(grid(frame).join('\n')).not.toContain('Locked items');
  });

  /** `m_cbGraphics->SetToolTip( _( "Graphical shapes" ) )` (base :51). */
  it('keeps the Graphics tooltip upstream sets', () => {
    const graphics = selectionFilterGrid('FRAME_SCH_SYMBOL_EDITOR')
      .flat()
      .find((c) => c?.label === 'Graphics');
    expect(graphics?.tooltip).toBe('Graphical shapes');
  });

  /**
   * `OnFilterChanged` (`panel_sch_selection_filter.cpp:139-152`) calls
   * `SetValue( newState )` on nine boxes and NOT on `m_cbLockedItems`.
   */
  it('"All items" sets the nine categories and leaves lockedItems alone', () => {
    const off = setAllSelectionFilterCategories(
      { ...defaultSelectionFilter(), lockedItems: true },
      false,
    );
    expect(off.lockedItems).toBe(true);
    expect(selectionFilterAll(off)).toBe(false);
    expect(off).toEqual({
      lockedItems: true,
      symbols: false,
      text: false,
      wires: false,
      labels: false,
      pins: false,
      graphics: false,
      images: false,
      ruleAreas: false,
      otherItems: false,
    });

    const on = setAllSelectionFilterCategories({ ...off, lockedItems: false }, true);
    expect(selectionFilterAll(on)).toBe(true);
    expect(on.lockedItems).toBe(false);
  });

  /**
   * `SYMBOL_EDIT_FRAME::updateSelectionFilterVisbility` (:2249-2261):
   * "Don't give the selection filter its own visibility controls; instead show
   * it if anything else is visible" — the tree OR the properties pane.
   */
  it('follows the tree and the properties pane, with no toggle of its own', () => {
    expect(symSelectionFilterShown({ libraryTree: true, properties: true })).toBe(true);
    expect(symSelectionFilterShown({ libraryTree: true, properties: false })).toBe(true);
    expect(symSelectionFilterShown({ libraryTree: false, properties: true })).toBe(true);
    expect(symSelectionFilterShown({ libraryTree: false, properties: false })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. LISTBOX_WIDTH
// ---------------------------------------------------------------------------

describe('the two AppendControl combos', () => {
  /**
   * `#ifdef __UNIX__ #define LISTBOX_WIDTH 140` (toolbars_symbol_editor.cpp:43-47),
   * passed as `wxSize( LISTBOX_WIDTH, -1 )` to both wxComboBoxes (:170, :184).
   * 120 is the non-UNIX arm; this is the Linux build.
   */
  it('is 140 wide, the __UNIX__ arm', () => {
    expect(LISTBOX_WIDTH).toBe(140);
  });
});
