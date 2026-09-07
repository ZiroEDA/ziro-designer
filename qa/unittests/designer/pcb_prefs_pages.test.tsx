// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The three PCB Editor pages that were declared as gaps and are now shipped —
 * Origins & Axes, Editing Options and Colors — plus the shape of the heading
 * they complete.
 *
 * All three are a class the Footprint Editor's heading already draws, in its
 * board-editor variant: `PANEL_PCBNEW_DISPLAY_ORIGIN` with `FRAME_PCB_EDITOR`,
 * `PANEL_EDIT_OPTIONS` with `isFootprintEditor = false`, and
 * `PANEL_PCBNEW_COLOR_SETTINGS` against `PANEL_FP_EDITOR_COLOR_SETTINGS`. So
 * every test here is really about the *difference*: what the board editor's
 * variant has that the footprint editor's does not.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PreferencesDialog } from '@ziroeda/designer/src/dialogs/PreferencesDialog.js';
import { resetPrefsPanelCache } from '@ziroeda/designer/src/dialogs/prefs/lazy_pages.js';
import { shippedUnder } from '@ziroeda/designer/src/dialogs/prefs/registry.js';
import {
  PCBNEW_DEFAULTS,
  PCB_DISPLAY_DEFAULTS,
  PCB_EDITING_DEFAULTS,
  settings,
} from '@ziroeda/designer/src/prefs/settings.js';
import { resetPcbColors } from '@ziroeda/designer/src/editors/pcb/prefs/resets.js';
import { pcbColorRows } from '@ziroeda/designer/src/editors/pcb/pcbColorLayers.js';
import { fpColorRows } from '@ziroeda/designer/src/editors/footprint/fpColorLayers.js';
import { parse } from '@ziroeda/sexpr';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { DEFAULT_DRAW_OPTIONS as PCB_DEFAULT_DRAW_OPTIONS } from '@ziroeda/designer/src/editors/pcb/renderBoard.js';
import { pageSizeMM } from '@ziroeda/common';
import PREVIEW_BOARD_TEXT from '@ziroeda/designer/src/editors/pcb/data/color_preview_board.kicad_pcb?raw';
import { DISPLAY_ORIGIN_CHOICES } from '@ziroeda/designer/src/dialogs/prefs/PanelDisplayOrigin.js';
import {
  foldPcbToggle,
  isStoredPcbToggle,
  lineModeToggleId,
  pcbTogglesFromSettings,
} from '@ziroeda/designer/src/editors/pcb/toggles.js';

const SLOW = 60000;

/** The `board.*` keys that are GAL layers rather than board layers. */
const GAL_KEYS = new Set(
  pcbColorRows()
    .map((r) => r.key)
    .filter(
      (k) => !k.startsWith('board.copper.') && !/^board\.(f|b|in\d+)_|^board\.user_\d+$/.test(k),
    )
    .filter((k) =>
      [
        'board.anchor',
        'board.locked_shadow',
        'board.conflicts_shadow',
        'board.aux_items',
        'board.background',
        'board.cursor',
        'board.drc_error',
        'board.drc_warning',
        'board.drc_exclusion',
        'board.grid',
        'board.grid_axes',
        'board.plated_hole',
        'board.ratsnest',
        'board.via_hole',
        'board.via_hole_walls',
        'board.worksheet',
        'board.page_limits',
        'board.outline_area',
        'board.track_net_names',
        'board.pad_net_names',
        'board.via_net_names',
        'board.points',
      ].includes(k),
    ),
);

type PcbPage = 'pcb-origins' | 'pcb-editing' | 'pcb-colors';

/** Something only that page renders, to wait on. */
const ANCHOR: Record<PcbPage, string> = {
  'pcb-origins': 'Display Origin',
  'pcb-editing': 'Magnetic Points',
  'pcb-colors': 'Board outline area',
};

afterEach(() => {
  cleanup();
  resetPrefsPanelCache();
  settings.updatePcbnew((s) => {
    s.pcb_display = { ...PCB_DISPLAY_DEFAULTS };
    s.editing = { ...PCB_EDITING_DEFAULTS };
    s.appearance = { ...PCBNEW_DEFAULTS.appearance };
  });
  settings.setUserColors({});
});

