// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A status-bar field that middle-ellipsizes its text to its own width, the way
 * KISTATUSBAR::SetEllipsedTextField does. See ellipsize.ts for the mechanism
 * and why the ellipsis belongs in the middle.
 */
import { useLayoutEffect, useRef, useState, type JSX } from 'react';
import { ellipsisMargin, ellipsizeMiddle } from './ellipsize.js';

/** One shared measuring context; creating a canvas per field per resize is waste. */
let ctx: CanvasRenderingContext2D | null = null;
const measureCtx = (): CanvasRenderingContext2D | null => {
  if (!ctx) ctx = document.createElement('canvas').getContext('2d');
  return ctx;
};

export function EllipsizedField({
  text,
  className = 'cell grow',
  title,
}: {
  text: string;
  className?: string;
  /** Tooltip; defaults to the untruncated text, so the full path stays reachable. */
  title?: string;
}): JSX.Element {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(text);

  // Layout effect: measure and swap before paint, so a too-long path is never
  // shown for a frame and then yanked.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const fit = (): void => {
      const c = measureCtx();
      if (!c) {
        setShown(text);
        return;
      }
      const cs = getComputedStyle(el);
      c.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      // clientWidth is the field's box less its padding - the space the text
      // actually has - which is what GetFieldRect returns upstream.
      const width = el.clientWidth;
      // KISTATUSBAR's own guard: below this there is no sensible way to shorten.
      if (!(width > 20)) {
        setShown(text);
        return;
      }
      setShown(
        ellipsizeMiddle(
          text,
          width - ellipsisMargin((s) => c.measureText(s).width),
          (s) => c.measureText(s).width,
        ),
      );
    };

    fit();
    // The field is a flex child of the status bar, so it resizes with the
    // window without the element itself being re-rendered.
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text]);

  return (
    <span ref={ref} className={className} title={title ?? text}>
      {shown}
    </span>
  );
}
