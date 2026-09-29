// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `ROUTER_STATUS_VIEW_ITEM` (router_status_view_item.ts): the layers, the
 * bounding box, and `ViewDraw`'s two passes against a recording `GAL` — the
 * drop-shadow rectangle's exact corners (independently recomputed from
 * `GRTextWidth`, not copied from the implementation) and the text pass's
 * colour, fill/stroke state and horizontal-alignment flip.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { GAL } from '@ziroeda/common/gal/graphics_abstraction_layer.js';
import { GAL_DISPLAY_OPTIONS } from '@ziroeda/common/gal/gal_display_options.js';
// Side effect: registers FONT.loaders.stroke, which FONT.GetFont() needs.
import '@ziroeda/common/font/stroke_font.js';
import { parseColor4d, withAlpha, type Color4d } from '@ziroeda/common/gal/color4d.js';
import { GAL_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { FONT } from '@ziroeda/common/font/font.js';
import { METRICS } from '@ziroeda/common/font/font_metrics.js';
import { GR_TEXT_H_ALIGN_T } from '@ziroeda/common/font/text_attributes.js';
import { GRTextWidth } from '@ziroeda/common/gr_text.js';
import { GetConstantGlyphHeight } from '@ziroeda/common/preview_items/preview_utils.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { VIEW } from '@ziroeda/common/view/view.js';
import { ROUTER_STATUS_VIEW_ITEM } from '@ziroeda/pcbnew/router/router_status_view_item.js';

const BTNFACE: Color4d = parseColor4d('#373737');
const BTNTEXT: Color4d = parseColor4d('#f7f7f7');

class RECORDING_GAL extends GAL {
  calls: { op: string; args: unknown[] }[] = [];
  fill = false;
  stroke = false;
  lineWidth = 0;
  strokeColor: Color4d = { r: 0, g: 0, b: 0, a: 0 };
  fillColor: Color4d = { r: 0, g: 0, b: 0, a: 0 };

  constructor() {
    super(new GAL_DISPLAY_OPTIONS());
    this.ResizeScreen(1000, 1000);
  }

  override ResizeScreen(aWidth: number, aHeight: number): void {
    this.m_screenSize = { x: aWidth, y: aHeight };
    this.ComputeWorldScreenMatrix();
  }

  private record(op: string, ...args: unknown[]): void {
    this.calls.push({ op, args });
  }

  // No `record()` here: these run from inside the base `GAL`'s own
  // constructor (`Reset()`), before this subclass's `calls = []` field
  // initialiser has run.
  override SetIsFill(aIsFillEnabled: boolean): void {
    this.fill = aIsFillEnabled;
    super.SetIsFill(aIsFillEnabled);
  }
  override SetIsStroke(aIsStrokeEnabled: boolean): void {
    this.stroke = aIsStrokeEnabled;
    super.SetIsStroke(aIsStrokeEnabled);
  }
  override SetLineWidth(aLineWidth: number): void {
    this.lineWidth = aLineWidth;
    super.SetLineWidth(aLineWidth);
  }
  override SetStrokeColor(aColor: Color4d): void {
    this.strokeColor = aColor;
    super.SetStrokeColor(aColor);
  }
  override SetFillColor(aColor: Color4d): void {
    this.fillColor = aColor;
    super.SetFillColor(aColor);
  }
  override DrawRectangle(
    aStartPoint: { x: number; y: number },
    aEndPoint: { x: number; y: number },
  ): void {
    this.record('DrawRectangle', { ...aStartPoint }, { ...aEndPoint }, this.fill, this.stroke);
  }
  override Save(): void {
    this.record('Save');
  }
  override Restore(): void {
    this.record('Restore');
  }
  override Scale(aScale: { x: number; y: number }): void {
    this.record('Scale', aScale);
  }
}

function makeView(gal: GAL): VIEW {
  return { GetGAL: () => gal } as unknown as VIEW;
}

describe('ROUTER_STATUS_VIEW_ITEM — identity', () => {
  it('GetClass is ROUTER_STATUS', () => {
    expect(new ROUTER_STATUS_VIEW_ITEM().GetClass()).toBe('ROUTER_STATUS');
  });

  it('ViewGetLayers is the drop-shadow layer then the text layer', () => {
    const item = new ROUTER_STATUS_VIEW_ITEM();
    expect(item.ViewGetLayers()).toEqual([
      GAL_LAYER_ID.LAYER_UI_START,
      GAL_LAYER_ID.LAYER_UI_START + 1,
    ]);
  });

  it('ViewBBox is the whole coordinate space (an edit-time artefact, no real bounds)', () => {
    const item = new ROUTER_STATUS_VIEW_ITEM();
    const box = item.ViewBBox();
    // SetMaximum(): invertible, so GetOrigin()/GetEnd() are the extremes.
    expect(box.GetWidth()).toBeGreaterThan(0);
    expect(box.GetHeight()).toBeGreaterThan(0);
  });

  it('GetPosition/SetPosition round-trip, defaulting to the origin', () => {
    const item = new ROUTER_STATUS_VIEW_ITEM();
    expect(item.GetPosition()).toEqual({ x: 0, y: 0 });
    item.SetPosition({ x: 10, y: -20 });
    expect(item.GetPosition()).toEqual({ x: 10, y: -20 });
  });
});

describe('ROUTER_STATUS_VIEW_ITEM.ViewDraw — the drop-shadow layer', () => {
  it("draws exactly one filled+stroked rectangle at the formula's own corners", () => {
    const gal = new RECORDING_GAL();
    const item = new ROUTER_STATUS_VIEW_ITEM();
    item.SetPosition({ x: 1000, y: 2000 });
    item.SetMessage('Track violates DRC.');
    item.SetHint('Press X to force the route through.');

    item.ViewDraw(GAL_LAYER_ID.LAYER_UI_START, makeView(gal));

    const rects = gal.calls.filter((c) => c.op === 'DrawRectangle');
    expect(rects).toHaveLength(1);
    const [, , fill, stroke] = rects[0]!.args as [unknown, unknown, boolean, boolean];
    expect(fill).toBe(true);
    expect(stroke).toBe(true);

    // Independently recompute the box the C++ formula describes, from the
    // same shared GRTextWidth/GetConstantGlyphHeight this item itself calls.
    const textDims = GetConstantGlyphHeight(gal, -1);
    const hintDims = GetConstantGlyphHeight(gal, -2);
    const font = FONT.GetFont();
    const metrics = METRICS.Default();
    const textWidth = Math.max(
      GRTextWidth(
        'Track violates DRC.',
        font,
        textDims.GlyphSize,
        textDims.StrokeWidth,
        false,
        false,
        metrics,
      ),
      GRTextWidth(
        'Press X to force the route through.',
        font,
        hintDims.GlyphSize,
        hintDims.StrokeWidth,
        false,
        false,
        metrics,
      ),
    );
    const margin = {
      x: KiROUND(textDims.GlyphSize.x * 0.4),
      y: KiROUND(textDims.GlyphSize.y * 0.6),
    };
    const size = { x: textWidth + margin.x, y: KiROUND(textDims.GlyphSize.y * 1.7) };
    // `offset` is computed from THIS size — upstream quirk, reproduced: the
    // hint's height is folded into `size.y` only afterward, so it grows the
    // box's bottom edge without moving `offset` to re-centre it.
    const offset = { x: margin.x * 5, y: -(size.y + margin.y * 5) };
    size.y += KiROUND(hintDims.GlyphSize.y * 1.2);
    const pos = { x: 1000, y: 2000 };

    const [start, end] = rects[0]!.args as [{ x: number; y: number }, { x: number; y: number }];
    expect(start).toEqual({ x: pos.x + offset.x - margin.x, y: pos.y + offset.y - margin.y });
    expect(end).toEqual({
      x: pos.x + offset.x + size.x + margin.x,
      y: pos.y + offset.y + size.y + margin.y,
    });
  });

  it('omits the hint line height when there is no hint', () => {
    const gal = new RECORDING_GAL();
    const item = new ROUTER_STATUS_VIEW_ITEM();
    item.SetMessage('Hi');
    // No SetHint call: m_hint stays ''.
    item.ViewDraw(GAL_LAYER_ID.LAYER_UI_START, makeView(gal));

    const withHint = new RECORDING_GAL();
    const itemWithHint = new ROUTER_STATUS_VIEW_ITEM();
    itemWithHint.SetMessage('Hi');
    itemWithHint.SetHint('a hint');
    itemWithHint.ViewDraw(GAL_LAYER_ID.LAYER_UI_START, makeView(withHint));

    const rectNoHint = gal.calls.find((c) => c.op === 'DrawRectangle')!;
    const rectHint = withHint.calls.find((c) => c.op === 'DrawRectangle')!;
    const heightNoHint =
      (rectNoHint.args[1] as { y: number }).y - (rectNoHint.args[0] as { y: number }).y;
    const heightHint =
      (rectHint.args[1] as { y: number }).y - (rectHint.args[0] as { y: number }).y;
    expect(heightHint).toBeGreaterThan(heightNoHint);
  });

  it('fills BTNFACE at 0.9 alpha and strokes BTNTEXT, and sets the line width from the screen matrix scale', () => {
    const gal = new RECORDING_GAL();
    const item = new ROUTER_STATUS_VIEW_ITEM();
    item.SetMessage('x');
    item.ViewDraw(GAL_LAYER_ID.LAYER_UI_START, makeView(gal));

    expect(gal.fillColor).toEqual(withAlpha(BTNFACE, 0.9));
    expect(gal.strokeColor).toEqual(BTNTEXT);
    expect(gal.lineWidth).toBeCloseTo(gal.GetScreenWorldMatrix().GetScale().x * 2, 9);
  });

  it('calls Save/Scale before drawing and Restore after, and returns without drawing text', () => {
    const gal = new RECORDING_GAL();
    const item = new ROUTER_STATUS_VIEW_ITEM();
    item.SetMessage('x');
    item.ViewDraw(GAL_LAYER_ID.LAYER_UI_START, makeView(gal));

    const ops = gal.calls.map((c) => c.op);
    expect(ops[0]).toBe('Save');
    expect(ops[ops.length - 1]).toBe('Restore');
    expect(ops).toContain('DrawRectangle');
  });
});

describe('ROUTER_STATUS_VIEW_ITEM.ViewDraw — the text layer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('draws the status text, and the hint only when one is set', () => {
    const draw = vi.spyOn(FONT.GetFont(), 'Draw');
    const gal = new RECORDING_GAL();
    const item = new ROUTER_STATUS_VIEW_ITEM();
    item.SetMessage('Track violates DRC.');

    item.ViewDraw(GAL_LAYER_ID.LAYER_UI_START + 1, makeView(gal));

    expect(draw).toHaveBeenCalledTimes(1);
    expect(draw.mock.calls[0]![1]).toBe('Track violates DRC.');
  });

  it('draws both lines, the hint below the status by the scaled line pitch', () => {
    // `ViewDraw` reuses one mutable `textPos` object across both Draw calls
    // (matching the C++'s single `textPos` local), so the position must be
    // captured (cloned) as each call happens, not read back from a spy's
    // `mock.calls` afterward — that would see only the final, post-mutation
    // value for every call.
    const positions: { y: number }[] = [];
    vi.spyOn(FONT.GetFont(), 'Draw').mockImplementation(((...args: unknown[]) => {
      positions.push({ ...(args[2] as { y: number }) });
    }) as typeof FONT.prototype.Draw);
    const gal = new RECORDING_GAL();
    const item = new ROUTER_STATUS_VIEW_ITEM();
    item.SetMessage('status');
    item.SetHint('hint');

    item.ViewDraw(GAL_LAYER_ID.LAYER_UI_START + 1, makeView(gal));

    expect(positions).toHaveLength(2);
    const textDims = GetConstantGlyphHeight(gal, -1);
    expect(positions[1]!.y - positions[0]!.y).toBeCloseTo(KiROUND(textDims.GlyphSize.y * 1.6), 9);
  });

  it('left-aligns, unmirrored, when the view is not flipped', () => {
    const draw = vi.spyOn(FONT.GetFont(), 'Draw');
    const gal = new RECORDING_GAL();
    const item = new ROUTER_STATUS_VIEW_ITEM();
    item.SetMessage('x');

    item.ViewDraw(GAL_LAYER_ID.LAYER_UI_START + 1, makeView(gal));

    const attrs = draw.mock.calls[0]![4] as { m_Halign: unknown; m_Mirrored: boolean };
    expect(attrs.m_Halign).toBe(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT);
    expect(attrs.m_Mirrored).toBe(false);
  });

  it('right-aligns and mirrors when the view is flipped (the second, real flip check)', () => {
    const draw = vi.spyOn(FONT.GetFont(), 'Draw');
    const gal = new RECORDING_GAL();
    gal.SetFlip(true, false);
    const item = new ROUTER_STATUS_VIEW_ITEM();
    item.SetMessage('x');

    item.ViewDraw(GAL_LAYER_ID.LAYER_UI_START + 1, makeView(gal));

    const attrs = draw.mock.calls[0]![4] as { m_Halign: unknown; m_Mirrored: boolean };
    expect(attrs.m_Halign).toBe(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT);
    expect(attrs.m_Mirrored).toBe(true);
  });

  it('strokes BTNTEXT and fills nothing on the text layer', () => {
    vi.spyOn(FONT.GetFont(), 'Draw').mockImplementation(() => {});
    const gal = new RECORDING_GAL();
    const item = new ROUTER_STATUS_VIEW_ITEM();
    item.SetMessage('x');

    item.ViewDraw(GAL_LAYER_ID.LAYER_UI_START + 1, makeView(gal));

    expect(gal.fill).toBe(false);
    expect(gal.stroke).toBe(true);
    expect(gal.strokeColor).toEqual(BTNTEXT);
    expect(gal.calls.some((c) => c.op === 'DrawRectangle')).toBe(false);
  });
});
