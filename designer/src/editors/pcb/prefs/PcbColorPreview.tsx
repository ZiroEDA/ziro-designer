// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_PCBNEW_COLOR_SETTINGS`' preview panel — `createPreviewItems()`
 * (`pcbnew/dialogs/panel_pcbnew_color_settings.cpp:799-834`) and
 * `updatePreview()` (`:850-864`).
 *
 * **Nothing here is a renderer.** Upstream's preview is a
 * `FOOTPRINT_PREVIEW_PANEL` — the same GAL, the same `PCB_PAINTER`, the same
 * `DS_PROXY_VIEW_ITEM` the board editor uses — pointed at a small board, and
 * `updatePreview` does one thing: `settings->LoadColors( m_currentSettings )`
 * then `view->UpdateAllItems( KIGFX::COLOR )`. So this is `buildScene` +
 * `drawBoard` + `drawDrawingSheet` from `editors/pcb/renderBoard.ts`, handed
 * the theme the swatches are editing. A second painter would be a second set of
 * colours to keep in step, which is the whole thing this page exists to check.
 *
 * **And the board is KiCad's own.** `g_previewBoard`
 * (`panel_pcbnew_color_settings.cpp:41-687`) is a `.kicad_pcb` written out as a
 * C string literal; `data/color_preview_board.kicad_pcb` is that text,
 * unescaped and otherwise byte for byte. Drawing a board of our own invention
 * here would be a preview of a different thing from the one KiCad shows, and
 * the point of the page is to compare.
 *
 * `m_page` is a `PAGE_SIZE_TYPE::User` sheet of 6000 x 5000 mils with the title
 * "Color Preview" and today's date (`:801-807`) — a drawing sheet rather than
 * the board's own `(paper "A4")`, so `LAYER_DRAWINGSHEET` and
 * `LAYER_PAGE_LIMITS` have something to colour.
 */
import { type JSX, useCallback, useEffect, useRef } from 'react';
import { parse } from '@ziroeda/sexpr';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import type { Board } from '@ziroeda/pcbnew/src/types.js';
import {
  buildScene,
  drawAnchors,
  drawBoard,
  pcbGridOptions,
  DEFAULT_DRAW_OPTIONS,
  type BoardScene,
} from '../renderBoard.js';
import { drawGrid } from '../../../ui/grid_cursor.js';
import {
  usePreviewViewControls,
  type PreviewView,
} from '../../../widgets/preview_view_controls.js';
import { PCB_BACKGROUND, type PcbColorTheme } from '../pcbTheme.js';
import PREVIEW_BOARD_TEXT from '../data/color_preview_board.kicad_pcb?raw';

/**
 * `m_page->SetWidthMils( 6000 )` / `SetHeightMils( 5000 )` and
 * `m_titleBlock->SetTitle( _( "Color Preview" ) )` (`:801-807`).
 *
 * A `PAGE_SIZE_TYPE::User` page, which is why it is stated as a size and not as
 * a paper name: "User" has no standard dimensions to look up.
 */
const PREVIEW_SHEET = {
  // [data] `SetWidthMils( 6000 )` / `SetHeightMils( 5000 )` — the `(paper …)`
  // spelling of the same page. `pageSizeMM` reads the `User` form; the PCB
  // renderer's own copy of that parser did not, which is why this drew nothing.
  paper: 'User 152.4 127',
  titleBlock: {
    title: 'Color Preview',
    // `SetDate( wxDateTime::Now().FormatDate() )` (`:804`) — today's, so the
    // title block has a date field to colour like a real sheet does.
    date: new Date().toISOString().slice(0, 10),
  },
  fileName: 'preview',
};

