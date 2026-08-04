// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Measuring an outline face with the browser's own text engine (#154, step 2a).
 *
 * `FontProvider` from `common/src/font/font_provider.ts` asks one question —
 * how wide is this text in this face — and this answers it with
 * `CanvasRenderingContext2D.measureText`, which is the same engine
 * `ctx.fillText` will draw with. Asking the thing that draws is the only way to
 * be sure the answer matches, which is #154's central requirement.
 *
 * ### It is not installed yet, on purpose
 *
 * Installing this alone would make faced text *measure* as an outline font
 * while still *drawing* as the stroke font — the exact divergence #154 warns
 * about, and worse than what we have now, because bounding boxes would stop
 * matching the glyphs. It goes in at the same moment the renderer learns to
 * draw a face, and not before. See `installCanvasFontProvider`.
 *
 * ### Why the context is injected
 *
 * The measuring context is a parameter rather than something this module
 * creates, so the provider can be tested against a fake. There is no canvas in
 * a headless test run, and a font-measurement path that only runs in a browser
 * is a font-measurement path nobody checks.
 */

import type { FontProvider, TextStyle } from '@ziroeda/common/src/font/font_provider.js';

/** The slice of a 2D context this needs: enough to fake in a test. */
export interface MeasuringContext {
  font: string;
  measureText(text: string): { width: number };
}

/**
 * The CSS font shorthand for a style at a given size.
 *
 * Size is in internal units, which is also the renderer's world space, so the
 * value goes straight into a `px` field: the context is already scaled by the
 * view transform when it draws, and measurement has to use the same numbers the
 * drawing will.
 *
 * The face is quoted, since family names contain spaces, and `sans-serif` is
 * appended so a face the browser does not have still measures as *something*
 * rather than as the default serif — the same fallback the draw call gets.
 */
export function fontShorthand(size: number, style: TextStyle): string {
  const parts: string[] = [];
  if (style.italic) parts.push('italic');
  if (style.bold) parts.push('bold');
  parts.push(`${size}px`);
  parts.push(`"${(style.face ?? '').replace(/"/g, '')}", sans-serif`);
  return parts.join(' ');
}

/**
 * A provider backed by a measuring context.
 *
 * Multi-line text measures as its **widest line**, matching `measureText` and
 * `layoutText` in the stroke font — they disagreed about exactly this until
 * #410, and a provider that reintroduced the disagreement for outline faces
 * would put every geometric consumer back where it was.
 */
export function canvasFontProvider(ctx: MeasuringContext): FontProvider {
  return {
    measure(text: string, size: number, style: TextStyle): number | null {
      if (!style.face) return null;
      try {
        ctx.font = fontShorthand(size, style);
        let widest = 0;
        for (const line of text.split('\n')) {
          const w = ctx.measureText(line).width;
          if (w > widest) widest = w;
        }
        return widest;
      } catch {
        // A context that has been lost, or a font string it rejects. Declining
        // sends the caller to the stroke font, which is what we draw today.
        return null;
      }
    },
  };
}

/**
 * Make a measuring context from the DOM, or null when there is none.
 *
 * Separate from the provider so the provider stays testable, and so a headless
 * or degraded environment gets a null rather than a throw.
 */
export function domMeasuringContext(): MeasuringContext | null {
  if (typeof document === 'undefined') return null;
  const ctx = document.createElement('canvas').getContext('2d');
  return ctx ?? null;
}
