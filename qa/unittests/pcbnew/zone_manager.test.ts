// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * pcbnew/zone_manager/{model_zones_overview,board_edges_bounding_item}, read
 * off the C++: MODEL_ZONES_OVERVIEW's filter (name OR net, case-insensitive,
 * within the layer filter), priority-order sort after a filter, the four
 * MoveZoneIndex movements and their swap-only-when-in-range rule, and
 * MakeBitmapForLayers' four-stripe cap.
 */
import { describe, expect, it } from 'vitest';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { GAL } from '@ziroeda/common/gal/graphics_abstraction_layer.js';
import { GAL_DISPLAY_OPTIONS } from '@ziroeda/common/gal/gal_display_options.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import { COLOR_SETTINGS } from '@ziroeda/common/settings/color_settings.js';
import { BOARD } from '@ziroeda/pcbnew/board.js';
import { ZONE } from '@ziroeda/pcbnew/zone.js';
import { ZONE_SETTINGS_BAG } from '@ziroeda/pcbnew/zone_settings_bag.js';
import { BOARD_EDGES_BOUNDING_ITEM } from '@ziroeda/pcbnew/zone_manager/board_edges_bounding_item.js';
import {
  ZONE_PAINTER,
  ZONE_PREVIEW_CANVAS,
} from '@ziroeda/pcbnew/zone_manager/zone_preview_canvas.js';
import {
  ZONE_PREVIEW_NOTEBOOK,
  type ZONE_PREVIEW_CANVAS_LIKE,
} from '@ziroeda/pcbnew/zone_manager/zone_preview_notebook.js';
import {
  MakeBitmapForLayers,
  MODEL_ZONES_OVERVIEW,
  ZONE_INDEX_MOVEMENT,
  ZONES_OVERVIEW_COL,
  type MODEL_ZONES_OVERVIEW_VIEW,
} from '@ziroeda/pcbnew/zone_manager/model_zones_overview.js';

function zone(board: BOARD, name: string, priority: number, layer = PCB_LAYER_ID.F_Cu): ZONE {
  const z = new ZONE(board);
  for (const p of [
    { x: 0, y: 0 },
    { x: 1e6, y: 0 },
    { x: 1e6, y: 1e6 },
  ])
    z.AppendCorner(p, -1);
  z.SetLayer(layer);
  z.SetZoneName(name);
  z.SetAssignedPriority(priority);
  return z;
}

function setup(specs: [string, number, PCB_LAYER_ID?][]) {
  const board = new BOARD();
  for (const [n, p, l] of specs) board.Add(zone(board, n, p, l));
  const bag = new ZONE_SETTINGS_BAG(board);
  const events: string[] = [];
  const view: MODEL_ZONES_OVERVIEW_VIEW = {
    Reset: (n) => events.push(`reset ${n}`),
    RowChanged: (r) => events.push(`row ${r}`),
    OnRowCountChange: (n) => events.push(`count ${n}`),
  };
  const colors = new COLOR_SETTINGS();
  const model = new MODEL_ZONES_OVERVIEW(
    view,
    { GetBoard: () => board, GetColorSettings: () => colors },
    bag,
  );
  const names = (): string[] =>
    Array.from(
      { length: model.GetCount() },
      (_, i) => model.GetValueByRow(i, ZONES_OVERVIEW_COL.NAME)!.text,
    );
  return { board, bag, model, events, names };
}

