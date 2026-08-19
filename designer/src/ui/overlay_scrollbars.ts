// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * GTK3 overlay scrollbars, which is what every KiCad frame gets for free.
 *
 * KiCad never styles a scrollbar. `wxScrolledWindow`/`wxScrolledCanvas` wrap a
 * `GtkScrolledWindow`, and under GTK3 with
 * `org.gnome.desktop.interface overlay-scrolling = true` (the default, and true
 * on this machine) that widget draws *overlay* scrollbars:
 *
 *   1. they cost nothing in layout — the content is allocated the full width of
 *      the pane and the indicator floats on top of it;
 *   2. they are invisible until the pointer is inside *that* scrolled window,
 *      and fade out again once it leaves;
 *   3. they are a 3 px indicator that thickens into a grabbable bar only when
 *      the pointer comes close to the edge.
 *
 * A browser gives none of that. Its scrollbars are permanent and take layout
 * space: on the Image Converter, `offsetWidth - clientWidth` was 15 on both
 * axes, so a 963x816 preview pane showed only 948x801 of image — ~43 px less
 * image width than KiCad at the same window size. `overflow: overlay` is
 * removed from the platform and `scrollbar-width: thin` still reserves a
 * gutter, so the only faithful route is to switch the native scrollbars off
 * (`scrollbar-width: none`, which makes `offsetWidth - clientWidth` 0) and draw
 * GTK's indicator ourselves.
 *
 * Every number below was measured on this machine rather than chosen, from two
 * sources named per constant:
 *   [css] the Yaru-dark GTK3 stylesheet, extracted with
 *         `gresource extract /usr/share/themes/Yaru-dark/gtk-3.0/gtk.gresource
 *          /com/ubuntu/themes/Yaru-dark/3.0/gtk-dark.css`, "Scrollbars" section;
 *   [px]  pixel profiles of a live `Gtk.ScrolledWindow` driven by XTEST and
 *         captured with `Gdk.pixbuf_get_from_window`.
 *
 * This is deliberately one shared module rather than a rule in
 * `imageConverter.css`: the same gutters were on every scrollable pane in every
 * editor, and KiCad's counterpart is a property of the GTK theme, not of any
 * one frame.
 */

/**
 * The measured GTK3/Yaru overlay-scrollbar constants.
 *
 * Exported so the geometry helpers below can be exercised without a DOM, and
 * so the stylesheet's copy of the same numbers can be checked against them.
 */
export const GTK_OVERLAY = {
  /** [css] `.overlay-indicator:not(.dragging):not(.hovering) slider
      { min-width: 3px; min-height: 3px }`. [px] the white core measured 3 px
      (x596..598 against a content edge at x599). */
  indicatorSize: 3,
  /** [css] the same slider carries `border: 1px solid black`, so the indicator
      occupies 5 px in total; at opacity 0.4 over a dark canvas the border is
      all but invisible, which is why it reads as a 3 px hairline. */
  indicatorTotal: 5,
  /** [px] the "over" state: the slider measured 6 px (x591..596) inside a 12 px
      band (x588..599) with a 1 px `#181818` line at x587.
      [css] `scrollbar slider { min-width: 6px; margin: -1px;
      border: 4px solid transparent }` = 6 + 8 - 2 = 12. */
  sliderSize: 6,
  bandSize: 12,
  /** [css] `.overlay-indicator ... .vertical slider { margin: 2px 0 }`.
      [px] the indicator started at y2 and ended at y77 in a 400 px track. */
  margin: 2,
  /** [css] `scrollbar.vertical slider { min-height: 40px }` — and the
      indicator variant repeats it, so it holds in both states. */
  minLength: 40,
  /** [css] `.overlay-indicator:not(.dragging):not(.hovering) { opacity: 0.4 }`.
      [px] `#F7F7F7` at 0.4 over `#272727` is `#7a7a7a`, which is exactly what
      the idle indicator sampled. */
  indicatorOpacity: 0.4,
  /** [css] `.overlay-indicator.dragging, .overlay-indicator.hovering
      { opacity: 0.8 }`. [px] `#a6a6a6` at 0.8 over `#272727` is `#8d8d8d`,
      which is exactly what the thickened bar sampled. */
  overOpacity: 0.8,
  /** [css] `scrollbar { transition: 300ms cubic-bezier(0.25,0.46,0.45,0.94) }`
      — the appear/thicken animation. */
  transitionMs: 300,
  /** [px] after the pointer left the window the indicator was still at full
      strength at 1.7 s, ~37 % at 2.2 s and gone at 2.7 s: a hold of ~2000 ms
      followed by a ~1000 ms fade. */
  fadeDelayMs: 2000,
  fadeDurationMs: 1000,
  /** GTK's own proximity hysteresis, recovered from where the state flipped:
      the bar was still thick with the pointer 19 px in from the content edge
      and thin at 24 px. The band is 12 px, so that brackets GTK's
      INDICATOR_CLOSE_DISTANCE 5 / INDICATOR_FAR_DISTANCE 10 — enter "over"
      within 12+5, leave it beyond 12+10. */
  overEnterPx: 17,
  overLeavePx: 22,
} as const;

