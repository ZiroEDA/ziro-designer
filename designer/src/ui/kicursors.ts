// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `CURSOR_STORE` — KiCad's mouse cursors, and the only place this app has any.
 *
 * Upstream this is `common/gal/cursors.cpp`: one `cursors_defs` table
 * (`:114-322`) of KICURSOR -> XPM + hotspot, one static `CURSOR_STORE` inside
 * `GetCursor` (`:405`), and `EDA_DRAW_PANEL_GAL::SetCurrentCursor( KICURSOR )`
 * as the only way a tool asks for one. That is why a pencil in pl_editor, in
 * eeschema and in pcbnew is the same pencil, and why "Disable custom cursors"
 * is answered once rather than per editor.
 *
 * **This module is that single store.** It used to be half of one: the
 * schematic editor carried a SECOND table, `editors/schematic/cursors.ts`
 * over `cursors_data.ts`, holding the same KiCad art re-encoded as inline XPM
 * strings and rasterised in the browser. Two tables meant two answers -- the
 * Preferences checkbox reached one of them, the ZOOM_IN hotspot was wrong in
 * both, and the schematic's art had to be maintained by hand. There is one
 * table now, vendored by `scripts/vendor-cursors.mjs` straight out of the
 * pinned reference tree, so the art is KiCad's pixel for pixel.
 *
 * The hotspots below are the second column of the `cursors_defs` entries,
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

/**
 * `wxCURSOR_ARROW` in CSS — the platform's plain arrow.
 *
 * It is the answer to three separate questions upstream, which is why it is
 * one constant here rather than three literals: `KICURSOR::ARROW` itself
 * (`GetStockCursor`, `cursors.cpp:451-453`); every cursor at all when
 * "Disable custom cursors" is on (`GetCursor`, `:413-421` — see
 * {@link customCursorsEnabled}); and, for us alone, the keyword a CSS `cursor`
 * value must end in should the image fail to load. That last has no upstream
 * counterpart, because a compiled-in XPM cannot fail to load; naming it
 * anything else — a crosshair for the pencil, an I-beam for the text tool —
 * would invent a behaviour KiCad does not have.
 */
export const STOCK_CURSOR = 'default';

/** A `cursors_defs` entry: the art's base name and its 32x32 hotspot. */
interface CursorSpec {
  file: string;
  x: number;
  y: number;
}

/**
 * `cursors_defs` (`common/gal/cursors.cpp:114-322`), for the KICURSORs this
 * port's tools ask for. [data]
 *
 * MOVING and PLACE take the `#else` half of their `#ifdef __WINDOWS__` — the
 * `*_black` art — because that is the branch a Linux KiCad compiles.
 *
 * Upstream's table has five more: VOLTAGE_PROBE, CURRENT_PROBE and TUNE belong
 * to the simulator, and ADD / SUBTRACT / XOR / ZOOM_OUT to tools this port does
 * not have. They are absent rather than unvendored-but-listed, so the store and
 * `scripts/vendor-cursors.mjs`'s list say the same thing.
 */
const STORE = {
  /** cursors.cpp:135-141 */
  PENCIL: { file: 'cursor-pencil', x: 4, y: 27 },
  /** cursors.cpp:142-168 — an item travelling with the pointer. */
  MOVING: { file: 'cursor-select-m-black', x: 1, y: 1 },
  /** cursors.cpp:186-192 — the interactive delete picker. */
  REMOVE: { file: 'cursor-eraser', x: 4, y: 4 },
  /** cursors.cpp:193-199 */
  TEXT: { file: 'cursor-text', x: 7, y: 7 },
  /** cursors.cpp:200-206 — ACTIONS::measureTool. */
  MEASURE: { file: 'cursor-measure', x: 4, y: 4 },
  /**
   * cursors.cpp:228-234 — ACTIONS::zoomTool's rubber band.
   *
   * The hotspot is (6, 6), not (7, 7). Both this table and the test that
   * checked it said 7 — transcribed once, wrong, and quoted from the same
   * wrong reading — so the crosshair sat a pixel down and right of where
   * KiCad puts it and nothing could tell.
   */
  ZOOM_IN: { file: 'cursor-zoom-in', x: 6, y: 6 },
  /** cursors.cpp:241-247 */
  LABEL_NET: { file: 'cursor-label-net', x: 7, y: 7 },
  /** cursors.cpp:248-254 */
  LABEL_GLOBAL: { file: 'cursor-label-global', x: 7, y: 7 },
  /** cursors.cpp:297-303 */
  LABEL_HIER: { file: 'cursor-label-hier', x: 7, y: 7 },
  /** cursors.cpp:255-261 */
  COMPONENT: { file: 'cursor-component', x: 7, y: 7 },
  /** cursors.cpp:262-268 */
  SELECT_LASSO: { file: 'cursor-select-lasso', x: 7, y: 7 },
  /** cursors.cpp:269-275 — the only entry whose hotspot is not on a diagonal. */
  SELECT_WINDOW: { file: 'cursor-select-window', x: 7, y: 10 },
  /** cursors.cpp:283-289 */
  LINE_WIRE: { file: 'cursor-line-wire', x: 5, y: 26 },
  /** cursors.cpp:276-282 */
  LINE_BUS: { file: 'cursor-line-bus', x: 5, y: 26 },
  /** cursors.cpp:290-296 */
  LINE_GRAPHIC: { file: 'cursor-line-graphic', x: 5, y: 26 },
  /** cursors.cpp:304-321 */
  PLACE: { file: 'cursor-place-black', x: 1, y: 1 },
  /**
   * cursors.cpp:164-184 — `SCH_DRAG_NET_COLLISION_MONITOR::AdjustCursor`
   * replaces MOVING with this one for as long as the drag in flight would
   * merge two nets, and it is the only thing in eeschema that asks for it.
   */
  WARNING: { file: 'cursor-warning-black', x: 1, y: 1 },
} as const satisfies Record<string, CursorSpec>;

