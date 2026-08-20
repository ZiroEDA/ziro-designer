// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `ZOOM_TOOL::selectRegion` (`common/tool/zoom_tool.cpp:110-165`), the
 * drag-a-rectangle zoom behind `ACTIONS::zoomTool`.
 *
 * Shared for the same reason the upstream file is in `common/`: ten frames
 * register it. Every expectation below is worked out from the four lines of
 * C++ quoted in `ui/zoom_tool.ts`, not read back off our own output.
 */
import { describe, expect, it } from 'vitest';
import {
  SELECTION_AREA_FILL,
  SELECTION_AREA_STROKE,
  zoomAreaTarget,
} from '@ziroeda/designer/src/ui/zoom_tool.js';
import {
  clampViewScale,
  clampZoomFactor,
  ZOOM_LIMITS,
} from '@ziroeda/designer/src/ui/zoom_settings.js';
import {
  scaleForZoomFactor,
  zoomFactorForScale,
} from '@ziroeda/designer/src/ui/status_format.js';
import { SCH_IU_PER_MM } from '@ziroeda/common';

/** A 800x600 device-pixel canvas at scale 1, so the viewport is 800x600 world. */
const VIEW = { scale: 1, width: 800, height: 600 };

describe('the scale it lands on', () => {
  /**
   * A 400x300 box in an 800x600 viewport is half the width and half the
   * height, so both axis ratios are 0.5, `ratio` is 0.5, and a left-drag
   * divides: 1 / 0.5 = 2. Twice the magnification, which is what halving the
   * framed area should give.
   */
  it('doubles the scale for a box half the viewport across', () => {
    const r = zoomAreaTarget({ a: { x: 0, y: 0 }, b: { x: 400, y: 300 }, out: false }, VIEW);
    expect(r?.scale).toBe(2);
  });

  /**
   * `ratio` is `std::max` of the two, not the min and not their product. This
   * box is 400 wide (ratio 0.5) and 60 tall (ratio 0.1); the max is 0.5, so the
   * scale is 2 and the whole box fits. Taking the min would give 10 and crop
   * the width to a fifth of the box.
   */
  it('takes the LARGER axis ratio, so the whole box fits', () => {
    const r = zoomAreaTarget({ a: { x: 0, y: 0 }, b: { x: 400, y: 60 }, out: false }, VIEW);
    expect(r?.scale).toBe(2);

    const tall = zoomAreaTarget({ a: { x: 0, y: 0 }, b: { x: 80, y: 300 }, out: false }, VIEW);
    expect(tall?.scale).toBe(2);
  });

  /**
   * `if( evt->IsMouseUp( BUT_LEFT ) ) scale = GetScale() / ratio; else
   * scale = GetScale() * ratio;` - a RIGHT drag multiplies where a left drag
   * divides, so the same rectangle zooms out by the same factor.
   */
  it('zooms out by the same factor on a right-drag', () => {
    const area = { a: { x: 0, y: 0 }, b: { x: 400, y: 300 } };
    expect(zoomAreaTarget({ ...area, out: false }, VIEW)?.scale).toBe(2);
    expect(zoomAreaTarget({ ...area, out: true }, VIEW)?.scale).toBe(0.5);
  });

  /** `sSize = ToWorld( GetClientSize(), false )` is the extent OVER the scale. */
  it('is relative to the current scale, not absolute', () => {
    const zoomedIn = { scale: 4, width: 800, height: 600 };
    // At scale 4 the viewport is 200x150 world units, so a 100x75 box is again
    // half of it: ratio 0.5, and 4 / 0.5 = 8.
    const r = zoomAreaTarget({ a: { x: 0, y: 0 }, b: { x: 100, y: 75 }, out: false }, zoomedIn);
    expect(r?.scale).toBe(8);
  });

  it('is unaffected by which corner the drag started from', () => {
    const forward = zoomAreaTarget({ a: { x: 0, y: 0 }, b: { x: 400, y: 300 }, out: false }, VIEW);
    const backward = zoomAreaTarget({ a: { x: 400, y: 300 }, b: { x: 0, y: 0 }, out: false }, VIEW);
    expect(backward?.scale).toBe(forward?.scale);
    expect(backward?.centre).toEqual(forward?.centre);
  });
});