/** Where the indicator sits in its track, in CSS pixels along the scroll axis. */
export interface ThumbGeometry {
  /** Distance from the start of the track to the start of the indicator. */
  offset: number;
  /** Length of the indicator along the scroll axis. */
  length: number;
}

/**
 * GTK's slider geometry for one axis.
 *
 * `GtkRange` allocates the slider the visible fraction of the *whole* trough —
 * `viewport / content * viewport` — clamps it to `min-height`/`min-width`
 * (40 px), and the slider's own 2 px margin then insets what is drawn inside
 * that allocation. Both halves matter: a 400 px viewport over 2000 px of
 * content allocates 80 px and draws 76 of it, which is exactly the y2..y77 the
 * live probe measured. Computing straight into a shortened track would give 79
 * and be a pixel out at both ends.
 *
 * Returns null when the axis does not scroll, which is GTK's
 * `policy == AUTOMATIC` hiding the bar outright.
 */
export const thumbGeometry = (
  viewport: number,
  content: number,
  scrollPos: number,
  margin = GTK_OVERLAY.margin,
  minLength = GTK_OVERLAY.minLength,
): ThumbGeometry | null => {
  if (!(content > viewport) || viewport <= 0) return null;
  const length = Math.max(minLength, Math.round((viewport / content) * viewport) - 2 * margin);
  const allocation = length + 2 * margin;
  // A trough too short to hold the minimum-length slider still gets one; it
  // just cannot move, which is what GtkRange does rather than shrinking below
  // the minimum.
  const travel = Math.max(0, viewport - allocation);
  const scrollable = content - viewport;
  const frac = scrollable > 0 ? Math.min(1, Math.max(0, scrollPos / scrollable)) : 0;
  return { offset: margin + Math.round(frac * travel), length };
};

/**
 * The inverse of {@link thumbGeometry}: the scroll position that puts the start
 * of the drawn indicator at `offset`. Used while dragging the bar.
 */
export const scrollPosForThumbOffset = (
  viewport: number,
  content: number,
  offset: number,
  margin = GTK_OVERLAY.margin,
  minLength = GTK_OVERLAY.minLength,
): number => {
  const geo = thumbGeometry(viewport, content, 0, margin, minLength);
  if (!geo) return 0;
  const travel = viewport - (geo.length + 2 * margin);
  if (travel <= 0) return 0;
  const frac = Math.min(1, Math.max(0, (offset - margin) / travel));
  return frac * (content - viewport);
};

/**
 * The visibility state of one pane's bars, in GTK's own vocabulary.
 * `hidden` is the pointer being anywhere else in the app — the thing the user
 * actually asked for.
 */
export type IndicatorState = 'hidden' | 'indicator' | 'over';

/**
 * GTK's proximity hysteresis. The bar thickens once the pointer is within
 * `overEnterPx` of the pane's inner edge and only thins again beyond
 * `overLeavePx`, so a pointer resting on the boundary does not flicker.
 */
export const nextOverState = (distanceToEdge: number, wasOver: boolean): boolean =>
  wasOver ? distanceToEdge <= GTK_OVERLAY.overLeavePx : distanceToEdge <= GTK_OVERLAY.overEnterPx;

