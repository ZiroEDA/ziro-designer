// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * GerbView draws a drawing sheet, from the same description every other
 * launcher uses.
 *
 * `GERBVIEW_FRAME::SetPageSettings` (gerbview/gerbview_frame.cpp:878-902) builds
 * a `DS_PROXY_VIEW_ITEM` exactly as `eeschema/sch_view.cpp:117` and
 * `pcbnew/pcb_draw_panel_gal.cpp:472` do, and that item's `ViewDraw` constructs a
 * `DS_PAINTER` over `common/drawing_sheet/`. GerbView is not a special case.
 *
 * Ours had the layer-manager row, the colour and the toggle — and nothing that
 * rendered. `grep hideDrawingSheet` returned exactly the two lines that defined
 * it. So the toggle was inert, and the row was a control that did nothing.
 *
 * The gap that let it ship: a data-only test cannot see rendering. The layer
 * manager's own suite passes with or without a painter behind it, which is why
 * the assertions here are about the laid-out geometry and about the canvas
 * calling into it.
 */
import { describe, it, expect } from 'vitest';
import { defaultDrawingSheet, layoutDrawingSheet, PAPER_MM } from '@ziroeda/common';
import { IU_PER_MM } from '@ziroeda/gerbview';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  gerberDrawingSheetItems,
  drawGerberPageLimits,
} from '@ziroeda/designer/src/editors/gerbview/gerberRender.js';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/** Source with comments blanked — prose must not read as code. */
const strip = (s: string): string =>
  s
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

const CANVAS = strip(read('../../../designer/src/editors/gerbview/GerberCanvas.tsx'));
const VIEWER = strip(read('../../../designer/src/editors/gerbview/GerberViewer.tsx'));

