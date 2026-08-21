// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Design Inspector's type icons — the six XPMs `design_inspector.cpp:46-158`
 * hardcodes, transcribed pixel for pixel.
 *
 * These are DATA, not chrome: KiCad does not ask the theme for them and they are
 * not in its icon set either. They are six `static const char* …_xpm[]` arrays
 * declared at the top of that one file, each `"12 12 2 1"` with `" c None"` and
 * one colour. So they are mirrored here rather than redrawn, and the colours are
 * KiCad's own — teal for the page and a line, navy for a rectangle, maroon for
 * text and an image, green for a polygon. There is no palette behind that
 * choice to consult; it is just the table.
 *
 * `BitmapGridCellRenderer::Draw` (`:359-366`) blits one into `COL_BITMAP` at
 * `aRect.GetX() + 5, aRect.GetY() + 2`, over whatever the string renderer drew,
 * and the column's minimum width is `BITMAP_SIZE * 2` = 32 px (`:303-304`).
 *
 * The rows below are the literal XPM rows: `x` is the colour, a space is
 * transparent. Generated from the C++ rather than retyped, and checked by
 * `ds_inspector_icons.test.ts`, which re-reads the same arrays out of the
 * reference tree.
 */

/** One 12 x 12, two-colour XPM: its ink colour and its twelve pixel rows. */
export interface XpmIcon {
  color: string;
  rows: readonly string[];
}

/** `#define BITMAP_SIZE 16`; the column's minimum is twice it (`:303-304`). */
export const DS_INSPECTOR_BITMAP_SIZE = 16;

/** The XPM is 12 x 12 (`"12 12 2 1"`). */
export const DS_INSPECTOR_ICON_PX = 12;

/** `aDc.DrawBitmap( bm, aRect.GetX() + 5, aRect.GetY() + 2, true )` (`:365`). */
export const DS_INSPECTOR_ICON_OFFSET = { x: 5, y: 2 } as const;

/** `root_xpm` — the pseudo-row describing the page itself. */
export const DS_ICON_ROOT: XpmIcon = {
  color: '#008080',
  rows: [
    '   xxxx     ',
    '     xxx    ',
    '      xxx   ',
    '       xxx  ',
    'xxxxxxxxxxx ',
    'xxxxxxxxxxxx',
    'xxxxxxxxxxx ',
    '       xxx  ',
    '      xxx   ',
    '     xxx    ',
    '   xxxx     ',
    '            ',
  ],
};

/** `line_xpm` — DS_DATA_ITEM::DS_SEGMENT. */
export const DS_ICON_LINE: XpmIcon = {
  color: '#008080',
  rows: [
    'xx          ',
    'xx          ',
    'xx          ',
    'xx          ',
    'xx          ',
    'xx          ',
    'xx          ',
    'xx          ',
    'xx          ',
    'xx          ',
    'xxxxxxxxxxxx',
    'xxxxxxxxxxxx',
  ],
};

/** `rect_xpm` — DS_DATA_ITEM::DS_RECT. */
export const DS_ICON_RECT: XpmIcon = {
  color: '#000080',
  rows: [
    'xxxxxxxxxxxx',
    'xxxxxxxxxxxx',
    'xx        xx',
    'xx        xx',
    'xx        xx',
    'xx        xx',
    'xx        xx',
    'xx        xx',
    'xx        xx',
    'xx        xx',
    'xxxxxxxxxxxx',
    'xxxxxxxxxxxx',
  ],
};

/** `text_xpm` — DS_DATA_ITEM::DS_TEXT. */
export const DS_ICON_TEXT: XpmIcon = {
  color: '#800000',
  rows: [
    ' xxxxxxxxxx ',
    'xxxxxxxxxxxx',
    'xx   xx   xx',
    '     xx     ',
    '     xx     ',
    '     xx     ',
    '     xx     ',
    '     xx     ',
    '     xx     ',
    '     xx     ',
    '    xxxx    ',
    '   xxxxxx   ',
  ],
};

/** `poly_xpm` — DS_DATA_ITEM::DS_POLYPOLYGON. */
export const DS_ICON_POLY: XpmIcon = {
  color: '#008000',
  rows: [
    '     xx     ',
    '    xxxx    ',
    '   xxxxxx   ',
    '  xxxxxxxx  ',
    ' xxxxxxxxxx ',
    'xxxxxxxxxxxx',
    'xxxxxxxxxxxx',
    ' xxxxxxxxxx ',
    '  xxxxxxxx  ',
    '   xxxxxx   ',
    '    xxxx    ',
    '     xx     ',
  ],
};

/** `img_xpm` — DS_DATA_ITEM::DS_BITMAP. */
export const DS_ICON_IMG: XpmIcon = {
  color: '#800000',
  rows: [
    '     xx     ',
    '   xxxxxx   ',
    ' xx      xx ',
    'xx        xx',
    'xx        xx',
    ' xx      xx ',
    '   xxxxxx   ',
    '     xx     ',
    '     xx     ',
    '     xx     ',
    '     xx     ',
    '     xx     ',
  ],
};

/**
 * Which icon a row shows, by item type. `ReCreateDesignList` switches on
 * `item->GetType()` (`design_inspector.cpp:243-263`); the root row is handled
 * separately at `:236` and uses `root_xpm`.
 */
export const DS_INSPECTOR_ICON: Record<string, XpmIcon> = {
  line: DS_ICON_LINE,
  rect: DS_ICON_RECT,
  text: DS_ICON_TEXT,
  polygon: DS_ICON_POLY,
  bitmap: DS_ICON_IMG,
};

/**
 * The horizontal runs of ink in an XPM, as `[x, y, width]` triples.
 *
 * A wxBitmap built from an XPM is blitted pixel for pixel, so the browser has to
 * draw the same pixels. Runs rather than one rect per pixel because a 12 x 12
 * icon is up to 144 nodes otherwise and these sit in every row of a grid; the
 * result is identical geometry, just fewer elements.
 */
export function xpmRuns(icon: XpmIcon): [number, number, number][] {
  const runs: [number, number, number][] = [];
  icon.rows.forEach((row, y) => {
    let start = -1;
    for (let x = 0; x <= row.length; x++) {
      const ink = row[x] === 'x';
      if (ink && start < 0) start = x;
      else if (!ink && start >= 0) {
        runs.push([start, y, x - start]);
        start = -1;
      }
    }
  });
  return runs;
}