/**
 * `KICURSOR`, as far as this port goes.
 *
 * ARROW is in the union and NOT in {@link STORE}, exactly as upstream: it has
 * no entry in `cursors_defs` and is served by `GetStockCursor` instead.
 */
export type KiCursor = keyof typeof STORE | 'ARROW';

/**
 * `CURSOR_STORE::GetStockCursor` (`cursors.cpp:437-463`), on this platform.
 *
 *     case KICURSOR::MOVING:   stockCursor = wxCURSOR_SIZING;   break;
 *     case KICURSOR::BULLSEYE: stockCursor = wxCURSOR_BULLSEYE; break;
 *     case KICURSOR::HAND:     stockCursor = wxCURSOR_HAND;     break;
 *     case KICURSOR::ARROW:    stockCursor = wxCURSOR_ARROW;    break;
 *     default:                 stockCursor = wxCURSOR_MAX;      break;
 *
 *     if( !KIPLATFORM::UI::IsStockCursorOk( stockCursor ) )
 *         stockCursor = wxCURSOR_MAX;
 *
 * That last line is what makes this short. GTK's `IsStockCursorOk` accepts
 * BULLSEYE, HAND, ARROW and BLANK and nothing else
 * (`libs/kiplatform/port/wxgtk/ui.cpp:185-196`), so **MOVING's
 * `wxCURSOR_SIZING` is thrown away** and MOVING draws its bitmap like every
 * other entry. Of the KICURSORs this port uses, only ARROW survives — which
 * is why it is the one branch here.
 *
 * `null` is `wxCURSOR_MAX`: no stock cursor, use the bitmap.
 */
function stockCursor(name: KiCursor): string | null {
  return name === 'ARROW' ? STOCK_CURSOR : null;
}

/**
 * `commonSettings->m_Appearance.use_custom_cursors` (`cursors.cpp:409-411`),
 * read at the moment a cursor is asked for, as the static store does.
 *
 * Preferences > Common > "Disable custom cursors" is its negation
 * (`panel_common_settings.cpp:220`, `:326`).
 */
export function customCursorsEnabled(): boolean {
  return settings.common.appearance.use_custom_cursors;
}

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
 * `CURSOR_STORE::GetCursor` (`common/gal/cursors.cpp:403-434`), in CSS.
 *
 *     bool useCustomCursors = true;
 *     if( COMMON_SETTINGS* commonSettings = Pgm().GetCommonSettings() )
 *         useCustomCursors = commonSettings->m_Appearance.use_custom_cursors;
 *
 *     if( !useCustomCursors )
 *     {
 *         wxStockCursor stock = GetStockCursor( aCursorType );
 *         if( stock == wxCURSOR_MAX ) stock = wxCURSOR_ARROW;
 *         return WX_CURSOR_TYPE( stock );
 *     }
 *
 *     wxStockCursor stock = GetStockCursor( aCursorType );
 *     if( stock != wxCURSOR_MAX ) return WX_CURSOR_TYPE( stock );
 *     return store.storeGetBundle( aCursorType );
 *
 * Both branches ask `GetStockCursor` first; they differ only in what happens
 * when it says `wxCURSOR_MAX` — the arrow, or the bitmap. That ordering is why
 * a stock cursor is a stock cursor whatever the setting says.
 *
 * On a HiDPI display the store hands back the 64x64 art so the cursor keeps
 * its physical size (`storeGetBundle` carries both; `GetCursor( ..., bool
 * aHiDPI )` chose before wx 3.3). `image-set`'s `2x` descriptor is that same
 * swap: the browser picks the 64x64 file and still lays it out at 32 CSS
 * pixels. A plain `url()` to the 64x64 file would draw a cursor twice as big.
 */
export function kiCursor(name: KiCursor): string {
  const stock = stockCursor(name);
  if (!customCursorsEnabled()) return stock ?? STOCK_CURSOR;
  if (stock !== null) return stock;
  // Everything past the two `GetStockCursor` calls is `storeGetBundle`, which
  // is only ever reached for a KICURSOR that HAS a `cursors_defs` entry.
  const spec: CursorSpec = STORE[name as keyof typeof STORE];
  const one = URLS[`../assets/cursors/${spec.file}.png`];
  const two = URLS[`../assets/cursors/${spec.file}64.png`];
  if (!one) return STOCK_CURSOR;
  const hot = `${spec.x} ${spec.y}`;
  if (SUPPORTS_IMAGE_SET && two) {
    return `image-set(url(${one}) 1x, url(${two}) 2x) ${hot}, ${STOCK_CURSOR}`;
  }
  return `url(${one}) ${hot}, ${STOCK_CURSOR}`;
}