describe('the GerbView drawing sheet', () => {
  it('is a real drawing, not an empty list', () => {
    // The default sheet is a frame, the ruler bands and a title block.
    expect(gerberDrawingSheetItems().length).toBeGreaterThan(20);
  });

  it('is laid out on PAGE_SIZE_TYPE::GERBER, 32000 x 32000 mils', () => {
    // page_info.cpp:61 — VECTOR2D( 32000, 32000 ), set at gerbview_frame.cpp:134.
    // 32000 mils is 812.8 mm, and the sheet's frame runs to the page edge less
    // its 10 mm margins, so the far corner must land past 800 mm.
    expect(PAPER_MM.GERBER).toEqual([812.8, 812.8]);
    // Every arm of the DsDrawItem union, so the widest point is the real one
    // rather than whichever kinds happened to narrow.
    const xs = gerberDrawingSheetItems().flatMap((i) => {
      switch (i.kind) {
        case 'line':
        case 'rect':
          return [i.a.x, i.b.x];
        case 'poly':
          return i.pts.map((p) => p.x);
        default:
          return [i.at.x];
      }
    });
    const maxX = Math.max(...xs);
    // Laid out in schematic IU (1e4/mm), which is what the shared engine emits.
    expect(maxX / 1e4).toBeGreaterThan(800);
    expect(maxX / 1e4).toBeLessThanOrEqual(812.8);
  });

  it('resolves ${PAPER} to the page type name', () => {
    // DS_DRAW_ITEM_LIST takes it from aPageInfo.GetTypeAsString()
    // (ds_draw_item.cpp:552), which for PAGE_SIZE_TYPE::GERBER is "GERBER".
    const texts = gerberDrawingSheetItems()
      .map((i) => (i as { text?: string }).text)
      .filter((t): t is string => typeof t === 'string');
    // The default sheet carries it as `Size: ${PAPER}`
    // (drawing_sheet_default_description.cpp; ours at default-sheet.ts:158), so
    // the resolved text is one string, not a bare token.
    expect(texts).toContain('Size: GERBER');
  });

  it('passes exactly the context GERBVIEW_FRAME does', () => {
    // The differential test, and the one that pins every field at once.
    //
    // `SetPageSettings` (gerbview_frame.cpp:886-899) constructs the proxy item
    // with `&GetTitleBlock()` — which nothing in gerbview/ ever populates — and
    // sets only the page number and the sheet count. It never calls
    // SetFileName / SetSheetName / SetSheetPath either. So the context is this
    // and nothing else, written out here from the C++ rather than read back out
    // of the adapter.
    const expected = layoutDrawingSheet(
      defaultDrawingSheet(),
      { widthMM: 812.8, heightMM: 812.8 },
      {
        pageNumber: 1,
        sheetCount: 1,
        title: '',
        rev: '',
        date: '',
        company: '',
        comments: ['', '', '', ''],
        paper: 'GERBER',
        fileName: '',
        sheetPath: '',
        appVersion: 'ZiroEDA',
      },
    );
    const textsOf = (items: readonly unknown[]): string[] =>
      items
        .map((i) => (i as { text?: string }).text)
        .filter((t): t is string => typeof t === 'string');

    expect(textsOf(gerberDrawingSheetItems())).toEqual(textsOf(expected));
  });

  it('leaves the title block blank, because GerbView never fills one', () => {
    // GetTitleBlock() returns m_gerberLayout->GetTitleBlock() and nothing in
    // gerbview/ ever calls SetTitleBlock, so it is default-constructed. The
    // boxes are ruled and empty in a live GerbView.
    const texts = gerberDrawingSheetItems()
      .map((i) => (i as { text?: string }).text)
      .filter((t): t is string => typeof t === 'string');
    // Nothing resolved from a title-block field, and no unresolved token left
    // showing either.
    expect(texts.some((t) => t.includes('${'))).toBe(false);
    // Sheet 1 of 1 — SetPageNumber( "1" ) / SetSheetCount( 1 ), :893-894.
    expect(texts).toContain('1');
  });

  it('strokes the page limits at the page rectangle, in canvas units', () => {
    // DS_PAINTER::DrawBorder, gated on GetShowPageLimits()
    // (gerbview_painter.cpp:186). Recorded rather than read: this is the one
    // piece of geometry that is a single call.
    const rects: number[][] = [];
    const ctx = {
      save() {},
      restore() {},
      setTransform() {},
      scale() {},
      setLineDash() {},
      strokeRect: (x: number, y: number, w: number, h: number) => rects.push([x, y, w, h]),
      strokeStyle: '',
      lineWidth: 0,
    } as unknown as CanvasRenderingContext2D;

    drawGerberPageLimits(ctx, { scale: 1e-4, tx: 0, ty: 0 }, false, 'rgb(132, 132, 132)');
    expect(rects).toHaveLength(1);
    const [x, y, w, h] = rects[0]!;
    expect(x).toBe(0);
    expect(y).toBe(0);
    // The parser's IU, which is what every other coordinate on this canvas is in.
    expect(w).toBeCloseTo(812.8 * IU_PER_MM, 0);
    expect(h).toBeCloseTo(812.8 * IU_PER_MM, 0);
  });
});

