// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * One place that answers "how wide is this text". First step of #154.
 *
 * That issue's hardest requirement is that everything which *measures* text
 * asks the same source as everything which *draws* it, and that a divergence
 * between them is worse than not offering outline fonts at all. It is not a
 * theoretical worry: `measureText` and `layoutText` were already 4.8× apart for
 * multi-line text (#410), and every geometric consumer — hit-testing, selection
 * halos, field autoplacement — was silently wrong for it, because the text
 * still *drew* correctly.
 *
 * So the entry point comes first, before any outline font exists to go behind
 * it. `textWidth` is now the single question, and the answer for a face we
 * cannot measure is the stroke font's — which is exactly what the app does
 * today for every face.
 *
 * ### Nothing changes until a provider is installed
 *
 * There is no provider by default, so every call falls through to the stroke
 * font and the app behaves precisely as before. Installing one is what makes
 * outline text measurable, and that belongs with the renderer change that makes
 * it *drawable* — landing one without the other is the divergence this file
 * exists to prevent.
 *
 * ### Why the provider may decline
 *
 * `measure` returns null for a face it cannot handle: not installed, not
 * loaded yet, or no measuring context available. A null falls back to the
 * stroke font rather than guessing, so a font that fails to load degrades to
 * what we draw today instead of to a wrong number.
 */

import { measureText } from './stroke_font.js';

/** How the text is being rendered, since a face measures differently per style. */
export interface TextStyle {
  /** `(font (face "…"))`; absent or empty means KiCad's built-in stroke font. */
  readonly face?: string;
  readonly bold?: boolean;
  readonly italic?: boolean;
}

/**
 * Something that can measure an outline face. Returns null when it cannot —
 * the caller falls back to the stroke font rather than to a guess.
 */
export interface FontProvider {
  measure(text: string, size: number, style: TextStyle): number | null;
}

let provider: FontProvider | null = null;

/**
 * Install the outline-font measurer, or clear it with null.
 *
 * Deliberately global, matching the stroke font's own module-level state: text
 * is measured from deep inside geometry code that has no business threading a
 * font service through every call.
 */
export function setFontProvider(next: FontProvider | null): void {
  provider = next;
}

/** Whether an outline measurer is installed. Mostly for tests and diagnostics. */
export const hasFontProvider = (): boolean => provider !== null;

/**
 * The width of `text` at glyph height `size` (IU) in the given style.
 *
 * The stroke font is used when there is no face, no provider, or the provider
 * declines. `measureText` already agrees with `layoutText`, which is what the
 * renderer lays out, so the fallback path is the one the app has always taken.
 */
export function textWidth(text: string, size: number, style?: TextStyle): number {
  const face = style?.face;
  if (face && provider) {
    const w = provider.measure(text, size, style ?? {});
    // A negative or non-finite answer is a broken provider, not a measurement.
    if (w !== null && Number.isFinite(w) && w >= 0) return w;
  }
  return measureText(text, size);
}
