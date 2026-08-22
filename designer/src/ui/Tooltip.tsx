// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The GTK tooltip, as a DOM layer.
 *
 * The browser's own `title` tooltip cannot be styled at all, and it is visibly
 * not the one KiCad shows: measured off a real launcher, GTK's box is 46px tall
 * for one line of text where Chrome's is 28, and it is outlined in #4b4b4b
 * where Chrome outlines it in white. Since the text has to come from the
 * TOOL_ACTION anyway (see tooltipFor), drawing the box ourselves costs little
 * more and gets both halves right.
 *
 * One layer for the whole app rather than a wrapper per button: tooltips are
 * mutually exclusive, so a single listener keyed off `data-tip` means any
 * element opts in by carrying the attribute, with no component to thread
 * through.
 */
import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react';

/** GTK's tooltip-timeout: how long the pointer must rest before it shows. */
const DELAY_MS = 500;

/**
 * `tooltipFor` and `buttonTooltipFor` now live in `tooltip_text.ts` so a `.ts`
 * data module can build a tooltip without importing from a `.tsx`, which `qa`'s
 * tsconfig cannot compile. Re-exported here so every existing importer keeps
 * working, the same way `Toolbar.tsx` re-exports `toolbar_types.ts`.
 */
export { buttonTooltipFor, tooltipFor } from './tooltip_text.js';

export function TooltipLayer(): JSX.Element | null {
  /** `cx` is the *centre* the box wants to sit under, not its left edge. */
  const [tip, setTip] = useState<{ text: string; cx: number; y: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    /**
     * The element whose `title` we are currently holding, and its text.
     *
     * There are ~460 `title=` attributes across the app and no reason to
     * rewrite every one: instead, when the pointer lands on an element that has
     * one, we take the attribute off it (which is what stops Chrome drawing its
     * own unstylable box), draw ours, and hand the attribute back on the way
     * out. Nothing downstream - screen readers, tests, anything reading the
     * DOM - sees a difference except during the hover itself.
     */
    let borrowed: { el: HTMLElement; title: string } | null = null;
    const giveBack = (): void => {
      if (borrowed) borrowed.el.setAttribute('title', borrowed.title);
      borrowed = null;
    };

    const cancel = (): void => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      giveBack();
      setTip(null);
    };

    const onOver = (e: MouseEvent): void => {
      const target = e.target as HTMLElement | null;
      // `data-tip` first: it is the explicit form, used where the text has to
      // be built (the launchers' TOOL_ACTION tooltips) rather than just shown.
      const el = target?.closest?.('[data-tip], [title]') as HTMLElement | null;
      if (!el) {
        cancel();
        return;
      }
      if (borrowed && borrowed.el !== el) giveBack();

      let text = el.getAttribute('data-tip');
      if (!text) {
        const native = el.getAttribute('title');
        if (native) {
          borrowed = { el, title: native };
          el.removeAttribute('title');
          text = native;
        }
      }
      if (!text) {
        cancel();
        return;
      }

      if (timer) clearTimeout(timer);
      // Centred under the element, not trailing off to the right of the
      // pointer: the box belongs to the button, so it is placed against the
      // button and stays put however the pointer moves inside it.
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const y = r.bottom + 6;
      setLeft(null);
      timer = setTimeout(() => setTip({ text, cx, y }), DELAY_MS);
    };

    document.addEventListener('mouseover', onOver, true);
    // Any click, scroll or key dismisses it, like a real tooltip: leaving it up
    // over a menu that has just opened is worse than not showing it at all.
    document.addEventListener('mousedown', cancel, true);
    document.addEventListener('wheel', cancel, true);
    window.addEventListener('keydown', cancel, true);
    window.addEventListener('blur', cancel);
    return () => {
      if (timer) clearTimeout(timer);
      giveBack();
      document.removeEventListener('mouseover', onOver, true);
      document.removeEventListener('mousedown', cancel, true);
      document.removeEventListener('wheel', cancel, true);
      window.removeEventListener('keydown', cancel, true);
      window.removeEventListener('blur', cancel);
    };
  }, []);

  // Centre it, then pull it back inside the viewport once its real width is
  // known. Done in a layout effect so the corrected position is the first one
  // painted - centring in CSS alone cannot clamp, because the box's width is
  // not known until it has been laid out.
  // biome-ignore lint/correctness/useHookAtTopLevel: the early return below is
  // after this hook; both run on every render.
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el || !tip) return;
    const w = el.offsetWidth;
    const max = window.innerWidth - w - 4;
    setLeft(Math.max(4, Math.min(tip.cx - w / 2, Math.max(4, max))));
  }, [tip]);

  if (!tip) return null;

  return (
    <div
      ref={boxRef}
      className="ze-tooltip"
      // Before the measure lands, park it off-centre-left rather than flashing
      // at x=0: one frame at worst, and only on the very first tooltip.
      style={{ left: left ?? tip.cx, top: tip.y, visibility: left === null ? 'hidden' : 'visible' }}
      role="tooltip"
    >
      {tip.text}
    </div>
  );
}
