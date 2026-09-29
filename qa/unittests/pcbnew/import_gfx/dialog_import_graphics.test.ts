// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `runImport`, the ported `DIALOG_IMPORT_GRAPHICS::TransferDataFromWindow`
 * (`pcbnew/import_gfx/dialog_import_graphics.cpp:196-227`) minus the two
 * `wxMessageBox` validations, which the dialog component checks itself.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PARAMS,
  runImport,
  type Params,
} from '@ziroeda/pcbnew/import_gfx/dialog_import_graphics.js';
import { DXF_IMPORT_UNITS } from '@ziroeda/common/import_gfx/dxf_import_plugin.js';

/** Build DXF text from group couplets, `dxf_import_plugin.test.ts`'s helper. */
const dxf = (pairs: (readonly [number, string])[]): string =>
  `${pairs.map(([c, v]) => `${c}\n${v}`).join('\n')}\n`;
const entities = (pairs: (readonly [number, string])[]): string =>
  dxf([[0, 'SECTION'], [2, 'ENTITIES'], ...pairs, [0, 'ENDSEC'], [0, 'EOF']]);

const oneLine = entities([
  [0, 'LINE'],
  [8, 'A'],
  [10, '0'],
  [20, '0'],
  [11, '10'],
  [21, '0'],
]);

describe('runImport', () => {
  it('refuses a file whose extension no plugin handles', () => {
    const got = runImport('board.pdf', 'whatever', DEFAULT_PARAMS, false, false, 'Dwgs.User');
    expect(got.error).toBe('There is no plugin to handle this file type.');
    expect(got.items).toEqual([]);
  });

  it('imports a DXF entity into board internal units', () => {
    const got = runImport('outline.dxf', oneLine, DEFAULT_PARAMS, false, false, 'Dwgs.User');
    expect(got.error).toBeUndefined();
    expect(got.items).toHaveLength(1);
    expect(got.items[0]).toMatchObject({ type: 'shape' });
  });

  it('reports the empty-import case the dialog turns into "No graphic items found in file."', () => {
    const empty = entities([]);
    const got = runImport('empty.dxf', empty, DEFAULT_PARAMS, false, false, 'Dwgs.User');
    expect(got.error).toBeUndefined();
    expect(got.items).toHaveLength(0);
  });

  it('applies the scale before mapping coordinates', () => {
    const unit = runImport('a.dxf', oneLine, DEFAULT_PARAMS, false, false, 'Dwgs.User');
    const doubled = runImport(
      'a.dxf',
      oneLine,
      { ...DEFAULT_PARAMS, scale: 2 },
      false,
      false,
      'Dwgs.User',
    );

    const u = unit.items[0]!;
    const d = doubled.items[0]!;
    if (u.type !== 'shape' || d.type !== 'shape') throw new Error('expected a shape');
    // 10 mm at 1x vs 2x: the end X doubles.
    expect(d.shape.end!.x).toBe(2 * u.shape.end!.x);
  });

  it('sends the requested target layer to the importer when "Layer:" is checked', () => {
    const got = runImport(
      'a.dxf',
      oneLine,
      { ...DEFAULT_PARAMS, setLayer: true, layer: 'F.SilkS' },
      false,
      false,
      'Dwgs.User',
    );
    const item = got.items[0]!;
    if (item.type !== 'shape') throw new Error('expected a shape');
    expect(item.shape.layer).toBe('F.SilkS');
  });

  it('falls back to the board editor active layer when "Layer:" is unchecked', () => {
    const got = runImport(
      'a.dxf',
      oneLine,
      { ...DEFAULT_PARAMS, setLayer: false, layer: 'F.SilkS' },
      false,
      false,
      'B.Cu',
    );
    const item = got.items[0]!;
    if (item.type !== 'shape') throw new Error('expected a shape');
    expect(item.shape.layer).toBe('B.Cu');
  });

  it('places at the typed X/Y when Place At is checked, and at the model origin otherwise', () => {
    const interactive = runImport(
      'a.dxf',
      oneLine,
      { ...DEFAULT_PARAMS, placeAt: false, originMM: { x: 50, y: 50 } },
      false,
      false,
      'Dwgs.User',
    );
    const placed = runImport(
      'a.dxf',
      oneLine,
      { ...DEFAULT_PARAMS, placeAt: true, originMM: { x: 50, y: 0 } },
      false,
      false,
      'Dwgs.User',
    );

    const i0 = interactive.items[0]!;
    const p0 = placed.items[0]!;
    if (i0.type !== 'shape' || p0.type !== 'shape') throw new Error('expected a shape');
    // The DXF line's own start is (0,0): unplaced, it lands at the model
    // origin regardless of what the (disabled) X/Y fields say; placed, the
    // typed X becomes the shape's start X (50 mm, at 1e6 IU/mm).
    expect(i0.shape.start).toEqual({ x: 0, y: 0 });
    expect(p0.shape.start!.x).toBe(50_000_000);
  });

  it("flips the placed origin with the display's inverted axes, same as `xscale *= -1`", () => {
    const params: Params = { ...DEFAULT_PARAMS, placeAt: true, originMM: { x: 10, y: 0 } };
    const normal = runImport('a.dxf', oneLine, params, false, false, 'Dwgs.User');
    const inverted = runImport('a.dxf', oneLine, params, true, false, 'Dwgs.User');

    const n = normal.items[0]!;
    const inv = inverted.items[0]!;
    if (n.type !== 'shape' || inv.type !== 'shape') throw new Error('expected a shape');
    expect(inv.shape.start!.x).toBe(-n.shape.start!.x);
  });

  it('only applies the DXF default line width to a DXF file', () => {
    // The line carries no explicit width group (group 39), so it takes the
    // importer's default — set from `lineWidthMM`, in board IU.
    const got = runImport(
      'a.dxf',
      oneLine,
      { ...DEFAULT_PARAMS, lineWidthMM: 0.5 },
      false,
      false,
      'Dwgs.User',
    );
    const item = got.items[0]!;
    if (item.type !== 'shape') throw new Error('expected a shape');
    expect(item.shape.width).toBe(500_000);
  });

  it('reads the DXF default units into the plugin when the file has none', () => {
    // Both runs use the same file; only the "no $INSUNITS" fallback differs,
    // and it should change the imported extent by the mm-per-unit ratio.
    const mm = runImport(
      'a.dxf',
      oneLine,
      { ...DEFAULT_PARAMS, dxfUnits: DXF_IMPORT_UNITS.MM },
      false,
      false,
      'Dwgs.User',
    );
    const inch = runImport(
      'a.dxf',
      oneLine,
      { ...DEFAULT_PARAMS, dxfUnits: DXF_IMPORT_UNITS.INCH },
      false,
      false,
      'Dwgs.User',
    );
    const mmItem = mm.items[0]!;
    const inchItem = inch.items[0]!;
    if (mmItem.type !== 'shape' || inchItem.type !== 'shape') throw new Error('expected a shape');
    // 10 "units" read as mm is 10 mm; read as inches is 254 mm — 25.4x bigger.
    expect(inchItem.shape.end!.x).toBe(25.4 * mmItem.shape.end!.x);
  });
});
