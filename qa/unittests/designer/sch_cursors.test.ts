/**
 * The schematic tool cursors: KiCad's own bitmaps (CURSOR_STORE, common/gal/
 * cursors.cpp), vendored as XPM. The data is copied verbatim from
 * `resources/bitmaps_png/cursors/*.xpm`, so what this guards is the copy: a
 * short row or an undeclared palette character would paint a garbled cursor,
 * and a wrong hotspot would put the bitmap somewhere other than the point the
 * click lands on.
 */
import { describe, it, expect } from 'vitest';
import { XPM_CURSORS } from '../../../designer/src/editors/schematic/cursors_data.js';
import { toolCursorName } from '../../../designer/src/editors/schematic/cursors.js';

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
    for (const [name, def] of Object.entries(XPM_CURSORS)) {
      const [hx, hy] = def.hotspot;
      expect(hx, name).toBeLessThan(32);
      expect(hy, name).toBeLessThan(32);
    }
  });
});

describe('toolCursorName', () => {
  it('gives the single-click placement tools KICURSOR::PLACE', () => {
    // SCH_DRAWING_TOOLS::SingleClickPlace — junction, no-connect, bus entry.
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