/**
 * `PCB_DISPLAY_OPTIONS`' OWN opacities, which are all 1.0
 * (`include/pcb_display_options.h:39-42`).
 *
 * `DEFAULT_DRAW_OPTIONS` carries the BOARD EDITOR's, and its
 * `zoneOpacity: 0.6` is right there — the board editor pushes
 * `PROJECT_LOCAL_SETTINGS::m_ZoneOpacity` (`project_local_settings.cpp:46`,
 * default 0.6) into the painter, and that is what the Appearance panel's Zones
 * slider moves. A `FOOTPRINT_PREVIEW_PANEL` has **no project**, so nothing
 * overrides the constructor and its zone fill is solid.
 *
 * [px] measured on the two previews side by side: KiCad's GND zone is the F.Cu
 * red at full strength and ours was a dark maroon, which is 0.6 of it.
 */
const PREVIEW_OPACITIES = {
  trackOpacity: 1.0,
  viaOpacity: 1.0,
  padOpacity: 1.0,
  zoneOpacity: 1.0,
  filledShapeOpacity: 1.0,
  /**
   * `LAYER_BOARD_OUTLINE_AREA`, ON here and OFF in the board editor.
   *
   * `LSET::VisibleGALLayers()` is the set a BOARD opens with and this layer is
   * commented out of it — "currently hidden by default" (`common/lset.cpp:825`).
   * That set comes from the project, and a preview panel has none: it takes
   * `PCB_DRAW_PANEL_GAL`'s own layer list, which does carry it
   * (`pcb_draw_panel_gal.cpp:397`).
   *
   * [px] this is the difference Akshay saw as "the kicad board has poured": the
   * inside of Edge.Cuts measures rgb(35,45,58) on KiCad's preview and
   * rgb(0,16,35) — the bare background — on ours. 0.35 x 100 over (0,16,35) is
   * (35, 45.4, 57.75), which is that colour exactly.
   */
  boardOutlineArea: true,
} as const;

/**
 * The parse is done ONCE for the life of the module: the text is a 32 kB
 * constant and the panel re-renders on every swatch click.
 */
let cached: { board: Board; scene: BoardScene } | null = null;

function previewScene(): { board: Board; scene: BoardScene } | null {
  if (cached) return cached;

  try {
    const board = readBoard(parse(PREVIEW_BOARD_TEXT));
    // The preview board carries no design rules, so `GetOwnClearance` answers 0
    // and `draw( const PAD* )` skips the clearance outline — the same reason
    // `FootprintPreviewWidget` passes this.
    cached = { board, scene: buildScene(board, { clearanceForNet: () => 0 }) };
  } catch {
    // `catch( const IO_ERROR& ) { return; }` (`:816-819`) — a preview that
    // cannot be parsed leaves the pane empty rather than taking the page down.
    cached = null;
  }

  return cached;
}

