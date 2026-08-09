// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The schematic tool cursors: KiCad's own bitmaps (CURSOR_STORE, common/gal/
 * cursors.cpp), vendored as XPM. The data is copied verbatim from
 * `resources/bitmaps_png/cursors/*.xpm`, so what this guards is the copy: a
 * short row or an undeclared palette character would paint a garbled cursor,
 * and a wrong hotspot would put the bitmap somewhere other than the point the
 * click lands on.
 */
import { describe, it, expect } from 'vitest';
import { XPM_CURSORS } from '@ziroeda/designer/src/editors/schematic/cursors_data.js';
import { toolCursorName } from '@ziroeda/designer/src/editors/schematic/cursors.js';

describe('vendored cursor bitmaps', () => {
  it('are 32x32 with every pixel in the palette', () => {
    for (const [name, def] of Object.entries(XPM_CURSORS)) {
      expect(def.rows, name).toHaveLength(32);
      for (const row of def.rows) {
        expect(row, name).toHaveLength(32);
        for (const ch of row) expect(def.palette, `${name}: '${ch}'`).toHaveProperty(ch);
      }
    }
  });

  it('carry CURSOR_STORE hotspots, inside the bitmap', () => {
    // cursors.cpp: PLACE {1,1}, PENCIL {4,27}, the label/component/lasso
    // cursors {7,7}, the wire/bus/graphic line cursors {5,26}.
    expect(XPM_CURSORS.place?.hotspot).toEqual([1, 1]);
    expect(XPM_CURSORS.pencil?.hotspot).toEqual([4, 27]);
    expect(XPM_CURSORS.component?.hotspot).toEqual([7, 7]);
    expect(XPM_CURSORS.lineWire?.hotspot).toEqual([5, 26]);
    expect(XPM_CURSORS.lineBus?.hotspot).toEqual([5, 26]);
    // REMOVE {4,4}: the eraser's working corner, not its top-left.
    expect(XPM_CURSORS.remove?.hotspot).toEqual([4, 4]);
    for (const [name, def] of Object.entries(XPM_CURSORS)) {
      const [hx, hy] = def.hotspot;
      expect(hx, name).toBeLessThan(32);
      expect(hy, name).toBeLessThan(32);
    }
  });
});

describe('toolCursorName', () => {
  it('gives the single-click placement tools KICURSOR::PLACE', () => {
    // SCH_DRAWING_TOOLS::SingleClickPlace, junction, no-connect, bus entry.
    expect(toolCursorName('junction')).toBe('place');
    expect(toolCursorName('noConnect')).toBe('place');
    expect(toolCursorName('busEntry')).toBe('place');
  });

  it('gives the line tools their own cursors', () => {
    expect(toolCursorName('drawWire')).toBe('lineWire');
    expect(toolCursorName('drawBus')).toBe('lineBus');
    expect(toolCursorName('lines')).toBe('lineGraphic');
  });

  it('leaves the selection tool the plain arrow, and draws the rest with a pencil', () => {
    expect(toolCursorName('select')).toBe('arrow');
    expect(toolCursorName('rectangle')).toBe('pencil');
    expect(toolCursorName('drawSheet')).toBe('pencil');
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
    expect(toolCursorName('zoomTool')).toBe('zoomIn');
    expect(toolCursorName('zoomTool')).not.toBe('pencil');
  });

  it('and the bitmap is KiCad’s, with CURSOR_STORE’s hotspot', () => {
    const def = XPM_CURSORS.zoomIn!;
    expect(def).toBeDefined();
    // cursor-zoom-in.xpm is 32x32 with a white/black two-colour palette.
    expect(def.rows).toHaveLength(32);
    for (const row of def.rows) expect(row).toHaveLength(32);
    // { 6, 6 }: the centre of the lens, not the tip of the handle.
    expect(def.hotspot).toEqual([6, 6]);
    // The lens really is drawn around the hotspot.
    expect(def.rows[6]![6]).not.toBe(' ');
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
    expect(toolCursorName('placeClassLabel')).toBe('labelNet');
    expect(toolCursorName('placeClassLabel')).toBe(toolCursorName('placeLabel'));
    expect(toolCursorName('placeClassLabel')).not.toBe('pencil');
  });

  it('and keep the other label tools on their own', () => {
    expect(toolCursorName('placeGlobalLabel')).toBe('labelGlobal');
    expect(toolCursorName('placeHierLabel')).toBe('labelHier');
    expect(toolCursorName('placeText')).toBe('text');
  });
});

describe('the interactive delete tool', () => {
  // SCH_TOOL_BASE::InteractiveDelete sets KICURSOR::REMOVE on its picker
  // (sch_tool_base.h), which CURSOR_STORE maps to cursor-eraser.xpm. Falling
  // through to the pencil made it look like a drawing tool.
  it('runs with the eraser, not the pencil', () => {
    expect(toolCursorName('delete')).toBe('remove');
  });

  it('has the eraser bitmap vendored', () => {
    const def = XPM_CURSORS.remove;
    expect(def).toBeDefined();
    // The first rows of cursor-eraser.xpm: the little white-outlined cross.
    expect(def!.rows[0]).toBe('   ...                          ');
    expect(def!.rows[4]).toBe('.+++ +++.                       ');
    expect(Object.keys(def!.palette).sort()).toEqual([' ', '+', '.']);
  });
});
