// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * GTK3 overlay scrollbars.
 *
 * KiCad's frames get theirs from the GTK theme: no layout cost, invisible until
 * the pointer is inside that scrolled window, a 3 px indicator that thickens
 * near the edge. Ours were permanent 15 px gutters on every pane in every
 * editor.
 *
 * What this file can and cannot pin, stated rather than blurred:
 *  - it CAN pin that the stylesheet switches the native scrollbars off, which is
 *    the whole of the zero-layout-cost claim, and that every measured GTK value
 *    is present as a token instead of a per-editor constant;
 *  - it CAN pin the slider geometry and the proximity hysteresis, which are
 *    pure functions of numbers;
 *  - it CANNOT pin `offsetWidth - clientWidth === 0`, the hover reveal or the
 *    fade. The qa suite runs in node with no layout engine, and jsdom/happy-dom
 *    report 0 for every box, so an assertion about a gutter would pass against
 *    any stylesheet at all. Those three are evidenced by measurement in a real
 *    browser, recorded in the PR, not by a test here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  GTK_OVERLAY,
  thumbGeometry,
  scrollPosForThumbOffset,
  nextOverState,
  fadeRuns,
} from '@ziroeda/designer/src/ui/overlay_scrollbars.js';

const CSS = readFileSync(
  fileURLToPath(new URL('../../../designer/src/ui/shell.css', import.meta.url)),
  'utf8',
);
const CSS_CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

const rule = (selector: string): string => {
  const rx = new RegExp(
    `(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`,
  );
  return rx.exec(CSS_CODE)?.[2] ?? '';
};

describe('the native scrollbars are off, which is the zero-layout-cost half', () => {
  it('declares scrollbar-width: none, not thin', () => {
    // Measured in Chrome 149 on this machine: a scroller's gutter is 15 px at
    // `auto`, 10 px at `thin` and 0 px at `none`. Only `none` reaches 0, and
    // the Image Converter's preview measured 15 - i.e. `auto` - the whole time
    // `thin` was declared.
    expect(rule('*')).toMatch(/scrollbar-width:\s*none/);
    expect(CSS_CODE).not.toMatch(/scrollbar-width:\s*thin/);
  });

  it('puts it on a universal selector, because the property does not inherit', () => {
    // This is the actual root cause of the 15 px gutters: `scrollbar-width` is
    // not inherited (only `scrollbar-color` is), so the old
    // `:root { scrollbar-width: thin }` styled the document element and no pane
    // at all. Verified in the browser: with :root computing `none`, a freshly
    // appended scroller still computed `auto`.
    expect(rule(':root')).not.toMatch(/scrollbar-width/);
    expect(rule('*')).toMatch(/scrollbar-width/);
  });

  it('zeroes the WebKit pseudo-element too, for engines without the property', () => {
    // Chromium ignores ::-webkit-scrollbar once scrollbar-width is set and
    // Safari does the opposite, so both forms have to be present. `display:
    // none` on its own leaves WebKit reserving the width, hence the zeroes.
    const bar = rule('::-webkit-scrollbar');
    expect(bar).toMatch(/width:\s*0/);
    expect(bar).toMatch(/height:\s*0/);
  });

  it('keeps no per-pane scrollbar sizing anywhere else in the shell', () => {
    // The gutter was a theme-level defect on every scrollable pane in the app,
    // so the fix is one declaration; a second one would be a pane opting back
    // into the browser's bars.
    const widths = CSS_CODE.match(/scrollbar-width:/g) ?? [];
    expect(widths).toHaveLength(1);
  });
});