export function PcbColorPreview({ theme }: { theme: PcbColorTheme }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const themeRef = useRef(theme);
  themeRef.current = theme;
  /**
   * `FOOTPRINT_PREVIEW_PANEL` is a real GAL canvas with a `WX_VIEW_CONTROLS` on
   * it — the preview scrolls to zoom and drags to pan like any other KiCad
   * view. This is the same hook the footprint chooser's preview uses, so the
   * gestures and the zoom controller are the shared ones and not a second
   * reading of `PANEL_MOUSE_SETTINGS`.
   *
   * `null` means "no view yet", which is the refit signal: `zoomFitPreview()`
   * runs on construction and on a resize, and NOT on a colour change — so a
   * user who has zoomed in keeps their view while the swatches move.
   */
  const viewRef = useRef<PreviewView | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const built = previewScene();
    if (!canvas || !built) return;

    const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
    // The canvas fills its wrapper, so the wrapper is what has a size before
    // the first paint — a canvas with no CSS size reports the 300x150 default.
    const box = canvas.parentElement;
    const w = Math.max(1, Math.round((box?.clientWidth ?? canvas.clientWidth) * dpr));
    const h = Math.max(1, Math.round((box?.clientHeight ?? canvas.clientHeight) * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const t = themeRef.current;
    // `m_preview->GetGAL()->SetClearColor( settings->GetBackgroundColor() )`
    // (`:859`) — the background is a swatch on this page like any other, so it
    // has to come from the theme and not from the constant.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = t.background || PCB_BACKGROUND;
    ctx.fillRect(0, 0, w, h);

    // `zoomFitPreview()` (`:867-890`): `SetViewport( bBox )` over the board's
    // bounding box, then the panel's own margin. It runs once — after that the
    // view belongs to the user, which is what `viewRef` holds.
    const b = built.scene.bbox;
    // `if( bBox.GetWidth() == 0 || bBox.GetHeight() == 0 ) bBox = defaultBox`
    // (`:878-879`) — a board that measured nothing gets the panel's own box.
    if (!b) return;
    // The BOARD's box, not the sheet's:
    //
    //     BOX2I bBox = m_preview->GetBoard()->GetBoundingBox();   (`:872`)
    //
    // The sheet is drawn and is deliberately NOT fitted — it is bigger than the
    // board, so including it shrinks the part you came to look at. Fitting
    // their union made the preview 13 % smaller than KiCad's at the same pane
    // size, which is the whole of the difference Akshay measured.
    const bw = Math.max(1, b.maxX - b.minX);
    const bh = Math.max(1, b.maxY - b.minY);
    const fitScale = Math.min(w / bw, h / bh) * 0.9;
    const view =
      viewRef.current ??
      ({
        scale: fitScale,
        tx: w / 2 - ((b.minX + b.maxX) / 2) * fitScale,
        ty: h / 2 - ((b.minY + b.maxY) / 2) * fitScale,
      } satisfies PreviewView);
    viewRef.current = view;

    drawGrid(ctx, view, w, h, pcbGridOptions({ show: true, color: t.grid, devicePixelRatio: dpr }));
    // Every layer the preview board declares. `m_preview->GetBoard()
    // ->SetBoardUse( BOARD_USE::NORMAL )` (`:823`) is what makes it draw "like
    // in board editor" rather than as a footprint holder.
    const layers = new Set(built.board.layers.map((l) => l.name));
    const drawOpts = { ...DEFAULT_DRAW_OPTIONS, ...PREVIEW_OPACITIES, theme: t };
    drawBoard(ctx, built.scene, view, layers, w, h, drawOpts, PREVIEW_SHEET);
    // `draw( const FOOTPRINT* )`'s LAYER_ANCHOR cross. It is a SCREEN-space
    // per-frame pass — "size and width constant, not related to the scale" —
    // so it is never part of a retained scene and every canvas has to call it.
    // `PcbEditor` and `FootprintCanvas` both do; this preview did not, which is
    // why KiCad's showed a magenta cross at each footprint origin and ours
    // showed nothing. `board.anchor` is one of the swatches on this very page.
    drawAnchors(ctx, built.scene, view, layers, w, h, drawOpts, 'none', dpr);
  }, []);

  const viewCtl = usePreviewViewControls(canvasRef, draw, undefined, viewRef);

  useEffect(() => {
    draw();
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === 'undefined') return;
    // `onSize` refits, as the footprint preview's does; a colour change does
    // not, so a zoomed-in user keeps their view.
    const observer = new ResizeObserver(() => {
      viewRef.current = null;
      draw();
    });
    observer.observe(canvas.parentElement ?? canvas);
    return () => observer.disconnect();
    // `updatePreview()` runs on every colour change and on every theme change
    // (`onColorChanged`, `onNewThemeSelected`, `ResetPanel`), which is what the
    // theme dependency is.
  }, [draw, theme]);

  // `.ze-colorpreview` is `m_colorsMainSizer->Add( m_preview, 1, wxTOP|wxEXPAND,
  // 1 )` — the same wrapper the schematic's preview uses, because it is the
  // same Add() on the same shared panel.
  return (
    <div className="ze-colorpreview">
      <canvas
        ref={canvasRef}
        onWheel={viewCtl.handlers.onWheel}
        onPointerDown={viewCtl.handlers.onPointerDown}
        onPointerMove={viewCtl.handlers.onPointerMove}
        onPointerUp={viewCtl.handlers.onPointerUp}
        onPointerCancel={viewCtl.handlers.onPointerUp}
        onContextMenu={viewCtl.handlers.onContextMenu}
      />
    </div>
  );
}