/** True when this element scrolls on the given axis and is allowed to show a bar. */
const scrolls = (el: Element, style: CSSStyleDeclaration, axis: 'x' | 'y'): boolean => {
  const overflow = axis === 'x' ? style.overflowX : style.overflowY;
  if (overflow !== 'auto' && overflow !== 'scroll') return false;
  return axis === 'x'
    ? el.scrollWidth > el.clientWidth + 1
    : el.scrollHeight > el.clientHeight + 1;
};

/**
 * The nearest ancestor of `node` that actually scrolls — GTK shows the
 * indicator of the innermost `GtkScrolledWindow` under the pointer, not of
 * every one in the chain.
 */
export const nearestScroller = (node: Node | null): HTMLElement | null => {
  let el: Element | null =
    node instanceof Element ? node : (node?.parentElement ?? null);
  while (el && el instanceof HTMLElement) {
    if (el.dataset.zeNoOverlayScroll === undefined) {
      const style = getComputedStyle(el);
      if (scrolls(el, style, 'y') || scrolls(el, style, 'x')) return el;
    }
    el = el.parentElement;
  }
  return null;
};

/** One pane's pair of bars, plus the timers that drive its fade. */
interface PaneBars {
  readonly pane: HTMLElement;
  readonly vertical: HTMLElement;
  readonly horizontal: HTMLElement;
  state: IndicatorState;
  over: boolean;
  dragging: 'x' | 'y' | null;
  fadeTimer: number;
  frame: number;
}

const LAYER_CLASS = 'ze-osb-layer';
const BAR_CLASS = 'ze-osb';

const makeBar = (axis: 'x' | 'y'): HTMLElement => {
  const bar = document.createElement('div');
  bar.className = `${BAR_CLASS} ${BAR_CLASS}-${axis === 'y' ? 'v' : 'h'}`;
  bar.setAttribute('aria-hidden', 'true');
  const thumb = document.createElement('i');
  thumb.className = `${BAR_CLASS}-thumb`;
  bar.append(thumb);
  return bar;
};

const thumbOf = (bar: HTMLElement): HTMLElement => bar.firstElementChild as HTMLElement;

/**
 * Draws GTK's overlay indicators over every scrollable pane in the document.
 *
 * The bars live in one fixed-position layer appended to `document.body` rather
 * than inside each pane: a child of a scroll container scrolls with its
 * content, and re-parenting a pane to give it a positioned wrapper would change
 * the layout of ~40 panes written against their current parent. Nothing here
 * touches the pane's own DOM.
 *
 * Panes are discovered by delegation instead of a scan: the first time the
 * pointer enters one, which is precisely when GTK would first show its
 * indicator, so there is no observer walking the tree.
 *
 * Returns a teardown function; calling it twice is safe.
 */
