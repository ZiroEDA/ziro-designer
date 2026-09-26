// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `KIGFX::VIEW`: KiCad's own qa (`qa/tests/common/view/test_view_rtree_stale_bbox.cpp`,
 * `test_view_null_safety.cpp`) transcribed, plus the draw pass against a
 * recording GAL and painter — the per-layer R-trees, the cached groups a
 * `TARGET_CACHED` layer gets and a non-cached one does not, the rendering
 * order and the top-layer modifier, all of which `pcb_draw_panel_gal` relies on.
 */
import { describe, expect, it } from 'vitest';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { GAL_DISPLAY_OPTIONS } from '@ziroeda/common/gal/gal_display_options.js';
import { GAL } from '@ziroeda/common/gal/graphics_abstraction_layer.js';
import { RENDER_TARGET } from '@ziroeda/common/gal/definitions.js';
import { PAINTER } from '@ziroeda/common/gal/painter.js';
import { RENDER_SETTINGS } from '@ziroeda/common/render_settings.js';
import type { Color4d } from '@ziroeda/common/color4d.js';
import { VIEW } from '@ziroeda/common/view/view.js';
import { VIEW_GROUP } from '@ziroeda/common/view/view_group.js';
import { VIEW_ITEM, VIEW_UPDATE_FLAGS } from '@ziroeda/common/view/view_item.js';
import { LAYER_SELECT_OVERLAY } from '@ziroeda/common/layer_ids.js';

const TEST_LAYER = 0;

/// VIEW::UpdateItems() requires a GAL reporting visible + initialized (both default true on the
/// base class). No drawing is exercised because the test keeps every layer non-cached.
class STUB_GAL extends GAL {}

/// VIEW item whose bounding box can be moved after insertion, to drive updateBbox() with a box
/// that does not overlap the one it was inserted with.
class MOVABLE_ITEM extends VIEW_ITEM {
  private m_bbox: BOX2I;
  private m_layers: number[];

  constructor(aBox: BOX2I, aLayers: number[] = [TEST_LAYER]) {
    super();
    this.m_bbox = aBox;
    this.m_layers = aLayers;
  }

  GetClass(): string {
    return 'MOVABLE_ITEM';
  }
  ViewBBox(): BOX2I {
    return this.m_bbox;
  }
  ViewGetLayers(): number[] {
    return this.m_layers;
  }
  SetBBox(aBox: BOX2I): void {
    this.m_bbox = aBox;
  }
}

function countItemEntries(aView: VIEW, aRect: BOX2I, aItem: VIEW_ITEM): number {
  let count = 0;

  aView.Query(aRect, (aFound: VIEW_ITEM) => {
    if (aFound === aItem) count++;
    return true;
  });

  return count;
}

describe('ViewRTreeStaleBbox', () => {
  it('UpdateBboxRemovesOldEntryOnFarMove', () => {
    const opts = new GAL_DISPLAY_OPTIONS();
    const gal = new STUB_GAL(opts);
    const view = new VIEW();
    view.SetGAL(gal);

    // Keep everything non-cached so updateItemGeometry() (which would need a painter) is skipped.
    for (let layer = 0; layer < VIEW.VIEW_MAX_LAYERS; ++layer)
      view.SetLayerTarget(layer, RENDER_TARGET.TARGET_NONCACHED);

    const nearBox = new BOX2I({ x: 0, y: 0 }, { x: 1000, y: 1000 });
    const target = new MOVABLE_ITEM(nearBox);
    view.Add(target);

    // Enough clustered neighbours near the origin to force internal R-tree nodes, so removing the
    // target requires the overlap-gated descent that the aliasing bug defeats.
    const fillers: MOVABLE_ITEM[] = [];

    for (let i = 0; i < 200; ++i) {
      const pos = { x: (i % 20) * 3000, y: Math.trunc(i / 20) * 3000 };
      fillers.push(new MOVABLE_ITEM(new BOX2I(pos, { x: 1000, y: 1000 })));
      view.Add(fillers[fillers.length - 1]!);
    }

    // Flush the INITIAL_ADD updates queued by Add().
    view.UpdateItems();

    expect(countItemEntries(view, nearBox, target)).toBe(1);

    // Move the target far enough that its new box shares no area with the cluster it lived in. A
    // single changed item keeps the changed ratio well under the bulk-rebuild threshold, so the
    // update is routed through updateBbox().
    const farBox = new BOX2I({ x: 10000000, y: 10000000 }, { x: 1000, y: 1000 });
    target.SetBBox(farBox);
    view.Update(target, VIEW_UPDATE_FLAGS.GEOMETRY);
    view.UpdateItems();

    const everything = new BOX2I({ x: -1000000, y: -1000000 }, { x: 20000000, y: 20000000 });

    // With the aliasing bug the stale near-origin entry survives, so the target is indexed twice.
    expect(countItemEntries(view, everything, target)).toBe(1);
    expect(countItemEntries(view, nearBox, target)).toBe(0);

    view.Remove(target);

    for (const filler of fillers) view.Remove(filler);
  });
});