async function openPage(id: PcbPage): Promise<void> {
  render(<PreferencesDialog onClose={() => {}} initialPage={id} />);
  await screen.findByText(ANCHOR[id], { exact: false }, { timeout: 30000 });
}

const panelText = (): string =>
  document.querySelector('.ze-prefs-panel')?.textContent?.replace(/\s+/g, ' ') ?? '';

describe('the heading is six of upstream’s seven rows', () => {
  it('ships everything but Plugins, in `ShowPreferences`’ order', () => {
    // `common/eda_base_frame.cpp:1681-1687`. Plugins is
    // `PANEL_PCBNEW_ACTION_PLUGINS`, a list of Python action plugins.
    expect(shippedUnder('PCB Editor')).toEqual([
      'Display Options',
      'Grids',
      'Origins & Axes',
      'Editing Options',
      'Colors',
      'Toolbars',
    ]);
  });
});

describe('PCB Editor > Origins & Axes', () => {
  it(
    'shows the Display Origin group the footprint editor’s page hides',
    async () => {
      await openPage('pcb-origins');
      const text = panelText();
      // `m_displayOrigin->Show( m_frameType == FRAME_PCB_EDITOR )` — the whole
      // of what this frame's variant is.
      for (const c of DISPLAY_ORIGIN_CHOICES) expect(text, c[1]).toContain(c[1]);
      expect(text).toContain('X Axis');
      expect(text).toContain('Y Axis');
    },
    SLOW,
  );

  it('maps the three radios onto PCB_DISPLAY_ORIGIN, page first', () => {
    // `pcbnew/pcbnew_settings.h:95-100`. The order is the enum's, and the
    // DEFAULT is PAGE — `loadSettings`' else-branch lands on drill/place, so a
    // table one row out would open every fresh install on the wrong button.
    expect(DISPLAY_ORIGIN_CHOICES.map((c) => c[0])).toEqual([0, 1, 2]);
    expect(DISPLAY_ORIGIN_CHOICES[0]?.[1]).toBe('Page origin');
    expect(PCB_DISPLAY_DEFAULTS.origin_mode).toBe(0);
  });

  it(
    'stores the axis flag, which the status bar reads',
    async () => {
      await openPage('pcb-origins');
      fireEvent.click(screen.getByLabelText('Increases left'));
      fireEvent.click(screen.getByText('OK'));
      expect(settings.pcbnew.pcb_display.origin_invert_x_axis).toBe(true);
    },
    SLOW,
  );
});