describe('the canvas actually paints it', () => {
  it('calls both painters, each behind its own visibility flag', () => {
    // The defect was a toggle with no painter behind it, so the wiring is the
    // thing to pin. Named individually: one call present and the other missing
    // must not pass.
    expect(CANVAS).toContain('drawGerberDrawingSheet(octx');
    expect(CANVAS).toContain('drawGerberPageLimits(octx');
    expect(CANVAS).toMatch(/if\s*\(opts\.drawingSheet\)/);
    expect(CANVAS).toMatch(/if\s*\(opts\.pageLimits\)/);
  });

  /**
   * …and on the page the frame is SET to, not on a fixed GERBER square.
   *
   * `pageInfo.SetType( cfg->m_Appearance.page_type )`
   * (`gerbview_frame.cpp:334`, `:1213`) — the seven Page Size radios on
   * Preferences > Gerber Viewer > Display Options.
   *
   * Per occurrence, and named individually, for the reason the test above is:
   * one call threading the page and the other not is a sheet drawn at A4
   * inside a page-limits rectangle still 32 inches across.
   *
   * Passing it through `opts` is load-bearing rather than stylistic. The
   * canvas asks for a frame when `options` changes identity
   * (its `[layers, options, showGrid, gridIU, crosshairMode, requestDraw]`
   * effect); a painter that fetched the page size from the settings manager
   * itself would draw the right page and only whenever something else
   * happened to trigger a redraw, which is a Preferences control that stores a
   * value and appears not to work.
   */
  it('draws both on the page appearance.page_type names', () => {
    // The COLOUR is threaded too, and from the same place: LAYER_GERBVIEW_
    // DRAWINGSHEET and LAYER_GERBVIEW_PAGE_LIMITS are two of the seven swatches
    // on Preferences > Gerber Viewer > Colors, so a module constant here would
    // be a swatch that could never move anything.
    expect(CANVAS).toContain(
      'drawGerberDrawingSheet(octx, v, opts.flipView, opts.colors.drawingSheet, opts.paper)',
    );
    expect(CANVAS).toContain(
      'drawGerberPageLimits(octx, v, opts.flipView, opts.colors.pageLimits, opts.paper)',
    );
    // …and the frame puts the setting on the options object in the first
    // place. Without this the two lines above thread `undefined`.
    expect(VIEWER).toContain('paper: gbrCfg.appearance.page_type');
  });

  /**
   * The behaviour behind it: the same call on a different page really does lay
   * out a different rectangle. A source-text check alone would pass against a
   * `paper` argument the layout function ignored.
   */
  it('lays the page-limits rectangle out at the size that page really is', () => {
    const measure = (paper: string): [number, number] => {
      const rects: number[][] = [];
      const ctx = {
        save() {},
        restore() {},
        setTransform() {},
        scale() {},
        setLineDash() {},
        strokeRect: (x: number, y: number, w: number, h: number) => rects.push([x, y, w, h]),
        strokeStyle: '',
        lineWidth: 0,
      } as unknown as CanvasRenderingContext2D;
      drawGerberPageLimits(ctx, { scale: 1e-4, tx: 0, ty: 0 }, false, '#000', paper);
      return [rects[0]![2] as number, rects[0]![3] as number];
    };

    // A4 is 11693 x 8268 MILS — `PAGE_INFO A4( "A4", wxPAPER_A4, 11693, 8268 )`
    // (page_info.cpp). Landscape, and not the 210 x 297 the combo LABELS it:
    // KiCad's whole table is landscape and the portrait flag is what swaps the
    // pair, which GerbView never sets. Re-derived from that row rather than
    // re-baselined to whatever this printed.
    expect(PAPER_MM.A4).toEqual([(11693 * 25.4) / 1000, (8268 * 25.4) / 1000]);
    const [w, h] = measure('A4');
    expect(w).toBeCloseTo(((11693 * 25.4) / 1000) * IU_PER_MM, 0);
    expect(h).toBeCloseTo(((8268 * 25.4) / 1000) * IU_PER_MM, 0);
    // Not square — which the GERBER page is, and is how a page argument
    // silently falling back to GERBER would be caught.
    expect(w).not.toBeCloseTo(h, 0);

    // A stored value naming no page in the table falls back to GERBER rather
    // than throwing on `PAPER_MM[...]!`.
    expect(measure('not-a-page')).toEqual(measure('GERBER'));
  });

  /** The sheet itself moves with it too, not only the border. */
  it('lays the sheet out on that page as well', () => {
    // The same walk over every arm of the DsDrawItem union the GERBER case
    // above uses, so the widest point is the real one.
    const far = (paper: string): number =>
      Math.max(
        ...gerberDrawingSheetItems(paper).flatMap((i) => {
          switch (i.kind) {
            case 'line':
            case 'rect':
              return [i.a.x, i.b.x];
            case 'poly':
              return i.pts.map((p) => p.x);
            default:
              return [i.at.x];
          }
        }),
      );
    // Schematic IU, 1e4/mm — the units the shared layout engine emits.
    expect(far('A4') / 1e4).toBeGreaterThan(280);
    expect(far('A4') / 1e4).toBeLessThanOrEqual(297.003);
    expect(far('A4')).toBeLessThan(far('GERBER'));
  });

  it('paints the sheet over the gerbers and under the preview tools', () => {
    // The gerber layers get explicit render orders 0..2N+1
    // (gerbview_draw_panel_gal.cpp:181-183) while LAYER_DRAWINGSHEET keeps its
    // own id as its order, GAL_LAYER_ID_START + 24 (layer_ids.h:278) — above
    // them. LAYER_SELECT_OVERLAY and LAYER_GP_OVERLAY are made top layers
    // (:191-193), so they sit above the sheet.
    // Scoped to the overlay block. `zoomAreaRef.current` also appears in a
    // pointer handler far earlier in the file, so a whole-file indexOf compares
    // against the wrong occurrence and passes or fails for the wrong reason.
    const from = CANVAS.indexOf('const octx =');
    expect(from, 'the overlay context must exist').toBeGreaterThan(-1);
    const overlay = CANVAS.slice(from);

    const sheetAt = overlay.indexOf('drawGerberDrawingSheet(octx');
    const limitsAt = overlay.indexOf('drawGerberPageLimits(octx');
    const zoomAreaAt = overlay.indexOf('zoomAreaRef.current');
    const crosshairAt = overlay.indexOf('drawCrosshair');
    for (const [name, at] of [
      ['the sheet', sheetAt],
      ['the page limits', limitsAt],
      ['the rubber band', zoomAreaAt],
      ['the crosshair', crosshairAt],
    ] as const) {
      expect(at, `${name} must be drawn on the overlay`).toBeGreaterThan(-1);
    }
    // DrawBorder comes after the sheet's own items (ds_proxy_view_item.cpp:139-147).
    expect(sheetAt).toBeLessThan(limitsAt);
    // ...and both come before the preview tools, which are the top layers.
    expect(limitsAt).toBeLessThan(zoomAreaAt);
    expect(limitsAt).toBeLessThan(crosshairAt);
  });
});

