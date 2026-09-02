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
 * ONE table answers, because there is now one: `ui/kicursors.ts` is the whole
 * of `CURSOR_STORE`. There used to be two -- the schematic editor kept the
 * same KiCad art re-encoded as XPM text in `editors/schematic/cursors_data.ts`
 * and rasterised it in the browser -- and only the first read the setting, so
 * ticking the box changed the symbol, footprint and drawing-sheet canvases and
 * left the schematic drawing pencils. The schematic reaches the store through
 * `toolCursor`, which is the eeschema tool -> KICURSOR mapping and nothing
 * more, so it is exercised here alongside the store itself.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { kiCursor } from '@ziroeda/designer/src/ui/kicursors.js';
import { toolCursor } from '@ziroeda/designer/src/editors/schematic/cursors.js';
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
  // One per right-toolbar tool, which is how the schematic asks: `drawWire` is
  // KICURSOR::LINE_WIRE, `placeSymbol` ::COMPONENT, `delete` ::REMOVE,
  // `placeText` ::TEXT and `rectangle` the catch-all ::PENCIL. All five are
  // custom art, so all five change.
  for (const tool of ['drawWire', 'placeSymbol', 'delete', 'placeText', 'rectangle'] as const) {
    it(`${tool}`, () => {
      useCustomCursors(false);
      expect(toolCursor(tool)).toBe(ARROW);
    });
  }
});

/**
 * The other half of the switch, without which the tests above would pass on a
 * port that had simply hardcoded the arrow.
 */
describe('with custom cursors enabled, the arrow branch is not taken', () => {
  it('the vendored table names its own art', () => {
    useCustomCursors(true);
    expect(kiCursor('PENCIL')).toContain('cursor-pencil');
    expect(kiCursor('TEXT')).toContain('cursor-text');
  });

  it("the schematic keeps the tool's own cursor", () => {
    useCustomCursors(true);
    expect(toolCursor('rectangle')).toContain('cursor-pencil');
    expect(toolCursor('drawWire')).toContain('cursor-line-wire');
  });

  it('KICURSOR::ARROW is still the arrow, setting or no setting', () => {
    // `select` is KICURSOR::ARROW, which CURSOR_STORE has no bitmap for; it is
    // `wxCURSOR_ARROW` on both sides of the branch.
    useCustomCursors(true);
    expect(toolCursor('select')).toBe(ARROW);
  });
});