describe('the point it centres on', () => {
  /** `view->SetCenter( selectionBox.Centre() )`. */
  it('is the box centre, not the drag origin', () => {
    const r = zoomAreaTarget({ a: { x: 100, y: 40 }, b: { x: 500, y: 340 }, out: false }, VIEW);
    expect(r?.centre).toEqual({ x: 300, y: 190 });
  });

  it('centres the same way on a right-drag', () => {
    const r = zoomAreaTarget({ a: { x: 100, y: 40 }, b: { x: 500, y: 340 }, out: true }, VIEW);
    expect(r?.centre).toEqual({ x: 300, y: 190 });
  });
});

describe('the drags that do nothing', () => {
  /**
   * `if( selectionBox.GetWidth() == 0 || selectionBox.GetHeight() == 0 ) break;`
   * - the tool leaves the view exactly as it was. A click rather than a drag
   * lands here, which is why clicking with the zoom tool armed does not throw
   * the view somewhere.
   */
  it('ignores a zero-width or zero-height box', () => {
    expect(zoomAreaTarget({ a: { x: 5, y: 5 }, b: { x: 5, y: 300 }, out: false }, VIEW)).toBe(null);
    expect(zoomAreaTarget({ a: { x: 5, y: 5 }, b: { x: 400, y: 5 }, out: false }, VIEW)).toBe(null);
  });

  it('ignores a click, where both are zero', () => {
    expect(zoomAreaTarget({ a: { x: 7, y: 9 }, b: { x: 7, y: 9 }, out: false }, VIEW)).toBe(null);
  });

  it('refuses a viewport with no scale rather than dividing by it', () => {
    const dead = { scale: 0, width: 800, height: 600 };
    expect(zoomAreaTarget({ a: { x: 0, y: 0 }, b: { x: 400, y: 300 }, out: false }, dead)).toBe(
      null,
    );
  });
});

describe('the rubber band', () => {
  /**
   * `KIGFX::PREVIEW::SELECTION_AREA`'s dark scheme
   * (`common/preview_items/selection_area.cpp:44-52`). A default-constructed
   * area is INSIDE_RECTANGLE with no additive/subtractive/xor flag, so it takes
   * `normal` filled and `outline_l2r` stroked (`:107-121`) - "slight blue" at
   * 30 % over a solid yellow outline. COLOR4D is 0..1, so 0.3 -> 76.5 -> 77 and
   * 0.4 -> 102.
   */
  it('is KiCad’s slight blue over yellow, not a colour of ours', () => {
    expect(SELECTION_AREA_FILL).toBe('rgb(77 77 179 / 30%)');
    expect(SELECTION_AREA_STROKE).toBe('rgb(255 255 102)');
  });
});

// ---------------------------------------------------------------------------
// the zoom CAP
// ---------------------------------------------------------------------------

describe('the zoom limits', () => {
  /**
   * `include/zoom_defines.h:43-66`, each installed by its draw panel with one
   * `SetScaleLimits( max, min )` call. Written out here rather than read off
   * the table, so a typo in the table fails instead of agreeing with itself.
   */
  it('are the four pairs zoom_defines.h declares', () => {
    expect(ZOOM_LIMITS.eeschema).toEqual({ min: 0.01, max: 100 });
    expect(ZOOM_LIMITS.pl_editor).toEqual({ min: 0.05, max: 20 });
    expect(ZOOM_LIMITS.gerbview).toEqual({ min: 0.02, max: 5000 });
    expect(ZOOM_LIMITS.pcbnew).toEqual({ min: 0.1, max: 50000 });
  });

  /** The symbol editor has no row of its own (`symbol_editor_edit_tool.cpp:206`). */
  it('give the symbol editor eeschema’s pair, because upstream reuses it', () => {
    expect(ZOOM_LIMITS.symbol_editor).toEqual(ZOOM_LIMITS.eeschema);
  });

  /**
   * The drawing sheet is the tightest of the four by a wide margin - 20x
   * against pcbnew's 50000x - which is the whole of why "zoom for ever" is
   * wrong there specifically. A sheet has nothing on it worth 50000x.
   */
  it('cap the drawing sheet at 20x, not somewhere near pcbnew', () => {
    expect(ZOOM_LIMITS.pl_editor.max).toBe(20);
    expect(ZOOM_LIMITS.pl_editor.max).toBeLessThan(ZOOM_LIMITS.pcbnew.max / 1000);
  });
});