describe('PCB Editor > Editing Options', () => {
  it(
    'draws `m_sizerBoardEdit`, which is hidden in the footprint editor',
    async () => {
      await openPage('pcb-editing');
      const text = panelText();
      // `m_sizerBoardEdit->Show( !m_isFootprintEditor )`.
      expect(text).toContain('Track mouse-drag mode:');
      expect(text).toContain('Flip board items:');
      expect(text).toContain('Allow free pads');
      // …and the book's page 1 rather than its page 0.
      expect(text).toContain('Snap to pads:');
      expect(text).toContain('Snap to tracks and vias:');
      expect(text).toContain('Snap to graphics:');
      expect(text).toContain('Ratsnest');
      expect(text).toContain('Miscellaneous');
      // The two-checkbox form is the FOOTPRINT editor's page 0 and must not
      // appear here (`m_magneticPads->Show( m_isFootprintEditor )`).
      expect(text).not.toContain('Magnetic pads');
      expect(text).not.toContain('Magnetic graphics');
    },
    SLOW,
  );

  it(
    'gives the Ctrl mouse row a radio pair, not a static string',
    async () => {
      await openPage('pcb-editing');
      // `m_rbHighlightNet->Show( false )` is what makes it a string in the
      // footprint editor; here both buttons are live.
      expect(screen.getByLabelText('Toggle selection')).toBeTruthy();
      expect(screen.getByLabelText('Highlight net (for pads/tracks)')).toBeTruthy();
    },
    SLOW,
  );

  it(
    'stores the magnetic choices, which the cursor snap reads',
    async () => {
      await openPage('pcb-editing');
      // Three combos on the page offer "Never", so the option is picked out of
      // the one that was opened rather than off the whole document — and by
      // its `role="option"` row, not the `aria-hidden` ghost the popup uses to
      // measure itself.
      const pads = screen.getByLabelText('Snap to pads');
      fireEvent.click(pads);
      const never = Array.from(
        (pads.closest('.ze-pref-row') ?? document).querySelectorAll('[role="option"]'),
      ).find((o) => o.textContent === 'Never');
      expect(never, 'the Never row of the pads combo').toBeTruthy();
      // `Combo` commits on mousedown, not on click — see the popover-dismiss
      // note: a bubble-phase click would already have unmounted the list.
      fireEvent.mouseDown(never as Element);
      fireEvent.click(screen.getByText('OK'));
      expect(settings.pcbnew.editing.magnetic_pads).toBe(0);
    },
    SLOW,
  );

  it('ships `pcbnew_settings.cpp`’s own defaults, MAGNETIC included', () => {
    expect(PCB_EDITING_DEFAULTS).toEqual({
      pcb_angle_snap_mode: 0,
      rotation_angle: 900,
      arc_edit_mode: 0,
      // TRACK_DRAG_ACTION::DRAG, not MOVE — the first row of the choice is not
      // the default (`pcbnew_settings.cpp:179-181`).
      track_drag_action: 1,
      flip_left_right: true,
      allow_free_pads: false,
      // `m_AutoRefillZones` ships FALSE while the wxFormBuilder file checks the
      // box; reading `_base.cpp` alone gets this backwards.
      auto_fill_zones: false,
      // CAPTURE_CURSOR_IN_TRACK_TOOL, the MIDDLE value.
      magnetic_pads: 1,
      magnetic_tracks: 1,
      magnetic_graphics: true,
      esc_clears_net_highlight: true,
      show_courtyard_collisions: true,
      ctrl_click_highlight: false,
      polar_coords: false,
    });
  });
});