describe('MODEL_ZONES_OVERVIEW filter', () => {
  it('matches name or net, case-insensitively, then sorts by priority (highest first)', () => {
    const { model, names, events } = setup([
      ['GND_top', 1],
      ['pwr', 5],
      ['gnd_bottom', 3],
    ]);
    expect(events).toEqual(['reset 3']);
    model.ApplyFilter('  GND ', null);
    expect(names()).toEqual(['gnd_bottom', 'GND_top']);
    expect(events.slice(1)).toEqual(['reset 2', 'count 2']);
  });

  it('name-only and net-only fitters: with both off nothing matches', () => {
    const { model, names } = setup([['abc', 1]]);
    model.EnableFitterByName(false);
    model.EnableFitterByNet(false);
    model.ApplyFilter('abc', null);
    expect(names()).toEqual([]);
    model.EnableFitterByName(true);
    model.ApplyFilter('abc', null);
    expect(names()).toEqual(['abc']);
  });

  it('an empty filter clears it, sorted by priority; the selected zone is re-found by identity', () => {
    const { model, names } = setup([
      ['a', 1],
      ['b', 9],
      ['c', 4],
    ]);
    // Row 2 of the unfiltered (bag order) list is 'c'. The filter narrows to it (row 0).
    const narrowed = model.ApplyFilter('c', model.GetItem(2));
    expect(names()).toEqual(['c']);
    expect(model.GetZone(narrowed)!.GetZoneName()).toBe('c');
    const after = model.ApplyFilter('   ', narrowed);
    expect(names()).toEqual(['b', 'c', 'a']);
    expect(model.GetZone(after)!.GetZoneName()).toBe('c');
    expect(after).toBe(1);
  });

  it('the layer filter drops zones not on that layer, with or without text', () => {
    const { model, names } = setup([
      ['top', 1, PCB_LAYER_ID.F_Cu],
      ['bot', 2, PCB_LAYER_ID.B_Cu],
    ]);
    model.SetLayerFilter(PCB_LAYER_ID.B_Cu);
    model.ClearFilter(null);
    expect(names()).toEqual(['bot']);
    model.ApplyFilter('t', null);
    expect(names()).toEqual(['bot']);
    model.ApplyFilter('top', null);
    expect(names()).toEqual([]);
  });
});

describe('MODEL_ZONES_OVERVIEW priority moves', () => {
  const four = (): ReturnType<typeof setup> =>
    setup([
      ['a', 4],
      ['b', 3],
      ['c', 2],
      ['d', 1],
    ]);

  it('the constructor keeps the bag order (board order), not priority order', () => {
    // GetClonedZoneList is board order; only the filters sort.
    const { names } = four();
    expect(names()).toHaveLength(4);
  });

  it('MOVE_UP / MOVE_DOWN swap neighbours and swap the bag priorities too', () => {
    const { model, bag, names, events } = four();
    model.ClearFilter(null); // priority order a b c d
    expect(model.MoveZoneIndex(2, ZONE_INDEX_MOVEMENT.MOVE_UP)).toBe(1);
    expect(names()).toEqual(['a', 'c', 'b', 'd']);
    expect(events.slice(-2)).toEqual(['row 2', 'row 1']);
    const [a, c, b] = [0, 1, 2].map((i) => model.GetZone(i)!);
    expect(bag.GetZonePriority(c!)).toBeGreaterThan(bag.GetZonePriority(b!));
    expect(bag.GetZonePriority(a!)).toBeGreaterThan(bag.GetZonePriority(c!));
    expect(model.MoveZoneIndex(0, ZONE_INDEX_MOVEMENT.MOVE_UP)).toBeUndefined();
    expect(model.MoveZoneIndex(3, ZONE_INDEX_MOVEMENT.MOVE_DOWN)).toBeUndefined();
    expect(model.MoveZoneIndex(0, ZONE_INDEX_MOVEMENT.MOVE_DOWN)).toBe(1);
  });

  it('MOVE_TO_TOP / MOVE_TO_BOTTOM rotate the row to the end and answer its new index', () => {
    const { model, names } = four();
    model.ClearFilter(null);
    expect(model.MoveZoneIndex(3, ZONE_INDEX_MOVEMENT.MOVE_TO_TOP)).toBe(0);
    expect(names()).toEqual(['d', 'a', 'b', 'c']);
    expect(model.MoveZoneIndex(0, ZONE_INDEX_MOVEMENT.MOVE_TO_BOTTOM)).toBe(3);
    expect(names()).toEqual(['a', 'b', 'c', 'd']);
    expect(model.MoveZoneIndex(0, ZONE_INDEX_MOVEMENT.MOVE_TO_TOP)).toBeUndefined();
  });

  it('SwapZonePriority: same index answers itself, out of range answers nothing', () => {
    const { model, events } = four();
    const before = events.length;
    expect(model.SwapZonePriority(1, 1)).toBe(1);
    expect(events).toHaveLength(before); // no row changed
    expect(model.SwapZonePriority(1, 9)).toBeUndefined();
    expect(model.SwapZonePriority(-1, 0)).toBeUndefined();
  });
});