export const installOverlayScrollbars = (doc: Document = document): (() => void) => {
  const layer = doc.createElement('div');
  layer.className = LAYER_CLASS;
  layer.setAttribute('aria-hidden', 'true');
  doc.body.append(layer);

  const bars = new Map<HTMLElement, PaneBars>();
  let active: PaneBars | null = null;
  let disposed = false;

  const clearFade = (b: PaneBars) => {
    if (b.fadeTimer) {
      clearTimeout(b.fadeTimer);
      b.fadeTimer = 0;
    }
  };

  const applyState = (b: PaneBars) => {
    for (const bar of [b.vertical, b.horizontal]) {
      bar.classList.toggle('is-visible', b.state !== 'hidden');
      bar.classList.toggle('is-over', b.state === 'over');
    }
  };

  /** Position both bars over the pane and size their thumbs. */
  const layout = (b: PaneBars) => {
    const rect = b.pane.getBoundingClientRect();
    const cw = b.pane.clientWidth;
    const ch = b.pane.clientHeight;
    // The bars overlay the *client* box, inside any border the pane draws.
    const left = rect.left + b.pane.clientLeft;
    const top = rect.top + b.pane.clientTop;

    const v = thumbGeometry(ch, b.pane.scrollHeight, b.pane.scrollTop);
    if (v && ch > 0) {
      b.vertical.style.display = '';
      b.vertical.style.left = `${left + cw - GTK_OVERLAY.bandSize}px`;
      b.vertical.style.top = `${top}px`;
      b.vertical.style.height = `${ch}px`;
      const t = thumbOf(b.vertical);
      t.style.top = `${v.offset}px`;
      t.style.height = `${v.length}px`;
    } else {
      b.vertical.style.display = 'none';
    }

    const h = thumbGeometry(cw, b.pane.scrollWidth, b.pane.scrollLeft);
    if (h && cw > 0) {
      b.horizontal.style.display = '';
      b.horizontal.style.left = `${left}px`;
      b.horizontal.style.top = `${top + ch - GTK_OVERLAY.bandSize}px`;
      b.horizontal.style.width = `${cw}px`;
      const t = thumbOf(b.horizontal);
      t.style.left = `${h.offset}px`;
      t.style.width = `${h.length}px`;
    } else {
      b.horizontal.style.display = 'none';
    }
  };

  const schedule = (b: PaneBars) => {
    if (b.frame) return;
    b.frame = requestAnimationFrame(() => {
      b.frame = 0;
      if (!disposed) layout(b);
    });
  };

  const hide = (b: PaneBars) => {
    clearFade(b);
    b.fadeTimer = window.setTimeout(() => {
      b.fadeTimer = 0;
      if (b.dragging) return;
      b.state = 'hidden';
      b.over = false;
      applyState(b);
    }, GTK_OVERLAY.fadeDelayMs);
  };

  const show = (b: PaneBars, over: boolean) => {
    clearFade(b);
    b.over = over;
    b.state = over ? 'over' : 'indicator';
    applyState(b);
    schedule(b);
  };

  const onScroll = (ev: Event) => {
    // GTK flashes the indicator on a wheel scroll even with the pointer still.
    const pane = ev.target;
    if (!(pane instanceof HTMLElement)) return;
    const b = bars.get(pane);
    if (!b) return;
    show(b, b.over);
    if (b !== active) hide(b);
  };

  const attach = (pane: HTMLElement): PaneBars => {
    const existing = bars.get(pane);
    if (existing) return existing;
    const b: PaneBars = {
      pane,
      vertical: makeBar('y'),
      horizontal: makeBar('x'),
      state: 'hidden',
      over: false,
      dragging: null,
      fadeTimer: 0,
      frame: 0,
    };
    layer.append(b.vertical, b.horizontal);
    pane.addEventListener('scroll', onScroll, { passive: true });
    bars.set(pane, b);
    return b;
  };

  /** How far the pointer is from whichever inner edge each bar hugs. */
  const distanceToEdges = (b: PaneBars, x: number, y: number) => {
    const rect = b.pane.getBoundingClientRect();
    return {
      v: rect.left + b.pane.clientLeft + b.pane.clientWidth - x,
      h: rect.top + b.pane.clientTop + b.pane.clientHeight - y,
    };
  };

  // `nearestScroller` reads computed styles up the ancestor chain, which is far
  // too expensive to repeat for every pointermove over a canvas. The answer only
  // changes when the pointer crosses into a different element, so cache it.
  let lastTarget: Element | null = null;
  let lastPane: HTMLElement | null = null;

  const onPointerMove = (ev: PointerEvent) => {
    if (disposed) return;
    const target = ev.target;
    if (target instanceof Element && target.closest(`.${BAR_CLASS}`)) {
      // Over one of our own bars: that is GTK's "hovering" state, not a
      // different pane.
      if (active) show(active, true);
      return;
    }
    let pane: HTMLElement | null;
    if (target instanceof Element && target === lastTarget) {
      pane = lastPane;
    } else {
      pane = nearestScroller(target as Node | null);
      lastTarget = target instanceof Element ? target : null;
      lastPane = pane;
    }
    if (!pane) {
      // Rule 2: outside every scrolled window, nothing is shown. This is the
      // case the browser has no equivalent of and the one the user noticed.
      if (active) {
        hide(active);
        active = null;
      }
      return;
    }
    const b = attach(pane);
    if (active && active !== b) hide(active);
    active = b;
    const d = distanceToEdges(b, ev.clientX, ev.clientY);
    show(b, nextOverState(Math.min(d.v, d.h), b.over));
  };

  const onPointerLeave = () => {
    if (active) {
      hide(active);
      active = null;
    }
  };

  // --- dragging -----------------------------------------------------------
  let drag: { bars: PaneBars; axis: 'x' | 'y'; grab: number } | null = null;

  const onPointerDown = (ev: PointerEvent) => {
    const target = ev.target;
    if (!(target instanceof Element)) return;
    const bar = target.closest(`.${BAR_CLASS}`) as HTMLElement | null;
    if (!bar || !active) return;
    const axis: 'x' | 'y' = bar.classList.contains(`${BAR_CLASS}-v`) ? 'y' : 'x';
    const b = active;
    const rect = bar.getBoundingClientRect();
    const thumb = thumbOf(bar).getBoundingClientRect();
    const pos = axis === 'y' ? ev.clientY : ev.clientX;
    const start = axis === 'y' ? thumb.top : thumb.left;
    const len = axis === 'y' ? thumb.height : thumb.width;
    // GTK's primary-button-warps-slider default: a press off the slider jumps
    // to that position, then drags from its middle.
    const inThumb = pos >= start && pos <= start + len;
    const grab = inThumb ? pos - start : len / 2;
    drag = { bars: b, axis, grab };
    b.dragging = axis;
    show(b, true);
    bar.setPointerCapture(ev.pointerId);
    if (!inThumb) applyDrag(pos, rect, axis, b, grab);
    ev.preventDefault();
  };

  const applyDrag = (
    pos: number,
    rect: DOMRect,
    axis: 'x' | 'y',
    b: PaneBars,
    grab: number,
  ) => {
    const offset = pos - (axis === 'y' ? rect.top : rect.left) - grab;
    const viewport = axis === 'y' ? b.pane.clientHeight : b.pane.clientWidth;
    const content = axis === 'y' ? b.pane.scrollHeight : b.pane.scrollWidth;
    const next = scrollPosForThumbOffset(viewport, content, offset);
    if (axis === 'y') b.pane.scrollTop = next;
    else b.pane.scrollLeft = next;
  };

  const onDragMove = (ev: PointerEvent) => {
    if (!drag) return;
    const bar = drag.axis === 'y' ? drag.bars.vertical : drag.bars.horizontal;
    applyDrag(
      drag.axis === 'y' ? ev.clientY : ev.clientX,
      bar.getBoundingClientRect(),
      drag.axis,
      drag.bars,
      drag.grab,
    );
    schedule(drag.bars);
    ev.preventDefault();
  };

  const onDragEnd = () => {
    if (!drag) return;
    drag.bars.dragging = null;
    if (drag.bars !== active) hide(drag.bars);
    drag = null;
  };

  const onResize = () => {
    // A pane that was too short to scroll can grow into one, so the cached
    // lookup has to expire whenever anything moves.
    lastTarget = null;
    lastPane = null;
    for (const b of bars.values()) schedule(b);
  };

  doc.addEventListener('pointermove', onPointerMove, { passive: true, capture: true });
  doc.addEventListener('pointerdown', onPointerDown, true);
  doc.addEventListener('pointermove', onDragMove, true);
  doc.addEventListener('pointerup', onDragEnd, true);
  doc.addEventListener('pointercancel', onDragEnd, true);
  doc.addEventListener('mouseleave', onPointerLeave);
  window.addEventListener('resize', onResize);
  // A pane that scrolls its own content also moves under the bars.
  doc.addEventListener('scroll', onResize, { passive: true, capture: true });

  return () => {
    if (disposed) return;
    disposed = true;
    doc.removeEventListener('pointermove', onPointerMove, { capture: true });
    doc.removeEventListener('pointerdown', onPointerDown, true);
    doc.removeEventListener('pointermove', onDragMove, true);
    doc.removeEventListener('pointerup', onDragEnd, true);
    doc.removeEventListener('pointercancel', onDragEnd, true);
    doc.removeEventListener('mouseleave', onPointerLeave);
    window.removeEventListener('resize', onResize);
    doc.removeEventListener('scroll', onResize, { capture: true });
    for (const b of bars.values()) {
      clearFade(b);
      if (b.frame) cancelAnimationFrame(b.frame);
      b.pane.removeEventListener('scroll', onScroll);
    }
    bars.clear();
    layer.remove();
  };
};
