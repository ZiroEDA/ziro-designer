// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Design Inspector's type icons are KiCad's own six XPMs, not an icon set
 * of ours.
 *
 * `design_inspector.cpp:46-158` declares six `static const char* …_xpm[]`
 * arrays, each `"12 12 2 1"` with `" c None"` and one colour, and
 * `BitmapGridCellRenderer::Draw` (`:359-366`) blits one into `COL_BITMAP`. Our
 * column was empty.
 *
 * This is DATA — KiCad hardcodes it, does not ask the theme for it, and does not
 * keep it in its icon set — so the rule is *mirror the table*. The check is a
 * diff against KiCad's own arrays, vendored verbatim at
 * `qa/data/design_inspector_xpm.txt` (the same trick `writer_kicad_grammar`
 * uses for `schematic.keywords`), so a retyped pixel or an invented colour
 * fails here rather than looking fine.
 *
 * Each icon is asserted BY NAME. A single bulk comparison would pass while one
 * of the six was missing or duplicated.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DS_ICON_ROOT,
  DS_ICON_LINE,
  DS_ICON_RECT,
  DS_ICON_TEXT,
  DS_ICON_POLY,
  DS_ICON_IMG,
  DS_INSPECTOR_ICON,
  DS_INSPECTOR_BITMAP_SIZE,
  DS_INSPECTOR_ICON_PX,
  DS_INSPECTOR_ICON_OFFSET,
  xpmRuns,
  type XpmIcon,
} from '@ziroeda/designer/src/editors/drawingsheet/inspector_icons.js';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/** KiCad's arrays, parsed back out of the vendored copy. */
const UPSTREAM: Record<string, XpmIcon> = (() => {
  const src = read('../../data/design_inspector_xpm.txt');
  const out: Record<string, XpmIcon> = {};
  for (const m of src.matchAll(/static const char\*\s+(\w+)_xpm\[\] =\s*\{([\s\S]*?)\};/g)) {
    const rows = [...m[2]!.matchAll(/"([^"]*)"/g)].map((r) => r[1]!);
    const [header, none, colour, ...pixels] = rows;
    expect(header, `${m[1]} is 12 x 12, two colours`).toBe('12 12 2 1');
    expect(none!.trim()).toBe('c None');
    out[m[1]!] = { color: `#${colour!.split('#')[1]!}`, rows: pixels };
  }
  return out;
})();

describe('the vendored copy itself', () => {
  it('holds all six arrays', () => {
    // If the vendoring broke, every comparison below would pass vacuously
    // against an empty record.
    expect(Object.keys(UPSTREAM).sort()).toEqual(['img', 'line', 'poly', 'rect', 'root', 'text']);
  });
});

describe('each icon matches KiCad pixel for pixel', () => {
  const cases: [string, string, XpmIcon][] = [
    ['root_xpm', 'root', DS_ICON_ROOT],
    ['line_xpm', 'line', DS_ICON_LINE],
    ['rect_xpm', 'rect', DS_ICON_RECT],
    ['text_xpm', 'text', DS_ICON_TEXT],
    ['poly_xpm', 'poly', DS_ICON_POLY],
    ['img_xpm', 'img', DS_ICON_IMG],
  ];

  for (const [label, key, ours] of cases) {
    it(`reproduces ${label}`, () => {
      const theirs = UPSTREAM[key]!;
      expect(ours.color, `${label} keeps KiCad's colour`).toBe(theirs.color);
      expect(ours.rows, `${label} keeps KiCad's pixels`).toEqual(theirs.rows);
      // The XPM header promises this shape; hold the mirror to it too.
      expect(ours.rows).toHaveLength(12);
      for (const row of ours.rows) expect(row).toHaveLength(12);
    });
  }

  it('uses the four colours KiCad chose, and no others', () => {
    // Teal page and line, navy rectangle, maroon text and image, green polygon.
    expect(DS_ICON_ROOT.color).toBe('#008080');
    expect(DS_ICON_LINE.color).toBe('#008080');
    expect(DS_ICON_RECT.color).toBe('#000080');
    expect(DS_ICON_TEXT.color).toBe('#800000');
    expect(DS_ICON_POLY.color).toBe('#008000');
    expect(DS_ICON_IMG.color).toBe('#800000');
  });
});

