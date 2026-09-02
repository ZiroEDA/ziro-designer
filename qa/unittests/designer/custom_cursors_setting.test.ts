// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Common > "Disable custom cursors" actually reaches the canvas.
 *
 * The checkbox is the negation of `appearance.use_custom_cursors`
 * (`common/dialogs/panel_common_settings.cpp:220`), and upstream exactly one
 * place reads it: `CURSOR_STORE::GetCursor` (`common/gal/cursors.cpp:403-434`),
 * which every `EDA_DRAW_PANEL_GAL::SetCurrentCursor` goes through. So one
 * reading covers every canvas in every editor.
 *
 *     if( COMMON_SETTINGS* commonSettings = Pgm().GetCommonSettings() )
 *         useCustomCursors = commonSettings->m_Appearance.use_custom_cursors;   :409-411
 *
 *     if( !useCustomCursors )
 *     {
 *         wxStockCursor stock = GetStockCursor( aCursorType );
 *         if( stock == wxCURSOR_MAX )
 *             stock = wxCURSOR_ARROW;
 *         return WX_CURSOR_TYPE( stock );                                       :413-421
 *     }
 *
 * **The answer is the plain arrow, for every cursor, on this platform.** [data]
 * `GetStockCursor` names only MOVING, BULLSEYE, HAND and ARROW (`:437-457`) and
 * then discards whatever GTK will not vouch for -- `IsStockCursorOk` accepts
 * BULLSEYE, HAND, ARROW and BLANK and nothing else
 * (`libs/kiplatform/port/wxgtk/ui.cpp:185-196`) -- so MOVING's
 * `wxCURSOR_SIZING` is rejected along with everything unnamed, and all six
 * cursors this port ships land on `wxCURSOR_ARROW`. CSS calls that `default`.
 * The manual agrees on the intent: "KiCad will use the system cursors instead
 * of custom context-specific cursors" (`kicad.txt:1507`) -- the replacement is
 * one cursor, not a context-specific one.
 *
 * `default` is written out here rather than imported from `kicursors.ts`,
 * because an expectation that asks the code under test what it thinks cannot
 * disagree with it.
 *
 * Two tables have to answer, because this port has two: `ui/kicursors.ts`
 * (KiCad's PNG art, used by the symbol, footprint and drawing-sheet canvases)
 * and `editors/schematic/cursors.ts` (the same XPMs rasterised in the browser,
 * used by the schematic canvas). Upstream both are `CURSOR_STORE`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { kiCursor } from '@ziroeda/designer/src/ui/kicursors.js';
import {
  kiCursor as schCursor,
  toolCursor,
} from '@ziroeda/designer/src/editors/schematic/cursors.js';
import { settings } from '@ziroeda/designer/src/prefs/settings.js';

/** `wxCURSOR_ARROW`, in CSS. [data] */
const ARROW = 'default';

function useCustomCursors(on: boolean): void {
  settings.common.appearance.use_custom_cursors = on;
}

afterEach(() => {
  // `common_settings.cpp:121-122` — the PARAM's default is true.
  useCustomCursors(true);
});

/**
 * One `it` per cursor, not a loop inside one: the rule is per-cursor, and a
 * single assertion over the whole table passes as soon as any one entry obeys.
 */
describe('with custom cursors disabled, every vendored cursor is the arrow', () => {
  for (const name of ['PENCIL', 'REMOVE', 'TEXT', 'MOVING', 'ZOOM_IN', 'MEASURE'] as const) {
    it(`${name}`, () => {
      useCustomCursors(false);
      expect(kiCursor(name)).toBe(ARROW);
    });
  }
});

describe('with custom cursors disabled, the schematic canvas is the arrow too', () => {
  // The names its own table uses; upstream these are KICURSOR::PENCIL,
  // ::REMOVE, ::LINE_WIRE and ::COMPONENT.
  for (const name of ['pencil', 'remove', 'lineWire', 'component', 'moving'] as const) {
    it(`${name}`, () => {
      useCustomCursors(false);
      expect(schCursor(name)).toBe(ARROW);
    });
  }

  it('and so is whatever a right-toolbar tool asks for', () => {
    useCustomCursors(false);
    // `drawWire` is KICURSOR::LINE_WIRE and `placeSymbol` is ::COMPONENT --
    // both custom art, so both change.
    expect(toolCursor('drawWire')).toBe(ARROW);
    expect(toolCursor('placeSymbol')).toBe(ARROW);
  });
});

/**
 * The other half of the switch, without which the tests above would pass on a
 * port that had simply hardcoded the arrow.
 *
 * The values asserted are the ones each table reaches when its art cannot be
 * loaded -- there is no DOM here to rasterise an XPM into, and the vendored
 * PNGs resolve to a dev-server URL -- so what is pinned is only that the
 * setting being ON does NOT take the `wxCURSOR_ARROW` branch. That is the
 * whole of the claim.
 */
describe('with custom cursors enabled, the arrow branch is not taken', () => {
  it('the vendored table names its own art', () => {
    useCustomCursors(true);
    expect(kiCursor('PENCIL')).toContain('cursor-pencil');
    expect(kiCursor('TEXT')).toContain('cursor-text');
  });

  it("the schematic table keeps the tool's own cursor", () => {
    useCustomCursors(true);
    expect(schCursor('pencil')).not.toBe(ARROW);
    expect(toolCursor('drawWire')).not.toBe(ARROW);
  });

  it('KICURSOR::ARROW is still the arrow, setting or no setting', () => {
    // `select` is KICURSOR::ARROW, which CURSOR_STORE has no bitmap for; it is
    // `wxCURSOR_ARROW` on both sides of the branch.
    useCustomCursors(true);
    expect(toolCursor('select')).toBe(ARROW);
  });
});