describe('clampZoomFactor', () => {
  /** `if( aScale < m_minScale ) m_scale = m_minScale; else if( ... )` (`view.cpp:583-588`). */
  it('pins to the limit rather than refusing the zoom', () => {
    expect(clampZoomFactor(1e6, 'pl_editor')).toBe(20);
    expect(clampZoomFactor(1e-6, 'pl_editor')).toBe(0.05);
  });

  it('leaves anything inside the range exactly alone', () => {
    expect(clampZoomFactor(1, 'pl_editor')).toBe(1);
    expect(clampZoomFactor(19.999, 'pl_editor')).toBe(19.999);
    expect(clampZoomFactor(0.0501, 'pl_editor')).toBe(0.0501);
  });

  /** The bounds themselves are legal values - the comparison is strict. */
  it('admits the boundary values', () => {
    expect(clampZoomFactor(20, 'pl_editor')).toBe(20);
    expect(clampZoomFactor(0.05, 'pl_editor')).toBe(0.05);
  });

  it('applies a different pair per app, not one global pair', () => {
    // 100x is legal in gerbview and pcbnew, and over the cap on a drawing sheet.
    expect(clampZoomFactor(100, 'gerbview')).toBe(100);
    expect(clampZoomFactor(100, 'pcbnew')).toBe(100);
    expect(clampZoomFactor(100, 'pl_editor')).toBe(20);
  });

  it('refuses a zero or negative scale rather than propagating it', () => {
    expect(clampZoomFactor(0, 'gerbview')).toBe(0.02);
    expect(clampZoomFactor(-3, 'gerbview')).toBe(0.02);
  });
});

describe('clampViewScale', () => {
  /**
   * Our canvases hold device-pixels-per-IU where KiCad's `m_scale` is the GAL
   * zoom factor; `SetScale` ends `m_gal->SetZoomFactor( m_scale )`
   * (`view.cpp:590`), so the two are the same quantity through
   * `zoomFactorForScale`. This checks the round trip lands back on the cap.
   */
  it('converts, clamps, and converts back', () => {
    const dpr = 2;
    const huge = scaleForZoomFactor(1e5, dpr, SCH_IU_PER_MM);
    const capped = clampViewScale(huge, 'pl_editor', dpr, SCH_IU_PER_MM);
    expect(zoomFactorForScale(capped, dpr, SCH_IU_PER_MM)).toBeCloseTo(20, 9);
  });

  it('returns the very same number when nothing needed clamping', () => {
    const dpr = 1;
    const ok = scaleForZoomFactor(3, dpr, SCH_IU_PER_MM);
    expect(clampViewScale(ok, 'pl_editor', dpr, SCH_IU_PER_MM)).toBe(ok);
  });

  /** The cap is in zoom-factor space, so it must survive a different DPR. */
  it('caps at the same zoom factor whatever the device pixel ratio', () => {
    for (const dpr of [1, 1.5, 2, 3]) {
      const huge = scaleForZoomFactor(1e5, dpr, SCH_IU_PER_MM);
      const capped = clampViewScale(huge, 'pl_editor', dpr, SCH_IU_PER_MM);
      expect(zoomFactorForScale(capped, dpr, SCH_IU_PER_MM)).toBeCloseTo(20, 9);
    }
  });
});