describe('both layers default to hidden', () => {
  it('makes the drawing sheet opt-in, not opt-out', () => {
    // `appearance.show_border_and_titleblock` is declared with a false default
    // (gerbview_settings.cpp:45-46). Ours read `!toggles.has('hideDrawingSheet')`,
    // which is the opposite default.
    expect(VIEWER).not.toContain('hideDrawingSheet');
    expect(VIEWER).toContain("toggles.has('showDrawingSheet')");
  });

  it('makes the page limits opt-in too', () => {
    // `display.page_limits`, default false (gerbview_settings.cpp:58).
    expect(VIEWER).toContain("toggles.has('showPageLimits')");
    expect(VIEWER).not.toContain('hidePageLimits');
  });

  it('feeds the same flag to the layer row and to the painter', () => {
    // One read, so the row and the canvas cannot disagree about what is shown.
    expect(VIEWER).toContain("const showDrawingSheet = toggles.has('showDrawingSheet')");
    expect(VIEWER.match(/drawingSheet: showDrawingSheet/g) ?? []).toHaveLength(2);
  });
});

describe('zoom to fit with nothing loaded', () => {
  it('falls back to the page when the sheet is shown', () => {
    // GERBVIEW_DRAW_PANEL_GAL::GetDefaultViewBBox (gerbview_draw_panel_gal.cpp:199-205)
    // returns the sheet's bbox only when LAYER_DRAWINGSHEET is visible, and
    // COMMON_TOOLS::ZoomFitScreen uses it only when the model bbox is empty
    // (common/tool/common_tools.cpp:442-445).
    expect(VIEWER).toContain('if (showDrawingSheet) {');
    expect(VIEWER).toContain('maxX: wMM * IU_PER_MM');
  });
});
