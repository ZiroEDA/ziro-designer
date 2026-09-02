// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * KiCad's own mouse cursors — `KICURSOR` and the `CURSOR_STORE` table in
 * `common/gal/cursors.cpp`.
 *
 * Every canvas cursor in KiCad comes from that one table: an XPM under
 * `resources/bitmaps_png/cursors/`, a 32x32 and a 64x64 variant of it, and a
 * hotspot for each. `class_draw_panel_gal.cpp`'s `SetCurrentCursor( KICURSOR )`
 * is the only way a tool asks for one, which is why a pencil in pl_editor, in
 * eeschema and in pcbnew is the same pencil.
 *
 * We had drawn our own pencil and eraser as inline SVG, on the reasoning that
 * "an XPM bitmap gives no path". True, and beside the point: an XPM is a
 * bitmap, and a bitmap converts to a PNG exactly. `scripts/vendor-cursors.mjs`
 * does that conversion from the pinned reference tree, so the art here is
 * KiCad's pixel for pixel rather than a redrawing of it.
 *
 * The hotspots below are the second column of the `CURSOR_STORE` entries,
 * verbatim. They are in the ART's pixels, and the 64 variants carry doubled
 * values for that reason — but CSS states a hotspot in CSS pixels, and
 * `image-set` presents the 2x image at the 1x image's CSS size. So the CSS
 * hotspot is always the 32x32 one, whichever file the browser picks. [data]
 */

import { settings } from '../prefs/settings.js';

const URLS = import.meta.glob('../assets/cursors/*.png', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** A `CURSOR_STORE` entry: the art's base name and its 32x32 hotspot. */
interface CursorSpec {
  file: string;
  x: number;
  y: number;
  /** The stock cursor to fall back to if the image cannot be loaded. */
  fallback: string;
}

/**
 * The subset of `KICURSOR` the web app draws, with `cursors.cpp` line numbers.
 *
 * `MOVING` is the `#else` half of that entry's `#ifdef __WINDOWS__` — the
 * `_black` art — because that is what a Linux KiCad compiles.
 */
const STORE = {
  /** cursors.cpp:136-141 — the drawing tools. */
  PENCIL: { file: 'cursor-pencil', x: 4, y: 27, fallback: 'crosshair' },
  /** cursors.cpp:184-190 — the interactive delete picker. */
  REMOVE: { file: 'cursor-eraser', x: 4, y: 4, fallback: 'crosshair' },
  /** cursors.cpp:192-197 — the text tool. */
  TEXT: { file: 'cursor-text', x: 7, y: 7, fallback: 'text' },
  /** cursors.cpp:143-162 — an item travelling with the pointer. */
  MOVING: { file: 'cursor-select-m-black', x: 1, y: 1, fallback: 'move' },
  /** cursors.cpp — ACTIONS::zoomTool's rubber band. */
  ZOOM_IN: { file: 'cursor-zoom-in', x: 7, y: 7, fallback: 'zoom-in' },
  /** cursors.cpp:199-205 — ACTIONS::measureTool, hotspot (4, 4). */
  MEASURE: { file: 'cursor-measure', x: 4, y: 4, fallback: 'crosshair' },
} as const satisfies Record<string, CursorSpec>;

export type KiCursor = keyof typeof STORE;

/**
 * Whether this browser can take an `image-set()` in a `cursor` declaration.
 *
 * Worth asking rather than assuming: a `cursor` value the parser rejects is
 * dropped WHOLE, comma fallback and all, so a browser without it would get no
 * cursor rather than the 32x32 one. Chrome and Firefox both take it; the check
 * costs one call at module load.
 */
const SUPPORTS_IMAGE_SET =
  typeof CSS !== 'undefined' &&
  typeof CSS.supports === 'function' &&
  CSS.supports('cursor', 'image-set(url(a.png) 1x, url(b.png) 2x) 0 0, auto');

/**
 * What "Disable custom cursors" leaves on the canvas: the plain arrow.
 *
 * `CURSOR_STORE::GetCursor` (`common/gal/cursors.cpp:413-421`) answers a
 * disabled setting with `GetStockCursor( aCursorType )`, and substitutes
 * `wxCURSOR_ARROW` whenever that comes back `wxCURSOR_MAX`. On the parity
 * target it always does, for every cursor either of our tables holds:
 * `GetStockCursor` names only MOVING, BULLSEYE, HAND and ARROW (`:437-457`),
 * and it then throws away anything GTK does not vouch for --
 * `KIPLATFORM::UI::IsStockCursorOk` accepts BULLSEYE, HAND, ARROW and BLANK
 * and nothing else (`libs/kiplatform/port/wxgtk/ui.cpp:185-196`), so even
 * MOVING's `wxCURSOR_SIZING` is rejected. Every tool therefore gets
 * `wxCURSOR_ARROW`, which is CSS `default`.
 *
 * This is NOT each cursor's own `fallback`. That field is a CSS obligation --
 * a `cursor` value has to end in a keyword in case the image cannot be loaded
 * -- and using it here made the setting hand back a crosshair for the pencil
 * and a text bar for the text tool, which is the context-specific behaviour
 * the checkbox exists to switch OFF ("KiCad will use the system cursors
 * instead of custom context-specific cursors", `kicad.txt:1507`).
 */
export const STOCK_CURSOR = 'default';

/**
 * `commonSettings->m_Appearance.use_custom_cursors` (`cursors.cpp:409-411`),
 * read at the moment a cursor is asked for, exactly as the static store does.
 *
 * Exported because upstream there is ONE `CURSOR_STORE::GetCursor` and every
 * canvas in every editor goes through it, so the gate is asked once and holds
 * everywhere. Ours has a second cursor table in the schematic editor (its
 * XPMs are rasterised rather than vendored as PNG), and that table must ask
 * the same question rather than restate it.
 */
export function customCursorsEnabled(): boolean {
  return settings.common.appearance.use_custom_cursors;
}

/**
 * The CSS `cursor` value for a `KICURSOR`.
 *
 * On a HiDPI display KiCad swaps in the 64x64 art so the cursor keeps its
 * physical size (`CURSOR_STORE::GetCursor( ..., bool aHiDPI )`). `image-set`'s
 * `2x` descriptor is the same swap: the browser picks the 64x64 file and still
 * lays it out at 32 CSS pixels, so the cursor is crisp and unchanged in size.
 * A plain `url()` to the 64x64 file would instead draw a cursor twice as big.
 */
export function kiCursor(name: KiCursor): string {
  const spec: CursorSpec = STORE[name];
  // Preferences > Common > "Disable custom cursors", which is the NEGATION of
  // `appearance.use_custom_cursors` (`common_settings.cpp:121`, default true).
  // A canvas picks it up on its next render.
  if (!customCursorsEnabled()) return STOCK_CURSOR;
  const one = URLS[`../assets/cursors/${spec.file}.png`];
  const two = URLS[`../assets/cursors/${spec.file}64.png`];
  if (!one) return spec.fallback;
  const hot = `${spec.x} ${spec.y}`;
  if (SUPPORTS_IMAGE_SET && two) {
    return `image-set(url(${one}) 1x, url(${two}) 2x) ${hot}, ${spec.fallback}`;
  }
  return `url(${one}) ${hot}, ${spec.fallback}`;
}
