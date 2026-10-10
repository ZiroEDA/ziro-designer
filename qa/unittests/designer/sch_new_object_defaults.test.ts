// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * "Defaults for New Objects" (Preferences > Schematic Editor > Editing
 * Options), which `SCH_DRAWING_TOOLS` stamps onto a sheet as it is drawn. The power-kind default
 * is pinned live, in eeschema/sch_place_symbol_tool.test.ts.
 *
 * These are defaults for NEW objects and not a theme: nothing re-reads the
 * preference afterwards, so a sheet drawn while the border default was red
 * stays red when the default changes. Both halves of that matter — the value
 * has to reach the item, and it has to stop there.
 */
import { describe, expect, it } from 'vitest';
import { parse, serialize } from '@ziroeda/sexpr';
import { readSchematic, writeSchematic } from '@ziroeda/eeschema';
import { makeSheet } from '@ziroeda/eeschema/tools/build-graphics.js';
import { addItems } from '@ziroeda/eeschema/tools/mutate.js';

const MM = 10000;
const AT = { x: 100 * MM, y: 100 * MM };
const SIZE = { w: 30 * MM, h: 20 * MM };
const EMPTY = readSchematic(
  parse(
    '(kicad_sch (version 20250114) (generator "eeschema") (sheet_instances (path "/" (page "1"))))',
  ),
);

/** The sheet as it would be WRITTEN, which is the only thing that survives. */
const written = (sheet: ReturnType<typeof makeSheet>): string =>
  serialize(writeSchematic(addItems({ sheets: [sheet] }).apply(EMPTY)));

describe('the border of a sheet as it is drawn', () => {
  it('is the default line thickness, in mils, not a fixed 6', () => {
    // `SetBorderWidth( schIUScale.MilsToIU( cfg->m_Drawing.default_line_thickness ) )`
    // (`sch_drawing_tools.cpp:3444`).
    expect(makeSheet(AT, SIZE, 'S', 's.kicad_sch', { borderWidthMils: 12 }).stroke?.width).toBe(
      Math.round(12 * 0.0254 * MM),
    );
    expect(makeSheet(AT, SIZE, 'S', 's.kicad_sch', { borderWidthMils: 6 }).stroke?.width).toBe(
      Math.round(6 * 0.0254 * MM),
    );
  });

  it('falls back to DEFAULT_LINE_WIDTH_MILS when the caller says nothing', () => {
    expect(makeSheet(AT, SIZE, 'S', 's.kicad_sch').stroke?.width).toBe(Math.round(6 * 0.0254 * MM));
  });

  it('reaches the file, not only the model', () => {
    // A model field the writer never emits is a setting that silently vanishes
    // on the next save.
    expect(written(makeSheet(AT, SIZE, 'S', 's.kicad_sch', { borderWidthMils: 12 }))).toContain(
      '(width 0.3048)',
    );
  });

  it('takes the default border colour', () => {
    const sheet = makeSheet(AT, SIZE, 'S', 's.kicad_sch', { borderColor: [255, 0, 0, 1] });
    expect(sheet.stroke?.color).toEqual([255, 0, 0, 1]);
    expect(written(sheet)).toContain('(color 255 0 0');
  });

  it('has no colour of its own when the preference is unset', () => {
    // `COLOR4D::UNSPECIFIED` means "take the theme's", which for us is an
    // absent colour — writing black would pin every new sheet to black.
    const sheet = makeSheet(AT, SIZE, 'S', 's.kicad_sch', { borderWidthMils: 6 });
    expect(sheet.stroke?.color).toBeUndefined();
    expect(sheet.fillColor).toBeUndefined();
  });

  it('takes the default background colour', () => {
    const sheet = makeSheet(AT, SIZE, 'S', 's.kicad_sch', { backgroundColor: [0, 0, 255, 0.5] });
    expect(sheet.fillColor).toEqual([0, 0, 255, 0.5]);
    expect(written(sheet)).toContain('(color 0 0 255');
  });
});