describe('the type-to-icon mapping', () => {
  it('covers every DS_DATA_ITEM type, one at a time', () => {
    // ReCreateDesignList's switch, design_inspector.cpp:243-263.
    expect(DS_INSPECTOR_ICON.line).toBe(DS_ICON_LINE);
    expect(DS_INSPECTOR_ICON.rect).toBe(DS_ICON_RECT);
    expect(DS_INSPECTOR_ICON.text).toBe(DS_ICON_TEXT);
    expect(DS_INSPECTOR_ICON.polygon).toBe(DS_ICON_POLY);
    expect(DS_INSPECTOR_ICON.bitmap).toBe(DS_ICON_IMG);
  });

  it('does not map the root icon to an item type', () => {
    // root_xpm belongs to the pseudo-row (:236), which is not a DS_DATA_ITEM.
    expect(Object.values(DS_INSPECTOR_ICON)).not.toContain(DS_ICON_ROOT);
  });
});

describe('the pixels reach the screen', () => {
  it('encodes runs that add up to the ink in the array', () => {
    for (const [name, icon] of Object.entries(UPSTREAM)) {
      const ink = icon.rows
        .join('')
        .split('')
        .filter((c) => c === 'x').length;
      const covered = xpmRuns(icon).reduce((n, [, , w]) => n + w, 0);
      expect(covered, `${name} draws every lit pixel and no more`).toBe(ink);
    }
  });

  it('places each run where the array puts it', () => {
    // line_xpm is the easiest to state independently: a 2 px bar down the left
    // for ten rows, then two full-width rows.
    const runs = xpmRuns(DS_ICON_LINE);
    expect(runs.slice(0, 10)).toEqual([
      [0, 0, 2],
      [0, 1, 2],
      [0, 2, 2],
      [0, 3, 2],
      [0, 4, 2],
      [0, 5, 2],
      [0, 6, 2],
      [0, 7, 2],
      [0, 8, 2],
      [0, 9, 2],
    ]);
    expect(runs.slice(10)).toEqual([
      [0, 10, 12],
      [0, 11, 12],
    ]);
  });

  it('splits a row that has a gap in it', () => {
    // rect_xpm's middle rows are "xx        xx" — two runs, not one.
    expect(xpmRuns(DS_ICON_RECT).filter(([, y]) => y === 5)).toEqual([
      [0, 5, 2],
      [10, 5, 2],
    ]);
  });
});

describe('the cell metrics', () => {
  it('takes them from the C++ rather than from taste', () => {
    expect(DS_INSPECTOR_ICON_PX).toBe(12); // "12 12 2 1"
    expect(DS_INSPECTOR_BITMAP_SIZE).toBe(16); // #define BITMAP_SIZE 16
    expect(DS_INSPECTOR_ICON_OFFSET).toEqual({ x: 5, y: 2 }); // DrawBitmap +5, +2
  });
});

describe('the dialog draws them', () => {
  const PANEL = read('../../../designer/src/editors/drawingsheet/DesignInspector.tsx')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

  it('renders an icon in COL_BITMAP instead of an empty cell', () => {
    // The column was `<td className="ze-grid-text" />`. Naming the element, so
    // deleting the render but leaving the import behind still fails.
    expect(PANEL).toContain('<XpmBitmap');
    expect(PANEL).not.toMatch(/<td className="ze-grid-text" \/>/);
  });

  it('gives the root row root_xpm and an item row its type icon', () => {
    expect(PANEL).toContain(
      'row.itemIndex === null ? DS_ICON_ROOT : iconFor(items[row.itemIndex])',
    );
  });

  it('draws square pixels, because a wxBitmap blit does not antialias', () => {
    expect(PANEL).toContain('shapeRendering="crispEdges"');
  });
});