describe('PCB Editor > Colors', () => {
  it(
    'lists every board layer and the GAL rows, not the footprint editor’s three',
    async () => {
      await openPage('pcb-colors');
      const rows = pcbColorRows();
      // `LAYER_RANGE( F_Cu, B_Cu, MAX_CU_LAYERS )` then
      // `LSET::AllNonCuMask().TechAndUserUIOrder()` — 95 board layers, ahead of
      // the sorted GAL ones. The footprint editor's page emits three copper
      // rows and calls the middle one "Internal Layers".
      expect(rows.filter((r) => r.key.startsWith('board.copper.')).length).toBeGreaterThan(30);
      expect(rows.map((r) => r.name)).not.toContain('Internal Layers');
      expect(rows[0]?.name).toBe('F.Cu');
      expect(panelText()).toContain('F.Cu');
    },
    SLOW,
  );

  it('keeps the two via GAL rows the footprint editor’s page drops', () => {
    // `panel_fp_editor_color_settings.cpp:56-65`: a footprint has no via.
    const pcb = new Set(pcbColorRows().map((r) => r.key));
    const fp = new Set(fpColorRows().map((r) => r.key));
    for (const k of ['board.via_hole', 'board.via_hole_walls']) {
      expect(pcb.has(k), k).toBe(true);
      expect(fp.has(k), k).toBe(false);
    }
    // …and `LAYER_PAD_PLATEDHOLES` on NEITHER: it is in `g_excludedLayers`
    // (`panel_pcbnew_color_settings.cpp:674`) even though
    // `color_settings.cpp:135` binds `board.pad_plated_hole`. The key list and
    // the exclusion list are different questions.
    expect(pcb.has('board.pad_plated_hole')).toBe(false);
    expect(fp.has('board.pad_plated_hole')).toBe(false);
  });

  it('is 117 swatches — 95 board layers and 22 GAL rows', () => {
    // The count, stated, because "KiCad seems to have more colours than us" is
    // not a thing a screenshot can settle.
    //
    //   95 = LAYER_RANGE( F_Cu, B_Cu, MAX_CU_LAYERS ) = 32
    //      + LSET::AllNonCuMask().TechAndUserUIOrder() = 18 named + 45 User.n
    //   22 = the 23 `board.*` GAL keys `color_settings.cpp:124-146` binds,
    //        less `board.pad_plated_hole`, which `g_excludedLayers` skips.
    const rows = pcbColorRows();
    const board = rows.filter((r) => !GAL_KEYS.has(r.key));
    expect(board).toHaveLength(95);
    expect(rows.length - board.length).toBe(22);
    expect(rows).toHaveLength(117);
    // Every key is distinct: two rows sharing one would make a swatch write
    // over another layer's colour.
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
  });

  it('names a board layer by its DISPLAY name and keys it by the canonical one', () => {
    // `LayerName( F_SilkS )` is "F.Silkscreen" and `LSET::Name( F_SilkS )` is
    // "F.SilkS"; the key has to be the second or `pcbThemeWithOverrides` reads
    // back nothing. This is the pairing that is easy to write the wrong way
    // round and impossible to see in a screenshot.
    const silk = pcbColorRows().find((r) => r.key === 'board.f_silks');
    expect(silk, 'board.f_silks').toBeTruthy();
    expect(silk?.name).toBe('F.Silkscreen');
  });

  it(
    'draws the preview panel `m_previewPanelSizer` holds',
    async () => {
      await openPage('pcb-colors');
      // `m_preview = FOOTPRINT_PREVIEW_PANEL::New( … )` (`:781`) — the pane was
      // empty here, which is the half of this page a swatch cannot check.
      expect(document.querySelector('.ze-colorpreview canvas')).toBeTruthy();
    },
    SLOW,
  );

  it('draws the preview’s DRAWING SHEET, which needs the `User` page form', () => {
    // `createPreviewItems` builds a `DS_PROXY_VIEW_ITEM` over a
    // `PAGE_SIZE_TYPE::User` page of 6000 x 5000 mils (`:801-807`), so
    // LAYER_DRAWINGSHEET and LAYER_PAGE_LIMITS have something to colour.
    //
    // The PCB renderer's private paper table had no `User` branch — the
    // schematic's copy did — so the sheet and the page limits drew NOTHING.
    // `common/src/page_info.ts` is now the one table.
    expect(pageSizeMM('User 152.4 127')).toEqual({ w: 152.4, h: 127 });
    // 6000 x 5000 mils IS that page.
    expect(6000 * 0.0254).toBeCloseTo(152.4, 6);
    expect(5000 * 0.0254).toBeCloseTo(127, 6);
    // …and the named forms still work, portrait included.
    //
    // A4 is 297.0022 mm, not 297. `PAPER_MM` is derived from `PAPER_MILS`
    // (11693 x 8268 mils), which is `PAGE_INFO`'s own storage — KiCad holds a
    // page in MILS and converts, so 11693 x 0.0254 = 297.0022 is the number it
    // actually computes. The two private tables both said a clean 297, which
    // was the LESS faithful value; see the head of `common/src/page_info.ts`.
    const a4 = pageSizeMM('A4');
    expect(a4?.w).toBeCloseTo(297.0022, 4);
    expect(a4?.h).toBeCloseTo(210.0072, 4);
    const a4p = pageSizeMM('A4 portrait');
    expect(a4p?.w).toBeCloseTo(210.0072, 4);
    expect(a4p?.h).toBeCloseTo(297.0022, 4);
    expect(pageSizeMM('User 0 0')).toBeNull();
    expect(pageSizeMM(undefined)).toBeNull();
  });

  it(
    'lets the preview zoom and pan, as a FOOTPRINT_PREVIEW_PANEL does',
    async () => {
      await openPage('pcb-colors');
      const canvas = document.querySelector('.ze-colorpreview canvas');
      expect(canvas, 'the preview canvas').toBeTruthy();
      // `WX_VIEW_CONTROLS::onButton` binds the right button to PAN by default,
      // and `usePreviewViewControls`' `onContextMenu` swallows the menu for
      // exactly that reason — so a right-click on a canvas that HAS the
      // controls is defaultPrevented and one on a static image is not. This is
      // the observable half; the rest of the gesture set needs a real 2D
      // context to move a view, which happy-dom has none of.
      const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      (canvas as HTMLElement).dispatchEvent(ev);
      expect(ev.defaultPrevented, 'the right-drag gesture is bound').toBe(true);
    },
    SLOW,
  );

  it('binds the whole gesture set, through the SHARED hook', () => {
    // A source-text check, and honest about being one: React attaches its
    // synthetic listeners at the root, so an individual handler prop is not
    // visible on the element. `editor_default_toggles.test.ts` guards its
    // frames the same way and for the same reason.
    //
    // What it is really pinning is that the preview uses
    // `usePreviewViewControls` — the footprint chooser's — rather than a second
    // reading of `PANEL_MOUSE_SETTINGS` written for this one pane.
    const src = readFileSync(
      resolve(process.cwd(), '../designer/src/editors/pcb/prefs/PcbColorPreview.tsx'),
      'utf8',
    );
    expect(src).toContain('usePreviewViewControls(canvasRef, draw, undefined, viewRef)');
    for (const on of [
      'onWheel={viewCtl.handlers.onWheel}',
      'onPointerDown={viewCtl.handlers.onPointerDown}',
      'onPointerMove={viewCtl.handlers.onPointerMove}',
      'onPointerUp={viewCtl.handlers.onPointerUp}',
      'onContextMenu={viewCtl.handlers.onContextMenu}',
    ])
      expect(src, on).toContain(on);
  });

  it('fits the BOARD, and paints it at the painter’s own opacities', () => {
    const src = readFileSync(
      resolve(process.cwd(), '../designer/src/editors/pcb/prefs/PcbColorPreview.tsx'),
      'utf8',
    );
    // `BOX2I bBox = m_preview->GetBoard()->GetBoundingBox()` (`:872`) — the
    // BOARD's box. The sheet is drawn and deliberately not fitted: it is bigger
    // than the board, so fitting their union shrinks the part you came to look
    // at. [px] doing that made our preview 13% smaller than KiCad's at the same
    // pane size (board rects 467x317 against 529x360, the same aspect to 0.3%).
    expect(src).toContain('const bw = Math.max(1, b.maxX - b.minX);');
    expect(src).not.toContain('pageSizeMM(PREVIEW_SHEET.paper)');

    // `PCB_DISPLAY_OPTIONS`' constructor sets every opacity to 1.0
    // (`include/pcb_display_options.h:39-42`). `DEFAULT_DRAW_OPTIONS` carries
    // the BOARD EDITOR's `zoneOpacity: 0.6`, which is
    // `PROJECT_LOCAL_SETTINGS::m_ZoneOpacity` — the Appearance panel's Zones
    // slider. A preview panel has no project, so nothing overrides the
    // constructor and its zone fill is solid.
    expect(PCB_DEFAULT_DRAW_OPTIONS.zoneOpacity).toBe(0.6);
    expect(src).toContain('zoneOpacity: 1.0');
    expect(src).toContain('...PREVIEW_OPACITIES');

    // `draw( const FOOTPRINT* )`'s LAYER_ANCHOR cross is a SCREEN-space
    // per-frame pass, so it is never in a retained scene and every canvas has
    // to call it — `PcbEditor` and `FootprintCanvas` both do. This preview did
    // not, which is why KiCad's showed a magenta cross at each footprint origin
    // and ours showed none. `board.anchor` is a swatch on this very page.
    expect(src).toContain('drawAnchors(ctx, built.scene, view, layers, w, h, drawOpts');
    // …and it is the SHARED pass, not a cross drawn here.
    expect(src).toContain("from '../renderBoard.js'");
  });

  it('previews KiCad’s own `g_previewBoard`, through the central renderer', () => {
    // `data/color_preview_board.kicad_pcb` is `g_previewBoard`
    // (`panel_pcbnew_color_settings.cpp:41-687`) unescaped, and it goes through
    // `readBoard` + `buildScene` like any other board — no second painter.
    const board = readBoard(parse(PREVIEW_BOARD_TEXT));
    expect(board.footprints.length).toBe(8);
    expect(board.tracks.length).toBe(13);
    expect(board.vias.length).toBe(1);
    expect(board.zones.length).toBe(1);
    // It has to reach the layers this page colours, or the preview shows a
    // subset of the swatches and the comparison it exists for is worthless.
    const layers = new Set(board.layers.map((l) => l.name));
    for (const l of ['F.Cu', 'B.Cu', 'F.SilkS', 'F.Mask', 'Edge.Cuts', 'F.Fab'])
      expect(layers.has(l), l).toBe(true);
  });

  it('resets by dropping the board overrides, and only on a writable theme', () => {
    // `PANEL_COLOR_SETTINGS::ResetPanel` returns early on a read-only theme
    // (`panel_color_settings.cpp:74-75`).
    const ctx = {
      pcbnew: { appearance: { color_theme: '_builtin_default' } },
      setUserColors: (fn: (c: Record<string, string>) => Record<string, string>) => {
        colors = fn(colors);
      },
    };
    let colors: Record<string, string> = { 'board.f_cu': '#fff', 'schematic.wire': '#000' };
    resetPcbColors(ctx as never);
    expect(colors, 'a built-in theme is read-only').toEqual({
      'board.f_cu': '#fff',
      'schematic.wire': '#000',
    });

    ctx.pcbnew.appearance.color_theme = 'user';
    resetPcbColors(ctx as never);
    // The board half goes; the schematic keys sharing the file stay.
    expect(colors).toEqual({ 'schematic.wire': '#000' });
  });
});