describe('ViewNullSafety', () => {
  it('HideAndSetVisibleTolerateNullItem', () => {
    const view = new VIEW();

    // Before the fix each of these dereferenced the null item via viewPrivData() and aborted.
    view.Hide(null, true);
    view.Hide(null, false, true);
    view.SetVisible(null, true);
    view.SetVisible(null, false);

    // Reaching this point without crashing is the assertion.
    expect(true).toBe(true);
  });

  it('ViewGroupRejectsNullItem', () => {
    // Issue #24778: a re-entrant ExitGroup() during SCH_SELECTION_TOOL::EnterGroup() left the
    // group overlay with a null (stale) member. VIEW_GROUP stored it, then the next repaint
    // dereferenced it in ViewBBox()/ViewDraw(). Add() must drop a null the same way the VIEW
    // mutators do.
    const group = new VIEW_GROUP();
    group.Add(null);
    expect(group.GetSize()).toBe(0);

    // Without the guard this iterated m_groupItems[0] on a null item and crashed.
    group.ViewBBox();
  });
});

/**
 * A GAL that records what the view asks of it: groups begun and drawn, the
 * target and depth each draw happened at.
 */
class RECORDING_GAL extends GAL {
  log: string[] = [];
  private nextGroup = 1;
  private target = RENDER_TARGET.TARGET_CACHED;

  constructor() {
    super(new GAL_DISPLAY_OPTIONS());
    this.SetScreenSize({ x: 800, y: 600 });
  }

  override SetTarget(aTarget: RENDER_TARGET): void {
    this.target = aTarget;
  }
  override GetTarget(): RENDER_TARGET {
    return this.target;
  }
  override BeginGroup(): number {
    const g = this.nextGroup++;
    this.log.push(`begin ${g} depth ${this.getLayerDepth()}`);
    return g;
  }
  override EndGroup(): void {
    this.log.push('end');
  }
  override DrawGroup(aGroupNumber: number): void {
    this.log.push(`group ${aGroupNumber} target ${this.target} depth ${this.getLayerDepth()}`);
  }
  override DeleteGroup(aGroupNumber: number): void {
    this.log.push(`delete ${aGroupNumber}`);
  }
  override ChangeGroupColor(aGroupNumber: number, aNewColor: Color4d): void {
    this.log.push(`color ${aGroupNumber} ${aNewColor.r}`);
  }
  override ChangeGroupDepth(aGroupNumber: number, aDepth: number): void {
    this.log.push(`depth ${aGroupNumber} ${aDepth}`);
  }
  override IsOpenGlEngine(): boolean {
    return true;
  }
}

class TEST_SETTINGS extends RENDER_SETTINGS {
  private bg: Color4d = { r: 0, g: 0, b: 0, a: 1 };
  GetColor(aItem: VIEW_ITEM | null, aLayer: number): Color4d {
    return { r: aLayer, g: 0, b: 0, a: 1 };
  }
  GetBackgroundColor(): Color4d {
    return this.bg;
  }
  SetBackgroundColor(aColor: Color4d): void {
    this.bg = aColor;
  }
  GetGridColor(): Color4d {
    return this.bg;
  }
  GetCursorColor(): Color4d {
    return this.bg;
  }
}

