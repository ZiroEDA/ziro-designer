// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Properties panel's "Bitmap DPI:" field edits the SCALE.
 *
 * `DS_DATA_ITEM_BITMAP::GetPPI()` is derived —
 * `m_ImageBitmap->GetPPI() / m_ImageBitmap->GetScale()`
 * (common/drawing_sheet/ds_data_item.cpp:772-778) — and `SetPPI( n )` is
 * `SetScale( m_ImageBitmap->GetPPI() / n )` (:781-785). The `.kicad_wks` carries
 * `(scale …)` and no DPI token at all (ds_data_model_io.cpp:405-430).
 *
 * `wks.test.ts` pins those two conversions as functions. This pins the one
 * thing that file cannot see: that the CONTROL is wired to them. The panel used
 * to show `WksBitmap.ppi` — the PNG's own pHYs resolution — and patch the typed
 * number straight back into it, so the reading was wrong for any scaled image
 * and the edit was discarded by the next load. Both helpers could be perfect
 * and that bug would still ship.
 *
 * There is no React harness here, so this reads the source, and it reads only
 * the Bitmap DPI row rather than the whole file: a file-wide "mentions
 * bitmapDisplayPPI" would pass while the row itself still touched `ppi`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** The panel's source with comments blanked — prose must not read as code. */
const PANEL = readFileSync(
  fileURLToPath(
    new URL('../../../designer/src/editors/drawingsheet/PropertiesFrame.tsx', import.meta.url),
  ),
  'utf8',
)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\/[^\n]*/g, '');

/**
 * Just the `<Row label="Bitmap DPI:">` element, from its label to the closing
 * `</Row>`. There is exactly one, and if it ever stops existing the extraction
 * fails rather than vacuously passing.
 */
function bitmapDpiRow(): string {
  const start = PANEL.indexOf('label="Bitmap DPI:"');
  expect(start, 'the Bitmap DPI row must exist').toBeGreaterThan(-1);
  const end = PANEL.indexOf('</Row>', start);
  expect(end, 'the Bitmap DPI row must be closed').toBeGreaterThan(start);
  return PANEL.slice(start, end);
}

describe('the Bitmap DPI field', () => {
  it('displays GetPPI(), not the stored image resolution', () => {
    const row = bitmapDpiRow();
    expect(row).toContain('bitmapDisplayPPI(bitmap)');
  });

  it('commits a scale, never a ppi', () => {
    const row = bitmapDpiRow();
    expect(row).toContain('bitmapScaleForPPI(bitmap');
    expect(row).toContain('scale:');
  });

  it('never reads or writes the ppi field directly', () => {
    const row = bitmapDpiRow();
    // `bitmap.ppi` as a value, and `ppi:` as a patch key, are both the old bug.
    expect(row).not.toMatch(/bitmap\.ppi/);
    expect(row).not.toMatch(/\bppi\s*:/);
  });

  it('refuses a DPI of zero rather than dividing by it', () => {
    // `msg.ToLong( &value )` gates the call upstream (properties_frame.cpp:634-637).
    expect(bitmapDpiRow()).toMatch(/>\s*0/);
  });
});