describe('the indicator carries the measured GTK values as tokens', () => {
  const root = rule(':root');

  it('sizes the idle indicator at 5 px: a 3 px core inside a 1 px border', () => {
    // [css] .overlay-indicator ... slider { min-width: 3px; border: 1px solid
    // black }.  [px] the white core measured x596..598 against a content edge
    // at x599.
    expect(root).toMatch(/--osb-indicator-size:\s*5px/);
    expect(GTK_OVERLAY.indicatorSize).toBe(3);
    expect(GTK_OVERLAY.indicatorTotal).toBe(5);
  });

  it('sizes the thickened bar at a 12 px band around a 6 px slider', () => {
    // [px] band x588..599, slider x591..596.
    expect(root).toMatch(/--osb-band:\s*12px/);
    expect(root).toMatch(/--osb-slider-size:\s*6px/);
    expect(root).toMatch(/--osb-slider-inset:\s*3px/);
    expect(GTK_OVERLAY.bandSize).toBe(GTK_OVERLAY.sliderSize + 2 * 3);
  });

  it('uses GTK opacities, which are what the sampled greys resolve to', () => {
    // #f7f7f7 at 0.4 over #272727 is #7a7a7a and #a6a6a6 at 0.8 over #272727 is
    // #8d8d8d; both were sampled exactly.
    expect(root).toMatch(/--osb-indicator-opacity:\s*0\.4/);
    expect(root).toMatch(/--osb-over-opacity:\s*0\.8/);
    expect(GTK_OVERLAY.indicatorOpacity).toBe(0.4);
    expect(GTK_OVERLAY.overOpacity).toBe(0.8);
  });

  it('uses the theme colours rather than the ones we invented', () => {
    // The old bars were #5a5f66 on a #262626 track, which is nothing GTK draws.
    expect(root).toMatch(/--osb-indicator-fill:\s*#f7f7f7/i);
    expect(root).toMatch(/--osb-slider-fill:\s*#a6a6a6/i);
    expect(root).toMatch(/--osb-slider-active:\s*#ee784e/i);
    expect(root).toMatch(/--osb-band-edge:\s*#181818/i);
    expect(CSS_CODE).not.toContain('#5a5f66');
  });

  it('animates at GTK 300 ms in and the measured ~1000 ms out', () => {
    // [css] scrollbar { transition: 300ms cubic-bezier(0.25,0.46,0.45,0.94) }.
    // [px] still full 1.7 s after the pointer left, ~37 % at 2.2 s, gone at
    // 2.7 s.
    expect(root).toMatch(/--osb-transition:\s*300ms cubic-bezier\(0\.25, 0\.46, 0\.45, 0\.94\)/);
    expect(root).toMatch(/--osb-fade-duration:\s*1000ms/);
    expect(GTK_OVERLAY.transitionMs).toBe(300);
    expect(GTK_OVERLAY.fadeDelayMs).toBe(2000);
    expect(GTK_OVERLAY.fadeDurationMs).toBe(1000);
  });

  it('draws the trough edge only in the thickened state', () => {
    // [px] the 1 px #181818 line at x587 appeared only with the bar thick; the
    // idle indicator is bare, over the content.
    expect(rule('.ze-osb.is-over')).toMatch(/box-shadow:\s*inset 1px 0 0 var\(--osb-band-edge\)/);
    expect(rule('.ze-osb')).not.toMatch(/box-shadow/);
  });

  it('keeps the layer out of the layout and out of the way of the pointer', () => {
    // Rule 1 in CSS form: a fixed layer cannot take space from a pane, and
    // pointer-events must stay off it or it would eat clicks over the content.
    const layer = rule('.ze-osb-layer');
    expect(layer).toMatch(/position:\s*fixed/);
    expect(layer).toMatch(/pointer-events:\s*none/);
    expect(rule('.ze-osb')).toMatch(/pointer-events:\s*none/);
    // ...and back on only where the bar is grabbable.
    expect(rule('.ze-osb.is-over')).toMatch(/pointer-events:\s*auto/);
  });
});

describe('slider geometry, as GtkRange computes it', () => {
  it('is proportional to the visible fraction, inside a 2 px end margin', () => {
    // The live probe: a 400 px viewport over 2000 px of content put the
    // indicator at y2..y77. GtkRange allocates 400/2000 of the whole 400 px
    // trough = 80 px, and the slider's 2 px margin draws 76 of it at offset 2.
    const geo = thumbGeometry(400, 2000, 0);
    expect(geo).toEqual({ offset: 2, length: 76 });
  });

  it('hides the bar outright when the axis does not scroll', () => {
    // GTK's policy AUTOMATIC, which is what wxScrolledWindow asks for.
    expect(thumbGeometry(400, 400, 0)).toBeNull();
    expect(thumbGeometry(400, 100, 0)).toBeNull();
  });

  it('clamps to the 40 px minimum length GTK declares', () => {
    // [css] scrollbar.vertical slider { min-height: 40px }, repeated by the
    // overlay-indicator variant so it holds in both states.
    const geo = thumbGeometry(400, 100000, 0);
    expect(geo?.length).toBe(GTK_OVERLAY.minLength);
  });

  it('puts the end of the slider at the end of the track when scrolled to the end', () => {
    const viewport = 400;
    const content = 2000;
    const geo = thumbGeometry(viewport, content, content - viewport);
    expect(geo).not.toBeNull();
    if (!geo) return;
    // Symmetric with the 2 px it starts at: the probe measured y2..y77 at the
    // top of a 400 px trough, so the far end has to leave the same 2 px.
    expect(geo.offset + geo.length).toBe(viewport - GTK_OVERLAY.margin);
  });

  it('round-trips through the drag inverse', () => {
    for (const pos of [0, 250, 800, 1600]) {
      const geo = thumbGeometry(400, 2000, pos);
      expect(geo).not.toBeNull();
      if (!geo) continue;
      const back = scrollPosForThumbOffset(400, 2000, geo.offset);
      // The offset is rounded to a whole pixel, so the recovered position is
      // within one pixel's worth of scroll.
      const perPixel = (2000 - 400) / (400 - (geo.length + 4));
      expect(Math.abs(back - pos)).toBeLessThanOrEqual(perPixel + 1);
    }
  });

  it('clamps a drag past either end', () => {
    expect(scrollPosForThumbOffset(400, 2000, -500)).toBe(0);
    expect(scrollPosForThumbOffset(400, 2000, 5000)).toBe(1600);
  });
});

describe('the fade clock runs from the last motion, not from the pointer leaving', () => {
  it('fades the thin indicator with the pointer still inside the pane', () => {
    // He reported this before the measurement caught up with him, and the
    // measurement agrees: held perfectly still in the middle of a live
    // GtkScrolledWindow the indicator was at full strength through 1.8 s, ~29 %
    // at 2.3 s and gone at 2.8 s, pointer never having left. A jiggle in the
    // same spot brought it straight back.
    expect(fadeRuns('indicator', false)).toBe(true);
  });

  it('never fades the thickened bar', () => {
    // Parked in the proximity zone it was still fully drawn at 8.5 s: that is
    // the state you are in when you are aiming at the bar.
    expect(fadeRuns('over', false)).toBe(false);
  });

  it('never fades mid-drag', () => {
    expect(fadeRuns('indicator', true)).toBe(false);
    expect(fadeRuns('over', true)).toBe(false);
  });

  it('has nothing to fade once hidden', () => {
    expect(fadeRuns('hidden', false)).toBe(false);
  });
});

describe('the proximity hysteresis, recovered from where GTK flipped', () => {
  it('thickens only once the pointer is close to the edge', () => {
    // The band is 12 px and GTK's INDICATOR_CLOSE_DISTANCE is 5: measured, the
    // bar was thin with the pointer 24 px in from the content edge.
    expect(nextOverState(24, false)).toBe(false);
    expect(nextOverState(GTK_OVERLAY.overEnterPx, false)).toBe(true);
    expect(nextOverState(GTK_OVERLAY.overEnterPx + 1, false)).toBe(false);
  });

  it('holds the thick state further out than it takes to enter it', () => {
    // Without the hysteresis a pointer resting on the boundary flickers. The
    // measured bracket: still thick at 19 px in, thin at 24 px.
    expect(nextOverState(19, true)).toBe(true);
    expect(nextOverState(24, true)).toBe(false);
    expect(GTK_OVERLAY.overLeavePx).toBeGreaterThan(GTK_OVERLAY.overEnterPx);
  });
});