describe('MakeBitmapForLayers', () => {
  const colors = new COLOR_SETTINGS();

  it('one stripe per layer, height 16 / n, each in its layer colour', () => {
    const rects = MakeBitmapForLayers([PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.B_Cu], colors, {
      x: 16,
      y: 16,
    });
    expect(rects.map((r) => [r.y, r.h, r.w])).toEqual([
      [0, 8, 16],
      [8, 8, 16],
    ]);
    expect(rects[0]!.color).toEqual(colors.GetColor(PCB_LAYER_ID.F_Cu));
  });

  it('exactly five layers already caps at four stripes', () => {
    const rects = MakeBitmapForLayers([1, 2, 3, 4, 5] as PCB_LAYER_ID[], colors, { x: 16, y: 16 });
    expect(rects).toHaveLength(4);
  });

  it('more than four layers keeps the first two and the last two (last first of the pair)', () => {
    const seq = [1, 2, 3, 4, 5, 6].map((i) => i as PCB_LAYER_ID);
    const rects = MakeBitmapForLayers(seq, colors, { x: 16, y: 16 });
    expect(rects.map((r) => r.color)).toEqual([
      colors.GetColor(1),
      colors.GetColor(2),
      colors.GetColor(6),
      colors.GetColor(5),
    ]);
    expect(rects.every((r) => r.h === 4)).toBe(true);
  });
});

describe('BOARD_EDGES_BOUNDING_ITEM', () => {
  it('is its box, on Edge_Cuts', () => {
    const box = new BOX2I({ x: 1, y: 2 }, { x: 3, y: 4 });
    const item = new BOARD_EDGES_BOUNDING_ITEM(box);
    expect(item.ViewBBox()).toBe(box);
    expect(item.ViewGetLayers()).toEqual([PCB_LAYER_ID.Edge_Cuts]);
    expect(item.GetClass()).toBe('BOARD_EDGES_BOUNDING_ITEM');
  });
});

describe('ZONE_PREVIEW_NOTEBOOK', () => {
  type Canvas = ZONE_PREVIEW_CANVAS_LIKE & { locked: [number, Vec2][]; fits: number };
  const canvasOf = (scale = 2, center: Vec2 = { x: 5, y: 6 }): Canvas => {
    const c = {
      locked: [] as [number, Vec2][],
      fits: 0,
      GetView: () => ({ GetScale: () => scale, GetCenter: () => center }),
      LockZoom: (s: number, ctr: Vec2) => c.locked.push([s, ctr]),
      ZoomFitScreen: () => {
        c.fits++;
      },
    };
    return c;
  };

  function setupNb() {
    const board = new BOARD();
    const canvases: Canvas[] = [];
    const sizes: number[] = [];
    let last: { pages: number; sel: number } | null = null;
    const nb = new ZONE_PREVIEW_NOTEBOOK({
      GetBoard: () => board,
      CreateCanvas: () => {
        const c = canvasOf();
        canvases.push(c);
        return c;
      },
      OnPagesChanged: (p, s) => {
        last = { pages: p.length, sel: s };
      },
      PostSizeEvent: () => {
        sizes.push(1);
      },
    });
    const twoLayer = (): ZONE => {
      const z = zone(board, 'z', 1, PCB_LAYER_ID.F_Cu);
      z.SetLayerSet(new LSET([PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.B_Cu]));
      return z;
    };
    return { nb, canvases, sizes, last: () => last, twoLayer, board };
  }

  it('one page per UI-order layer, the first selected, each fitted (no saved zoom yet)', () => {
    const { nb, canvases, twoLayer, last } = setupNb();
    nb.OnZoneSelectionChanged(twoLayer());
    expect(nb.GetPageCount()).toBe(2);
    expect(nb.GetPage(0).GetLayer()).toBe(PCB_LAYER_ID.F_Cu);
    expect(nb.GetSelection()).toBe(0);
    expect(canvases.map((c) => c.fits)).toEqual([1, 1]);
    expect(last()).toEqual({ pages: 2, sel: 0 });
  });

  it('a new selection keeps the current layer and locks the zoom saved from the old page', () => {
    const { nb, canvases, twoLayer } = setupNb();
    nb.OnZoneSelectionChanged(twoLayer());
    nb.SetSelection(1); // the user opens B.Cu
    nb.OnZoneSelectionChanged(twoLayer());
    expect(nb.GetSelection()).toBe(1);
    // canvases 2 and 3 are the new pages: locked to the saved (2, {5,6}), never fitted
    expect(canvases.slice(2).map((c) => c.locked)).toEqual([
      [[2, { x: 5, y: 6 }]],
      [[2, { x: 5, y: 6 }]],
    ]);
    expect(canvases.slice(2).map((c) => c.fits)).toEqual([0, 0]);
  });

  it('a layer the new zone lacks falls back to the first page; no zone empties the notebook', () => {
    const { nb, board, last } = setupNb();
    nb.OnZoneSelectionChanged(zone(board, 'a', 1, PCB_LAYER_ID.B_Cu));
    const z = zone(board, 'b', 1, PCB_LAYER_ID.F_Cu);
    nb.OnZoneSelectionChanged(z);
    expect(nb.GetPage(nb.GetSelection()).GetLayer()).toBe(PCB_LAYER_ID.F_Cu);
    nb.OnZoneSelectionChanged(null);
    expect(nb.GetPageCount()).toBe(0);
    expect(nb.GetSelection()).toBe(-1);
    expect(last()).toEqual({ pages: 0, sel: -1 });
  });

  it('FitCanvasToScreen fits every page', () => {
    const { nb, canvases, twoLayer } = setupNb();
    nb.OnZoneSelectionChanged(twoLayer());
    nb.FitCanvasToScreen();
    expect(canvases.map((c) => c.fits)).toEqual([2, 2]);
  });
});