describe('the left toolbar and Editing Options are one value', () => {
  it('boots Line mode and the curved ratsnest from the file', () => {
    const cfg = structuredClone(PCBNEW_DEFAULTS);
    expect(pcbTogglesFromSettings(cfg).has('lineModeFree')).toBe(true);
    expect(pcbTogglesFromSettings(cfg).has('ratsnestLineMode')).toBe(false);

    cfg.editing.pcb_angle_snap_mode = 1;
    cfg.pcb_display.ratsnest_curved = true;
    const t = pcbTogglesFromSettings(cfg);
    expect(t.has('lineMode45')).toBe(true);
    expect(t.has('lineModeFree')).toBe(false);
    expect(t.has('ratsnestLineMode')).toBe(true);
  });

  it('folds each of them back, and nothing that is not a PARAM upstream', () => {
    const cfg = structuredClone(PCBNEW_DEFAULTS);
    expect(foldPcbToggle(cfg, 'lineMode90')).toBe(true);
    expect(cfg.editing.pcb_angle_snap_mode).toBe(2);
    expect(foldPcbToggle(cfg, 'ratsnestLineMode')).toBe(true);
    expect(cfg.pcb_display.ratsnest_curved).toBe(true);
    expect(foldPcbToggle(cfg, 'togglePolarCoords')).toBe(true);
    expect(cfg.editing.polar_coords).toBe(true);

    const before = JSON.stringify(cfg);
    for (const id of ['zoneDisplayOutline', 'showLayersManager', 'showProperties', 'highContrast'])
      expect(foldPcbToggle(cfg, id), id).toBe(false);
    expect(JSON.stringify(cfg)).toBe(before);
    expect(isStoredPcbToggle('lineMode45')).toBe(true);
    expect(isStoredPcbToggle('zoneDisplayFilled')).toBe(false);
  });

  it('round-trips every LEADER_MODE through the button id', () => {
    for (const mode of [0, 1, 2] as const) {
      const cfg = structuredClone(PCBNEW_DEFAULTS);
      cfg.editing.pcb_angle_snap_mode = mode;
      expect(pcbTogglesFromSettings(cfg).has(lineModeToggleId(mode))).toBe(true);
    }
  });
});
