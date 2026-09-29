// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `ROUTER_PREVIEW_ITEM` (router_preview_item.ts) against a recording GAL. The
 * expectations are read off router_preview_item.cpp: Update()'s colour/depth
 * rules, drawShape()'s per-shape calls, getLayerColor()'s flag handling.
 */
import { describe, expect, it } from 'vitest';
import { GAL } from '@ziroeda/common/gal/graphics_abstraction_layer.js';
import { GAL_DISPLAY_OPTIONS } from '@ziroeda/common/gal/gal_display_options.js';
import type { Color4d } from '@ziroeda/common/gal/color4d.js';
import { GAL_LAYER_ID, PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { NET_COLOR_MODE } from '@ziroeda/common/project/board_project_settings.js';
import type { VIEW } from '@ziroeda/common/view/view.js';
import { PnsLayerRange } from '@ziroeda/pcbnew/router/pns_layerset.js';
import { PnsSegment } from '@ziroeda/pcbnew/router/pns_segment.js';
import { PnsVia } from '@ziroeda/pcbnew/router/pns_via.js';
import { LineMarker } from '@ziroeda/pcbnew/router/pns_item.js';
import {
  PNS_COLLISION,
  PNS_HEAD_TRACE,
  PNS_HOVER_ITEM,
  PNS_SEMI_SOLID,
  ROUTER_PREVIEW_ITEM,
  ROUTER_PREVIEW_LAYER_DEPTH_FACTOR,
} from '@ziroeda/pcbnew/router/router_preview_item.js';

type Call = { op: string; args: unknown[] };

class REC_GAL extends GAL {
  calls: Call[] = [];
  fill = false;
  stroke = false;
  width = 0;
  depth = 0;
  strokeColor: Color4d = { r: 0, g: 0, b: 0, a: 0 };
  fillColor: Color4d = { r: 0, g: 0, b: 0, a: 0 };
  constructor() {
    super(new GAL_DISPLAY_OPTIONS());
  }
  private rec(op: string, ...args: unknown[]): void {
    this.calls?.push({ op, args });
  }
  override SetIsFill(v: boolean): void {
    this.fill = v;
    super.SetIsFill(v);
  }
  override SetIsStroke(v: boolean): void {
    this.stroke = v;
    super.SetIsStroke(v);
  }
  override SetLineWidth(v: number): void {
    this.width = v;
    super.SetLineWidth(v);
  }
  override SetLayerDepth(v: number): void {
    this.depth = v;
    super.SetLayerDepth(v);
  }
  override SetStrokeColor(c: Color4d): void {
    this.strokeColor = c;
    super.SetStrokeColor(c);
  }
  override SetFillColor(c: Color4d): void {
    this.fillColor = c;
    super.SetFillColor(c);
  }
  override DrawSegment(a: { x: number; y: number }, b: { x: number; y: number }, w: number): void {
    this.rec('DrawSegment', a, b, w, this.depth, this.fillColor);
  }
  override DrawLine(a: { x: number; y: number }, b: { x: number; y: number }): void {
    this.rec('DrawLine', a, b, this.width);
  }
  override DrawCircle(c: { x: number; y: number }, r: number): void {
    this.rec('DrawCircle', c, r, this.fill, this.stroke, this.width);
  }
}

const LAYER_COLOR: Color4d = { r: 1, g: 0.5, b: 0.25, a: 1 };

function makeView(
  gal: GAL,
  netMode = NET_COLOR_MODE.OFF,
  netMap = new Map<number, Color4d>(),
): VIEW {
  const settings = {
    GetLayerColor: () => LAYER_COLOR,
    GetNetColorMode: () => netMode,
    GetNetColorMap: () => netMap,
  };
  return {
    GetGAL: () => gal,
    GetLayerOrder: (l: number) => (l === GAL_LAYER_ID.LAYER_SELECT_OVERLAY ? 0.5 : 0),
    GetPainter: () => ({ GetSettings: () => settings }),
  } as unknown as VIEW;
}

const iface = { GetBoardLayerFromPNSLayer: (l: number) => l, GetNetCode: () => 7 };

function seg(): PnsSegment {
  const s = new PnsSegment({ seg: { a: { x: 0, y: 0 }, b: { x: 1000, y: 0 } }, width: 200 }, null);
  s.setLayers(new PnsLayerRange(PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.F_Cu));
  return s;
}

describe('ROUTER_PREVIEW_ITEM.Update', () => {
  it('a segment: layer colour at alpha 0.8, depth stepped by the PNS layer, its own width', () => {
    const item = new ROUTER_PREVIEW_ITEM(seg(), iface, makeView(new REC_GAL()));
    const gal = new REC_GAL();
    const view = makeView(gal);
    item.ViewDraw(0, view);
    const draw = gal.calls.find((c) => c.op === 'DrawSegment')!;
    // m_originDepth = GetLayerOrder(LAYER_SELECT_OVERLAY) = 0.5;
    // m_depth = 0.5 - (layerStart + 1) * 0.001
    expect(draw.args[3]).toBeCloseTo(
      0.5 - (PCB_LAYER_ID.F_Cu + 1) * ROUTER_PREVIEW_LAYER_DEPTH_FACTOR,
      12,
    );
    expect(draw.args[2]).toBe(200);
    expect(draw.args[4]).toEqual({ ...LAYER_COLOR, a: 0.8 });
    expect(item.ViewGetLayers()).toEqual([PCB_LAYER_ID.F_Cu]);
  });

  it('PNS_HEAD_TRACE saturates the layer colour, PNS_HOVER_ITEM brightens then goes opaque', () => {
    const gal = new REC_GAL();
    new ROUTER_PREVIEW_ITEM(seg(), iface, makeView(gal), PNS_HEAD_TRACE).ViewDraw(0, makeView(gal));
    const head = gal.calls.find((c) => c.op === 'DrawSegment')!.args[4] as Color4d;
    // COLOR4D::Saturate(1.0) of (1, .5, .25): hue 20 deg, S = 1, V = 1 => (1, 1/3, 0).
    expect(head.r).toBe(1);
    expect(head.g).toBeCloseTo(1 / 3, 9);
    expect(head.b).toBe(0);
    expect(head.a).toBe(0.8);

    const gal2 = new REC_GAL();
    new ROUTER_PREVIEW_ITEM(seg(), iface, makeView(gal2), PNS_HOVER_ITEM).ViewDraw(
      0,
      makeView(gal2),
    );
    const hover = gal2.calls.find((c) => c.op === 'DrawSegment')!.args[4] as Color4d;
    expect(hover.a).toBe(1);
    expect(hover.r).toBeGreaterThan(LAYER_COLOR.r - 1e-9);
    expect(hover.b).toBeGreaterThan(LAYER_COLOR.b);
  });

  it('a violation marker turns the preview opaque green and forces the clearance on', () => {
    const s = seg();
    s.mark(LineMarker.MK_VIOLATION);
    const item = new ROUTER_PREVIEW_ITEM(s, iface, makeView(new REC_GAL()));
    item.SetClearance(50);
    const gal = new REC_GAL();
    item.ViewDraw(0, makeView(gal));
    const segs = gal.calls.filter((c) => c.op === 'DrawSegment');
    // clearance first (w + 2c), then the item itself
    expect(segs.map((c) => c.args[2])).toEqual([300, 200]);
    expect(segs[1]!.args[4]).toEqual({ r: 0, g: 1, b: 0, a: 1 });
  });

  it('net colour mode ALL takes the net colour map over the layer colour, on copper only', () => {
    const netColor: Color4d = { r: 0, g: 0, b: 1, a: 1 };
    const s = seg();
    s.setNet(3 as never);
    const gal = new REC_GAL();
    const view = makeView(gal, NET_COLOR_MODE.ALL, new Map([[7, netColor]]));
    new ROUTER_PREVIEW_ITEM(s, iface, view).ViewDraw(0, view);
    expect(gal.calls.find((c) => c.op === 'DrawSegment')!.args[4]).toEqual({ ...netColor, a: 0.8 });
  });
});

describe('ROUTER_PREVIEW_ITEM shapes', () => {
  it('a bare shape draws on LAYER_SELECT_OVERLAY at the origin depth, width 0', () => {
    const gal = new REC_GAL();
    const view = makeView(gal);
    const item = new ROUTER_PREVIEW_ITEM({ kind: 'circle', c: { x: 5, y: 6 }, r: 40 }, iface, view);
    item.ViewDraw(0, view);
    expect(item.ViewGetLayers()).toEqual([GAL_LAYER_ID.LAYER_SELECT_OVERLAY]);
    expect(item.GetOriginDepth()).toBe(0.5);
    const c = gal.calls.find((k) => k.op === 'DrawCircle')!;
    expect(c.args.slice(0, 2)).toEqual([{ x: 5, y: 6 }, 40]);
    // m_width 0 => no stroke
    expect(c.args[3]).toBe(false);
  });

  it('a semi-solid outside collision is sketched (no fill); in collision it is filled', () => {
    const gal = new REC_GAL();
    const view = makeView(gal);
    new ROUTER_PREVIEW_ITEM(seg(), iface, view, PNS_SEMI_SOLID).ViewDraw(0, view);
    expect(gal.calls.some((c) => c.op === 'DrawSegment')).toBe(true);
    expect(gal.fill).toBe(false);

    const gal2 = new REC_GAL();
    const view2 = makeView(gal2);
    new ROUTER_PREVIEW_ITEM(seg(), iface, view2, PNS_SEMI_SOLID | PNS_COLLISION).ViewDraw(0, view2);
    expect(gal2.fill).toBe(true);
  });

  it('the shape constructor drops the flags (m_flags( 0 ))', () => {
    const gal = new REC_GAL();
    const view = makeView(gal);
    new ROUTER_PREVIEW_ITEM(
      { kind: 'circle', c: { x: 0, y: 0 }, r: 5 },
      iface,
      view,
      PNS_SEMI_SOLID,
    ).ViewDraw(0, view);
    expect(gal.fill).toBe(true);
  });

  it('ViewBBox of a circle is its box; PR_POINT is +-100000 about the position', () => {
    const item = new ROUTER_PREVIEW_ITEM(
      { kind: 'circle', c: { x: 100, y: 100 }, r: 50 },
      iface,
      makeView(new REC_GAL()),
    );
    const b = item.ViewBBox();
    expect([b.GetX(), b.GetY(), b.GetWidth(), b.GetHeight()]).toEqual([50, 50, 100, 100]);
  });

  it('ViewBBox inflates by half the width (a segment item)', () => {
    const item = new ROUTER_PREVIEW_ITEM(seg(), iface, makeView(new REC_GAL()));
    const b = item.ViewBBox();
    // stadium [0..1000] x r=100 -> 1200 x 200, then inflated by width/2 = 100 each side
    expect(b.GetWidth()).toBe(1400);
    expect(b.GetHeight()).toBe(400);
  });
});

describe('ROUTER_PREVIEW_ITEM via', () => {
  it('goes on LAYER_VIAS in grey, and a circular hole draws the ring branch', () => {
    const via = new PnsVia(
      { x: 0, y: 0 },
      new PnsLayerRange(PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.B_Cu),
      600,
      300,
      null,
    );
    const gal = new REC_GAL();
    const view = makeView(gal);
    const item = new ROUTER_PREVIEW_ITEM(via, iface, view);
    expect(item.ViewGetLayers()).toEqual([GAL_LAYER_ID.LAYER_VIAS]);
    item.ViewDraw(0, view);
    const circles = gal.calls.filter((c) => c.op === 'DrawCircle');
    expect(circles.length).toBeGreaterThan(0);
    expect(circles[0]!.args[1]).toBeLessThanOrEqual(300);
  });
});