/** Records `Draw( item, layer )` in the order the view asks; every item is "known". */
class RECORDING_PAINTER extends PAINTER {
  drawn: string[] = [];
  settings = new TEST_SETTINGS();

  GetSettings(): RENDER_SETTINGS {
    return this.settings;
  }
  Draw(aItem: VIEW_ITEM, aLayer: number): boolean {
    // PCB_PAINTER::Draw knows only EDA_ITEMs; the view's own preview VIEW_GROUP
    // falls through to ViewDraw, which draws nothing while it is empty.
    if (aItem instanceof VIEW_GROUP) return false;

    this.drawn.push(`${aItem.GetClass()}@${aLayer}`);
    return true;
  }
}

class NAMED_ITEM extends MOVABLE_ITEM {
  constructor(
    private readonly name: string,
    aBox: BOX2I,
    aLayers: number[],
  ) {
    super(aBox, aLayers);
  }
  override GetClass(): string {
    return this.name;
  }
}

describe('VIEW draws through the GAL', () => {
  const setup = () => {
    const gal = new RECORDING_GAL();
    const painter = new RECORDING_PAINTER(null);
    const view = new VIEW();
    view.SetGAL(gal);
    view.SetPainter(painter);
    // PCB_DRAW_PANEL_GAL's constructor: the overlays are display-only, so a Query
    // does not return the preview group (whose empty bbox is the maximum box).
    view.SetLayerDisplayOnly(LAYER_SELECT_OVERLAY);
    // The preview group is the view's first cached item; its group is number 1
    // on the overlay's depth. The logs below look past it.
    view.UpdateItems();
    gal.log = [];
    return { gal, painter, view };
  };

  it('caches an item on a TARGET_CACHED layer once and replays the group on redraw', () => {
    const { gal, painter, view } = setup();
    const item = new NAMED_ITEM('track', new BOX2I({ x: 0, y: 0 }, { x: 100, y: 100 }), [5]);
    view.Add(item);
    // Four bystanders on a non-cached layer, so that one changed item stays under the 30%
    // ratio at which UpdateItems rebuilds every R-tree and clears GEOMETRY without recaching.
    view.SetLayerTarget(6, RENDER_TARGET.TARGET_NONCACHED);
    for (let i = 0; i < 4; i++)
      view.Add(new NAMED_ITEM('other', new BOX2I({ x: 500, y: 500 }, { x: 1, y: 1 }), [6]));
    const tracks = () => painter.drawn.filter((d) => d.startsWith('track'));

    // UpdateItems is the INITIAL_ADD flush: the painter draws into a new group, at the layer's depth.
    view.UpdateItems();
    expect(painter.drawn).toEqual(['track@5']);
    expect(gal.log).toEqual(['begin 2 depth 5', 'end']);

    // Redraw replays the cached group without painting again (the non-cached bystanders are
    // painted immediately, every redraw).
    view.SetCenter({ x: 50, y: 50 });
    view.Redraw();
    expect(tracks()).toEqual(['track@5']);
    expect(painter.drawn.filter((d) => d.startsWith('other'))).toHaveLength(4);
    expect(gal.log.filter((l) => l.startsWith('group'))).toEqual([
      `group 1 target ${RENDER_TARGET.TARGET_CACHED} depth ${LAYER_SELECT_OVERLAY}`,
      `group 2 target ${RENDER_TARGET.TARGET_CACHED} depth 5`,
    ]);

    // A GEOMETRY update deletes the group and draws a new one.
    view.Update(item, VIEW_UPDATE_FLAGS.GEOMETRY);
    view.UpdateItems();
    expect(gal.log.slice(-3)).toEqual(['delete 2', 'begin 3 depth 5', 'end']);
    expect(tracks()).toEqual(['track@5', 'track@5']);

    // A COLOR update only recolours the group, with the settings' colour for that layer.
    view.Update(item, VIEW_UPDATE_FLAGS.COLOR);
    view.UpdateItems();
    expect(gal.log.at(-1)).toBe('color 3 5');
    expect(tracks()).toHaveLength(2);
  });

  it('draws a non-cached layer immediately on every redraw, in rendering order', () => {
    const { painter, view } = setup();
    view.SetLayerTarget(3, RENDER_TARGET.TARGET_NONCACHED);
    view.SetLayerTarget(7, RENDER_TARGET.TARGET_NONCACHED);
    const a = new NAMED_ITEM('a', new BOX2I({ x: 0, y: 0 }, { x: 10, y: 10 }), [7]);
    const b = new NAMED_ITEM('b', new BOX2I({ x: 0, y: 0 }, { x: 10, y: 10 }), [3]);
    view.Add(a);
    view.Add(b);
    view.UpdateItems();
    expect(painter.drawn).toEqual([]);

    view.SetCenter({ x: 5, y: 5 });
    view.Redraw();
    // m_orderedLayers is sorted by renderingOrder DESCENDING (compareRenderingOrder is `>`):
    // the higher order is drawn first here, the lower one on top.
    expect(painter.drawn).toEqual(['a@7', 'b@3']);

    // SetLayerOrder re-sorts: put layer 7 under layer 3.
    view.SetLayerOrder(7, 1);
    painter.drawn = [];
    view.Redraw();
    expect(painter.drawn).toEqual(['b@3', 'a@7']);

    // A top layer gets TOP_LAYER_MODIFIER added and so sorts last (drawn last, on top).
    view.SetLayerOrder(7, 7);
    view.SetTopLayer(7);
    view.UpdateAllLayersOrder();
    painter.drawn = [];
    view.Redraw();
    expect(painter.drawn).toEqual(['b@3', 'a@7']);
    expect(view.GetLayerOrder(7)).toBe(7 + VIEW.TOP_LAYER_MODIFIER);

    view.ClearTopLayers();
    expect(view.GetLayerOrder(7)).toBe(7);
  });

  it('Query returns items top of the rendering stack first and skips invisible layers', () => {
    const { view } = setup();
    const lo = new NAMED_ITEM('lo', new BOX2I({ x: 0, y: 0 }, { x: 10, y: 10 }), [2]);
    const hi = new NAMED_ITEM('hi', new BOX2I({ x: 0, y: 0 }, { x: 10, y: 10 }), [9]);
    view.Add(lo);
    view.Add(hi);
    view.UpdateItems();

    const rect = new BOX2I({ x: 0, y: 0 }, { x: 5, y: 5 });
    let result: [VIEW_ITEM, number][] = [];
    expect(view.Query(rect, result)).toBe(2);
    // reverse of m_orderedLayers (which is descending), so ascending renderingOrder: 2 then 9.
    expect(result.map(([it, l]) => `${it.GetClass()}@${l}`)).toEqual(['lo@2', 'hi@9']);

    view.SetLayerVisible(2, false);
    result = [];
    expect(view.Query(rect, result)).toBe(1);
    expect(result[0]![0]).toBe(hi);

    view.SetLayerDisplayOnly(9, true);
    result = [];
    expect(view.Query(rect, result)).toBe(0);
  });

  it('Remove deletes the cached groups and the item leaves the R-trees', () => {
    const { gal, view } = setup();
    const item = new NAMED_ITEM('pad', new BOX2I({ x: 0, y: 0 }, { x: 10, y: 10 }), [1, 2]);
    view.Add(item);
    view.UpdateItems();
    expect(gal.log).toEqual(['begin 2 depth 1', 'end', 'begin 3 depth 2', 'end']);
    expect(view.HasItem(item)).toBe(true);

    view.Remove(item);
    expect(gal.log.slice(-2)).toEqual(['delete 2', 'delete 3']);
    expect(view.HasItem(item)).toBe(false);
    expect(countItemEntries(view, new BOX2I({ x: 0, y: 0 }, { x: 10, y: 10 }), item)).toBe(0);
  });
});
