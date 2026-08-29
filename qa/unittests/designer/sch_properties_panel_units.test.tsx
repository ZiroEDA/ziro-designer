// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SCH_PROPERTIES_PANEL end to end: the rows the eeschema package produces for
 * a real placed symbol, rendered by the shared widget, read as KiCad's grid.
 *
 * This is the seam the "Position X shows 2100.00" bug lived in. Neither half
 * was wrong on its own — the rows carried honest IU, and
 * `StringFromValue` in `ui/unit_binder.ts` had always been able to add the
 * unit label — but the schematic frame handed the grid the MESSAGE PANEL's
 * formatter, which does neither at the grid's precision. So a test that
 * exercises only the row provider or only the widget cannot fail on it; this
 * one mounts the subclass that binds the two together.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { parse } from '@ziroeda/sexpr';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readSchematic, readSymbolLib } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import { schPropertiesFor } from '@ziroeda/eeschema/src/tools/sch_properties_panel.js';
import { itemRefById } from '@ziroeda/eeschema/src/tools/hittest.js';
import { SchPropertiesPanel } from '@ziroeda/designer/src/editors/schematic/components/SchPropertiesPanel.js';
import type { LibSymbol } from '@ziroeda/eeschema/src/types.js';
import type { StatusUnits } from '@ziroeda/designer/src/ui/status_format.js';

afterEach(cleanup);

// `import.meta.url` is not a file: URL under happy-dom, so the fixture is
// resolved off the vitest root (qa/) the way the other DOM tests do.
const rawR = readFileSync(resolve(process.cwd(), 'data/R.kicad_sym'), 'utf8');
const R = readSymbolLib(parse(rawR))[0]!;
const LIB = new Map<string, LibSymbol>([[R.libId, R]]);
const rBlock = rawR.slice(rawR.indexOf('(symbol "'), rawR.lastIndexOf(')'));

/**
 * The symbol sits at (48.26, 48.26) mm, which is exactly 1900 mils — the
 * number Akshay's KiCad screenshot reads back as `1900 mils`.
 */
const doc = readSchematic(
  parse(`(kicad_sch (version 20250114) (lib_symbols ${rBlock})
    (symbol (lib_id "R") (at 48.26 48.26 0) (unit 1) (uuid "r1")
      (property "Reference" "R1" (at 0 0 0))
      (property "Value" "10k" (at 0 0 0))))`),
);

/** The value cell text of one named row, as the panel paints it. */
function cellText(name: string, units: StatusUnits): string {
  const { container } = render(
    <SchPropertiesPanel
      rows={schPropertiesFor(doc, LIB, itemRefById(doc, 'r1')!)}
      selectionCount={1}
      friendlyName="Symbol"
      units={units}
      onCommand={() => {}}
    />,
  );
  const row = Array.from(container.querySelectorAll('.ze-pgrid-row')).find(
    (r) => r.querySelector('.ze-pgrid-name')?.textContent === name,
  );
  if (!row) throw new Error(`no row named ${name}`);
  return row.querySelector('.ze-pgrid-value')?.textContent ?? '';
}

describe('every distance cell carries its unit, as PGPROPERTY_DISTANCE does', () => {
  it('paints Position X and Y as "1900 mils", not "1900.00"', () => {
    expect(cellText('Position X', 'mils')).toBe('1900 mils');
    expect(cellText('Position Y', 'mils')).toBe('1900 mils');
  });

  it('follows the frame’s display units', () => {
    expect(cellText('Position X', 'mm')).toBe('48.26 mm');
    expect(cellText('Position X', 'in')).toBe('1.9 in');
  });

  /**
   * `PROPERTY_DISPLAY::PT_SIZE` on "Pin Name Position Offset"
   * (lib_symbol.cpp:2689) makes it a PGPROPERTY_SIZE, which is the same
   * PGPROPERTY_DISTANCE. A panel that added units only to PT_COORD would pass
   * the two assertions above and still be wrong here.
   */
  it('paints the PT_SIZE row the same way, so the offset reads "0 mils"', () => {
    expect(cellText('Pin Name Position Offset', 'mils')).toBe('0 mils');
  });

  it('leaves a non-distance row alone — Orientation is not "0 mils"', () => {
    expect(cellText('Orientation', 'mils')).toBe('0');
  });
});
