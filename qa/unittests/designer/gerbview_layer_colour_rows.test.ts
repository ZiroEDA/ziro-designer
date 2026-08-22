// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A drawing layer's colour belongs to the ROW, not to the file in it.
 *
 * `GERBER_LAYER_WIDGET::ReFill` reads
 * `m_frame->GetLayerColor( GERBER_DRAW_LAYER( layer ) )` with `layer` the row
 * index (`gerbview/widgets/gerbview_layer_widget.cpp:307`), and an override is
 * written back the same way (`:343`, whose own comment says the colours are
 * "stored according to the GERBER_DRAW_LAYER() offset", `:342`).
 *
 * So sorting the layers REPAINTS them: row 0 keeps the first palette entry and
 * receives whichever image sorted to the top. Ours froze
 * `defaultLayerColor(loadSlot)` onto the image at read time and carried it
 * through the sort, so after the sort every row had the colour of whatever file
 * happened to land there. It was invisible while the sort was being skipped
 * (`plotBatchSelfSorts`), because load order and row order were the same list —
 * fixing the sort is what exposed it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  GERBER_LAYER_COLORS,
  defaultLayerColor,
  layerColorAt,
} from '@ziroeda/designer/src/editors/gerbview/gerberColors.js';

const FRAME = readFileSync(
  fileURLToPath(
    new URL('../../../designer/src/editors/gerbview/GerberViewer.tsx', import.meta.url),
  ),
  'utf8',
);

describe('the palette is upstream s_defaultTheme, cycling', () => {
  it('has the fourteen distinct values', () => {
    // builtin_color_themes.h:91-104, then :105 repeats :91.
    expect(GERBER_LAYER_COLORS).toHaveLength(14);
    expect(GERBER_LAYER_COLORS[0]).toBe('rgb(200, 52, 52)');
    expect(GERBER_LAYER_COLORS[13]).toBe('rgb(77, 127, 196)');
  });

  it('repeats from the fifteenth row, as the table does', () => {
    // { GERBVIEW_LAYER_ID_START + 14, CSS_COLOR( 200, 52, 52, 1 ) }
    expect(defaultLayerColor(14)).toBe(defaultLayerColor(0));
    expect(defaultLayerColor(27)).toBe(defaultLayerColor(13));
  });
});

describe('the colour follows the row through a re-sort', () => {
  it('row 0 is the first palette entry whatever sorted into it', () => {
    // The function takes a row and nothing else — there is no way to hand it a
    // file, which is the property that makes a sort repaint rather than carry.
    expect(layerColorAt(0)).toBe('rgb(200, 52, 52)');
    expect(layerColorAt(1)).toBe('rgb(127, 200, 127)');
    expect(layerColorAt(2)).toBe('rgb(206, 125, 44)');
  });

  it('a whole batch reads the palette in order regardless of load order', () => {
    // Akshay's folder: 20 plots. Whatever order the file chooser hands them
    // over in, the panel must run down the palette from the top.
    const rows = Array.from({ length: 20 }, (_, i) => layerColorAt(i));
    expect(rows).toEqual(Array.from({ length: 20 }, (_, i) => GERBER_LAYER_COLORS[i % 14]));
  });
});

describe('an override is stored by row, like SetLayerColor', () => {
  it('applies to the row it was set on', () => {
    expect(layerColorAt(3, { 3: 'rgb(1, 2, 3)' })).toBe('rgb(1, 2, 3)');
  });

  it('leaves every other row on its default', () => {
    const o = { 3: 'rgb(1, 2, 3)' };
    expect(layerColorAt(2, o)).toBe(defaultLayerColor(2));
    expect(layerColorAt(4, o)).toBe(defaultLayerColor(4));
  });

  it('stays on the row when a different image sorts into it', () => {
    // Upstream stores the override against GERBER_DRAW_LAYER(row), so it does
    // not follow the file. Same call, same answer, before and after any sort.
    const o = { 0: 'rgb(9, 9, 9)' };
    expect(layerColorAt(0, o)).toBe('rgb(9, 9, 9)');
  });
});

describe('the frame does not put a colour back on the file', () => {
  // Everything above is a pure function and would go on passing if the frame
  // kept freezing defaultLayerColor(loadSlot) onto each Layer — which IS the
  // bug. These read the source, because that is where the defect lives and
  // there is no DOM test environment in this repo to observe it through.

  it('Layer carries no colour', () => {
    const iface = FRAME.slice(FRAME.indexOf('interface Layer {'));
    expect(iface.slice(0, iface.indexOf('}'))).not.toMatch(/\bcolor\b/);
  });

  it('nothing assigns a colour at load time', () => {
    // `color: defaultLayerColor(at)` inside addImage was the whole defect: `at`
    // is the load slot, and the sort then moved the row out from under it.
    expect(FRAME).not.toContain('defaultLayerColor(at)');
  });

  it('every reader asks by row', () => {
    // The three places a colour is read: the GL view, the layers manager rows
    // and the active-layer combo.
    expect(FRAME.match(/colorAt\(i\)|colorAt\(row\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(FRAME).toContain('layerColorAt(row, layerColors)');
  });

  it('an override is stored by row, not on the layer', () => {
    // setColor used to map over `layers` and rewrite the matching one.
    expect(FRAME).toContain('setLayerColors((prev) => ({ ...prev, [index]: color }))');
  });
});