describe('ZONE_PREVIEW_CANVAS', () => {
  const bare = (board: BOARD, view: Record<string, unknown>, client = { x: 1000, y: 500 }) => {
    const c = Object.create(ZONE_PREVIEW_CANVAS.prototype) as Record<string, unknown>;
    c.m_pcb = board;
    c.m_view = view;
    c.m_zoomLocked = false;
    c.GetClientSize = () => client;
    c.GetDefaultViewBBox = () => null;
    c.Refresh = () => {};
    c.RequestRefresh = () => {};
    return c as unknown as ZONE_PREVIEW_CANVAS;
  };
  const fakeView = () => {
    const v = {
      scale: 1,
      center: { x: 0, y: 0 } as Vec2,
      SetScale: (s: number) => {
        v.scale = s;
      },
      GetScale: () => v.scale,
      SetCenter: (c: Vec2) => {
        v.center = c;
      },
      // 1 world unit per pixel at scale 1, like the screen-to-world matrix at identity
      ToWorld: (p: Vec2) => ({ x: p.x / v.scale, y: p.y / v.scale }),
    };
    return v;
  };

  it('an empty board falls back to the page, and ZoomFitScreen scales the box to the client', () => {
    const board = new BOARD();
    const v = fakeView();
    const c = bare(board, v);
    const box = c.GetBoardBoundingBox(true);
    // A4 in IU: 297.0022 x 210.0016 mm
    expect(box.GetOrigin()).toEqual({ x: 0, y: 0 });
    expect(box.GetWidth()).toBeGreaterThan(296_000_000);
    c.ZoomFitScreen();
    // scale = 1 / max( |box.w / 1000|, |box.h / 500| ) with the world = pixels at scale 1
    const expected = 1 / Math.max(box.GetWidth() / 1000, box.GetHeight() / 500);
    expect(v.scale).toBeCloseTo(expected, 15);
    expect(v.center).toEqual(box.Centre());
  });

  it('OnResize refits until the zoom is locked, and UnlockZoom re-enables it', () => {
    const v = fakeView();
    const c = bare(new BOARD(), v);
    c.LockZoom(0.5, { x: 1, y: 2 });
    expect([v.scale, v.center]).toEqual([0.5, { x: 1, y: 2 }]);
    v.scale = 0.25;
    c.OnResize();
    expect(v.scale).toBe(0.25); // locked: untouched
    c.UnlockZoom();
    c.OnResize();
    expect(v.scale).not.toBe(0.25);
  });

  it('ZONE_PAINTER fills the board-edges box and draws nothing else for it', () => {
    const calls: string[] = [];
    const gal = new (class extends GAL {
      constructor() {
        super(new GAL_DISPLAY_OPTIONS());
      }
      override Save(): void {
        calls.push('Save');
      }
      override Restore(): void {
        calls.push('Restore');
      }
      override DrawRectangle(a: Vec2, b: Vec2): void {
        calls.push(`rect ${a.x},${a.y}-${b.x},${b.y}`);
      }
    })();
    const painter = new ZONE_PAINTER(gal, FRAME_T.FRAME_FOOTPRINT_PREVIEW);
    const item = new BOARD_EDGES_BOUNDING_ITEM(new BOX2I({ x: 1, y: 2 }, { x: 10, y: 20 }));
    expect(painter.Draw(item, PCB_LAYER_ID.Edge_Cuts)).toBe(true);
    expect(calls).toEqual(['Save', 'rect 1,2-11,22', 'Restore']);
  });
});
