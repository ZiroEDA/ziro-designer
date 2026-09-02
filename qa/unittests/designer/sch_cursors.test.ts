// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Which `KICURSOR` each schematic tool runs with.
 *
 * Upstream this is not a table: each tool calls `SetCurrentCursor(
 * KICURSOR::… )` in its own `setCursor` lambda, and the ART those names
 * resolve to belongs to `CURSOR_STORE`, which every editor shares. So this
 * file tests the eeschema half — the mapping — and `kicad_cursors.test.ts`
 * tests the store.
 *
 * It used to test both, because the schematic editor HAD both: a second copy
 * of KiCad's cursor table in `editors/schematic/cursors_data.ts`, hand-copied
 * as XPM text and rasterised in the browser. The bitmap assertions that were
 * here are gone with it — the art is vendored from the pinned reference tree
 * by `designer/scripts/vendor-cursors.mjs` now, and `kicad_cursors.test.ts`
 * checks the PNG pair and the hotspot of every entry. What is left below is
 * the part that is really eeschema's.
 */
import { describe, it, expect } from 'vitest';
import { toolCursorName, toolCursor } from '@ziroeda/designer/src/editors/schematic/cursors.js';

describe('toolCursorName', () => {
  it('gives the single-click placement tools KICURSOR::PLACE', () => {
    // SCH_DRAWING_TOOLS::SingleClickPlace, junction, no-connect, bus entry.
    expect(toolCursorName('junction')).toBe('PLACE');
    expect(toolCursorName('noConnect')).toBe('PLACE');
    expect(toolCursorName('busEntry')).toBe('PLACE');
  });

  it('gives the line tools their own cursors', () => {
    expect(toolCursorName('drawWire')).toBe('LINE_WIRE');
    expect(toolCursorName('drawBus')).toBe('LINE_BUS');
    expect(toolCursorName('lines')).toBe('LINE_GRAPHIC');
  });

  it('leaves the selection tool the plain arrow, and draws the rest with a pencil', () => {
    expect(toolCursorName('select')).toBe('ARROW');
    expect(toolCursorName('rectangle')).toBe('PENCIL');
    expect(toolCursorName('drawSheet')).toBe('PENCIL');
  });
});

describe('the zoom tool cursor', () => {
  /**
   * `ZOOM_TOOL::Main` sets one cursor and keeps setting it every iteration of
   * its loop, putting the arrow back only on the way out:
   *
   *     auto setCursor = [&]() { m_frame->GetCanvas()->SetCurrentCursor( KICURSOR::ZOOM_IN ); };
   *     ...
   *     m_frame->GetCanvas()->SetCurrentCursor( KICURSOR::ARROW );
   *
   * Ours fell through `toolCursorName`'s default and drew a pencil, which is
   * what every unmapped drawing tool gets.
   */
  it('is KICURSOR::ZOOM_IN, not the catch-all pencil', () => {
    expect(toolCursorName('zoomTool')).toBe('ZOOM_IN');
    expect(toolCursorName('zoomTool')).not.toBe('PENCIL');
  });
});

describe('the placement tools', () => {
  /**
   * `SCH_DRAWING_TOOLS::TwoClickPlace`'s setCursor:
   *
   *     if( item )                            -> KICURSOR::PLACE
   *     else if( isText )                     -> KICURSOR::TEXT
   *     else if( isGlobalLabel )              -> KICURSOR::LABEL_GLOBAL
   *     else if( isNetLabel || isClassLabel ) -> KICURSOR::LABEL_NET
   *     else if( isHierLabel )                -> KICURSOR::LABEL_HIER
   *     else                                  -> KICURSOR::PENCIL
   *
   * The directive-label tool shares the net-label cursor; ours fell through to
   * the catch-all pencil, which is the cursor for the *shape* tools.
   */
  it('give the directive tool the net-label cursor, not the pencil', () => {
    expect(toolCursorName('placeClassLabel')).toBe('LABEL_NET');
    expect(toolCursorName('placeClassLabel')).toBe(toolCursorName('placeLabel'));
    expect(toolCursorName('placeClassLabel')).not.toBe('PENCIL');
  });

  it('and keep the other label tools on their own', () => {
    expect(toolCursorName('placeGlobalLabel')).toBe('LABEL_GLOBAL');
    expect(toolCursorName('placeHierLabel')).toBe('LABEL_HIER');
    expect(toolCursorName('placeText')).toBe('TEXT');
  });
});

describe('the interactive delete tool', () => {
  // SCH_TOOL_BASE::InteractiveDelete sets KICURSOR::REMOVE on its picker
  // (sch_tool_base.h), which CURSOR_STORE maps to cursor-eraser.xpm. Falling
  // through to the pencil made it look like a drawing tool.
  it('runs with the eraser, not the pencil', () => {
    expect(toolCursorName('delete')).toBe('REMOVE');
  });
});

/**
 * The mapping reaches the SHARED store, and not a second table beside it.
 *
 * This is the rule the whole unification exists for: `toolCursor` is
 * `SetCurrentCursor( KICURSOR )` followed by `CURSOR_STORE::GetCursor`, so a
 * schematic tool and a footprint-editor tool asking for the same KICURSOR
 * must get back the same string, byte for byte. While eeschema had its own
 * table they did not: the same KiCad pencil was a vendored PNG on one canvas
 * and a browser-rasterised data URI on the other.
 */
describe('the schematic draws from CURSOR_STORE, not from a table of its own', () => {
  it('resolves a tool to exactly what the shared store returns', async () => {
    const { kiCursor } = await import('@ziroeda/designer/src/ui/kicursors.js');
    for (const tool of ['drawWire', 'placeSymbol', 'delete', 'placeText', 'select']) {
      expect(toolCursor(tool), tool).toBe(kiCursor(toolCursorName(tool)));
    }
  });

  it('names KiCad’s vendored art, not a data: URI it painted itself', () => {
    // `cssCursor` used to build `url("data:image/png;base64,…")` off a canvas
    // at run time, which is why the schematic silently kept working with the
    // preference off and with the wrong hotspot.
    expect(toolCursor('drawWire')).toContain('cursor-line-wire');
    expect(toolCursor('drawWire')).not.toContain('data:');
  });
});
